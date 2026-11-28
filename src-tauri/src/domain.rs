use chrono::{DateTime, FixedOffset, NaiveDate, TimeZone, Utc};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub const SHANGHAI_OFFSET_SECONDS: i32 = 8 * 60 * 60;
pub const MIN_DURATION_MINUTES: i64 = 15;
pub const MAX_DURATION_MINUTES: i64 = 24 * 60;

pub fn shanghai_offset() -> FixedOffset {
    FixedOffset::east_opt(SHANGHAI_OFFSET_SECONDS).expect("valid +08:00 offset")
}

pub fn shanghai_now() -> DateTime<FixedOffset> {
    Utc::now().with_timezone(&shanghai_offset())
}

pub fn shanghai_today_str() -> String {
    shanghai_now().format("%Y-%m-%d").to_string()
}

pub fn now_rfc3339() -> String {
    shanghai_now().to_rfc3339()
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ScheduleMode {
    Pool,
    Flex,
    Timeline,
}

impl ScheduleMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pool => "pool",
            Self::Flex => "flex",
            Self::Timeline => "timeline",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "pool" => Ok(Self::Pool),
            "flex" => Ok(Self::Flex),
            "timeline" => Ok(Self::Timeline),
            _ => Err(AppError::Schema(format!("未知排程形态：{value}"))),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TagColor {
    Blue,
    Indigo,
    Emerald,
    Amber,
    Rose,
}

impl TagColor {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Blue => "blue",
            Self::Indigo => "indigo",
            Self::Emerald => "emerald",
            Self::Amber => "amber",
            Self::Rose => "rose",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "blue" => Ok(Self::Blue),
            "indigo" => Ok(Self::Indigo),
            "emerald" => Ok(Self::Emerald),
            "amber" => Ok(Self::Amber),
            "rose" => Ok(Self::Rose),
            _ => Err(AppError::Schema(format!("未知标签颜色：{value}"))),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Priority {
    #[serde(rename = "")]
    None,
    #[serde(rename = "P1")]
    P1,
    #[serde(rename = "P2")]
    P2,
}

impl Default for Priority {
    fn default() -> Self {
        Self::None
    }
}

impl Priority {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "",
            Self::P1 => "P1",
            Self::P2 => "P2",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "" => Ok(Self::None),
            "P1" | "p1" => Ok(Self::P1),
            "P2" | "p2" => Ok(Self::P2),
            _ => Err(AppError::Schema(format!("未知优先级：{value}"))),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RecurrenceFrequency {
    Daily,
    Weekdays,
    Weekly,
    Monthly,
}

impl RecurrenceFrequency {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Daily => "daily",
            Self::Weekdays => "weekdays",
            Self::Weekly => "weekly",
            Self::Monthly => "monthly",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "daily" => Ok(Self::Daily),
            "weekdays" => Ok(Self::Weekdays),
            "weekly" => Ok(Self::Weekly),
            "monthly" => Ok(Self::Monthly),
            _ => Err(AppError::Schema(format!("未知重复频率：{value}"))),
        }
    }
}

pub fn validate_title(title: &str) -> AppResult<String> {
    let trimmed = title.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 200 {
        return Err(AppError::Schema("标题长度必须为 1 至 200 个字符".into()));
    }
    Ok(trimmed.to_string())
}

pub fn validate_tag_name(name: &str) -> AppResult<String> {
    let cleaned = name.trim().trim_start_matches('#').trim();
    if cleaned.is_empty() || cleaned.chars().count() > 24 {
        return Err(AppError::Schema("标签名称必须为 1 至 24 个字符".into()));
    }
    Ok(cleaned.to_string())
}

pub fn validate_date(value: &str, field: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| AppError::Schema(format!("{field} 必须为 YYYY-MM-DD 格式")))
}

pub fn clamp_start_min(start_min: i64) -> i64 {
    start_min.clamp(0, 24 * 60 - MIN_DURATION_MINUTES)
}

pub fn clamp_duration(duration: i64) -> i64 {
    duration.clamp(MIN_DURATION_MINUTES, MAX_DURATION_MINUTES)
}

pub fn minutes_to_rfc3339(date: &str, minutes: i64) -> AppResult<String> {
    let d = validate_date(date, "日期")?;
    let clamped = minutes.clamp(0, 24 * 60);
    let offset = shanghai_offset();
    if clamped == 24 * 60 {
        let next = d.succ_opt().ok_or_else(|| AppError::Schema("日期溢出".into()))?;
        let dt = offset
            .from_local_datetime(&next.and_hms_opt(0, 0, 0).expect("valid midnight"))
            .single()
            .ok_or_else(|| AppError::Schema("无法构造结束时间".into()))?;
        return Ok(dt.to_rfc3339());
    }
    let hour = (clamped / 60) as u32;
    let min = (clamped % 60) as u32;
    let dt = offset
        .from_local_datetime(&d.and_hms_opt(hour, min, 0).expect("valid hms"))
        .single()
        .ok_or_else(|| AppError::Schema("无法构造时间戳".into()))?;
    Ok(dt.to_rfc3339())
}
