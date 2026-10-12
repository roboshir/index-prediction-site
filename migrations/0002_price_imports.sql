CREATE TABLE price_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  price_date TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  imported_rows INTEGER NOT NULL,
  skipped_rows INTEGER NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_price_imports_date
ON price_imports(price_date, imported_at);

PRAGMA optimize;
