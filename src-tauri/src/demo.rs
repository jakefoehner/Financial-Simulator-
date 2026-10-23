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
        let sim = simulate(&h, 2026).unwrap();
        // Scenario details keyed "scenario_detail:<pathIndex>" for the preview mock.
        let details: serde_json::Map<String, serde_json::Value> = sim
            .representatives
            .iter()
            .map(|r| {
                let d = scenario_detail(&h, 2026, r.path_index).unwrap();
                (format!("scenario_detail:{}", r.path_index), serde_json::to_value(d).unwrap())
            })
            .collect();
        let mut json = serde_json::json!({
            "get_household": h,
            "run_projection": project(&h, 2026).unwrap(),
            "compare_claim_ages": compare_claim_ages(&h, 2026).unwrap(),
            "run_simulation": sim,
        });
        json.as_object_mut().unwrap().extend(details);
        std::fs::write(path, serde_json::to_string(&json).unwrap()).unwrap();
    }

    #[test]
    fn demo_ranges_are_sane() {
        use engine::montecarlo::simulate;
        let retiree = simulate(&household(Demo::Retiree), 2026).unwrap();
        let early = simulate(&household(Demo::EarlyCareer), 2026).unwrap();
        println!(
            "retiree: money lasts {:.1}%, lives off growth {:.1}%, median end {:.0}, 1-in-10 end {:.0}",
            retiree.money_lasts * 100.0,
            retiree.lives_off_growth * 100.0,
            retiree.investable_real.p50.last().unwrap(),
            retiree.investable_real.p10.last().unwrap()
        );
        println!("early career: money lasts {:.1}%", early.money_lasts * 100.0);
        assert_eq!(retiree.scenarios, 5_000);
        // A $6.9M household spending $180k should almost always be fine, but not always.
        assert!(retiree.money_lasts > 0.85, "{}", retiree.money_lasts);
        assert!(retiree.lives_off_growth < retiree.money_lasts);
        assert!(early.money_lasts > 0.5);
    }

    /// Guards against the engine drifting into nonsense on realistic households.
    /// Run with `cargo test demo_projections -- --nocapture` to see the numbers.
    #[test]
    fn demo_projections_are_sane() {
        use engine::projection::project;

        let retiree = project(&household(Demo::Retiree), 2026).unwrap();
        let early = project(&household(Demo::EarlyCareer), 2026).unwrap();
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

        // A $6.9M household spending $180k with SS and rental income should not run out.
        assert_eq!(retiree.summary.runs_out_at_age, None);
        let y0 = &retiree.years[0];
        assert!(y0.taxes > 0.0 && y0.taxes < 100_000.0, "first-year taxes {}", y0.taxes);
        // RMDs begin at 73 for someone born in 1959.
        assert!(retiree.years.iter().find(|y| y.age == 73).unwrap().required_distributions > 0.0);

        // The early-career saver accumulates while working.
        let at40 = early.years.iter().find(|y| y.age == 40).unwrap();
        assert!(at40.net_worth_real() > early.years[0].net_worth_real());
    }
}
