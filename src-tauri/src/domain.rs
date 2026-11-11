use chrono::{DateTime, FixedOffset, NaiveDate, NaiveTime};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub const SHANGHAI_OFFSET_SECONDS: i32 = 8 * 60 * 60;
pub const MIN_TASK_BLOCK_MINUTES: i64 = 15;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Open,
    Scheduled,
    Done,
    Deleted,
}

impl TaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Scheduled => "scheduled",
            Self::Done => "done",
            Self::Deleted => "deleted",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "open" => Ok(Self::Open),
            "scheduled" => Ok(Self::Scheduled),
            "done" => Ok(Self::Done),
            "deleted" => Ok(Self::Deleted),
            _ => Err(AppError::Domain(format!("未知任务状态：{value}"))),
        }
    }

    pub fn ensure_editable(self) -> AppResult<()> {
        match self {
            Self::Open | Self::Scheduled => Ok(()),
            Self::Done => Err(AppError::Domain("任务已完成，请先取消完成再修改".into())),
            Self::Deleted => Err(AppError::Domain("回收站任务必须先恢复才能编辑".into())),
        }
    }

    pub fn can_transition_to(self, target: Self) -> bool {
        matches!(
            (self, target),
            (Self::Open, Self::Scheduled | Self::Done | Self::Deleted)
                | (Self::Scheduled, Self::Open | Self::Done | Self::Deleted)
                | (Self::Done, Self::Open | Self::Scheduled | Self::Deleted)
        )
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReviewOutcome {
    Completed,
    Partial,
    NotStarted,
    Cancelled,
    Blocked,
}

impl ReviewOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Partial => "partial",
            Self::NotStarted => "not_started",
            Self::Cancelled => "cancelled",
            Self::Blocked => "blocked",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Priority {
    Low,
    Medium,
    High,
    Urgent,
}

impl Priority {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Urgent => "urgent",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskSource {
    Manual,
    AiAssistant,
}

impl TaskSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::AiAssistant => "ai_assistant",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DraftFieldState {
    FromDescription,
    AiOrganized,
    NeedsConfirmation,
    ManuallyEdited,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiProposal {
    pub proposal_id: String,
    pub operation: AiOperation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum AiOperation {
    ProposedTaskCreate {
        title: String,
        notes: Option<String>,
        priority: Option<Priority>,
        earliest_start_at: Option<String>,
        due_at: Option<String>,
        estimated_minutes: Option<i64>,
        splittable: Option<bool>,
    },
    ProposedTaskUpdate {
        task_id: String,
        title: Option<String>,
        priority: Option<Priority>,
        estimated_minutes: Option<i64>,
    },
    ProposedTaskComplete { task_id: String },
    ProposedTaskSoftDelete { task_ids: Vec<String>, precise_target_count: usize },
    ProposedPlan { plan_date: String, blocks: Vec<ProposedPlanBlock> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProposedPlanBlock {
    pub task_id: String,
    pub starts_at: String,
    pub ends_at: String,
    pub source: ProposalSource,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProposalSource {
    Ai,
    RuleBased,
}

impl ProposalSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ai => "ai",
            Self::RuleBased => "rule_based",
        }
    }
}

impl AiProposal {
    /// Typed deserialization is the local schema boundary. Unknown fields and unknown operation
    /// kinds are rejected before a proposal can enter the confirmation flow.
    pub fn parse_and_validate(raw: &str) -> AppResult<Self> {
        let proposal: Self = serde_json::from_str(raw)
            .map_err(|error| AppError::Schema(error.to_string()))?;
        proposal.validate_shape()?;
        Ok(proposal)
    }

    pub fn validate_shape(&self) -> AppResult<()> {
        if self.proposal_id.trim().is_empty() {
            return Err(AppError::Schema("proposal_id 不能为空".into()));
        }
        match &self.operation {
            AiOperation::ProposedTaskCreate {
                title,
                earliest_start_at,
                due_at,
                estimated_minutes,
                ..
            } => {
                validate_title(title)?;
                validate_optional_timestamp(earliest_start_at)?;
                validate_optional_timestamp(due_at)?;
                validate_estimate(*estimated_minutes)?;
            }
            AiOperation::ProposedTaskUpdate { task_id, title, priority, estimated_minutes } => {
                validate_id(task_id, "task_id")?;
                if title.is_none() && priority.is_none() && estimated_minutes.is_none() {
                    return Err(AppError::Schema("任务更新至少应包含一个可变字段".into()));
                }
                if let Some(title) = title { validate_title(title)?; }
                validate_estimate(*estimated_minutes)?;
            }
            AiOperation::ProposedTaskComplete { task_id } => validate_id(task_id, "task_id")?,
            AiOperation::ProposedTaskSoftDelete { task_ids, precise_target_count } => {
                if task_ids.is_empty() { return Err(AppError::Schema("删除目标不能为空".into())); }
                if task_ids.len() != *precise_target_count {
                    return Err(AppError::Schema("删除目标数量与精确数量不一致".into()));
                }
                let mut ids = task_ids.clone();
                ids.sort();
                ids.dedup();
                if ids.len() != task_ids.len() { return Err(AppError::Schema("删除目标不能重复".into())); }
                for id in task_ids { validate_id(id, "task_id")?; }
            }
            AiOperation::ProposedPlan { plan_date, blocks } => {
                chrono::NaiveDate::parse_from_str(plan_date, "%Y-%m-%d")
                    .map_err(|_| AppError::Schema("plan_date 必须为 YYYY-MM-DD".into()))?;
                if blocks.is_empty() { return Err(AppError::Schema("计划草案至少包含一个时间块".into())); }
                for block in blocks {
                    validate_id(&block.task_id, "task_id")?;
                    let starts_at = parse_shanghai_timestamp(&block.starts_at)?;
                    let ends_at = parse_shanghai_timestamp(&block.ends_at)?;
                    if ends_at <= starts_at {
                        return Err(AppError::Schema("时间块结束时间必须晚于开始时间".into()));
                    }
                    if (ends_at - starts_at).num_minutes() < MIN_TASK_BLOCK_MINUTES {
                        return Err(AppError::Schema(format!(
                            "普通任务块至少需要 {MIN_TASK_BLOCK_MINUTES} 分钟"
                        )));
                    }
                }
            }
        }
        Ok(())
    }
}

pub fn validate_title(title: &str) -> AppResult<()> {
    if title.trim().is_empty() || title.chars().count() > 300 {
        return Err(AppError::Schema("任务标题必须为 1 至 300 个字符".into()));
    }
    Ok(())
}

pub fn validate_id(value: &str, name: &str) -> AppResult<()> {
    if value.trim().is_empty() || value.chars().count() > 100 {
        return Err(AppError::Schema(format!("{name} 无效")));
    }
    Ok(())
}

pub fn validate_estimate(value: Option<i64>) -> AppResult<()> {
    if let Some(minutes) = value {
        if !(1..=24 * 60).contains(&minutes) {
            return Err(AppError::Schema("预计时长必须在 1 至 1440 分钟之间".into()));
        }
    }
    Ok(())
}

pub fn validate_workload(value: Option<i64>, field_name: &str, allow_zero: bool) -> AppResult<()> {
    if let Some(minutes) = value {
        let minimum = if allow_zero { 0 } else { 1 };
        if !(minimum..=525_600).contains(&minutes) {
            return Err(AppError::Schema(format!("{field_name}必须在 {minimum} 至 525600 分钟之间")));
        }
    }
    Ok(())
}

pub fn validate_optional_date(value: &Option<String>, field_name: &str) -> AppResult<()> {
    if let Some(value) = value {
        NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .map_err(|_| AppError::Schema(format!("{field_name}必须为 YYYY-MM-DD")))?;
    }
    Ok(())
}

pub fn validate_optional_time(
    value: &Option<String>,
    related_date: &Option<String>,
    field_name: &str,
) -> AppResult<()> {
    if let Some(value) = value {
        if related_date.is_none() {
            return Err(AppError::Schema(format!("{field_name}不能脱离日期单独保存")));
        }
        NaiveTime::parse_from_str(value, "%H:%M")
            .map_err(|_| AppError::Schema(format!("{field_name}必须为 HH:MM")))?;
    }
    Ok(())
}

pub fn validate_date_constraints(
    earliest_date: &Option<String>,
    earliest_time: &Option<String>,
    due_date: &Option<String>,
    due_time: &Option<String>,
) -> AppResult<()> {
    validate_optional_date(earliest_date, "最早开始日期")?;
    validate_optional_date(due_date, "截止日期")?;
    validate_optional_time(earliest_time, earliest_date, "最早开始时刻")?;
    validate_optional_time(due_time, due_date, "截止时刻")?;

    if let (Some(earliest_date), Some(due_date)) = (earliest_date, due_date) {
        let earliest = NaiveDate::parse_from_str(earliest_date, "%Y-%m-%d").expect("validated date");
        let due = NaiveDate::parse_from_str(due_date, "%Y-%m-%d").expect("validated date");
        if earliest > due {
            return Err(AppError::Domain("最早开始日期不能晚于截止日期".into()));
        }
        if earliest == due {
            if let (Some(earliest_time), Some(due_time)) = (earliest_time, due_time) {
                let earliest = NaiveTime::parse_from_str(earliest_time, "%H:%M").expect("validated time");
                let due = NaiveTime::parse_from_str(due_time, "%H:%M").expect("validated time");
                if (due - earliest).num_minutes() < MIN_TASK_BLOCK_MINUTES {
                    return Err(AppError::Domain(format!("同日任务至少需要 {MIN_TASK_BLOCK_MINUTES} 分钟")));
                }
            }
        }
    }
    Ok(())
}

pub fn validate_complete_task_schedule(
    earliest_date: &Option<String>,
    earliest_time: &Option<String>,
    due_date: &Option<String>,
    due_time: &Option<String>,
) -> AppResult<()> {
    validate_date_constraints(earliest_date, earliest_time, due_date, due_time)?;
    if earliest_date.is_none() || earliest_time.is_none() || due_date.is_none() || due_time.is_none() {
        return Err(AppError::Domain("任务开始和结束时间都必须填写；信息不完整时只能保存为草稿".into()));
    }
    Ok(())
}

pub fn validate_complete_task_timestamps(
    earliest_start_at: &Option<String>,
    due_at: &Option<String>,
) -> AppResult<()> {
    let earliest = earliest_start_at.as_deref()
        .ok_or_else(|| AppError::Domain("任务开始和结束时间都必须填写".into()))?;
    let due = due_at.as_deref()
        .ok_or_else(|| AppError::Domain("任务开始和结束时间都必须填写".into()))?;
    let earliest = parse_shanghai_timestamp(earliest)?;
    let due = parse_shanghai_timestamp(due)?;
    if due <= earliest {
        return Err(AppError::Domain("任务结束时间必须晚于开始时间".into()));
    }
    if earliest.date_naive() == due.date_naive() && (due - earliest).num_minutes() < MIN_TASK_BLOCK_MINUTES {
        return Err(AppError::Domain(format!("同日任务至少需要 {MIN_TASK_BLOCK_MINUTES} 分钟")));
    }
    Ok(())
}

pub fn validate_optional_timestamp(value: &Option<String>) -> AppResult<()> {
    if let Some(value) = value { parse_shanghai_timestamp(value)?; }
    Ok(())
}

pub fn parse_shanghai_timestamp(value: &str) -> AppResult<DateTime<FixedOffset>> {
    let timestamp = DateTime::parse_from_rfc3339(value)
        .map_err(|_| AppError::Schema("时间必须为含 +08:00 偏移的 RFC3339 格式".into()))?;
    if timestamp.offset().local_minus_utc() != SHANGHAI_OFFSET_SECONDS {
        return Err(AppError::Schema("v1 仅接受 Asia/Shanghai（+08:00）时间".into()));
    }
    Ok(timestamp)
}

#[cfg(test)]
mod tests {
    use super::AiProposal;
    use serde_json::json;

    #[test]
    fn priority_serialization_preserves_storage_values_and_null() {
        use super::Priority;
        for (priority, value) in [
            (Priority::Urgent, "urgent"), (Priority::High, "high"),
            (Priority::Medium, "medium"), (Priority::Low, "low"),
        ] {
            assert_eq!(priority.as_str(), value);
            assert_eq!(serde_json::to_value(priority).unwrap(), json!(value));
            assert_eq!(serde_json::from_value::<Priority>(json!(value)).unwrap(), priority);
        }
        assert_eq!(serde_json::from_value::<Option<Priority>>(json!(null)).unwrap(), None);
        assert_eq!(serde_json::to_value(None::<Priority>).unwrap(), json!(null));
        for invalid in ["P0", "P1", "critical", "", "URGENT"] {
            assert!(serde_json::from_value::<Priority>(json!(invalid)).is_err());
        }
    }

    fn proposed_plan(ends_at: &str) -> String {
        json!({
            "proposal_id": "minimum-task-block",
            "operation": {
                "type": "proposed_plan",
                "plan_date": "2026-09-08",
                "blocks": [{
                    "task_id": "task-1",
                    "starts_at": "2026-09-08T09:00:00+08:00",
                    "ends_at": ends_at,
                    "source": "ai"
                }]
            }
        }).to_string()
    }

    #[test]
    fn proposed_plan_enforces_fifteen_minute_task_block_minimum() {
        let too_short = AiProposal::parse_and_validate(&proposed_plan("2026-09-08T09:10:00+08:00"));
        assert!(too_short.unwrap_err().to_string().contains("至少需要 15 分钟"));

        AiProposal::parse_and_validate(&proposed_plan("2026-09-08T09:15:00+08:00"))
            .expect("15 分钟普通任务块应通过结构校验");
    }
}
