//! Federal tax law as data. Loaded once from `tax_tables/<year>.json`; the
//! calculation code in `tax.rs` never hard-codes a dollar amount.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::Deserialize;

use crate::model::FilingStatus;

/// One value per filing status.
#[derive(Debug, Clone, Deserialize)]
pub struct ByStatus<T> {
    pub single: T,
    pub married_joint: T,
    pub married_separate: T,
    pub head_of_household: T,
}

impl<T> ByStatus<T> {
    pub fn get(&self, s: FilingStatus) -> &T {
        match s {
            FilingStatus::Single => &self.single,
            FilingStatus::MarriedJoint => &self.married_joint,
            FilingStatus::MarriedSeparate => &self.married_separate,
            FilingStatus::HeadOfHousehold => &self.head_of_household,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Bracket {
    /// Top of the bracket; `None` for the last one.
    pub up_to: Option<f64>,
    pub rate: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SeniorDeduction {
    pub per_person: f64,
    pub last_year: i32,
    pub phaseout_rate: f64,
    pub phaseout_start: ByStatus<f64>,
    pub married_separate_eligible: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CapitalGains {
    pub zero_rate_up_to: ByStatus<f64>,
    pub fifteen_rate_up_to: ByStatus<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Niit {
    pub rate: f64,
    pub threshold: ByStatus<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Payroll {
    pub social_security_rate: f64,
    pub wage_base: f64,
    pub medicare_rate: f64,
    pub additional_medicare_rate: f64,
    pub additional_medicare_threshold: ByStatus<f64>,
    pub self_employment_earnings_factor: f64,
    pub self_employment_social_security_rate: f64,
    pub self_employment_medicare_rate: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SocialSecurityTaxation {
    pub base: ByStatus<f64>,
    pub adjusted_base: ByStatus<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChildTaxCredit {
    pub per_child: f64,
    pub under_age: u32,
    pub phaseout_start: ByStatus<f64>,
    pub phaseout_per_1000: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EarlyWithdrawal {
    pub penalty_rate: f64,
    pub penalty_free_age: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct IrmaaTier {
    pub single_over: f64,
    pub joint_over: f64,
    pub part_b: f64,
    pub part_d: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Irmaa {
    pub tiers: Vec<IrmaaTier>,
    pub medicare_age: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RmdStartAge {
    pub born_through: Option<i32>,
    pub age: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Rmd {
    pub start_age_by_birth_year: Vec<RmdStartAge>,
    pub uniform_lifetime_divisors: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EstateGift {
    pub exemption: f64,
    pub annual_exclusion: f64,
    pub top_rate: f64,
}

/// Minimum family-loan interest rates (applicable federal rates).
#[derive(Debug, Clone, Deserialize)]
pub struct Afr {
    pub month: String,
    pub short_term: f64,
    pub mid_term: f64,
    pub long_term: f64,
}

impl Afr {
    /// The AFR for a loan of `years`: short-term up to 3, mid-term up to 9, long-term beyond.
    pub fn for_years(&self, years: u32) -> f64 {
        match years {
            0..=3 => self.short_term,
            4..=9 => self.mid_term,
            _ => self.long_term,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct TaxTables {
    pub year: i32,
    pub ordinary_brackets: ByStatus<Vec<Bracket>>,
    pub standard_deduction: ByStatus<f64>,
    pub additional_deduction_65: ByStatus<f64>,
    pub senior_deduction: SeniorDeduction,
    pub capital_gains: CapitalGains,
    pub niit: Niit,
    pub payroll: Payroll,
    pub social_security_taxation: SocialSecurityTaxation,
    pub child_tax_credit: ChildTaxCredit,
    pub early_withdrawal: EarlyWithdrawal,
    pub irmaa: Irmaa,
    pub estate_gift: EstateGift,
    pub afr: Afr,
    pub rmd: Rmd,
}

impl TaxTables {
    /// The current tax law tables, parsed once.
    pub fn current() -> &'static TaxTables {
        static TABLES: OnceLock<TaxTables> = OnceLock::new();
        TABLES.get_or_init(|| {
            serde_json::from_str(include_str!("../tax_tables/2026.json")).expect("tax_tables/2026.json is valid")
        })
    }

    /// Yearly per-recipient gift exclusion at price index `idx`, rounded down to $1,000 like the IRS does.
    pub fn annual_exclusion(&self, idx: f64) -> f64 {
        ((self.estate_gift.annual_exclusion * idx.max(1.0)) / 1_000.0).floor() * 1_000.0
    }

    /// Lifetime estate/gift exemption in `year` at price index `idx`, honoring the
    /// household's optional "exemption cut" (whose amount is in today's dollars).
    pub fn estate_exemption(&self, year: i32, idx: f64, a: &crate::model::Assumptions) -> f64 {
        if a.exemption_cut_enabled && year >= a.exemption_cut_year {
            a.exemption_cut_amount * idx
        } else {
            self.estate_gift.exemption * idx
        }
    }

    /// Age required minimum distributions start (SECURE 2.0).
    pub fn rmd_start_age(&self, birth_year: i32) -> u32 {
        self.rmd
            .start_age_by_birth_year
            .iter()
            .find(|r| r.born_through.is_none_or(|y| birth_year <= y))
            .map(|r| r.age)
            .unwrap_or(75)
    }

    /// Uniform Lifetime Table divisor; ages past the table use the last entry.
    pub fn rmd_divisor(&self, age: u32) -> Option<f64> {
        let table = &self.rmd.uniform_lifetime_divisors;
        table.get(&age.to_string()).copied().or_else(|| {
            let max = table.keys().filter_map(|k| k.parse::<u32>().ok()).max()?;
            (age > max).then(|| table[&max.to_string()])
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_2026_tables() {
        let t = TaxTables::current();
        assert_eq!(t.year, 2026);
        assert_eq!(*t.standard_deduction.get(FilingStatus::Single), 16_100.0);
        assert_eq!(t.ordinary_brackets.get(FilingStatus::MarriedJoint).len(), 7);
        assert!(t.ordinary_brackets.single.last().unwrap().up_to.is_none());
    }

    #[test]
    fn estate_gift_figures_and_indexing() {
        let t = TaxTables::current();
        assert_eq!(t.estate_gift.exemption, 15_000_000.0);
        assert_eq!(t.annual_exclusion(1.0), 19_000.0);
        // 19,000 × 1.025 = 19,475 → rounds down to 19,000; × 1.06 = 20,140 → 20,000.
        assert_eq!(t.annual_exclusion(1.025), 19_000.0);
        assert_eq!(t.annual_exclusion(1.06), 20_000.0);
        let mut a = crate::model::Assumptions::default();
        assert_eq!(t.estate_exemption(2035, 1.0, &a), 15_000_000.0);
        a.exemption_cut_enabled = true;
        assert_eq!(t.estate_exemption(2029, 1.0, &a), 15_000_000.0);
        assert_eq!(t.estate_exemption(2030, 1.1, &a), 7_000_000.0 * 1.1);
    }

    #[test]
    fn afr_by_loan_length() {
        let afr = &TaxTables::current().afr;
        assert_eq!(afr.for_years(3), 0.0467);
        assert_eq!(afr.for_years(9), 0.0508);
        assert_eq!(afr.for_years(15), 0.0552);
    }

    #[test]
    fn rmd_start_ages_follow_secure_2() {
        let t = TaxTables::current();
        assert_eq!(t.rmd_start_age(1950), 72);
        assert_eq!(t.rmd_start_age(1959), 73);
        assert_eq!(t.rmd_start_age(1960), 75);
        assert_eq!(t.rmd_divisor(73), Some(26.5));
        assert_eq!(t.rmd_divisor(125), Some(2.0));
        assert_eq!(t.rmd_divisor(60), None);
    }
}
