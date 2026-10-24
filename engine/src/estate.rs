//! The estate and what the family receives (federal only, planning-grade).
//!
//! At the estate age (default: the plan's last year):
//! - Gross estate = net worth, including family loans still owed to you.
//! - Estate tax = 40% × (gross estate + lifetime gifts above the yearly
//!   exclusions − exemption), less any gift tax already paid. The exemption is
//!   $15M in 2026, indexed for inflation, unless the household turned on the
//!   "exemption cut" what-if. Texas has no estate tax.
//! - Heirs pay income tax on inherited traditional IRA/401(k) money (emptied
//!   within 10 years) at an assumed rate (default 24%). Other inherited assets
//!   get a stepped-up cost basis, so no capital-gains tax on past growth.
//! - Each child receives their own lifetime gifts plus an equal share of what's left.
//!   For a fair comparison with money kept (which grows until the estate date),
//!   gifts are also shown grown to the estate date at the same yearly return your
//!   own savings earned, as if the child invested them the same way. The kids then
//!   owe capital-gains tax (an assumed rate, default 15%) on that growth above their
//!   cost basis: the gift amount for cash, your original basis for gifted investments.
//! - Anti-clawback (IRS regulations, 2019): if the exemption is cut after you've used it,
//!   gifts already sheltered stay sheltered. The estate uses the larger of the exemption
//!   at death and the amount your lifetime gifts locked in.

use std::ops::Add;

use serde::Serialize;

use crate::model::{Household, Id, Role};
use crate::projection::YearResult;
use crate::tax_tables::TaxTables;

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildEstate {
    /// `None` when the household lists no children ("Heirs").
    pub child_id: Option<Id>,
    pub name: String,
    /// Gifts in today's dollars at the time they were given.
    pub gifts_real: f64,
    /// The same gifts grown to the estate date at your portfolio's return.
    pub gifts_grown_real: f64,
    /// Capital-gains tax the child would owe selling those gifts (gifts keep their basis).
    pub gifts_capital_gains_tax_real: f64,
    pub inheritance_real: f64,
    /// `gifts_grown_real - gifts_capital_gains_tax_real + inheritance_real`.
    pub total_real: f64,
}

/// All amounts in today's dollars.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EstateResult {
    pub age: u32,
    pub year: i32,
    pub gross_estate_real: f64,
    /// Lifetime exemption used by gifts, each year's use in that year's dollars converted to today's.
    pub lifetime_taxable_gifts_real: f64,
    pub exemption_real: f64,
    pub exemption_cut_applies: bool,
    pub estate_tax_real: f64,
    pub gift_tax_paid_real: f64,
    pub heir_income_tax_rate: f64,
    pub heirs_income_tax_real: f64,
    pub net_inheritance_real: f64,
    pub lifetime_gifts_real: f64,
    pub lifetime_gifts_grown_real: f64,
    pub heir_capital_gains_rate: f64,
    pub heirs_capital_gains_tax_real: f64,
    /// True when gifts made under a higher exemption are protecting the estate (anti-clawback).
    pub anti_clawback_applies: bool,
    /// Everything the children receive: gifts (grown to the estate date) plus the inheritance after taxes.
    pub family_total_real: f64,
    pub children: Vec<ChildEstate>,
}

pub fn estate_at(h: &Household, years: &[YearResult], start_year: i32, t: &TaxTables) -> EstateResult {
    if years.is_empty() {
        return EstateResult::default();
    }
    let a = &h.assumptions;
    let i = a.estate_age.and_then(|age| years.iter().position(|y| y.age >= age)).unwrap_or(years.len() - 1);
    let y = &years[i];

    let price = y.price_level;
    let index = price * (1.0 + a.inflation).powi(start_year - t.year);
    let exemption_at_death = t.estate_exemption(y.year, index, a);
    let exemption = exemption_at_death.max(y.sheltered_gifts);
    let gift_tax_paid = years[..=i].iter().map(|y| y.gift_tax).fold(0.0, f64::add);
    let gross = y.net_worth.max(0.0);
    let taxable = gross + y.lifetime_taxable_gifts - exemption;
    let estate_tax = (t.estate_gift.top_rate * taxable.max(0.0) - gift_tax_paid).max(0.0);
    let heirs_income_tax = y.balances.tax_deferred.max(0.0) * a.heir_income_tax_rate;
    let net = (gross - estate_tax - heirs_income_tax).max(0.0);

    // Per child: (gifts in today's dollars when given, grown to the estate date, kids' capital-gains tax),
    // all in today's dollars. Gifts happen at the start of a year, so they grow through that year and later ones.
    let mut gifts_by_child: Vec<(Id, f64, f64, f64)> = Vec::new();
    for (k, yr) in years[..=i].iter().enumerate() {
        let level = if k == 0 { 1.0 } else { years[k - 1].price_level };
        let growth: f64 = years[k..=i].iter().map(|y| 1.0 + y.portfolio_return).product();
        for g in &yr.gifts_by_child {
            let grown_nominal = g.amount * growth;
            let tax_nominal = a.heir_capital_gains_rate * (grown_nominal - g.basis).max(0.0);
            let (face, grown, tax) = (g.amount / level, grown_nominal / price, tax_nominal / price);
            match gifts_by_child.iter_mut().find(|e| e.0 == g.child_id) {
                Some(e) => {
                    e.1 += face;
                    e.2 += grown;
                    e.3 += tax;
                }
                None => gifts_by_child.push((g.child_id, face, grown, tax)),
            }
        }
    }
    let lifetime_gifts_real = gifts_by_child.iter().map(|g| g.1).fold(0.0, f64::add);
    let lifetime_gifts_grown_real = gifts_by_child.iter().map(|g| g.2).fold(0.0, f64::add);
    let heirs_capital_gains_tax_real = gifts_by_child.iter().map(|g| g.3).fold(0.0, f64::add);
    let exemption_used_real = years[..=i]
        .iter()
        .enumerate()
        .map(|(k, yr)| {
            let (level, before) =
                if k == 0 { (1.0, 0.0) } else { (years[k - 1].price_level, years[k - 1].lifetime_taxable_gifts) };
            (yr.lifetime_taxable_gifts - before) / level
        })
        .fold(0.0, f64::add);

    let kids: Vec<_> = h.people.iter().filter(|p| p.role == Role::Child).collect();
    let net_real = net / price;
    let children = if kids.is_empty() {
        vec![ChildEstate {
            child_id: None,
            name: "Heirs".into(),
            gifts_real: lifetime_gifts_real,
            gifts_grown_real: lifetime_gifts_grown_real,
            gifts_capital_gains_tax_real: heirs_capital_gains_tax_real,
            inheritance_real: net_real,
            total_real: lifetime_gifts_grown_real - heirs_capital_gains_tax_real + net_real,
        }]
    } else {
        let share = net_real / kids.len() as f64;
        kids.iter()
            .map(|k| {
                let (face, grown, tax) =
                    gifts_by_child.iter().find(|g| Some(g.0) == k.id).map_or((0.0, 0.0, 0.0), |g| (g.1, g.2, g.3));
                ChildEstate {
                    child_id: k.id,
                    name: k.name.clone(),
                    gifts_real: face,
                    gifts_grown_real: grown,
                    gifts_capital_gains_tax_real: tax,
                    inheritance_real: share,
                    total_real: grown - tax + share,
                }
            })
            .collect()
    };

    EstateResult {
        age: y.age,
        year: y.year,
        gross_estate_real: gross / price,
        lifetime_taxable_gifts_real: exemption_used_real,
        exemption_real: exemption / price,
        exemption_cut_applies: a.exemption_cut_enabled && y.year >= a.exemption_cut_year,
        estate_tax_real: estate_tax / price,
        gift_tax_paid_real: gift_tax_paid / price,
        heir_income_tax_rate: a.heir_income_tax_rate,
        heirs_income_tax_real: heirs_income_tax / price,
        net_inheritance_real: net_real,
        lifetime_gifts_real,
        lifetime_gifts_grown_real,
        heir_capital_gains_rate: a.heir_capital_gains_rate,
        heirs_capital_gains_tax_real,
        anti_clawback_applies: y.sheltered_gifts > exemption_at_death,
        family_total_real: net_real + lifetime_gifts_grown_real - heirs_capital_gains_tax_real,
        children,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Assumptions, Person};
    use crate::projection::{Balances, ChildAmount};

    fn household(kids: usize, a: Assumptions) -> Household {
        let mut people = vec![Person {
            id: Some(1),
            name: "Pat".into(),
            birth_year: 1968,
            role: Role::Primary,
            life_expectancy: 100,
            ss_monthly_benefit: None,
            ss_claim_age: 67,
            ss_already_claiming: false,
        }];
        for k in 0..kids {
            people.push(Person {
                id: Some(10 + k as Id),
                name: format!("Kid{k}"),
                birth_year: 1995,
                role: Role::Child,
                life_expectancy: 100,
                ss_monthly_benefit: None,
                ss_claim_age: 67,
                ss_already_claiming: false,
            });
        }
        Household { people, assumptions: a, ..Default::default() }
    }

    /// One year ending with `net_worth`, `tax_deferred` of it in traditional accounts.
    fn year(year: i32, net_worth: f64, tax_deferred: f64, lifetime_taxable_gifts: f64) -> YearResult {
        YearResult {
            year,
            age: (year - 1968) as u32,
            net_worth,
            balances: Balances { tax_deferred, ..Default::default() },
            lifetime_taxable_gifts,
            price_level: 1.0,
            ..Default::default()
        }
    }

    fn close(a: f64, b: f64) {
        assert!((a - b).abs() < 0.01, "expected {b}, got {a}");
    }

    #[test]
    fn under_the_exemption_there_is_no_estate_tax() {
        let h = household(2, Assumptions::default());
        let e = estate_at(&h, &[year(2026, 10_000_000.0, 1_000_000.0, 0.0)], 2026, TaxTables::current());
        close(e.estate_tax_real, 0.0);
        // Heirs owe 24% on the $1M inherited IRA; the rest is split evenly.
        close(e.heirs_income_tax_real, 240_000.0);
        close(e.net_inheritance_real, 9_760_000.0);
        close(e.children[0].inheritance_real, 4_880_000.0);
    }

    #[test]
    fn above_the_exemption_pays_40_percent() {
        let h = household(2, Assumptions::default());
        let e = estate_at(&h, &[year(2026, 20_000_000.0, 0.0, 0.0)], 2026, TaxTables::current());
        // (20M − 15M) × 40% = 2M.
        close(e.estate_tax_real, 2_000_000.0);
        close(e.family_total_real, 18_000_000.0);
    }

    #[test]
    fn lifetime_gifts_use_up_the_exemption() {
        let h = household(1, Assumptions::default());
        // $14M estate + $3M of gifts above the yearly exclusions → $17M taxable → $0.8M tax.
        let e = estate_at(&h, &[year(2026, 14_000_000.0, 0.0, 3_000_000.0)], 2026, TaxTables::current());
        close(e.estate_tax_real, 800_000.0);
    }

    #[test]
    fn exemption_cut_raises_the_tax_from_its_year() {
        let a = Assumptions { exemption_cut_enabled: true, ..Default::default() };
        let h = household(2, a);
        let before = estate_at(&h, &[year(2029, 10_000_000.0, 0.0, 0.0)], 2026, TaxTables::current());
        let after = estate_at(&h, &[year(2031, 10_000_000.0, 0.0, 0.0)], 2026, TaxTables::current());
        close(before.estate_tax_real, 0.0);
        assert!(after.exemption_cut_applies);
        // (10M − 7M) × 40% = 1.2M.
        close(after.estate_tax_real, 1_200_000.0);
    }

    #[test]
    fn gifts_count_toward_each_childs_total() {
        let h = household(2, Assumptions::default());
        let mut y0 = year(2026, 5_000_000.0, 0.0, 81_000.0);
        y0.gifts_by_child = vec![ChildAmount { child_id: 10, amount: 100_000.0, basis: 100_000.0 }];
        let e = estate_at(&h, &[y0], 2026, TaxTables::current());
        let (a, b) = (&e.children[0], &e.children[1]);
        close(a.gifts_real, 100_000.0);
        close(b.gifts_real, 0.0);
        close(a.total_real - b.total_real, 100_000.0);
        close(e.family_total_real, 5_100_000.0);
    }

    #[test]
    fn gifts_grow_to_the_estate_date_at_the_portfolio_return() {
        let h = household(1, Assumptions::default());
        let mut y0 = year(2026, 0.0, 0.0, 0.0);
        y0.gifts_by_child = vec![ChildAmount { child_id: 10, amount: 100_000.0, basis: 100_000.0 }];
        y0.portfolio_return = 0.10;
        let mut y1 = year(2027, 1_000_000.0, 0.0, 0.0);
        y1.portfolio_return = 0.10;
        let e = estate_at(&h, &[y0, y1], 2026, TaxTables::current());
        // Given at the start of 2026, grown through 2026 and 2027: 100k × 1.1² = 121k.
        // The kids owe 15% on the 21k of growth when they sell (3,150).
        close(e.children[0].gifts_real, 100_000.0);
        close(e.children[0].gifts_grown_real, 121_000.0);
        close(e.children[0].gifts_capital_gains_tax_real, 3_150.0);
        close(e.family_total_real, 1_117_850.0);
    }

    #[test]
    fn gifted_stock_carries_its_low_basis() {
        // $100k of stock with a $20k basis, sold right away: 15% × 80k = 12k of tax for the kids.
        let h = household(1, Assumptions::default());
        let mut y0 = year(2026, 0.0, 0.0, 0.0);
        y0.gifts_by_child = vec![ChildAmount { child_id: 10, amount: 100_000.0, basis: 20_000.0 }];
        let e = estate_at(&h, &[y0], 2026, TaxTables::current());
        close(e.children[0].gifts_capital_gains_tax_real, 12_000.0);
        close(e.children[0].total_real, 88_000.0);
    }

    #[test]
    fn anti_clawback_protects_gifts_made_before_a_cut() {
        // $10M of gifts sheltered under the $15M exemption; exemption later cut to $7M.
        // Estate $10M + $10M gifts = $20M taxable. Without anti-clawback: (20 − 7) × 40% = 5.2M.
        // With it, the exemption is max(7M, 10M sheltered) = 10M: (20 − 10) × 40% = 4M.
        let a = Assumptions { exemption_cut_enabled: true, ..Default::default() };
        let h = household(2, a);
        let mut y = year(2031, 10_000_000.0, 0.0, 10_000_000.0);
        y.sheltered_gifts = 10_000_000.0;
        let e = estate_at(&h, &[y], 2026, TaxTables::current());
        assert!(e.anti_clawback_applies);
        close(e.estate_tax_real, 4_000_000.0);
    }

    #[test]
    fn estate_age_picks_the_year() {
        let a = Assumptions { estate_age: Some(59), ..Default::default() };
        let h = household(1, a);
        let years = [year(2026, 1.0, 0.0, 0.0), year(2027, 2.0, 0.0, 0.0), year(2028, 3.0, 0.0, 0.0)];
        assert_eq!(estate_at(&h, &years, 2026, TaxTables::current()).age, 59);
    }
}
