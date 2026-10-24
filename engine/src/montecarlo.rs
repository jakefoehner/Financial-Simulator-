//! Range of outcomes: thousands of scenarios replaying real market history
//! (centered on the household's assumptions, see `history.rs`) through the
//! same yearly projection as the steady path.
//!
//! Each scenario has its own seed derived from its index, so results are
//! identical run to run and regardless of how many threads run them.

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use rayon::prelude::*;
use serde::Serialize;

use crate::history::{self, CenteredYear, HistoricalYear};
use crate::model::{AccountType, Event, Household, Id};
use crate::projection::{self, MarketYear, PrivateOutcomes, Projection, ProjectionError};
use crate::tax_tables::TaxTables;

const BASE_SEED: u64 = 0x5EED_2026_1023;

/// What one startup returns, as a multiple of what was invested, and how often.
/// A planning assumption in the spirit of venture-capital data: most companies return
/// less than they raised and a few return many times. Results are scaled so the
/// average equals the multiple the user expects.
pub const STARTUP_OUTCOMES: [(f64, f64); 6] =
    [(0.0, 0.55), (0.5, 0.15), (1.0, 0.10), (3.0, 0.10), (10.0, 0.07), (30.0, 0.03)];
/// Private credit: chance of a default in any year, and the share of principal it costs.
pub const CREDIT_DEFAULT_CHANCE: f64 = 0.03;
pub const CREDIT_DEFAULT_LOSS: f64 = 0.25;

fn startup_mean() -> f64 {
    STARTUP_OUTCOMES.iter().map(|(m, p)| m * p).sum()
}

/// One scenario's private-investment luck: each startup account's payout (relative to
/// its expected multiple, averaged over its companies) and each year's credit defaults.
fn draw_private_outcomes(rng: &mut impl Rng, h: &Household, horizon: usize) -> PrivateOutcomes {
    let mean = startup_mean();
    let startup_multiplier = h
        .accounts
        .iter()
        .map(|a| match (&a.private, a.account_type) {
            (Some(terms), AccountType::Startup) => {
                let n = terms.companies.max(1);
                let total: f64 = (0..n)
                    .map(|_| {
                        let mut u: f64 = rng.random();
                        STARTUP_OUTCOMES
                            .iter()
                            .find(|(_, p)| {
                                u -= p;
                                u < 0.0
                            })
                            .map_or(STARTUP_OUTCOMES[5].0, |(m, _)| *m)
                    })
                    .sum();
                total / n as f64 / mean
            }
            _ => 1.0,
        })
        .collect();
    let credit_loss = (0..horizon)
        .map(|_| if rng.random::<f64>() < CREDIT_DEFAULT_CHANCE { CREDIT_DEFAULT_LOSS } else { 0.0 })
        .collect();
    PrivateOutcomes { startup_multiplier, credit_loss }
}

fn path_rng(index: usize) -> ChaCha8Rng {
    ChaCha8Rng::seed_from_u64(BASE_SEED ^ (index as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15))
}

/// 10th/25th/50th/75th/90th percentile per plan year.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bands {
    pub p10: Vec<f64>,
    pub p25: Vec<f64>,
    pub p50: Vec<f64>,
    pub p75: Vec<f64>,
    pub p90: Vec<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ScenarioKind {
    Worst,
    Rough,
    Typical,
    Strong,
}

/// A scenario picked to represent part of the range, for zooming in.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Representative {
    pub kind: ScenarioKind,
    pub path_index: usize,
    pub ending_investable_real: f64,
    pub runs_out_at_age: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Simulation {
    pub scenarios: usize,
    pub ages: Vec<u32>,
    pub years: Vec<i32>,
    pub starting_investable: f64,
    /// Share of scenarios (0–1) where spending is always paid.
    pub money_lasts: f64,
    /// Share where spendable savings end at or above today's, in today's dollars.
    pub lives_off_growth: f64,
    /// Share still able to pay spending at each age.
    pub still_on_track: Vec<f64>,
    pub investable_real: Bands,
    pub investable_nominal: Bands,
    pub net_worth_real: Bands,
    pub net_worth_nominal: Bands,
    pub representatives: Vec<Representative>,
    pub estate: EstateRange,
}

/// 10th / 50th / 90th percentile of one number across scenarios.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Spread {
    pub p10: f64,
    pub p50: f64,
    pub p90: f64,
}

impl Spread {
    fn of(mut xs: Vec<f64>) -> Spread {
        xs.sort_by(f64::total_cmp);
        Spread { p10: percentile(&xs, 0.1), p50: percentile(&xs, 0.5), p90: percentile(&xs, 0.9) }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildRange {
    pub child_id: Option<Id>,
    pub name: String,
    pub total_real: Spread,
}

/// What the estate and family look like across scenarios (today's dollars).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EstateRange {
    pub age: u32,
    pub estate_tax_real: Spread,
    pub family_total_real: Spread,
    pub children: Vec<ChildRange>,
}

/// Compact per-scenario results; full detail is re-computed on demand.
struct PathOutcome {
    investable_real: Vec<f64>,
    investable_nominal: Vec<f64>,
    net_worth_real: Vec<f64>,
    net_worth_nominal: Vec<f64>,
    runs_out_at: Option<usize>,
    runs_out_at_age: Option<u32>,
    estate_tax_real: f64,
    family_total_real: f64,
    child_totals_real: Vec<f64>,
}

impl PathOutcome {
    fn ending_investable_real(&self) -> f64 {
        *self.investable_real.last().unwrap_or(&0.0)
    }

    /// Ranks scenarios worst → best: running out (earlier is worse) beats any ending balance.
    fn rank_key(&self) -> f64 {
        match self.runs_out_at {
            Some(i) => i as f64 - 1e15,
            None => self.ending_investable_real(),
        }
    }
}

fn scenario_market(table: &[CenteredYear], picks: &[usize]) -> impl Fn(usize) -> MarketYear {
    move |n| table[picks[n]].market
}

fn run_path(
    h: &Household,
    events: &[Event],
    start_year: i32,
    t: &TaxTables,
    table: &[CenteredYear],
    horizon: usize,
    index: usize,
) -> Result<(Projection, Vec<usize>), ProjectionError> {
    let mut rng = path_rng(index);
    let picks = history::sample_path(&mut rng, table.len(), horizon);
    let outcomes = draw_private_outcomes(&mut rng, h, horizon);
    let proj = projection::project_market(h, events, start_year, t, &outcomes, scenario_market(table, &picks))?;
    Ok((proj, picks))
}

/// Runs `h.assumptions.simulations` scenarios of the plan `scenario` (`None` = base plan).
pub fn simulate(h: &Household, scenario: Option<Id>, start_year: i32) -> Result<Simulation, ProjectionError> {
    let table = history::centered(&h.assumptions);
    let events = projection::events_for(h, scenario)?;
    simulate_with(h, &events, start_year, TaxTables::current(), &table, h.assumptions.simulations as usize)
}

pub fn simulate_with(
    h: &Household,
    events: &[Event],
    start_year: i32,
    t: &TaxTables,
    table: &[CenteredYear],
    scenarios: usize,
) -> Result<Simulation, ProjectionError> {
    let horizon = projection::horizon_years(h, start_year)?;
    let outcomes: Vec<PathOutcome> = (0..scenarios)
        .into_par_iter()
        .map(|i| {
            let (p, _) = run_path(h, events, start_year, t, table, horizon, i)?;
            let runs_out_at = p.years.iter().position(|y| y.shortfall > 1.0);
            Ok(PathOutcome {
                investable_real: p.years.iter().map(|y| y.investable_real()).collect(),
                investable_nominal: p.years.iter().map(|y| y.balances.investable()).collect(),
                net_worth_real: p.years.iter().map(|y| y.net_worth_real()).collect(),
                net_worth_nominal: p.years.iter().map(|y| y.net_worth).collect(),
                runs_out_at,
                runs_out_at_age: runs_out_at.map(|i| p.years[i].age),
                estate_tax_real: p.summary.estate.estate_tax_real,
                family_total_real: p.summary.estate.family_total_real,
                child_totals_real: p.summary.estate.children.iter().map(|c| c.total_real).collect(),
            })
        })
        .collect::<Result<_, ProjectionError>>()?;

    // Ages/years and the starting point are the same in every scenario; take them from the steady path.
    let steady = projection::project_market(h, events, start_year, t, &PrivateOutcomes::default(), |_| {
        MarketYear::steady(&h.assumptions)
    })?;
    let starting = steady.summary.starting_investable;
    let n = scenarios.max(1) as f64;

    let mut ranked: Vec<usize> = (0..outcomes.len()).collect();
    ranked.sort_by(|&a, &b| outcomes[a].rank_key().total_cmp(&outcomes[b].rank_key()));
    let pick = |kind: ScenarioKind, q: f64| {
        let i = ranked[((ranked.len() - 1) as f64 * q).round() as usize];
        Representative {
            kind,
            path_index: i,
            ending_investable_real: outcomes[i].ending_investable_real(),
            runs_out_at_age: outcomes[i].runs_out_at_age,
        }
    };
    let representatives = if outcomes.is_empty() {
        Vec::new()
    } else {
        vec![
            pick(ScenarioKind::Worst, 0.0),
            pick(ScenarioKind::Rough, 0.1),
            pick(ScenarioKind::Typical, 0.5),
            pick(ScenarioKind::Strong, 0.9),
        ]
    };

    Ok(Simulation {
        scenarios,
        ages: steady.years.iter().map(|y| y.age).collect(),
        years: steady.years.iter().map(|y| y.year).collect(),
        starting_investable: starting,
        money_lasts: outcomes.iter().filter(|o| o.runs_out_at.is_none()).count() as f64 / n,
        lives_off_growth: outcomes
            .iter()
            .filter(|o| o.runs_out_at.is_none() && o.ending_investable_real() >= starting * 0.999)
            .count() as f64
            / n,
        still_on_track: (0..horizon)
            .map(|y| outcomes.iter().filter(|o| o.runs_out_at.is_none_or(|r| r > y)).count() as f64 / n)
            .collect(),
        investable_real: bands(&outcomes, horizon, |o| &o.investable_real),
        investable_nominal: bands(&outcomes, horizon, |o| &o.investable_nominal),
        net_worth_real: bands(&outcomes, horizon, |o| &o.net_worth_real),
        net_worth_nominal: bands(&outcomes, horizon, |o| &o.net_worth_nominal),
        representatives,
        estate: EstateRange {
            age: steady.summary.estate.age,
            estate_tax_real: Spread::of(outcomes.iter().map(|o| o.estate_tax_real).collect()),
            family_total_real: Spread::of(outcomes.iter().map(|o| o.family_total_real).collect()),
            children: steady
                .summary
                .estate
                .children
                .iter()
                .enumerate()
                .map(|(k, c)| ChildRange {
                    child_id: c.child_id,
                    name: c.name.clone(),
                    total_real: Spread::of(outcomes.iter().map(|o| o.child_totals_real[k]).collect()),
                })
                .collect(),
        },
    })
}

fn bands(outcomes: &[PathOutcome], horizon: usize, series: impl Fn(&PathOutcome) -> &Vec<f64>) -> Bands {
    let mut b = Bands::default();
    let mut column = Vec::with_capacity(outcomes.len());
    for y in 0..horizon {
        column.clear();
        column.extend(outcomes.iter().map(|o| series(o)[y]));
        column.sort_by(f64::total_cmp);
        b.p10.push(percentile(&column, 0.10));
        b.p25.push(percentile(&column, 0.25));
        b.p50.push(percentile(&column, 0.50));
        b.p75.push(percentile(&column, 0.75));
        b.p90.push(percentile(&column, 0.90));
    }
    b
}

/// Linear-interpolated percentile of an ascending slice.
pub fn percentile(sorted: &[f64], q: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let pos = q.clamp(0.0, 1.0) * (sorted.len() - 1) as f64;
    let (lo, hi) = (pos.floor() as usize, pos.ceil() as usize);
    sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo as f64)
}

/// One replayed year inside a scenario, for the "market history" strip.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayedYear {
    pub year: i32,
    pub age: u32,
    /// The real calendar year whose markets this year replays.
    pub source_year: i32,
    pub actual: HistoricalYear,
    pub adjusted: MarketYear,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioDetail {
    pub path_index: usize,
    pub projection: Projection,
    pub replayed: Vec<ReplayedYear>,
}

/// Re-runs one scenario in full: every year's results plus what it replayed.
pub fn scenario_detail(
    h: &Household,
    scenario: Option<Id>,
    start_year: i32,
    path_index: usize,
) -> Result<ScenarioDetail, ProjectionError> {
    let table = history::centered(&h.assumptions);
    let events = projection::events_for(h, scenario)?;
    let horizon = projection::horizon_years(h, start_year)?;
    let (projection, picks) = run_path(h, &events, start_year, TaxTables::current(), &table, horizon, path_index)?;
    let replayed = projection
        .years
        .iter()
        .zip(&picks)
        .map(|(y, &i)| ReplayedYear {
            year: y.year,
            age: y.age,
            source_year: table[i].actual.year,
            actual: table[i].actual,
            adjusted: table[i].market,
        })
        .collect();
    Ok(ScenarioDetail { path_index, projection, replayed })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Account, AccountType, HouseholdInfo, Person, Role};

    fn retiree(spending: f64) -> Household {
        Household {
            info: HouseholdInfo { base_annual_spending: spending, ..Default::default() },
            people: vec![Person {
                id: Some(1),
                name: "Pat".into(),
                birth_year: 1959,
                role: Role::Primary,
                life_expectancy: 95,
                ss_monthly_benefit: Some(3_000.0),
                ss_claim_age: 70,
                ss_already_claiming: false,
            }],
            accounts: vec![Account {
                id: Some(1),
                name: "Brokerage".into(),
                account_type: AccountType::Taxable,
                owner_id: Some(1),
                balance: 2_000_000.0,
                cost_basis: Some(1_200_000.0),
                stocks_pct: 0.6,
                bonds_pct: 0.4,
                cash_pct: 0.0,
                annual_contribution: 0.0,
                employer_match: 0.0,
                notes: String::new(),
                private: None,
            }],
            ..Default::default()
        }
    }

    fn run(h: &Household, n: usize) -> Simulation {
        let table = history::centered(&h.assumptions);
        simulate_with(h, &[], 2026, TaxTables::current(), &table, n).unwrap()
    }

    #[test]
    fn startup_outcomes_are_mostly_losses_with_a_few_big_wins() {
        let total: f64 = STARTUP_OUTCOMES.iter().map(|(_, p)| p).sum();
        assert!((total - 1.0).abs() < 1e-12);
        let below_cost: f64 = STARTUP_OUTCOMES.iter().filter(|(m, _)| *m < 1.0).map(|(_, p)| p).sum();
        assert!((below_cost - 0.70).abs() < 1e-12);
        // Draws average to 1.0 (relative to the expected multiple) over many companies.
        let mut h = retiree(0.0);
        h.accounts[0].account_type = AccountType::Startup;
        h.accounts[0].private = Some(crate::model::PrivateTerms {
            companies: 20_000,
            ..crate::model::PrivateTerms::default_for(AccountType::Startup, 2026)
        });
        let o = draw_private_outcomes(&mut path_rng(1), &h, 10);
        assert!((o.startup_multiplier[0] - 1.0).abs() < 0.05, "{}", o.startup_multiplier[0]);
        let one = crate::model::PrivateTerms { companies: 1, ..h.accounts[0].private.clone().unwrap() };
        h.accounts[0].private = Some(one);
        let zeros =
            (0..1000).filter(|&i| draw_private_outcomes(&mut path_rng(i), &h, 1).startup_multiplier[0] == 0.0).count();
        assert!((450..650).contains(&zeros), "a single startup is a total loss about 55% of the time ({zeros})");
    }

    #[test]
    fn percentile_interpolates() {
        let xs = [1.0, 2.0, 3.0, 4.0, 5.0];
        assert_eq!(percentile(&xs, 0.0), 1.0);
        assert_eq!(percentile(&xs, 0.5), 3.0);
        assert_eq!(percentile(&xs, 0.1), 1.4);
        assert_eq!(percentile(&xs, 1.0), 5.0);
    }

    #[test]
    fn flat_history_reproduces_the_steady_path() {
        // Every "historical" year equals the assumptions → every scenario is the steady path.
        let h = retiree(90_000.0);
        let flat: Vec<CenteredYear> = history::table()
            .iter()
            .map(|y| CenteredYear { actual: *y, market: MarketYear::steady(&h.assumptions) })
            .collect();
        let sim = simulate_with(&h, &[], 2026, TaxTables::current(), &flat, 20).unwrap();
        let steady = projection::project(&h, None, 2026).unwrap();
        for (i, y) in steady.years.iter().enumerate() {
            assert!((sim.investable_real.p10[i] - y.investable_real()).abs() < 1e-6);
            assert!((sim.investable_real.p90[i] - y.investable_real()).abs() < 1e-6);
        }
        assert_eq!(sim.money_lasts, if steady.summary.runs_out_at_age.is_none() { 1.0 } else { 0.0 });
    }

    #[test]
    fn results_are_reproducible_and_thread_independent() {
        let h = retiree(90_000.0);
        let a = run(&h, 200);
        let b = rayon::ThreadPoolBuilder::new().num_threads(1).build().unwrap().install(|| run(&h, 200));
        assert_eq!(a, b);
    }

    #[test]
    fn spending_more_lowers_the_odds() {
        let low = run(&retiree(70_000.0), 300);
        let high = run(&retiree(160_000.0), 300);
        assert!(low.money_lasts > high.money_lasts, "{} vs {}", low.money_lasts, high.money_lasts);
        assert!(high.money_lasts < 1.0);
        // Bands are ordered at every age.
        for i in 0..low.ages.len() {
            let b = &low.investable_real;
            assert!(b.p10[i] <= b.p25[i] && b.p25[i] <= b.p50[i] && b.p50[i] <= b.p75[i] && b.p75[i] <= b.p90[i]);
        }
        // The share still on track never rises with age.
        assert!(high.still_on_track.windows(2).all(|w| w[1] <= w[0]));
    }

    #[test]
    fn representatives_are_ordered_and_detail_matches() {
        let h = retiree(110_000.0);
        let sim = run(&h, 300);
        let kinds: Vec<_> = sim.representatives.iter().map(|r| r.kind).collect();
        assert_eq!(kinds, [ScenarioKind::Worst, ScenarioKind::Rough, ScenarioKind::Typical, ScenarioKind::Strong]);
        let typical = &sim.representatives[2];
        let detail = scenario_detail(&h, None, 2026, typical.path_index).unwrap();
        let last = detail.projection.years.last().unwrap();
        assert!((last.investable_real() - typical.ending_investable_real).abs() < 1e-6);
        // Replayed years come in runs of consecutive real years.
        assert!(detail.replayed[..5].windows(2).all(|w| w[1].source_year == w[0].source_year + 1));
    }

    #[test]
    #[ignore]
    fn perf_5000_scenarios() {
        // cargo test -p engine --release perf_5000 -- --ignored --nocapture
        let h = retiree(110_000.0);
        let start = std::time::Instant::now();
        let sim = run(&h, 5_000);
        println!("5,000 scenarios in {:?}; money lasts {:.1}%", start.elapsed(), sim.money_lasts * 100.0);
    }
}
