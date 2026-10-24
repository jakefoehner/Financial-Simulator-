//! Reading positions exports from brokerages (Schwab, Fidelity, Vanguard, Morgan Stanley,
//! Merrill) and a simple template, so accounts don't have to be typed in.
//!
//! One tolerant parser handles them all: it finds the header row by its column names
//! (each brokerage words them a little differently), groups rows into accounts (by an
//! account column, or by the title line above each table, as Schwab does), and skips
//! totals, pending activity and disclaimers. Files it can't make sense of come back with
//! their columns so the user can say which is which.

use engine::model::{Account, AccountType, Holding, Id};
use serde::{Deserialize, Serialize};

/// What a file turned out to contain.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ImportPreview {
    Parsed {
        brokerage: String,
        accounts: Vec<ImportedAccount>,
    },
    /// Columns weren't recognized: the user maps them (`ColumnMapping`).
    NeedsMapping {
        columns: Vec<String>,
        header_row: usize,
        sample: Vec<Vec<String>>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAccount {
    pub name: String,
    /// Last four characters of the account number, when the file has one.
    pub number_last4: Option<String>,
    pub holdings: Vec<Holding>,
    /// Cash and money-market funds.
    pub cash: f64,
    pub total: f64,
    /// Ready to save as a new account (id `None`); the UI may update an existing one instead.
    pub account: Account,
}

/// Which column holds what, by index (from the user, for files we don't recognize).
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMapping {
    pub header_row: usize,
    pub symbol: Option<usize>,
    pub description: Option<usize>,
    pub shares: Option<usize>,
    pub price: Option<usize>,
    pub value: Option<usize>,
    pub cost_basis: Option<usize>,
    pub account: Option<usize>,
}

/// Column names each field goes by, across brokerages (compared lowercase, without
/// punctuation like "($)").
const SYMBOL: &[&str] = &["symbol", "symbol/cusip", "ticker", "symbol cusip", "security symbol"];
const DESCRIPTION: &[&str] =
    &["description", "investment name", "security description", "name", "security name", "security"];
const SHARES: &[&str] = &["quantity", "shares", "qty", "share quantity", "units"];
const PRICE: &[&str] = &["price", "last price", "share price", "current price", "market price", "price per share"];
const VALUE: &[&str] = &["market value", "current value", "total value", "value", "market value usd", "balance"];
const COST: &[&str] =
    &["cost basis", "cost basis total", "total cost", "cost", "total cost basis", "adjusted cost basis"];
const ACCOUNT: &[&str] = &[
    "account number",
    "account #",
    "account name",
    "account nickname",
    "account",
    "account no",
    "account registration",
];
const ACCOUNT_TYPE: &[&str] = &["account type", "account registration", "registration"];
const ACCOUNT_LABEL: &[&str] = &["account name", "account nickname", "account title"];

fn clean_header(s: &str) -> String {
    s.to_lowercase().replace(['(', ')', '$', '*', '"'], "").split_whitespace().collect::<Vec<_>>().join(" ")
}

fn find(headers: &[String], names: &[&str]) -> Option<usize> {
    // Exact names first (so "price" doesn't grab "price change"), then prefixes.
    names
        .iter()
        .find_map(|n| headers.iter().position(|h| h == n))
        .or_else(|| names.iter().find_map(|n| headers.iter().position(|h| h.starts_with(n))))
}

/// "$1,234.56" → 1234.56; "(12.50)" → -12.5; "--", "n/a", "" → None.
pub fn money(s: &str) -> Option<f64> {
    let t = s.trim().trim_matches('"').trim();
    if t.is_empty() || matches!(t.to_lowercase().as_str(), "--" | "n/a" | "na" | "-" | "nan") {
        return None;
    }
    let negative = t.starts_with('(') && t.ends_with(')') || t.starts_with('-');
    let digits: String = t.chars().filter(|c| c.is_ascii_digit() || *c == '.').collect();
    let v: f64 = digits.parse().ok()?;
    Some(if negative { -v } else { v })
}

fn read_rows(text: &str) -> Vec<Vec<String>> {
    let mut rdr = csv::ReaderBuilder::new().has_headers(false).flexible(true).from_reader(text.as_bytes());
    rdr.records().filter_map(|r| r.ok()).map(|r| r.iter().map(|c| c.trim().to_string()).collect::<Vec<_>>()).collect()
}

fn brokerage(text: &str, headers: &[String]) -> &'static str {
    let lower = text.to_lowercase();
    let has = |h: &str| headers.iter().any(|x| x == h);
    if lower.starts_with("\"positions for") || lower.starts_with("positions for") || has("% of account") {
        "Schwab"
    } else if has("cost basis total") || (has("account name") && has("current value")) {
        "Fidelity"
    } else if has("investment name") && has("share price") {
        "Vanguard"
    } else if has("account registration") || lower.contains("merrill") {
        "Merrill"
    } else if has("symbol/cusip") || lower.contains("morgan stanley") {
        "Morgan Stanley"
    } else if has("account type") && has("symbol") {
        "Template"
    } else {
        "Other"
    }
}

fn is_header(row: &[String]) -> bool {
    let h: Vec<String> = row.iter().map(|c| clean_header(c)).collect();
    find(&h, SYMBOL).is_some() && (find(&h, VALUE).is_some() || find(&h, SHARES).is_some())
}

/// Reads a positions file. Recognized layouts come back parsed; others ask for a mapping.
pub fn parse(text: &str, file_name: &str) -> ImportPreview {
    let rows = read_rows(text.trim_start_matches('\u{feff}'));
    match rows.iter().position(|r| is_header(r)) {
        Some(header_row) => {
            let headers: Vec<String> = rows[header_row].iter().map(|c| clean_header(c)).collect();
            let mapping = ColumnMapping {
                header_row,
                symbol: find(&headers, SYMBOL),
                description: find(&headers, DESCRIPTION),
                shares: find(&headers, SHARES),
                price: find(&headers, PRICE),
                value: find(&headers, VALUE),
                cost_basis: find(&headers, COST),
                account: find(&headers, ACCOUNT),
            };
            let extra = Extra { type_col: find(&headers, ACCOUNT_TYPE), label_col: find(&headers, ACCOUNT_LABEL) };
            let name = brokerage(text, &headers);
            ImportPreview::Parsed { brokerage: name.into(), accounts: collect(&rows, &mapping, extra, file_name, name) }
        }
        None => {
            // Best guess at the header: the first row with several filled cells.
            let header_row = rows.iter().position(|r| r.iter().filter(|c| !c.is_empty()).count() >= 3).unwrap_or(0);
            ImportPreview::NeedsMapping {
                columns: rows.get(header_row).cloned().unwrap_or_default(),
                header_row,
                sample: rows.iter().skip(header_row + 1).take(5).cloned().collect(),
            }
        }
    }
}

/// Reads a file with columns the user identified.
pub fn parse_mapped(text: &str, file_name: &str, mapping: &ColumnMapping) -> ImportPreview {
    let rows = read_rows(text.trim_start_matches('\u{feff}'));
    let extra = Extra { type_col: None, label_col: None };
    ImportPreview::Parsed { brokerage: "Other".into(), accounts: collect(&rows, mapping, extra, file_name, "Other") }
}

/// Rows that aren't positions: totals, pending activity. (A fund *named* "Total Stock
/// Market" is a position, so totals are recognized by the symbol column or a bare "Total".)
fn skip_row(symbol: &str, description: &str) -> bool {
    let s = symbol.to_lowercase();
    let d = description.to_lowercase();
    s.starts_with("total")
        || s.contains("account total")
        || s.contains("pending")
        || d.contains("pending activity")
        || (s.is_empty() && (d == "total" || d.starts_with("total ") && d.contains("account")))
}

/// Whether a title line above a table names an account (Schwab's "Individual ...123",
/// "Account: Joint ...8899") rather than being a report heading.
fn looks_like_account(title: &str) -> bool {
    let t = title.to_lowercase();
    last4(title).is_some()
        || guess_type(title) != AccountType::Taxable
        || ["individual", "joint", "brokerage", "trust", "account"].iter().any(|w| t.contains(w))
            && !t.contains("as of")
}

/// Optional account columns: its type (or registration) and a friendly name.
#[derive(Clone, Copy)]
struct Extra {
    type_col: Option<usize>,
    label_col: Option<usize>,
}

fn is_cash(symbol: &str, description: &str) -> bool {
    let s = symbol.to_lowercase();
    let d = description.to_lowercase();
    symbol.ends_with("**")
        || s.contains("cash")
        || d.contains("money market")
        || d.contains("cash & cash")
        || d.contains("held in money market")
        || d.starts_with("cash")
        || d.contains("bank deposit")
        || d.contains("deposit program")
        || d.contains("sweep")
        || ["spaxx", "fdrxx", "fzfxx", "vmfxx", "vmmxx", "swvxx", "snvxx", "core"].contains(&s.as_str())
}

fn collect(
    rows: &[Vec<String>],
    m: &ColumnMapping,
    extra: Extra,
    file_name: &str,
    brokerage: &str,
) -> Vec<ImportedAccount> {
    struct Group {
        key: String,
        label: Option<String>,
        account_type: Option<String>,
        holdings: Vec<Holding>,
        cash: f64,
    }
    let cell =
        |r: &[String], i: Option<usize>| i.and_then(|i| r.get(i)).map(String::as_str).unwrap_or("").trim().to_string();
    let mut groups: Vec<Group> = Vec::new();
    // A title line above a table (Schwab: "Individual ...123"), used when there's no account column.
    let mut title: Option<String> = None;
    let mut in_table = false;
    for (i, r) in rows.iter().enumerate() {
        if i < m.header_row {
            if let Some(first) = r.iter().find(|c| !c.is_empty()).filter(|c| looks_like_account(c)) {
                title = Some(first.clone());
            }
            continue;
        }
        if i == m.header_row || *r == rows[m.header_row] {
            in_table = true;
            continue;
        }
        // A different table follows (e.g. Vanguard's transactions): positions are done.
        if i > m.header_row && is_header(r) {
            break;
        }
        let filled = r.iter().filter(|c| !c.is_empty()).count();
        if filled <= 1 {
            // A blank line ends a table; a lone cell is the next table's title (or a footer).
            in_table = false;
            if let Some(t) = r.iter().find(|c| !c.is_empty()).filter(|c| filled == 1 && looks_like_account(c)) {
                title = Some(t.clone());
            }
            continue;
        }
        if !in_table {
            continue;
        }
        let symbol = cell(r, m.symbol);
        let description = cell(r, m.description);
        if skip_row(&symbol, &description) {
            continue;
        }
        let shares = money(&cell(r, m.shares));
        let price = money(&cell(r, m.price));
        let value = money(&cell(r, m.value)).or_else(|| shares.zip(price).map(|(s, p)| s * p));
        let Some(value) = value else { continue };
        if symbol.is_empty() && description.is_empty() {
            continue;
        }
        let key = match m.account {
            Some(_) => cell(r, m.account),
            None => title.clone().unwrap_or_else(|| file_stem(file_name)),
        };
        let gi = match groups.iter().position(|g| g.key == key) {
            Some(gi) => gi,
            None => {
                groups.push(Group {
                    key: key.clone(),
                    label: None,
                    account_type: None,
                    holdings: Vec::new(),
                    cash: 0.0,
                });
                groups.len() - 1
            }
        };
        let g = &mut groups[gi];
        if g.account_type.is_none() {
            g.account_type = Some(cell(r, extra.type_col)).filter(|t| !t.is_empty());
        }
        if g.label.is_none() {
            g.label = Some(cell(r, extra.label_col)).filter(|t| !t.is_empty());
        }
        if is_cash(&symbol, &description) {
            g.cash += value;
            continue;
        }
        let (shares, price) = match (shares, price) {
            (Some(s), Some(p)) => (s, p),
            (Some(s), None) if s > 0.0 => (s, value / s),
            _ => (1.0, value),
        };
        g.holdings.push(Holding {
            ticker: symbol.trim_end_matches('*').to_uppercase(),
            description,
            shares,
            price,
            cost_basis: money(&cell(r, m.cost_basis)).filter(|c| *c >= 0.0),
            price_date: None,
        });
    }
    groups
        .into_iter()
        .map(|g| {
            let name = account_name(&g.key, g.label.as_deref(), brokerage);
            let type_hint = [g.account_type.as_deref(), g.label.as_deref(), Some(g.key.as_str())]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" ");
            let account = to_account(&name, guess_type(&type_hint), &g.holdings, g.cash);
            ImportedAccount {
                number_last4: last4(&g.key),
                total: account.balance,
                name,
                holdings: g.holdings,
                cash: g.cash,
                account,
            }
        })
        .collect()
}

fn file_stem(name: &str) -> String {
    std::path::Path::new(name).file_stem().and_then(|s| s.to_str()).unwrap_or("Imported account").to_string()
}

/// The last (up to) four digits of anything that looks like an account number.
fn last4(key: &str) -> Option<String> {
    let digits: String = key.chars().filter(|c| c.is_ascii_digit()).collect();
    (digits.len() >= 3).then(|| digits[digits.len().saturating_sub(4)..].to_string())
}

/// "Individual ...123" → "Schwab Individual ...123"; label "Individual" + "Z12345678" →
/// "Fidelity Individual ...5678"; a bare number → "Vanguard ...5678".
fn account_name(key: &str, label: Option<&str>, brokerage: &str) -> String {
    let key = key.trim().trim_start_matches("Account:").trim();
    let has_words = |s: &str| s.chars().filter(|c| c.is_alphabetic()).count() >= 3;
    let base = match (label.filter(|l| has_words(l)), last4(key)) {
        (Some(label), Some(l4)) if !label.contains(&l4) => format!("{label} ...{l4}"),
        (Some(label), _) => label.to_string(),
        (None, _) if has_words(key) => key.to_string(),
        (None, Some(l4)) => format!("...{l4}"),
        (None, None) => "Account".to_string(),
    };
    if matches!(brokerage, "Other" | "Template") || base.to_lowercase().contains(&brokerage.to_lowercase()) {
        base
    } else {
        format!("{brokerage} {base}")
    }
}

/// Guesses the account type from its name ("Roth IRA", "ROLLOVER IRA", "Individual"…).
pub fn guess_type(name: &str) -> AccountType {
    let n = name.to_lowercase();
    if n.contains("roth") && (n.contains("401") || n.contains("403")) {
        AccountType::Roth401k
    } else if n.contains("roth") {
        AccountType::RothIra
    } else if n.contains("401") || n.contains("403") || n.contains("457") || n.contains("tsp") {
        AccountType::Trad401k
    } else if n.contains("ira") || n.contains("sep") || n.contains("rollover") {
        AccountType::TradIra
    } else if n.contains("hsa") || n.contains("health savings") {
        AccountType::Hsa
    } else if n.contains("529") || n.contains("college") {
        AccountType::Plan529
    } else if n.contains("checking") {
        AccountType::Checking
    } else if n.contains("savings") {
        AccountType::Savings
    } else {
        AccountType::Taxable
    }
}

/// Broad asset class of a position, from its ticker and description.
fn is_bond(h: &Holding) -> bool {
    let d = h.description.to_lowercase();
    const BOND_TICKERS: &[&str] = &[
        "BND", "AGG", "BNDX", "VBTLX", "VBMFX", "FXNAX", "SCHZ", "TLT", "IEF", "SHY", "VGIT", "VGSH", "MUB", "VTEB",
        "BSV", "BIV",
    ];
    BOND_TICKERS.contains(&h.ticker.as_str())
        || ["bond", "treasury", "fixed income", "aggregate", "municipal", "t-bill", "note "]
            .iter()
            .any(|w| d.contains(w))
}

/// A new account from imported positions: balance, basis and allocation filled in.
pub fn to_account(name: &str, account_type: AccountType, holdings: &[Holding], cash: f64) -> Account {
    let value: f64 = holdings.iter().map(Holding::value).sum();
    let total = value + cash;
    let bonds: f64 = holdings.iter().filter(|h| is_bond(h)).map(Holding::value).sum();
    let (stocks_pct, bonds_pct, cash_pct) = if total > 0.0 && account_type.has_allocation() {
        let b = bonds / total;
        let c = cash / total;
        ((1.0 - b - c).max(0.0), b, c)
    } else if account_type.has_allocation() {
        (0.6, 0.4, 0.0)
    } else {
        (0.0, 0.0, 1.0)
    };
    // Cost basis only for taxable accounts, and only if every position has one.
    let basis = (account_type == AccountType::Taxable && holdings.iter().all(|h| h.cost_basis.is_some()))
        .then(|| holdings.iter().filter_map(|h| h.cost_basis).sum::<f64>() + cash);
    Account {
        id: None,
        name: name.into(),
        account_type,
        owner_id: None,
        balance: (total * 100.0).round() / 100.0,
        cost_basis: basis.map(|b| (b * 100.0).round() / 100.0),
        stocks_pct,
        bonds_pct,
        cash_pct,
        annual_contribution: 0.0,
        employer_match: 0.0,
        notes: String::new(),
        private: None,
        holdings: holdings.to_vec(),
    }
}

/// Updates an existing account from an import: new balance, basis, allocation and
/// positions; name, owner, contributions and notes are kept.
pub fn update_account(existing: &Account, imported: &Account) -> Account {
    Account {
        balance: imported.balance,
        cost_basis: imported.cost_basis.or(existing.cost_basis),
        stocks_pct: imported.stocks_pct,
        bonds_pct: imported.bonds_pct,
        cash_pct: imported.cash_pct,
        holdings: imported.holdings.clone(),
        ..existing.clone()
    }
}

/// Owner for new imported accounts: the main person.
fn default_owner(people: &[engine::model::Person]) -> Option<Id> {
    people.iter().find(|p| p.role == engine::model::Role::Primary).and_then(|p| p.id)
}

/// What to do with one imported account.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportChoice {
    /// The account as imported (possibly with a name or type the user changed).
    pub account: Account,
    /// Update this existing account instead of adding a new one.
    pub update_id: Option<Id>,
}

/// Saves the choices in one transaction: updates keep each account's name, owner,
/// contributions and notes; new accounts belong to the main person.
pub fn apply(conn: &mut rusqlite::Connection, choices: &[ImportChoice]) -> crate::db::Result<()> {
    let h = crate::db::load_household(conn)?;
    let tx = conn.transaction()?;
    for c in choices {
        let account = match c.update_id.and_then(|id| h.accounts.iter().find(|a| a.id == Some(id))) {
            Some(existing) => update_account(existing, &c.account),
            None => {
                Account { id: None, owner_id: c.account.owner_id.or(default_owner(&h.people)), ..c.account.clone() }
            }
        };
        crate::db::upsert_account(&tx, &account)?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(name: &str) -> String {
        std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/imports").join(name))
            .unwrap()
    }

    fn parsed(text: &str) -> (String, Vec<ImportedAccount>) {
        match parse(text, "export.csv") {
            ImportPreview::Parsed { brokerage, accounts } => (brokerage, accounts),
            other => panic!("not parsed: {other:?}"),
        }
    }

    #[test]
    fn money_formats() {
        assert_eq!(money("$1,234.56"), Some(1234.56));
        assert_eq!(money("(12.50)"), Some(-12.5));
        assert_eq!(money("-3"), Some(-3.0));
        assert_eq!(money("--"), None);
        assert_eq!(money("N/A"), None);
        assert_eq!(money(""), None);
    }

    #[test]
    fn schwab_positions_with_two_accounts() {
        let (b, accts) = parsed(&sample("schwab.csv"));
        assert_eq!(b, "Schwab");
        assert_eq!(accts.len(), 2);
        let ind = &accts[0];
        assert!(ind.name.contains("Individual"), "{}", ind.name);
        assert_eq!(ind.account.account_type, AccountType::Taxable);
        assert_eq!(ind.holdings.iter().map(|h| h.ticker.as_str()).collect::<Vec<_>>(), ["META", "VTI", "BND"]);
        assert_eq!(ind.holdings[0].shares, 1200.0);
        assert_eq!(ind.holdings[0].cost_basis, Some(150_000.0));
        assert_eq!(ind.cash, 12_345.67);
        assert!((ind.total - (771_144.0 + 285_000.0 + 72_400.0 + 12_345.67)).abs() < 0.01);
        // BND is a bond fund; cash is cash.
        assert!(ind.account.bonds_pct > 0.06 && ind.account.bonds_pct < 0.07);
        assert_eq!(accts[1].account.account_type, AccountType::RothIra);
        assert_eq!(accts[1].number_last4.as_deref(), Some("4567"));
    }

    #[test]
    fn fidelity_positions_grouped_by_account_column() {
        let (b, accts) = parsed(&sample("fidelity.csv"));
        assert_eq!(b, "Fidelity");
        assert_eq!(accts.len(), 2);
        assert_eq!(accts[0].account.account_type, AccountType::Taxable);
        assert_eq!(accts[1].account.account_type, AccountType::TradIra);
        // SPAXX** is the core money market: cash, not a holding. Pending activity is skipped.
        assert!(accts[0].holdings.iter().all(|h| h.ticker != "SPAXX"));
        assert_eq!(accts[0].cash, 25_000.0);
        assert_eq!(accts[0].holdings.len(), 2);
        assert_eq!(accts[0].holdings[1].cost_basis, Some(9_000.0));
    }

    #[test]
    fn vanguard_holdings_stop_before_transactions() {
        let (b, accts) = parsed(&sample("vanguard.csv"));
        assert_eq!(b, "Vanguard");
        assert_eq!(accts.len(), 1);
        let a = &accts[0];
        assert_eq!(a.holdings.len(), 2, "the transactions table below isn't positions");
        assert_eq!(a.cash, 4_000.0);
        assert_eq!(a.holdings[0].ticker, "VTSAX");
        assert!(a.holdings[1].description.contains("Bond"));
        assert_eq!(a.account.cost_basis, None, "Vanguard's holdings file has no cost basis");
    }

    #[test]
    fn merrill_and_morgan_stanley_column_names() {
        let (b, accts) = parsed(&sample("merrill.csv"));
        assert_eq!(b, "Merrill");
        assert_eq!(accts.len(), 1);
        assert_eq!(accts[0].holdings[0].ticker, "AAPL");
        assert_eq!(accts[0].holdings[0].cost_basis, Some(20_000.0));
        assert_eq!(accts[0].account.account_type, AccountType::TradIra);

        let (b, accts) = parsed(&sample("morgan_stanley.csv"));
        assert_eq!(b, "Morgan Stanley");
        assert_eq!(accts[0].holdings.len(), 2);
        assert_eq!(accts[0].cash, 50_000.0);
        assert_eq!(accts[0].holdings[1].value(), 105_000.0);
    }

    #[test]
    fn template_with_account_types() {
        let (b, accts) = parsed(&sample("template.csv"));
        assert_eq!(b, "Template");
        assert_eq!(accts.len(), 2);
        assert_eq!(accts[0].name, "Joint brokerage");
        assert_eq!(accts[1].account.account_type, AccountType::RothIra);
    }

    #[test]
    fn unknown_files_ask_for_a_mapping_then_parse() {
        let text = "Report,,,\nThing,Held,Worth,Paid\nAAPL,10,\"$2,500.00\",\"$1,000\"\nMSFT,5,\"$2,000.00\",\n";
        let ImportPreview::NeedsMapping { columns, header_row, sample } = parse(text, "my export.csv") else {
            panic!("expected a mapping request")
        };
        assert_eq!(header_row, 1);
        assert_eq!(columns[1], "Held");
        assert_eq!(sample.len(), 2);
        let m = ColumnMapping {
            header_row,
            symbol: Some(0),
            shares: Some(1),
            value: Some(2),
            cost_basis: Some(3),
            ..Default::default()
        };
        let ImportPreview::Parsed { accounts, .. } = parse_mapped(text, "my export.csv", &m) else { panic!() };
        assert_eq!(accounts[0].name, "my export");
        assert_eq!(accounts[0].holdings.len(), 2);
        assert_eq!(accounts[0].holdings[0].price, 250.0);
        assert_eq!(accounts[0].account.cost_basis, None, "MSFT has no basis");
    }

    #[test]
    fn account_type_guesses() {
        assert_eq!(guess_type("ROTH IRA ...1234"), AccountType::RothIra);
        assert_eq!(guess_type("Roth 401(k)"), AccountType::Roth401k);
        assert_eq!(guess_type("ROLLOVER IRA"), AccountType::TradIra);
        assert_eq!(guess_type("Company 401(k) plan"), AccountType::Trad401k);
        assert_eq!(guess_type("Individual - TOD"), AccountType::Taxable);
        assert_eq!(guess_type("Health Savings Account"), AccountType::Hsa);
    }

    #[test]
    fn applying_adds_and_updates_in_one_go() {
        let mut conn = crate::db::open_in_memory().unwrap();
        crate::db::replace_household(&mut conn, &crate::demo::household(crate::demo::Demo::Retiree)).unwrap();
        let (_, accts) = parsed(&sample("schwab.csv"));
        let before = crate::db::load_household(&conn).unwrap();
        apply(
            &mut conn,
            &[
                ImportChoice { account: accts[0].account.clone(), update_id: Some(1) },
                ImportChoice { account: accts[1].account.clone(), update_id: None },
            ],
        )
        .unwrap();
        let after = crate::db::load_household(&conn).unwrap();
        assert_eq!(after.accounts.len(), before.accounts.len() + 1);
        let updated = after.accounts.iter().find(|a| a.id == Some(1)).unwrap();
        assert_eq!(updated.name, before.accounts[0].name, "name kept");
        assert_eq!(updated.holdings.len(), 3, "holdings stored");
        assert!((updated.balance - accts[0].total).abs() < 0.01);
        let added = after.accounts.last().unwrap();
        assert_eq!(added.owner_id, Some(1), "new accounts belong to the main person");
        assert_eq!(added.account_type, AccountType::RothIra);
    }

    #[test]
    fn updating_keeps_what_the_file_doesnt_know() {
        let (_, accts) = parsed(&sample("schwab.csv"));
        let existing = Account {
            id: Some(7),
            name: "My brokerage".into(),
            owner_id: Some(1),
            annual_contribution: 5_000.0,
            notes: "keep".into(),
            ..accts[0].account.clone()
        };
        let updated = update_account(&existing, &accts[1].account);
        assert_eq!(updated.id, Some(7));
        assert_eq!(updated.name, "My brokerage");
        assert_eq!(updated.annual_contribution, 5_000.0);
        assert_eq!(updated.balance, accts[1].account.balance);
        assert!(updated.validate().is_ok());
    }
}
