// auth.js — Firebase Authentication on the server side. Firebase only tells us "who is
// this person" (a verified uid/email from their ID token); everything about "what can
// they do here" is decided entirely by the local `users` table in our own database.
'use strict';
const { db, MODULES } = require('./db.js');

// ---- Firebase Admin initialization ----
// The service account key is a secret and must never be committed to the repo or
// pasted into chat. Provide it any of three ways:
//   1. Set GOOGLE_APPLICATION_CREDENTIALS to the path of the downloaded JSON key file
//      (Firebase Console → Project settings → Service accounts → Generate new private key).
//   2. Or set FIREBASE_SERVICE_ACCOUNT_JSON to the full JSON contents directly, for
//      platforms where writing a file isn't convenient (e.g. some hosting dashboards
//      that only offer environment-variable text boxes).
//   3. Or set FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 to that same JSON, base64-encoded, as
//      a more robust alternative to #2 — some platforms' secret-storage text boxes don't
//      reliably preserve raw JSON's curly braces, quotes, or the embedded newlines inside
//      the private_key field; base64 reduces the whole thing to plain alphanumeric
//      characters with no such risk. To produce one:
//      node -e "console.log(require('fs').readFileSync('servicekey.json').toString('base64'))"
let auth; // the Auth service instance, once initialized
let firebaseReady = false;

// Diagnostic only — never logs the secret itself, just whether it arrived and whether it
// parses. Prints once at startup so it's visible in whatever platform's log viewer without
// needing to reproduce the failure first.
const rawEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const rawEnvB64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
function diagnoseCredentialString(label, jsonStr) {
  console.log(`[auth] ${label} is present, length ${jsonStr.length} characters.`);
  try {
    const parsed = JSON.parse(jsonStr);
    console.log(`[auth] It parses as valid JSON. project_id: ${parsed.project_id || '(missing!)'}, has private_key: ${!!parsed.private_key}, has client_email: ${!!parsed.client_email}.`);
  } catch (parseErr) {
    console.log(`[auth] It is present but does NOT parse as valid JSON: ${parseErr.message}`);
  }
}
if (rawEnv) {
  diagnoseCredentialString('FIREBASE_SERVICE_ACCOUNT_JSON', rawEnv);
} else {
  console.log('[auth] FIREBASE_SERVICE_ACCOUNT_JSON is not set (process.env has no value for it at all).');
}
if (rawEnvB64) {
  try {
    diagnoseCredentialString('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 (decoded)', Buffer.from(rawEnvB64, 'base64').toString('utf8'));
  } catch (decodeErr) {
    console.log(`[auth] FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 is present but failed to decode: ${decodeErr.message}`);
  }
} else {
  console.log('[auth] FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 is not set.');
}

try {
  const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) {
    credential = cert(JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf8')));
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
  } else {
    credential = applicationDefault();
  }
  const app = initializeApp({ credential });
  auth = getAuth(app);
  firebaseReady = true;
} catch (e) {
  // Deliberately non-fatal at startup: the rest of the app (and this module's own
  // requireAuth export) still loads, but every request will get a clear 500 explaining
  // what's missing, rather than the whole server refusing to boot over an auth config
  // issue during initial setup.
  console.error('Firebase Admin did not initialize:', e.message);
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_SERVICE_ACCOUNT_JSON, or FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 before logins will work.');
}

// ---- local user lookup / bootstrap ----
const BLANK_PERMS = Object.fromEntries(MODULES.map(m => [`module_${m}`, 0]));

function getUser(uid) {
  return db.prepare('SELECT * FROM users WHERE uid = ?').get(uid);
}

// Called once per verified request. Creates the local row on a person's very first
// login; the first row ever created becomes admin with every module (otherwise nobody
// could ever grant the first person access) — everyone after that starts at zero access.
//
// BOOTSTRAP_ADMIN_EMAIL (optional env var) is a second, independent way to designate an
// admin — whoever signs in with that exact email gets promoted on their very next login,
// whether or not they were first. This exists for recovering access on a host where the
// first-sign-in bootstrap landed on the wrong account and there's no server shell access
// to fix it by hand (e.g. a platform's shell/SSH feature sitting behind a paid tier) —
// setting one environment variable and redeploying is enough to fix it instead.
function upsertUser(uid, email, displayName) {
  const bootstrapEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const isBootstrapAdmin = bootstrapEmail && (email || '').trim().toLowerCase() === bootstrapEmail;

  const existing = getUser(uid);
  const now = new Date().toISOString();
  if (existing) {
    if (isBootstrapAdmin && !existing.is_admin) {
      const cols = ['email=?', 'display_name=?', 'last_login_at=?', 'is_admin=1', ...MODULES.map(m => `module_${m}=1`)];
      db.prepare(`UPDATE users SET ${cols.join(',')} WHERE uid=?`)
        .run(email || existing.email, displayName || existing.display_name, now, uid);
    } else {
      db.prepare('UPDATE users SET email=?, display_name=?, last_login_at=? WHERE uid=?')
        .run(email || existing.email, displayName || existing.display_name, now, uid);
    }
    return getUser(uid);
  }
  const isFirstUser = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
  const makeAdmin = isFirstUser || isBootstrapAdmin;
  const cols = ['uid', 'email', 'display_name', 'is_admin', 'last_login_at', ...MODULES.map(m => `module_${m}`)];
  const vals = [uid, email || '', displayName || '', makeAdmin ? 1 : 0, now, ...MODULES.map(() => (makeAdmin ? 1 : 0))];
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
