// components/builder.js
import { Api } from '../lib/api.js';
import { round2 } from '../lib/round2.js';
import { formatDateTime } from '../lib/formatDate.js';
import PhotoReviewPanel from './photo-review.js';
import MatrixView from './matrix-view.js';

let _uidCounter = 1;
function uid() { return 'r' + (_uidCounter++) + '_' + Date.now().toString(36); }

function blankStop() {
  return {
    _uid: uid(), so_no: '', invoice_no: '', customer: '', taken_by: '',
    ctns_carton: null, ctns_bag: null, note: '', round_items: [], _invoiceNeedsInput: false,
  };
}

// Loads a stop saved before the Carton/Bag split existed (single `ctns` field) as all-carton,
// so nothing changes for anyone who hasn't touched this yet.
function migrateStopCtns(s) {
  if (s.ctns_carton != null || s.ctns_bag != null) return s;
  return { ...s, ctns_carton: Number(s.ctns) || 0, ctns_bag: 0 };
}

// ---- client-side image downscale: ~2000px longest edge, JPEG ~0.85 ----
function downscaleImage(file, maxDim = 2000, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      const longest = Math.max(width, height);
      if (longest > maxDim) {
        const scale = maxDim / longest;
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => { URL.revokeObjectURL(url); resolve(blob); }, 'image/jpeg', quality);
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

async function extractPhoto(blob) {
  const fd = new FormData();
  fd.append('photo', blob, 'photo.jpg');
  const res = await fetch('/api/extract-photo', { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'extraction failed');
  return data;
}

// concurrency-limited processing, 3 at a time, reporting progress as it goes
async function processInParallel(items, worker, concurrency, onProgress) {
  let idx = 0, done = 0;
  const results = new Array(items.length);
  async function run() {
    while (idx < items.length) {
      const my = idx++;
      try { results[my] = await worker(items[my]); }
      catch (e) { results[my] = { __error: e.message }; }
      done++; onProgress(done, items.length);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, run);
  await Promise.all(workers);
  return results;
}

// merge multi-page sales orders by so_no
function mergePages(pages) {
  const map = new Map();
  for (const p of pages) {
    if (p.__error) {
      const key = 'ERR-' + Math.random();
      map.set(key, { so_no: '(page failed)', uncertain: [p.__error], round_items: [], notes: [], _key: key, confirmed: false });
      continue;
    }
    const key = p.so_no || ('NOSO-' + Math.random());
    if (!map.has(key)) {
      map.set(key, {
        ...p,
        round_items: [...(p.round_items || [])],
        notes: [...(p.notes || [])],
        uncertain: [...(p.uncertain || [])],
        _key: key, confirmed: false,
      });
    } else {
      const ex = map.get(key);
      for (const ri of p.round_items || []) {
        const dup = ex.round_items.find(x => x.serial === ri.serial && x.item === ri.item);
        if (!dup) ex.round_items.push(ri);
      }
      if (!ex.box && p.box) ex.box = p.box;
      for (const n of p.notes || []) if (!ex.notes.includes(n)) ex.notes.push(n);
      for (const u of p.uncertain || []) if (!ex.uncertain.includes(u)) ex.uncertain.push(u);
      for (const f of ['customer', 'area', 'salesman', 'pallet_no']) if (!ex[f] && p[f]) ex[f] = p[f];
    }
  }
  return [...map.values()];
}

export default {
  props: { id: { type: String, default: null } },
  components: { PhotoReviewPanel, MatrixView },
  data() {
    return {
      // Matrix view is now the only layout — this file used to also support a List view;
      // its removal is why several methods below (moveUp/moveDown/removeStop/addStop) are
      // simpler than you'd expect for a single-view file — they're still exactly what
      // MatrixView calls via its emits.
      runsheetId: null,
      version: null, // optimistic-concurrency guard — set once a sheet exists on the server
      showVersions: false,
      versions: [], // lightweight list (no data) for the version-history modal
      loadingVersions: false,
      viewingVersion: null, // {version, saved_by, saved_at} once a past version's content has been loaded into the editor for review — cleared on the next real Save
      header: { sheet_no: '', area: '', delivery_man: '', vehicle_no: '', run_date: '', delivery_date: '' },
      stops: [],
      products: [],
      customers: [],
      frequentColumns: [],
      saving: false,
      saveMsg: '',
      // photo flow
      photoProgress: null, // { done, total }
      reviewSalesOrders: [],
      showReview: false,
      // background auto-save (draft protection) — see scheduleAutoSave/autoSave below
      readyForAutoSave: false, // guards against the initial data load itself counting as an edit
      autoSaveTimer: null,
      autoSaving: false,
      lastAutoSavedAt: null,
      autoSaveConflict: false, // someone else saved this sheet; paused until a manual Save resolves it
    };
  },
  computed: {
    atLimit() { return this.stops.length >= 25; },
    sheetTotals() {
      let ctns = 0, ri = 0;
      for (const s of this.stops) { ctns += this.rowCtns(s); ri += this.rowRI(s); }
      return { invoices: this.stops.length, ctns, ri: round2(ri), pkgs: round2(ctns + ri) };
    },
    autoSaveStatusText() {
      if (this.autoSaveConflict) return 'changed elsewhere — see notice below';
      if (this.autoSaving) return 'saving draft…';
      if (this.lastAutoSavedAt) return 'draft saved automatically';
      return '';
    },
  },
  watch: {
    // Any edit — Matrix view or the header fields — schedules a debounced background
    // save. Guarded by readyForAutoSave so the initial data load (mounted() setting
    // these for the first time) never itself counts as an edit worth saving.
    stops: { deep: true, handler() { this.scheduleAutoSave(); } },
    header: { deep: true, handler() { this.scheduleAutoSave(); } },
    // Reacts to navigating to a genuinely different sheet (or back to a blank one)
    // without relying on a full component remount — Vue Router reuses this same
    // instance when only the :id param changes within one route, updating this prop
    // reactively instead. Skips the one case where id changes but nothing should
    // reload: right after this very sheet's first auto-save assigns it an id and
    // updates the URL to match — by then runsheetId already equals the new id, so
    // there's nothing new to fetch, and reloading here would visibly flicker/reset
    // the page for no reason a few seconds into every brand-new sheet.
    async id(newId) {
      // newId is always a string (route params always are); runsheetId is a number (the
      // server returns a real number). Comparing them directly ("5" === 5) is always
      // false, which meant this skip check never actually matched the "this sheet just
      // got its first id" case — loadSheet() ran anyway, reassigning stops with fresh
      // _uid values, which forces Vue to destroy and recreate every stop's DOM elements.
      // That's the flicker. String() on both sides is what actually makes this work.
      if (String(newId || '') === String(this.runsheetId || '')) return;
      this.readyForAutoSave = false; // the reset below shouldn't itself count as an edit
      await this.loadSheet(newId);
      this.$nextTick(() => { this.readyForAutoSave = true; });
    },
  },
  async mounted() {
    this.products = await Api.get('/api/products');
    this.customers = await Api.get('/api/customers');
    this.frequentColumns = await Api.get('/api/settings/frequent-columns');
    await this.loadSheet(this.id);
    // Wait a tick so the assignments just above (which the watchers above also see) are
    // fully flushed before auto-save starts reacting to changes — otherwise loading an
    // existing sheet would immediately "auto-save" data that hasn't actually changed.
    this.$nextTick(() => { this.readyForAutoSave = true; });
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  },
  beforeUnmount() {
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    clearTimeout(this.autoSaveTimer);
  },
  methods: {
    // Loads an existing sheet's content, or resets to a blank new-sheet state when id
    // is falsy. Called once from mounted() for the initial load, and again from the id
    // watcher above for a genuine sheet switch.
    async loadSheet(id) {
      if (id) {
        const rs = await Api.get(`/api/runsheets/${id}`);
        this.runsheetId = rs.id;
        this.version = rs.version;
        this.header = { sheet_no: rs.sheet_no, area: rs.area, delivery_man: rs.delivery_man, vehicle_no: rs.vehicle_no, run_date: rs.run_date, delivery_date: rs.delivery_date };
        this.stops = (rs.data.stops || []).map(s => ({ ...migrateStopCtns(s), _uid: uid() }));
      } else {
        this.runsheetId = null;
        this.version = null;
        this.header = { sheet_no: '', area: '', delivery_man: '', vehicle_no: '', run_date: new Date().toISOString().slice(0, 10), delivery_date: '' };
        this.stops = [];
      }
      this.viewingVersion = null;
      this.autoSaveConflict = false;
    },
    round2, // exposed to template
    formatDateTime, // exposed to template
    productOf(id) { return this.products.find(p => p.id === id); },
    // Kept as the exact decimal sum, not rounded up — a fractional RI is usually a sign
    // of a wrong entry somewhere, and rounding it away would hide exactly the thing a
    // clerk needs to notice and fix. This is what the bottom stats bar's "Total RI" and
    // "TOTAL PACKAGES" are built from too. The printed sheet still rounds each product
    // up to a whole carton, so this figure and the printed one can differ a little —
    // that gap is expected, not a bug.
    rowRI(stop) {
      let total = 0;
      for (const ri of stop.round_items) total += Number(ri.qty_ctn) || 0;
      return total;
    },
    rowCtns(stop) { return (Number(stop.ctns_carton) || 0) + (Number(stop.ctns_bag) || 0); },
    rowTotalPkgs(stop) { return round2(this.rowCtns(stop) + this.rowRI(stop)); },

    addStop() {
      if (this.atLimit) return;
      this.stops.push(blankStop());
    },
    removeStop(i) {
      if (!confirm('Remove this stop from the sheet?')) return;
      this.stops.splice(i, 1);
    },
    moveUp(i) { if (i > 0) { const [s] = this.stops.splice(i, 1); this.stops.splice(i - 1, 0, s); } },
    moveDown(i) { if (i < this.stops.length - 1) { const [s] = this.stops.splice(i, 1); this.stops.splice(i + 1, 0, s); } },
    // Drag-and-drop reorder from Matrix view's row grip handle — same splice-out/splice-in
    // approach as moveUp/moveDown, just to an arbitrary target index instead of by one.
    reorderStop(fromIndex, toIndex) {
      if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= this.stops.length || toIndex < 0 || toIndex >= this.stops.length) return;
      const [s] = this.stops.splice(fromIndex, 1);
      this.stops.splice(toIndex, 0, s);
    },

    cleanStops() {
      return this.stops.map(s => ({
        so_no: s.so_no || '', invoice_no: s.invoice_no || '', customer: s.customer || '',
        taken_by: s.taken_by || '', ctns_carton: Number(s.ctns_carton) || 0, ctns_bag: Number(s.ctns_bag) || 0, note: s.note || '',
        round_items: (s.round_items || []).map(r => ({
          product_id: r.product_id, qty_ctn: Number(r.qty_ctn) || 0,
          packing_type: r.packing_type === 'bag' ? 'bag' : 'carton',
          entry_unit: r.entry_unit === 'PCS' ? 'PCS' : 'CTN',
        })),
      }));
    },

    async save() {
      if (this.stops.length > 25) { alert('Max 25 invoices per sheet (one-page rule).'); return false; }
      this.saving = true; this.saveMsg = '';
      const payload = {
        ...this.header,
        data: { stops: this.cleanStops(), frequentColumns: this.frequentColumns },
        version: this.version,
        explicit: true, // tells the server to snapshot the version being replaced — see db.js
      };
      let ok = true;
      try {
        if (this.runsheetId) {
          const r = await Api.put(`/api/runsheets/${this.runsheetId}`, payload);
          this.version = r.version;
        } else {
          const r = await Api.post('/api/runsheets', payload);
          this.runsheetId = r.id;
          this.version = r.version;
          this.$router.replace(`/builder/${r.id}`);
        }
        this.saveMsg = 'Saved.';
        this.lastAutoSavedAt = new Date();
        this.autoSaveConflict = false;
        this.viewingVersion = null;
      } catch (e) {
        ok = false;
        if (e.status === 409) {
          this.saveMsg = '';
          const reload = confirm(
            "This runsheet was changed by someone else since you opened it, so your changes here weren't saved.\n\n" +
            'Click OK to reload the latest version (this replaces what you see here — reapply your changes after).\n' +
            "Click Cancel to keep working here and try Save again later."
          );
          if (reload) await this.reloadFromServer();
        } else {
          this.saveMsg = 'Error: ' + e.message;
        }
      } finally {
        this.saving = false;
        setTimeout(() => (this.saveMsg = ''), 2500);
      }
      return ok;
    },
    // Re-fetches this runsheet from the server, discarding whatever's currently on screen —
    // used after a 409 conflict, when the person has chosen to see the latest saved version.
    async reloadFromServer() {
      if (!this.runsheetId) return;
      const rs = await Api.get(`/api/runsheets/${this.runsheetId}`);
      this.version = rs.version;
      this.header = { sheet_no: rs.sheet_no, area: rs.area, delivery_man: rs.delivery_man, vehicle_no: rs.vehicle_no, run_date: rs.run_date, delivery_date: rs.delivery_date };
      this.stops = (rs.data.stops || []).map(s => ({ ...migrateStopCtns(s), _uid: uid() }));
      this.autoSaveConflict = false; // local state now matches the server again
    },

    // ---------------- version history ----------------
    async openVersionHistory() {
      if (!this.runsheetId) return;
      this.showVersions = true;
      this.loadingVersions = true;
      try {
        this.versions = await Api.get(`/api/runsheets/${this.runsheetId}/versions`);
      } finally {
        this.loadingVersions = false;
      }
    },
    // Loads a past version's content into the editor for review — deliberately does NOT
    // touch this.version (which still tracks the real current row), so a Save afterward
    // correctly conflict-checks against the actual latest state and, being an explicit
    // save, snapshots whatever's about to be replaced too. Restoring is just "load old
    // content, then Save normally" — there's no separate, irreversible restore action.
    async loadVersionForReview(versionRow) {
      const v = await Api.get(`/api/runsheets/${this.runsheetId}/versions/${versionRow.id}`);
      this.header = { sheet_no: v.sheet_no, area: v.area, delivery_man: v.delivery_man, vehicle_no: v.vehicle_no, run_date: v.run_date, delivery_date: v.delivery_date };
      this.stops = (v.data.stops || []).map(s => ({ ...migrateStopCtns(s), _uid: uid() }));
      this.viewingVersion = { version: v.version, saved_by: v.saved_by, saved_at: v.saved_at };
      this.showVersions = false;
    },

    // ---------------- background auto-save (draft protection) ----------------
    // Debounced so a burst of keystrokes doesn't fire a save per character — waits for a
    // short pause in editing, then saves quietly through the exact same save path as the
    // Save button (so it gets the same version-conflict protection for free), just without
    // any of the interruptive UI (no alert, no confirm dialog, no button-state changes).
    scheduleAutoSave() {
      if (!this.readyForAutoSave || this.autoSaveConflict) return;
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = setTimeout(() => this.autoSave(), 2500);
    },
    async autoSave() {
      if (this.saving || this.autoSaving) return; // don't overlap with a manual save, or with itself
      if (this.stops.length > 25) return; // the person will hit this via a manual Save/Print anyway; stay quiet here
      this.autoSaving = true;
      const payload = {
        ...this.header,
        data: { stops: this.cleanStops(), frequentColumns: this.frequentColumns },
        version: this.version,
        // deliberately no `explicit` here — auto-save fires every ~2.5s while typing and
        // shouldn't create a version-history snapshot every time, only real Saves should.
      };
      try {
        if (this.runsheetId) {
          const r = await Api.put(`/api/runsheets/${this.runsheetId}`, payload);
          this.version = r.version;
        } else {
          const r = await Api.post('/api/runsheets', payload);
          this.runsheetId = r.id;
          this.version = r.version;
          this.$router.replace(`/builder/${r.id}`);
        }
        this.lastAutoSavedAt = new Date();
      } catch (e) {
        // A 409 here means someone else saved this sheet since we last synced. Don't
        // silently overwrite their work, and don't interrupt with a dialog mid-typing
        // either — just flag it and stop auto-saving until a manual Save resolves it
        // through the normal reload-or-keep-working choice.
        if (e.status === 409) this.autoSaveConflict = true;
        // any other error: stay quiet, the next edit will schedule another attempt
      } finally {
        this.autoSaving = false;
      }
    },
    // Flush any pending debounced save immediately when the tab is hidden — covers
    // switching away to another tab, and gives a save a real chance to complete before
    // the page closes (unlike waiting out the full debounce, which a fast close could beat).
    handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        clearTimeout(this.autoSaveTimer);
        if (this.readyForAutoSave && !this.autoSaveConflict) this.autoSave();
      }
    },
    // Always saves first — the print page reads the saved runsheet from the database, not
    // whatever's currently on screen, so printing without saving would silently print stale
    // data (exactly what was on the sheet as of the last Save, missing anything added since).
    async print() {
      const ok = await this.save();
      if (!ok || !this.runsheetId) return;
      window.open(`/print.html?id=${this.runsheetId}`, '_blank');
    },

    // ---------------- photo flow ----------------
    triggerPhotoInput() { this.$refs.photoInput.click(); },
    async onPhotosChosen(ev) {
      const files = Array.from(ev.target.files || []);
      ev.target.value = '';
      if (!files.length) return;
      if (files.length > 30 && !confirm(`You're uploading ${files.length} photos — this may take a few minutes. Continue?`)) return;

      this.photoProgress = { done: 0, total: files.length };
      const blobs = await Promise.all(files.map(f => downscaleImage(f)));
      const pages = await processInParallel(blobs, extractPhoto, 3, (done, total) => {
        this.photoProgress = { done, total };
      });
      this.photoProgress = null;

      const merged = mergePages(pages);
      this.reviewSalesOrders = merged;
      this.showReview = true;
    },
    onConfirmSo(so) {
      if (this.stops.length >= 25) { alert('This sheet already has 25 invoices (one-page rule) — remove one before adding another.'); return; }
      const roundItems = (so.round_items || [])
        .filter(r => !r.struck && r.mapped_product_id)
        .map(r => {
          const p = this.productOf(r.mapped_product_id);
          const qtyPerCtn = (p && p.qty_per_ctn) || 1;
          const isCarton = /^C/i.test(r.uom || '');
          const qty_ctn = isCarton ? Number(r.qty) || 0 : (Number(r.qty) || 0) / qtyPerCtn;
          return { product_id: r.mapped_product_id, qty_ctn: round2(qty_ctn), packing_type: (p && p.packing_type) || 'carton' };
        });
      const stop = {
        _uid: uid(),
        so_no: so.so_no || '',
        invoice_no: '',
        _invoiceNeedsInput: true,
        customer: so.customer || '',
        taken_by: (so.box && so.box.reader_name) || '',
        ctns_carton: so.box ? (Number(so.box.carton) || 0) + (Number(so.box.loose) || 0) : 0,
        ctns_bag: 0,
        note: (so.notes || []).join(' · '),
        round_items: roundItems,
      };
      this.stops.push(stop);
      so.confirmed = true;
    },
    onDiscardSo(so) {
      this.reviewSalesOrders = this.reviewSalesOrders.filter(s => s !== so);
    },
  },
  template: `
  <div class="page-head">
    <div>
      <h1>Runsheet Builder</h1>
      <div class="sub">{{ runsheetId ? 'Editing saved sheet #' + runsheetId : 'New sheet' }}<span v-if="autoSaveStatusText"> &middot; {{ autoSaveStatusText }}</span> &middot; max 25 invoices per sheet</div>
    </div>
    <div class="toolbar">
      <input ref="photoInput" type="file" accept="image/*" multiple style="display:none" @change="onPhotosChosen" />
      <button @click="triggerPhotoInput">📷 From photo</button>
      <button @click="addStop" :disabled="atLimit">+ Add stop</button>
      <button class="primary" @click="save" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
      <button @click="print" :disabled="saving">🖨️ Print</button>
      <button v-if="runsheetId" @click="openVersionHistory">Version History</button>
      <span class="hint" v-if="saveMsg">{{ saveMsg }}</span>
    </div>
  </div>

  <div class="warn-banner" v-if="viewingVersion">
    Reviewing version {{ viewingVersion.version }}, saved by {{ viewingVersion.saved_by || 'someone' }} at {{ formatDateTime(viewingVersion.saved_at) }}
    — this isn't the current saved sheet yet. Click Save to restore it, or Version History to pick a different one.
  </div>

  <div class="overlay" v-if="showVersions" @click.self="showVersions=false">
    <div class="modal">
      <h2>Version History</h2>
      <p class="hint" style="margin-top:-6px;">Every time this sheet was saved (not counting the automatic background
        drafts). Pick one to load its content back into the editor for review — nothing changes until you Save.</p>
      <p class="hint" v-if="loadingVersions">Loading…</p>
      <table v-if="!loadingVersions && versions.length" style="margin-top:10px;">
        <thead><tr><th style="text-align:left;">Version</th><th style="text-align:left;">Saved by</th><th style="text-align:left;">Saved at</th><th></th></tr></thead>
        <tbody>
          <tr v-for="v in versions" :key="v.id">
            <td>{{ v.version }}</td>
            <td>{{ v.saved_by || '—' }}</td>
            <td class="hint">{{ formatDateTime(v.saved_at) }}</td>
            <td><button class="small" @click="loadVersionForReview(v)">Load</button></td>
          </tr>
        </tbody>
      </table>
      <p class="empty" v-if="!loadingVersions && !versions.length">No earlier saves yet — this sheet hasn't been through more than one Save.</p>
      <div class="modal-actions"><button @click="showVersions=false">Close</button></div>
    </div>
  </div>

  <div class="panel">
    <h2 style="margin-top:0;font-size:14px;">Run details</h2>
    <div class="field-row">
      <div class="field"><label>Sheet No</label><input type="text" v-model="header.sheet_no" /></div>
      <div class="field"><label>Area / Route</label><input type="text" v-model="header.area" /></div>
      <div class="field"><label>Delivery Man</label><input type="text" v-model="header.delivery_man" /></div>
      <div class="field"><label>Vehicle No</label><input type="text" v-model="header.vehicle_no" /></div>
      <div class="field"><label>Run Date</label><input type="date" v-model="header.run_date" /></div>
      <div class="field"><label>Delivery Date</label><input type="date" v-model="header.delivery_date" /></div>
    </div>
  </div>

  <div class="progress-card" v-if="photoProgress">
    <b>Extracting photos: {{ photoProgress.done }} / {{ photoProgress.total }}</b>
    <div class="progress-bar-track"><div class="progress-bar-fill" :style="{width: (100*photoProgress.done/photoProgress.total)+'%'}"></div></div>
  </div>

  <PhotoReviewPanel v-if="showReview" :salesOrders="reviewSalesOrders" :products="products" :frequentColumns="frequentColumns"
    @confirm="onConfirmSo" @discard="onDiscardSo" @close="showReview=false" />

  <div class="limit-banner" v-if="atLimit">This sheet has 25 invoices — the one-page limit. Remove a stop before adding another.</div>
  <div class="warn-banner" v-if="autoSaveConflict">This runsheet was changed by someone else while you were editing — auto-save is paused so nothing gets silently overwritten. Click Save when you're ready to see what changed and continue.</div>

  <MatrixView :stops="stops" :products="products" :customers="customers"
    :frequentColumns="frequentColumns" :atLimit="atLimit"
    @add-stop="addStop" @remove-stop="removeStop"
    @move-stop="(i, dir) => dir==='up' ? moveUp(i) : moveDown(i)" @reorder-stop="reorderStop" />

  <div class="totals-strip" v-if="stops.length">
    <span>Invoices: <b>{{ sheetTotals.invoices }}</b> / 25</span>
    <span>Total CTNS: <b>{{ sheetTotals.ctns }}</b></span>
    <span>Total RI: <b>{{ sheetTotals.ri }}</b></span>
    <span>TOTAL PACKAGES: <b>{{ sheetTotals.pkgs }}</b></span>
  </div>
  `,
};
