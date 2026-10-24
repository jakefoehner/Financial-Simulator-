//! Whole-household operations: load everything, replace everything (demo
//! data, and later `.fsim` import), clear, and the household info row.

use engine::model::{Assumptions, FilingStatus, Household, HouseholdInfo};
use rusqlite::{Connection, params};

use super::records::{
    insert_account, insert_debt, insert_income, insert_one_time_expense, insert_person, insert_scenario, list_accounts,
    list_debts, list_income, list_one_time_expenses, list_people, list_scenarios,
};
use super::{Error, Result, enum_col};

/// Child tables first, so foreign keys never dangle mid-clear.
const DATA_TABLES: &[&str] = &["scenario", "one_time_expense", "debt", "income_stream", "account", "person"];

pub fn load_household(conn: &Connection) -> Result<Household> {
    Ok(Household {
        info: get_info(conn)?,
        people: list_people(conn)?,
        accounts: list_accounts(conn)?,
        income: list_income(conn)?,
        debts: list_debts(conn)?,
        one_time_expenses: list_one_time_expenses(conn)?,
        assumptions: get_assumptions(conn)?,
        scenarios: list_scenarios(conn)?,
    })
}

fn get_assumptions(conn: &Connection) -> Result<Assumptions> {
    Ok(conn.query_row(
        "SELECT stocks_return, bonds_return, cash_return, real_estate_growth, inflation, stock_dividend_yield,
                simulations, steady_inflation, heir_income_tax_rate, exemption_cut_enabled, exemption_cut_amount,
                exemption_cut_year, estate_age, heir_capital_gains_rate, tax_rise_enabled, tax_rise_year,
                income_tax_increase, capital_gains_increase
         FROM assumptions WHERE id = 1",
        [],
        |r| {
            Ok(Assumptions {
                stocks_return: r.get(0)?,
                bonds_return: r.get(1)?,
                cash_return: r.get(2)?,
                real_estate_growth: r.get(3)?,
                inflation: r.get(4)?,
                stock_dividend_yield: r.get(5)?,
                simulations: r.get(6)?,
                steady_inflation: r.get(7)?,
                heir_income_tax_rate: r.get(8)?,
                exemption_cut_enabled: r.get(9)?,
                exemption_cut_amount: r.get(10)?,
                exemption_cut_year: r.get(11)?,
                estate_age: r.get(12)?,
                heir_capital_gains_rate: r.get(13)?,
                tax_rise_enabled: r.get(14)?,
                tax_rise_year: r.get(15)?,
                income_tax_increase: r.get(16)?,
                capital_gains_increase: r.get(17)?,
            })
        },
    )?)
}

pub fn save_assumptions(conn: &Connection, a: &Assumptions) -> Result<()> {
    a.validate().map_err(Error::Invalid)?;
    conn.execute(
        "UPDATE assumptions SET stocks_return = ?1, bonds_return = ?2, cash_return = ?3, real_estate_growth = ?4,
             inflation = ?5, stock_dividend_yield = ?6, simulations = ?7, steady_inflation = ?8,
             heir_income_tax_rate = ?9, exemption_cut_enabled = ?10, exemption_cut_amount = ?11,
             exemption_cut_year = ?12, estate_age = ?13, heir_capital_gains_rate = ?14, tax_rise_enabled = ?15,
             tax_rise_year = ?16, income_tax_increase = ?17, capital_gains_increase = ?18
         WHERE id = 1",
        params![
            a.stocks_return,
            a.bonds_return,
            a.cash_return,
            a.real_estate_growth,
            a.inflation,
            a.stock_dividend_yield,
            a.simulations,
            a.steady_inflation,
            a.heir_income_tax_rate,
            a.exemption_cut_enabled,
            a.exemption_cut_amount,
            a.exemption_cut_year,
            a.estate_age,
            a.heir_capital_gains_rate,
            a.tax_rise_enabled,
            a.tax_rise_year,
            a.income_tax_increase,
            a.capital_gains_increase
        ],
    )?;
    Ok(())
}

fn get_info(conn: &Connection) -> Result<HouseholdInfo> {
    Ok(conn.query_row(
        "SELECT name, state, flat_state_rate, filing_status, base_annual_spending, home_property_tax
         FROM household WHERE id = 1",
        [],
        |r| {
            Ok(HouseholdInfo {
                name: r.get(0)?,
                state: r.get(1)?,
                flat_state_rate: r.get(2)?,
                filing_status: enum_col(r, 3, FilingStatus::parse)?,
                base_annual_spending: r.get(4)?,
                home_property_tax: r.get(5)?,
            })
        },
    )?)
}

pub fn save_info(conn: &Connection, info: &HouseholdInfo) -> Result<()> {
    info.validate().map_err(Error::Invalid)?;
    conn.execute(
        "UPDATE household SET
             name = ?1, state = ?2, flat_state_rate = ?3, filing_status = ?4, base_annual_spending = ?5,
             home_property_tax = ?6, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = 1",
        params![
            info.name.trim(),
            info.state,
            info.flat_state_rate,
            info.filing_status.as_str(),
            info.base_annual_spending,
            info.home_property_tax
        ],
    )?;
    Ok(())
}

/// Replaces all household data in one transaction. Record ids are kept, so
/// references between records (account owner, income person) stay intact.
pub fn replace_household(conn: &mut Connection, h: &Household) -> Result<()> {
    h.validate().map_err(Error::Invalid)?;
    let tx = conn.transaction()?;
    delete_all(&tx)?;
    save_info(&tx, &h.info)?;
    save_assumptions(&tx, &h.assumptions)?;
    for p in &h.people {
        insert_person(&tx, p)?;
    }
    for a in &h.accounts {
        insert_account(&tx, a)?;
    }
    for i in &h.income {
        insert_income(&tx, i)?;
    }
    for d in &h.debts {
        insert_debt(&tx, d)?;
    }
    for x in &h.one_time_expenses {
        insert_one_time_expense(&tx, x)?;
    }
    for sc in &h.scenarios {
        insert_scenario(&tx, sc)?;
    }
    tx.commit()?;
    Ok(())
}

/// Deletes every record and resets the household info to defaults.
pub fn clear_household(conn: &mut Connection) -> Result<()> {
    let tx = conn.transaction()?;
    delete_all(&tx)?;
    save_info(&tx, &HouseholdInfo::default())?;
    save_assumptions(&tx, &Assumptions::default())?;
    tx.commit()?;
    Ok(())
}

fn delete_all(conn: &Connection) -> Result<()> {
    for t in DATA_TABLES {
        conn.execute(&format!("DELETE FROM {t}"), [])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::demo;

    #[test]
    fn info_round_trip_and_validation() {
        let conn = open_in_memory().unwrap();
        let mut info = load_household(&conn).unwrap().info;
        assert_eq!(info, HouseholdInfo::default());

        info.name = "Foehner Family".into();
        info.base_annual_spending = 150_000.0;
        info.filing_status = FilingStatus::HeadOfHousehold;
        save_info(&conn, &info).unwrap();
        assert_eq!(load_household(&conn).unwrap().info, info);

        info.name = "  ".into();
        assert!(matches!(save_info(&conn, &info), Err(Error::Invalid(_))));
    }

    #[test]
    fn replace_then_load_is_lossless_for_every_demo() {
        for which in demo::Demo::ALL {
            let mut conn = open_in_memory().unwrap();
            let h = demo::household(*which);
            replace_household(&mut conn, &h).unwrap();
            assert_eq!(load_household(&conn).unwrap(), h, "demo {which:?} did not round-trip");
        }
    }

    #[test]
    fn replace_rolls_back_on_invalid_data() {
        let mut conn = open_in_memory().unwrap();
        let good = demo::household(demo::Demo::Retiree);
        replace_household(&mut conn, &good).unwrap();

        let mut bad = demo::household(demo::Demo::EarlyCareer);
        bad.accounts[0].balance = -5.0;
        assert!(replace_household(&mut conn, &bad).is_err());
        assert_eq!(load_household(&conn).unwrap(), good);
    }

    #[test]
    fn clear_removes_everything() {
        let mut conn = open_in_memory().unwrap();
        replace_household(&mut conn, &demo::household(demo::Demo::Retiree)).unwrap();
        clear_household(&mut conn).unwrap();
        assert_eq!(load_household(&conn).unwrap(), Household::default());
    }
}
