use super::*;

/// Rebuild only the two CHECK constraints, keeping the live schema's columns and constraints.
/// Foreign keys must be disabled outside the transaction: dropping a parent with them enabled
/// would run cascades/SET NULL even if foreign-key checking were deferred.
pub(super) fn migrate(connection: &mut Connection, version: i64) -> AppResult<()> {
    if !connection.is_autocommit() {
        return Err(AppError::Schema("优先级迁移不能在已有事务中运行".into()));
    }
    let foreign_keys: bool = connection.pragma_query_value(None, "foreign_keys", |row| row.get(0))?;
    let legacy_alter_table: bool = connection.pragma_query_value(None, "legacy_alter_table", |row| row.get(0))?;
    connection.pragma_update(None, "foreign_keys", false)?;
    let result = (|| -> AppResult<()> {
        // Leave references in views, triggers and child tables pointing at the original names.
        connection.pragma_update(None, "legacy_alter_table", true)?;
        let transaction = connection.transaction()?;
        let objects = {
            let mut statement = transaction.prepare(
                "SELECT name, sql FROM sqlite_master WHERE tbl_name IN ('tasks','task_drafts')
                 AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type, name",
            )?;
            let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        for table in ["tasks", "task_drafts"] {
            let definition: String = transaction.query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table], |row| row.get(0),
            )?;
            const OLD: &str = "CHECK(priority IN ('low','medium','high'))";
            const NEW: &str = "CHECK(priority IN ('low','medium','high','urgent'))";
            // Also tolerate an already-upgraded table when a migration marker is restored/replayed.
            if !definition.contains(OLD) && definition.matches(NEW).count() == 1 { continue; }
            if definition.matches(OLD).count() != 1 {
                return Err(AppError::Schema(format!("{table} 的优先级约束与迁移预期不符")));
            }
            let start = definition.find('(').ok_or_else(|| AppError::Schema(format!("{table} 缺少表定义")))?;
            let replacement = format!("{table}_priority_new");
            transaction.execute_batch(&format!(
                "CREATE TABLE {replacement} {}", definition[start..].replacen(OLD, NEW, 1),
            ))?;
            let columns = {
                let mut statement = transaction.prepare(&format!("PRAGMA table_info({table})"))?;
                let rows = statement.query_map([], |row| row.get::<_, String>(1))?
                    .collect::<Result<Vec<_>, _>>()?;
                rows.into_iter().map(|name| format!("\"{}\"", name.replace('"', "\"\"")))
                    .collect::<Vec<_>>().join(",")
            };
            transaction.execute_batch(&format!(
                "INSERT INTO {replacement} (rowid,{columns}) SELECT rowid,{columns} FROM {table};
                 DROP TABLE {table};
                 ALTER TABLE {replacement} RENAME TO {table};",
            ))?;
        }
        for (name, definition) in objects {
            let exists: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = ?1)", [&name], |row| row.get(0),
            )?;
            if !exists { transaction.execute_batch(&definition)?; }
        }
        let invalid_references = transaction.prepare("PRAGMA foreign_key_check")?.exists([])?;
        if invalid_references {
            return Err(AppError::Schema("优先级迁移后的外键检查失败，已回滚".into()));
        }
        transaction.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            params![version, now()],
        )?;
        transaction.commit()?;
        Ok(())
    })();
    // The transaction has committed or rolled back before either connection setting is restored.
    let restore_legacy = connection.pragma_update(None, "legacy_alter_table", legacy_alter_table);
    let restore_foreign_keys = connection.pragma_update(None, "foreign_keys", foreign_keys);
    result?;
    restore_legacy?;
    restore_foreign_keys?;
    Ok(())
}

#[cfg(test)]
#[path = "database_priority_tests.rs"]
mod tests;
