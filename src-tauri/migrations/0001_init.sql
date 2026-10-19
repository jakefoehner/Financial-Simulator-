-- One household per install. Phase 1 adds people, accounts, income, debts, etc.
CREATE TABLE household (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    name             TEXT    NOT NULL DEFAULT 'My Household',
    state            TEXT    NOT NULL DEFAULT 'TX',
    flat_state_rate  REAL    NOT NULL DEFAULT 0.0,
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT INTO household (id) VALUES (1);
