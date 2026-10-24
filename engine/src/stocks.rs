//! Single-stock risk: how much one company's shares move with the market (beta) and on
//! their own (volatility left over), fitted from its monthly returns against the S&P 500's
//! over the same months. Monthly data gives enough points for a steady estimate; the beta is
//! then pulled a third of the way toward 1 (the standard Blume adjustment, since betas
//! drift toward 1 over time), and the leftover volatility is annualized (× √12).
//!
//! In the range of outcomes, a stock's return in a replayed year is
//! `market + (beta − 1) × (market − your stocks Assumption) + its own shock`,
//! where the shock is drawn at random (normal, mean 0, `own_vol`). So on average it earns
//! what your Assumptions say stocks earn; it doesn't assume the company beats the market,
//! only that it swings more (or less). The steady path is unchanged.

use serde::{Deserialize, Serialize};

use crate::history;

/// Fitted risk for one stock.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockFit {
    pub beta: f64,
    /// Yearly volatility not explained by the market (standard deviation of the residuals).
    pub own_vol: f64,
    /// Years used.
    pub years: usize,
    pub first_year: i32,
    pub last_year: i32,
    /// Worst calendar year in the data.
    pub worst_year: i32,
    pub worst_return: f64,
}

/// Fewer years than this isn't enough to fit; such stocks fall back to typical values.
pub const MIN_YEARS: usize = 5;
/// Months of overlapping history needed for the monthly fit.
pub const MIN_MONTHS: usize = 36;
/// Typical large single stock, used when there's too little history (from long-run studies of
/// S&P 500 members: beta about 1, about 30% yearly volatility of their own).
pub const TYPICAL: (f64, f64) = (1.0, 0.30);

/// Calendar-year total returns from month-end adjusted closes `(year, month, close)`,
/// using each December close (the first, partial year is dropped).
pub fn yearly_returns(monthly: &[(i32, u32, f64)]) -> Vec<(i32, f64)> {
    let mut decembers: Vec<(i32, f64)> =
        monthly.iter().filter(|(_, m, c)| *m == 12 && *c > 0.0).map(|(y, _, c)| (*y, *c)).collect();
    decembers.sort_by_key(|(y, _)| *y);
    decembers.windows(2).filter(|w| w[1].0 == w[0].0 + 1).map(|w| (w[1].0, w[1].1 / w[0].1 - 1.0)).collect()
}

/// Month-to-month returns from month-end closes, keyed by (year, month) of the later month.
pub fn monthly_returns(monthly: &[(i32, u32, f64)]) -> Vec<((i32, u32), f64)> {
    let mut m: Vec<(i32, u32, f64)> = monthly.iter().copied().filter(|x| x.2 > 0.0).collect();
    m.sort_by_key(|x| (x.0, x.1));
    m.windows(2)
        .filter(|w| (w[1].0 * 12 + w[1].1 as i32) - (w[0].0 * 12 + w[0].1 as i32) == 1)
        .map(|w| ((w[1].0, w[1].1), w[1].2 / w[0].2 - 1.0))
        .collect()
}

/// Least-squares slope and residual standard deviation of `y` on `x`.
fn regress(pairs: &[(f64, f64)]) -> Option<(f64, f64)> {
    let n = pairs.len() as f64;
    let mx = pairs.iter().map(|p| p.0).sum::<f64>() / n;
    let my = pairs.iter().map(|p| p.1).sum::<f64>() / n;
    let sxx: f64 = pairs.iter().map(|p| (p.0 - mx).powi(2)).sum();
    if sxx <= 0.0 || pairs.len() < 3 {
        return None;
    }
    let beta = pairs.iter().map(|p| (p.0 - mx) * (p.1 - my)).sum::<f64>() / sxx;
    let alpha = my - beta * mx;
    let ss: f64 = pairs.iter().map(|p| (p.1 - alpha - beta * p.0).powi(2)).sum();
    Some((beta, (ss / (n - 2.0)).sqrt()))
}

/// The risk fit used by the app: monthly returns of the stock against the market's
/// (both month-end closes), Blume-adjusted beta, annualized own volatility. The worst
/// calendar year comes from the stock's own December closes.
pub fn fit_monthly(stock: &[(i32, u32, f64)], market: &[(i32, u32, f64)]) -> Option<StockFit> {
    let s = monthly_returns(stock);
    let m = monthly_returns(market);
    let pairs: Vec<((i32, u32), f64, f64)> =
        s.iter().filter_map(|(k, r)| m.iter().find(|(mk, _)| mk == k).map(|(_, mr)| (*k, *mr, *r))).collect();
    if pairs.len() < MIN_MONTHS {
        return None;
    }
    let (raw_beta, resid) = regress(&pairs.iter().map(|p| (p.1, p.2)).collect::<Vec<_>>())?;
    let years = yearly_returns(stock);
    let worst = years.iter().copied().min_by(|a, b| a.1.total_cmp(&b.1)).unwrap_or((pairs[0].0.0, 0.0));
    Some(StockFit {
        beta: 2.0 / 3.0 * raw_beta + 1.0 / 3.0,
        own_vol: resid * 12f64.sqrt(),
        years: pairs.len() / 12,
        first_year: pairs.first().unwrap().0.0,
        last_year: pairs.last().unwrap().0.0,
        worst_year: worst.0,
        worst_return: worst.1,
    })
}

/// Least-squares fit of the stock's yearly returns on the S&P 500's for the same years
/// (used where only yearly data exists).
pub fn fit(stock: &[(i32, f64)]) -> Option<StockFit> {
    let market = history::table();
    fit_against(stock, |y| market.iter().find(|m| m.year == y).map(|m| m.stocks))
}

pub fn fit_against(stock: &[(i32, f64)], market: impl Fn(i32) -> Option<f64>) -> Option<StockFit> {
    let pairs: Vec<(i32, f64, f64)> = stock.iter().filter_map(|&(y, r)| market(y).map(|m| (y, m, r))).collect();
    let n = pairs.len();
    if n < MIN_YEARS {
        return None;
    }
    let nf = n as f64;
    let mx = pairs.iter().map(|p| p.1).sum::<f64>() / nf;
    let my = pairs.iter().map(|p| p.2).sum::<f64>() / nf;
    let sxx: f64 = pairs.iter().map(|p| (p.1 - mx).powi(2)).sum();
    let sxy: f64 = pairs.iter().map(|p| (p.1 - mx) * (p.2 - my)).sum();
    if sxx <= 0.0 {
        return None;
    }
    let beta = sxy / sxx;
    let alpha = my - beta * mx;
    let ss_res: f64 = pairs.iter().map(|p| (p.2 - alpha - beta * p.1).powi(2)).sum();
    let own_vol = (ss_res / (nf - 2.0)).sqrt();
    let worst = pairs.iter().min_by(|a, b| a.2.total_cmp(&b.2)).unwrap();
    Some(StockFit {
        beta,
        own_vol,
        years: n,
        first_year: pairs.iter().map(|p| p.0).min().unwrap(),
        last_year: pairs.iter().map(|p| p.0).max().unwrap(),
        worst_year: worst.0,
        worst_return: worst.2,
    })
}

/// A stock's return in a replayed year, given that year's (scaled) market return.
pub fn stock_return(market: f64, stocks_assumption: f64, beta: f64, shock: f64) -> f64 {
    (market + (beta - 1.0) * (market - stocks_assumption) + shock).max(-0.95)
}

/// A standard normal draw (Box–Muller) from two uniform draws in (0, 1].
pub fn normal(u1: f64, u2: f64) -> f64 {
    (-2.0 * u1.max(f64::MIN_POSITIVE).ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yearly_returns_use_december_closes() {
        let monthly = [(2020, 6, 50.0), (2020, 12, 100.0), (2021, 12, 120.0), (2022, 12, 90.0), (2024, 12, 99.0)];
        // 2021 +20%, 2022 −25%; 2024 is skipped because 2023 is missing.
        let r = yearly_returns(&monthly);
        assert_eq!(r.iter().map(|x| x.0).collect::<Vec<_>>(), [2021, 2022]);
        assert!((r[0].1 - 0.2).abs() < 1e-12 && (r[1].1 + 0.25).abs() < 1e-12);
    }

    #[test]
    fn fit_recovers_a_known_beta_and_volatility() {
        // Stock = 1.5 × market + alternating ±10% of its own.
        let market: Vec<(i32, f64)> = (0..40).map(|i| (1980 + i, ((i * 37 % 23) as f64 - 11.0) / 50.0)).collect();
        let stock: Vec<(i32, f64)> =
            market.iter().enumerate().map(|(i, &(y, m))| (y, 1.5 * m + if i % 2 == 0 { 0.1 } else { -0.1 })).collect();
        let f = fit_against(&stock, |y| market.iter().find(|m| m.0 == y).map(|m| m.1)).unwrap();
        assert!((f.beta - 1.5).abs() < 0.05, "beta {}", f.beta);
        assert!((f.own_vol - 0.1).abs() < 0.01, "own vol {}", f.own_vol);
        assert_eq!(f.years, 40);
    }

    #[test]
    fn monthly_fit_recovers_beta_then_adjusts_it_toward_one() {
        // 60 months: market wiggles; stock = 2 × market ± 2% a month of its own.
        let mut market = vec![(2019, 12, 100.0)];
        let mut stock = vec![(2019, 12, 100.0)];
        for i in 0..60u32 {
            let (y, mo) = (2020 + (i / 12) as i32, i % 12 + 1);
            let mr = ((i * 7 % 11) as f64 - 5.0) / 100.0;
            let sr = 2.0 * mr + if i % 2 == 0 { 0.02 } else { -0.02 };
            let (pm, ps) = (market.last().unwrap().2, stock.last().unwrap().2);
            market.push((y, mo, pm * (1.0 + mr)));
            stock.push((y, mo, ps * (1.0 + sr)));
        }
        let f = fit_monthly(&stock, &market).unwrap();
        // Raw beta 2 → Blume-adjusted 2/3 × 2 + 1/3 = 1.67.
        assert!((f.beta - 5.0 / 3.0).abs() < 0.05, "beta {}", f.beta);
        assert!((f.own_vol - 0.02 * 12f64.sqrt()).abs() < 0.01, "own vol {}", f.own_vol);
        assert_eq!(f.years, 5);
        assert!(fit_monthly(&stock[..20], &market).is_none(), "under 3 years");
    }

    #[test]
    fn too_little_history_is_not_fitted() {
        assert!(fit(&[(2021, 0.1), (2022, -0.2), (2023, 0.3)]).is_none());
    }

    #[test]
    fn fits_against_the_real_sp500() {
        // A stock that is exactly the market: beta 1, no volatility of its own.
        let sp: Vec<(i32, f64)> = history::table().iter().map(|y| (y.year, y.stocks)).collect();
        let f = fit(&sp).unwrap();
        assert!((f.beta - 1.0).abs() < 1e-9);
        assert!(f.own_vol < 1e-9);
        assert_eq!(f.worst_year, 1931);
    }

    #[test]
    fn stock_returns_center_on_the_market() {
        assert_eq!(stock_return(0.07, 0.07, 1.8, 0.0), 0.07);
        assert!((stock_return(-0.30, 0.07, 1.5, 0.0) - (-0.485)).abs() < 1e-12);
        assert_eq!(stock_return(-0.9, 0.07, 2.0, -0.5), -0.95);
    }
}
