//! Ticker prices and price history from Yahoo Finance's public chart data (no account or
//! key needed), cached in the main file's `ticker_data` table. The network is only touched
//! here, never by the engine; when it's unavailable, the last cached (or typed-in) price stays.

use engine::model::{Household, StockRisk};
use engine::stocks::{self, StockFit};
use rusqlite::{Connection, params};
use serde::Serialize;
use serde_json::Value;

use crate::db;

/// Yahoo's monthly chart for 20 years (a longer range comes back quarterly); adjusted closes include dividends.
fn chart_url(ticker: &str) -> String {
    format!("https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?range=20y&interval=1mo")
}

/// Refetch a ticker at most this often unless asked.
pub const MAX_AGE_HOURS: i64 = 12;

#[derive(Debug, Clone, PartialEq)]
pub struct Quote {
    pub ticker: String,
    pub name: String,
    pub instrument: String,
    pub price: f64,
    /// YYYY-MM-DD of `price`.
    pub price_date: String,
    /// Month-end adjusted closes: (year, month, close).
    pub monthly: Vec<(i32, u32, f64)>,
}

/// A cached ticker, as the UI shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TickerInfo {
    pub ticker: String,
    pub name: String,
    pub instrument: String,
    pub price: f64,
    pub price_date: String,
    pub fetched_at: String,
    pub fit: Option<StockFit>,
}

impl TickerInfo {
    /// A single company's shares (funds and ETFs already move with the market).
    pub fn is_single_stock(&self) -> bool {
        self.instrument == "EQUITY"
    }
}

fn date_of(ts: i64) -> Option<(i32, u32, String)> {
    use chrono::Datelike;
    let d = chrono::DateTime::from_timestamp(ts, 0)?.date_naive();
    Some((d.year(), d.month(), d.format("%Y-%m-%d").to_string()))
}

/// Parses Yahoo's chart JSON.
pub fn parse_chart(ticker: &str, json: &str) -> Result<Quote, String> {
    let v: Value = serde_json::from_str(json).map_err(|_| format!("{ticker}: unexpected reply"))?;
    let result = &v["chart"]["result"][0];
    if result.is_null() {
        let why = v["chart"]["error"]["description"].as_str().unwrap_or("not found");
        return Err(format!("{ticker}: {why}"));
    }
    let meta = &result["meta"];
    let price = meta["regularMarketPrice"].as_f64().ok_or(format!("{ticker}: no price"))?;
    let (_, _, price_date) =
        meta["regularMarketTime"].as_i64().and_then(date_of).ok_or(format!("{ticker}: no date"))?;
    let times = result["timestamp"].as_array().cloned().unwrap_or_default();
    let closes = result["indicators"]["adjclose"][0]["adjclose"].as_array().cloned().unwrap_or_default();
    // Each monthly bar is stamped at the start of its month and closes at its end.
    let monthly = times
        .iter()
        .zip(closes.iter())
        .filter_map(|(t, c)| {
            let (y, m, _) = date_of(t.as_i64()?)?;
            Some((y, m, c.as_f64()?))
        })
        .collect();
    Ok(Quote {
        ticker: ticker.to_string(),
        name: meta["longName"].as_str().or(meta["shortName"].as_str()).unwrap_or(ticker).to_string(),
        instrument: meta["instrumentType"].as_str().unwrap_or("").to_string(),
        price,
        price_date,
        monthly,
    })
}

/// Downloads one ticker (blocking; call off the UI thread).
pub fn fetch(ticker: &str) -> Result<Quote, String> {
    let body = ureq::get(&chart_url(ticker))
        .set("User-Agent", "Mozilla/5.0 (Macintosh; Finance Simulator)")
        .timeout(std::time::Duration::from_secs(15))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(404, _) => format!("{ticker}: not found"),
            other => format!("{ticker}: couldn't reach the price service ({other})"),
        })?
        .into_string()
        .map_err(|e| format!("{ticker}: {e}"))?;
    parse_chart(ticker, &body)
}

/// The market series single stocks are fitted against.
pub const MARKET: &str = "^GSPC";

/// The cache entry for a fetched quote, with its risk fitted against `market`'s monthly
/// closes (single stocks only).
pub fn info_from(q: &Quote, market: &[(i32, u32, f64)], fetched_at: &str) -> TickerInfo {
    let fit = (q.instrument == "EQUITY").then(|| stocks::fit_monthly(&q.monthly, market)).flatten();
    TickerInfo {
        ticker: q.ticker.clone(),
        name: q.name.clone(),
        instrument: q.instrument.clone(),
        price: q.price,
        price_date: q.price_date.clone(),
        fetched_at: fetched_at.to_string(),
        fit,
    }
}

pub fn save(conn: &Connection, t: &TickerInfo) -> db::Result<()> {
    let fit = t.fit.map(|f| serde_json::to_string(&f).unwrap_or_default());
    conn.execute(
        "INSERT OR REPLACE INTO ticker_data (ticker, name, instrument, price, price_date, fetched_at, fit)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![t.ticker, t.name, t.instrument, t.price, t.price_date, t.fetched_at, fit],
    )?;
    Ok(())
}

pub fn load_all(conn: &Connection) -> db::Result<Vec<TickerInfo>> {
    let mut stmt = conn.prepare(
        "SELECT ticker, name, instrument, price, price_date, fetched_at, fit FROM ticker_data ORDER BY ticker",
    )?;
    let rows = stmt.query_map([], |r| {
        let fit: Option<String> = r.get(6)?;
        Ok(TickerInfo {
            ticker: r.get(0)?,
            name: r.get(1)?,
            instrument: r.get(2)?,
            price: r.get(3)?,
            price_date: r.get(4)?,
            fetched_at: r.get(5)?,
            fit: fit.and_then(|f| serde_json::from_str(&f).ok()),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Tickers held anywhere in `h`, upper case, without duplicates.
pub fn tickers_in(h: &Household) -> Vec<String> {
    let mut t: Vec<String> = h
        .accounts
        .iter()
        .flat_map(|a| a.holdings.iter().map(|x| x.ticker.trim().to_uppercase()))
        .filter(|t| !t.is_empty())
        .collect();
    t.sort();
    t.dedup();
    t
}

/// Risk for the single stocks held in `h`: fitted from history, or typical values when the
/// history is too short. Funds, ETFs and unknown tickers move with the market.
pub fn risk_for(cache: &[TickerInfo], h: &Household) -> Vec<StockRisk> {
    tickers_in(h)
        .into_iter()
        .filter_map(|t| {
            let info = cache.iter().find(|c| c.ticker == t && c.is_single_stock())?;
            let (beta, own_vol) = info.fit.map_or(stocks::TYPICAL, |f| (f.beta, f.own_vol));
            Some(StockRisk { ticker: t, beta, own_vol })
        })
        .collect()
}

/// New prices into an account's positions; the balance moves by the change in their value
/// (so cash and anything not listed stays as entered). Returns true if anything changed.
pub fn reprice(a: &mut engine::model::Account, cache: &[TickerInfo]) -> bool {
    let mut changed = false;
    let before: f64 = a.holdings.iter().map(|h| h.value()).sum();
    for h in a.holdings.iter_mut() {
        if let Some(c) = cache.iter().find(|c| c.ticker == h.ticker.trim().to_uppercase())
            && (h.price != c.price || h.price_date.as_deref() != Some(c.price_date.as_str()))
        {
            h.price = c.price;
            h.price_date = Some(c.price_date.clone());
            changed = true;
        }
    }
    if changed {
        let after: f64 = a.holdings.iter().map(|h| h.value()).sum();
        a.balance = ((a.balance + after - before).max(0.0) * 100.0).round() / 100.0;
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine::model::{Account, Holding};

    fn market() -> Vec<(i32, u32, f64)> {
        parse_chart(MARKET, &sample("GSPC.json")).unwrap().monthly
    }

    fn sample(name: &str) -> String {
        std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/prices").join(name))
            .unwrap()
    }

    #[test]
    fn parses_a_stock_and_fits_its_risk() {
        let q = parse_chart("META", &sample("META.json")).unwrap();
        assert_eq!(q.instrument, "EQUITY");
        assert!(q.name.contains("Meta"));
        assert!(q.price > 0.0 && q.price_date.len() == 10);
        assert!(q.monthly.len() > 100);
        let info = info_from(&q, &market(), "2026-10-24T18:00:00Z");
        let fit = info.fit.expect("over 10 years of history");
        println!(
            "META: beta {:.2}, own volatility {:.0}%, {} years, worst {} {:.0}%",
            fit.beta,
            fit.own_vol * 100.0,
            fit.years,
            fit.worst_year,
            fit.worst_return * 100.0
        );
        assert!(fit.beta > 0.8 && fit.beta < 2.0, "beta {}", fit.beta);
        assert!(fit.own_vol > 0.1, "a single stock swings on its own");
        assert_eq!(fit.worst_year, 2022, "Meta fell about 64% in 2022");
    }

    #[test]
    fn funds_get_no_risk_of_their_own() {
        let q = parse_chart("VTI", &sample("VTI.json")).unwrap();
        assert_eq!(q.instrument, "ETF");
        let info = info_from(&q, &market(), "now");
        assert!(info.fit.is_none() && !info.is_single_stock());
    }

    #[test]
    fn errors_are_readable() {
        let not_found = r#"{"chart":{"result":null,"error":{"code":"Not Found","description":"No data found, symbol may be delisted"}}}"#;
        assert!(parse_chart("ZZZZ", not_found).unwrap_err().contains("delisted"));
        assert!(parse_chart("X", "<html>").is_err());
    }

    #[test]
    fn cache_round_trip_risk_and_repricing() {
        let conn = crate::db::open_in_memory().unwrap();
        let meta = info_from(&parse_chart("META", &sample("META.json")).unwrap(), &market(), "t");
        let vti = info_from(&parse_chart("VTI", &sample("VTI.json")).unwrap(), &market(), "t");
        save(&conn, &meta).unwrap();
        save(&conn, &vti).unwrap();
        let cache = load_all(&conn).unwrap();
        assert_eq!(cache.len(), 2);
        assert!((cache[0].fit.unwrap().beta - meta.fit.unwrap().beta).abs() < 1e-9, "fit survives the cache");

        let mut account = Account {
            name: "Brokerage".into(),
            balance: 1_000.0,
            holdings: vec![
                Holding { ticker: "meta".into(), shares: 1.0, price: 100.0, ..Default::default() },
                Holding { ticker: "VTI".into(), shares: 2.0, price: 100.0, ..Default::default() },
                Holding { ticker: "PRIVATE".into(), shares: 1.0, price: 50.0, ..Default::default() },
            ],
            ..crate::demo::household(crate::demo::Demo::Retiree).accounts[0].clone()
        };
        assert!(reprice(&mut account, &cache));
        let expected = 1_000.0 - 300.0 + meta.price + 2.0 * vti.price;
        assert!((account.balance - expected).abs() < 0.01);
        assert!(!reprice(&mut account, &cache), "nothing new the second time");

        let h = Household { accounts: vec![account], ..Default::default() };
        let risk = risk_for(&cache, &h);
        assert_eq!(risk.len(), 1, "only the single stock");
        assert_eq!(risk[0].ticker, "META");
    }

    /// Real network check: `cargo test -p finance-simulator live_prices -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_prices() {
        let market = fetch(MARKET).unwrap().monthly;
        for t in ["META", "AAPL", "VTI"] {
            let q = fetch(t).unwrap();
            let info = info_from(&q, &market, "now");
            println!("{t}: {} {} on {} ({}), fit {:?}", q.name, q.price, q.price_date, q.instrument, info.fit);
        }
    }
}
