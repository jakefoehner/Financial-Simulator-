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
}
