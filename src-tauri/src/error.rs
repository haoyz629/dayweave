use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("数据库错误：{0}")]
    Database(#[from] rusqlite::Error),
    #[error("结构化操作无效：{0}")]
    Schema(String),
    #[error("领域规则不允许此操作：{0}")]
    Domain(String),
    #[error("找不到指定对象：{0}")]
    NotFound(String),
    #[error("操作确认无效或已过期")]
    InvalidConfirmation,
    #[error("序列化错误：{0}")]
    Json(#[from] serde_json::Error),
}

pub type AppResult<T> = Result<T, AppError>;
