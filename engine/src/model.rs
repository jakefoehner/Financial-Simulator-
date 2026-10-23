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
    }
);

impl AccountType {
    /// Whether a stocks/bonds/cash mix is meaningful for this account.
    pub fn has_allocation(self) -> bool {
        !matches!(self, AccountType::Checking | AccountType::Savings | AccountType::RealEstate | AccountType::Pension)
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
        )
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
#[serde(rename_all = "camelCase")]
pub struct HouseholdInfo {
    pub name: String,
    /// Two-letter state code. Only used for the optional flat state rate.
    pub state: String,
    pub flat_state_rate: f64,
    pub filing_status: FilingStatus,
    /// Yearly living expenses in today's dollars (grows with inflation).
    pub base_annual_spending: f64,
}

impl Default for HouseholdInfo {
    fn default() -> Self {
        Self {
            name: "My Household".into(),
            state: "TX".into(),
            flat_state_rate: 0.0,
            filing_status: FilingStatus::Single,
            base_annual_spending: 0.0,
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

/// Growth and inflation assumptions for the fixed-return forecast. Nominal
/// yearly rates as decimals.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Assumptions {
    pub stocks_return: f64,
    pub bonds_return: f64,
    pub cash_return: f64,
    pub real_estate_growth: f64,
    pub inflation: f64,
    /// Part of the stock return paid out as qualified dividends (taxed yearly in taxable accounts).
    pub stock_dividend_yield: f64,
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
}

// ---------------------------------------------------------------------------
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
        non_negative("Yearly spending", self.base_annual_spending)
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
        in_range("Dividend yield", self.stock_dividend_yield, 0.0, self.stocks_return.max(0.0))
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
        Ok(())
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
        };
        assert!(d.validate().is_ok());
        assert!(d.is_negatively_amortizing());
    }
}
