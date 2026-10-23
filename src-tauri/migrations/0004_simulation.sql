-- Phase 3: range-of-outcomes settings. Defaults match engine::model::Assumptions::default().
ALTER TABLE assumptions ADD COLUMN simulations INTEGER NOT NULL DEFAULT 5000;
ALTER TABLE assumptions ADD COLUMN steady_inflation INTEGER NOT NULL DEFAULT 0;
