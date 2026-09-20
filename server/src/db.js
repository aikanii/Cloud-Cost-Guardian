import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('aws','azure','gcp')),
  external_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, external_id)
);

CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL,
  name TEXT NOT NULL,
  service TEXT NOT NULL,
  region TEXT NOT NULL,
  type TEXT,
  tags TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'running',
  avg_cpu REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (account_id, resource_id)
);

CREATE TABLE IF NOT EXISTS cost_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  resource_id INTEGER REFERENCES resources(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  service TEXT NOT NULL,
  region TEXT NOT NULL,
  usage_type TEXT,
  usage_quantity REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL,
  tags TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_cost_date ON cost_entries(date);
CREATE INDEX IF NOT EXISTS idx_cost_account_date ON cost_entries(account_id, date);
CREATE INDEX IF NOT EXISTS idx_cost_service ON cost_entries(service);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  period TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('monthly','quarterly','yearly')),
  scope_type TEXT NOT NULL DEFAULT 'all' CHECK (scope_type IN ('all','account','service','tag')),
  scope_value TEXT,
  threshold_pct REAL NOT NULL DEFAULT 80 CHECK (threshold_pct > 0 AND threshold_pct <= 100),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('budget','anomaly','forecast')),
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  metadata TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recommendation_actions (
  fingerprint TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('dismissed','applied')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let db;

export function getDb() {
  if (db) return db;
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'guardian.db');
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  return db;
}

export function resetDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

export const q = {
  all: (sql, ...params) => getDb().prepare(sql).all(...params),
  get: (sql, ...params) => getDb().prepare(sql).get(...params),
  run: (sql, ...params) => getDb().prepare(sql).run(...params),
};

export function transaction(fn) {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const r = fn();
    d.exec('COMMIT');
    return r;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

export function getSetting(key, fallback) {
  const row = q.get('SELECT value FROM settings WHERE key = ?', key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(key, value) {
  q.run(
    'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
}
