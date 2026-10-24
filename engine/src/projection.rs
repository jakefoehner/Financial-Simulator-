//! Deterministic yearly projection ("Fixed" return mode).
//!
//! Each year, in order:
//! 1. Age everyone; work out income streams and Social Security.
//! 2. Make contributions (while the owner is still earning) and take RMDs.
//! 3. Pay spending, one-time expenses, and debt payments.
//!    Scenario decisions happen here too: gifts, family loans (money out, then
//!    repayments in), Roth conversions, spending changes, charity, 529s and
//!    tuition, a family LLC (yearly discounted gifts) and GRATs (annuity back,
//!    growth to the kids).
//! 4. Cover any shortfall by withdrawing cash → taxable → traditional → Roth/HSA,
//!    re-solving taxes until they converge (withdrawals create tax, which
//!    needs more withdrawals). Surpluses are saved to the brokerage account.
//! 5. Grow every account by its expected return.
//!
//! Simplifications (planning-grade): yearly steps, withdrawals at the start of
//! the year, all gains long-term, no Roth/HSA withdrawal restrictions, 529s and
//! real estate are never sold. Itemized deductions are taken when larger than
//! the standard deduction; charity above the AGI limits carries forward 5 years.

// Sums use `fold(0.0, f64::add)` because `Iterator::sum` of an empty f64
// iterator is -0.0, which the UI would show as "-$0".
use std::ops::Add;

use serde::Serialize;

use crate::estate::{self, EstateResult};
use crate::model::{
    Account, AccountType, Assumptions, Event, Household, Id, IncomeKind, LoanTerms, Person, PrivateTerms, Role,
};
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
    /// Private funds and startups: illiquid until they pay out.
    Private,
    /// Your share of a family LLC set up in a plan (not spendable; gifted to the kids over time).
    FamilyLlc,
    /// Assets in a GRAT during its term (still yours for estate purposes; not spendable).
    Grat,
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
            RealEstateFund | PrivateCredit | Startup | OtherAlternative => Bucket::Private,
        }
    }

    /// Can be spent from to cover living expenses.
    fn spendable(self) -> bool {
        !matches!(self, Bucket::RealEstate | Bucket::Education | Bucket::Private | Bucket::FamilyLlc | Bucket::Grat)
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
    /// Family loans still owed to you (counted in net worth and the estate, not spendable).
    pub loans_receivable: f64,
    /// Private funds and startups (counted in net worth, not spendable until they pay out).
    pub private: f64,
    /// Your remaining share of a family LLC.
    pub family_llc: f64,
    /// Assets inside GRATs that haven't finished their term.
    pub grats: f64,
}

impl Balances {
    /// Money that can be spent: everything except real estate and 529s.
    pub fn investable(&self) -> f64 {
        self.cash + self.taxable + self.tax_deferred + self.tax_free
    }

    pub fn total(&self) -> f64 {
        self.investable()
            + self.real_estate
            + self.education
            + self.loans_receivable
            + self.private
            + self.family_llc
            + self.grats
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
    /// Gifts this year (cash, down payments, forgiven loan principal), total and per child.
    pub gifts: f64,
    pub gifts_by_child: Vec<ChildAmount>,
    /// Per child: the money flows a linked child plan receives from this plan.
    pub transfers_by_child: Vec<ChildTransfer>,
    /// Money that arrived from a parent's plan this year (gifts, 529s, loans, inheritance).
    pub received_from_parent: f64,
    /// Gift tax paid this year (only once the lifetime exemption is used up).
    pub gift_tax: f64,
    /// Cash given this year (gifts and down payments; excludes forgiven loan principal).
    pub cash_gifts: f64,
    /// Money lent to family this year.
    pub loans_made: f64,
    /// Loan payments received this year (interest + principal).
    pub loan_receipts: f64,
    pub roth_conversion: f64,
    /// Running total of gifts above the yearly exclusions (uses up the lifetime exemption).
    pub lifetime_taxable_gifts: f64,
    /// Blended return of the spendable portfolio this year.
    pub portfolio_return: f64,
    /// Cash paid out by private funds this year, and proceeds from any that sold.
    pub private_income: f64,
    pub private_proceeds: f64,
    /// Gifts locked in under the exemption so far (the anti-clawback amount).
    pub sheltered_gifts: f64,
    /// Given to charity or a donor-advised fund this year (cash plus investments at market value).
    pub charity: f64,
    /// The cash part of `charity`.
    pub charity_cash: f64,
    /// Charity above the AGI limits, carried forward to later years.
    pub charity_carryforward: f64,
    /// Put into 529s and paid directly for tuition or medical bills.
    pub education: f64,
    /// 529 superfunding not yet counted against the yearly exclusions (pulled back into the
    /// estate if you die within the five years).
    pub superfund_pending: f64,
    /// Family LLC shares given to the kids this year (full value; the gift is reported at a discount).
    pub llc_gifts: f64,
    /// How much lower your remaining LLC share is valued for estate tax (once you no longer control it).
    pub llc_discount: f64,
    /// What finished GRATs passed to the kids this year.
    pub grat_remainders: f64,
    pub tax: TaxResult,
    // End of year
    pub balances: Balances,
    pub debt_balance: f64,
    pub net_worth: f64,
    /// Price level at the end of the year (today = 1.0); divide by it for today's dollars.
    pub price_level: f64,
}

/// What one child receives from this plan in a year, as a linked child plan needs it
/// (nominal dollars). Forgiven loan principal isn't here: it shows up as smaller payments.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildTransfer {
    pub child_id: Id,
    pub cash: f64,
    pub assets: f64,
    pub assets_basis: f64,
    pub education: f64,
    pub paid_for_you: f64,
    pub loan_in: f64,
    pub loan_payment: f64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildAmount {
    pub child_id: Id,
    pub amount: f64,
    /// Cost basis the child receives (equal to `amount` for cash; your basis for gifted investments).
    pub basis: f64,
    /// Part of `amount` that grows tax-free for the child (529s).
    pub tax_free: f64,
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
    /// Estate and what the family receives, at the estate age.
    pub estate: EstateResult,
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
    UnknownScenario,
}

impl std::fmt::Display for ProjectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProjectionError::NoPrimaryPerson => f.write_str("Add yourself on the People page to see a forecast."),
            ProjectionError::Invalid(m) => f.write_str(m),
            ProjectionError::UnknownScenario => f.write_str("That scenario no longer exists."),
        }
    }
}

/// How a transfer reaches a child, for a linked child plan.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Via {
    Cash,
    Assets,
    Education,
    PaidForYou,
    /// Forgiven loan principal (seen by the child as smaller payments) or a superfund spread:
    /// counts in the gift ledger only.
    LedgerOnly,
}

/// One year's transfers to the children: what each receives (`gifts`), what's reported as a
/// gift (`reported`: tuition and medical payments aren't gifts, 529 superfunding is spread over
/// five years, LLC shares are valued at a discount, and a GRAT's remainder was already valued
/// at about zero when it was set up), and the flows a linked child plan needs (`transfers`).
#[derive(Default)]
struct Ledger {
    gifts: Vec<ChildAmount>,
    reported: Vec<(Id, f64)>,
    transfers: Vec<ChildTransfer>,
}

impl Ledger {
    fn give(&mut self, to: Id, amount: f64, basis: f64, report: f64, tax_free: f64, via: Via) {
        if report > 0.0 {
            match self.reported.iter_mut().find(|r| r.0 == to) {
                Some(r) => r.1 += report,
                None => self.reported.push((to, report)),
            }
        }
        if amount <= 0.0 {
            return;
        }
        match self.gifts.iter_mut().find(|g| g.child_id == to) {
            Some(g) => {
                g.amount += amount;
                g.basis += basis;
                g.tax_free += tax_free;
            }
            None => self.gifts.push(ChildAmount { child_id: to, amount, basis, tax_free }),
        }
        let t = self.transfer(to);
        match via {
            Via::Cash => t.cash += amount,
            Via::Assets => {
                t.assets += amount;
                t.assets_basis += basis;
            }
            Via::Education => t.education += amount,
            Via::PaidForYou => t.paid_for_you += amount,
            Via::LedgerOnly => {}
        }
    }

    fn transfer(&mut self, to: Id) -> &mut ChildTransfer {
        let i = match self.transfers.iter().position(|t| t.child_id == to) {
            Some(i) => i,
            None => {
                self.transfers.push(ChildTransfer { child_id: to, ..Default::default() });
                self.transfers.len() - 1
            }
        };
        &mut self.transfers[i]
    }
}

/// Index of the first account of `account_type`, adding an empty one (80/20 stocks/bonds)
/// owned by `owner` if there's none. Used for money arriving from a parent's plan.
fn holding(accts: &mut Vec<Acct>, account_type: AccountType, owner: &Person) -> usize {
    if let Some(i) = accts.iter().position(|a| a.account_type == account_type && a.private.is_none()) {
        return i;
    }
    accts.push(Acct {
        bucket: Bucket::of(account_type),
        account_type,
        owner_birth_year: owner.birth_year,
        owner_id: owner.id,
        balance: 0.0,
        basis: 0.0,
        stocks: 0.8,
        bonds: 0.2,
        cash: 0.0,
        contribution: 0.0,
        employer_match: 0.0,
        private: None,
        llc: None,
        grat: None,
    });
    accts.len() - 1
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
    private: Option<PrivateState>,
    llc: Option<LlcState>,
    grat: Option<GratState>,
}

/// A family LLC: this account holds your share of it.
#[derive(Debug, Clone)]
struct LlcState {
    /// Index of the event that created it.
    event: usize,
    /// Your share of the LLC (1.0 at the start).
    share: f64,
    discount: f64,
}

/// One GRAT during its term.
#[derive(Debug, Clone)]
struct GratState {
    event: usize,
    /// Fixed yearly payment back to you.
    annuity: f64,
    years_left: u32,
    /// Account the payments go back to when not rolled into a new GRAT.
    home: usize,
    /// Keep rolling payments into new GRATs through this age.
    roll_until: Option<u32>,
}

/// Running state of one private investment.
#[derive(Debug, Clone)]
struct PrivateState {
    terms: PrivateTerms,
    /// What payouts are based on (what was invested, less any defaults).
    invested: f64,
    /// Market adjustment so far vs. the assumptions (real estate / stocks replayed history).
    market_factor: f64,
    /// Startups: this scenario's payout relative to the expected multiple.
    startup_multiplier: f64,
    exited: bool,
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
            private: a.private.as_ref().map(|terms| PrivateState {
                terms: terms.clone(),
                invested: a.cost_basis.unwrap_or(a.balance),
                market_factor: 1.0,
                startup_multiplier: 1.0,
                exited: false,
            }),
            llc: None,
            grat: None,
        }
    }

    /// A new holding of `amount` (with `basis`) invested like `self`, in `bucket`.
    fn carve(&self, bucket: Bucket, amount: f64, basis: f64) -> Acct {
        Acct {
            bucket,
            balance: amount,
            basis,
            contribution: 0.0,
            employer_match: 0.0,
            private: None,
            llc: None,
            grat: None,
            ..self.clone()
        }
    }

    /// Takes up to `amount` out of this account in kind; returns (value, cost basis) taken.
    fn take_in_kind(&mut self, amount: f64) -> (f64, f64) {
        let take = amount.min(self.balance.max(0.0));
        if take <= 0.0 {
            return (0.0, 0.0);
        }
        let basis = take * (self.basis / self.balance).clamp(0.0, 1.0);
        self.balance -= take;
        self.basis -= basis;
        (take, basis)
    }

    fn total_return(&self, m: &MarketYear) -> f64 {
        match self.bucket {
            // Private investments move in their own step (payouts and exits).
            Bucket::Private => 0.0,
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
            // A family LLC and a GRAT are taxed to you (a grantor trust): their income is yours.
            Bucket::Taxable | Bucket::FamilyLlc | Bucket::Grat => {
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

/// Random outcomes for private investments in one scenario. The steady path uses
/// `PrivateOutcomes::default()`: every startup account pays its expected multiple and
/// private credit never defaults.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PrivateOutcomes {
    /// Per account (in `Household::accounts` order): startup payout relative to its expected multiple.
    pub startup_multiplier: Vec<f64>,
    /// Per plan year: share of private-credit principal lost to defaults.
    pub credit_loss: Vec<f64>,
}

impl PrivateOutcomes {
    fn startup(&self, account: usize) -> f64 {
        self.startup_multiplier.get(account).copied().unwrap_or(1.0)
    }

    fn credit(&self, year: usize) -> f64 {
        self.credit_loss.get(year).copied().unwrap_or(0.0)
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

/// The decisions in `scenario` (`None` = the base plan, no decisions).
pub fn events_for(h: &Household, scenario: Option<Id>) -> Result<Vec<Event>, ProjectionError> {
    match scenario {
        None => Ok(Vec::new()),
        Some(id) => h.scenario(id).map(|s| s.events.clone()).ok_or(ProjectionError::UnknownScenario),
    }
}

/// Runs the steady-path projection for `start_year` (normally the current calendar year).
pub fn project(h: &Household, scenario: Option<Id>, start_year: i32) -> Result<Projection, ProjectionError> {
    let steady = MarketYear::steady(&h.assumptions);
    project_market(h, &events_for(h, scenario)?, start_year, TaxTables::current(), &PrivateOutcomes::default(), |_| {
        steady
    })
}

/// Decisions that simply change an input, applied before the yearly loop.
fn apply_input_events(h: &Household, events: &[Event]) -> Household {
    let mut h = h.clone();
    for e in events {
        if let Event::SocialSecurityAge { age } = e {
            for p in h.people.iter_mut().filter(|p| p.role == Role::Primary) {
                p.ss_claim_age = *age;
                p.ss_already_claiming = false;
            }
        }
    }
    h
}

/// A family loan being repaid.
#[derive(Debug, Clone)]
struct Loan {
    to: Id,
    balance: f64,
    rate: f64,
    /// Fixed yearly payment for amortizing loans (nominal).
    payment: f64,
    years_left: u32,
    interest_only: bool,
    forgive: f64,
}

impl Loan {
    fn new(to: Id, terms: &LoanTerms, price: f64) -> Loan {
        let amount = terms.amount * price;
        let n = terms.years.max(1) as i32;
        let r = terms.rate;
        let payment = if r == 0.0 { amount / n as f64 } else { amount * r / (1.0 - (1.0 + r).powi(-n)) };
        Loan {
            to,
            balance: amount,
            rate: r,
            payment,
            years_left: terms.years.max(1),
            interest_only: terms.interest_only,
            forgive: terms.forgive_per_year * price,
        }
    }

    /// One year of repayment: returns (interest received, principal received, principal forgiven).
    fn year(&mut self) -> (f64, f64, f64) {
        if self.balance <= 0.0 || self.years_left == 0 {
            return (0.0, 0.0, 0.0);
        }
        let interest = self.balance * self.rate;
        let forgiven = self.forgive.min(self.balance);
        self.balance -= forgiven;
        let principal = if self.years_left == 1 {
            self.balance
        } else if self.interest_only {
            0.0
        } else {
            (self.payment - interest).max(0.0).min(self.balance)
        };
        self.balance -= principal;
        self.years_left -= 1;
        (interest, principal, forgiven)
    }
}

/// A new GRAT of `amount` funded from `src`, paying back a level annuity whose present value
/// at the §7520 rate equals what went in (a "zeroed-out" GRAT: the gift is about $0).
#[allow(clippy::too_many_arguments)]
fn new_grat(
    src: &Acct,
    amount: f64,
    basis: f64,
    term: u32,
    rate: f64,
    event: usize,
    home: usize,
    roll_until: Option<u32>,
) -> Acct {
    let n = term.max(1) as i32;
    let annuity = if rate == 0.0 { amount / n as f64 } else { amount * rate / (1.0 - (1.0 + rate).powi(-n)) };
    let mut g = src.carve(Bucket::Grat, amount, basis);
    g.grat = Some(GratState { event, annuity, years_left: term.max(1), home, roll_until });
    g
}

/// The plan's charitable bequest, if any: (share of the estate, IRA money first).
fn charitable_bequest(events: &[Event]) -> Option<(f64, bool)> {
    events.iter().rev().find_map(|e| match e {
        Event::CharitableBequest { share, from_ira_first } => Some((*share, *from_ira_first)),
        _ => None,
    })
}

/// Runs the projection with `market(n)` supplying year `n`'s returns and inflation
/// (n = 0 is `start_year`) and `events` applying the scenario's decisions.
pub fn project_market(
    h: &Household,
    events: &[Event],
    start_year: i32,
    t: &TaxTables,
    outcomes: &PrivateOutcomes,
    market: impl Fn(usize) -> MarketYear,
) -> Result<Projection, ProjectionError> {
    h.validate().map_err(ProjectionError::Invalid)?;
    for e in events {
        e.validate(&h.people, &h.accounts).map_err(ProjectionError::Invalid)?;
    }
    let prepared = apply_input_events(h, events);
    let h = &prepared;
    let children: Vec<Id> = h.people.iter().filter(|p| p.role == Role::Child).filter_map(|p| p.id).collect();
    let primary = h.people.iter().find(|p| p.role == Role::Primary).ok_or(ProjectionError::NoPrimaryPerson)?;
    let adults: Vec<&Person> = h.people.iter().filter(|p| matches!(p.role, Role::Primary | Role::Spouse)).collect();
    let person = |id: Option<Id>| id.and_then(|id| h.people.iter().find(|p| p.id == Some(id))).unwrap_or(primary);

    let r = h.assumptions;
    let status = h.info.filing_status;
    let end_year = start_year + horizon_years(h, start_year)? as i32 - 1;
    let start_age = (start_year - primary.birth_year).max(0) as u32;

    let mut accts: Vec<Acct> = h.accounts.iter().map(|a| Acct::from(a, person(a.owner_id))).collect();
    for (k, a) in accts.iter_mut().enumerate() {
        if let Some(p) = a.private.as_mut()
            && a.account_type == AccountType::Startup
        {
            p.startup_multiplier = outcomes.startup(k);
        }
    }
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
            private: None,
            llc: None,
            grat: None,
        });
    }
    let savings_target = accts
        .iter()
        .position(|a| a.account_type == AccountType::Taxable)
        .or_else(|| accts.iter().position(|a| a.bucket == Bucket::Cash))
        .unwrap();

    let mut debts: Vec<(f64, f64, f64, bool)> =
        h.debts.iter().map(|d| (d.balance, d.interest_rate, d.monthly_payment * 12.0, d.home_mortgage)).collect();

    let starting_investable: f64 = accts.iter().filter(|a| a.bucket.spendable()).map(|a| a.balance).fold(0.0, f64::add);
    let mut years = Vec::new();
    let mut magi_history: Vec<f64> = Vec::new();
    let mut price = 1.0; // start-of-year price level vs. today
    let mut loans: Vec<Loan> = Vec::new();
    let mut lifetime_taxable_gifts = 0.0;
    let mut gift_tax_paid = 0.0;
    // Anti-clawback: gifts already covered by the exemption stay covered if it's later cut.
    let mut sheltered_gifts: f64 = 0.0;
    let mut roth_target =
        accts.iter().position(|a| matches!(a.account_type, AccountType::RothIra | AccountType::Roth401k));
    // Charity above the AGI limits: (year given, cash, investments), usable for 5 more years.
    let mut charity_carry: Vec<(i32, f64, f64)> = Vec::new();
    // 529 superfunding still to be spread: (child, per year, years left).
    let mut superfunds: Vec<(Id, f64, u32)> = Vec::new();
    let section_7520 = t.afr.section_7520;

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

        // --- 2b. Private investments: payouts, defaults, exits ---
        let (mut private_income, mut private_proceeds) = (0.0, 0.0);
        let (mut private_rental_taxable, mut private_interest_taxable) = (0.0, 0.0);
        let (mut private_gains, mut private_losses) = (0.0, 0.0);
        for a in accts.iter_mut() {
            let account_type = a.account_type;
            let Some(p) = a.private.as_mut() else { continue };
            if p.exited {
                continue;
            }
            if p.terms.exit_year.is_some_and(|exit| year >= exit) {
                // Sells at the start of its exit year; proceeds go to savings below.
                let proceeds = a.balance.max(0.0);
                let gain = proceeds - a.basis;
                if gain >= 0.0 {
                    if !(account_type == AccountType::Startup && p.terms.qsbs) {
                        private_gains += gain;
                    }
                } else {
                    private_losses += -gain;
                }
                private_proceeds += proceeds;
                a.balance = 0.0;
                a.basis = 0.0;
                p.exited = true;
                continue;
            }
            let payout = p.terms.cash_yield * p.invested.max(0.0);
            private_income += payout;
            let taxable = payout * p.terms.taxable_share;
            if account_type == AccountType::RealEstateFund {
                private_rental_taxable += taxable;
            } else {
                private_interest_taxable += taxable;
            }
            if account_type == AccountType::PrivateCredit {
                let lost = outcomes.credit(n as usize).clamp(0.0, 1.0);
                a.balance *= 1.0 - lost;
                p.invested *= 1.0 - lost;
            }
            // Value moves toward its exit value, nudged by this year's replayed market.
            let (steady_rate, market_rate) = match account_type {
                AccountType::RealEstateFund => (r.real_estate_growth, m.real_estate),
                AccountType::Startup | AccountType::OtherAlternative => (r.stocks_return, m.stocks),
                _ => (0.0, 0.0),
            };
            p.market_factor *= (1.0 + market_rate) / (1.0 + steady_rate);
            match p.terms.exit_year {
                Some(exit) => {
                    let remaining = (exit - year).max(1) as f64;
                    let mut target = p.invested.max(0.0) * p.terms.exit_multiple;
                    if account_type != AccountType::PrivateCredit {
                        target *= p.market_factor;
                    }
                    if account_type == AccountType::Startup {
                        target *= p.startup_multiplier;
                    }
                    if a.balance > 0.0 && target > 0.0 {
                        a.balance *= (target / a.balance).powf(1.0 / remaining);
                    } else if a.balance > 0.0 {
                        // Heading to nothing (a failed startup): fade out by the exit year.
                        a.balance *= 1.0 - 1.0 / remaining;
                    }
                }
                None => a.balance *= 1.0 + market_rate,
            }
        }
        if private_proceeds > 0.0 {
            let target = &mut accts[savings_target];
            target.balance += private_proceeds;
            target.basis += private_proceeds;
        }
        // Capital losses offset this year's gains; up to $3,000 more offsets ordinary income.
        let private_net_gain = private_gains - private_losses;
        let capital_loss_deduction = (-private_net_gain).clamp(0.0, 3_000.0);

        // --- 3. Spending and debts ---
        let primary_age = (year - primary.birth_year).max(0) as u32;
        let spending_today = events
            .iter()
            .filter_map(|e| match e {
                Event::SpendingChange { from_age, annual_amount } if *from_age <= primary_age => {
                    Some((*from_age, *annual_amount))
                }
                _ => None,
            })
            .max_by_key(|(age, _)| *age)
            .map_or(h.info.base_annual_spending, |(_, amount)| amount);
        let spending = spending_today * price;
        let one_time: f64 =
            h.one_time_expenses.iter().filter(|x| x.year == year).map(|x| x.amount * price).fold(0.0, f64::add);
        let mut debt_payments = 0.0;
        let mut mortgage_interest = 0.0;
        for (balance, rate, payment, home) in debts.iter_mut() {
            if *balance <= 0.0 {
                continue;
            }
            let interest_due = *balance * *rate;
            if *home {
                // Interest on up to $750k of home debt is deductible.
                mortgage_interest += interest_due * (t.itemized.mortgage_debt_limit / *balance).min(1.0);
            }
            let pay = payment.min(*balance + interest_due);
            *balance = (*balance + interest_due - pay).max(0.0);
            debt_payments += pay;
        }

        // --- Scenario decisions: loans, gifts, Roth conversions ---
        let mut ledger = Ledger::default();
        let (mut loan_interest, mut loan_principal) = (0.0, 0.0);
        for loan in loans.iter_mut() {
            let (i, p, forgiven) = loan.year();
            loan_interest += i;
            loan_principal += p;
            ledger.give(loan.to, forgiven, forgiven, forgiven, 0.0, Via::LedgerOnly);
            ledger.transfer(loan.to).loan_payment += i + p;
        }
        for (to, per_year, left) in superfunds.iter_mut() {
            ledger.give(*to, 0.0, 0.0, *per_year, 0.0, Via::LedgerOnly);
            *left -= 1;
        }
        superfunds.retain(|s| s.2 > 0);

        // GRATs pay their annuity at each anniversary (the start of the year here); a finished
        // GRAT's remainder goes to the kids. Payments roll into a new GRAT or come back to you.
        let mut grat_remainders = 0.0;
        // Payments rolling into a new GRAT, per event: (event, invested like acct, home acct, amount, basis).
        let mut rolls: Vec<(usize, usize, usize, f64, f64)> = Vec::new();
        for k in 0..accts.len() {
            let Some(mut g) = accts[k].grat.clone() else { continue };
            let (pay, pay_basis) = accts[k].take_in_kind(g.annuity);
            g.years_left -= 1;
            if g.years_left == 0 {
                let (rest, rest_basis) = accts[k].take_in_kind(f64::INFINITY);
                grat_remainders += rest;
                let n = children.len().max(1) as f64;
                for &id in &children {
                    ledger.give(id, rest / n, rest_basis / n, 0.0, 0.0, Via::Assets);
                }
                accts[k].grat = None;
            } else {
                accts[k].grat = Some(g.clone());
            }
            if g.roll_until.is_some_and(|until| primary_age <= until) {
                match rolls.iter_mut().find(|r| r.0 == g.event) {
                    Some(r) => {
                        r.3 += pay;
                        r.4 += pay_basis;
                    }
                    None => rolls.push((g.event, k, g.home, pay, pay_basis)),
                }
            } else {
                accts[g.home].balance += pay;
                accts[g.home].basis += pay_basis;
            }
        }
        for (event, from, home, amount, basis) in rolls {
            let Some(Event::Grat { term_years, until_age, .. }) = events.get(event) else { continue };
            let new = new_grat(&accts[from], amount, basis, *term_years, section_7520, event, home, Some(*until_age));
            accts.push(new);
        }
        loans.retain(|l| l.balance > 0.005 && l.years_left > 0);
        interest += loan_interest;

        let exclusion = t.annual_exclusion(index);
        let (mut cash_gifts, mut loans_made) = (0.0, 0.0);
        let mut roth_conversion_wanted = 0.0;
        let (mut charity_cash, mut charity_property, mut charity_cash_public) = (0.0, 0.0, 0.0);
        let (mut education, mut llc_gifts) = (0.0, 0.0);
        let in_years = |from: u32, years: u32| primary_age >= from && primary_age < from + years;
        for (ei, e) in events.iter().enumerate() {
            match e {
                Event::HomeHelp { to, age, gift, loan } if *age == primary_age => {
                    cash_gifts += gift * price;
                    ledger.give(*to, gift * price, gift * price, gift * price, 0.0, Via::Cash);
                    if let Some(terms) = loan {
                        let l = Loan::new(*to, terms, price);
                        loans_made += l.balance;
                        ledger.transfer(*to).loan_in += l.balance;
                        loans.push(l);
                    }
                }
                Event::FamilyLoan { to, age, loan } if *age == primary_age => {
                    let l = Loan::new(*to, loan, price);
                    loans_made += l.balance;
                    ledger.transfer(*to).loan_in += l.balance;
                    loans.push(l);
                }
                Event::CashGift { to, amount, from_age, years, max_annual_exclusion }
                    if primary_age >= *from_age && primary_age < from_age + years =>
                {
                    let each = if *max_annual_exclusion { exclusion } else { amount * price };
                    let recipients: Vec<Id> = match to {
                        Some(id) => vec![*id],
                        None => children.clone(),
                    };
                    for id in recipients {
                        cash_gifts += each;
                        ledger.give(id, each, each, each, 0.0, Via::Cash);
                    }
                }
                Event::GiftAssets { to, account_id, age, amount } if *age == primary_age => {
                    let recipients: Vec<Id> = match to {
                        Some(id) => vec![*id],
                        None => children.clone(),
                    };
                    if let Some(k) = h.accounts.iter().position(|a| a.id == Some(*account_id)) {
                        for id in recipients {
                            // The child takes your cost basis on what they receive.
                            let (take, carried) = accts[k].take_in_kind(amount * price);
                            ledger.give(id, take, carried, take, 0.0, Via::Assets);
                        }
                    }
                }
                Event::RothConversion { per_year, from_age, to_age }
                    if primary_age >= *from_age && primary_age <= *to_age =>
                {
                    roth_conversion_wanted += per_year * price;
                }
                Event::CharityGift { amount, from_age, years, account_id, donor_advised }
                    if in_years(*from_age, *years) =>
                {
                    match account_id.and_then(|id| h.accounts.iter().position(|a| a.id == Some(id))) {
                        // Appreciated investments: no capital-gains tax, deductible at market value.
                        Some(k) => charity_property += accts[k].take_in_kind(amount * price).0,
                        None => {
                            charity_cash += amount * price;
                            if !donor_advised {
                                charity_cash_public += amount * price;
                            }
                        }
                    }
                }
                Event::Fund529 { to, age, amount, superfund } if *age == primary_age => {
                    let v = amount * price;
                    education += v;
                    // Superfunding: up to 5 years of exclusions, counted one-fifth a year.
                    let spread = if *superfund { v.min(5.0 * exclusion) } else { 0.0 };
                    ledger.give(*to, v, v, v - spread + spread / 5.0, v, Via::Education);
                    if spread > 0.0 {
                        superfunds.push((*to, spread / 5.0, 4));
                    }
                }
                Event::PayTuitionMedical { to, amount, from_age, years } if in_years(*from_age, *years) => {
                    let v = amount * price;
                    education += v;
                    ledger.give(*to, v, v, 0.0, 0.0, Via::PaidForYou);
                }
                Event::FamilyLlc { account_id, age, amount, discount, gift_share, years } => {
                    if *age == primary_age
                        && let Some(k) = h.accounts.iter().position(|a| a.id == Some(*account_id))
                    {
                        let (v, basis) = accts[k].take_in_kind(amount * price);
                        let mut llc = accts[k].carve(Bucket::FamilyLlc, v, basis);
                        llc.account_type = AccountType::LlcInterest;
                        llc.llc = Some(LlcState { event: ei, share: 1.0, discount: *discount });
                        accts.push(llc);
                    }
                    if in_years(*age, *years)
                        && let Some(a) = accts.iter_mut().find(|a| a.llc.as_ref().is_some_and(|l| l.event == ei))
                        && let Some(l) = a.llc.as_mut()
                    {
                        // The last gift takes whatever share is left (no floating-point crumbs).
                        let part = if *gift_share >= l.share - 1e-9 { l.share } else { *gift_share };
                        if part > 0.0 && l.share > 0.0 {
                            // The kids receive the full value; the gift is reported at a discount.
                            let value = a.balance.max(0.0) * part / l.share;
                            let discount = l.discount;
                            l.share -= part;
                            let (v, basis) = a.take_in_kind(value);
                            llc_gifts += v;
                            let n = children.len().max(1) as f64;
                            for &id in &children {
                                ledger.give(id, v / n, basis / n, v * (1.0 - discount) / n, 0.0, Via::Assets);
                            }
                        }
                    }
                }
                Event::Grat { account_id, age, amount, term_years, rolling, until_age } if *age == primary_age => {
                    if let Some(k) = h.accounts.iter().position(|a| a.id == Some(*account_id)) {
                        let (v, basis) = accts[k].take_in_kind(amount * price);
                        if v > 0.0 {
                            let roll = rolling.then_some(*until_age);
                            accts.push(new_grat(&accts[k], v, basis, *term_years, section_7520, ei, k, roll));
                        }
                    }
                }
                _ => {}
            }
        }

        // Roth conversion: move from traditional accounts into a Roth (taxed as income below).
        let mut roth_conversion = 0.0;
        if roth_conversion_wanted > 0.0 {
            for a in accts.iter_mut().filter(|a| a.bucket == Bucket::TaxDeferred) {
                let take = (roth_conversion_wanted - roth_conversion).min(a.balance.max(0.0));
                a.balance -= take;
                roth_conversion += take;
            }
            if roth_conversion > 0.0 {
                let idx = match roth_target {
                    Some(i) => i,
                    None => {
                        accts.push(Acct {
                            bucket: Bucket::TaxFree,
                            account_type: AccountType::RothIra,
                            owner_birth_year: primary.birth_year,
                            owner_id: primary.id,
                            balance: 0.0,
                            basis: 0.0,
                            stocks: 0.6,
                            bonds: 0.4,
                            cash: 0.0,
                            contribution: 0.0,
                            employer_match: 0.0,
                            private: None,
                            llc: None,
                            grat: None,
                        });
                        roth_target = Some(accts.len() - 1);
                        accts.len() - 1
                    }
                };
                accts[idx].balance += roth_conversion;
            }
        }

        // Gift ledger: reported gifts above each child's yearly exclusion use up the lifetime exemption.
        let gifts: f64 = ledger.gifts.iter().map(|g| g.amount).fold(0.0, f64::add);
        lifetime_taxable_gifts += ledger.reported.iter().map(|r| (r.1 - exclusion).max(0.0)).fold(0.0, f64::add);

        // --- Money from a parent's plan (a linked child plan) ---
        // Gifts and inheritance aren't income: cash goes to savings, investments keep the
        // parent's basis, 529 money goes into a 529, and loan payments go out like a bill.
        let (mut incoming_cash, mut incoming_out, mut received_from_parent) = (0.0, 0.0, 0.0);
        for t in h.incoming.iter().filter(|t| t.year == year) {
            incoming_cash += t.cash + t.loan_in + t.inheritance;
            incoming_out += t.loan_payment;
            if t.assets > 0.0 {
                let k = holding(&mut accts, AccountType::Taxable, primary);
                accts[k].balance += t.assets;
                accts[k].basis += t.assets_basis.clamp(0.0, t.assets);
            }
            if t.education > 0.0 {
                let k = holding(&mut accts, AccountType::Plan529, primary);
                accts[k].balance += t.education;
                accts[k].basis += t.education;
            }
            received_from_parent += t.cash + t.assets + t.education + t.paid_for_you + t.loan_in + t.inheritance;
        }
        // Gift tax is due only above the exemption, never less than what's already sheltered.
        let shelter = t.estate_exemption(year, index, &r).max(sheltered_gifts);
        let gift_tax = (t.estate_gift.top_rate * (lifetime_taxable_gifts - shelter).max(0.0) - gift_tax_paid).max(0.0);
        gift_tax_paid += gift_tax;
        sheltered_gifts = sheltered_gifts.max(lifetime_taxable_gifts.min(shelter));

        let on_medicare = adults.iter().filter(|p| alive(p) && age_of(p) >= t.irmaa.medicare_age).count() as f64;
        let filers_65_plus = on_medicare as u32;
        let children_under_17 =
            h.people.iter().filter(|p| p.role == Role::Child && age_of(p) < t.child_tax_credit.under_age).count()
                as u32;

        let base_in = wages
            + self_employment
            + rental
            + pension_and_other
            + social_security
            + rmd_total
            + loan_interest
            + loan_principal
            + private_income
            + incoming_cash;
        let base_out = spending
            + one_time
            + debt_payments
            + contributions
            + cash_gifts
            + loans_made
            + gift_tax
            + charity_cash
            + education
            + incoming_out;
        let (carry_cash, carry_property) =
            charity_carry.iter().fold((0.0, 0.0), |(c, p), entry| (c + entry.1, p + entry.2));
        let property_tax = h.info.home_property_tax * price;

        let tax_rise = r.tax_rise_enabled && year >= r.tax_rise_year;
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
                    rental: rental + private_rental_taxable,
                    interest: interest + private_interest_taxable,
                    qualified_dividends,
                    long_term_gains: (d.long_term_gains + private_net_gain).max(0.0),
                    capital_loss_deduction,
                    ordinary_rate_increase: if tax_rise { r.income_tax_increase } else { 0.0 },
                    gains_rate_increase: if tax_rise { r.capital_gains_increase } else { 0.0 },
                    traditional_distributions: rmd_total + d.traditional + roth_conversion,
                    early_distributions: d.early_traditional,
                    social_security_benefits: social_security,
                    filers_65_plus,
                    children_under_17,
                    state_rate: h.info.flat_state_rate,
                    property_tax,
                    mortgage_interest,
                    charity_cash: charity_cash + carry_cash,
                    charity_property: charity_property + carry_property,
                    charity_cash_public,
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

        // Charity carryforward: this year's gifts are used first, then the oldest carried amounts.
        let mut cash_used = tax_result.charity_cash_absorbed;
        let mut property_used = tax_result.charity_property_absorbed;
        let new_carry = ((charity_cash - cash_used).max(0.0), (charity_property - property_used).max(0.0));
        cash_used = (cash_used - charity_cash).max(0.0);
        property_used = (property_used - charity_property).max(0.0);
        for c in charity_carry.iter_mut() {
            let (uc, up) = (c.1.min(cash_used), c.2.min(property_used));
            c.1 -= uc;
            c.2 -= up;
            cash_used -= uc;
            property_used -= up;
        }
        charity_carry.retain(|c| c.1 + c.2 > 0.005 && year - c.0 < 5);
        if new_carry.0 + new_carry.1 > 0.005 {
            charity_carry.push((year, new_carry.0, new_carry.1));
        }

        // --- 5. Growth ---
        // The spendable portfolio's blended return this year; gifts are grown at it in the
        // estate so money given early is compared fairly with money kept.
        let (mut spendable, mut grew) = (0.0, 0.0);
        for a in accts.iter_mut() {
            let ret = a.total_return(&m);
            if a.bucket.spendable() && a.balance > 0.0 {
                spendable += a.balance;
                grew += a.balance * ret;
            }
            a.balance *= 1.0 + ret;
        }
        let portfolio_return = if spendable > 0.0 { grew / spendable } else { 0.6 * m.stocks + 0.4 * m.bonds };
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
                Bucket::Private => &mut balances.private,
                Bucket::FamilyLlc => &mut balances.family_llc,
                Bucket::Grat => &mut balances.grats,
            };
            *slot += a.balance;
        }
        balances.loans_receivable = loans.iter().map(|l| l.balance).fold(0.0, f64::add);
        let debt_balance: f64 = debts.iter().map(|d| d.0).fold(0.0, f64::add);
        // Once you hold half or less of the LLC you no longer control it, so your share is
        // valued at the discount for estate tax.
        let llc_discount = accts
            .iter()
            .filter_map(|a| a.llc.as_ref().filter(|l| l.share <= 0.5 + 1e-9).map(|l| l.discount * a.balance.max(0.0)))
            .fold(0.0, f64::add);

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
            gifts,
            gifts_by_child: ledger.gifts,
            transfers_by_child: ledger.transfers,
            received_from_parent,
            gift_tax,
            cash_gifts,
            loans_made,
            loan_receipts: loan_interest + loan_principal,
            roth_conversion,
            lifetime_taxable_gifts,
            portfolio_return,
            private_income,
            private_proceeds,
            sheltered_gifts,
            charity: charity_cash + charity_property,
            charity_cash,
            charity_carryforward: charity_carry.iter().map(|c| c.1 + c.2).fold(0.0, f64::add),
            education,
            superfund_pending: superfunds.iter().map(|s| s.1 * s.2 as f64).fold(0.0, f64::add),
            llc_gifts,
            llc_discount,
            grat_remainders,
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
        estate: estate::estate_at(h, &years, start_year, t, charitable_bequest(events)),
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
pub fn compare_claim_ages(
    h: &Household,
    scenario: Option<Id>,
    start_year: i32,
) -> Result<Vec<ClaimAgeOutcome>, ProjectionError> {
    // The comparison varies the claim age itself, so drop any claim-age decision but keep the rest.
    let mut events = events_for(h, scenario)?;
    let chosen = events.iter().rev().find_map(|e| match e {
        Event::SocialSecurityAge { age } => Some(*age),
        _ => None,
    });
    events.retain(|e| !matches!(e, Event::SocialSecurityAge { .. }));
    let base = apply_input_events(h, &[]);
    let h = &base;
    let primary = h.people.iter().find(|p| p.role == Role::Primary).ok_or(ProjectionError::NoPrimaryPerson)?;
    let primary = &Person {
        ss_claim_age: chosen.unwrap_or(primary.ss_claim_age),
        ss_already_claiming: primary.ss_already_claiming && chosen.is_none(),
        ..primary.clone()
    };
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
            let steady = MarketYear::steady(&variant.assumptions);
            let proj = project_market(
                &variant,
                &events,
                start_year,
                TaxTables::current(),
                &PrivateOutcomes::default(),
                |_| steady,
            )?;
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
            private: None,
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
        assert_eq!(project(&h, None, 2026).unwrap_err(), ProjectionError::NoPrimaryPerson);
    }

    #[test]
    fn runs_to_life_expectancy() {
        let h = household(vec![me(1960)], vec![account(AccountType::Savings, 10_000.0, None, 0.0)], 0.0);
        let p = project(&h, None, 2026).unwrap();
        assert_eq!(p.years.first().unwrap().age, 66);
        assert_eq!(p.years.last().unwrap().age, 100);
        assert_eq!(p.years.len(), 35);
    }

    #[test]
    fn untouched_roth_compounds_at_its_return() {
        // No spending, no income, a Roth at 100% stocks: grows exactly 7%/yr, no tax.
        let h = household(vec![me(1980)], vec![account(AccountType::RothIra, 100_000.0, None, 1.0)], 0.0);
        let p = project(&h, None, 2026).unwrap();
        close(p.years[9].balances.tax_free, 100_000.0 * 1.07f64.powi(10), 0.01);
        assert!(p.years.iter().all(|y| y.taxes == 0.0));
    }

    #[test]
    fn withdrawals_cover_spending_and_their_own_taxes() {
        // 50-year-old (penalty applies) living off a traditional IRA.
        let h = household(vec![me(1976)], vec![account(AccountType::TradIra, 2_000_000.0, None, 0.6)], 60_000.0);
        let y = &project(&h, None, 2026).unwrap().years[0];
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
        let y = &project(&h, None, 2026).unwrap().years[0];
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
        let p = project(&h, None, 2026).unwrap();
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
        let proj = project(&h, None, 2026).unwrap();
        let at = |age: u32| proj.years.iter().find(|y| y.age == age).unwrap();
        assert_eq!(at(69).social_security, 0.0);
        // 2,000 × 12 × 1.24, inflated from 2026 to the start of the year they turn 70 (2035).
        close(at(70).social_security, 24_000.0 * 1.24 * 1.025f64.powi(9), 0.01);
    }

    #[test]
    fn running_out_is_reported() {
        let h = household(vec![me(1960)], vec![account(AccountType::Checking, 100_000.0, None, 0.0)], 50_000.0);
        let p = project(&h, None, 2026).unwrap();
        // 66: 100k - 50k = 50k → grows to 51k. 67: spending is 51,250 → 250 short.
        assert_eq!(p.summary.runs_out_at_age, Some(67));
        assert_eq!(p.summary.principal_dips_at_age, Some(66));
        assert_eq!(p.summary.lowest_investable_real, 0.0);
    }

    #[test]
    fn lowest_point_is_reported_only_when_savings_dip() {
        let h = household(vec![me(1980)], vec![account(AccountType::RothIra, 100_000.0, None, 1.0)], 0.0);
        let s = project(&h, None, 2026).unwrap().summary;
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
        let p = project(&h, None, 2026).unwrap();
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
            home_mortgage: false,
        });
        let p = project(&h, None, 2026).unwrap();
        assert_eq!(p.years[0].debt_payments, 6_000.0);
        assert_eq!(p.years[1].debt_payments, 4_000.0);
        assert_eq!(p.years[2].debt_payments, 0.0);
        assert_eq!(p.years[1].debt_balance, 0.0);
    }

    #[test]
    fn one_time_expenses_are_inflated() {
        let mut h = household(vec![me(1980)], vec![account(AccountType::Checking, 500_000.0, None, 0.0)], 0.0);
        h.one_time_expenses.push(OneTimeExpense { id: None, name: "Roof".into(), year: 2028, amount: 30_000.0 });
        let p = project(&h, None, 2026).unwrap();
        close(p.years[2].one_time_expenses, 30_000.0 * 1.025f64.powi(2), 0.01);
        assert_eq!(p.years[1].one_time_expenses, 0.0);
    }

    #[test]
    fn claim_age_comparison_covers_remaining_ages() {
        let mut p = me(1959);
        p.ss_monthly_benefit = Some(3_000.0);
        p.ss_claim_age = 70;
        let h = household(vec![p], vec![account(AccountType::Taxable, 1_000_000.0, Some(800_000.0), 0.6)], 60_000.0);
        let out = compare_claim_ages(&h, None, 2026).unwrap();
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
        let y = &project(&h, None, 2026).unwrap().years[0];
        close(y.tax.deduction, 32_200.0, 0.01);
    }

    // --- Scenario decisions ---------------------------------------------------

    fn kid(id: Id, name: &str) -> Person {
        Person { id: Some(id), name: name.into(), birth_year: 1995, role: Role::Child, ..me(1995) }
    }

    /// 58-year-old (born 1968) with a big brokerage account and two kids.
    fn family(events: Vec<Event>) -> Household {
        let mut h = household(
            vec![me(1968), kid(2, "Sam"), kid(3, "Jordan")],
            vec![account(AccountType::Taxable, 5_000_000.0, Some(5_000_000.0), 0.6)],
            0.0,
        );
        h.scenarios.push(crate::model::Scenario { id: Some(1), name: "Plan".into(), notes: String::new(), events });
        h
    }

    fn run(events: Vec<Event>) -> Projection {
        project(&family(events), Some(1), 2026).unwrap()
    }

    #[test]
    fn base_plan_ignores_scenarios() {
        let h = family(vec![Event::SpendingChange { from_age: 58, annual_amount: 99_000.0 }]);
        assert_eq!(project(&h, None, 2026).unwrap().years[0].spending, 0.0);
        assert_eq!(project(&h, Some(1), 2026).unwrap().years[0].spending, 99_000.0);
        assert_eq!(project(&h, Some(7), 2026).unwrap_err(), ProjectionError::UnknownScenario);
    }

    #[test]
    fn yearly_max_gifts_to_each_child_stay_within_the_exclusion() {
        let p =
            run(vec![Event::CashGift { to: None, amount: 0.0, from_age: 58, years: 3, max_annual_exclusion: true }]);
        assert_eq!(p.years[0].gifts, 38_000.0);
        assert_eq!(p.years[0].gifts_by_child.len(), 2);
        assert_eq!(p.years[3].gifts, 0.0);
        assert!(p.years.iter().all(|y| y.lifetime_taxable_gifts == 0.0));
    }

    #[test]
    fn a_down_payment_gift_above_the_exclusion_uses_the_lifetime_exemption() {
        let p = run(vec![Event::HomeHelp { to: 2, age: 58, gift: 100_000.0, loan: None }]);
        assert_eq!(p.years[0].gifts, 100_000.0);
        close(p.years[0].lifetime_taxable_gifts, 81_000.0, 0.01);
        assert_eq!(p.years[0].gift_tax, 0.0);
        // Sam got $100k during life; Jordan didn't.
        let kids = &p.summary.estate.children;
        assert!(kids[0].gifts_real > 99_000.0 && kids[1].gifts_real == 0.0);
    }

    #[test]
    fn family_loans_go_out_then_come_back_with_taxable_interest() {
        let terms = LoanTerms { amount: 100_000.0, rate: 0.05, years: 10, interest_only: false, forgive_per_year: 0.0 };
        // Savings that earn nothing, so the loan interest is the only income.
        let mut h = family(vec![Event::FamilyLoan { to: 3, age: 58, loan: terms }]);
        h.accounts = vec![account(AccountType::Checking, 5_000_000.0, None, 0.0)];
        h.assumptions.cash_return = 0.0;
        let p = project(&h, Some(1), 2026).unwrap();
        assert_eq!(p.years[0].loans_made, 100_000.0);
        close(p.years[0].balances.loans_receivable, 100_000.0, 0.01);
        // Ten equal payments of 100k × 5% / (1 − 1.05^−10) = $12,950.46, starting the next year.
        let receipts: f64 = p.years[1..=10].iter().map(|y| y.loan_receipts).sum();
        close(receipts, 129_504.57, 0.05);
        // Year 1 interest on the full $100k at 5% is taxable income.
        close(p.years[1].tax.agi, 5_000.0, 0.01);
        close(p.years[10].balances.loans_receivable, 0.0, 0.01);
        assert_eq!(p.years[11].loan_receipts, 0.0);
    }

    #[test]
    fn forgiven_loan_principal_counts_as_gifts() {
        let terms =
            LoanTerms { amount: 50_000.0, rate: 0.0, years: 10, interest_only: true, forgive_per_year: 19_000.0 };
        let p = run(vec![Event::FamilyLoan { to: 2, age: 58, loan: terms }]);
        let gifts: Vec<f64> = p.years[1..=4].iter().map(|y| y.gifts).collect();
        assert_eq!(gifts, [19_000.0, 19_000.0, 12_000.0, 0.0]);
        assert!(p.years.iter().all(|y| y.lifetime_taxable_gifts == 0.0));
    }

    #[test]
    fn roth_conversions_move_money_and_are_taxed() {
        let mut h = household(
            vec![me(1968)],
            vec![
                account(AccountType::TradIra, 1_000_000.0, None, 0.6),
                account(AccountType::Checking, 500_000.0, None, 0.0),
            ],
            0.0,
        );
        h.scenarios.push(crate::model::Scenario {
            id: Some(1),
            name: "Convert".into(),
            notes: String::new(),
            events: vec![Event::RothConversion { per_year: 50_000.0, from_age: 60, to_age: 61 }],
        });
        let base = project(&h, None, 2026).unwrap();
        let p = project(&h, Some(1), 2026).unwrap();
        let at = |p: &Projection, age: u32| p.years.iter().find(|y| y.age == age).unwrap().clone();
        assert_eq!(at(&p, 59).roth_conversion, 0.0);
        close(at(&p, 60).roth_conversion, 50_000.0 * 1.025f64.powi(2), 0.01);
        assert!(at(&p, 60).tax.agi > at(&base, 60).tax.agi + 40_000.0);
        assert_eq!(at(&p, 60).tax.early_withdrawal_penalty, 0.0, "conversions aren't penalized");
        assert!(at(&p, 61).balances.tax_free > 100_000.0);
        assert_eq!(at(&p, 62).roth_conversion, 0.0);
        // Smaller traditional balance → smaller RMDs at 75.
        assert!(at(&p, 75).required_distributions < at(&base, 75).required_distributions);
    }

    #[test]
    fn claim_age_decision_overrides_the_base_plan() {
        let mut h = family(vec![Event::SocialSecurityAge { age: 62 }]);
        h.people[0].ss_monthly_benefit = Some(3_000.0);
        let p = project(&h, Some(1), 2026).unwrap();
        assert!(p.years.iter().find(|y| y.age == 62).unwrap().social_security > 0.0);
        let base = project(&h, None, 2026).unwrap();
        assert_eq!(base.years.iter().find(|y| y.age == 62).unwrap().social_security, 0.0);
        let cmp = compare_claim_ages(&h, Some(1), 2026).unwrap();
        assert!(cmp.iter().find(|o| o.claim_age == 62).unwrap().is_current_choice);
    }

    #[test]
    fn events_must_name_a_real_child() {
        let h = family(vec![Event::HomeHelp { to: 99, age: 60, gift: 1.0, loan: None }]);
        assert!(matches!(project(&h, Some(1), 2026), Err(ProjectionError::Invalid(_))));
    }

    // --- Phase 5.1: private investments, gifts in kind, anti-clawback, tax rise ----

    fn private(t: AccountType, invested: f64, value: f64, terms: PrivateTerms) -> Account {
        Account { cost_basis: Some(invested), private: Some(terms), ..account(t, value, Some(invested), 0.0) }
    }

    #[test]
    fn real_estate_fund_pays_cash_then_sells_at_its_multiple() {
        // $1M invested, 8% cash a year (half taxable), sells in 2031 at 1.5×.
        let terms =
            PrivateTerms { exit_year: Some(2031), ..PrivateTerms::default_for(AccountType::RealEstateFund, 2026) };
        let mut h = family(vec![]);
        h.accounts.push(private(AccountType::RealEstateFund, 1_000_000.0, 1_000_000.0, terms));
        let p = project(&h, None, 2026).unwrap();
        let at = |year: i32| p.years.iter().find(|y| y.year == year).unwrap().clone();
        close(at(2026).private_income, 80_000.0, 0.01);
        assert!(at(2026).balances.private > 1_000_000.0, "value climbs toward the exit");
        // 2031: sold for $1.5M; $500k long-term gain; no more payouts.
        close(at(2031).private_proceeds, 1_500_000.0, 1.0);
        assert_eq!(at(2031).private_income, 0.0);
        assert_eq!(at(2031).balances.private, 0.0);
        assert!(at(2031).tax.capital_gains_tax > 50_000.0);
        // Half the payouts are taxable rental income.
        let no_fund = project(&family(vec![]), None, 2026).unwrap();
        close(at(2026).tax.agi - no_fund.years[0].tax.agi, 40_000.0, 1_000.0);
    }

    #[test]
    fn startup_gains_can_be_qsbs_excluded() {
        let terms = PrivateTerms {
            exit_year: Some(2028),
            exit_multiple: 3.0,
            ..PrivateTerms::default_for(AccountType::Startup, 2026)
        };
        let mut h = family(vec![]);
        h.accounts.push(private(AccountType::Startup, 100_000.0, 100_000.0, terms.clone()));
        let taxed = project(&h, None, 2026).unwrap();
        h.accounts[1].private = Some(PrivateTerms { qsbs: true, ..terms });
        let excluded = project(&h, None, 2026).unwrap();
        let y = |p: &Projection| p.years.iter().find(|y| y.year == 2028).unwrap().clone();
        close(y(&taxed).private_proceeds, 300_000.0, 1.0);
        assert!(y(&taxed).tax.agi > y(&excluded).tax.agi + 190_000.0);
    }

    #[test]
    fn gifting_stock_moves_it_with_your_cost_basis_and_no_cash() {
        let mut h = family(vec![Event::GiftAssets { to: Some(2), account_id: 1, age: 58, amount: 1_000_000.0 }]);
        h.accounts[0].id = Some(1);
        h.accounts[0].cost_basis = Some(1_000_000.0); // 20% basis on $5M
        let p = project(&h, Some(1), 2026).unwrap();
        let g = &p.years[0].gifts_by_child[0];
        close(g.amount, 1_000_000.0, 0.01);
        // 20% basis, plus this year's reinvested dividends and interest (125k) before the gift → 22.5%.
        close(g.basis, 225_000.0, 0.01);
        assert_eq!(p.years[0].cash_gifts, 0.0, "an in-kind gift isn't cash out");
        // $981k above the yearly exclusion uses lifetime exemption.
        close(p.years[0].lifetime_taxable_gifts, 981_000.0, 0.01);
    }

    #[test]
    fn a_later_exemption_cut_does_not_tax_gifts_already_sheltered() {
        // Give $10M in 2026 under the $15M exemption; the exemption is cut to $7M from 2030.
        let mut h = family(vec![Event::CashGift {
            to: None,
            amount: 5_000_000.0,
            from_age: 58,
            years: 1,
            max_annual_exclusion: false,
        }]);
        h.accounts[0].balance = 30_000_000.0;
        h.accounts[0].cost_basis = Some(30_000_000.0);
        h.assumptions.exemption_cut_enabled = true;
        // Estimate the estate soon after the cut, while $7M (rising with inflation) is still below the $10M given.
        h.assumptions.estate_age = Some(63);
        let p = project(&h, Some(1), 2026).unwrap();
        assert!(p.years.iter().all(|y| y.gift_tax == 0.0), "no gift tax, before or after the cut");
        let after_cut = p.years.iter().find(|y| y.year == 2031).unwrap();
        close(after_cut.sheltered_gifts, 9_962_000.0, 1.0);
        assert!(p.summary.estate.anti_clawback_applies);
    }

    #[test]
    fn cash_to_charity_is_itemized_and_the_excess_carries_forward_five_years() {
        let base = run(vec![]);
        let p = run(vec![Event::CharityGift {
            amount: 1_000_000.0,
            from_age: 58,
            years: 1,
            account_id: None,
            donor_advised: true,
        }]);
        let y0 = &p.years[0];
        close(y0.charity, 1_000_000.0, 0.01);
        assert!(y0.tax.itemized);
        // Only 60% of AGI is deductible this year; the rest carries forward.
        close(y0.tax.charity_cash_absorbed, 0.6 * y0.tax.agi, 0.01);
        close(y0.charity_carryforward, 1_000_000.0 - y0.tax.charity_cash_absorbed, 0.01);
        assert!(y0.taxes < base.years[0].taxes);
        assert!(p.years[1].tax.itemized, "the carryforward is deducted the next year too");
        // A carryforward can be used in the five following years (through 2031), then whatever is left expires.
        assert!(p.years[4].charity_carryforward > 0.0);
        assert!(p.years[5].tax.itemized);
        assert_eq!(p.years[5].charity_carryforward, 0.0);
        assert!(!p.years[6].tax.itemized);
    }

    #[test]
    fn giving_appreciated_stock_to_charity_realizes_no_gain() {
        let mut h = family(vec![Event::CharityGift {
            amount: 100_000.0,
            from_age: 58,
            years: 1,
            account_id: Some(1),
            donor_advised: false,
        }]);
        h.accounts[0].id = Some(1);
        h.accounts[0].cost_basis = Some(500_000.0);
        let p = project(&h, Some(1), 2026).unwrap();
        let base = project(&h, None, 2026).unwrap();
        let y0 = &p.years[0];
        close(y0.charity, 100_000.0, 0.01);
        close(y0.tax.charity_property_absorbed, 100_000f64.min(0.3 * y0.tax.agi), 0.01);
        // No sale, so no extra gains (income is even a bit lower: less tax means less to sell
        // to pay it), and the deduction lowers the tax.
        assert!(y0.tax.agi <= base.years[0].tax.agi);
        assert!(y0.taxes < base.years[0].taxes);
        assert_eq!(y0.cash_gifts, 0.0);
    }

    #[test]
    fn superfunding_a_529_spreads_the_gift_over_five_years() {
        let superfund = run(vec![Event::Fund529 { to: 2, age: 58, amount: 95_000.0, superfund: true }]);
        let lump = run(vec![Event::Fund529 { to: 2, age: 58, amount: 95_000.0, superfund: false }]);
        // 95,000 / 5 = 19,000 a year: exactly the exclusion, so no exemption is used.
        assert!(superfund.years.iter().take(5).all(|y| y.lifetime_taxable_gifts == 0.0));
        close(superfund.years[0].superfund_pending, 76_000.0, 0.01);
        assert_eq!(superfund.years[4].superfund_pending, 0.0);
        close(lump.years[0].lifetime_taxable_gifts, 76_000.0, 0.01);
        let g = &superfund.years[0].gifts_by_child[0];
        close(g.tax_free, 95_000.0, 0.01);
        close(superfund.years[0].education, 95_000.0, 0.01);
        // The 529 grows tax-free for the child.
        let sam = &superfund.summary.estate.children[0];
        assert!(sam.gifts_grown_real > 95_000.0);
        assert_eq!(sam.gifts_capital_gains_tax_real, 0.0);
    }

    #[test]
    fn paying_tuition_directly_is_not_a_gift() {
        let p = run(vec![Event::PayTuitionMedical { to: 2, amount: 100_000.0, from_age: 58, years: 2 }]);
        assert!(p.years.iter().all(|y| y.lifetime_taxable_gifts == 0.0));
        close(p.years[0].education, 100_000.0, 0.01);
        close(p.years[1].education, 102_500.0, 0.01);
        let e = &p.summary.estate;
        // $100k a year in today's dollars, for two years.
        close(e.children[0].gifts_real, 200_000.0, 0.01);
        assert_eq!(e.children[1].gifts_real, 0.0);
    }

    #[test]
    fn family_llc_gifts_are_reported_at_a_discount() {
        let mut h = family(vec![Event::FamilyLlc {
            account_id: 1,
            age: 58,
            amount: 2_000_000.0,
            discount: 0.3,
            gift_share: 0.1,
            years: 10,
        }]);
        h.accounts[0].id = Some(1);
        let p = project(&h, Some(1), 2026).unwrap();
        let y0 = &p.years[0];
        // 10% of the $2M LLC goes to the kids; reported at 70%: 70k each, 51k above the exclusion.
        close(y0.llc_gifts, 200_000.0, 0.01);
        close(y0.lifetime_taxable_gifts, 2.0 * (70_000.0 - 19_000.0), 0.01);
        assert!(y0.balances.family_llc > 1_800_000.0, "your 90% share, grown");
        // After the fifth gift you hold half and lose control: your share gets the discount too.
        assert_eq!(p.years[3].llc_discount, 0.0);
        close(p.years[4].llc_discount, 0.3 * p.years[4].balances.family_llc, 0.01);
        assert!(p.years[10].balances.family_llc == 0.0, "all given away after ten years");
        // LLC income is still taxed to you.
        assert!(p.years[1].balances.family_llc > 0.0);
    }

    #[test]
    fn a_grat_pays_you_back_and_passes_growth_above_the_7520_rate() {
        let mut h = family(vec![Event::Grat {
            account_id: 1,
            age: 58,
            amount: 1_000_000.0,
            term_years: 2,
            rolling: false,
            until_age: 58,
        }]);
        h.accounts[0].id = Some(1);
        h.accounts[0].stocks_pct = 1.0;
        h.accounts[0].bonds_pct = 0.0;
        let p = project(&h, Some(1), 2026).unwrap();
        let r = TaxTables::current().afr.section_7520;
        let annuity = 1_000_000.0 * r / (1.0 - (1.0 + r).powi(-2));
        let g = h.assumptions.stocks_return;
        let remainder = (1_000_000.0 * (1.0 + g) - annuity) * (1.0 + g) - annuity;
        assert!(remainder > 0.0 && remainder < 50_000.0, "7% vs 6.2%: a thin margin ({remainder})");
        close(p.years[2].grat_remainders, remainder, 0.01);
        close(p.years[2].gifts, remainder, 0.01);
        assert!(p.years.iter().all(|y| y.lifetime_taxable_gifts == 0.0), "a zeroed-out GRAT uses no exemption");
        assert!(p.years[0].balances.grats > 0.0 && p.years[2].balances.grats == 0.0);
    }

    #[test]
    fn rolling_grats_keep_going_until_the_chosen_age() {
        let grat = |rolling| {
            let mut h = family(vec![Event::Grat {
                account_id: 1,
                age: 58,
                amount: 1_000_000.0,
                term_years: 2,
                rolling,
                until_age: 66,
            }]);
            h.accounts[0].id = Some(1);
            h.accounts[0].stocks_pct = 1.0;
            h.accounts[0].bonds_pct = 0.0;
            project(&h, Some(1), 2026).unwrap()
        };
        let (once, rolled) = (grat(false), grat(true));
        let total = |p: &Projection| p.years.iter().map(|y| y.grat_remainders).fold(0.0, f64::add);
        assert!(total(&rolled) > 3.0 * total(&once));
        // Rolling stops at 66: the last GRAT starts then and finishes two years later.
        let last = rolled.years.iter().rposition(|y| y.balances.grats > 0.0).unwrap();
        assert_eq!(rolled.years[last].age, 67);
    }

    #[test]
    fn property_tax_and_mortgage_interest_can_be_itemized() {
        let mut h = household(
            vec![me(1968)],
            vec![account(AccountType::TradIra, 3_000_000.0, None, 0.6), account(AccountType::Checking, 0.0, None, 0.0)],
            150_000.0,
        );
        let standard = project(&h, None, 2026).unwrap();
        assert!(!standard.years[0].tax.itemized);
        h.info.home_property_tax = 30_000.0;
        h.debts.push(crate::model::Debt {
            id: None,
            name: "Mortgage".into(),
            kind: DebtKind::Mortgage,
            balance: 1_000_000.0,
            interest_rate: 0.06,
            monthly_payment: 7_000.0,
            account_id: None,
            notes: String::new(),
            home_mortgage: true,
        });
        let p = project(&h, None, 2026).unwrap();
        let y0 = &p.years[0];
        assert!(y0.tax.itemized);
        // 30k property tax + interest on the first $750k (45k).
        close(y0.tax.itemized_deductions, 30_000.0 + 45_000.0, 1.0);
    }

    #[test]
    fn charitable_bequest_lowers_estate_tax() {
        let mut h = family(vec![Event::CharitableBequest { share: 0.2, from_ira_first: true }]);
        h.accounts[0].balance = 30_000_000.0;
        h.accounts[0].cost_basis = Some(30_000_000.0);
        let base = project(&h, None, 2026).unwrap().summary.estate;
        let p = project(&h, Some(1), 2026).unwrap().summary.estate;
        assert!(p.charitable_bequest_real > 0.0);
        close(p.charitable_bequest_real, 0.2 * p.gross_estate_real, 1.0);
        close(base.estate_tax_real - p.estate_tax_real, 0.4 * p.charitable_bequest_real, 1.0);
    }

    #[test]
    fn transfers_by_child_record_what_a_linked_child_plan_needs() {
        let mut h = family(vec![
            Event::HomeHelp {
                to: 2,
                age: 58,
                gift: 100_000.0,
                loan: Some(LoanTerms {
                    amount: 200_000.0,
                    rate: 0.05,
                    years: 10,
                    interest_only: true,
                    forgive_per_year: 0.0,
                }),
            },
            Event::GiftAssets { to: Some(3), account_id: 1, age: 58, amount: 50_000.0 },
            Event::Fund529 { to: 3, age: 58, amount: 95_000.0, superfund: true },
            Event::PayTuitionMedical { to: 2, amount: 30_000.0, from_age: 58, years: 1 },
        ]);
        h.accounts[0].id = Some(1);
        let p = project(&h, Some(1), 2026).unwrap();
        let t = |year: usize, id: Id| p.years[year].transfers_by_child.iter().find(|t| t.child_id == id).cloned();
        let sam = t(0, 2).unwrap();
        close(sam.cash, 100_000.0, 0.01);
        close(sam.loan_in, 200_000.0, 0.01);
        close(sam.paid_for_you, 30_000.0, 0.01);
        let jordan = t(0, 3).unwrap();
        close(jordan.assets, 50_000.0, 0.01);
        close(jordan.assets_basis, 50_000.0, 1_000.0);
        close(jordan.education, 95_000.0, 0.01);
        // Interest-only loan: Sam pays 5% a year from the next year on.
        close(t(1, 2).unwrap().loan_payment, 10_000.0, 0.01);
        assert!(t(1, 3).is_none(), "nothing more for Jordan in year 2");
    }

    #[test]
    fn money_from_a_parent_lands_in_the_right_places() {
        let mut h = household(vec![me(1996)], vec![account(AccountType::Checking, 10_000.0, None, 0.0)], 0.0);
        let base = project(&h, None, 2026).unwrap();
        h.incoming = vec![
            crate::model::IncomingTransfer { year: 2027, cash: 50_000.0, ..Default::default() },
            crate::model::IncomingTransfer {
                year: 2028,
                assets: 100_000.0,
                assets_basis: 20_000.0,
                education: 95_000.0,
                ..Default::default()
            },
            crate::model::IncomingTransfer { year: 2030, loan_payment: 5_000.0, ..Default::default() },
            crate::model::IncomingTransfer { year: 2060, inheritance: 1_000_000.0, ..Default::default() },
        ];
        let p = project(&h, None, 2026).unwrap();
        let at = |p: &Projection, y: i32| p.years.iter().find(|r| r.year == y).unwrap().clone();
        close(at(&p, 2027).received_from_parent, 50_000.0, 0.01);
        assert!(at(&p, 2027).balances.cash > at(&base, 2027).balances.cash + 49_000.0);
        // Gifted investments land in a brokerage account with the parent's basis; the 529 in a 529.
        let y28 = at(&p, 2028);
        assert!(y28.balances.taxable > 100_000.0);
        assert!(y28.balances.education > 95_000.0);
        // Loan payments are paid out of savings, and gifts aren't taxed as income.
        assert!(at(&p, 2030).withdrawals > at(&base, 2030).withdrawals);
        assert_eq!(at(&p, 2027).taxes, at(&base, 2027).taxes);
        close(at(&p, 2060).received_from_parent, 1_000_000.0, 0.01);
        assert!(at(&p, 2060).net_worth > at(&base, 2060).net_worth + 1_000_000.0);
    }

    #[test]
    fn tax_rise_raises_taxes_only_from_its_year() {
        let mut h = household(
            vec![me(1968)],
            vec![account(AccountType::TradIra, 2_000_000.0, None, 0.6), account(AccountType::Checking, 0.0, None, 0.0)],
            100_000.0,
        );
        let before = project(&h, None, 2026).unwrap();
        h.assumptions.tax_rise_enabled = true;
        h.assumptions.tax_rise_year = 2030;
        let after = project(&h, None, 2026).unwrap();
        let at = |p: &Projection, y: i32| p.years.iter().find(|r| r.year == y).unwrap().clone();
        assert_eq!(at(&after, 2029).taxes, at(&before, 2029).taxes);
        assert!(at(&after, 2030).taxes > at(&before, 2030).taxes);
    }
}
