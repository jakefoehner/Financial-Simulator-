//! "How much can I safely give?": the largest gift (split evenly between the
//! children) that keeps the chance the money lasts at or above a target.
//!
//! Every trial amount runs the *same* replayed-history scenarios (same seeds), so
//! a bigger gift can never look safer by luck, and odds fall smoothly as the gift
//! grows, which makes a binary search reliable.

use serde::{Deserialize, Serialize};

use crate::history;
use crate::model::{Event, Household, Id, Role};
use crate::montecarlo::{self, Simulation};
use crate::projection::{self, ProjectionError};
use crate::tax_tables::TaxTables;

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeGiftRequest {
    /// `false` = one gift now; `true` = the same gift every year for `years` years.
    pub yearly: bool,
    pub years: u32,
    /// Chance the money lasts to keep, e.g. 0.95.
    pub target: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeGiftPoint {
    /// Today's dollars, each time a gift is made.
    pub per_child: f64,
    pub total: f64,
    pub money_lasts: f64,
    pub family_total_p50: f64,
    pub estate_tax_p50: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeGiftResult {
    pub target: f64,
    pub yearly: bool,
    pub years: u32,
    pub age: u32,
    pub children: u32,
    /// The plan's odds with no extra gift.
    pub base_money_lasts: f64,
    /// False when the plan is already below the target without any extra gift.
    pub achievable: bool,
    /// Largest safe gift to each child (each time, in today's dollars) and in total.
    pub max_per_child: f64,
    pub max_total: f64,
    /// Odds and outcomes at the answer, using the full number of scenarios.
    pub at_max: SafeGiftPoint,
    /// Odds and outcomes across a range of gift sizes, for the trade-off chart.
    pub curve: Vec<SafeGiftPoint>,
}

/// Fewer scenarios while searching; the answer is re-checked with the full count.
const SEARCH_SCENARIOS: usize = 1_000;
const SEARCH_STEPS: usize = 16;
const CURVE_POINTS: usize = 9;

pub fn safe_gift(
    h: &Household,
    scenario: Option<Id>,
    start_year: i32,
    req: SafeGiftRequest,
) -> Result<SafeGiftResult, ProjectionError> {
    let kids = h.people.iter().filter(|p| p.role == Role::Child).count() as u32;
    if kids == 0 {
        return Err(ProjectionError::Invalid("Add your children on the People page first.".into()));
    }
    let primary = h.people.iter().find(|p| p.role == Role::Primary).ok_or(ProjectionError::NoPrimaryPerson)?;
    let age = (start_year - primary.birth_year).max(0) as u32;
    let years = if req.yearly { req.years.clamp(1, 60) } else { 1 };
    let base_events = projection::events_for(h, scenario)?;
    let table = history::centered(&h.assumptions);
    let t = TaxTables::current();
    let full = h.assumptions.simulations as usize;
    let search = SEARCH_SCENARIOS.min(full);

    let run = |per_child: f64, scenarios: usize| -> Result<Simulation, ProjectionError> {
        let mut events = base_events.clone();
        if per_child > 0.0 {
            events.push(Event::CashGift {
                to: None,
                amount: per_child,
                from_age: age,
                years,
                max_annual_exclusion: false,
            });
        }
        montecarlo::simulate_with(h, &events, start_year, t, &table, scenarios)
    };
    let point = |per_child: f64, sim: &Simulation| SafeGiftPoint {
        per_child,
        total: per_child * kids as f64 * years as f64,
        money_lasts: sim.money_lasts,
        family_total_p50: sim.estate.family_total_real.p50,
        estate_tax_p50: sim.estate.estate_tax_real.p50,
    };

    let base = run(0.0, search)?;
    // Upper bound: everything spendable today, spread over the gifts.
    let upper = (base.starting_investable / (kids as f64 * years as f64)).max(0.0);
    let ok = |sim: &Simulation| sim.money_lasts >= req.target;

    let (mut lo, mut hi) = (0.0, upper);
    let achievable = ok(&base);
    if achievable {
        if ok(&run(hi, search)?) {
            lo = hi;
        } else {
            for _ in 0..SEARCH_STEPS {
                let mid = (lo + hi) / 2.0;
                if ok(&run(mid, search)?) {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
        }
    }
    // Round down to a tidy amount, then confirm with the full number of scenarios.
    let step = if req.yearly { 1_000.0 } else { 10_000.0 };
    let mut answer = (lo / step).floor() * step;
    let mut at = run(answer, full)?;
    while achievable && answer > 0.0 && !ok(&at) {
        answer = (answer - step).max(0.0);
        at = run(answer, full)?;
    }

    let span = if answer > 0.0 { answer * 1.5 } else { upper * 0.25 };
    let mut curve = Vec::with_capacity(CURVE_POINTS);
    for k in 0..CURVE_POINTS {
        let per_child = span * k as f64 / (CURVE_POINTS - 1) as f64;
        curve.push(point(per_child, &run(per_child, search)?));
    }

    Ok(SafeGiftResult {
        target: req.target,
        yearly: req.yearly,
        years,
        age,
        children: kids,
        base_money_lasts: run(0.0, full)?.money_lasts,
        achievable,
        max_per_child: answer,
        max_total: answer * kids as f64 * years as f64,
        at_max: point(answer, &at),
        curve,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Account, AccountType, HouseholdInfo, Person};

    fn household(balance: f64, spending: f64) -> Household {
        let person = |id: Id, name: &str, birth_year: i32, role: Role| Person {
            id: Some(id),
            name: name.into(),
            birth_year,
            role,
            life_expectancy: 95,
            ss_monthly_benefit: None,
            ss_claim_age: 67,
            ss_already_claiming: false,
        };
        Household {
            info: HouseholdInfo { base_annual_spending: spending, ..Default::default() },
            people: vec![
                person(1, "Pat", 1968, Role::Primary),
                person(2, "Sam", 1995, Role::Child),
                person(3, "Jordan", 1998, Role::Child),
            ],
            accounts: vec![Account {
                id: Some(1),
                name: "Brokerage".into(),
                account_type: AccountType::Taxable,
                owner_id: Some(1),
                balance,
                cost_basis: Some(balance),
                stocks_pct: 0.6,
                bonds_pct: 0.4,
                cash_pct: 0.0,
                annual_contribution: 0.0,
                employer_match: 0.0,
                notes: String::new(),
                private: None,
                holdings: Vec::new(),
            }],
            assumptions: crate::model::Assumptions { simulations: 400, ..Default::default() },
            ..Default::default()
        }
    }

    #[test]
    fn finds_the_largest_gift_that_keeps_the_target() {
        let h = household(8_000_000.0, 200_000.0);
        let req = SafeGiftRequest { yearly: false, years: 1, target: 0.95 };
        let r = safe_gift(&h, None, 2026, req).unwrap();
        assert!(r.achievable && r.max_per_child > 0.0, "{r:?}");
        assert!(r.at_max.money_lasts >= 0.95);
        // A bit more than the answer drops below the target (same scenarios).
        let more = r.max_per_child + 250_000.0;
        let curve_above: Vec<_> = r.curve.iter().filter(|p| p.per_child >= more).collect();
        assert!(curve_above.iter().all(|p| p.money_lasts < 0.95 + 0.02));
        // Odds never rise as the gift grows.
        assert!(r.curve.windows(2).all(|w| w[1].money_lasts <= w[0].money_lasts + 1e-12));
        assert_eq!(r.max_total, r.max_per_child * 2.0);
    }

    #[test]
    fn yearly_gifts_are_smaller_each_time() {
        let h = household(8_000_000.0, 200_000.0);
        let once = safe_gift(&h, None, 2026, SafeGiftRequest { yearly: false, years: 1, target: 0.95 }).unwrap();
        let yearly = safe_gift(&h, None, 2026, SafeGiftRequest { yearly: true, years: 10, target: 0.95 }).unwrap();
        assert!(yearly.max_per_child < once.max_per_child);
        assert_eq!(yearly.years, 10);
    }

    #[test]
    fn says_so_when_the_plan_is_already_below_the_target() {
        let h = household(1_000_000.0, 200_000.0);
        let r = safe_gift(&h, None, 2026, SafeGiftRequest { yearly: false, years: 1, target: 0.95 }).unwrap();
        assert!(!r.achievable);
        assert_eq!(r.max_per_child, 0.0);
    }
}
