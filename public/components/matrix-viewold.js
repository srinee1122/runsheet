// components/matrix-view.js
// A build-time view laid out like the printed runsheet itself: a main table with one row
// per stop (S.N / Invoice / S.Order / Customer / Taken By / Note / preset round-item
// columns / CTNS / RI / TOTAL — same shape as the print's main table), plus an "All Round
// Items" grid below it with rotated-feel stop headers, for anything not set up as a preset
// column — same two-part structure the print output uses. Operates on the exact same
// `stops` array the List view uses (mutated in place), so switching views never loses
// anything.
import ProductPicker from './product-picker.js';
import { round2 } from '../lib/round2.js';

export default {
  components: { ProductPicker },
  props: {
    stops: { type: Array, required: true },
    products: { type: Array, required: true },
    customers: { type: Array, required: true },
    frequentColumns: { type: Array, default: () => [] },
    atLimit: { type: Boolean, default: false },
  },
  emits: ['add-stop', 'remove-stop', 'move-stop'],
  data() {
    return {
      matrixProductRows: [], // "All Round Items" rows — products NOT set up as a preset column
      rowPacking: {},        // product_id -> 'carton' | 'bag', toggled per row, applied to new AND existing quantities in that row
      rowUnit: {},           // product_id -> 'CTN' | 'PCS', toggled per row — overrides the product's own entry-unit default just for this row
      newRowProductId: null,
      // `${stop._uid}-${productId}` -> the value exactly as typed/displayed, in that
      // product's own entry unit. Seeded once from the stored cartons figure (rounded
      // for entry-unit display), then only ever written from what the person actually
      // types — never recomputed by converting the stored value back and forth, which
      // would visibly reformat or drift from what they typed whenever qty/ctn doesn't
      // divide evenly. The canonical qty_ctn (used for every total) is kept in sync
      // alongside it, but the two are independent once a cell has been edited.
      entryDisplay: {},
    };
  },
  computed: {
    // up to 10 preset columns, resolved against the current product list — same routing
    // print.js uses, so a product's spot here always matches where it'll print
    columns() {
      return (this.frequentColumns || []).filter(c => c.product_id).slice(0, 10).map(c => {
        const p = this.products.find(x => x.id === c.product_id);
        return {
          product_id: c.product_id, code: c.code || (p ? p.name : ''), qty: (p && p.qty_per_ctn) || 1,
          unit: (p && p.entry_unit) === 'PCS' ? 'PCS' : 'CTN',
        };
      });
    },
    columnProductIds() { return new Set(this.columns.map(c => c.product_id)); },
    // products not already a preset column or an existing row — what the "add a product"
    // field searches, so it never offers something that's already on the sheet
    addableProducts() {
      const usedIds = new Set([...this.columnProductIds, ...this.matrixProductRows.map(p => p.id)]);
      return this.products.filter(p => !usedIds.has(p.id));
    },
    // colspan for the group header's leading block: S.N, Invoice, S.Order, Customer, Taken By, Note
    leadColspan() { return 6; },
    // "Pre picked" group: CTNS Carton + Bag
    prePickedColspan() { return 2; },
    // "RI" group: Carton + Bag
    riColspan() { return 2; },
    // trailing ungrouped block: TOTAL, Actions
    tailColspan() { return 2; },
  },
  watch: {
    // selecting a product in the "add a product" field adds it right away — no separate
    // button to click. addProductRow() itself resets newRowProductId back to null once
    // it's done, which also clears the picker's visible text (see ProductPicker's own
    // modelValue watcher), so the field is immediately ready for the next product.
    newRowProductId(val) { if (val) this.addProductRow(); },
  },
  created() {
    this.rebuildMatrixRows();
    this.seedEntryDisplay();
  },
  methods: {
    round2,
    productOf(id) { return this.products.find(p => p.id === id); },
    rebuildMatrixRows() {
      const ids = new Set();
      for (const p of this.products) if (p.is_round_item && !this.columnProductIds.has(p.id)) ids.add(p.id);
      for (const s of this.stops) for (const ri of s.round_items || []) if (!this.columnProductIds.has(ri.product_id)) ids.add(ri.product_id);
      this.matrixProductRows = [...ids].map(id => this.products.find(p => p.id === id)).filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const p of this.matrixProductRows) {
        if (!(p.id in this.rowPacking)) this.rowPacking[p.id] = p.packing_type || 'carton';
        if (!(p.id in this.rowUnit)) this.rowUnit[p.id] = p.entry_unit === 'PCS' ? 'PCS' : 'CTN';
      }
    },

    rowRI(stop) {
      let t = 0;
      for (const ri of stop.round_items || []) t += Number(ri.qty_ctn) || 0;
      return t;
    },
    // RI split by packing type, for the RI Carton/Bag columns — same figures the Load
    // Summary's sheet-wide "Round items — packed as Carton/Bag" totals are built from,
    // just per row here.
    riCarton(stop) {
      let t = 0;
      for (const ri of stop.round_items || []) if (ri.packing_type !== 'bag') t += Number(ri.qty_ctn) || 0;
      return round2(t);
    },
    riBag(stop) {
      let t = 0;
      for (const ri of stop.round_items || []) if (ri.packing_type === 'bag') t += Number(ri.qty_ctn) || 0;
      return round2(t);
    },
    rowCtns(stop) { return (Number(stop.ctns_carton) || 0) + (Number(stop.ctns_bag) || 0); },
    rowTotalPkgs(stop) { return round2(this.rowCtns(stop) + this.rowRI(stop)); },

    entryUnitFor(product) {
      if (product && product.id in this.rowUnit) return this.rowUnit[product.id];
      return (product && product.entry_unit) === 'PCS' ? 'PCS' : 'CTN';
    },
    cellStep(product) { return this.entryUnitFor(product) === 'PCS' ? '1' : '0.01'; },
    entryKey(stop, productId) { return stop._uid + '-' + productId; },

    // stored round_items are always in cartons — this is the canonical figure every total
    // (RI, TOTAL PKGS, column totals) is computed from, regardless of what's on screen.
    rawQtyCtn(stop, productId) {
      const ri = (stop.round_items || []).find(r => r.product_id === productId);
      return ri ? Number(ri.qty_ctn) || 0 : 0;
    },
    // one-time seed from stored cartons, converted to each product's entry unit — this is
    // the only place a value is ever *derived* for display; after this, cellValue always
    // reads back exactly what setCellValue last wrote, never a fresh conversion.
    seedEntryDisplay() {
      for (const stop of this.stops) {
        for (const ri of stop.round_items || []) {
          const p = this.productOf(ri.product_id);
          const qtyPerCtn = (p && p.qty_per_ctn) || 1;
          const val = this.entryUnitFor(p) === 'PCS' ? Number(ri.qty_ctn) * qtyPerCtn : Number(ri.qty_ctn);
          this.entryDisplay[this.entryKey(stop, ri.product_id)] = String(round2(val));
        }
      }
    },
    cellValue(stop, productId) {
      const key = this.entryKey(stop, productId);
      return key in this.entryDisplay ? this.entryDisplay[key] : '';
    },
    // packingDefault only applies when a brand-new entry is created for this cell — editing
    // an existing entry's quantity never silently changes its packing type.
    setCellValue(stop, productId, rawVal, packingDefault) {
      const key = this.entryKey(stop, productId);
      const idx = stop.round_items.findIndex(r => r.product_id === productId);
      if (rawVal === '') {
        delete this.entryDisplay[key];
        if (idx >= 0) stop.round_items.splice(idx, 1);
        return;
      }
      this.entryDisplay[key] = rawVal; // keep exactly what was typed, no matter what
      const val = Number(rawVal);
      if (!Number.isFinite(val) || val <= 0) return; // mid-typing something transitional (".", "-") — leave storage alone
      const p = this.productOf(productId);
      const qtyPerCtn = (p && p.qty_per_ctn) || 1;
      const qty_ctn = this.entryUnitFor(p) === 'PCS' ? val / qtyPerCtn : val;
      if (idx >= 0) stop.round_items[idx].qty_ctn = round2(qty_ctn);
      else stop.round_items.push({ product_id: productId, qty_ctn: round2(qty_ctn), packing_type: packingDefault || 'carton' });
    },
    columnPackingDefault(productId) { return (this.productOf(productId) || {}).packing_type || 'carton'; },

    // Totals always sum the canonical stored cartons, not the display unit — a product
    // entered in pieces and one entered in cartons are still comparable this way, and it
    // matches the CTNS/RI figures everywhere else in the app.
    columnTotal(productId) {
      let t = 0;
      for (const s of this.stops) t += this.rawQtyCtn(s, productId);
      return round2(t);
    },
    matrixColTotal(stop) {
      let t = 0;
      for (const p of this.matrixProductRows) t += this.rawQtyCtn(stop, p.id);
      return round2(t);
    },

    // Changing a matrix row's packing type re-tags every quantity already entered in that
    // row — there's no room for a per-cell override in a grid. For a one-off that genuinely
    // needs to differ, switch to List view for that single item.
    setRowPacking(productId, packing_type) {
      this.rowPacking[productId] = packing_type;
      for (const s of this.stops) {
        const ri = (s.round_items || []).find(r => r.product_id === productId);
        if (ri) ri.packing_type = packing_type;
      }
    },
    // The whole-unit label always matches the row's current packing type — if it's packed
    // as bags, "one whole unit" means one bag, not one carton.
    packLabel(productId) { return this.rowPacking[productId] === 'bag' ? 'Bag' : 'Ctn'; },
    toggleRowPacking(productId) {
      this.setRowPacking(productId, this.rowPacking[productId] === 'bag' ? 'carton' : 'bag');
    },
    // Changing a matrix row's entry unit re-renders every existing cell in that row from the
    // canonical stored cartons figure, converted into the new unit — otherwise a cell that
    // already shows "12" would keep showing "12" after switching from pieces to cartons,
    // which would silently mean a completely different quantity.
    applyRowUnit(productId, newUnit) {
      this.rowUnit[productId] = newUnit;
      const p = this.productOf(productId);
      const qtyPerCtn = (p && p.qty_per_ctn) || 1;
      for (const stop of this.stops) {
        const key = this.entryKey(stop, productId);
        if (!(key in this.entryDisplay)) continue;
        const qty_ctn = this.rawQtyCtn(stop, productId);
        const val = newUnit === 'PCS' ? qty_ctn * qtyPerCtn : qty_ctn;
        this.entryDisplay[key] = String(round2(val));
      }
    },
    toggleRowUnit(productId) {
      const current = this.entryUnitFor(this.productOf(productId));
      this.applyRowUnit(productId, current === 'PCS' ? 'CTN' : 'PCS');
    },

    addProductRow() {
      if (!this.newRowProductId) return;
      if (this.columnProductIds.has(this.newRowProductId) || this.matrixProductRows.some(p => p.id === this.newRowProductId)) {
        this.$nextTick(() => { this.newRowProductId = null; });
        return;
      }
      const p = this.products.find(x => x.id === this.newRowProductId);
      if (!p) return;
      this.matrixProductRows.push(p);
      this.matrixProductRows.sort((a, b) => a.name.localeCompare(b.name));
      this.rowPacking[p.id] = p.packing_type || 'carton';
      this.rowUnit[p.id] = p.entry_unit === 'PCS' ? 'PCS' : 'CTN';
      // Deferred to the next tick: resetting this in the same reactive flush that detected
      // it becoming non-null would make the null → id → null transition invisible to
      // ProductPicker's own modelValue watcher (Vue only sees the net "no change"), so its
      // query text would never actually clear even though the row gets added correctly.
      this.$nextTick(() => { this.newRowProductId = null; });
    },
    // Enter confirms whatever the picker currently resolves to and clears the field, so
    // someone can keep typing the next product name straight away without touching the
    // mouse. In the common case the product's already been added by the watcher above the
    // moment an exact match was typed, so this is a harmless no-op by the time Enter lands.
    onEnterAddProduct() {
      if (this.newRowProductId) this.addProductRow();
    },
    removeProductRow(productId) {
      const hasValues = this.stops.some(s => (s.round_items || []).some(r => r.product_id === productId));
      if (hasValues) { alert('Clear every quantity in this row before removing it.'); return; }
      this.matrixProductRows = this.matrixProductRows.filter(p => p.id !== productId);
      delete this.rowPacking[productId];
      delete this.rowUnit[productId];
    },
  },
  template: `
  <div class="panel mx-print-look" style="overflow-x:auto;">
    <table class="mx-main">
      <thead>
        <tr class="mx-group">
          <th :colspan="leadColspan"></th>
          <th :colspan="columns.length || 1">ROUND ITEMS</th>
          <th class="mx-group-prepicked" :colspan="prePickedColspan">PRE PICKED</th>
          <th class="mx-group-ri" :colspan="riColspan">RI</th>
          <th :colspan="tailColspan"></th>
        </tr>
        <tr>
          <th style="width:26px;">S.N</th><th style="width:90px;">Invoice</th><th style="width:90px;">S.Order</th>
          <th style="min-width:150px;">Customer</th><th style="width:100px;">Taken By</th>
          <th style="min-width:120px;">Note</th>
          <th v-for="c in columns" :key="c.product_id" style="width:70px;">
            {{ c.code }}<span class="mx-pack">{{ c.unit==='PCS' ? 'pcs' : 'ctn' }} &middot; &times;{{ c.qty }}/ctn</span>
          </th>
          <th v-if="!columns.length" style="width:64px;">&mdash;</th>
          <th class="mx-col-prepicked" style="width:56px;">Carton</th>
          <th class="mx-col-prepicked" style="width:56px;">Bag</th>
          <th class="mx-col-ri" style="width:56px;">Carton</th>
          <th class="mx-col-ri" style="width:56px;">Bag</th>
          <th style="width:56px;">TOTAL<span class="mx-pack">PKGS</span></th>
          <th style="width:70px;"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(stop, i) in stops" :key="stop._uid">
          <td class="center mono">{{ i+1 }}</td>
          <td><input type="text" v-model="stop.invoice_no" @input="stop._invoiceNeedsInput=false"
              :style="stop._invoiceNeedsInput && !stop.invoice_no ? 'border-color:var(--bad);background:var(--bad-soft)' : ''" /></td>
          <td><input type="text" v-model="stop.so_no" /></td>
          <td><input type="text" v-model="stop.customer" list="mx-customer-list" /></td>
          <td><input type="text" v-model="stop.taken_by" /></td>
          <td><input type="text" v-model="stop.note" /></td>
          <td v-for="c in columns" :key="c.product_id">
            <input type="number" min="0" :step="cellStep(productOf(c.product_id))" :value="cellValue(stop, c.product_id)"
              @input="setCellValue(stop, c.product_id, $event.target.value, columnPackingDefault(c.product_id))" />
          </td>
          <td v-if="!columns.length" class="hint center">&mdash;</td>
          <td><input type="number" min="0" step="1" v-model.number="stop.ctns_carton" /></td>
          <td><input type="number" min="0" step="1" v-model.number="stop.ctns_bag" /></td>
          <td class="center mono mx-cell-ri">{{ riCarton(stop) }}</td>
          <td class="center mono mx-cell-ri">{{ riBag(stop) }}</td>
          <td class="center mono" style="font-weight:600;">{{ rowTotalPkgs(stop) }}</td>
          <td class="center">
            <button class="ghost small" @click="$emit('move-stop', i, 'up')" :disabled="i===0" title="Move up">&uarr;</button>
            <button class="ghost small" @click="$emit('move-stop', i, 'down')" :disabled="i===stops.length-1" title="Move down">&darr;</button>
            <button class="danger small" @click="$emit('remove-stop', i)">&times;</button>
          </td>
        </tr>
      </tbody>
      <tfoot v-if="stops.length">
        <tr>
          <td :colspan="leadColspan" class="hint" style="text-align:right;">Column total (ctn)</td>
          <td v-for="c in columns" :key="c.product_id" class="center mono">{{ columnTotal(c.product_id) }}</td>
          <td v-if="!columns.length"></td>
          <td :colspan="prePickedColspan"></td>
          <td :colspan="riColspan"></td>
          <td :colspan="tailColspan"></td>
        </tr>
      </tfoot>
    </table>

    <div style="margin:10px 0;">
      <button @click="$emit('add-stop')" :disabled="atLimit">+ Add stop</button>
    </div>

    <datalist id="mx-customer-list">
      <option v-for="c in customers" :key="c.id" :value="c.name" />
    </datalist>

    <div class="empty" v-if="!stops.length">No stops yet &mdash; click "+ Add stop" above.</div>

    <h2 class="mx-section-title">All Round Items &mdash; enter by invoice</h2>
    <table class="mx-allround" v-if="stops.length">
      <thead>
        <tr>
          <th style="text-align:left;min-width:170px;">Product</th>
          <th style="width:56px;">Unit</th>
          <th v-for="(stop, i) in stops" :key="stop._uid" class="mx-inv-head">
            <div><span class="mx-sn">{{ i+1 }}&middot;</span>{{ stop.invoice_no || '—' }}</div>
          </th>
          <th style="width:52px;">Q/C</th>
          <th style="width:34px;"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in matrixProductRows" :key="row.id">
          <td class="mx-rowlabel">
            <div class="mx-rowlabel-inner">
              <span class="mx-rowlabel-name">{{ row.name }}</span>
              <button type="button" class="mx-pack-btn" :class="rowPacking[row.id]==='bag' ? 'mx-pack-bag' : 'mx-pack-carton'"
                @click="toggleRowPacking(row.id)" :title="'Packing: ' + packLabel(row.id) + ' — click to switch'">{{ packLabel(row.id) }}</button>
            </div>
          </td>
          <td class="mx-unit-cell">
            <button type="button" class="mx-unit-btn"
              :class="entryUnitFor(row)==='PCS' ? 'mx-unit-pcs' : (rowPacking[row.id]==='bag' ? 'mx-unit-bag' : 'mx-unit-carton')"
              @click="toggleRowUnit(row.id)" :title="'Entry unit — click to switch'">{{ entryUnitFor(row)==='PCS' ? 'Pcs' : packLabel(row.id) }}</button>
          </td>
          <td v-for="stop in stops" :key="stop._uid+'-'+row.id">
            <input type="number" min="0" :step="cellStep(row)" :value="cellValue(stop, row.id)"
              @input="setCellValue(stop, row.id, $event.target.value, rowPacking[row.id])" />
          </td>
          <td class="center mono">{{ row.qty_per_ctn }}</td>
          <td class="center"><button class="ghost small" @click="removeProductRow(row.id)" title="Remove row">&times;</button></td>
        </tr>
        <tr>
          <td class="mx-rowlabel" style="padding:4px 6px;">
            <ProductPicker :products="addableProducts" v-model="newRowProductId" placeholder="Add product…" @keyup.enter="onEnterAddProduct" />
          </td>
          <td :colspan="stops.length + 3" class="hint" style="text-align:left;">
            {{ matrixProductRows.length ? '' : 'No round-item rows yet — pick a product to add one.' }}
          </td>
        </tr>
      </tbody>
      <tfoot v-if="matrixProductRows.length">
        <tr>
          <td colspan="2" class="hint">Column total (ctn)</td>
          <td v-for="stop in stops" :key="stop._uid+'tot'" class="center mono">{{ matrixColTotal(stop) }}</td>
          <td colspan="2"></td>
        </tr>
      </tfoot>
    </table>
  </div>
  `,
};
