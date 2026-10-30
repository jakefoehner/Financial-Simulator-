-- Phase 11: gifts you already give (part of every plan), as a JSON array of engine::model::Event.
ALTER TABLE household ADD COLUMN ongoing TEXT NOT NULL DEFAULT '[]';
