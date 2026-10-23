//! Deterministic yearly projection ("Fixed" return mode).
//!
//! Each year, in order:
//! 1. Age everyone; work out income streams and Social Security.
//! 2. Make contributions (while the owner is still earning) and take RMDs.
//! 3. Pay spending, one-time expenses, and debt payments.
//! 4. Cover any shortfall by withdrawing cash → taxable → traditional → Roth/HSA,
//!    re-solving taxes until they converge (withdrawals create tax, which
//!    needs more withdrawals). Surpluses are saved to the brokerage account.
//! 5. Grow every account by its expected return.
//!
//! Simplifications (planning-grade): yearly steps, withdrawals at the start of
//! the year, all gains long-term, standard deduction only, no Roth/HSA
//! withdrawal restrictions, 529s and real estate are never sold.

// Sums use `fold(0.0, f64::add)` because `Iterator::sum` of an empty f64
// iterator is -0.0, which the UI would show as "-$0".
use std::ops::Add;

use serde::Serialize;

use crate::model::{Account, AccountType, Assumptions, Household, Id, IncomeKind, Person, Role};
use crate::social_security::claiming_factor;
use crate::tax::{self, TaxInput, TaxResult};
use crate::tax_tables::TaxTables;

/// How an account is taxed, which drives the withdrawal order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Bucket {
    Cash,
    Taxable,
    TaxDeferred,
    TaxFree,
    RealEstate,
    Education,
}

impl Bucket {
    pub fn of(t: AccountType) -> Bucket {
        use AccountType::*;
        match t {
            Checking | Savings => Bucket::Cash,
            Taxable | Crypto | Rsu | Espp | Options | LlcInterest => Bucket::Taxable,
            Trad401k | TradIra | Pension => Bucket::TaxDeferred,
            Roth401k | RothIra | Hsa => Bucket::TaxFree,
            RealEstate => Bucket::RealEstate,
            Plan529 => Bucket::Education,
        }
    }

    /// Can be spent from to cover living expenses.
    fn spendable(self) -> bool {
        !matches!(self, Bucket::RealEstate | Bucket::Education)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Balances {
    pub cash: f64,
    pub taxable: f64,
    pub tax_deferred: f64,
    pub tax_free: f64,
    pub real_estate: f64,
    pub education: f64,
}

impl Balances {
    /// Money that can be spent: everything except real estate and 529s.
    pub fn investable(&self) -> f64 {
        self.cash + self.taxable + self.tax_deferred + self.tax_free
    }

    pub fn total(&self) -> f64 {
        self.investable() + self.real_estate + self.education
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YearResult {
    pub year: i32,
    /// Age of the primary person at the end of this year.
    pub age: u32,
    // Money in
    pub earned_income: f64,
    pub other_income: f64,
    pub social_security: f64,
    /// Dividends and interest from taxable/cash accounts (reinvested).
    pub investment_income: f64,
    pub required_distributions: f64,
    pub withdrawals: f64,
    // Money out
    pub spending: f64,
    pub one_time_expenses: f64,
    pub debt_payments: f64,
    pub contributions: f64,
    pub taxes: f64,
    pub medicare_surcharge: f64,
    pub saved: f64,
    /// Spending that couldn't be paid because savings ran out.
    pub shortfall: f64,
    pub tax: TaxResult,
    // End of year
    pub balances: Balances,
    pub debt_balance: f64,
    pub net_worth: f64,
    /// Price level at the end of the year (today = 1.0); divide by it for today's dollars.
    pub price_level: f64,
}

impl YearResult {
    pub fn net_worth_real(&self) -> f64 {
        self.net_worth / self.price_level
    }

    pub fn investable_real(&self) -> f64 {
        self.balances.investable() / self.price_level
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub start_year: i32,
    pub start_age: u32,
    pub end_age: u32,
    pub starting_investable: f64,
    /// First age at which spending couldn't be paid. `None` = money lasts.
    pub runs_out_at_age: Option<u32>,
    /// First age at which savings (in today's dollars) fell below where they
    /// started: when you began spending principal. `None` = never.
    pub principal_dips_at_age: Option<u32>,
    /// Lowest spendable savings in today's dollars (never above the start).
    pub lowest_investable_real: f64,
    /// Age at that low point; `None` if savings never dip below the start.
    pub lowest_investable_age: Option<u32>,
    pub ending_net_worth_real: f64,
    pub ending_investable_real: f64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Projection {
    pub summary: Summary,
    pub years: Vec<YearResult>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ProjectionError {
    NoPrimaryPerson,
    Invalid(String),
}

impl std::fmt::Display for ProjectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProjectionError::NoPrimaryPerson => f.write_str("Add yourself on the People page to see a forecast."),
            ProjectionError::Invalid(m) => f.write_str(m),
        }
    }
}

/// Internal per-account state.
#[derive(Debug, Clone)]
struct Acct {
    bucket: Bucket,
    account_type: AccountType,
    owner_birth_year: i32,
    owner_id: Option<Id>,
    balance: f64,
    basis: f64,
    stocks: f64,
    bonds: f64,
    cash: f64,
    contribution: f64,
    employer_match: f64,
}

impl Acct {
    fn from(a: &Account, owner: &Person) -> Acct {
        Acct {
            bucket: Bucket::of(a.account_type),
            account_type: a.account_type,
            owner_birth_year: owner.birth_year,
            owner_id: a.owner_id,
            balance: a.balance,
            // Unknown basis: assume no gain, so we never invent tax.
            basis: a.cost_basis.unwrap_or(a.balance).min(a.balance.max(0.0)),
            stocks: a.stocks_pct,
            bonds: a.bonds_pct,
            cash: a.cash_pct,
            contribution: a.annual_contribution,
            employer_match: a.employer_match,
        }
    }

    fn total_return(&self, m: &MarketYear) -> f64 {
        match self.bucket {
            Bucket::Cash => m.cash,
            Bucket::RealEstate => m.real_estate,
            _ if self.account_type == AccountType::Pension => m.bonds,
            _ => self.stocks * m.stocks + self.bonds * m.bonds + self.cash * m.cash,
        }
    }

    /// Yearly taxable dividends and interest (only cash and taxable accounts are taxed on them).
    /// Dividend yield and bond coupons stay at assumption levels even when a year's total
    /// return swings, so a bond price drop never becomes "negative interest".
    fn yield_income(&self, r: &Assumptions, m: &MarketYear) -> (f64, f64) {
        match self.bucket {
            Bucket::Cash => (0.0, self.balance * m.cash.max(0.0)),
            Bucket::Taxable => {
                let pays_dividends = !matches!(self.account_type, AccountType::Crypto | AccountType::LlcInterest);
                let qualified = if pays_dividends { self.balance * self.stocks * r.stock_dividend_yield } else { 0.0 };
                let interest = self.balance * (self.bonds * r.bonds_return + self.cash * m.cash.max(0.0));
                (qualified, interest)
            }
            _ => (0.0, 0.0),
        }
    }
}

/// What a set of withdrawals did, for tax purposes.
#[derive(Debug, Clone, Default)]
struct Draw {
    total: f64,
    long_term_gains: f64,
    traditional: f64,
    early_traditional: f64,
    unmet: f64,
}

/// Withdraws `need` from spendable accounts in tax order. Mutates `accts`.
fn withdraw(accts: &mut [Acct], need: f64, year: i32, penalty_free_age: u32) -> Draw {
    let mut d = Draw::default();
    let mut remaining = need;
    for bucket in [Bucket::Cash, Bucket::Taxable, Bucket::TaxDeferred, Bucket::TaxFree] {
        for a in accts.iter_mut().filter(|a| a.bucket == bucket) {
            if remaining <= 0.0 {
                break;
            }
            let take = remaining.min(a.balance.max(0.0));
            if take <= 0.0 {
                continue;
            }
            if bucket == Bucket::Taxable && a.balance > 0.0 {
                let basis_share = a.basis / a.balance;
                d.long_term_gains += take * (1.0 - basis_share).max(0.0);
                a.basis -= take * basis_share;
            }
            if bucket == Bucket::Cash {
                a.basis -= take;
            }
            if bucket == Bucket::TaxDeferred {
                d.traditional += take;
                if ((year - a.owner_birth_year) as u32) < penalty_free_age {
                    d.early_traditional += take;
                }
            }
            a.balance -= take;
            d.total += take;
            remaining -= take;
        }
    }
    d.unmet = remaining.max(0.0);
    d
}

/// One year of market results: nominal total returns and inflation, as decimals.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketYear {
    pub stocks: f64,
    pub bonds: f64,
    pub cash: f64,
    pub real_estate: f64,
    pub inflation: f64,
}

impl MarketYear {
    /// The same every year: the "steady path".
    pub fn steady(a: &Assumptions) -> MarketYear {
        MarketYear {
            stocks: a.stocks_return,
            bonds: a.bonds_return,
            cash: a.cash_return,
            real_estate: a.real_estate_growth,
            inflation: a.inflation,
        }
    }
}

/// Number of years the plan covers starting at `start_year` (through the
/// last adult's plan-to age).
pub fn horizon_years(h: &Household, start_year: i32) -> Result<usize, ProjectionError> {
    let adults = h.people.iter().filter(|p| matches!(p.role, Role::Primary | Role::Spouse));
    let end_year =
        adults.map(|p| p.birth_year + p.life_expectancy as i32).max().ok_or(ProjectionError::NoPrimaryPerson)?;
    Ok((end_year - start_year + 1).max(0) as usize)
}

/// Runs the steady-path projection for `start_year` (normally the current calendar year).
pub fn project(h: &Household, start_year: i32) -> Result<Projection, ProjectionError> {
    let steady = MarketYear::steady(&h.assumptions);
    project_market(h, start_year, TaxTables::current(), |_| steady)
}

/// Runs the projection with `market(n)` supplying year `n`'s returns and inflation
/// (n = 0 is `start_year`).
pub fn project_market(
    h: &Household,
    start_year: i32,
    t: &TaxTables,
    market: impl Fn(usize) -> MarketYear,
) -> Result<Projection, ProjectionError> {
    h.validate().map_err(ProjectionError::Invalid)?;
    let primary = h.people.iter().find(|p| p.role == Role::Primary).ok_or(ProjectionError::NoPrimaryPerson)?;
    let adults: Vec<&Person> = h.people.iter().filter(|p| matches!(p.role, Role::Primary | Role::Spouse)).collect();
    let person = |id: Option<Id>| id.and_then(|id| h.people.iter().find(|p| p.id == Some(id))).unwrap_or(primary);

    let r = h.assumptions;
    let status = h.info.filing_status;
    let end_year = start_year + horizon_years(h, start_year)? as i32 - 1;
    let start_age = (start_year - primary.birth_year).max(0) as u32;

    let mut accts: Vec<Acct> = h.accounts.iter().map(|a| Acct::from(a, person(a.owner_id))).collect();
    // Surpluses go to the first brokerage account, else cash; add a cash
    // account if the household has neither.
    if !accts.iter().any(|a| a.bucket == Bucket::Cash || a.account_type == AccountType::Taxable) {
        accts.push(Acct {
            bucket: Bucket::Cash,
            account_type: AccountType::Savings,
            owner_birth_year: primary.birth_year,
            owner_id: primary.id,
            balance: 0.0,
            basis: 0.0,
            stocks: 0.0,
            bonds: 0.0,
            cash: 1.0,
            contribution: 0.0,
            employer_match: 0.0,
        });
    }
    let savings_target = accts
        .iter()
        .position(|a| a.account_type == AccountType::Taxable)
        .or_else(|| accts.iter().position(|a| a.bucket == Bucket::Cash))
        .unwrap();

    let mut debts: Vec<(f64, f64, f64)> =
        h.debts.iter().map(|d| (d.balance, d.interest_rate, d.monthly_payment * 12.0)).collect();

    let starting_investable: f64 = accts.iter().filter(|a| a.bucket.spendable()).map(|a| a.balance).fold(0.0, f64::add);
    let mut years = Vec::new();
    let mut magi_history: Vec<f64> = Vec::new();
    let mut price = 1.0; // start-of-year price level vs. today

    for year in start_year..=end_year {
        let n = year - start_year;
        let m = market(n as usize);
        let index = price * (1.0 + r.inflation).powi(start_year - t.year);
        let age_of = |p: &Person| (year - p.birth_year).max(0) as u32;
        let alive = |p: &Person| age_of(p) <= p.life_expectancy;

        // --- 1. Income ---
        let mut wages_by_person: Vec<f64> = vec![0.0; adults.len()];
        let (mut self_employment, mut rental, mut pension_and_other) = (0.0, 0.0, 0.0);
        let mut earners: Vec<Id> = Vec::new();
        for inc in &h.income {
            let p = person(inc.person_id);
            let age = age_of(p);
            let active = alive(p) && inc.start_age.is_none_or(|s| age >= s) && inc.end_age.is_none_or(|e| age < e);
            if !active {
                continue;
            }
            let amount = inc.annual_amount * (1.0 + inc.growth_rate).powi(n);
            match inc.kind {
                IncomeKind::W2 | IncomeKind::Bonus => {
                    let slot = adults.iter().position(|a| a.id == p.id).unwrap_or(0);
                    wages_by_person[slot] += amount;
                }
                IncomeKind::SelfEmployment => self_employment += amount,
                IncomeKind::Rental => rental += amount,
                IncomeKind::Pension | IncomeKind::Annuity | IncomeKind::Other => pension_and_other += amount,
            }
            if inc.kind.is_earned()
                && let Some(id) = p.id
            {
                earners.push(id);
            }
        }
        let wages: f64 = wages_by_person.iter().fold(0.0, f64::add);

        let social_security: f64 = adults
            .iter()
            .filter(|p| alive(p))
            .filter_map(|p| {
                let monthly = p.ss_monthly_benefit?;
                if p.ss_already_claiming {
                    Some(monthly * 12.0 * price)
                } else if age_of(p) >= p.ss_claim_age {
                    Some(monthly * 12.0 * claiming_factor(p.birth_year, p.ss_claim_age) * price)
                } else {
                    None
                }
            })
            .fold(0.0, f64::add);

        // --- 2. Contributions, investment income, RMDs ---
        let mut contributions = 0.0;
        let mut pretax_contributions = 0.0;
        let (mut qualified_dividends, mut interest) = (0.0, 0.0);
        let mut rmd_total = 0.0;
        for a in accts.iter_mut() {
            let (q, i) = a.yield_income(&r, &m);
            qualified_dividends += q;
            interest += i;
            a.basis += q + i; // reinvested

            let owner_earning = a.owner_id.or(primary.id).is_some_and(|id| earners.contains(&id));
            if owner_earning && (a.contribution > 0.0 || a.employer_match > 0.0) {
                let own = a.contribution * price;
                contributions += own;
                if matches!(a.account_type, AccountType::Trad401k | AccountType::TradIra | AccountType::Hsa) {
                    pretax_contributions += own;
                }
                a.balance += own + a.employer_match * price;
                if a.bucket == Bucket::Taxable || a.bucket == Bucket::Cash {
                    a.basis += own;
                }
            }

            if a.bucket == Bucket::TaxDeferred {
                let age = (year - a.owner_birth_year).max(0) as u32;
                if age >= t.rmd_start_age(a.owner_birth_year)
                    && let Some(div) = t.rmd_divisor(age)
                {
                    let rmd = (a.balance / div).min(a.balance);
                    a.balance -= rmd;
                    rmd_total += rmd;
                }
            }
        }

        // --- 3. Spending and debts ---
        let spending = h.info.base_annual_spending * price;
        let one_time: f64 =
            h.one_time_expenses.iter().filter(|x| x.year == year).map(|x| x.amount * price).fold(0.0, f64::add);
        let mut debt_payments = 0.0;
        for (balance, rate, payment) in debts.iter_mut() {
            if *balance <= 0.0 {
                continue;
            }
            let interest_due = *balance * *rate;
            let pay = payment.min(*balance + interest_due);
            *balance = (*balance + interest_due - pay).max(0.0);
            debt_payments += pay;
        }

        let on_medicare = adults.iter().filter(|p| alive(p) && age_of(p) >= t.irmaa.medicare_age).count() as f64;
        let filers_65_plus = on_medicare as u32;
        let children_under_17 =
            h.people.iter().filter(|p| p.role == Role::Child && age_of(p) < t.child_tax_credit.under_age).count()
                as u32;

        let base_in = wages + self_employment + rental + pension_and_other + social_security + rmd_total;
        let base_out = spending + one_time + debt_payments + contributions;

        let tax_for = |d: &Draw| {
            tax::compute(
                t,
                &TaxInput {
                    year,
                    filing_status: status,
                    index,
                    wages_by_person: wages_by_person.clone(),
                    pretax_contributions,
                    self_employment,
                    pension_and_other,
                    rental,
                    interest,
                    qualified_dividends,
                    long_term_gains: d.long_term_gains,
                    traditional_distributions: rmd_total + d.traditional,
                    early_distributions: d.early_traditional,
                    social_security_benefits: social_security,
                    filers_65_plus,
                    children_under_17,
                    state_rate: h.info.flat_state_rate,
                },
            )
        };
        let irmaa_for = |magi: f64| {
            let lookback = if magi_history.len() >= 2 { magi_history[magi_history.len() - 2] } else { magi };
            tax::irmaa_monthly(t, status, lookback, index) * 12.0 * on_medicare
        };

        // --- 4. Solve withdrawals and taxes together ---
        let mut draw = Draw::default();
        let mut tax_result = tax_for(&draw);
        let mut irmaa = irmaa_for(tax_result.agi);
        let mut trial = accts.clone();
        for _ in 0..50 {
            let need = base_out + tax_result.total + irmaa - base_in;
            trial = accts.clone();
            let next = if need > 0.0 {
                withdraw(&mut trial, need, year, t.early_withdrawal.penalty_free_age)
            } else {
                Draw::default()
            };
            let converged = (next.total - draw.total).abs() < 0.01 && (next.unmet - draw.unmet).abs() < 0.01;
            draw = next;
            tax_result = tax_for(&draw);
            irmaa = irmaa_for(tax_result.agi);
            if converged {
                break;
            }
        }
        accts = trial;
        let surplus = (base_in + draw.total - base_out - tax_result.total - irmaa - draw.unmet).max(0.0);
        if surplus > 0.0 && draw.total <= 0.0 {
            let target = &mut accts[savings_target];
            target.balance += surplus;
            target.basis += surplus;
        }
        magi_history.push(tax_result.agi);

        // --- 5. Growth ---
        for a in accts.iter_mut() {
            a.balance *= 1.0 + a.total_return(&m);
        }
        price *= 1.0 + m.inflation;

        let mut balances = Balances::default();
        for a in &accts {
            let slot = match a.bucket {
                Bucket::Cash => &mut balances.cash,
                Bucket::Taxable => &mut balances.taxable,
                Bucket::TaxDeferred => &mut balances.tax_deferred,
                Bucket::TaxFree => &mut balances.tax_free,
                Bucket::RealEstate => &mut balances.real_estate,
                Bucket::Education => &mut balances.education,
            };
            *slot += a.balance;
        }
        let debt_balance: f64 = debts.iter().map(|d| d.0).fold(0.0, f64::add);

        years.push(YearResult {
            year,
            age: (year - primary.birth_year).max(0) as u32,
            earned_income: wages + self_employment,
            other_income: rental + pension_and_other,
            social_security,
            investment_income: qualified_dividends + interest,
            required_distributions: rmd_total,
            withdrawals: draw.total,
            spending,
            one_time_expenses: one_time,
            debt_payments,
            contributions,
            taxes: tax_result.total,
            medicare_surcharge: irmaa,
            saved: if draw.total <= 0.0 { surplus } else { 0.0 },
            shortfall: draw.unmet,
            tax: tax_result,
            net_worth: balances.total() - debt_balance,
            balances,
            debt_balance,
            price_level: price,
        });
    }

    let last = years.last().cloned().unwrap_or_default();
    let lowest = years.iter().min_by(|a, b| a.investable_real().total_cmp(&b.investable_real()));
    let summary = Summary {
        lowest_investable_real: lowest.map_or(starting_investable, |y| y.investable_real().min(starting_investable)),
        lowest_investable_age: lowest.filter(|y| y.investable_real() < starting_investable).map(|y| y.age),
        start_year,
        start_age,
        end_age: last.age,
        starting_investable,
        runs_out_at_age: years.iter().find(|y| y.shortfall > 1.0).map(|y| y.age),
        principal_dips_at_age: years.iter().find(|y| y.investable_real() < starting_investable * 0.999).map(|y| y.age),
        ending_net_worth_real: last.net_worth_real(),
        ending_investable_real: last.investable_real(),
    };
    Ok(Projection { summary, years })
}

/// Outcome of claiming Social Security at one age, for the comparison card.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimAgeOutcome {
    pub claim_age: u32,
    pub is_current_choice: bool,
    /// Monthly check at that claiming age, in today's dollars.
    pub monthly_benefit_today: f64,
    /// Total benefits received over the plan, in today's dollars.
    pub lifetime_benefits_real: f64,
    pub ending_net_worth_real: f64,
    pub runs_out_at_age: Option<u32>,
}

/// Re-runs the projection with the primary person claiming at each possible age.
/// Empty if they're already claiming or have no benefit entered.
pub fn compare_claim_ages(h: &Household, start_year: i32) -> Result<Vec<ClaimAgeOutcome>, ProjectionError> {
    let primary = h.people.iter().find(|p| p.role == Role::Primary).ok_or(ProjectionError::NoPrimaryPerson)?;
    if primary.ss_already_claiming || primary.ss_monthly_benefit.is_none() {
        return Ok(Vec::new());
    }
    let age_now = (start_year - primary.birth_year).max(0) as u32;
    (62..=70u32)
        .filter(|&a| a >= age_now.min(70))
        .map(|claim_age| {
            let mut variant = h.clone();
            for p in variant.people.iter_mut().filter(|p| p.role == Role::Primary) {
                p.ss_claim_age = claim_age;
            }
            let proj = project(&variant, start_year)?;
            Ok(ClaimAgeOutcome {
                claim_age,
                is_current_choice: claim_age == primary.ss_claim_age,
                monthly_benefit_today: primary.ss_monthly_benefit.unwrap_or(0.0)
                    * claiming_factor(primary.birth_year, claim_age),
                lifetime_benefits_real: proj
                    .years
                    .iter()
                    .map(|y| y.social_security / (y.price_level / (1.0 + h.assumptions.inflation)))
                    .fold(0.0, f64::add),
                ending_net_worth_real: proj.summary.ending_net_worth_real,
                runs_out_at_age: proj.summary.runs_out_at_age,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{DebtKind, FilingStatus, HouseholdInfo, IncomeStream, OneTimeExpense};

    fn me(birth_year: i32) -> Person {
        Person {
            id: Some(1),
            name: "Me".into(),
            birth_year,
            role: Role::Primary,
            life_expectancy: 100,
            ss_monthly_benefit: None,
            ss_claim_age: 67,
            ss_already_claiming: false,
        }
    }

    fn account(t: AccountType, balance: f64, basis: Option<f64>, stocks: f64) -> Account {
        let (s, b, c) =
            if crate::model::AccountType::has_allocation(t) { (stocks, 1.0 - stocks, 0.0) } else { (0.0, 0.0, 1.0) };
        Account {
            id: None,
            name: format!("{t:?}"),
            account_type: t,
            owner_id: Some(1),
            balance,
            cost_basis: basis,
            stocks_pct: s,
            bonds_pct: b,
            cash_pct: c,
            annual_contribution: 0.0,
            employer_match: 0.0,
            notes: String::new(),
        }
    }

    fn household(people: Vec<Person>, accounts: Vec<Account>, spending: f64) -> Household {
        Household {
            info: HouseholdInfo { base_annual_spending: spending, ..Default::default() },
            people,
            accounts,
            ..Default::default()
        }
    }

    fn close(a: f64, b: f64, tol: f64) {
        assert!((a - b).abs() <= tol, "expected {b}, got {a}");
    }

    #[test]
    fn requires_a_primary_person() {
        let h = Household::default();
        assert_eq!(project(&h, 2026).unwrap_err(), ProjectionError::NoPrimaryPerson);
    }

    #[test]
    fn runs_to_life_expectancy() {
        let h = household(vec![me(1960)], vec![account(AccountType::Savings, 10_000.0, None, 0.0)], 0.0);
        let p = project(&h, 2026).unwrap();
        assert_eq!(p.years.first().unwrap().age, 66);
        assert_eq!(p.years.last().unwrap().age, 100);
        assert_eq!(p.years.len(), 35);
    }

    #[test]
    fn untouched_roth_compounds_at_its_return() {
        // No spending, no income, a Roth at 100% stocks: grows exactly 7%/yr, no tax.
        let h = household(vec![me(1980)], vec![account(AccountType::RothIra, 100_000.0, None, 1.0)], 0.0);
        let p = project(&h, 2026).unwrap();
        close(p.years[9].balances.tax_free, 100_000.0 * 1.07f64.powi(10), 0.01);
        assert!(p.years.iter().all(|y| y.taxes == 0.0));
    }

    #[test]
    fn withdrawals_cover_spending_and_their_own_taxes() {
        // 50-year-old (penalty applies) living off a traditional IRA.
        let h = household(vec![me(1976)], vec![account(AccountType::TradIra, 2_000_000.0, None, 0.6)], 60_000.0);
        let y = &project(&h, 2026).unwrap().years[0];
        // Withdrawal pays spending + income tax + 10% penalty exactly.
        close(y.withdrawals, y.spending + y.taxes, 0.05);
        assert!(y.tax.early_withdrawal_penalty > 0.0);
        close(y.tax.early_withdrawal_penalty, 0.10 * y.withdrawals, 0.05);
    }

    #[test]
    fn withdraws_cash_then_taxable_then_traditional() {
        let h = household(
            vec![me(1960)],
            vec![
                account(AccountType::TradIra, 500_000.0, None, 0.6),
                account(AccountType::Taxable, 100_000.0, Some(50_000.0), 1.0),
                account(AccountType::Checking, 20_000.0, None, 0.0),
            ],
            50_000.0,
        );
        let y = &project(&h, 2026).unwrap().years[0];
        // Cash (20k) is gone, then ~30k+ from taxable; IRA untouched (66, no RMD until 75).
        assert_eq!(y.required_distributions, 0.0);
        assert_eq!(y.tax.early_withdrawal_penalty, 0.0);
        close(y.balances.cash, 0.0, 0.01);
        close(y.balances.tax_deferred, 500_000.0 * 1.058, 0.01);
        assert!(y.tax.capital_gains_tax == 0.0, "small gains fall in the 0% bracket");
        assert!(y.balances.taxable < 100_000.0);
    }

    #[test]
    fn rmds_start_at_73_for_1959_births() {
        let h = household(vec![me(1959)], vec![account(AccountType::TradIra, 1_000_000.0, None, 0.6)], 0.0);
        let p = project(&h, 2026).unwrap();
        let at = |age: u32| p.years.iter().find(|y| y.age == age).unwrap();
        assert_eq!(at(72).required_distributions, 0.0);
        let bal_start_73 = at(72).balances.tax_deferred;
        close(at(73).required_distributions, bal_start_73 / 26.5, 0.01);
        // RMD isn't needed for spending, so it's saved (after tax).
        assert!(at(73).saved > 0.0);
    }

    #[test]
    fn social_security_starts_at_claim_age_with_adjustment() {
        let mut p = me(1965);
        p.ss_monthly_benefit = Some(2_000.0);
        p.ss_claim_age = 70;
        let h = household(vec![p], vec![account(AccountType::Savings, 100_000.0, None, 0.0)], 0.0);
        let proj = project(&h, 2026).unwrap();
        let at = |age: u32| proj.years.iter().find(|y| y.age == age).unwrap();
        assert_eq!(at(69).social_security, 0.0);
        // 2,000 × 12 × 1.24, inflated from 2026 to the start of the year they turn 70 (2035).
        close(at(70).social_security, 24_000.0 * 1.24 * 1.025f64.powi(9), 0.01);
    }

    #[test]
    fn running_out_is_reported() {
        let h = household(vec![me(1960)], vec![account(AccountType::Checking, 100_000.0, None, 0.0)], 50_000.0);
        let p = project(&h, 2026).unwrap();
        // 66: 100k - 50k = 50k → grows to 51k. 67: spending is 51,250 → 250 short.
        assert_eq!(p.summary.runs_out_at_age, Some(67));
        assert_eq!(p.summary.principal_dips_at_age, Some(66));
        assert_eq!(p.summary.lowest_investable_real, 0.0);
    }

    #[test]
    fn lowest_point_is_reported_only_when_savings_dip() {
        let h = household(vec![me(1980)], vec![account(AccountType::RothIra, 100_000.0, None, 1.0)], 0.0);
        let s = project(&h, 2026).unwrap().summary;
        assert_eq!((s.lowest_investable_age, s.lowest_investable_real), (None, 100_000.0));
    }

    #[test]
    fn contributions_stop_when_work_stops() {
        let mut a = account(AccountType::Trad401k, 0.0, None, 1.0);
        a.annual_contribution = 10_000.0;
        a.employer_match = 5_000.0;
        let mut h = household(vec![me(1996)], vec![a, account(AccountType::Checking, 0.0, None, 0.0)], 0.0);
        h.income.push(IncomeStream {
            id: None,
            person_id: Some(1),
            kind: IncomeKind::W2,
            name: "Job".into(),
            annual_amount: 80_000.0,
            growth_rate: 0.0,
            start_age: None,
            end_age: Some(32),
        });
        let p = project(&h, 2026).unwrap();
        assert_eq!(p.years[0].contributions, 10_000.0);
        assert!(p.years[0].tax.agi < 80_000.0, "pre-tax 401(k) lowers AGI");
        let at32 = p.years.iter().find(|y| y.age == 32).unwrap();
        assert_eq!(at32.contributions, 0.0);
        assert_eq!(at32.earned_income, 0.0);
    }

    #[test]
    fn debts_amortize_and_stop() {
        let mut h = household(vec![me(1980)], vec![account(AccountType::Checking, 100_000.0, None, 0.0)], 0.0);
        h.debts.push(crate::model::Debt {
            id: None,
            name: "Car".into(),
            kind: DebtKind::Auto,
            balance: 10_000.0,
            interest_rate: 0.0,
            monthly_payment: 500.0,
            account_id: None,
            notes: String::new(),
        });
        let p = project(&h, 2026).unwrap();
        assert_eq!(p.years[0].debt_payments, 6_000.0);
        assert_eq!(p.years[1].debt_payments, 4_000.0);
        assert_eq!(p.years[2].debt_payments, 0.0);
        assert_eq!(p.years[1].debt_balance, 0.0);
    }

    #[test]
    fn one_time_expenses_are_inflated() {
        let mut h = household(vec![me(1980)], vec![account(AccountType::Checking, 500_000.0, None, 0.0)], 0.0);
        h.one_time_expenses.push(OneTimeExpense { id: None, name: "Roof".into(), year: 2028, amount: 30_000.0 });
        let p = project(&h, 2026).unwrap();
        close(p.years[2].one_time_expenses, 30_000.0 * 1.025f64.powi(2), 0.01);
        assert_eq!(p.years[1].one_time_expenses, 0.0);
    }

    #[test]
    fn claim_age_comparison_covers_remaining_ages() {
        let mut p = me(1959);
        p.ss_monthly_benefit = Some(3_000.0);
        p.ss_claim_age = 70;
        let h = household(vec![p], vec![account(AccountType::Taxable, 1_000_000.0, Some(800_000.0), 0.6)], 60_000.0);
        let out = compare_claim_ages(&h, 2026).unwrap();
        assert_eq!(out.iter().map(|o| o.claim_age).collect::<Vec<_>>(), vec![67, 68, 69, 70]);
        assert!(out.iter().find(|o| o.claim_age == 70).unwrap().is_current_choice);
        // Living to 100, waiting pays more in total.
        assert!(out[3].lifetime_benefits_real > out[0].lifetime_benefits_real);
    }

    #[test]
    fn married_joint_status_is_used() {
        let mut h = household(vec![me(1980)], vec![account(AccountType::Checking, 0.0, None, 0.0)], 0.0);
        h.info.filing_status = FilingStatus::MarriedJoint;
        h.income.push(IncomeStream {
            id: None,
            person_id: Some(1),
            kind: IncomeKind::W2,
            name: "Job".into(),
            annual_amount: 100_000.0,
            growth_rate: 0.0,
            start_age: None,
            end_age: None,
        });
        let y = &project(&h, 2026).unwrap().years[0];
        close(y.tax.deduction, 32_200.0, 0.01);
    }
}
