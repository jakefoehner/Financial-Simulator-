-- Phase 7: households for the children, each in its own file (children/<id>.sqlite).
-- Only used in the main file. No foreign keys: restoring a backup re-creates people,
-- so links are checked when read (a link to a person who isn't a child is ignored).
CREATE TABLE family_household (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    -- Path relative to the app's data folder.
    file TEXT NOT NULL,
    -- The child's person id in the main household; NULL = not linked.
    parent_person_id INTEGER,
    -- Which of the main household's plans feeds this one; NULL = the base plan.
    parent_plan INTEGER
);
