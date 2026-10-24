-- Phase 5.1: private investments and wealth-transfer settings.
-- Private fund / startup terms are a JSON engine::model::PrivateTerms (NULL for other accounts).
ALTER TABLE account ADD COLUMN private_terms TEXT;

-- Defaults match engine::model::Assumptions::default().
ALTER TABLE assumptions ADD COLUMN heir_capital_gains_rate REAL NOT NULL DEFAULT 0.15;
ALTER TABLE assumptions ADD COLUMN tax_rise_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assumptions ADD COLUMN tax_rise_year INTEGER NOT NULL DEFAULT 2030;
ALTER TABLE assumptions ADD COLUMN income_tax_increase REAL NOT NULL DEFAULT 0.05;
ALTER TABLE assumptions ADD COLUMN capital_gains_increase REAL NOT NULL DEFAULT 0.05;
