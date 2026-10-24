//! SQLite storage. All DB access lives on the Rust side; the UI only sees
//! Tauri commands.
//!
//! Migrations are plain SQL files applied in order and tracked with SQLite's
//! built-in `PRAGMA user_version`, so there is no extra migrations table.

mod household;
mod records;
mod settings;

use std::path::Path;

use rusqlite::types::Type;
use rusqlite::{Connection, OptionalExtension, Row};

pub use household::{clear_household, load_household, replace_household, save_assumptions, save_info};
pub use records::{
    delete_account, delete_debt, delete_income, delete_one_time_expense, delete_person, delete_scenario,
    upsert_account, upsert_debt, upsert_income, upsert_one_time_expense, upsert_person, upsert_scenario,
};
pub use settings::{BackupSettings, get_backup_settings, record_auto_backup, save_backup_settings};

/// Ordered migrations. Never edit a shipped entry; append a new one.
const MIGRATIONS: &[&str] = &[
    include_str!("../../migrations/0001_init.sql"),
    include_str!("../../migrations/0002_household_data.sql"),
    include_str!("../../migrations/0003_assumptions.sql"),
    include_str!("../../migrations/0004_simulation.sql"),
    include_str!("../../migrations/0005_scenarios.sql"),
    include_str!("../../migrations/0006_private_and_transfers.sql"),
    include_str!("../../migrations/0007_itemized_inputs.sql"),
    include_str!("../../migrations/0008_app_settings.sql"),
];

#[derive(Debug)]
pub enum Error {
    Sql(rusqlite::Error),
    /// User-facing validation message.
    Invalid(String),
    NotFound(&'static str),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Invalid(msg) => f.write_str(msg),
            Error::NotFound(what) => write!(f, "That {what} no longer exists. Try reopening the page."),
            Error::Sql(rusqlite::Error::SqliteFailure(e, _)) if e.code == rusqlite::ErrorCode::ConstraintViolation => {
                f.write_str("That change refers to something that no longer exists (for example, a deleted person).")
            }
            Error::Sql(e) => write!(f, "Database error: {e}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Error::Sql(e)
    }
}

pub type Result<T> = std::result::Result<T, Error>;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let mut conn = Connection::open(path)?;
    configure_and_migrate(&mut conn)?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_in_memory() -> rusqlite::Result<Connection> {
    let mut conn = Connection::open_in_memory()?;
    configure_and_migrate(&mut conn)?;
    Ok(conn)
}

fn configure_and_migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(conn)
}

pub fn schema_version(conn: &Connection) -> rusqlite::Result<u32> {
    conn.pragma_query_value(None, "user_version", |r| r.get(0))
}

fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    let current = schema_version(conn)? as usize;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as u32)?;
        tx.commit()?;
    }
    Ok(())
}

/// Reads a string column into one of the engine's string enums.
fn enum_col<T>(row: &Row, idx: usize, parse: fn(&str) -> Option<T>) -> rusqlite::Result<T> {
    let s: String = row.get(idx)?;
    parse(&s).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(idx, Type::Text, format!("unknown value '{s}'").into())
    })
}

/// Used by tests and future integrity checks.
#[allow(dead_code)]
pub fn table_exists(conn: &Connection, name: &str) -> rusqlite::Result<bool> {
    conn.query_row("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1", [name], |_| Ok(()))
        .optional()
        .map(|o| o.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_fresh_db_to_latest() {
        let conn = open_in_memory().unwrap();
        assert_eq!(schema_version(&conn).unwrap() as usize, MIGRATIONS.len());
        for t in ["household", "person", "account", "income_stream", "debt", "one_time_expense"] {
            assert!(table_exists(&conn, t).unwrap(), "missing table {t}");
        }
    }

    #[test]
    fn migrations_are_idempotent_on_reopen() {
        let dir = tempdir();
        let path = dir.join("test.sqlite");
        drop(open(&path).unwrap());
        let conn = open(&path).unwrap();
        assert_eq!(schema_version(&conn).unwrap() as usize, MIGRATIONS.len());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn upgrades_a_v1_database_and_keeps_its_data() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATIONS[0]).unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
        conn.execute("UPDATE household SET name = 'Old Name'", []).unwrap();

        configure_and_migrate(&mut conn).unwrap();
        let h = load_household(&conn).unwrap();
        assert_eq!(h.info.name, "Old Name");
        assert_eq!(h.info.filing_status, engine::model::FilingStatus::Single);
    }

    pub(crate) fn tempdir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "fsim-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}
