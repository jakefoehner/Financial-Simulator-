//! SQLite storage. All DB access lives on the Rust side; the UI only sees
//! Tauri commands.
//!
//! Migrations are plain SQL files applied in order and tracked with SQLite's
//! built-in `PRAGMA user_version`, so there is no extra migrations table.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

/// Ordered migrations. Never edit a shipped entry; append a new one.
const MIGRATIONS: &[&str] = &[include_str!("../migrations/0001_init.sql")];

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Household {
    pub name: String,
    pub state: String,
    pub flat_state_rate: f64,
    pub updated_at: String,
}

pub fn get_household(conn: &Connection) -> rusqlite::Result<Household> {
    conn.query_row("SELECT name, state, flat_state_rate, updated_at FROM household WHERE id = 1", [], |r| {
        Ok(Household { name: r.get(0)?, state: r.get(1)?, flat_state_rate: r.get(2)?, updated_at: r.get(3)? })
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HouseholdUpdate {
    pub name: Option<String>,
    pub state: Option<String>,
    pub flat_state_rate: Option<f64>,
}

pub fn update_household(conn: &Connection, u: &HouseholdUpdate) -> rusqlite::Result<Household> {
    conn.execute(
        "UPDATE household SET
             name            = COALESCE(?1, name),
             state           = COALESCE(?2, state),
             flat_state_rate = COALESCE(?3, flat_state_rate),
             updated_at      = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = 1",
        params![u.name, u.state, u.flat_state_rate],
    )?;
    get_household(conn)
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
        assert!(table_exists(&conn, "household").unwrap());
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
    fn household_round_trip() {
        let conn = open_in_memory().unwrap();
        let h = get_household(&conn).unwrap();
        assert_eq!(h.name, "My Household");
        assert_eq!(h.state, "TX");

        let h = update_household(
            &conn,
            &HouseholdUpdate { name: Some("Foehner Family".into()), state: None, flat_state_rate: None },
        )
        .unwrap();
        assert_eq!(h.name, "Foehner Family");
        assert_eq!(h.state, "TX");
    }

    fn tempdir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "fsim-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}
