use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("数据库错误：{0}")]
    Database(#[from] rusqlite::Error),
    #[error("{0}")]
    Schema(String),
    #[error("{0}")]
    Domain(String),
    #[error("{0}")]
    NotFound(String),
    #[error("操作确认无效或已过期")]
    InvalidConfirmation,
    #[error("序列化错误：{0}")]
    Json(#[from] serde_json::Error),
}

pub type AppResult<T> = Result<T, AppError>;
