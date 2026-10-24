-- Phases 9-10: an account's individual positions, as a JSON array of engine::model::Holding
-- (NULL = none). Filled by brokerage imports or by hand.
ALTER TABLE account ADD COLUMN holdings TEXT;
