// auth.js — Firebase Authentication on the server side. Firebase only tells us "who is
// this person" (a verified uid/email from their ID token); everything about "what can
// they do here" is decided entirely by the local `users` table in our own database.
'use strict';
const { db, MODULES } = require('./db.js');

// ---- Firebase Admin initialization ----
// The service account key is a secret and must never be committed to the repo or
// pasted into chat. Provide it one of two ways:
//   1. Set GOOGLE_APPLICATION_CREDENTIALS to the path of the downloaded JSON key file
//      (Firebase Console → Project settings → Service accounts → Generate new private key).
//   2. Or set FIREBASE_SERVICE_ACCOUNT_JSON to the full JSON contents directly, for
//      platforms where writing a file isn't convenient (e.g. some hosting dashboards
//      that only offer environment-variable text boxes).
let auth; // the Auth service instance, once initialized
let firebaseReady = false;
try {
  const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const credential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
    : applicationDefault();
  const app = initializeApp({ credential });
  auth = getAuth(app);
  firebaseReady = true;
} catch (e) {
  // Deliberately non-fatal at startup: the rest of the app (and this module's own
  // requireAuth export) still loads, but every request will get a clear 500 explaining
  // what's missing, rather than the whole server refusing to boot over an auth config
  // issue during initial setup.
  console.error('Firebase Admin did not initialize:', e.message);
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON before logins will work.');
}

// ---- local user lookup / bootstrap ----
const BLANK_PERMS = Object.fromEntries(MODULES.map(m => [`module_${m}`, 0]));

function getUser(uid) {
  return db.prepare('SELECT * FROM users WHERE uid = ?').get(uid);
}

// Called once per verified request. Creates the local row on a person's very first
// login; the first row ever created becomes admin with every module (otherwise nobody
// could ever grant the first person access) — everyone after that starts at zero access.
function upsertUser(uid, email, displayName) {
  const existing = getUser(uid);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare('UPDATE users SET email=?, display_name=?, last_login_at=? WHERE uid=?')
      .run(email || existing.email, displayName || existing.display_name, now, uid);
    return getUser(uid);
  }
  const isFirstUser = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
  const cols = ['uid', 'email', 'display_name', 'is_admin', 'last_login_at', ...MODULES.map(m => `module_${m}`)];
  const vals = [uid, email || '', displayName || '', isFirstUser ? 1 : 0, now, ...MODULES.map(() => (isFirstUser ? 1 : 0))];
  db.prepare(`INSERT INTO users (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
  return getUser(uid);
}

function userPermissions(userRow) {
  if (!userRow) return { isAdmin: false, modules: { ...BLANK_PERMS } };
  const modules = {};
  for (const m of MODULES) modules[m] = !!userRow[`module_${m}`];
  return { isAdmin: !!userRow.is_admin, modules };
}

// ---- middleware ----
// Verifies the Firebase ID token in "Authorization: Bearer <token>", looks up (or
// creates) the matching local user row, and attaches both to req. Every /api route
// except the couple of exemptions in server.js goes through this first.
async function requireAuth(req, res, next) {
  if (!firebaseReady) {
    return res.status(500).json({ error: 'Server auth is not configured — set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON.' });
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in.' });
  try {
    const decoded = await auth.verifyIdToken(token);
    const userRow = upsertUser(decoded.uid, decoded.email, decoded.name);
    req.firebaseUser = decoded;
    req.user = userRow;
    req.permissions = userPermissions(userRow);
    next();
  } catch (e) {
    // Firebase Admin's ADC resolution is lazy — a missing/misconfigured service account
    // only actually fails here, not at startup, so this is also where a setup mistake
    // shows up. Log the real cause server-side (visible in the terminal) since the
    // browser only ever gets a generic message either way.
    console.error('Token verification failed:', e.message);
    res.status(401).json({ error: 'Your session has expired or is invalid — please sign in again.' });
  }
}

// Route guard factory: requireModule('products') rejects with 403 unless the signed-in
// user has that module (or is an admin, who implicitly has everything).
function requireModule(moduleName) {
  return (req, res, next) => {
    if (!req.permissions) return res.status(401).json({ error: 'Not signed in.' });
    if (req.permissions.isAdmin || req.permissions.modules[moduleName]) return next();
    res.status(403).json({ error: `You don't have access to ${moduleName}.` });
  };
}

// Same idea, but passes if the user has ANY of the listed modules — used for read-only
// endpoints that more than one module legitimately needs (e.g. Builder has to be able
// to read the product list even without the Products module itself).
function requireAnyModule(...moduleNames) {
  return (req, res, next) => {
    if (!req.permissions) return res.status(401).json({ error: 'Not signed in.' });
    if (req.permissions.isAdmin || moduleNames.some(m => req.permissions.modules[m])) return next();
    res.status(403).json({ error: `You don't have access to this.` });
  };
}

function requireAdmin(req, res, next) {
  if (!req.permissions) return res.status(401).json({ error: 'Not signed in.' });
  if (req.permissions.isAdmin) return next();
  res.status(403).json({ error: 'Admin access required.' });
}

module.exports = { requireAuth, requireModule, requireAnyModule, requireAdmin, getUser, userPermissions, MODULES };
