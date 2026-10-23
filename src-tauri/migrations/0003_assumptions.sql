-- Phase 2: growth and inflation assumptions for the forecast (one row).
-- Defaults match engine::model::Assumptions::default().
CREATE TABLE assumptions (
    id                    INTEGER PRIMARY KEY CHECK (id = 1),
    stocks_return         REAL NOT NULL DEFAULT 0.07,
    bonds_return          REAL NOT NULL DEFAULT 0.04,
    cash_return           REAL NOT NULL DEFAULT 0.02,
    real_estate_growth    REAL NOT NULL DEFAULT 0.03,
    inflation             REAL NOT NULL DEFAULT 0.025,
    stock_dividend_yield  REAL NOT NULL DEFAULT 0.015
);

INSERT INTO assumptions (id) VALUES (1);
