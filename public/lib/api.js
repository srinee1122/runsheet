// lib/api.js — thin fetch wrapper used by every component.
export const Api = (() => {
  async function req(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch { /* empty response */ }
    if (!res.ok) {
      const msg = (data && data.error) ? data.error : `Request failed (${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }
  return {
    get: (url) => req('GET', url),
    post: (url, body) => req('POST', url, body),
    put: (url, body) => req('PUT', url, body),
    del: (url) => req('DELETE', url),
  };
})();

// Reads an .xlsx/.xls File in the browser (via SheetJS) and returns an array of row
// objects keyed by the sheet's own header text (e.g. "Sub-category 2", "Qty/Ctn").
// SheetJS itself is loaded as a plain classic <script> in index.html (no ESM build at
// our pinned version), so it lives on window.XLSX — a classic script's globals are
// still visible here since modules share the same window.
export function parseSpreadsheetFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = window.XLSX.read(e.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
        resolve(rows);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// Current clerk name — persisted in localStorage so the browser "remembers" who's using it.
export const CurrentUser = {
  get() { return localStorage.getItem('runsheet_user') || ''; },
  set(name) { localStorage.setItem('runsheet_user', name || ''); },
};
