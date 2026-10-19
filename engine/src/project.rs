//! Deterministic ("Fixed" return mode) yearly projection.
//!
//! Phase 0 keeps this to a single portfolio with a stock/bond/cash mix and a
//! flat inflation-adjusted withdrawal. Phase 2 grows it into the full yearly
//! loop (income, contributions, RMDs, taxes, events).

use serde::{Deserialize, Serialize};

/// Annual nominal returns per asset class, plus inflation. Rates are decimals (0.07 = 7%).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct FixedReturns {
    pub stocks: f64,
    pub bonds: f64,
    pub cash: f64,
    pub inflation: f64,
}

impl Default for FixedReturns {
    fn default() -> Self {
        Self { stocks: 0.07, bonds: 0.04, cash: 0.02, inflation: 0.025 }
    }
}

/// Portfolio weights. Should sum to 1.0; `normalized` fixes small drift.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Allocation {
    pub stocks: f64,
    pub bonds: f64,
    pub cash: f64,
}

impl Allocation {
    pub fn normalized(self) -> Self {
        let total = self.stocks + self.bonds + self.cash;
        if total <= 0.0 {
            return Self { stocks: 0.0, bonds: 0.0, cash: 1.0 };
        }
        Self { stocks: self.stocks / total, bonds: self.bonds / total, cash: self.cash / total }
    }

    pub fn blended_return(self, r: &FixedReturns) -> f64 {
        let a = self.normalized();
        a.stocks * r.stocks + a.bonds * r.bonds + a.cash * r.cash
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct YearRow {
    /// 0 = the starting year.
    pub year_index: u32,
    pub start_balance: f64,
    pub withdrawal: f64,
    pub growth: f64,
    pub end_balance: f64,
    /// `end_balance` expressed in starting-year dollars.
    pub end_balance_real: f64,
}

/// Project a portfolio forward `years` years.
///
/// Each year: withdraw `annual_spend` (grown by inflation) at the start of the
/// year, then apply the blended return to what is left. The balance never goes
/// below zero.
pub fn project_fixed(
    start_balance: f64,
    allocation: Allocation,
    returns: &FixedReturns,
    annual_spend_today: f64,
    years: u32,
) -> Vec<YearRow> {
    let rate = allocation.blended_return(returns);
    let mut balance = start_balance;
    let mut price_level = 1.0;
    let mut rows = Vec::with_capacity(years as usize);

    for year_index in 0..years {
        let start = balance;
        let withdrawal = (annual_spend_today * price_level).min(start.max(0.0));
        let invested = start - withdrawal;
        let growth = invested * rate;
        balance = invested + growth;
        price_level *= 1.0 + returns.inflation;

        rows.push(YearRow {
            year_index,
            start_balance: start,
            withdrawal,
            growth,
            end_balance: balance,
            end_balance_real: balance / price_level,
        });
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all_stocks() -> Allocation {
        Allocation { stocks: 1.0, bonds: 0.0, cash: 0.0 }
    }

    #[test]
    fn compounds_without_withdrawals() {
        let rows = project_fixed(100_000.0, all_stocks(), &FixedReturns::default(), 0.0, 10);
        let expected = 100_000.0 * 1.07_f64.powi(10);
        assert!((rows.last().unwrap().end_balance - expected).abs() < 1e-6);
    }

    #[test]
    fn blends_allocation() {
        let mix = Allocation { stocks: 60.0, bonds: 40.0, cash: 0.0 }; // un-normalized on purpose
        let r = mix.blended_return(&FixedReturns::default());
        assert!((r - (0.6 * 0.07 + 0.4 * 0.04)).abs() < 1e-12);
    }

    #[test]
    fn withdrawals_grow_with_inflation_and_floor_at_zero() {
        let rows = project_fixed(50_000.0, all_stocks(), &FixedReturns::default(), 20_000.0, 5);
        assert!((rows[1].withdrawal - 20_000.0 * 1.025).abs() < 1e-6);
        let last = rows.last().unwrap();
        assert_eq!(last.end_balance, 0.0);
        assert!(rows.iter().all(|r| r.end_balance >= 0.0));
    }
}
