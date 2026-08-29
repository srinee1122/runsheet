// db.js — SQLite storage using Node's built-in node:sqlite (no native module compile needed).
// One shared file-backed DB so multiple clerks on multiple machines see the same data
// when they point their browsers at the same running server.
'use strict';
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'runsheet.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;'); // safe concurrent readers/writers across clerks
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

module.exports = { db, getSetting, setSetting };
