CREATE TABLE contest_stocks (
  contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  stock_code TEXT NOT NULL REFERENCES stocks(code),
  source_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (contest_id, stock_code)
);

CREATE INDEX idx_contest_stocks_stock
ON contest_stocks(stock_code);
