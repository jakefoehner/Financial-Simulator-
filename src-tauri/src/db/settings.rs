//! App settings that aren't part of the household (and so aren't in backups).

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use super::Result;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettings {
    pub auto_backup: bool,
    /// Folder for automatic backups; `None` until one is chosen.
    pub backup_folder: Option<String>,
    /// When the last automatic backup was written (RFC 3339).
    pub last_auto_backup: Option<String>,
}

pub fn get_backup_settings(conn: &Connection) -> Result<BackupSettings> {
    Ok(conn.query_row(
        "SELECT auto_backup, backup_folder, last_auto_backup FROM app_settings WHERE id = 1",
        [],
        |r| Ok(BackupSettings { auto_backup: r.get(0)?, backup_folder: r.get(1)?, last_auto_backup: r.get(2)? }),
    )?)
}

/// Saves the on/off switch and folder (the last-backup time is kept).
pub fn save_backup_settings(conn: &Connection, s: &BackupSettings) -> Result<()> {
    if s.auto_backup && s.backup_folder.as_deref().is_none_or(|f| f.trim().is_empty()) {
        return Err(super::Error::Invalid("Choose a folder for automatic backups first.".into()));
    }
    conn.execute(
        "UPDATE app_settings SET auto_backup = ?1, backup_folder = ?2 WHERE id = 1",
        params![s.auto_backup, s.backup_folder],
    )?;
    Ok(())
}

pub fn record_auto_backup(conn: &Connection, at: &str) -> Result<()> {
    conn.execute("UPDATE app_settings SET last_auto_backup = ?1 WHERE id = 1", [at])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn settings_round_trip() {
        let conn = open_in_memory().unwrap();
        assert_eq!(get_backup_settings(&conn).unwrap(), BackupSettings::default());
        assert!(save_backup_settings(&conn, &BackupSettings { auto_backup: true, ..Default::default() }).is_err());
        let s = BackupSettings { auto_backup: true, backup_folder: Some("/tmp/x".into()), last_auto_backup: None };
        save_backup_settings(&conn, &s).unwrap();
        record_auto_backup(&conn, "2026-10-24T14:30:00-05:00").unwrap();
        let back = get_backup_settings(&conn).unwrap();
        assert!(back.auto_backup);
        assert_eq!(back.backup_folder.as_deref(), Some("/tmp/x"));
        assert_eq!(back.last_auto_backup.as_deref(), Some("2026-10-24T14:30:00-05:00"));
    }
}
