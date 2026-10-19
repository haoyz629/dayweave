use super::*;

pub(super) const MAX_GLOBAL_TAGS: usize = 50;
pub(super) const MAX_TASK_TAGS: usize = 10;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TaskTagDefinition {
    pub name: String,
    pub color: u8,
}

pub(super) fn validate_selection(tags: &[String], previous: &[String]) -> AppResult<Vec<String>> {
    let normalized = normalize_tags(tags)?;
    let previous: HashSet<String> = previous.iter().map(|tag| tag.trim().to_lowercase()).collect();
    if normalized.len() > MAX_TASK_TAGS && normalized.iter().any(|tag| !previous.contains(&tag.to_lowercase())) {
        return Err(AppError::Schema("每个任务最多使用 10 个标签".into()));
    }
    Ok(normalized)
}

// Callers own the transaction: limits, colors and task/draft writes commit together.
pub(super) fn register_tags(transaction: &Transaction<'_>, tags: &[String]) -> AppResult<Vec<String>> {
    let mut statement = transaction.prepare("SELECT id, name FROM tags")?;
    let mut catalog = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    let mut ids = Vec::new();
    for name in normalize_tags(tags)? {
        if let Some((id, _)) = catalog.iter().find(|(_, existing)| existing.to_lowercase() == name.to_lowercase()) {
            ids.push(id.clone());
            continue;
        }
        if catalog.len() >= MAX_GLOBAL_TAGS {
            return Err(AppError::Domain("标签数量已达上限（50 个）".into()));
        }
        let id = Uuid::new_v4().to_string();
        let color = Uuid::new_v4().as_bytes()[0] % 8;
        transaction.execute("INSERT INTO tags (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, color, now()])?;
        catalog.push((id.clone(), name));
        ids.push(id);
    }
    Ok(ids)
}

impl Database {
    pub fn list_tag_catalog(&self) -> AppResult<Vec<TaskTagDefinition>> {
        let mut statement = self.connection.prepare("SELECT name, color FROM tags ORDER BY name COLLATE NOCASE")?;
        let tags = statement.query_map([], |row| Ok(TaskTagDefinition { name: row.get(0)?, color: row.get(1)? }))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(tags)
    }

    pub fn create_tag(&mut self, name: &str) -> AppResult<TaskTagDefinition> {
        let values = normalize_tags(&[name.to_string()])?;
        if values.is_empty() { return Err(AppError::Schema("标签名称不能为空".into())); }
        let transaction = self.connection.transaction()?;
        let ids = register_tags(&transaction, &values)?;
        let tag = transaction.query_row("SELECT name, color FROM tags WHERE id = ?1", [&ids[0]],
            |row| Ok(TaskTagDefinition { name: row.get(0)?, color: row.get(1)? }))?;
        transaction.commit()?;
        Ok(tag)
    }
}
