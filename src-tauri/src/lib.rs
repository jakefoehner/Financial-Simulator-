mod db;
mod demo;

use std::path::PathBuf;
use std::sync::Mutex;

use engine::model::{Account, Debt, Household, HouseholdInfo, Id, IncomeStream, OneTimeExpense, Person};
use rusqlite::Connection;
use serde::Serialize;
use tauri::{Manager, State};

struct AppState {
    conn: Mutex<Connection>,
    db_path: PathBuf,
}

/// Errors cross the IPC boundary as plain, user-facing strings.
type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Runs `f` with the DB connection, then returns the freshly loaded household,
/// so the UI always renders exactly what's stored.
fn mutate(state: &State<AppState>, f: impl FnOnce(&mut Connection) -> db::Result<()>) -> CmdResult<Household> {
    let mut conn = state.conn.lock().map_err(err)?;
    f(&mut conn).map_err(err)?;
    db::load_household(&conn).map_err(err)
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
fn get_household(state: State<AppState>) -> CmdResult<Household> {
    let conn = state.conn.lock().map_err(err)?;
    db::load_household(&conn).map_err(err)
}

#[tauri::command]
fn save_household_info(state: State<AppState>, info: HouseholdInfo) -> CmdResult<Household> {
    mutate(&state, |c| db::save_info(c, &info))
}

#[tauri::command]
fn load_demo(state: State<AppState>, which: demo::Demo) -> CmdResult<Household> {
    mutate(&state, |c| db::replace_household(c, &demo::household(which)))
}

#[tauri::command]
fn clear_household(state: State<AppState>) -> CmdResult<Household> {
    mutate(&state, db::clear_household)
}

#[tauri::command]
fn upsert_person(state: State<AppState>, person: Person) -> CmdResult<Household> {
    mutate(&state, |c| db::upsert_person(c, &person).map(drop))
}

#[tauri::command]
fn delete_person(state: State<AppState>, id: Id) -> CmdResult<Household> {
    mutate(&state, |c| db::delete_person(c, id))
}

#[tauri::command]
fn upsert_account(state: State<AppState>, account: Account) -> CmdResult<Household> {
    mutate(&state, |c| db::upsert_account(c, &account).map(drop))
}

#[tauri::command]
fn delete_account(state: State<AppState>, id: Id) -> CmdResult<Household> {
    mutate(&state, |c| db::delete_account(c, id))
}

#[tauri::command]
fn upsert_income(state: State<AppState>, income: IncomeStream) -> CmdResult<Household> {
    mutate(&state, |c| db::upsert_income(c, &income).map(drop))
}

#[tauri::command]
fn delete_income(state: State<AppState>, id: Id) -> CmdResult<Household> {
    mutate(&state, |c| db::delete_income(c, id))
}

#[tauri::command]
fn upsert_debt(state: State<AppState>, debt: Debt) -> CmdResult<Household> {
    mutate(&state, |c| db::upsert_debt(c, &debt).map(drop))
}

#[tauri::command]
fn delete_debt(state: State<AppState>, id: Id) -> CmdResult<Household> {
    mutate(&state, |c| db::delete_debt(c, id))
}

#[tauri::command]
fn upsert_one_time_expense(state: State<AppState>, expense: OneTimeExpense) -> CmdResult<Household> {
    mutate(&state, |c| db::upsert_one_time_expense(c, &expense).map(drop))
}

#[tauri::command]
fn delete_one_time_expense(state: State<AppState>, id: Id) -> CmdResult<Household> {
    mutate(&state, |c| db::delete_one_time_expense(c, id))
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
        .invoke_handler(tauri::generate_handler![
            app_info,
            get_household,
            save_household_info,
            load_demo,
            clear_household,
            upsert_person,
            delete_person,
            upsert_account,
            delete_account,
            upsert_income,
            delete_income,
            upsert_debt,
            delete_debt,
            upsert_one_time_expense,
            delete_one_time_expense,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
