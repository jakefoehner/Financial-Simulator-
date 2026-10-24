mod backup;
mod db;
mod demo;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use engine::model::{
    Account, Assumptions, Debt, Household, HouseholdInfo, Id, IncomeStream, OneTimeExpense, Person, Scenario,
};
use engine::montecarlo::{self, ScenarioDetail, Simulation};
use engine::projection::{self, ClaimAgeOutcome, Projection};
use engine::solver::{self, SafeGiftRequest, SafeGiftResult};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, RunEvent, State};

struct AppState {
    conn: Mutex<Connection>,
    db_path: PathBuf,
    /// Safety copies go here when automatic backups are off.
    app_data_dir: PathBuf,
    auto: Mutex<AutoBackup>,
    /// Recent range-of-outcomes results, keyed by a hash of (household, plan, start year),
    /// so switching between plans or comparing them doesn't re-run.
    simulation_cache: Mutex<Vec<(u64, Arc<Simulation>)>>,
}

const SIMULATION_CACHE_SIZE: usize = 8;
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Automatic backups are written at most this often while editing (and always at quit).
const AUTO_BACKUP_INTERVAL: Duration = Duration::from_secs(5 * 60);

#[derive(Default)]
struct AutoBackup {
    last_written: Option<Instant>,
    /// Changed since the last automatic backup.
    dirty: bool,
    last_error: Option<String>,
}

/// (RFC 3339 time for the file, sortable stamp for its name), in local time.
fn now_stamps() -> (String, String) {
    let now = chrono::Local::now();
    (now.to_rfc3339_opts(chrono::SecondsFormat::Secs, false), now.format("%Y-%m-%d %H-%M-%S").to_string())
}

/// Writes a dated, unencrypted backup of the stored household into `folder` (keeping the newest 10).
fn write_dated_backup(conn: &Connection, folder: &Path) -> Result<PathBuf, String> {
    let h = db::load_household(conn).map_err(err)?;
    let (at, stamp) = now_stamps();
    let path = backup::write_auto(folder, &backup::encode(&h, None, APP_VERSION, &at), &stamp)
        .map_err(|e| format!("Couldn't write an automatic backup to {}: {e}", folder.display()))?;
    db::record_auto_backup(conn, &at).map_err(err)?;
    Ok(path)
}

/// Writes an automatic backup if they're turned on and one is due (`force`: write now if anything changed).
fn auto_backup(state: &AppState, conn: &Connection, force: bool) {
    let Ok(settings) = db::get_backup_settings(conn) else { return };
    let (true, Some(folder)) = (settings.auto_backup, settings.backup_folder) else { return };
    let Ok(mut auto) = state.auto.lock() else { return };
    let due = auto.dirty && (force || auto.last_written.is_none_or(|t| t.elapsed() >= AUTO_BACKUP_INTERVAL));
    if !due {
        return;
    }
    match write_dated_backup(conn, Path::new(&folder)) {
        Ok(_) => {
            auto.last_written = Some(Instant::now());
            auto.dirty = false;
            auto.last_error = None;
        }
        Err(e) => auto.last_error = Some(e),
    }
}

/// Before replacing everything (restore, demo, clear): save what's there now, to the backup
/// folder if automatic backups are on, else to "Safety copies" in the app's data folder.
fn safety_copy(state: &AppState, conn: &Connection) -> Result<(), String> {
    let h = db::load_household(conn).map_err(err)?;
    if h.people.is_empty() && h.accounts.is_empty() {
        return Ok(());
    }
    let settings = db::get_backup_settings(conn).map_err(err)?;
    let folder = match (settings.auto_backup, settings.backup_folder) {
        (true, Some(f)) => PathBuf::from(f),
        _ => state.app_data_dir.join("Safety copies"),
    };
    write_dated_backup(conn, &folder).map(drop)
}

fn cache_key(h: &Household, scenario: Option<Id>, start_year: i32) -> u64 {
    let mut hasher = DefaultHasher::new();
    serde_json::to_string(h).unwrap_or_default().hash(&mut hasher);
    scenario.hash(&mut hasher);
    start_year.hash(&mut hasher);
    hasher.finish()
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
    if let Ok(mut auto) = state.auto.lock() {
        auto.dirty = true;
    }
    auto_backup(state, &conn, false);
    db::load_household(&conn).map_err(err)
}

/// Like `mutate`, for changes that replace all data: keeps a safety copy first.
fn replace_all(state: &State<AppState>, f: impl FnOnce(&mut Connection) -> db::Result<()>) -> CmdResult<Household> {
    {
        let conn = state.conn.lock().map_err(err)?;
        safety_copy(state, &conn)
            .map_err(|e| format!("Nothing was changed: couldn't save a safety copy first. {e}"))?;
    }
    mutate(state, f)
}

/// Adds ".fsim" when the name has no extension.
fn with_extension(path: &str) -> PathBuf {
    let p = PathBuf::from(path);
    if p.extension().is_some() { p } else { p.with_extension(backup::EXTENSION) }
}

#[tauri::command]
fn save_backup(state: State<AppState>, path: String, password: Option<String>) -> CmdResult<()> {
    let conn = state.conn.lock().map_err(err)?;
    let h = db::load_household(&conn).map_err(err)?;
    let (at, _) = now_stamps();
    let bytes = backup::encode(&h, password.as_deref(), APP_VERSION, &at);
    backup::write_atomic(&with_extension(&path), &bytes).map_err(|e| format!("Couldn't save the backup: {e}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupPreview {
    needs_password: bool,
    info: Option<backup::BackupInfo>,
}

fn read_backup_file(path: &str) -> CmdResult<Vec<u8>> {
    std::fs::read(path).map_err(|e| format!("Couldn't open that file: {e}"))
}

/// What's in a backup, before restoring it. Asks for a password if it has one.
#[tauri::command]
fn inspect_backup(path: String, password: Option<String>) -> CmdResult<BackupPreview> {
    let bytes = read_backup_file(&path)?;
    match backup::decode(&bytes, password.as_deref()) {
        Ok((_, info)) => Ok(BackupPreview { needs_password: false, info: Some(info) }),
        Err(backup::BackupError::NeedsPassword) => Ok(BackupPreview { needs_password: true, info: None }),
        Err(e) => Err(e.to_string()),
    }
}

/// Replaces all data with the backup's, after saving a safety copy of the current data.
#[tauri::command]
fn restore_backup(state: State<AppState>, path: String, password: Option<String>) -> CmdResult<Household> {
    let bytes = read_backup_file(&path)?;
    let (h, _) = backup::decode(&bytes, password.as_deref()).map_err(err)?;
    replace_all(&state, |c| db::replace_household(c, &h))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupStatus {
    settings: db::BackupSettings,
    /// Why the last automatic backup failed, if it did.
    last_error: Option<String>,
    /// Where to suggest putting automatic backups.
    suggested_folder: String,
}

fn backup_status(app: &tauri::AppHandle, state: &AppState, conn: &Connection) -> CmdResult<BackupStatus> {
    let suggested = app
        .path()
        .document_dir()
        .map(|d| d.join("Finance Simulator backups").display().to_string())
        .unwrap_or_default();
    Ok(BackupStatus {
        settings: db::get_backup_settings(conn).map_err(err)?,
        last_error: state.auto.lock().ok().and_then(|a| a.last_error.clone()),
        suggested_folder: suggested,
    })
}

#[tauri::command]
fn get_backup_settings(app: tauri::AppHandle, state: State<AppState>) -> CmdResult<BackupStatus> {
    let conn = state.conn.lock().map_err(err)?;
    backup_status(&app, &state, &conn)
}

/// Saves the automatic-backup switch and folder; turning it on writes one right away.
#[tauri::command]
fn save_backup_settings(
    app: tauri::AppHandle,
    state: State<AppState>,
    settings: db::BackupSettings,
) -> CmdResult<BackupStatus> {
    let conn = state.conn.lock().map_err(err)?;
    db::save_backup_settings(&conn, &settings).map_err(err)?;
    if settings.auto_backup {
        if let Ok(mut auto) = state.auto.lock() {
            auto.dirty = true;
        }
        auto_backup(&state, &conn, true);
    }
    backup_status(&app, &state, &conn)
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
fn save_assumptions(state: State<AppState>, assumptions: Assumptions) -> CmdResult<Household> {
    mutate(&state, |c| db::save_assumptions(c, &assumptions))
}

/// Current-law gift/estate figures and family-loan rates, from engine/tax_tables, for form hints.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TaxFacts {
    tax_year: i32,
    annual_exclusion: f64,
    exemption: f64,
    afr_month: String,
    afr_short_term: f64,
    afr_mid_term: f64,
    afr_long_term: f64,
    section_7520: f64,
}

#[tauri::command]
fn tax_facts() -> TaxFacts {
    let t = engine::tax_tables::TaxTables::current();
    TaxFacts {
        tax_year: t.year,
        annual_exclusion: t.estate_gift.annual_exclusion,
        exemption: t.estate_gift.exemption,
        afr_month: t.afr.month.clone(),
        afr_short_term: t.afr.short_term,
        afr_mid_term: t.afr.mid_term,
        afr_long_term: t.afr.long_term,
        section_7520: t.afr.section_7520,
    }
}

#[tauri::command]
fn save_scenario(state: State<AppState>, scenario: Scenario) -> CmdResult<Household> {
    mutate(&state, |c| db::upsert_scenario(c, &scenario).map(drop))
}

#[tauri::command]
fn delete_scenario(state: State<AppState>, id: Id) -> CmdResult<Household> {
    mutate(&state, |c| db::delete_scenario(c, id))
}

/// `start_year` comes from the UI's clock so results match what the user sees as "this year".
/// `scenario` is a plan id; `None` is the base plan.
#[tauri::command]
fn run_projection(state: State<AppState>, start_year: i32, scenario: Option<Id>) -> CmdResult<Projection> {
    let household = get_household(state)?;
    projection::project(&household, scenario, start_year).map_err(err)
}

#[tauri::command]
fn compare_claim_ages(
    state: State<AppState>,
    start_year: i32,
    scenario: Option<Id>,
) -> CmdResult<Vec<ClaimAgeOutcome>> {
    let household = get_household(state)?;
    projection::compare_claim_ages(&household, scenario, start_year).map_err(err)
}

/// Runs the range of outcomes off the main thread; reuses a recent result if nothing changed.
#[tauri::command]
async fn run_simulation(
    state: State<'_, AppState>,
    start_year: i32,
    scenario: Option<Id>,
) -> CmdResult<Arc<Simulation>> {
    let household = {
        let conn = state.conn.lock().map_err(err)?;
        db::load_household(&conn).map_err(err)?
    };
    let key = cache_key(&household, scenario, start_year);
    if let Some((_, sim)) = state.simulation_cache.lock().map_err(err)?.iter().find(|(k, _)| *k == key) {
        return Ok(sim.clone());
    }
    let sim = tauri::async_runtime::spawn_blocking(move || montecarlo::simulate(&household, scenario, start_year))
        .await
        .map_err(err)?
        .map_err(err)?;
    let sim = Arc::new(sim);
    let mut cache = state.simulation_cache.lock().map_err(err)?;
    cache.insert(0, (key, sim.clone()));
    cache.truncate(SIMULATION_CACHE_SIZE);
    Ok(sim)
}

#[tauri::command]
async fn scenario_detail(
    state: State<'_, AppState>,
    start_year: i32,
    path_index: usize,
    scenario: Option<Id>,
) -> CmdResult<ScenarioDetail> {
    let household = {
        let conn = state.conn.lock().map_err(err)?;
        db::load_household(&conn).map_err(err)?
    };
    tauri::async_runtime::spawn_blocking(move || {
        montecarlo::scenario_detail(&household, scenario, start_year, path_index)
    })
    .await
    .map_err(err)?
    .map_err(err)
}

/// "How much can I safely give?" for a plan (`None` = base plan).
#[tauri::command]
async fn safe_gift(
    state: State<'_, AppState>,
    start_year: i32,
    scenario: Option<Id>,
    request: SafeGiftRequest,
) -> CmdResult<SafeGiftResult> {
    let household = {
        let conn = state.conn.lock().map_err(err)?;
        db::load_household(&conn).map_err(err)?
    };
    tauri::async_runtime::spawn_blocking(move || solver::safe_gift(&household, scenario, start_year, request))
        .await
        .map_err(err)?
        .map_err(err)
}

#[tauri::command]
fn load_demo(state: State<AppState>, which: demo::Demo) -> CmdResult<Household> {
    replace_all(&state, |c| db::replace_household(c, &demo::household(which)))
}

#[tauri::command]
fn clear_household(state: State<AppState>) -> CmdResult<Household> {
    replace_all(&state, db::clear_household)
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
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("household.sqlite");
            let conn = db::open(&db_path)?;
            app.manage(AppState {
                conn: Mutex::new(conn),
                db_path,
                app_data_dir: dir,
                auto: Mutex::new(AutoBackup::default()),
                simulation_cache: Mutex::new(Vec::new()),
            });
            Ok(())
        })
        .menu(app_menu)
        // File-menu choices are handled by the UI (they open its dialogs).
        .on_menu_event(|app, event| {
            let _ = app.emit("menu", event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            get_household,
            save_household_info,
            save_assumptions,
            tax_facts,
            save_scenario,
            delete_scenario,
            run_projection,
            compare_claim_ages,
            run_simulation,
            scenario_detail,
            safe_gift,
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
            save_backup,
            inspect_backup,
            restore_backup,
            get_backup_settings,
            save_backup_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Last automatic backup of anything changed since the previous one.
            if let RunEvent::Exit = event {
                let state = app.state::<AppState>();
                if let Ok(conn) = state.conn.lock() {
                    auto_backup(&state, &conn, true);
                }
            }
        });
}

/// The standard Mac menus, plus Save Backup… / Open Backup… in File.
fn app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let sep = || PredefinedMenuItem::separator(app);
    let about = Submenu::with_items(
        app,
        "Finance Simulator",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "save_backup", "Save Backup…", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "open_backup", "Open Backup…", true, Some("CmdOrCtrl+O"))?,
            &sep()?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::fullscreen(app, None)?],
    )?;
    Menu::with_items(app, &[&about, &file, &edit, &window])
}
