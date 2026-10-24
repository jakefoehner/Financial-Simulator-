//! Household data model: the single source of truth that the DB stores, the UI
//! edits, the projection consumes, and the `.fsim` share file serializes.
//!
//! Conventions: money is `f64` dollars in today's terms; rates and allocation
//! weights are decimals (0.07 = 7%, 0.6 = 60%). Ages are whole years.

use serde::{Deserialize, Serialize};

pub type Id = i64;

/// Defines a string-backed enum with serde names, `as_str`, `parse`, and `ALL`.
/// The string is what's stored in SQLite and sent to the UI.
macro_rules! string_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident => $s:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        pub enum $name {
            $(#[serde(rename = $s)] $variant),+
        }

        impl $name {
            pub const ALL: &'static [$name] = &[$($name::$variant),+];

            pub fn as_str(self) -> &'static str {
                match self { $($name::$variant => $s),+ }
            }

            pub fn parse(s: &str) -> Option<Self> {
                match s { $($s => Some($name::$variant),)+ _ => None }
            }
        }
    };
}

string_enum!(
    /// Federal filing status.
    FilingStatus {
        Single => "single",
        MarriedJoint => "married_joint",
        MarriedSeparate => "married_separate",
        HeadOfHousehold => "head_of_household",
    }
);

string_enum!(
    /// How a person relates to the household. Children are tracked as heirs and
    /// gift recipients even when they are adults living elsewhere.
    Role {
        Primary => "primary",
        Spouse => "spouse",
        Child => "child",
        Other => "other",
    }
);

string_enum!(
    AccountType {
        Checking => "checking",
        Savings => "savings",
        Taxable => "taxable",
        Trad401k => "trad_401k",
        Roth401k => "roth_401k",
        TradIra => "trad_ira",
        RothIra => "roth_ira",
        Hsa => "hsa",
        Plan529 => "plan_529",
        Pension => "pension",
        RealEstate => "real_estate",
        Crypto => "crypto",
        Rsu => "rsu",
        Espp => "espp",
        Options => "options",
        LlcInterest => "llc_interest",
        RealEstateFund => "real_estate_fund",
        PrivateCredit => "private_credit",
        Startup => "startup",
        OtherAlternative => "other_alternative",
    }
);

impl AccountType {
    /// Whether a stocks/bonds/cash mix is meaningful for this account.
    pub fn has_allocation(self) -> bool {
        !matches!(self, AccountType::Checking | AccountType::Savings | AccountType::RealEstate | AccountType::Pension)
            && !self.is_private()
    }

    /// Private funds and startups: illiquid until they pay out, with their own terms.
    pub fn is_private(self) -> bool {
        matches!(
            self,
            AccountType::RealEstateFund
                | AccountType::PrivateCredit
                | AccountType::Startup
                | AccountType::OtherAlternative
        )
    }

    /// Ordinary taxable investments that can be given to someone "in kind".
    pub fn giftable_in_kind(self) -> bool {
        matches!(self, AccountType::Taxable | AccountType::Crypto | AccountType::Rsu | AccountType::Espp)
    }

    /// Whether gains are taxed on sale, so cost basis matters.
    pub fn tracks_cost_basis(self) -> bool {
        matches!(
            self,
            AccountType::Taxable
                | AccountType::RealEstate
                | AccountType::Crypto
                | AccountType::Rsu
                | AccountType::Espp
                | AccountType::Options
                | AccountType::LlcInterest
        ) || self.is_private()
    }
}

string_enum!(
    IncomeKind {
        W2 => "w2",
        Bonus => "bonus",
        SelfEmployment => "self_employment",
        Rental => "rental",
        Pension => "pension",
        Annuity => "annuity",
        Other => "other",
    }
);

impl IncomeKind {
    /// Pay from working: keeps retirement contributions going.
    pub fn is_earned(self) -> bool {
        matches!(self, IncomeKind::W2 | IncomeKind::Bonus | IncomeKind::SelfEmployment)
    }
}

string_enum!(
    DebtKind {
        Mortgage => "mortgage",
        StudentLoan => "student_loan",
        Auto => "auto",
        CreditCard => "credit_card",
        Heloc => "heloc",
        Other => "other",
    }
);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HouseholdInfo {
    pub name: String,
    /// Two-letter state code. Only used for the optional flat state rate.
    pub state: String,
    pub flat_state_rate: f64,
    pub filing_status: FilingStatus,
    /// Yearly living expenses in today's dollars (grows with inflation).
    pub base_annual_spending: f64,
    /// Yearly property tax on your home(s), in today's dollars. Already part of your spending;
    /// used only for itemized deductions (state and local taxes).
    #[serde(default)]
    pub home_property_tax: f64,
}

impl Default for HouseholdInfo {
    fn default() -> Self {
        Self {
            name: "My Household".into(),
            state: "TX".into(),
            flat_state_rate: 0.0,
            filing_status: FilingStatus::Single,
            base_annual_spending: 0.0,
            home_property_tax: 0.0,
        }
    }
}

// The enum comes from `string_enum!`, which can't mark a `#[default]` variant.
#[allow(clippy::derivable_impls)]
impl Default for FilingStatus {
    fn default() -> Self {
        FilingStatus::Single
    }
}

/// Growth and inflation assumptions. Nominal yearly rates as decimals.
///
/// The steady path uses these every year. The range of outcomes replays real
/// market years scaled so their long-run compound growth equals these rates
/// (see `history.rs`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Assumptions {
    pub stocks_return: f64,
    pub bonds_return: f64,
    pub cash_return: f64,
    pub real_estate_growth: f64,
    pub inflation: f64,
    /// Part of the stock return paid out as qualified dividends (taxed yearly in taxable accounts).
    pub stock_dividend_yield: f64,
    /// Number of replayed-history scenarios in the range of outcomes.
    pub simulations: u32,
    /// Use constant inflation in every scenario instead of replaying history's.
    pub steady_inflation: bool,
    /// Income-tax rate the heirs are assumed to pay on inherited traditional IRA/401(k) money.
    pub heir_income_tax_rate: f64,
    /// "What if the estate exemption is cut": from `exemption_cut_year` on, the exemption
    /// becomes `exemption_cut_amount` (in today's dollars).
    pub exemption_cut_enabled: bool,
    pub exemption_cut_amount: f64,
    pub exemption_cut_year: i32,
    /// Age of the primary person at which to estimate the estate. `None` = the plan's last year.
    pub estate_age: Option<u32>,
    /// Capital-gains rate the kids are assumed to pay when they sell gifted assets
    /// (gifts keep your cost basis; inherited assets are stepped up).
    pub heir_capital_gains_rate: f64,
    /// "What if taxes rise": from `tax_rise_year` on, every income-tax bracket rises by
    /// `income_tax_increase` and the 15%/20% capital-gains rates by `capital_gains_increase`.
    pub tax_rise_enabled: bool,
    pub tax_rise_year: i32,
    pub income_tax_increase: f64,
    pub capital_gains_increase: f64,
}

impl Default for Assumptions {
    fn default() -> Self {
        Self {
            stocks_return: 0.07,
            bonds_return: 0.04,
            cash_return: 0.02,
            real_estate_growth: 0.03,
            inflation: 0.025,
            stock_dividend_yield: 0.015,
            simulations: 5_000,
            steady_inflation: false,
            heir_income_tax_rate: 0.24,
            exemption_cut_enabled: false,
            exemption_cut_amount: 7_000_000.0,
            exemption_cut_year: 2030,
            estate_age: None,
            heir_capital_gains_rate: 0.15,
            tax_rise_enabled: false,
            tax_rise_year: 2030,
            income_tax_increase: 0.05,
            capital_gains_increase: 0.05,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    /// `None` when creating; the DB assigns it.
    pub id: Option<Id>,
    pub name: String,
    pub birth_year: i32,
    pub role: Role,
    /// Age the plan runs to. Defaults to 100.
    pub life_expectancy: u32,
    /// Monthly Social Security benefit: the estimate at full retirement age, or
    /// the current check if `ss_already_claiming`.
    pub ss_monthly_benefit: Option<f64>,
    pub ss_claim_age: u32,
    pub ss_already_claiming: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: Option<Id>,
    pub name: String,
    pub account_type: AccountType,
    /// `None` = jointly owned / household.
    pub owner_id: Option<Id>,
    pub balance: f64,
    pub cost_basis: Option<f64>,
    pub stocks_pct: f64,
    pub bonds_pct: f64,
    pub cash_pct: f64,
    /// Yearly amount you add (today's dollars).
    pub annual_contribution: f64,
    /// Yearly employer match (today's dollars).
    pub employer_match: f64,
    pub notes: String,
    /// Terms for private funds and startups (`None` for every other type).
    #[serde(default)]
    pub private: Option<PrivateTerms>,
    /// Individual positions (from a brokerage import or entered by hand). Optional: the
    /// balance and allocation above are what the forecast uses.
    #[serde(default)]
    pub holdings: Vec<Holding>,
}

/// One position in an account.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Holding {
    /// Ticker symbol, upper case (empty for something without one, like a CD).
    pub ticker: String,
    pub description: String,
    pub shares: f64,
    /// Price per share when last updated.
    pub price: f64,
    /// Total cost basis of the position, if known.
    pub cost_basis: Option<f64>,
    /// When `price` was last updated (YYYY-MM-DD), if known.
    pub price_date: Option<String>,
}

impl Holding {
    pub fn value(&self) -> f64 {
        self.shares * self.price
    }
}

/// How a private investment pays out. `balance` is today's value and `cost_basis`
/// what was invested.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateTerms {
    /// Cash paid out each year, as a share of what was invested.
    pub cash_yield: f64,
    /// Share of those payouts that is taxable income (real estate funds are often
    /// partly sheltered by depreciation).
    pub taxable_share: f64,
    /// Calendar year it sells / returns capital. `None` = held for the whole plan.
    pub exit_year: Option<i32>,
    /// What it pays at exit, as a multiple of what was invested (1.5 = 1.5×).
    /// For startups this is the *expected* multiple across all companies.
    pub exit_multiple: f64,
    /// Startups: how many separate companies (more companies = less all-or-nothing).
    pub companies: u32,
    /// Startups: gains may qualify for the QSBS exclusion (Section 1202).
    pub qsbs: bool,
}

impl PrivateTerms {
    /// Typical starting terms for each private type; the user edits them.
    pub fn default_for(t: AccountType, start_year: i32) -> PrivateTerms {
        let base = PrivateTerms {
            cash_yield: 0.0,
            taxable_share: 1.0,
            exit_year: Some(start_year + 7),
            exit_multiple: 1.5,
            companies: 1,
            qsbs: false,
        };
        match t {
            AccountType::RealEstateFund => PrivateTerms { cash_yield: 0.08, taxable_share: 0.5, ..base },
            AccountType::PrivateCredit => {
                PrivateTerms { cash_yield: 0.085, exit_year: Some(start_year + 5), exit_multiple: 1.0, ..base }
            }
            AccountType::Startup => {
                PrivateTerms { exit_year: Some(start_year + 8), exit_multiple: 2.0, companies: 5, ..base }
            }
            _ => base,
        }
    }

    pub fn validate(&self) -> Validation {
        in_range("Yearly cash payout", self.cash_yield, 0.0, 0.5)?;
        in_range("Taxable share of payouts", self.taxable_share, 0.0, 1.0)?;
        in_range("Payout multiple", self.exit_multiple, 0.0, 100.0)?;
        in_range("Number of companies", self.companies, 1, 500)?;
        if let Some(y) = self.exit_year {
            in_range("Exit year", y, 1900, 2200)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomeStream {
    pub id: Option<Id>,
    /// `None` = household-level (e.g. jointly owned rental); ages then refer to the primary person.
    pub person_id: Option<Id>,
    pub kind: IncomeKind,
    pub name: String,
    pub annual_amount: f64,
    /// Yearly raise / cost-of-living adjustment.
    pub growth_rate: f64,
    /// Age it starts (inclusive). `None` = already started.
    pub start_age: Option<u32>,
    /// Age it stops (exclusive). `None` = for life.
    pub end_age: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Debt {
    pub id: Option<Id>,
    pub name: String,
    pub kind: DebtKind,
    pub balance: f64,
    pub interest_rate: f64,
    pub monthly_payment: f64,
    /// Property/asset this debt is secured by, if any.
    pub account_id: Option<Id>,
    pub notes: String,
    /// The mortgage on your own home: its interest can be itemized (up to $750k of debt).
    #[serde(default)]
    pub home_mortgage: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OneTimeExpense {
    pub id: Option<Id>,
    pub name: String,
    pub year: i32,
    /// Today's dollars; inflated to the year it happens.
    pub amount: f64,
}

/// Everything about one household: what the DB loads, the engine consumes,
/// and a `.fsim` file carries.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Household {
    pub info: HouseholdInfo,
    pub people: Vec<Person>,
    pub accounts: Vec<Account>,
    pub income: Vec<IncomeStream>,
    pub debts: Vec<Debt>,
    pub one_time_expenses: Vec<OneTimeExpense>,
    #[serde(default)]
    pub assumptions: Assumptions,
    /// "What if" plans built on top of everything above (the base plan).
    #[serde(default)]
    pub scenarios: Vec<Scenario>,
    /// Money arriving from a parent's plan (gifts, 529s, loans, inheritance), by year.
    /// Computed when a child's plan is linked to a parent's; never stored.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub incoming: Vec<IncomingTransfer>,
    /// Risk of individual stocks held (by ticker), from their price history. Computed when
    /// prices are fetched; never stored. Empty = every stock moves with the market.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stock_risk: Vec<StockRisk>,
}

/// How one stock moves: with the market (`beta`) and on its own (`own_vol`, yearly).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockRisk {
    pub ticker: String,
    pub beta: f64,
    pub own_vol: f64,
}

/// One year of money arriving from a parent's plan, in that year's (nominal) dollars.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IncomingTransfer {
    pub year: i32,
    /// Cash gifts (including down-payment help).
    pub cash: f64,
    /// Investments given in kind (stock, LLC shares, GRAT remainders), at market value...
    pub assets: f64,
    /// ...and their cost basis, carried over from the parent.
    pub assets_basis: f64,
    /// Into a 529 for this child.
    pub education: f64,
    /// Tuition or medical bills the parent pays directly (spending the child doesn't have to do).
    pub paid_for_you: f64,
    /// A family loan received...
    pub loan_in: f64,
    /// ...and this year's payments on it (interest + principal), net of anything forgiven.
    pub loan_payment: f64,
    /// Inheritance after estate tax and the heirs' IRA income tax (stepped-up basis).
    pub inheritance: f64,
}

// ---------------------------------------------------------------------------
// Scenarios: decisions layered on the base plan. Ages are the primary
// person's; money is in today's dollars (inflated to the year it happens).
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoanTerms {
    pub amount: f64,
    /// Yearly interest rate. Family loans should charge at least the IRS minimum (AFR).
    pub rate: f64,
    pub years: u32,
    /// Interest only, with the principal due in the final year.
    pub interest_only: bool,
    /// Principal forgiven each year (a gift). Up to the yearly gift exclusion avoids using the lifetime exemption.
    pub forgive_per_year: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum Event {
    /// Help a child buy a home: a down-payment gift, optionally plus a family loan.
    HomeHelp {
        to: Id,
        age: u32,
        gift: f64,
        loan: Option<LoanTerms>,
    },
    /// Cash gifts to one child (`to`) or each child (`to: None`), for `years` years from `from_age`.
    /// `max_annual_exclusion` gives exactly the yearly gift-tax exclusion instead of `amount`.
    CashGift {
        to: Option<Id>,
        amount: f64,
        from_age: u32,
        years: u32,
        max_annual_exclusion: bool,
    },
    FamilyLoan {
        to: Id,
        age: u32,
        loan: LoanTerms,
    },
    /// Give investments ("put stock in the kids' names"): `amount` (today's dollars, at
    /// market value) from account `account_id` to one child or each child. The kids
    /// keep your cost basis.
    GiftAssets {
        to: Option<Id>,
        account_id: Id,
        age: u32,
        amount: f64,
    },
    SocialSecurityAge {
        age: u32,
    },
    /// From this age on, yearly living expenses become `annual_amount`.
    SpendingChange {
        from_age: u32,
        annual_amount: f64,
    },
    /// Convert this much a year from traditional to Roth accounts, ages `from_age` through `to_age`.
    RothConversion {
        per_year: f64,
        from_age: u32,
        to_age: u32,
    },
    /// Give to charity (or a donor-advised fund) each year for `years` years: cash, or
    /// appreciated investments from `account_id` (no capital-gains tax; deductible at market value).
    CharityGift {
        amount: f64,
        from_age: u32,
        years: u32,
        account_id: Option<Id>,
        donor_advised: bool,
    },
    /// Leave `share` (0–1) of the estate to charity, taking traditional IRA money first
    /// when `from_ira_first` (charities owe no income tax on it).
    CharitableBequest {
        share: f64,
        from_ira_first: bool,
    },
    /// Put money into a 529 for a child. `superfund` spreads it over five years of the
    /// yearly gift exclusion (up to 5×).
    Fund529 {
        to: Id,
        age: u32,
        amount: f64,
        superfund: bool,
    },
    /// Pay a child's tuition or medical bills directly: not a gift at all, with no limit.
    PayTuitionMedical {
        to: Id,
        amount: f64,
        from_age: u32,
        years: u32,
    },
    /// Move `amount` from `account_id` into a family LLC, then give each child `gift_share`
    /// of the LLC each year for `years` years, valued with a `discount` (lack of control
    /// and marketability).
    FamilyLlc {
        account_id: Id,
        age: u32,
        amount: f64,
        discount: f64,
        gift_share: f64,
        years: u32,
    },
    /// Grantor retained annuity trusts: put `amount` from `account_id` into a 2-year GRAT
    /// that pays you back with the IRS §7520 rate; growth above it goes to the kids.
    /// When `rolling`, each payment back starts a new GRAT through `until_age`.
    Grat {
        account_id: Id,
        age: u32,
        amount: f64,
        term_years: u32,
        rolling: bool,
        until_age: u32,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    pub id: Option<Id>,
    pub name: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub events: Vec<Event>,
}
// Validation. Returns a user-facing message for the first problem found.
// ---------------------------------------------------------------------------

pub type Validation = Result<(), String>;

const ALLOCATION_TOLERANCE: f64 = 0.001;

fn non_empty(field: &str, s: &str) -> Validation {
    if s.trim().is_empty() { Err(format!("{field} can't be empty.")) } else { Ok(()) }
}

fn non_negative(field: &str, v: f64) -> Validation {
    if !v.is_finite() || v < 0.0 { Err(format!("{field} must be zero or more.")) } else { Ok(()) }
}

fn in_range<T: PartialOrd + std::fmt::Display + Copy>(field: &str, v: T, lo: T, hi: T) -> Validation {
    if v < lo || v > hi { Err(format!("{field} must be between {lo} and {hi}.")) } else { Ok(()) }
}

impl HouseholdInfo {
    pub fn validate(&self) -> Validation {
        non_empty("Household name", &self.name)?;
        in_range("State tax rate", self.flat_state_rate, 0.0, 0.2)?;
        non_negative("Yearly spending", self.base_annual_spending)?;
        non_negative("Home property tax", self.home_property_tax)
    }
}

impl Person {
    pub fn validate(&self) -> Validation {
        non_empty("Name", &self.name)?;
        in_range("Birth year", self.birth_year, 1900, 2100)?;
        in_range("Plan-to age", self.life_expectancy, 50, 120)?;
        in_range("Social Security claim age", self.ss_claim_age, 62, 70)?;
        if let Some(b) = self.ss_monthly_benefit {
            non_negative("Social Security benefit", b)?;
        }
        Ok(())
    }
}

impl Account {
    pub fn validate(&self) -> Validation {
        non_empty("Account name", &self.name)?;
        non_negative("Balance", self.balance)?;
        if let Some(b) = self.cost_basis {
            non_negative("Cost basis", b)?;
        }
        non_negative("Contribution", self.annual_contribution)?;
        non_negative("Employer match", self.employer_match)?;
        for h in &self.holdings {
            let what = if h.ticker.is_empty() { h.description.as_str() } else { h.ticker.as_str() };
            if h.shares < 0.0 || h.price < 0.0 || h.cost_basis.is_some_and(|c| c < 0.0) {
                return Err(format!("{what}: shares, price, and cost basis can't be negative."));
            }
        }
        if self.account_type.is_private() {
            self.private.as_ref().ok_or("Add the investment's payout terms.")?.validate()?;
        }
        if self.account_type.has_allocation() {
            for (field, v) in [("Stocks", self.stocks_pct), ("Bonds", self.bonds_pct), ("Cash", self.cash_pct)] {
                in_range(field, v, 0.0, 1.0)?;
            }
            let total = self.stocks_pct + self.bonds_pct + self.cash_pct;
            if (total - 1.0).abs() > ALLOCATION_TOLERANCE {
                return Err(format!("Stocks, bonds, and cash must add up to 100% (currently {:.0}%).", total * 100.0));
            }
        }
        Ok(())
    }
}

impl IncomeStream {
    pub fn validate(&self) -> Validation {
        non_empty("Income name", &self.name)?;
        non_negative("Yearly amount", self.annual_amount)?;
        in_range("Yearly growth", self.growth_rate, -0.5, 0.5)?;
        if let (Some(s), Some(e)) = (self.start_age, self.end_age)
            && e <= s
        {
            return Err("End age must be after start age.".into());
        }
        Ok(())
    }
}

impl Debt {
    pub fn validate(&self) -> Validation {
        non_empty("Debt name", &self.name)?;
        non_negative("Balance", self.balance)?;
        in_range("Interest rate", self.interest_rate, 0.0, 1.0)?;
        non_negative("Monthly payment", self.monthly_payment)
    }

    /// True when the payment doesn't even cover this month's interest.
    pub fn is_negatively_amortizing(&self) -> bool {
        self.balance > 0.0 && self.monthly_payment <= self.balance * self.interest_rate / 12.0
    }
}

impl OneTimeExpense {
    pub fn validate(&self) -> Validation {
        non_empty("Expense name", &self.name)?;
        in_range("Year", self.year, 1900, 2200)?;
        non_negative("Amount", self.amount)
    }
}

impl Assumptions {
    pub fn validate(&self) -> Validation {
        in_range("Stock return", self.stocks_return, -0.2, 0.2)?;
        in_range("Bond return", self.bonds_return, -0.1, 0.15)?;
        in_range("Cash return", self.cash_return, -0.05, 0.1)?;
        in_range("Real estate growth", self.real_estate_growth, -0.1, 0.15)?;
        in_range("Inflation", self.inflation, -0.02, 0.15)?;
        in_range("Dividend yield", self.stock_dividend_yield, 0.0, self.stocks_return.max(0.0))?;
        in_range("Scenarios", self.simulations, 100, 20_000)?;
        in_range("Heirs' income-tax rate", self.heir_income_tax_rate, 0.0, 0.6)?;
        non_negative("Reduced exemption", self.exemption_cut_amount)?;
        in_range("Year the exemption is cut", self.exemption_cut_year, 2026, 2100)?;
        if let Some(age) = self.estate_age {
            in_range("Estate age", age, 50, 120)?;
        }
        in_range("Kids' capital-gains rate", self.heir_capital_gains_rate, 0.0, 0.5)?;
        in_range("Year taxes rise", self.tax_rise_year, 2026, 2100)?;
        in_range("Income-tax increase", self.income_tax_increase, 0.0, 0.3)?;
        in_range("Capital-gains increase", self.capital_gains_increase, 0.0, 0.3)?;
        Ok(())
    }
}

impl LoanTerms {
    pub fn validate(&self) -> Validation {
        non_negative("Loan amount", self.amount)?;
        in_range("Loan rate", self.rate, 0.0, 0.2)?;
        in_range("Loan length (years)", self.years, 1, 40)?;
        non_negative("Yearly forgiveness", self.forgive_per_year)
    }
}

impl Event {
    /// Checks the event's own numbers and that any child or account it names exists.
    pub fn validate(&self, people: &[Person], accounts: &[Account]) -> Validation {
        let child = |id: Id| -> Validation {
            if people.iter().any(|p| p.id == Some(id) && p.role == Role::Child) {
                Ok(())
            } else {
                Err("Pick one of your children (add them on the People page).".into())
            }
        };
        let age = |a: u32| in_range("Age", a, 18, 120);
        let giftable = |id: Id| -> Validation {
            if accounts.iter().any(|x| x.id == Some(id) && x.account_type.giftable_in_kind()) {
                Ok(())
            } else {
                Err("Pick a brokerage or stock account.".into())
            }
        };
        match self {
            Event::HomeHelp { to, age: a, gift, loan } => {
                child(*to)?;
                age(*a)?;
                non_negative("Gift", *gift)?;
                if let Some(l) = loan {
                    l.validate()?;
                }
                Ok(())
            }
            Event::CashGift { to, amount, from_age, years, .. } => {
                if let Some(id) = to {
                    child(*id)?;
                } else if !people.iter().any(|p| p.role == Role::Child) {
                    return Err("Add your children on the People page first.".into());
                }
                non_negative("Gift", *amount)?;
                age(*from_age)?;
                in_range("Number of years", *years, 1, 60)
            }
            Event::FamilyLoan { to, age: a, loan } => {
                child(*to)?;
                age(*a)?;
                loan.validate()
            }
            Event::GiftAssets { to, account_id, age: a, amount } => {
                if let Some(id) = to {
                    child(*id)?;
                } else if !people.iter().any(|p| p.role == Role::Child) {
                    return Err("Add your children on the People page first.".into());
                }
                if !accounts.iter().any(|x| x.id == Some(*account_id) && x.account_type.giftable_in_kind()) {
                    return Err("Pick a brokerage or stock account to give from.".into());
                }
                age(*a)?;
                non_negative("Amount", *amount)
            }
            Event::SocialSecurityAge { age } => in_range("Social Security claim age", *age, 62, 70),
            Event::SpendingChange { from_age, annual_amount } => {
                age(*from_age)?;
                non_negative("Yearly spending", *annual_amount)
            }
            Event::RothConversion { per_year, from_age, to_age } => {
                non_negative("Yearly conversion", *per_year)?;
                age(*from_age)?;
                if to_age < from_age {
                    return Err("The last conversion age must be on or after the first.".into());
                }
                Ok(())
            }
            Event::CharityGift { amount, from_age, years, account_id, .. } => {
                if let Some(id) = account_id {
                    giftable(*id)?;
                }
                non_negative("Gift", *amount)?;
                age(*from_age)?;
                in_range("Number of years", *years, 1, 60)
            }
            Event::CharitableBequest { share, .. } => in_range("Share of the estate", *share, 0.0, 1.0),
            Event::Fund529 { to, age: a, amount, .. } => {
                child(*to)?;
                age(*a)?;
                non_negative("Amount", *amount)
            }
            Event::PayTuitionMedical { to, amount, from_age, years } => {
                child(*to)?;
                non_negative("Amount", *amount)?;
                age(*from_age)?;
                in_range("Number of years", *years, 1, 60)
            }
            Event::FamilyLlc { account_id, age: a, amount, discount, gift_share, years } => {
                if !people.iter().any(|p| p.role == Role::Child) {
                    return Err("Add your children on the People page first.".into());
                }
                giftable(*account_id)?;
                age(*a)?;
                non_negative("Amount", *amount)?;
                in_range("Valuation discount", *discount, 0.0, 0.6)?;
                in_range("Share given each year", *gift_share, 0.0, 1.0)?;
                in_range("Number of years", *years, 1, 60)
            }
            Event::Grat { account_id, age: a, amount, term_years, until_age, .. } => {
                if !people.iter().any(|p| p.role == Role::Child) {
                    return Err("Add your children on the People page first.".into());
                }
                giftable(*account_id)?;
                age(*a)?;
                non_negative("Amount", *amount)?;
                in_range("GRAT length (years)", *term_years, 2, 20)?;
                if until_age < a {
                    return Err("Keep rolling until an age on or after the first GRAT.".into());
                }
                Ok(())
            }
        }
    }

    /// The child this event is for, if any.
    pub fn recipient(&self) -> Option<Id> {
        match self {
            Event::HomeHelp { to, .. }
            | Event::FamilyLoan { to, .. }
            | Event::Fund529 { to, .. }
            | Event::PayTuitionMedical { to, .. } => Some(*to),
            Event::CashGift { to, .. } | Event::GiftAssets { to, .. } => *to,
            _ => None,
        }
    }
}

impl Scenario {
    pub fn validate(&self, people: &[Person], accounts: &[Account]) -> Validation {
        non_empty("Scenario name", &self.name)?;
        for e in &self.events {
            e.validate(people, accounts)?;
        }
        Ok(())
    }
}

impl Household {
    /// Validates every record, prefixing the message with what it belongs to.
    pub fn validate(&self) -> Validation {
        self.info.validate()?;
        self.assumptions.validate()?;
        for p in &self.people {
            p.validate().map_err(|e| format!("{}: {e}", p.name))?;
        }
        for a in &self.accounts {
            a.validate().map_err(|e| format!("{}: {e}", a.name))?;
        }
        for i in &self.income {
            i.validate().map_err(|e| format!("{}: {e}", i.name))?;
        }
        for d in &self.debts {
            d.validate().map_err(|e| format!("{}: {e}", d.name))?;
        }
        for x in &self.one_time_expenses {
            x.validate().map_err(|e| format!("{}: {e}", x.name))?;
        }
        for sc in &self.scenarios {
            sc.validate(&self.people, &self.accounts).map_err(|e| format!("{}: {e}", sc.name))?;
        }
        Ok(())
    }

    pub fn scenario(&self, id: Id) -> Option<&Scenario> {
        self.scenarios.iter().find(|s| s.id == Some(id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account(t: AccountType) -> Account {
        Account {
            id: None,
            name: "Brokerage".into(),
            account_type: t,
            owner_id: None,
            balance: 100_000.0,
            cost_basis: Some(60_000.0),
            stocks_pct: 0.6,
            bonds_pct: 0.4,
            cash_pct: 0.0,
            annual_contribution: 0.0,
            employer_match: 0.0,
            notes: String::new(),
            private: None,
            holdings: Vec::new(),
        }
    }

    #[test]
    fn enum_strings_round_trip_and_match_serde() {
        for t in AccountType::ALL {
            assert_eq!(AccountType::parse(t.as_str()), Some(*t));
            assert_eq!(serde_json::to_string(t).unwrap(), format!("\"{}\"", t.as_str()));
        }
        assert_eq!(AccountType::parse("trad_401k"), Some(AccountType::Trad401k));
        assert_eq!(FilingStatus::parse("nope"), None);
    }

    #[test]
    fn allocation_must_sum_to_100_for_investment_accounts() {
        assert!(account(AccountType::Taxable).validate().is_ok());
        let mut a = account(AccountType::Taxable);
        a.cash_pct = 0.1;
        assert!(a.validate().unwrap_err().contains("110%"));
        // Real estate has no stock/bond mix, so the sum isn't checked.
        let mut house = account(AccountType::RealEstate);
        house.stocks_pct = 0.0;
        house.bonds_pct = 0.0;
        assert!(house.validate().is_ok());
    }

    #[test]
    fn rejects_bad_people_and_income() {
        let p = Person {
            id: None,
            name: "Pat".into(),
            birth_year: 1959,
            role: Role::Primary,
            life_expectancy: 100,
            ss_monthly_benefit: Some(3_000.0),
            ss_claim_age: 61,
            ss_already_claiming: false,
        };
        assert!(p.validate().unwrap_err().contains("claim age"));

        let inc = IncomeStream {
            id: None,
            person_id: None,
            kind: IncomeKind::W2,
            name: "Job".into(),
            annual_amount: 90_000.0,
            growth_rate: 0.03,
            start_age: Some(65),
            end_age: Some(60),
        };
        assert!(inc.validate().is_err());
    }

    #[test]
    fn detects_payment_below_interest() {
        let d = Debt {
            id: None,
            name: "Card".into(),
            kind: DebtKind::CreditCard,
            balance: 10_000.0,
            interest_rate: 0.24,
            monthly_payment: 150.0,
            account_id: None,
            notes: String::new(),
            home_mortgage: false,
        };
        assert!(d.validate().is_ok());
        assert!(d.is_negatively_amortizing());
    }
}
