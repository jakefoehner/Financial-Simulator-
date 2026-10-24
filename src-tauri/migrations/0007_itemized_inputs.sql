-- Phase 5.2: inputs for itemized deductions.
-- Yearly home property tax in today's dollars (already part of spending; used for the SALT deduction).
ALTER TABLE household ADD COLUMN home_property_tax REAL NOT NULL DEFAULT 0;
-- 1 = the mortgage on your own home (its interest can be itemized).
ALTER TABLE debt ADD COLUMN home_mortgage INTEGER NOT NULL DEFAULT 0;
