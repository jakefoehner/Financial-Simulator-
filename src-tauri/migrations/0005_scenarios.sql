-- Phase 4: "what if" plans and estate settings.
-- A scenario's decisions are stored as a JSON array of engine::model::Event values.
CREATE TABLE scenario (
    id      INTEGER PRIMARY KEY,
    name    TEXT NOT NULL,
    notes   TEXT NOT NULL DEFAULT '',
    events  TEXT NOT NULL DEFAULT '[]'
);

-- Defaults match engine::model::Assumptions::default().
ALTER TABLE assumptions ADD COLUMN heir_income_tax_rate REAL NOT NULL DEFAULT 0.24;
ALTER TABLE assumptions ADD COLUMN exemption_cut_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assumptions ADD COLUMN exemption_cut_amount REAL NOT NULL DEFAULT 7000000;
ALTER TABLE assumptions ADD COLUMN exemption_cut_year INTEGER NOT NULL DEFAULT 2030;
ALTER TABLE assumptions ADD COLUMN estate_age INTEGER;
