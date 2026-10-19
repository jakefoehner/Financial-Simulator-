mod db;

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use serde::Serialize;
use tauri::{Manager, State};

struct AppState {
    conn: Mutex<Connection>,
    db_path: PathBuf,
}

/// Errors cross the IPC boundary as plain strings.
type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    app_version: String,
    engine_version: String,
    db_path: String,
    schema_version: u32,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle, state: State<AppState>) -> CmdResult<AppInfo> {
    let conn = state.conn.lock().map_err(err)?;
    Ok(AppInfo {
        app_version: app.package_info().version.to_string(),
        engine_version: engine::VERSION.to_string(),
        db_path: state.db_path.display().to_string(),
        schema_version: db::schema_version(&conn).map_err(err)?,
    })
}

#[tauri::command]
fn get_household(state: State<AppState>) -> CmdResult<db::Household> {
    let conn = state.conn.lock().map_err(err)?;
    db::get_household(&conn).map_err(err)
}

#[tauri::command]
fn update_household(state: State<AppState>, update: db::HouseholdUpdate) -> CmdResult<db::Household> {
    let conn = state.conn.lock().map_err(err)?;
    db::update_household(&conn, &update).map_err(err)
}

/// Phase 0 smoke test of the engine: fixed-return drawdown of one portfolio.
#[tauri::command]
fn preview_projection(
    start_balance: f64,
    allocation: engine::Allocation,
    annual_spend: f64,
    years: u32,
) -> Vec<engine::YearRow> {
    engine::project_fixed(start_balance, allocation, &engine::FixedReturns::default(), annual_spend, years.min(100))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("household.sqlite");
            let conn = db::open(&db_path)?;
            app.manage(AppState { conn: Mutex::new(conn), db_path });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![app_info, get_household, update_household, preview_projection])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
