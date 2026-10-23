//! Create/update/delete for each kind of household record.
//!
//! Pattern per record type:
//! - `list_*` returns all rows ordered by id.
//! - `insert_*` writes a row; a `None` id lets SQLite assign one, a `Some` id
//!   is kept as-is (used when replacing a whole household).
//! - `upsert_*` validates, then inserts (no id) or updates (has id).
//! - `delete_*` removes by id. Foreign keys handle dependents (see migration 0002).

use engine::model::{Account, AccountType, Debt, DebtKind, Id, IncomeKind, IncomeStream, OneTimeExpense, Person, Role};
use rusqlite::{Connection, Row, params};

use super::{Error, Result, enum_col};

/// Runs an UPDATE and turns "0 rows changed" into `NotFound`.
fn update_one(conn: &Connection, what: &'static str, sql: &str, params: impl rusqlite::Params) -> Result<()> {
    match conn.execute(sql, params)? {
        0 => Err(Error::NotFound(what)),
        _ => Ok(()),
    }
}

fn delete_one(conn: &Connection, what: &'static str, table: &str, id: Id) -> Result<()> {
    match conn.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [id])? {
        0 => Err(Error::NotFound(what)),
        _ => Ok(()),
    }
}

fn list<T>(conn: &Connection, sql: &str, map: fn(&Row) -> rusqlite::Result<T>) -> Result<Vec<T>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], map)?.collect::<rusqlite::Result<Vec<T>>>()?;
    Ok(rows)
}

// --- Person ----------------------------------------------------------------

const PERSON_COLS: &str =
    "id, name, birth_year, role, life_expectancy, ss_monthly_benefit, ss_claim_age, ss_already_claiming";

fn person_from_row(r: &Row) -> rusqlite::Result<Person> {
    Ok(Person {
        id: r.get(0)?,
        name: r.get(1)?,
        birth_year: r.get(2)?,
        role: enum_col(r, 3, Role::parse)?,
        life_expectancy: r.get(4)?,
        ss_monthly_benefit: r.get(5)?,
        ss_claim_age: r.get(6)?,
        ss_already_claiming: r.get(7)?,
    })
}

pub(super) fn list_people(conn: &Connection) -> Result<Vec<Person>> {
    list(conn, &format!("SELECT {PERSON_COLS} FROM person ORDER BY id"), person_from_row)
}

pub(super) fn insert_person(conn: &Connection, p: &Person) -> Result<Id> {
    conn.execute(
        &format!("INSERT INTO person ({PERSON_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"),
        params![
            p.id,
            p.name.trim(),
            p.birth_year,
            p.role.as_str(),
            p.life_expectancy,
            p.ss_monthly_benefit,
            p.ss_claim_age,
            p.ss_already_claiming
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn upsert_person(conn: &Connection, p: &Person) -> Result<Id> {
    p.validate().map_err(Error::Invalid)?;
    let Some(id) = p.id else { return insert_person(conn, p) };
    update_one(
        conn,
        "person",
        "UPDATE person SET name = ?2, birth_year = ?3, role = ?4, life_expectancy = ?5,
             ss_monthly_benefit = ?6, ss_claim_age = ?7, ss_already_claiming = ?8
         WHERE id = ?1",
        params![
            id,
            p.name.trim(),
            p.birth_year,
            p.role.as_str(),
            p.life_expectancy,
            p.ss_monthly_benefit,
            p.ss_claim_age,
            p.ss_already_claiming
        ],
    )?;
    Ok(id)
}

/// Their accounts become joint; their personal income streams are removed.
pub fn delete_person(conn: &Connection, id: Id) -> Result<()> {
    delete_one(conn, "person", "person", id)
}

// --- Account ---------------------------------------------------------------

const ACCOUNT_COLS: &str = "id, name, account_type, owner_id, balance, cost_basis, stocks_pct, bonds_pct, cash_pct,
     annual_contribution, employer_match, notes";

fn account_from_row(r: &Row) -> rusqlite::Result<Account> {
    Ok(Account {
        id: r.get(0)?,
        name: r.get(1)?,
        account_type: enum_col(r, 2, AccountType::parse)?,
        owner_id: r.get(3)?,
        balance: r.get(4)?,
        cost_basis: r.get(5)?,
        stocks_pct: r.get(6)?,
        bonds_pct: r.get(7)?,
        cash_pct: r.get(8)?,
        annual_contribution: r.get(9)?,
        employer_match: r.get(10)?,
        notes: r.get(11)?,
    })
}

pub(super) fn list_accounts(conn: &Connection) -> Result<Vec<Account>> {
    list(conn, &format!("SELECT {ACCOUNT_COLS} FROM account ORDER BY id"), account_from_row)
}

pub(super) fn insert_account(conn: &Connection, a: &Account) -> Result<Id> {
    conn.execute(
        &format!("INSERT INTO account ({ACCOUNT_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)"),
        params![
            a.id,
            a.name.trim(),
            a.account_type.as_str(),
            a.owner_id,
            a.balance,
            a.cost_basis,
            a.stocks_pct,
            a.bonds_pct,
            a.cash_pct,
            a.annual_contribution,
            a.employer_match,
            a.notes
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn upsert_account(conn: &Connection, a: &Account) -> Result<Id> {
    a.validate().map_err(Error::Invalid)?;
    let Some(id) = a.id else { return insert_account(conn, a) };
    update_one(
        conn,
        "account",
        "UPDATE account SET name = ?2, account_type = ?3, owner_id = ?4, balance = ?5, cost_basis = ?6,
             stocks_pct = ?7, bonds_pct = ?8, cash_pct = ?9, annual_contribution = ?10, employer_match = ?11,
             notes = ?12
         WHERE id = ?1",
        params![
            id,
            a.name.trim(),
            a.account_type.as_str(),
            a.owner_id,
            a.balance,
            a.cost_basis,
            a.stocks_pct,
            a.bonds_pct,
            a.cash_pct,
            a.annual_contribution,
            a.employer_match,
            a.notes
        ],
    )?;
    Ok(id)
}

/// Debts secured by this account stay, but are unlinked.
pub fn delete_account(conn: &Connection, id: Id) -> Result<()> {
    delete_one(conn, "account", "account", id)
}

// --- Income ----------------------------------------------------------------

const INCOME_COLS: &str = "id, person_id, kind, name, annual_amount, growth_rate, start_age, end_age";

fn income_from_row(r: &Row) -> rusqlite::Result<IncomeStream> {
    Ok(IncomeStream {
        id: r.get(0)?,
        person_id: r.get(1)?,
        kind: enum_col(r, 2, IncomeKind::parse)?,
        name: r.get(3)?,
        annual_amount: r.get(4)?,
        growth_rate: r.get(5)?,
        start_age: r.get(6)?,
        end_age: r.get(7)?,
    })
}

pub(super) fn list_income(conn: &Connection) -> Result<Vec<IncomeStream>> {
    list(conn, &format!("SELECT {INCOME_COLS} FROM income_stream ORDER BY id"), income_from_row)
}

pub(super) fn insert_income(conn: &Connection, i: &IncomeStream) -> Result<Id> {
    conn.execute(
        &format!("INSERT INTO income_stream ({INCOME_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"),
        params![
            i.id,
            i.person_id,
            i.kind.as_str(),
            i.name.trim(),
            i.annual_amount,
            i.growth_rate,
            i.start_age,
            i.end_age
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn upsert_income(conn: &Connection, i: &IncomeStream) -> Result<Id> {
    i.validate().map_err(Error::Invalid)?;
    let Some(id) = i.id else { return insert_income(conn, i) };
    update_one(
        conn,
        "income",
        "UPDATE income_stream SET person_id = ?2, kind = ?3, name = ?4, annual_amount = ?5, growth_rate = ?6,
             start_age = ?7, end_age = ?8
         WHERE id = ?1",
        params![
            id,
            i.person_id,
            i.kind.as_str(),
            i.name.trim(),
            i.annual_amount,
            i.growth_rate,
            i.start_age,
            i.end_age
        ],
    )?;
    Ok(id)
}

pub fn delete_income(conn: &Connection, id: Id) -> Result<()> {
    delete_one(conn, "income", "income_stream", id)
}

// --- Debt ------------------------------------------------------------------

const DEBT_COLS: &str = "id, name, kind, balance, interest_rate, monthly_payment, account_id, notes";

fn debt_from_row(r: &Row) -> rusqlite::Result<Debt> {
    Ok(Debt {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: enum_col(r, 2, DebtKind::parse)?,
        balance: r.get(3)?,
        interest_rate: r.get(4)?,
        monthly_payment: r.get(5)?,
        account_id: r.get(6)?,
        notes: r.get(7)?,
    })
}

pub(super) fn list_debts(conn: &Connection) -> Result<Vec<Debt>> {
    list(conn, &format!("SELECT {DEBT_COLS} FROM debt ORDER BY id"), debt_from_row)
}

pub(super) fn insert_debt(conn: &Connection, d: &Debt) -> Result<Id> {
    conn.execute(
        &format!("INSERT INTO debt ({DEBT_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"),
        params![
            d.id,
            d.name.trim(),
            d.kind.as_str(),
            d.balance,
            d.interest_rate,
            d.monthly_payment,
            d.account_id,
            d.notes
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn upsert_debt(conn: &Connection, d: &Debt) -> Result<Id> {
    d.validate().map_err(Error::Invalid)?;
    let Some(id) = d.id else { return insert_debt(conn, d) };
    update_one(
        conn,
        "debt",
        "UPDATE debt SET name = ?2, kind = ?3, balance = ?4, interest_rate = ?5, monthly_payment = ?6,
             account_id = ?7, notes = ?8
         WHERE id = ?1",
        params![
            id,
            d.name.trim(),
            d.kind.as_str(),
            d.balance,
            d.interest_rate,
            d.monthly_payment,
            d.account_id,
            d.notes
        ],
    )?;
    Ok(id)
}

pub fn delete_debt(conn: &Connection, id: Id) -> Result<()> {
    delete_one(conn, "debt", "debt", id)
}

// --- One-time expense -------------------------------------------------------

const EXPENSE_COLS: &str = "id, name, year, amount";

fn expense_from_row(r: &Row) -> rusqlite::Result<OneTimeExpense> {
    Ok(OneTimeExpense { id: r.get(0)?, name: r.get(1)?, year: r.get(2)?, amount: r.get(3)? })
}

pub(super) fn list_one_time_expenses(conn: &Connection) -> Result<Vec<OneTimeExpense>> {
    list(conn, &format!("SELECT {EXPENSE_COLS} FROM one_time_expense ORDER BY year, id"), expense_from_row)
}

pub(super) fn insert_one_time_expense(conn: &Connection, x: &OneTimeExpense) -> Result<Id> {
    conn.execute(
        &format!("INSERT INTO one_time_expense ({EXPENSE_COLS}) VALUES (?1, ?2, ?3, ?4)"),
        params![x.id, x.name.trim(), x.year, x.amount],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn upsert_one_time_expense(conn: &Connection, x: &OneTimeExpense) -> Result<Id> {
    x.validate().map_err(Error::Invalid)?;
    let Some(id) = x.id else { return insert_one_time_expense(conn, x) };
    update_one(
        conn,
        "expense",
        "UPDATE one_time_expense SET name = ?2, year = ?3, amount = ?4 WHERE id = ?1",
        params![id, x.name.trim(), x.year, x.amount],
    )?;
    Ok(id)
}

pub fn delete_one_time_expense(conn: &Connection, id: Id) -> Result<()> {
    delete_one(conn, "expense", "one_time_expense", id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{load_household, open_in_memory};
    use engine::model::FilingStatus;

    fn person(name: &str) -> Person {
        Person {
            id: None,
            name: name.into(),
            birth_year: 1960,
            role: Role::Primary,
            life_expectancy: 100,
            ss_monthly_benefit: Some(3_200.0),
            ss_claim_age: 67,
            ss_already_claiming: false,
        }
    }

    fn account(owner: Option<Id>) -> Account {
        Account {
            id: None,
            name: "Brokerage".into(),
            account_type: AccountType::Taxable,
            owner_id: owner,
            balance: 500_000.0,
            cost_basis: Some(250_000.0),
            stocks_pct: 0.7,
            bonds_pct: 0.3,
            cash_pct: 0.0,
            annual_contribution: 0.0,
            employer_match: 0.0,
            notes: String::new(),
        }
    }

    #[test]
    fn insert_update_delete_person() {
        let conn = open_in_memory().unwrap();
        let id = upsert_person(&conn, &person("  Pat  ")).unwrap();
        let mut p = list_people(&conn).unwrap().remove(0);
        assert_eq!((p.id, p.name.as_str()), (Some(id), "Pat"));

        p.ss_claim_age = 70;
        assert_eq!(upsert_person(&conn, &p).unwrap(), id);
        assert_eq!(list_people(&conn).unwrap()[0].ss_claim_age, 70);

        delete_person(&conn, id).unwrap();
        assert!(list_people(&conn).unwrap().is_empty());
        assert!(matches!(delete_person(&conn, id), Err(Error::NotFound(_))));
    }

    #[test]
    fn updating_a_missing_record_is_not_found() {
        let conn = open_in_memory().unwrap();
        let mut p = person("Ghost");
        p.id = Some(999);
        assert!(matches!(upsert_person(&conn, &p), Err(Error::NotFound(_))));
    }

    #[test]
    fn invalid_records_are_rejected_before_writing() {
        let conn = open_in_memory().unwrap();
        let mut a = account(None);
        a.stocks_pct = 0.9; // 120% total
        assert!(matches!(upsert_account(&conn, &a), Err(Error::Invalid(_))));
        assert!(list_accounts(&conn).unwrap().is_empty());
    }

    #[test]
    fn deleting_a_person_unlinks_accounts_and_removes_their_income() {
        let conn = open_in_memory().unwrap();
        let pid = upsert_person(&conn, &person("Pat")).unwrap();
        let aid = upsert_account(&conn, &account(Some(pid))).unwrap();
        upsert_income(
            &conn,
            &IncomeStream {
                id: None,
                person_id: Some(pid),
                kind: IncomeKind::Pension,
                name: "Pension".into(),
                annual_amount: 24_000.0,
                growth_rate: 0.0,
                start_age: None,
                end_age: None,
            },
        )
        .unwrap();
        upsert_debt(
            &conn,
            &Debt {
                id: None,
                name: "Margin loan".into(),
                kind: DebtKind::Other,
                balance: 10_000.0,
                interest_rate: 0.08,
                monthly_payment: 500.0,
                account_id: Some(aid),
                notes: String::new(),
            },
        )
        .unwrap();

        delete_person(&conn, pid).unwrap();
        let h = load_household(&conn).unwrap();
        assert_eq!(h.accounts[0].owner_id, None);
        assert!(h.income.is_empty());

        delete_account(&conn, aid).unwrap();
        assert_eq!(load_household(&conn).unwrap().debts[0].account_id, None);
    }

    #[test]
    fn unknown_owner_is_a_friendly_error() {
        let conn = open_in_memory().unwrap();
        let err = upsert_account(&conn, &account(Some(42))).unwrap_err();
        assert!(err.to_string().contains("no longer exists"), "{err}");
    }

    #[test]
    fn expenses_list_in_year_order() {
        let conn = open_in_memory().unwrap();
        for (name, year) in [("Car", 2030), ("Roof", 2027)] {
            upsert_one_time_expense(&conn, &OneTimeExpense { id: None, name: name.into(), year, amount: 1.0 }).unwrap();
        }
        let names: Vec<_> = list_one_time_expenses(&conn).unwrap().into_iter().map(|x| x.name).collect();
        assert_eq!(names, ["Roof", "Car"]);
        // Sanity: household info is untouched by record edits.
        assert_eq!(load_household(&conn).unwrap().info.filing_status, FilingStatus::Single);
    }
}
