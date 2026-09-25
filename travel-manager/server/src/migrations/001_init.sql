-- Esquema inicial do Viaja+ (SQLite)
CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '',
  budget REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planejando',
  notes TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'BRL',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at INTEGER NOT NULL DEFAULT unixepoch()
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'outros',
  amount REAL NOT NULL DEFAULT 0,
  date TEXT NOT NULL DEFAULT '',
  quote_id INTEGER,
  document_ids TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL DEFAULT unixepoch()
);
CREATE INDEX IF NOT EXISTS idx_expenses_trip ON expenses(trip_id);

CREATE TABLE IF NOT EXISTS transport_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'aviao',
  origin TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  date TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  purchased INTEGER NOT NULL DEFAULT 0,
  expense_id INTEGER,
  bus_type TEXT,
  departure_time TEXT,
  arrival_time TEXT,
  duration_min INTEGER,
  source TEXT,
  url TEXT,
  updated_at INTEGER NOT NULL DEFAULT unixepoch()
);
CREATE INDEX IF NOT EXISTS idx_quotes_trip ON transport_quotes(trip_id);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'documento',
  type TEXT NOT NULL DEFAULT 'outro',
  mime_type TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '',
  expense_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at INTEGER NOT NULL DEFAULT unixepoch()
);
CREATE INDEX IF NOT EXISTS idx_docs_trip ON documents(trip_id);

-- Trilha de auditoria: alimenta a sincronização offline do frontend
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('upsert', 'delete')),
  payload TEXT,
  at INTEGER NOT NULL DEFAULT unixepoch()
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
