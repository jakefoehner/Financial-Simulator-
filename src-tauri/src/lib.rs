mod db;
mod demo;

use std::path::PathBuf;
use std::sync::Mutex;

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
use tauri::{Manager, State};

struct AppState {
    conn: Mutex<Connection>,
    db_path: PathBuf,
    /// Recent range-of-outcomes results, keyed by a hash of (household, plan, start year),
    /// so switching between plans or comparing them doesn't re-run.
    simulation_cache: Mutex<Vec<(u64, Arc<Simulation>)>>,
}

const SIMULATION_CACHE_SIZE: usize = 8;

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
            app.manage(AppState { conn: Mutex::new(conn), db_path, simulation_cache: Mutex::new(Vec::new()) });
            Ok(())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
