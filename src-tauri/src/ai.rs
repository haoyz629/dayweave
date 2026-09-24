use std::time::Duration;

use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    database::{AiDraftCreationInput, AiMessageDto, AiTaskCandidateDto, RecurrenceInput, StoredAiConnectionSettings, TaskDraftInput},
    domain::{AiProposal, Priority},
    error::{AppError, AppResult},
};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiGeneratedResult {
    pub assistant_message: String,
    pub drafts: Vec<AiGeneratedTaskDraft>,
    pub proposal: Option<AiProposal>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiGeneratedTaskDraft {
    pub draft_kind: String,
    pub target_task_id: Option<String>,
    pub title: String,
    pub notes: Option<String>,
    pub priority: Option<Priority>,
    pub earliest_start_date: Option<String>,
    pub earliest_start_time: Option<String>,
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub total_workload_minutes: Option<i64>,
    pub remaining_workload_minutes: Option<i64>,
    pub tags: Vec<String>,
    pub recurrence: Option<RecurrenceInput>,
}

impl AiGeneratedTaskDraft {
    pub fn into_creation_input(self) -> AiDraftCreationInput {
        AiDraftCreationInput {
            draft_kind: self.draft_kind,
            target_task_id: self.target_task_id,
            input: TaskDraftInput {
            item_type: "task".into(),
            recurring_settings: None,
            title: self.title,
            notes: self.notes,
            priority: self.priority,
            earliest_start_date: self.earliest_start_date,
            earliest_start_time: self.earliest_start_time,
            due_date: self.due_date,
            due_time: self.due_time,
            total_workload_minutes: self.total_workload_minutes,
            remaining_workload_minutes: self.remaining_workload_minutes,
            field_states_json: json!({
                "title": "ai_organized",
                "notes": "ai_organized",
                "priority": "ai_organized",
                "earliest_start": "ai_organized",
                "due": "ai_organized",
                "workload": "ai_organized",
                "tags": "ai_organized",
                "recurrence": "ai_organized"
            }).to_string(),
            tags: self.tags,
                recurrence: self.recurrence,
            },
        }
    }
}

pub fn call_task_assistant(
    settings: &StoredAiConnectionSettings,
    messages: &[AiMessageDto],
    task_candidates: &[AiTaskCandidateDto],
) -> AppResult<(AiGeneratedResult, String)> {
    let candidate_json = serde_json::to_string(task_candidates)?;
    let system = format!("你是今序的任务整理助手。当前时区为 Asia/Shanghai（UTC+8）。创建或修改任务时只生成 drafts；安排日计划、完成任务或软删除任务时可以生成一个 proposal。不要声称已经创建、保存、排程、完成或删除正式数据。信息不足时回复澄清问题，drafts 为空且 proposal 为 null。修改任务时 draft_kind 必须是 update，并且 target_task_id 只能取自候选任务；创建时 draft_kind 是 create 且 target_task_id 为 null。完成和删除的 task_id 也只能取自候选任务。删除必须给出精确目标数量，后续仍由用户二次确认。日期必须为 YYYY-MM-DD，时刻必须是含 +08:00 的 RFC3339；任务草稿中的时刻字段只用 HH:MM。一次最多返回 10 条草稿，且 drafts 与 proposal 不要同时非空。候选任务（最多 20 项，仅含必要字段）：{candidate_json}");
    let conversational_messages: Vec<Value> = std::iter::once(json!({ "role": "system", "content": system }))
        .chain(messages.iter().filter(|message| message.role != "system").map(|message| {
            json!({ "role": message.role, "content": message.content })
        }))
        .collect();
    let schema = task_draft_schema();
    let body = match settings.api_type.as_str() {
        "chat_completions" => json!({
            "model": settings.model,
            "messages": conversational_messages,
            "response_format": {
                "type": "json_schema",
                "json_schema": { "name": "jinxu_task_drafts", "strict": true, "schema": schema }
            }
        }),
        "responses" => json!({
            "model": settings.model,
            "input": conversational_messages,
            "text": { "format": { "type": "json_schema", "name": "jinxu_task_drafts", "strict": true, "schema": schema } }
        }),
        _ => return Err(AppError::Domain("AI API 类型无效".into())),
    };
    let suffix = if settings.api_type == "responses" { "responses" } else { "chat/completions" };
    let url = endpoint_url(&settings.endpoint, suffix);
    let response = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| AppError::Domain(format!("无法初始化 AI 网络连接：{error}")))?
        .post(url)
        .bearer_auth(&settings.api_key)
        .json(&body)
        .send()
        .map_err(|error| AppError::Domain(format!("AI 连接失败：{error}")))?;
    let status = response.status();
    let response_json: Value = response.json()
        .map_err(|error| AppError::Domain(format!("AI 服务返回了无法解析的响应：{error}")))?;
    if !status.is_success() {
        let detail = response_json.pointer("/error/message").and_then(Value::as_str).unwrap_or("服务未返回错误详情");
        let detail: String = detail.chars().take(500).collect();
        return Err(AppError::Domain(format!("AI 服务返回 {status}：{detail}")));
    }
    let output = extract_structured_text(&response_json, &settings.api_type)?;
    let parsed: AiGeneratedResult = serde_json::from_str(&output)
        .map_err(|error| AppError::Schema(format!("AI 结构化结果不符合今序草稿格式：{error}")))?;
    if parsed.assistant_message.trim().is_empty() {
        return Err(AppError::Schema("AI 回复文字不能为空".into()));
    }
    if parsed.drafts.len() > 10 {
        return Err(AppError::Schema("AI 一次返回的草稿超过 10 条".into()));
    }
    if !parsed.drafts.is_empty() && parsed.proposal.is_some() {
        return Err(AppError::Schema("AI 不能在一次回复中同时提交任务草稿和操作提议".into()));
    }
    if let Some(proposal) = &parsed.proposal { proposal.validate_shape()?; }
    Ok((parsed, output))
}

pub fn test_connection(settings: &StoredAiConnectionSettings) -> AppResult<String> {
    let messages = vec![AiMessageDto {
        id: "connection-test".into(),
        conversation_id: "connection-test".into(),
        run_id: None,
        role: "user".into(),
        content: "这是连接测试。请简短回复连接可用，不要生成任务草稿。".into(),
        stream_status: "complete".into(),
        created_at: String::new(),
        updated_at: String::new(),
    }];
    let (result, _) = call_task_assistant(settings, &messages, &[])?;
    Ok(result.assistant_message)
}

fn endpoint_url(endpoint: &str, suffix: &str) -> String {
    let endpoint = endpoint.trim_end_matches('/');
    if endpoint.ends_with(suffix) { endpoint.to_owned() } else { format!("{endpoint}/{suffix}") }
}

fn extract_structured_text(response: &Value, api_type: &str) -> AppResult<String> {
    if api_type == "chat_completions" {
        if let Some(content) = response.pointer("/choices/0/message/content").and_then(Value::as_str) {
            return Ok(content.to_owned());
        }
        if let Some(parts) = response.pointer("/choices/0/message/content").and_then(Value::as_array) {
            if let Some(text) = parts.iter().find_map(|part| part.get("text").and_then(Value::as_str)) {
                return Ok(text.to_owned());
            }
        }
    } else {
        if let Some(text) = response.get("output_text").and_then(Value::as_str) {
            return Ok(text.to_owned());
        }
        if let Some(output) = response.get("output").and_then(Value::as_array) {
            for item in output {
                if let Some(content) = item.get("content").and_then(Value::as_array) {
                    if let Some(text) = content.iter().find_map(|part| {
                        if part.get("type").and_then(Value::as_str) == Some("output_text") {
                            part.get("text").and_then(Value::as_str)
                        } else { None }
                    }) {
                        return Ok(text.to_owned());
                    }
                }
            }
        }
    }
    Err(AppError::Domain("AI 服务没有返回结构化文本".into()))
}

fn task_draft_schema() -> Value {
    let nullable_string = json!({ "type": ["string", "null"] });
    let nullable_minutes = json!({ "type": ["integer", "null"], "minimum": 0, "maximum": 525600 });
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["assistant_message", "drafts", "proposal"],
        "properties": {
            "assistant_message": { "type": "string", "minLength": 1, "maxLength": 4000 },
            "drafts": {
                "type": "array", "maxItems": 10,
                "items": {
                    "type": "object", "additionalProperties": false,
                    "required": ["draft_kind", "target_task_id", "title", "notes", "priority", "earliest_start_date", "earliest_start_time", "due_date", "due_time", "total_workload_minutes", "remaining_workload_minutes", "tags", "recurrence"],
                    "properties": {
                        "draft_kind": { "type": "string", "enum": ["create", "update"] },
                        "target_task_id": nullable_string,
                        "title": { "type": "string", "minLength": 1, "maxLength": 300 },
                        "notes": nullable_string,
                        "priority": { "type": ["string", "null"], "enum": ["low", "medium", "high", null] },
                        "earliest_start_date": nullable_string,
                        "earliest_start_time": nullable_string,
                        "due_date": nullable_string,
                        "due_time": nullable_string,
                        "total_workload_minutes": nullable_minutes,
                        "remaining_workload_minutes": nullable_minutes,
                        "tags": { "type": "array", "maxItems": 20, "items": { "type": "string", "minLength": 1, "maxLength": 40 } },
                        "recurrence": {
                            "anyOf": [
                                { "type": "null" },
                                {
                                    "type": "object", "additionalProperties": false,
                                    "required": ["frequency", "interval_value", "weekdays", "month_day", "starts_on", "ends_on"],
                                    "properties": {
                                        "frequency": { "type": "string", "enum": ["daily", "weekdays", "weekly", "monthly"] },
                                        "interval_value": { "type": "integer", "minimum": 1, "maximum": 365 },
                                        "weekdays": { "type": "array", "items": { "type": "integer", "minimum": 1, "maximum": 7 }, "uniqueItems": true },
                                        "month_day": { "type": ["integer", "null"], "minimum": 1, "maximum": 31 },
                                        "starts_on": { "type": "string" },
                                        "ends_on": nullable_string
                                    }
                                }
                            ]
                        }
                    }
                }
            },
            "proposal": {
                "anyOf": [
                    { "type": "null" },
                    {
                        "type": "object", "additionalProperties": false,
                        "required": ["proposal_id", "operation"],
                        "properties": {
                            "proposal_id": { "type": "string", "minLength": 1, "maxLength": 100 },
                            "operation": {
                                "anyOf": [
                                    { "type": "object", "additionalProperties": false, "required": ["type", "task_id"], "properties": { "type": { "type": "string", "enum": ["proposed_task_complete"] }, "task_id": { "type": "string" } } },
                                    { "type": "object", "additionalProperties": false, "required": ["type", "task_ids", "precise_target_count"], "properties": { "type": { "type": "string", "enum": ["proposed_task_soft_delete"] }, "task_ids": { "type": "array", "minItems": 1, "maxItems": 20, "uniqueItems": true, "items": { "type": "string" } }, "precise_target_count": { "type": "integer", "minimum": 1, "maximum": 20 } } },
                                    { "type": "object", "additionalProperties": false, "required": ["type", "plan_date", "blocks"], "properties": { "type": { "type": "string", "enum": ["proposed_plan"] }, "plan_date": { "type": "string" }, "blocks": { "type": "array", "minItems": 1, "maxItems": 20, "items": { "type": "object", "additionalProperties": false, "required": ["task_id", "starts_at", "ends_at", "source"], "properties": { "task_id": { "type": "string" }, "starts_at": { "type": "string" }, "ends_at": { "type": "string" }, "source": { "type": "string", "enum": ["ai"] } } } } } }
                                ]
                            }
                        }
                    }
                ]
            }
        }
    })
}
