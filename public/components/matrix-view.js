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
  emits: ['add-stop', 'remove-stop', 'move-stop', 'reorder-stop'],
  data() {
    return {
      matrixProductRows: [], // "All Round Items" rows — products NOT set up as a preset column
      rowPacking: {},        // product_id -> 'carton' | 'bag', toggled per row, applied to new AND existing quantities in that row
      rowUnit: {},           // product_id -> 'CTN' | 'PCS', toggled per row — overrides the product's own entry-unit default just for this row
      rowPickerResetSeq: {}, // product_id -> counter, bumped to force a row's product-picker to redisplay its actual current product after a rejected change
      newRowProductId: null,
      // `${stop._uid}-${productId}` -> the value exactly as typed/displayed, in that
      // product's own entry unit. Seeded once from the stored cartons figure (rounded
      // for entry-unit display), then only ever written from what the person actually
      // types — never recomputed by converting the stored value back and forth, which
      // would visibly reformat or drift from what they typed whenever qty/ctn doesn't
      // divide evenly. The canonical qty_ctn (used for every total) is kept in sync
      // alongside it, but the two are independent once a cell has been edited.
      entryDisplay: {},
      draggingRowIndex: null,  // stop currently being dragged, via the S.N grip handle
      dragOverRowIndex: null,  // stop currently being dragged over, for the drop-position indicator
    };
  },
  computed: {
    // up to 15 preset columns, resolved against the current product list — same routing
    // print.js uses, so a product's spot here always matches where it'll print
    columns() {
      return (this.frequentColumns || []).filter(c => c.product_id).slice(0, 15).map(c => {
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
    // colspan for the group header's leading block — S.N, Invoice, S.Order, Customer,
    // Taken By. Pre Picked sits right after Taken By (not at the end) since it's filled
    // in on almost every stop — keeping it close cuts how far Tab has to travel.
    leadColspan() { return 5; },
    // "Pre picked" group: CTNS Carton + Bag
    prePickedColspan() { return 2; },
    // Note sits alone between Pre Picked and the preset Round Items columns
    noteColspan() { return 1; },
    // "RI" group: Carton + Bag
    riColspan() { return 2; },
    // trailing ungrouped block: TOTAL, Actions
    tailColspan() { return 2; },
    // Both tables use table-layout:fixed with width:100%, so columns fill whatever space
    // is available and shrink together as more get added — exactly what lets the sheet
    // stay on one screen without horizontal scroll for a typical column count. This is the
    // floor: below it, columns would be too narrow to use (a number you can't read isn't
    // useful), so the table stops shrinking here and the page scrolls horizontally instead
    // — a graceful fallback for extreme cases (many preset columns on a narrow window),
    // not what happens in ordinary use.
    mainTableMinWidth() {
      const fixed = 24 + 62 + 56 + 100 + 66 + 74 + 42 + 42 + 42 + 42 + 46 + 62; // metadata + CTNS + RI + Total + Actions
      const presetCount = Math.max(this.columns.length, 1);
      return fixed + presetCount * 50;
    },
    allroundTableMinWidth() {
      const fixed = 140 + 46 + 38 + 28; // Product + Unit + Q/C + Remove
      const stopCount = Math.max(this.stops.length, 1);
      return fixed + stopCount * 36;
    },
  },
  watch: {
    // selecting a product in the "add a product" field adds it right away — no separate
    // button to click. addProductRow() itself resets newRowProductId back to null once
    // it's done, which also clears the picker's visible text (see ProductPicker's own
    // modelValue watcher), so the field is immediately ready for the next product.
    newRowProductId(val) { if (val) this.addProductRow(); },
    // BuilderPage renders this component immediately, before its own mounted() hook has
    // actually fetched the runsheet — so the FIRST time this watcher would matter, stops
    // arrives here as [] and only gets its real content a moment later, once BuilderPage's
    // fetch resolves and reassigns it wholesale (a new array reference, which is exactly
    // what this watcher is keyed on). Without this, reopening an existing saved sheet with
    // round items already on it showed "No round-item rows yet" and blank quantity cells —
    // rebuildMatrixRows() and seedEntryDisplay() had already run once in created(), against
    // the empty initial stops, and nothing ever told them to run again for the real data.
    // Building a brand-new sheet from scratch never hit this, since adding a product there
    // goes through addProductRow() directly, not through this initial build path — which is
    // why this went unnoticed until testing against a reloaded, already-saved sheet.
    stops() {
      this.rebuildMatrixRows();
      this.seedEntryDisplay();
    },
  },
  created() {
    this.rebuildMatrixRows();
    this.seedEntryDisplay();
  },
  methods: {
    round2,
    productOf(id) { return this.products.find(p => p.id === id); },
    // Finds the actual stored round_item for a product on any stop — used to seed the
    // packing/unit toggle buttons from what THIS runsheet actually has saved, rather than
    // the product's current Settings default, which could easily differ from whatever was
    // toggled during this specific sheet's own building session.
    storedRoundItemFor(productId) {
      for (const s of this.stops) {
        const ri = (s.round_items || []).find(r => r.product_id === productId);
        if (ri) return ri;
      }
      return null;
    },
    rebuildMatrixRows() {
      const ids = new Set();
      for (const p of this.products) if (p.is_round_item && !this.columnProductIds.has(p.id)) ids.add(p.id);
      for (const s of this.stops) for (const ri of s.round_items || []) if (!this.columnProductIds.has(ri.product_id)) ids.add(ri.product_id);
      this.matrixProductRows = [...ids].map(id => this.products.find(p => p.id === id)).filter(Boolean)
        .sort((a, b) => a.id - b.id);
      for (const p of this.matrixProductRows) {
        const stored = this.storedRoundItemFor(p.id);
        if (!(p.id in this.rowPacking)) this.rowPacking[p.id] = (stored && stored.packing_type) || p.packing_type || 'carton';
        if (!(p.id in this.rowUnit)) this.rowUnit[p.id] = (stored && stored.entry_unit) || (p.entry_unit === 'PCS' ? 'PCS' : 'CTN');
      }
    },

    // Kept as the exact decimal sum, not rounded up — a fractional RI is usually a sign
    // of a wrong entry somewhere (a stray decimal, a mistyped quantity), and rounding it
    // away would hide exactly the thing a clerk needs to notice and fix. The printed
    // sheet still rounds each product up to a whole carton (cartons have to be whole on
    // the actual load), so this figure and the printed one can differ by a little — that
    // gap is expected, not a bug.
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
      if (idx >= 0) {
        stop.round_items[idx].qty_ctn = round2(qty_ctn);
        stop.round_items[idx].entry_unit = this.entryUnitFor(p);
      } else stop.round_items.push({ product_id: productId, qty_ctn: round2(qty_ctn), packing_type: packingDefault || 'carton', entry_unit: this.entryUnitFor(p) });
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
    // Per-stop total across just the All Round Items section's products — kept as the
    // exact decimal sum, same reasoning as rowRI above: a fraction here is a useful
    // signal that something was mistyped, not something to smooth away.
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
    // which would silently mean a completely different quantity. Also persists the unit
    // onto every existing round_item for this product, same as setRowPacking does for
    // packing_type — without this, the toggle was purely in-memory and print (which loads
    // fresh from what's actually saved) had no way to know it had ever been switched.
    applyRowUnit(productId, newUnit) {
      this.rowUnit[productId] = newUnit;
      const p = this.productOf(productId);
      const qtyPerCtn = (p && p.qty_per_ctn) || 1;
      for (const stop of this.stops) {
        const key = this.entryKey(stop, productId);
        const ri = (stop.round_items || []).find(r => r.product_id === productId);
        if (ri) ri.entry_unit = newUnit;
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
      delete this.rowPickerResetSeq[productId];
    },
    // Products this row's picker can offer — everything not already used elsewhere on the
    // sheet, PLUS the row's own current product (so its name still displays correctly and
    // re-selecting it, or just seeing what it currently is, works).
    // Products this row's picker can offer — everything not already used elsewhere on the
    // sheet, PLUS the row's own current product (so its name still displays correctly and
    // re-selecting it, or just seeing what it currently is, works).
    productsForRow(currentProductId) {
      const usedIds = new Set([...this.columnProductIds, ...this.matrixProductRows.map(p => p.id)]);
      usedIds.delete(currentProductId);
      return this.products.filter(p => !usedIds.has(p.id));
    },
    // Forces the row's ProductPicker to remount, which re-syncs its displayed text from
    // the (unchanged) current product — used after a rejected change, since ProductPicker
    // only re-reads its modelValue when that prop actually changes; if a change is
    // rejected nothing changes, so without this the rejected text would sit there
    // unconfirmed, looking like the row changed when it didn't.
    bumpRowPickerReset(productId) {
      this.rowPickerResetSeq = { ...this.rowPickerResetSeq, [productId]: (this.rowPickerResetSeq[productId] || 0) + 1 };
    },
    // Fixes a mis-picked product without losing what's already been entered: re-tags every
    // quantity typed in for the old product (across all stops) to the new one, carries the
    // row's current packing/unit settings over, and swaps the row's product reference.
    changeRowProduct(oldProductId, newProductId) {
      if (newProductId === oldProductId) return; // re-typed/re-picked the same thing — nothing to do
      const isValidSelection = newProductId
        && !this.columnProductIds.has(newProductId)
        && !this.matrixProductRows.some(p => p.id === newProductId);
      const newProduct = isValidSelection ? this.products.find(p => p.id === newProductId) : null;
      if (!newProduct) {
        // no exact match was typed, or (shouldn't normally happen — productsForRow already
        // excludes them) a duplicate slipped through — redisplay the row's actual product
        this.bumpRowPickerReset(oldProductId);
        return;
      }
      for (const stop of this.stops) {
        const ri = (stop.round_items || []).find(r => r.product_id === oldProductId);
        if (ri) ri.product_id = newProductId;
      }
      for (const stop of this.stops) {
        const oldKey = this.entryKey(stop, oldProductId);
        const newKey = this.entryKey(stop, newProductId);
        if (oldKey in this.entryDisplay) {
          this.entryDisplay[newKey] = this.entryDisplay[oldKey];
          delete this.entryDisplay[oldKey];
        }
      }
      this.rowPacking[newProductId] = this.rowPacking[oldProductId];
      this.rowUnit[newProductId] = this.rowUnit[oldProductId];
      delete this.rowPacking[oldProductId];
      delete this.rowUnit[oldProductId];
      const idx = this.matrixProductRows.findIndex(p => p.id === oldProductId);
      if (idx >= 0) {
        this.matrixProductRows.splice(idx, 1, newProduct);
      }
    },
    // Enter always jumps to the Product field of the next row, no matter which column you
    // press it from — same idea as Sales Order in the main table, just here it's the
    // Product picker since that's the natural starting point for a product row.
    handleAllRoundEnterKey(event) {
      const row = event.target.closest('tr');
      const tbody = row && row.closest('tbody');
      if (!row || !tbody) return;
      const rows = Array.from(tbody.children);
      const rowIndex = rows.indexOf(row);
      const nextRow = rows[rowIndex + 1];
      const field = nextRow && nextRow.querySelector('input, select, textarea');
      if (field) { field.focus(); if (field.select) field.select(); }
    },
    handleAllRoundKeyNav(event) {
      if (event.key === 'Enter') { event.preventDefault(); this.handleAllRoundEnterKey(event); return; }
      this.handleArrowNav(event);
    },
    // Moves focus into the row after `row`, picking the target field with `pickField` —
    // adds a new stop first if `row` is the last one, so both Enter behaviors below can
    // keep entering stop after stop without ever reaching for "+ Add stop".
    goToNextRow(row, tbody, pickField) {
      const rows = Array.from(tbody.children);
      const nextRow = rows[rows.indexOf(row) + 1];
      const focus = (targetRow) => {
        const field = targetRow && pickField(targetRow);
        if (field) { field.focus(); if (field.select) field.select(); }
      };
      if (nextRow) {
        focus(nextRow);
      } else if (!this.atLimit) {
        this.$emit('add-stop');
        this.$nextTick(() => {
          const updatedRows = Array.from(tbody.children);
          focus(updatedRows[updatedRows.length - 1]);
        });
      }
    },
    // Drag-and-drop row reordering — dragging only starts from the S.N grip handle (not
    // the row itself), so clicking or dragging inside any input never gets mistaken for a
    // row drag. Dropping works anywhere on the target row, not just its handle.
    onRowDragStart(event, index) {
      this.draggingRowIndex = index;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index)); // required by some browsers to allow the drag
    },
    onRowDragEnter(index) {
      if (this.draggingRowIndex === null || this.draggingRowIndex === index) return;
      this.dragOverRowIndex = index;
    },
    onRowDragLeave(index) {
      if (this.dragOverRowIndex === index) this.dragOverRowIndex = null;
    },
    onRowDrop(index) {
      if (this.draggingRowIndex !== null && this.draggingRowIndex !== index) {
        this.$emit('reorder-stop', this.draggingRowIndex, index);
      }
      this.draggingRowIndex = null;
      this.dragOverRowIndex = null;
    },
    onRowDragEnd() {
      this.draggingRowIndex = null;
      this.dragOverRowIndex = null;
    },

    // it stays in Invoice and moves down — invoice numbers are usually filled in last, as
    // a pass straight down that one column, once every stop's other details are in. From
    // anywhere else, it jumps to Sales Order of the next row, since that's usually known
    // up front (the invoice number often isn't yet) and is where a row typically starts.
    handleEnterKey(event) {
      const cell = event.target.closest('td');
      const row = cell && cell.closest('tr');
      const tbody = row && row.closest('tbody');
      if (!cell || !row || !tbody) return;
      if (event.target.classList.contains('mx-invoice-field')) {
        const cellIndex = Array.from(row.children).indexOf(cell);
        this.goToNextRow(row, tbody, (targetRow) => targetRow.children[cellIndex] && targetRow.children[cellIndex].querySelector('input, select, textarea'));
        return;
      }
      this.goToNextRow(row, tbody, (targetRow) => targetRow.querySelector('.mx-focus-start') || targetRow.querySelector('input, select, textarea'));
    },
    // Single entry point for the main table's grid cells — Tab/Shift+Tab already work
    // natively (DOM order), this adds Enter (jump to next row's Sales Order — see above)
    // and all four arrow keys.
    handleKeyNav(event) {
      if (event.key === 'Enter') { event.preventDefault(); this.handleEnterKey(event); return; }
      this.handleArrowNav(event);
    },
    // Arrow-key-only dispatcher — used by the All Round Items grid too, where rows are
    // products rather than stops, so Enter's "jump to next stop's Sales Order" doesn't apply.
    handleArrowNav(event) {
      switch (event.key) {
        case 'ArrowUp': this.handleVerticalNav(event, -1); break;
        case 'ArrowDown': this.handleVerticalNav(event, 1); break;
        case 'ArrowLeft': this.handleHorizontalNav(event, -1); break;
        case 'ArrowRight': this.handleHorizontalNav(event, 1); break;
      }
    },
    // Up/Down move to the same column in the previous/next row — safe to take over
    // unconditionally, since arrow-up/down has no native meaning in a single-line text
    // input. It does have a native meaning in a number input though (increment/decrement),
    // which is exactly what we're overriding — so preventDefault() has to run regardless
    // of whether a target field is actually found, not just on a successful navigation.
    // Skipping it at the table's top/bottom edge (or a row that happens to lack a field
    // in this exact column, like the All Round Items grid's "add product" row) was
    // exactly what let quantities silently increment/decrement while navigating.
    handleVerticalNav(event, direction) {
      event.preventDefault();
      const cell = event.target.closest('td');
      const row = cell && cell.closest('tr');
      const tbody = row && row.closest('tbody');
      if (!cell || !row || !tbody) return;
      const cellIndex = Array.from(row.children).indexOf(cell);
      const rows = Array.from(tbody.children);
      const rowIndex = rows.indexOf(row);
      const targetRow = rows[rowIndex + direction];
      if (!targetRow) return; // top/bottom edge — nothing to do
      const field = targetRow.children[cellIndex] && targetRow.children[cellIndex].querySelector('input, select, textarea');
      if (field) { field.focus(); if (field.select) field.select(); }
    },
    // Left/Right move to the previous/next editable field in the row — but only when the
    // cursor is already at that edge of the current text (or the field has no text-cursor
    // concept, e.g. type=number, which doesn't support text selection at all and can throw
    // just reading these properties in some browsers — caught below), so normal in-field
    // cursor movement while editing is never interrupted. Skips over read-only cells, and
    // wraps to the adjacent row's first/last field at the end of a row, matching Tab.
    handleHorizontalNav(event, direction) {
      const input = event.target;
      let hasSelection = false, atEdge = true;
      try {
        if (typeof input.selectionStart === 'number' && typeof input.selectionEnd === 'number') {
          hasSelection = true;
          atEdge = direction < 0
            ? (input.selectionStart === 0 && input.selectionEnd === 0)
            : (input.selectionStart === input.value.length && input.selectionEnd === input.value.length);
        }
      } catch { hasSelection = false; }
      if (hasSelection && !atEdge) return; // let the cursor move within the text as normal
      const cell = input.closest('td');
      const row = cell && cell.closest('tr');
      const tbody = row && row.closest('tbody');
      if (!cell || !row || !tbody) return;
      const cells = Array.from(row.children);
      let idx = cells.indexOf(cell) + direction;
      while (idx >= 0 && idx < cells.length) {
        const field = cells[idx].querySelector('input, select, textarea');
        if (field) { event.preventDefault(); field.focus(); if (field.select) field.select(); return; }
        idx += direction;
      }
      // ran off this row's edge — wrap to the adjacent row's first/last field
      const rows = Array.from(tbody.children);
      const targetRow = rows[rows.indexOf(row) + direction];
      if (!targetRow) return;
      const fields = Array.from(targetRow.children).map(c => c.querySelector('input, select, textarea')).filter(Boolean);
      const field = direction < 0 ? fields[fields.length - 1] : fields[0];
      if (field) { event.preventDefault(); field.focus(); if (field.select) field.select(); }
    },
  },
  template: `
  <div class="panel mx-print-look" style="overflow-x:auto;">
    <table class="mx-main" :style="{minWidth: mainTableMinWidth + 'px'}">
      <thead>
        <tr class="mx-group">
          <th :colspan="leadColspan"></th>
          <th class="mx-group-prepicked" :colspan="prePickedColspan">PRE PICKED</th>
          <th :colspan="noteColspan"></th>
          <th :colspan="columns.length || 1">ROUND ITEMS</th>
          <th class="mx-group-ri" :colspan="riColspan">RI</th>
          <th :colspan="tailColspan"></th>
        </tr>
        <tr>
          <th style="width:24px;">S.N</th><th style="width:62px;">Invoice</th><th style="width:56px;">S.Order</th>
          <th style="width:100px;">Customer</th><th style="width:66px;">Taken By</th>
          <th class="mx-col-prepicked" style="width:42px;">Carton</th>
          <th class="mx-col-prepicked" style="width:42px;">Bag</th>
          <th style="width:74px;">Note</th>
          <th v-for="c in columns" :key="c.product_id">
            {{ c.code }}<span class="mx-pack">{{ c.unit==='PCS' ? 'pcs' : 'ctn' }} &middot; &times;{{ c.qty }}/ctn</span>
          </th>
          <th v-if="!columns.length">&mdash;</th>
          <th class="mx-col-ri" style="width:42px;">Carton</th>
          <th class="mx-col-ri" style="width:42px;">Bag</th>
          <th style="width:46px;">TOTAL<span class="mx-pack">PKGS</span></th>
          <th style="width:62px;"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(stop, i) in stops" :key="stop._uid" class="mx-drag-row mx-stripe-row"
            :class="{ 'mx-dragging': draggingRowIndex===i, 'mx-drag-over': dragOverRowIndex===i }"
            @dragover.prevent @dragenter.prevent="onRowDragEnter(i)" @dragleave="onRowDragLeave(i)" @drop.prevent="onRowDrop(i)">
          <td class="center mono mx-drag-handle" draggable="true" title="Drag to reorder"
              @dragstart="onRowDragStart($event, i)" @dragend="onRowDragEnd">
            <span class="mx-drag-grip">&#8942;&#8942;</span>{{ i+1 }}
          </td>
          <td><input type="text" class="mx-invoice-field" v-model="stop.invoice_no" @input="stop._invoiceNeedsInput=false" @keydown="handleKeyNav($event)"
              :style="stop._invoiceNeedsInput && !stop.invoice_no ? 'border-color:var(--bad);background:var(--bad-soft)' : ''" /></td>
          <td><input type="text" class="mx-focus-start" v-model="stop.so_no" @keydown="handleKeyNav($event)" /></td>
          <td><input type="text" v-model="stop.customer" list="mx-customer-list" @keydown="handleKeyNav($event)" /></td>
          <td><input type="text" v-model="stop.taken_by" @keydown="handleKeyNav($event)" /></td>
          <td><input type="number" min="0" step="1" v-model.number="stop.ctns_carton" @keydown="handleKeyNav($event)" /></td>
          <td><input type="number" min="0" step="1" v-model.number="stop.ctns_bag" @keydown="handleKeyNav($event)" /></td>
          <td><input type="text" v-model="stop.note" @keydown="handleKeyNav($event)" /></td>
          <td v-for="c in columns" :key="c.product_id">
            <input type="number" min="0" :step="cellStep(productOf(c.product_id))" :value="cellValue(stop, c.product_id)"
              @input="setCellValue(stop, c.product_id, $event.target.value, columnPackingDefault(c.product_id))"
              @keydown="handleKeyNav($event)" />
          </td>
          <td v-if="!columns.length" class="hint center">&mdash;</td>
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
          <td :colspan="prePickedColspan"></td>
          <td :colspan="noteColspan"></td>
          <td v-for="c in columns" :key="c.product_id" class="center mono">{{ columnTotal(c.product_id) }}</td>
          <td v-if="!columns.length"></td>
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
    <table class="mx-allround" :style="{minWidth: allroundTableMinWidth + 'px'}" v-if="stops.length">
      <thead>
        <tr>
          <th style="text-align:left;width:140px;">Product</th>
          <th style="width:46px;">Unit</th>
          <th v-for="(stop, i) in stops" :key="stop._uid" class="mx-inv-head mx-tooltip-host">
            <div class="mx-inv-head-rot"><span class="mx-sn">{{ i+1 }}&middot;</span>{{ stop.invoice_no || '—' }}</div>
            <div class="mx-tooltip">Shop: <b>{{ stop.customer || 'not entered yet' }}</b></div>
          </th>
          <th style="width:38px;">Q/C</th>
          <th style="width:28px;"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in matrixProductRows" :key="row.id" class="mx-stripe-row">
          <td class="mx-rowlabel mx-tooltip-host">
            <div class="mx-rowlabel-inner">
              <ProductPicker class="mx-rowlabel-picker" :key="row.id + '-' + (rowPickerResetSeq[row.id] || 0)"
                :products="productsForRow(row.id)" :modelValue="row.id"
                @update:modelValue="changeRowProduct(row.id, $event)" @keydown="handleAllRoundKeyNav($event)" />
              <button type="button" class="mx-pack-btn" :class="rowPacking[row.id]==='bag' ? 'mx-pack-bag' : 'mx-pack-carton'"
                @click="toggleRowPacking(row.id)" :title="'Packing: ' + packLabel(row.id) + ' — click to switch'">{{ packLabel(row.id) }}</button>
            </div>
            <div class="mx-tooltip mx-tooltip-left">Product: <b>{{ row.name }}</b></div>
          </td>
          <td class="mx-unit-cell">
            <button type="button" class="mx-unit-btn"
              :class="entryUnitFor(row)==='PCS' ? 'mx-unit-pcs' : (rowPacking[row.id]==='bag' ? 'mx-unit-bag' : 'mx-unit-carton')"
              @click="toggleRowUnit(row.id)" :title="'Entry unit — click to switch'">{{ entryUnitFor(row)==='PCS' ? 'Pcs' : packLabel(row.id) }}</button>
          </td>
          <td v-for="stop in stops" :key="stop._uid+'-'+row.id" class="mx-tooltip-host-focus">
            <input type="number" min="0" :step="cellStep(row)" :value="cellValue(stop, row.id)"
              @input="setCellValue(stop, row.id, $event.target.value, rowPacking[row.id])"
              @keydown="handleAllRoundKeyNav($event)" />
            <div class="mx-tooltip">
              Product: <b>{{ row.name }}</b><br>Shop: <b>{{ stop.customer || 'not entered yet' }}</b>
            </div>
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
