-- Phase 10: cached prices and fitted risk per ticker (main file only). Public market data,
-- refreshed from Yahoo Finance's chart endpoint; never personal data.
CREATE TABLE ticker_data (
    ticker TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    -- EQUITY (a single company), ETF, MUTUALFUND, ...
    instrument TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL,
    price_date TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    -- engine::stocks::StockFit as JSON (NULL = too little history).
    fit TEXT
);
