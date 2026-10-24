-- Phase 6: app settings (one row). Automatic backups go to `backup_folder` when `auto_backup` is 1.
CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    auto_backup INTEGER NOT NULL DEFAULT 0,
    backup_folder TEXT,
    last_auto_backup TEXT
);
INSERT INTO app_settings (id) VALUES (1);
