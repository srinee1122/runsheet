// components/builder.js
import { Api } from '../lib/api.js';
import { round2 } from '../lib/round2.js';
import RoundItemPicker from './round-item-picker.js';
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

// small inline sub-component: the "pick product + unit + qty + add" row for one stop.
// Any product in the catalog can be picked — the up-to-10 preset columns (Settings page)
// only control which round items get their own column at the top of the printed sheet;
// everything else still prints fine in the "All Round Items" matrix below it.
const RoundItemAdder = {
  components: { RoundItemPicker },
  props: { stop: Object, products: Array, frequentColumns: Array },
  emits: ['add'],
  data() { return { draft: { product_id: null, unit: 'CTN', qty: null, packing_type: 'carton' } }; },
  computed: {
    matchedColumn() {
      return (this.frequentColumns || []).find(c => c.product_id === this.draft.product_id) || null;
    },
  },
  watch: {
    // default the packing type and entry unit to the product's own settings whenever the
    // product changes — the clerk can still override either below before adding
    'draft.product_id'(id) {
      const p = this.products.find(x => x.id === id);
      this.draft.packing_type = (p && p.packing_type) || 'carton';
      this.draft.unit = (p && p.entry_unit) || 'CTN';
    },
  },
  methods: {
    add() {
      if (!this.draft.product_id || !this.draft.qty) return;
      this.$emit('add', { ...this.draft });
      this.draft.product_id = null;
      this.draft.qty = null;
      this.draft.packing_type = 'carton';
    },
  },
  template: `
  <div class="field-row" style="align-items:flex-end;">
    <div class="field" style="flex:2;">
      <RoundItemPicker :products="products" :frequentColumns="frequentColumns" v-model="draft.product_id" />
      <div class="hint" v-if="matchedColumn" style="color:var(--good)">Prints in top column: {{ matchedColumn.code }}</div>
    </div>
    <div class="field" style="flex:none;width:110px;">
      <select v-model="draft.unit"><option value="CTN">Cartons</option><option value="PCS">Pieces</option></select>
    </div>
    <div class="field" style="flex:none;width:100px;">
      <input type="number" min="0" step="0.01" v-model.number="draft.qty" placeholder="Qty" />
    </div>
    <div class="field" style="flex:none;width:110px;">
      <select v-model="draft.packing_type" title="Billing classification only — doesn't change any counts">
        <option value="carton">Carton</option>
        <option value="bag">Bag</option>
      </select>
    </div>
    <div class="field" style="flex:none;">
      <button @click="add">+ Add</button>
    </div>
  </div>
  `,
};

export default {
  props: { id: { type: String, default: null } },
  components: { PhotoReviewPanel, RoundItemAdder, MatrixView },
  data() {
    return {
      viewMode: 'list', // 'list' | 'matrix' — both operate on the same `stops` array
      runsheetId: null,
      version: null, // optimistic-concurrency guard — set once a sheet exists on the server
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
    atLimit() { return this.stops.length >= 20; },
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
    // Any edit — from List view, Matrix view, or the header fields — schedules a debounced
    // background save. Both views mutate this same `stops` array, so one watcher here
    // covers both. Guarded by readyForAutoSave so the initial data load (mounted() setting
    // these for the first time) never itself counts as an edit worth saving.
    stops: { deep: true, handler() { this.scheduleAutoSave(); } },
    header: { deep: true, handler() { this.scheduleAutoSave(); } },
  },
  async mounted() {
    this.products = await Api.get('/api/products');
    this.customers = await Api.get('/api/customers');
    this.frequentColumns = await Api.get('/api/settings/frequent-columns');
    if (this.id) {
      const rs = await Api.get(`/api/runsheets/${this.id}`);
      this.runsheetId = rs.id;
      this.version = rs.version;
      this.header = { sheet_no: rs.sheet_no, area: rs.area, delivery_man: rs.delivery_man, vehicle_no: rs.vehicle_no, run_date: rs.run_date, delivery_date: rs.delivery_date };
      this.stops = (rs.data.stops || []).map(s => ({ ...migrateStopCtns(s), _uid: uid() }));
    } else {
      if (!this.header.run_date) this.header.run_date = new Date().toISOString().slice(0, 10);
    }
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
    round2, // exposed to template
    productOf(id) { return this.products.find(p => p.id === id); },
    // short code for the up-to-10 preset products that get their own column at the top
    // of the printed sheet; null for every other product (which still prints fine — it
    // just falls into the "All Round Items" matrix instead of a dedicated column).
    columnCodeFor(productId) {
      const col = (this.frequentColumns || []).find(c => c.product_id === productId);
      return col ? col.code : null;
    },
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

    addRoundItem(stop, draft) {
      if (!draft.product_id || !draft.qty) return;
      const p = this.productOf(draft.product_id);
      if (!p) return;
      const qty = Number(draft.qty);
      const qty_ctn = draft.unit === 'PCS' ? qty / (p.qty_per_ctn || 1) : qty;
      stop.round_items.push({ product_id: p.id, qty_ctn: round2(qty_ctn), packing_type: draft.packing_type === 'bag' ? 'bag' : 'carton' });
      draft.qty = null;
    },
    removeRoundItem(stop, i) { stop.round_items.splice(i, 1); },

    cleanStops() {
      return this.stops.map(s => ({
        so_no: s.so_no || '', invoice_no: s.invoice_no || '', customer: s.customer || '',
        taken_by: s.taken_by || '', ctns_carton: Number(s.ctns_carton) || 0, ctns_bag: Number(s.ctns_bag) || 0, note: s.note || '',
        round_items: (s.round_items || []).map(r => ({
          product_id: r.product_id, qty_ctn: Number(r.qty_ctn) || 0,
          packing_type: r.packing_type === 'bag' ? 'bag' : 'carton',
        })),
      }));
    },

    async save() {
      if (this.stops.length > 20) { alert('Max 20 invoices per sheet (one-page rule).'); return false; }
      this.saving = true; this.saveMsg = '';
      const payload = {
        ...this.header,
        data: { stops: this.cleanStops(), frequentColumns: this.frequentColumns },
        version: this.version,
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
      if (this.stops.length > 20) return; // the person will hit this via a manual Save/Print anyway; stay quiet here
      this.autoSaving = true;
      const payload = {
        ...this.header,
        data: { stops: this.cleanStops(), frequentColumns: this.frequentColumns },
        version: this.version,
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
      if (this.stops.length >= 20) { alert('This sheet already has 20 invoices (one-page rule) — remove one before adding another.'); return; }
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
      <div class="sub">{{ runsheetId ? 'Editing saved sheet #' + runsheetId : 'New sheet' }}<span v-if="autoSaveStatusText"> &middot; {{ autoSaveStatusText }}</span> &middot; max 20 invoices per sheet</div>
    </div>
    <div class="toolbar">
      <input ref="photoInput" type="file" accept="image/*" multiple style="display:none" @change="onPhotosChosen" />
      <button @click="triggerPhotoInput">📷 From photo</button>
      <button @click="addStop" :disabled="atLimit">+ Add stop</button>
      <button class="primary" @click="save" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
      <button @click="print" :disabled="saving">🖨️ Print</button>
      <span class="hint" v-if="saveMsg">{{ saveMsg }}</span>
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

  <div class="toolbar" style="margin-bottom:10px;">
    <button :class="{primary: viewMode==='list'}" @click="viewMode='list'">List view</button>
    <button :class="{primary: viewMode==='matrix'}" @click="viewMode='matrix'">Matrix view</button>
    <span class="hint">Both work on the same stops &mdash; switch anytime without losing anything.</span>
  </div>

  <div class="progress-card" v-if="photoProgress">
    <b>Extracting photos: {{ photoProgress.done }} / {{ photoProgress.total }}</b>
    <div class="progress-bar-track"><div class="progress-bar-fill" :style="{width: (100*photoProgress.done/photoProgress.total)+'%'}"></div></div>
  </div>

  <PhotoReviewPanel v-if="showReview" :salesOrders="reviewSalesOrders" :products="products" :frequentColumns="frequentColumns"
    @confirm="onConfirmSo" @discard="onDiscardSo" @close="showReview=false" />

  <div class="limit-banner" v-if="atLimit">This sheet has 20 invoices — the one-page limit. Remove a stop before adding another.</div>
  <div class="warn-banner" v-if="autoSaveConflict">This runsheet was changed by someone else while you were editing — auto-save is paused so nothing gets silently overwritten. Click Save when you're ready to see what changed and continue.</div>

  <template v-if="viewMode==='list'">
  <datalist id="customer-list">
    <option v-for="c in customers" :key="c.id" :value="c.name" />
  </datalist>

  <div v-for="(stop, i) in stops" :key="stop._uid" class="stop-card">
    <span class="stop-index">Stop {{ i+1 }}</span>
    <div class="stop-actions">
      <button class="ghost small" @click="moveUp(i)" :disabled="i===0" title="Move up">&uarr;</button>
      <button class="ghost small" @click="moveDown(i)" :disabled="i===stops.length-1" title="Move down">&darr;</button>
      <button class="danger small" @click="removeStop(i)">Remove</button>
    </div>

    <div class="field-row" style="margin-top:18px;">
      <div class="field"><label>Sales Order No</label><input type="text" v-model="stop.so_no" /></div>
      <div class="field">
        <label>Invoice No</label>
        <input type="text" v-model="stop.invoice_no" @input="stop._invoiceNeedsInput=false"
          :style="stop._invoiceNeedsInput && !stop.invoice_no ? 'border-color:var(--bad);background:var(--bad-soft)' : ''" />
        <div class="hint" style="color:var(--bad)" v-if="stop._invoiceNeedsInput && !stop.invoice_no">From photo — key in the invoice number.</div>
      </div>
      <div class="field">
        <label>Customer</label>
        <input type="text" v-model="stop.customer" list="customer-list" placeholder="Search or type new..." />
      </div>
      <div class="field"><label>Taken by</label><input type="text" v-model="stop.taken_by" /></div>
    </div>

    <div class="field-row">
      <div class="field" style="max-width:110px;">
        <label>CTNS &mdash; Cartons</label>
        <input type="number" min="0" step="1" v-model.number="stop.ctns_carton" />
      </div>
      <div class="field" style="max-width:110px;">
        <label>CTNS &mdash; Bags</label>
        <input type="number" min="0" step="1" v-model.number="stop.ctns_bag" />
      </div>
      <div class="field"><label>Note (prints on sheet)</label><input type="text" v-model="stop.note" /></div>
    </div>
    <p class="hint" style="margin-top:-6px;">Manual box total the packing team counted &mdash; split by Carton vs Bag purely for delivery-cost billing, same as round items. Both count the same toward CTNS/TOTAL PKGS.</p>

    <div class="field">
      <label>Round items <span class="hint">— any product can be a round item; up to 10 preset ones get their own column on the printed sheet</span></label>
      <div v-if="stop.round_items.length" style="margin-bottom:8px;">
        <span v-for="(ri, ri_i) in stop.round_items" :key="ri_i" class="ri-chip">
          <b class="mono" v-if="columnCodeFor(ri.product_id)">{{ columnCodeFor(ri.product_id) }}</b>
          {{ productOf(ri.product_id)?.name || '(deleted product)' }}:
          <b class="mono">{{ ri.qty_ctn }} ctn</b>
          <span class="hint" v-if="productOf(ri.product_id)">({{ round2(ri.qty_ctn * productOf(ri.product_id).qty_per_ctn) }} pcs)</span>
          <span class="hint">&middot; {{ ri.packing_type === 'bag' ? 'Bag' : 'Carton' }}</span>
          <button @click="removeRoundItem(stop, ri_i)">&times;</button>
        </span>
      </div>
      <RoundItemAdder :stop="stop" :products="products" :frequentColumns="frequentColumns" @add="addRoundItem(stop, $event)" />
    </div>

    <div class="hint">Row TOTAL PKGS = {{ rowCtns(stop) }} CTNS + {{ round2(rowRI(stop)) }} RI = <b class="mono">{{ rowTotalPkgs(stop) }}</b></div>
  </div>

  <div class="empty" v-if="!stops.length">No stops yet. Add one manually or pull from a photo.</div>
  </template>

  <MatrixView v-else-if="viewMode==='matrix'" :stops="stops" :products="products" :customers="customers"
    :frequentColumns="frequentColumns" :atLimit="atLimit"
    @add-stop="addStop" @remove-stop="removeStop"
    @move-stop="(i, dir) => dir==='up' ? moveUp(i) : moveDown(i)" @reorder-stop="reorderStop" />

  <div class="totals-strip" v-if="stops.length">
    <span>Invoices: <b>{{ sheetTotals.invoices }}</b> / 20</span>
    <span>Total CTNS: <b>{{ sheetTotals.ctns }}</b></span>
    <span>Total RI: <b>{{ sheetTotals.ri }}</b></span>
    <span>TOTAL PACKAGES: <b>{{ sheetTotals.pkgs }}</b></span>
  </div>
  `,
};
