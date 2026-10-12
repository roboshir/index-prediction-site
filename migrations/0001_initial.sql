PRAGMA foreign_keys = ON;

CREATE TABLE contests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  entry_start TEXT NOT NULL,
  entry_end TEXT NOT NULL,
  contest_start TEXT NOT NULL,
  contest_end TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','open','running','finished')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE stocks (
  code TEXT PRIMARY KEY CHECK (length(code) = 4),
  company_name TEXT NOT NULL,
  market_code TEXT NOT NULL DEFAULT 'TSE'
);

CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  entry_public_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  nickname TEXT NOT NULL,
  index_name TEXT NOT NULL,
  email_delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (email_delivery_status IN ('pending','sent','failed')),
  last_email_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE entry_stocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  stock_code TEXT NOT NULL REFERENCES stocks(code),
  weight INTEGER NOT NULL CHECK (weight BETWEEN 5 AND 50),
  UNIQUE(entry_id, stock_code)
);

CREATE TABLE stock_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  stock_code TEXT NOT NULL REFERENCES stocks(code),
  close REAL NOT NULL CHECK (close > 0),
  UNIQUE(date, stock_code)
);

CREATE TABLE index_daily_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  index_value REAL NOT NULL,
  return_rate REAL NOT NULL,
  rank INTEGER,
  UNIQUE(entry_id, date)
);

CREATE INDEX idx_entries_contest_created ON entries(contest_id, created_at);
CREATE INDEX idx_entry_stocks_entry ON entry_stocks(entry_id);
CREATE INDEX idx_stock_prices_code_date ON stock_prices(stock_code, date);
CREATE INDEX idx_index_daily_date_rank ON index_daily_values(date, rank);
CREATE INDEX idx_index_daily_entry_date ON index_daily_values(entry_id, date);
PRAGMA optimize;
