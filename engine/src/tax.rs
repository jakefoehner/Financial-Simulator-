//! Federal tax for one year, planning-grade.
//!
//! Covers: ordinary brackets, standard deduction (+65 add-on, 2025–2028 senior
//! deduction), qualified dividends / long-term gains at 0/15/20% stacked on
//! ordinary income, taxation of Social Security, payroll (FICA, additional
//! Medicare) and self-employment tax, 3.8% NIIT, the child tax credit, the 10%
//! early-withdrawal penalty, and an optional flat state rate.
//!
//! Not modeled yet: itemized deductions, AMT, QBI, ACA credits, capital losses.

use serde::Serialize;

use crate::model::FilingStatus;
use crate::tax_tables::{Bracket, TaxTables};

#[derive(Debug, Clone, Default)]
pub struct TaxInput {
    pub year: i32,
    pub filing_status: FilingStatus,
    /// Price level relative to the tables' year; scales inflation-indexed amounts.
    pub index: f64,
    /// Gross W-2 wages and bonuses, one entry per earner (FICA applies per person).
    pub wages_by_person: Vec<f64>,
    /// Pre-tax 401(k)/HSA/deductible IRA contributions (reduce income tax, not FICA).
    pub pretax_contributions: f64,
    /// Net self-employment profit.
    pub self_employment: f64,
    /// Pensions, annuities, other ordinary income (not investment income).
    pub pension_and_other: f64,
    /// Net rental income (ordinary, and investment income for NIIT).
    pub rental: f64,
    /// Taxable interest (ordinary, investment income).
    pub interest: f64,
    pub qualified_dividends: f64,
    pub long_term_gains: f64,
    /// Withdrawals from traditional accounts, including RMDs and Roth conversions.
    pub traditional_distributions: f64,
    /// The part of `traditional_distributions` taken before the penalty-free age.
    pub early_distributions: f64,
    pub social_security_benefits: f64,
    /// Filers age 65+ (for the extra standard deduction and senior deduction).
    pub filers_65_plus: u32,
    pub children_under_17: u32,
    pub state_rate: f64,
    /// Net capital loss used against ordinary income this year (up to $3,000).
    pub capital_loss_deduction: f64,
    /// "What if taxes rise": added to every ordinary bracket rate (0.05 = 5 points).
    pub ordinary_rate_increase: f64,
    /// ...and to the 15% / 20% capital-gains rates.
    pub gains_rate_increase: f64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxResult {
    pub agi: f64,
    pub taxable_social_security: f64,
    pub deduction: f64,
    pub taxable_income: f64,
    pub ordinary_tax: f64,
    pub capital_gains_tax: f64,
    pub child_tax_credit: f64,
    /// Income tax after credits.
    pub income_tax: f64,
    pub niit: f64,
    /// Employee Social Security + Medicare, plus additional Medicare tax.
    pub payroll_tax: f64,
    pub self_employment_tax: f64,
    pub early_withdrawal_penalty: f64,
    pub state_tax: f64,
    /// Everything above that is owed to the federal government.
    pub federal_total: f64,
    /// Federal + state.
    pub total: f64,
    /// Rate on the next dollar of ordinary income.
    pub marginal_rate: f64,
}

pub fn compute(t: &TaxTables, i: &TaxInput) -> TaxResult {
    let s = i.filing_status;
    let idx = if i.index > 0.0 { i.index } else { 1.0 };

    // --- Payroll and self-employment tax ---
    let p = &t.payroll;
    let wage_base = p.wage_base * idx;
    let wages: f64 = i.wages_by_person.iter().sum();
    let fica: f64 =
        i.wages_by_person.iter().map(|w| p.social_security_rate * w.min(wage_base) + p.medicare_rate * w).sum();

    let se_earnings = (i.self_employment * p.self_employment_earnings_factor).max(0.0);
    let ss_room = (wage_base - i.wages_by_person.iter().copied().fold(0.0, f64::max)).max(0.0);
    let se_tax = p.self_employment_social_security_rate * se_earnings.min(ss_room)
        + p.self_employment_medicare_rate * se_earnings;
    let additional_medicare =
        p.additional_medicare_rate * (wages + se_earnings - p.additional_medicare_threshold.get(s)).max(0.0);

    // --- Income and Social Security taxation ---
    let income_before_ss = wages - i.pretax_contributions + i.self_employment - se_tax / 2.0
        + i.pension_and_other
        + i.rental
        + i.interest
        + i.qualified_dividends
        + i.long_term_gains
        + i.traditional_distributions
        - i.capital_loss_deduction;
    let taxable_ss = taxable_social_security(t, s, income_before_ss, i.social_security_benefits);
    let agi = (income_before_ss + taxable_ss).max(0.0);

    // --- Deductions ---
    let mut deduction =
        t.standard_deduction.get(s) * idx + t.additional_deduction_65.get(s) * idx * i.filers_65_plus as f64;
    let sd = &t.senior_deduction;
    if i.year <= sd.last_year && (s != FilingStatus::MarriedSeparate || sd.married_separate_eligible) {
        let reduction = sd.phaseout_rate * (agi - sd.phaseout_start.get(s)).max(0.0);
        deduction += (sd.per_person - reduction).max(0.0) * i.filers_65_plus as f64;
    }
    let taxable_income = (agi - deduction).max(0.0);

    // --- Ordinary vs. preferential income ---
    let preferential = (i.qualified_dividends + i.long_term_gains).min(taxable_income);
    let ordinary_income = taxable_income - preferential;
    let brackets = t.ordinary_brackets.get(s);
    let ordinary_tax = bracket_tax(brackets, ordinary_income, idx) + i.ordinary_rate_increase * ordinary_income;

    let zero_top = t.capital_gains.zero_rate_up_to.get(s) * idx;
    let fifteen_top = t.capital_gains.fifteen_rate_up_to.get(s) * idx;
    let at_zero = (taxable_income.min(zero_top) - ordinary_income).clamp(0.0, preferential);
    let at_fifteen =
        (taxable_income.min(fifteen_top) - ordinary_income.max(zero_top)).clamp(0.0, preferential - at_zero);
    let at_twenty = preferential - at_zero - at_fifteen;
    let capital_gains_tax = (0.15 + i.gains_rate_increase) * at_fifteen + (0.20 + i.gains_rate_increase) * at_twenty;

    // --- Credits ---
    let ctc = &t.child_tax_credit;
    let phaseout_steps = ((agi - ctc.phaseout_start.get(s)).max(0.0) / 1000.0).ceil();
    let child_tax_credit = (ctc.per_child * idx * i.children_under_17 as f64 - ctc.phaseout_per_1000 * phaseout_steps)
        .max(0.0)
        .min(ordinary_tax + capital_gains_tax);
    let income_tax = ordinary_tax + capital_gains_tax - child_tax_credit;

    // --- Other federal taxes ---
    let investment_income = i.interest + i.qualified_dividends + i.long_term_gains + i.rental;
    let niit = t.niit.rate * investment_income.min((agi - t.niit.threshold.get(s)).max(0.0)).max(0.0);
    let early_withdrawal_penalty = t.early_withdrawal.penalty_rate * i.early_distributions;
    let payroll_tax = fica + additional_medicare;

    let federal_total = income_tax + niit + payroll_tax + se_tax + early_withdrawal_penalty;
    let state_tax = i.state_rate * taxable_income;

    TaxResult {
        agi,
        taxable_social_security: taxable_ss,
        deduction,
        taxable_income,
        ordinary_tax,
        capital_gains_tax,
        child_tax_credit,
        income_tax,
        niit,
        payroll_tax,
        self_employment_tax: se_tax,
        early_withdrawal_penalty,
        state_tax,
        federal_total,
        total: federal_total + state_tax,
        marginal_rate: marginal_rate(brackets, ordinary_income, idx) + i.ordinary_rate_increase,
    }
}

/// IRS Social Security Benefits Worksheet (Pub. 915), simplified.
fn taxable_social_security(t: &TaxTables, s: FilingStatus, other_income: f64, benefits: f64) -> f64 {
    if benefits <= 0.0 {
        return 0.0;
    }
    let base = *t.social_security_taxation.base.get(s);
    let adjusted = *t.social_security_taxation.adjusted_base.get(s);
    let provisional = other_income + benefits / 2.0;
    if provisional <= base {
        0.0
    } else if provisional <= adjusted {
        (0.5 * (provisional - base)).min(0.5 * benefits)
    } else {
        let tier1 = (0.5 * benefits).min(0.5 * (adjusted - base));
        (0.85 * (provisional - adjusted) + tier1).min(0.85 * benefits)
    }
}

fn bracket_tax(brackets: &[Bracket], income: f64, idx: f64) -> f64 {
    let mut tax = 0.0;
    let mut lower = 0.0;
    for b in brackets {
        let upper = b.up_to.map_or(f64::INFINITY, |u| u * idx);
        if income <= lower {
            break;
        }
        tax += (income.min(upper) - lower) * b.rate;
        lower = upper;
    }
    tax
}

fn marginal_rate(brackets: &[Bracket], income: f64, idx: f64) -> f64 {
    brackets.iter().find(|b| b.up_to.is_none_or(|u| income < u * idx)).map_or(0.0, |b| b.rate)
}

/// Monthly IRMAA surcharge (Part B + Part D) for one Medicare enrollee, given
/// MAGI from two years earlier.
pub fn irmaa_monthly(t: &TaxTables, s: FilingStatus, magi: f64, idx: f64) -> f64 {
    let joint = s == FilingStatus::MarriedJoint;
    t.irmaa
        .tiers
        .iter()
        .rev()
        .find(|tier| magi > (if joint { tier.joint_over } else { tier.single_over }) * idx)
        .map_or(0.0, |tier| tier.part_b + tier.part_d)
        * idx
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tables() -> &'static TaxTables {
        TaxTables::current()
    }

    fn base(status: FilingStatus) -> TaxInput {
        TaxInput { year: 2026, filing_status: status, index: 1.0, ..Default::default() }
    }

    fn close(a: f64, b: f64) {
        assert!((a - b).abs() < 0.01, "expected {b}, got {a}");
    }

    #[test]
    fn single_w2_earner() {
        // $100,000 wages. Taxable: 100,000 - 16,100 = 83,900.
        // 12,400×10% + 38,000×12% + 33,500×22% = 1,240 + 4,560 + 7,370 = 13,170.
        // FICA: 6,200 + 1,450 = 7,650.
        let r = compute(tables(), &TaxInput { wages_by_person: vec![100_000.0], ..base(FilingStatus::Single) });
        close(r.taxable_income, 83_900.0);
        close(r.income_tax, 13_170.0);
        close(r.payroll_tax, 7_650.0);
        close(r.total, 20_820.0);
        assert_eq!(r.marginal_rate, 0.22);
    }

    #[test]
    fn retired_couple_with_social_security() {
        // MFJ, both 66. SS 40,000; IRA withdrawals 30,000; qualified dividends 10,000.
        // Provisional = 40,000 + 20,000 = 60,000 > 44,000:
        //   taxable SS = min(34,000, 0.85×16,000 + min(20,000, 6,000)) = 19,600.
        // AGI 59,600. Deduction 32,200 + 2×1,650 + 2×6,000 (senior) = 47,500. Taxable 12,100.
        // Dividends (10,000) in the 0% band; ordinary 2,100 × 10% = 210.
        let r = compute(
            tables(),
            &TaxInput {
                social_security_benefits: 40_000.0,
                traditional_distributions: 30_000.0,
                qualified_dividends: 10_000.0,
                filers_65_plus: 2,
                ..base(FilingStatus::MarriedJoint)
            },
        );
        close(r.taxable_social_security, 19_600.0);
        close(r.agi, 59_600.0);
        close(r.deduction, 47_500.0);
        close(r.capital_gains_tax, 0.0);
        close(r.income_tax, 210.0);
        close(r.payroll_tax, 0.0);
    }

    #[test]
    fn high_earner_with_gains_and_niit() {
        // Single, wages 300,000, LTCG 100,000, qualified dividends 20,000, interest 10,000.
        // AGI 430,000; taxable 413,900; preferential 120,000; ordinary 293,900.
        // Ordinary tax = 1,240 + 4,560 + 12,166 + 23,058 + 17,424 + 37,675×35% (13,186.25) = 71,634.25.
        // Gains: all in the 15% band → 18,000. NIIT: 3.8% × min(130,000, 230,000) = 4,940.
        // Payroll: 6.2%×184,500 (11,439) + 1.45%×300,000 (4,350) + 0.9%×100,000 (900) = 16,689.
        let r = compute(
            tables(),
            &TaxInput {
                wages_by_person: vec![300_000.0],
                long_term_gains: 100_000.0,
                qualified_dividends: 20_000.0,
                interest: 10_000.0,
                ..base(FilingStatus::Single)
            },
        );
        close(r.ordinary_tax, 71_634.25);
        close(r.capital_gains_tax, 18_000.0);
        close(r.niit, 4_940.0);
        close(r.payroll_tax, 16_689.0);
        close(r.federal_total, 71_634.25 + 18_000.0 + 4_940.0 + 16_689.0);
    }

    #[test]
    fn self_employed() {
        // Profit 50,000 → SE earnings 46,175 → SE tax 12.4% + 2.9% = 7,064.775.
        // AGI = 50,000 - 3,532.39 = 46,467.61; taxable 30,367.61; tax 1,240 + 17,967.61×12% = 3,396.11.
        let r = compute(tables(), &TaxInput { self_employment: 50_000.0, ..base(FilingStatus::Single) });
        close(r.self_employment_tax, 7_064.775);
        close(r.agi, 46_467.612_5);
        close(r.income_tax, 3_396.113_5);
    }

    #[test]
    fn early_withdrawal_penalty() {
        let r = compute(
            tables(),
            &TaxInput {
                traditional_distributions: 20_000.0,
                early_distributions: 20_000.0,
                ..base(FilingStatus::Single)
            },
        );
        close(r.early_withdrawal_penalty, 2_000.0);
    }

    #[test]
    fn child_tax_credit() {
        // MFJ wages 150,000, two kids. Taxable 117,800 → 2,480 + 9,120 + 3,740 = 15,340; minus 4,400 credit.
        let r = compute(
            tables(),
            &TaxInput { wages_by_person: vec![150_000.0], children_under_17: 2, ..base(FilingStatus::MarriedJoint) },
        );
        close(r.ordinary_tax, 15_340.0);
        close(r.child_tax_credit, 4_400.0);
        close(r.income_tax, 10_940.0);
    }

    #[test]
    fn senior_deduction_phases_out_and_expires() {
        // Single, 70, pension 100,000. Senior deduction 6,000 - 6%×25,000 = 4,500.
        // Deduction 16,100 + 2,050 + 4,500 = 22,650 → taxable 77,350 → 1,240 + 4,560 + 26,950×22% = 11,729.
        let input = TaxInput { pension_and_other: 100_000.0, filers_65_plus: 1, ..base(FilingStatus::Single) };
        close(compute(tables(), &input).income_tax, 11_729.0);
        // After 2028 the senior deduction is gone: taxable 81,850 → 12,719.
        close(compute(tables(), &TaxInput { year: 2029, ..input }).income_tax, 12_719.0);
    }

    #[test]
    fn indexing_scales_tax_with_inflation() {
        // Everything indexed + income up by the same factor → tax up by that factor.
        let r = compute(
            tables(),
            &TaxInput { wages_by_person: vec![102_500.0], index: 1.025, ..base(FilingStatus::Single) },
        );
        close(r.income_tax, 13_170.0 * 1.025);
    }

    #[test]
    fn tax_rise_adds_points_to_every_bracket_and_gains_rate() {
        // $100k wages: taxable 83,900. +5 points on all of it = +4,195.
        let plain = TaxInput { wages_by_person: vec![100_000.0], ..base(FilingStatus::Single) };
        let higher = TaxInput { ordinary_rate_increase: 0.05, ..plain.clone() };
        close(compute(tables(), &higher).income_tax - compute(tables(), &plain).income_tax, 4_195.0);
        assert!((compute(tables(), &higher).marginal_rate - 0.27).abs() < 1e-9);
        // $500k of gains on top of $300k wages: gains in the 15%/20% bands each rise 5 points.
        let gains =
            TaxInput { wages_by_person: vec![300_000.0], long_term_gains: 500_000.0, ..base(FilingStatus::Single) };
        let gains_up = TaxInput { gains_rate_increase: 0.05, ..gains.clone() };
        close(compute(tables(), &gains_up).capital_gains_tax - compute(tables(), &gains).capital_gains_tax, 25_000.0);
    }

    #[test]
    fn capital_loss_deduction_lowers_income() {
        let plain = TaxInput { wages_by_person: vec![100_000.0], ..base(FilingStatus::Single) };
        let with_loss = TaxInput { capital_loss_deduction: 3_000.0, ..plain.clone() };
        close(compute(tables(), &plain).agi - compute(tables(), &with_loss).agi, 3_000.0);
    }

    #[test]
    fn irmaa_tiers() {
        let t = tables();
        assert_eq!(irmaa_monthly(t, FilingStatus::Single, 100_000.0, 1.0), 0.0);
        close(irmaa_monthly(t, FilingStatus::Single, 120_000.0, 1.0), 81.2 + 14.5);
        close(irmaa_monthly(t, FilingStatus::Single, 600_000.0, 1.0), 487.0 + 91.0);
        close(irmaa_monthly(t, FilingStatus::MarriedJoint, 220_000.0, 1.0), 81.2 + 14.5);
    }
}
