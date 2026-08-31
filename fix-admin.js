// fix-admin.js — run this ONCE with `node fix-admin.js` from your project folder.
// Shows every account currently in the database, then promotes srini@sriambikas.com
// to admin with every module — fixing the case where a different account ended up
// as the automatic "first user = admin" instead of the intended one.
//
// Reuses db.js's own connection (rather than opening a separate one) so the schema
// is always guaranteed to exist first, exactly as the real server ensures it —
// this script works correctly even if the server has never been started yet.
const { db } = require('./db.js');

const EMAIL_TO_PROMOTE = 'srini@sriambikas.com';

console.log('--- Everyone currently in the users table ---');
const all = db.prepare('SELECT uid, email, display_name, is_admin FROM users').all();
if (!all.length) {
  console.log('(table is empty — this script has nothing to fix; sign in first, then re-run)');
} else {
  all.forEach((u) => console.log(`  ${u.is_admin ? '[ADMIN] ' : '        '}${u.email || u.uid} (uid: ${u.uid})`));
}

const target = db.prepare('SELECT * FROM users WHERE email = ?').get(EMAIL_TO_PROMOTE);
if (!target) {
  console.log(`\nNo account found for ${EMAIL_TO_PROMOTE} yet — sign in with that account at least once first, then re-run this script.`);
} else {
  db.prepare(`
    UPDATE users SET is_admin = 1,
      module_builder = 1, module_history = 1, module_products = 1, module_customers = 1, module_settings = 1
    WHERE email = ?
  `).run(EMAIL_TO_PROMOTE);
  console.log(`\nDone — ${EMAIL_TO_PROMOTE} is now an admin with every module.`);
  console.log('Sign out and back in (or just refresh the page) to see it take effect.');
}
