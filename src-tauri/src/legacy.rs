//! One-time compatibility boundary for installations made before the Dayweave rename.
//! Keep old identifiers here, not in current product names or storage paths.

use std::{error::Error, fs, io, path::{Path, PathBuf}};
use rusqlite::{Connection, DatabaseName, OpenFlags};
use uuid::Uuid;

type MigrationResult<T> = Result<T, Box<dyn Error>>;
const LEGACY_IDENTIFIER: &str = "com.jinxu.desktop";
const LEGACY_DATABASE: &str = "jinxu.sqlite3";
pub const DATABASE_NAME: &str = "dayweave.sqlite3";
pub const AUTOSTART_NAME: &str = "今序 · Dayweave";

fn legacy_directory(current: &Path) -> io::Result<PathBuf> {
    current.parent().map(|parent| parent.join(LEGACY_IDENTIFIER))
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "应用数据目录缺少父目录"))
}

/// SQLite's online backup includes committed WAL pages. Never copy only the main file.
/// Publish only a complete snapshot, never replace an existing Dayweave database,
/// and leave the source intact so a failed migration can be retried safely.
pub fn migrate_database(current: &Path) -> MigrationResult<()> {
    let destination = current.join(DATABASE_NAME);
    if destination.exists() { return Ok(()); }
    let legacy = legacy_directory(current)?.join(LEGACY_DATABASE);
    if !legacy.try_exists()? { return Ok(()); }
    fs::create_dir_all(current)?;
    let staging = current.join(format!(".database-migration-{}", Uuid::new_v4()));
    fs::create_dir(&staging)?;
    let result = (|| -> MigrationResult<()> {
        let source = Connection::open_with_flags(&legacy, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let snapshot = staging.join(DATABASE_NAME);
        source.backup(DatabaseName::Main, &snapshot, None)?;
        // A hard link publishes atomically and refuses to clobber a concurrent creation.
        fs::hard_link(&snapshot, &destination)?;
        Ok(())
    })();
    let cleanup = fs::remove_dir_all(&staging);
    result?;
    cleanup?;
    Ok(())
}

fn copy_directory(source: &Path, destination: &Path) -> io::Result<()> {
    fs::create_dir(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_dir() {
            copy_directory(&entry.path(), &destination.join(entry.file_name()))?;
        } else if kind.is_file() {
            fs::copy(entry.path(), destination.join(entry.file_name()))?;
        } else {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "旧本地存储包含不支持的链接"));
        }
    }
    Ok(())
}

/// Called before creating the WebView. Only localStorage needs copying: persisted
/// application facts/settings already live in SQLite; browser caches are not user data.
/// A locked old profile fails visibly rather than starting with a partial copy.
pub fn migrate_local_storage(current: &Path) -> MigrationResult<()> {
    let relative = Path::new("EBWebView").join("Default").join("Local Storage");
    let destination = current.join(&relative);
    if destination.exists() { return Ok(()); }
    let source = legacy_directory(current)?.join(&relative);
    if !source.try_exists()? { return Ok(()); }
    let parent = destination.parent().ok_or("本地存储目录缺少父目录")?;
    fs::create_dir_all(parent)?;
    let staging = parent.join(format!(".storage-migration-{}", Uuid::new_v4()));
    let result = copy_directory(&source, &staging).and_then(|_| fs::rename(&staging, &destination));
    if result.is_err() && staging.exists() { let _ = fs::remove_dir_all(&staging); }
    result?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn database_migration_includes_wal_preserves_source_and_does_not_overwrite() {
        let root = tempfile::tempdir().unwrap();
        let old = root.path().join(LEGACY_IDENTIFIER);
        fs::create_dir(&old).unwrap();
        let source = Connection::open(old.join(LEGACY_DATABASE)).unwrap();
        source.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE facts(value TEXT); INSERT INTO facts VALUES ('task and secret settings');").unwrap();
        let current = root.path().join("com.dayweave.desktop");
        migrate_database(&current).unwrap();
        let target = Connection::open(current.join(DATABASE_NAME)).unwrap();
        assert_eq!(target.query_row("SELECT value FROM facts", [], |row| row.get::<_, String>(0)).unwrap(), "task and secret settings");
        target.execute("UPDATE facts SET value='new data'", []).unwrap();
        migrate_database(&current).unwrap();
        assert_eq!(target.query_row("SELECT value FROM facts", [], |row| row.get::<_, String>(0)).unwrap(), "new data");
        assert_eq!(source.query_row("SELECT value FROM facts", [], |row| row.get::<_, String>(0)).unwrap(), "task and secret settings");
    }

    #[test]
    fn failed_database_migration_leaves_no_destination_and_can_retry() {
        let root = tempfile::tempdir().unwrap();
        let old = root.path().join(LEGACY_IDENTIFIER);
        fs::create_dir(&old).unwrap();
        let source = old.join(LEGACY_DATABASE);
        fs::write(&source, "not a database").unwrap();
        let current = root.path().join("com.dayweave.desktop");
        assert!(migrate_database(&current).is_err());
        assert!(!current.join(DATABASE_NAME).exists());
        assert_eq!(fs::read_dir(&current).unwrap().count(), 0);
        fs::remove_file(&source).unwrap();
        Connection::open(&source).unwrap().execute_batch("CREATE TABLE facts(value TEXT);").unwrap();
        migrate_database(&current).unwrap();
        assert!(current.join(DATABASE_NAME).exists());
    }

    #[test]
    fn fresh_install_does_not_create_legacy_or_empty_migration_files() {
        let root = tempfile::tempdir().unwrap();
        let current = root.path().join("com.dayweave.desktop");
        migrate_database(&current).unwrap();
        migrate_local_storage(&current).unwrap();
        assert!(!current.exists());
        assert!(!root.path().join(LEGACY_IDENTIFIER).exists());
    }

    #[test]
    fn local_storage_is_copied_before_webview_without_overwriting_new_data() {
        let root = tempfile::tempdir().unwrap();
        let relative = Path::new("EBWebView/Default/Local Storage/leveldb");
        let old = root.path().join(LEGACY_IDENTIFIER).join(relative);
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("000001.log"), "old draft").unwrap();
        let current = root.path().join("com.dayweave.desktop");
        migrate_local_storage(&current).unwrap();
        let copied = current.join(relative).join("000001.log");
        assert_eq!(fs::read_to_string(&copied).unwrap(), "old draft");
        fs::write(&copied, "new draft").unwrap();
        migrate_local_storage(&current).unwrap();
        assert_eq!(fs::read_to_string(&copied).unwrap(), "new draft");
        assert_eq!(fs::read_to_string(old.join("000001.log")).unwrap(), "old draft");
    }
}
