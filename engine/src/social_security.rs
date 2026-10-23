//! Social Security claiming-age adjustments (SSA rules for retirement benefits).

/// Full retirement age in months, by birth year.
pub fn full_retirement_age_months(birth_year: i32) -> u32 {
    match birth_year {
        ..=1937 => 65 * 12,
        1938..=1942 => 65 * 12 + 2 * (birth_year - 1937) as u32,
        1943..=1954 => 66 * 12,
        1955..=1959 => 66 * 12 + 2 * (birth_year - 1954) as u32,
        _ => 67 * 12,
    }
}

/// Multiplier on the full-retirement-age benefit for claiming at `claim_age`.
///
/// Early: 5/9 of 1% per month for the first 36 months, 5/12 of 1% after.
/// Late: 2/3 of 1% per month (8%/year) up to age 70.
pub fn claiming_factor(birth_year: i32, claim_age: u32) -> f64 {
    let fra = full_retirement_age_months(birth_year) as i64;
    let claim = (claim_age.min(70) * 12) as i64;
    let diff = claim - fra;
    if diff < 0 {
        let early = (-diff) as f64;
        1.0 - (5.0 / 900.0) * early.min(36.0) - (5.0 / 1200.0) * (early - 36.0).max(0.0)
    } else {
        1.0 + (2.0 / 300.0) * diff as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "expected {b}, got {a}");
    }

    #[test]
    fn full_retirement_ages() {
        assert_eq!(full_retirement_age_months(1950), 66 * 12);
        assert_eq!(full_retirement_age_months(1959), 66 * 12 + 10);
        assert_eq!(full_retirement_age_months(1998), 67 * 12);
    }

    #[test]
    fn claiming_factors_match_ssa_tables() {
        // Born 1960+: 70% at 62, 100% at 67, 124% at 70.
        close(claiming_factor(1965, 62), 0.70);
        close(claiming_factor(1965, 67), 1.0);
        close(claiming_factor(1965, 70), 1.24);
        // Born 1959 (FRA 66y10m): claiming at 67 is 2 months late → +1.333%.
        close(claiming_factor(1959, 67), 1.0 + 2.0 * 2.0 / 300.0);
    }
}
