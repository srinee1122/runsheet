// db.js — SQLite storage using Node's built-in node:sqlite (no native module compile needed).
// One shared file-backed DB so multiple clerks on multiple machines see the same data
// when they point their browsers at the same running server.
'use strict';
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// GoDaddy Node.js Hosting only guarantees files under public/assets/ survive a
// redeploy — everywhere else on disk (including the project root's own data/ folder,
// where this used to live) gets reset each time. This directory itself is NOT web-
// accessible despite living under public/ — server.js explicitly blocks any request
// for it before express.static ever gets a chance to serve it (see the comment there).
const DATA_DIR = path.join(__dirname, 'public', 'assets', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'runsheet.db');

const db = new DatabaseSync(DB_PATH);
// journal_mode is saved permanently inside the database file itself, not a per-connection
// default — it is NOT enough to simply stop asserting WAL for a database that was already
// switched to it by earlier code. An existing WAL-mode database stays in WAL mode forever
// on every future connection unless something explicitly switches it away. This line does
// that: PRAGMA journal_mode = DELETE actively triggers a checkpoint first (merging any
// writes still sitting in the separate -wal file into the main .db file), then removes the
// -wal/-shm files entirely. On a fresh database that was never in WAL mode, this is a no-op.
//
// WAL splits committed writes across that separate runsheet.db-wal file until a checkpoint
// merges them back — with no checkpoint logic anywhere else in this app, recent writes
// could sit in that separate file indefinitely. On a hosting platform whose exact file-
// persistence guarantees across a restart aren't fully verified, that's a real, concrete
// risk: the main .db file could look intact while the actual latest data only ever lived
// in a file that didn't survive. Keeping every committed write in the single .db file is
// worth far more here than WAL's concurrency benefit, which matters far less for a handful
// of clerks than for a high-throughput system.
db.exec('PRAGMA journal_mode = DELETE;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  qty_per_ctn REAL NOT NULL DEFAULT 1,
  is_round_item INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  area TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runsheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_no TEXT NOT NULL,
  area TEXT DEFAULT '',
  delivery_man TEXT DEFAULT '',
  vehicle_no TEXT DEFAULT '',
  run_date TEXT DEFAULT '',
  delivery_date TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  data TEXT NOT NULL -- JSON blob: { stops: [...], frequentColumns: [...] } snapshot at save time
);

-- A snapshot of a runsheet's full state, taken right after an EXPLICIT save (the Save
-- button, or Print, which saves first) applies — so each entry is exactly what was just
-- saved, not the state it replaced. Never on auto-save, which fires every ~2.5s while
-- typing and would otherwise flood this with hundreds of near-identical entries per
-- editing session. This is purely additive: the runsheets row above always holds the
-- current state; this table holds every past explicit save alongside it. No cap on how
-- many accumulate — storage is cheap and this is low-traffic enough that pruning isn't a
-- real concern yet.
CREATE TABLE IF NOT EXISTS runsheet_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  runsheet_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  sheet_no TEXT DEFAULT '',
  area TEXT DEFAULT '',
  delivery_man TEXT DEFAULT '',
  vehicle_no TEXT DEFAULT '',
  run_date TEXT DEFAULT '',
  delivery_date TEXT DEFAULT '',
  data TEXT NOT NULL,
  saved_by TEXT DEFAULT '',
  saved_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (runsheet_id) REFERENCES runsheets(id)
);

-- Identity comes from Firebase (uid/email/display_name are just a local cache of what
-- Firebase told us at last login); permissions are entirely local to this app, since
-- Firebase only handles "who is this person", not "what can they do here". The very
-- first person ever to log in is auto-promoted to admin with every module — see the
-- bootstrap logic in server.js — so there's always a way in; everyone after that starts
-- with no access until an admin grants it.
CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  email TEXT DEFAULT '',
  display_name TEXT DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0,
  module_builder INTEGER NOT NULL DEFAULT 0,
  module_history INTEGER NOT NULL DEFAULT 0,
  module_products INTEGER NOT NULL DEFAULT 0,
  module_customers INTEGER NOT NULL DEFAULT 0,
  module_settings INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT DEFAULT ''
);
`);

// ---- migrations: add Item Master / Customer Master reference columns to existing installs ----
// Uses ALTER TABLE ADD COLUMN (never destructive) so anyone who already has products/customers
// entered keeps that data — this just adds the extra reference fields alongside it.
function ensureColumns(table, columns) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name));
  for (const [name, def] of Object.entries(columns)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
}
ensureColumns('products', {
  code: "TEXT DEFAULT ''",
  supplier: "TEXT DEFAULT ''",
  brand: "TEXT DEFAULT ''",
  category: "TEXT DEFAULT ''",
  sub_category: "TEXT DEFAULT ''",
  sub_category_2: "TEXT DEFAULT ''",
  base_unit: "TEXT DEFAULT ''",
  group_name: "TEXT DEFAULT ''",
  item_type: "TEXT DEFAULT ''",
  selling_rate: 'REAL DEFAULT 0',
  // 'carton' or 'bag' — purely a billing classification (3rd-party delivery vendors charge
  // differently for each); never affects the carton-count math elsewhere in the app.
  packing_type: "TEXT DEFAULT 'carton'",
  // 'CTN' or 'PCS' — how this product's round-item quantity is normally counted/entered
  // (some products are naturally counted in pieces, others in whole cartons). Only affects
  // what unit the entry field defaults to and displays as; always stored as cartons (qty_ctn).
  entry_unit: "TEXT DEFAULT 'CTN'",
});
ensureColumns('customers', {
  code: "TEXT DEFAULT ''",
  segment: "TEXT DEFAULT ''",
  contact: "TEXT DEFAULT ''",
  chain_store: "TEXT DEFAULT ''",
  address: "TEXT DEFAULT ''",
  postal_code: "TEXT DEFAULT ''",
  mobile: "TEXT DEFAULT ''",
  whatsapp: "TEXT DEFAULT ''",
  roc_no: "TEXT DEFAULT ''",
  modified_source: "TEXT DEFAULT ''", // the source system's own "Modified" timestamp, informational only
});

ensureColumns('runsheets', {
  // optimistic-concurrency guard: incremented on every save; a PUT that doesn't match
  // the version it was loaded with means someone else saved in between.
  version: 'INTEGER NOT NULL DEFAULT 1',
});

// ---- seed default frequent-column settings (empty by default; configured in Settings panel) ----
const settingsCount = db.prepare('SELECT COUNT(*) AS n FROM settings').get().n;
if (settingsCount === 0) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('frequent_columns', JSON.stringify([]));
}

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}

function setSetting(key, value) {
  const json = JSON.stringify(value);
  const existing = db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
  if (existing) {
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(json, key);
  } else {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, json);
  }
}

// The five sidebar pages that can be individually granted — kept in one place so the
// server's user-permission validation and the seed/bootstrap logic below can't drift
// from what the frontend actually gates.
const MODULES = ['builder', 'history', 'products', 'customers', 'settings'];

module.exports = { db, getSetting, setSetting, MODULES };
