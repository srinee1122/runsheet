// lib/modules.js — the single frontend list of permission-gated pages/modules.
//
// When adding a NEW page to the app that should be permission-gated, this is one of
// exactly four places that need a matching entry (all four are deliberately small and
// obvious — there's no way to silently forget one without something breaking loudly):
//
//   1. db.js        — add the key to the MODULES array (adds the DB column + makes the
//                      server-side permission model aware of it)
//   2. auth.js       — nothing to add; it reads db.js's MODULES generically
//   3. server.js     — gate the new page's routes with requireModule('key') /
//                      requireAnyModule(...) as appropriate
//   4. THIS FILE     — add { key, label } so the sidebar link and the Users &
//                      Permissions column both pick it up automatically
//
// app.js's routes array still needs its own entry too (path + which Vue component to
// render) — that part can't be folded into a shared list since every page's component
// is genuinely different — but the sidebar link itself, and every column in Users &
// Permissions, are generated FROM this list, so there's nothing else to duplicate once
// the route exists.
//
// The `key` here must exactly match: the module name in db.js's MODULES array, the
// string passed to requireModule()/requireAnyModule() in server.js, and the route's
// path in app.js (sidebar links are generated as `/` + key).
export const MODULES = [
  { key: 'builder', label: 'Runsheet Builder' },
  { key: 'history', label: 'History' },
  { key: 'products', label: 'Products' },
  { key: 'customers', label: 'Customers' },
  { key: 'settings', label: 'Settings' },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);
