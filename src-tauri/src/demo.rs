//! Built-in demo households (generic, not real people) so new users can
//! explore the app before entering their own numbers.

use engine::model::Household;
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Demo {
    Retiree,
    EarlyCareer,
}

impl Demo {
    #[cfg(test)]
    pub const ALL: &'static [Demo] = &[Demo::Retiree, Demo::EarlyCareer];

    fn json(self) -> &'static str {
        match self {
            Demo::Retiree => include_str!("../../fixtures/demo-retiree.json"),
            Demo::EarlyCareer => include_str!("../../fixtures/demo-early-career.json"),
        }
    }
}

/// The fixtures are compiled in and covered by tests, so parsing can't fail at runtime.
pub fn household(which: Demo) -> Household {
    serde_json::from_str(which.json()).expect("demo fixture is valid JSON")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_demo_parses_and_validates() {
        for which in Demo::ALL {
            let h = household(*which);
            h.validate().unwrap_or_else(|e| panic!("{which:?}: {e}"));
            assert!(!h.people.is_empty() && !h.accounts.is_empty());
        }
    }

    /// Dev tool: writes a demo household and its forecast as JSON, for previewing
    /// the UI outside Tauri. `FSIM_DUMP=out.json cargo test dump_demo -- --ignored`
    #[test]
    #[ignore]
    fn dump_demo_json() {
        use engine::montecarlo::{scenario_detail, simulate};
        use engine::projection::{compare_claim_ages, project};
        let path = std::env::var("FSIM_DUMP").expect("set FSIM_DUMP to an output path");
        let h = household(Demo::Retiree);
        let t = engine::tax_tables::TaxTables::current();
        let mut json = serde_json::json!({
            "get_household": h,
            "tax_facts": {
                "taxYear": t.year,
                "annualExclusion": t.estate_gift.annual_exclusion,
                "exemption": t.estate_gift.exemption,
                "afrMonth": t.afr.month,
                "afrShortTerm": t.afr.short_term,
                "afrMidTerm": t.afr.mid_term,
                "afrLongTerm": t.afr.long_term,
            },
        });
        let out = json.as_object_mut().unwrap();
        // Keyed "<command>:<plan>" (plan = "base" or a scenario id) for the preview mock.
        let mut plans: Vec<Option<engine::model::Id>> = vec![None];
        plans.extend(h.scenarios.iter().map(|s| s.id));
        for plan in plans {
            let key = plan.map_or("base".to_string(), |id| id.to_string());
            let sim = simulate(&h, plan, 2026).unwrap();
            for r in &sim.representatives {
                let d = scenario_detail(&h, plan, 2026, r.path_index).unwrap();
                out.insert(format!("scenario_detail:{key}:{}", r.path_index), serde_json::to_value(d).unwrap());
            }
            out.insert(
                format!("run_projection:{key}"),
                serde_json::to_value(project(&h, plan, 2026).unwrap()).unwrap(),
            );
            out.insert(
                format!("compare_claim_ages:{key}"),
                serde_json::to_value(compare_claim_ages(&h, plan, 2026).unwrap()).unwrap(),
            );
            out.insert(format!("run_simulation:{key}"), serde_json::to_value(sim).unwrap());
        }
        let req = engine::solver::SafeGiftRequest { yearly: false, years: 1, target: 0.95 };
        let gift = engine::solver::safe_gift(&h, None, 2026, req).unwrap();
        json.as_object_mut().unwrap().insert("safe_gift".into(), serde_json::to_value(gift).unwrap());
        std::fs::write(path, serde_json::to_string(&json).unwrap()).unwrap();
    }

    #[test]
    fn demo_ranges_are_sane() {
        use engine::montecarlo::simulate;
        let retiree = simulate(&household(Demo::Retiree), None, 2026).unwrap();
        let early = simulate(&household(Demo::EarlyCareer), None, 2026).unwrap();
        println!(
            "retiree: money lasts {:.1}%, lives off growth {:.1}%, median end {:.0}, 1-in-10 end {:.0}",
            retiree.money_lasts * 100.0,
            retiree.lives_off_growth * 100.0,
            retiree.investable_real.p50.last().unwrap(),
            retiree.investable_real.p10.last().unwrap()
        );
        println!("early career: money lasts {:.1}%", early.money_lasts * 100.0);
        assert_eq!(retiree.scenarios, 5_000);
        // A $16.5M household spending $300k should almost always be fine, but not always.
        assert!(retiree.money_lasts > 0.85, "{}", retiree.money_lasts);
        assert!(retiree.lives_off_growth < retiree.money_lasts);
        assert!(early.money_lasts > 0.5);
    }

    /// The demo plans should tell the story the Compare view is built for.
    /// `cargo test demo_plans -- --nocapture` prints the comparison.
    #[test]
    fn demo_plans_are_sane() {
        use engine::projection::project;
        let mut h = household(Demo::Retiree);
        let plans = [None, Some(1), Some(2), Some(3), Some(4), Some(5)];
        let run = |h: &engine::model::Household| plans.map(|p| project(h, p, 2026).unwrap().summary.estate);
        let now = run(&h);
        h.assumptions.exemption_cut_enabled = true;
        let cut = run(&h);
        for (i, p) in plans.iter().enumerate() {
            let e = &now[i];
            println!(
                "plan {p:?}: estate tax {:>11.0} (cut: {:>11.0})  family total {:>12.0}  kids {:?}",
                e.estate_tax_real,
                cut[i].estate_tax_real,
                e.family_total_real,
                e.children.iter().map(|c| c.total_real.round()).collect::<Vec<_>>()
            );
        }
        let [base, home, yearly, loan, stock, big] = &now;
        assert!(base.estate_tax_real > 0.0, "an estate above the exemption should owe some estate tax");
        // Yearly exclusion gifts lower the estate tax and raise what the family gets in total.
        assert!(yearly.estate_tax_real < base.estate_tax_real);
        assert!(yearly.family_total_real > base.family_total_real);
        // Helping one child makes the totals unequal.
        assert!(home.children[0].total_real > home.children[1].total_real);
        assert!(loan.children[1].total_real > loan.children[0].total_real);
        // Cutting the exemption raises the estate tax in every plan.
        for i in 0..plans.len() {
            assert!(cut[i].estate_tax_real > now[i].estate_tax_real);
        }
        // Gifting stock: the kids inherit your basis, so they owe some capital-gains tax; less estate tax.
        assert!(stock.heirs_capital_gains_tax_real > 0.0);
        assert!(stock.estate_tax_real < base.estate_tax_real);
        // A big gift now saves at least as much if the exemption is later cut. Gifts that used the
        // exemption are added back to the estate, so what's saved is 40% of the growth after the gift;
        // for an estate far above both exemption levels that's the same either way (anti-clawback
        // matters most for estates near the exemption).
        let saved_now = base.estate_tax_real - big.estate_tax_real;
        let saved_if_cut = cut[0].estate_tax_real - cut[5].estate_tax_real;
        println!("big gift saves {saved_now:.0} now, {saved_if_cut:.0} if the exemption is cut");
        assert!(saved_if_cut >= saved_now - 1.0);
        assert!(big.family_total_real > base.family_total_real);
    }

    #[test]
    fn demo_safe_gift_is_sane() {
        use engine::solver::{SafeGiftRequest, safe_gift};
        let h = household(Demo::Retiree);
        let r = safe_gift(&h, None, 2026, SafeGiftRequest { yearly: false, years: 1, target: 0.95 }).unwrap();
        println!(
            "safe one-time gift: {:.0} to each child ({:.0} total), odds {:.1}% (base {:.1}%)",
            r.max_per_child,
            r.max_total,
            r.at_max.money_lasts * 100.0,
            r.base_money_lasts * 100.0
        );
        assert!(r.achievable && r.max_per_child > 100_000.0);
        assert!(r.at_max.money_lasts >= 0.95);
    }

    /// Guards against the engine drifting into nonsense on realistic households.
    /// Run with `cargo test demo_projections -- --nocapture` to see the numbers.
    #[test]
    fn demo_projections_are_sane() {
        use engine::projection::project;

        let retiree = project(&household(Demo::Retiree), None, 2026).unwrap();
        let early = project(&household(Demo::EarlyCareer), None, 2026).unwrap();
        for (name, p) in [("retiree", &retiree), ("early career", &early)] {
            println!("{name}: {:#?}", p.summary);
            for y in p.years.iter().step_by(5) {
                println!(
                    "  {} age {:>3}: taxes {:>9.0}  withdrawals {:>9.0}  SS {:>8.0}  net worth (today's $) {:>12.0}",
                    y.year,
                    y.age,
                    y.taxes,
                    y.withdrawals,
                    y.social_security,
                    y.net_worth_real()
                );
            }
        }

        // A $16.5M household spending $300k with SS and rental income should not run out.
        assert_eq!(retiree.summary.runs_out_at_age, None);
        let y0 = &retiree.years[0];
        assert!(y0.taxes > 0.0 && y0.taxes < 100_000.0, "first-year taxes {}", y0.taxes);
        // RMDs begin at 75 for someone born in 1968.
        assert!(retiree.years.iter().find(|y| y.age == 75).unwrap().required_distributions > 0.0);

        // The early-career saver accumulates while working.
        let at40 = early.years.iter().find(|y| y.age == 40).unwrap();
        assert!(at40.net_worth_real() > early.years[0].net_worth_real());
    }
}
