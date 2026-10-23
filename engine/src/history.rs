//! Real US market history (1928–2025), centered on the household's assumptions.
//!
//! How the range of outcomes uses it (decided with the user, 2026-10-23):
//! - Scenarios replay real years, drawn in runs of `BLOCK_YEARS` consecutive
//!   years, so multi-year slumps and inflation regimes stay intact.
//! - Each series is scaled so its long-run compound growth equals the
//!   assumption: `(1 + r') = (1 + r) × (1 + target) / (1 + historical geometric mean)`.
//!   Crashes and booms keep their relative size; typing ~10% for stocks gives
//!   essentially unadjusted history.
//! - Inflation is replayed and centered the same way, unless the household
//!   chose "keep inflation steady".

use std::sync::OnceLock;

use rand::Rng;
use serde::Serialize;

use crate::model::Assumptions;
use crate::projection::MarketYear;

/// Years drawn together in each run.
pub const BLOCK_YEARS: usize = 5;

/// One real year, as published (see the CSV header for sources).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalYear {
    pub year: i32,
    pub stocks: f64,
    pub bonds: f64,
    pub cash: f64,
    pub real_estate: f64,
    pub inflation: f64,
}

/// A real year next to its centered (scaled) version.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CenteredYear {
    pub actual: HistoricalYear,
    pub market: MarketYear,
}

/// The bundled table, parsed once.
pub fn table() -> &'static [HistoricalYear] {
    static TABLE: OnceLock<Vec<HistoricalYear>> = OnceLock::new();
    TABLE.get_or_init(|| parse(include_str!("../data/historical_returns.csv")))
}

fn parse(csv: &str) -> Vec<HistoricalYear> {
    csv.lines()
        .filter(|l| !l.starts_with('#') && !l.starts_with("year") && !l.trim().is_empty())
        .map(|l| {
            let f: Vec<&str> = l.split(',').collect();
            let num = |i: usize| f[i].trim().parse::<f64>().expect("historical_returns.csv: bad number");
            HistoricalYear {
                year: f[0].trim().parse().expect("historical_returns.csv: bad year"),
                stocks: num(1),
                bonds: num(2),
                cash: num(3),
                real_estate: num(4),
                inflation: num(5),
            }
        })
        .collect()
}

/// Compound (geometric) average yearly rate.
pub fn geometric_mean(rates: impl Iterator<Item = f64>) -> f64 {
    let (log_sum, n) = rates.fold((0.0, 0usize), |(s, n), r| (s + (1.0 + r).ln(), n + 1));
    if n == 0 { 0.0 } else { (log_sum / n as f64).exp() - 1.0 }
}

/// Every historical year, scaled so each series compounds at the assumption's rate.
pub fn centered(a: &Assumptions) -> Vec<CenteredYear> {
    centered_from(table(), a)
}

pub fn centered_from(years: &[HistoricalYear], a: &Assumptions) -> Vec<CenteredYear> {
    let scale =
        |target: f64, pick: fn(&HistoricalYear) -> f64| (1.0 + target) / (1.0 + geometric_mean(years.iter().map(pick)));
    let s = scale(a.stocks_return, |y| y.stocks);
    let b = scale(a.bonds_return, |y| y.bonds);
    let c = scale(a.cash_return, |y| y.cash);
    let re = scale(a.real_estate_growth, |y| y.real_estate);
    let inf = scale(a.inflation, |y| y.inflation);
    years
        .iter()
        .map(|y| CenteredYear {
            actual: *y,
            market: MarketYear {
                stocks: (1.0 + y.stocks) * s - 1.0,
                bonds: (1.0 + y.bonds) * b - 1.0,
                cash: (1.0 + y.cash) * c - 1.0,
                real_estate: (1.0 + y.real_estate) * re - 1.0,
                inflation: if a.steady_inflation { a.inflation } else { (1.0 + y.inflation) * inf - 1.0 },
            },
        })
        .collect()
}

/// Picks which historical years (as indices into the table) a scenario replays:
/// random runs of `BLOCK_YEARS` consecutive years, concatenated to `len`.
pub fn sample_path(rng: &mut impl Rng, table_len: usize, len: usize) -> Vec<usize> {
    let block = BLOCK_YEARS.min(table_len);
    let mut out = Vec::with_capacity(len + block);
    while out.len() < len {
        let start = rng.random_range(0..=table_len - block);
        out.extend(start..start + block);
    }
    out.truncate(len);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    fn close(a: f64, b: f64, tol: f64) {
        assert!((a - b).abs() <= tol, "expected {b}, got {a}");
    }

    #[test]
    fn table_covers_1928_through_2025() {
        let t = table();
        assert_eq!(t.len(), 98);
        assert!(t.windows(2).all(|w| w[1].year == w[0].year + 1));
        assert_eq!((t[0].year, t[97].year), (1928, 2025));
    }

    #[test]
    fn known_years_match_published_figures() {
        let y = |year: i32| *table().iter().find(|h| h.year == year).unwrap();
        close(y(1931).stocks, -0.4384, 1e-9);
        close(y(2008).stocks, -0.3655, 1e-9);
        close(y(2022).stocks, -0.1804, 1e-9);
        close(y(1980).inflation, 0.125, 0.001);
        // Long-run compound averages: stocks ≈ 10.0%, inflation ≈ 3.0%.
        close(geometric_mean(table().iter().map(|h| h.stocks)), 0.1002, 0.0005);
        close(geometric_mean(table().iter().map(|h| h.inflation)), 0.0304, 0.0005);
    }

    #[test]
    fn centering_hits_every_target_and_keeps_the_shape() {
        let a = Assumptions::default();
        let c = centered(&a);
        close(geometric_mean(c.iter().map(|y| y.market.stocks)), a.stocks_return, 1e-9);
        close(geometric_mean(c.iter().map(|y| y.market.bonds)), a.bonds_return, 1e-9);
        close(geometric_mean(c.iter().map(|y| y.market.cash)), a.cash_return, 1e-9);
        close(geometric_mean(c.iter().map(|y| y.market.real_estate)), a.real_estate_growth, 1e-9);
        close(geometric_mean(c.iter().map(|y| y.market.inflation)), a.inflation, 1e-9);

        // Same ordering of good and bad years: 1931 is still the worst stock year.
        let worst = c.iter().min_by(|x, y| x.market.stocks.total_cmp(&y.market.stocks)).unwrap();
        assert_eq!(worst.actual.year, 1931);
        // 2008 stays a crash of roughly the same size (−36.6% → about −38.4%).
        let y2008 = c.iter().find(|y| y.actual.year == 2008).unwrap();
        assert!(y2008.market.stocks < -0.37 && y2008.market.stocks > -0.40);
    }

    #[test]
    fn steady_inflation_is_constant() {
        let a = Assumptions { steady_inflation: true, ..Default::default() };
        assert!(centered(&a).iter().all(|y| y.market.inflation == a.inflation));
    }

    #[test]
    fn sampling_draws_runs_of_consecutive_real_years() {
        let mut rng = ChaCha8Rng::seed_from_u64(7);
        let idx = sample_path(&mut rng, 98, 34);
        assert_eq!(idx.len(), 34);
        assert!(idx.iter().all(|&i| i < 98));
        for block in idx.chunks(BLOCK_YEARS) {
            assert!(block.windows(2).all(|w| w[1] == w[0] + 1), "{block:?}");
        }
        let again = sample_path(&mut ChaCha8Rng::seed_from_u64(7), 98, 34);
        assert_eq!(idx, again);
    }
}
