// public/lib/formatDate.js
// SQLite's datetime('now') always stores UTC, but in a "YYYY-MM-DD HH:MM:SS" format with
// no timezone marker at all — browsers can't reliably treat that as UTC on their own (some
// engines parse an unmarked "space" format as local time instead, which would silently
// double-convert it). This explicitly marks it as UTC before parsing, then lets the
// browser's own locale and timezone render it for display — showing whoever's actually
// looking at it their own local time, not whatever timezone the server happens to run in.
export function formatDateTime(sqliteUtcString) {
  if (!sqliteUtcString) return '';
  const iso = sqliteUtcString.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return sqliteUtcString; // fallback: show the raw string rather than a blank or a crash
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
