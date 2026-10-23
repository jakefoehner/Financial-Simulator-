-- Phase 1: everything the user enters about their household.
-- Enum columns store the strings defined in engine/src/model.rs.
-- Money is dollars (today's), rates/percentages are decimals.

ALTER TABLE household ADD COLUMN filing_status TEXT NOT NULL DEFAULT 'single';
ALTER TABLE household ADD COLUMN base_annual_spending REAL NOT NULL DEFAULT 0;

CREATE TABLE person (
    id                   INTEGER PRIMARY KEY,
    name                 TEXT    NOT NULL,
    birth_year           INTEGER NOT NULL,
    role                 TEXT    NOT NULL DEFAULT 'primary',
    life_expectancy      INTEGER NOT NULL DEFAULT 100,
    ss_monthly_benefit   REAL,
    ss_claim_age         INTEGER NOT NULL DEFAULT 67,
    ss_already_claiming  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE account (
    id                   INTEGER PRIMARY KEY,
    name                 TEXT    NOT NULL,
    account_type         TEXT    NOT NULL,
    owner_id             INTEGER REFERENCES person(id) ON DELETE SET NULL,
    balance              REAL    NOT NULL DEFAULT 0,
    cost_basis           REAL,
    stocks_pct           REAL    NOT NULL DEFAULT 0,
    bonds_pct            REAL    NOT NULL DEFAULT 0,
    cash_pct             REAL    NOT NULL DEFAULT 1,
    annual_contribution  REAL    NOT NULL DEFAULT 0,
    employer_match       REAL    NOT NULL DEFAULT 0,
    notes                TEXT    NOT NULL DEFAULT ''
);

-- person_id NULL = household-level income (e.g. a jointly owned rental).
CREATE TABLE income_stream (
    id             INTEGER PRIMARY KEY,
    person_id      INTEGER REFERENCES person(id) ON DELETE CASCADE,
    kind           TEXT    NOT NULL,
    name           TEXT    NOT NULL,
    annual_amount  REAL    NOT NULL DEFAULT 0,
    growth_rate    REAL    NOT NULL DEFAULT 0,
    start_age      INTEGER,
    end_age        INTEGER
);

CREATE TABLE debt (
    id               INTEGER PRIMARY KEY,
    name             TEXT    NOT NULL,
    kind             TEXT    NOT NULL,
    balance          REAL    NOT NULL DEFAULT 0,
    interest_rate    REAL    NOT NULL DEFAULT 0,
    monthly_payment  REAL    NOT NULL DEFAULT 0,
    account_id       INTEGER REFERENCES account(id) ON DELETE SET NULL,
    notes            TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE one_time_expense (
    id      INTEGER PRIMARY KEY,
    name    TEXT    NOT NULL,
    year    INTEGER NOT NULL,
    amount  REAL    NOT NULL DEFAULT 0
);

CREATE INDEX idx_account_owner ON account(owner_id);
CREATE INDEX idx_income_person ON income_stream(person_id);
CREATE INDEX idx_debt_account ON debt(account_id);
