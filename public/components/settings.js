import { Api } from '../lib/api.js';
import ProductPicker from './product-picker.js';

export default {
  components: { ProductPicker },
  data() {
    return {
      products: [],
      columns: [], // [{ product_id, code }]
      clerks: [],
      newClerk: '',
      saved: false,
    };
  },
  async mounted() {
    this.products = await Api.get('/api/products');
    const cols = await Api.get('/api/settings/frequent-columns');
    this.columns = cols.length ? cols : [];
    this.clerks = await Api.get('/api/settings/clerks');
  },
  methods: {
    productById(id) { return this.products.find(p => p.id === id); },
    addColumn() {
      if (this.columns.length >= 10) return;
      this.columns.push({ product_id: null, code: '' });
    },
    removeColumn(i) { this.columns.splice(i, 1); },
    async saveColumns() {
      await Api.put('/api/settings/frequent-columns', { columns: this.columns });
      this.saved = true;
      setTimeout(() => (this.saved = false), 1500);
    },
    // Packing type lives on the product itself (so it stays in sync everywhere the product
    // is used, not just here) — this writes straight through to /api/products/:id.
    async setPackingType(productId, packing_type) {
      const p = this.productById(productId);
      if (!p) return;
      await Api.put(`/api/products/${productId}`, { ...p, packing_type });
      p.packing_type = packing_type;
    },
    // Same idea for entry unit — how this product's round-item quantity is normally counted.
    async setEntryUnit(productId, entry_unit) {
      const p = this.productById(productId);
      if (!p) return;
      await Api.put(`/api/products/${productId}`, { ...p, entry_unit });
      p.entry_unit = entry_unit;
    },
    async removeClerk(name) {
      const next = this.clerks.filter(c => c !== name);
      await Api.put('/api/settings/clerks', { names: next });
      this.clerks = next;
    },
    async addClerk() {
      const name = this.newClerk.trim();
      if (!name) return;
      const next = [...new Set([...this.clerks, name])];
      await Api.put('/api/settings/clerks', { names: next });
      this.clerks = next;
      this.newClerk = '';
    },
  },
  template: `
  <div class="page-head">
    <div><h1>Settings</h1><div class="sub">Frequent round-item columns and the clerk name list.</div></div>
  </div>

  <div class="panel">
    <h2 style="margin-top:0;font-size:15px;">Frequent round-item columns
      <span class="hint">(up to 10 &mdash; any product can be a round item on a stop; these are just the ones that get their own column at the top of the printed sheet instead of falling into the All Round Items matrix)</span></h2>
    <p class="hint" v-if="!products.length">No products yet. Add or import some on the Products page first.</p>
    <div v-for="(col, i) in columns" :key="i" class="field-row" style="align-items:flex-end;margin-bottom:10px;">
      <div class="field" style="flex:2;">
        <label>Product</label>
        <ProductPicker :products="products" v-model="col.product_id" placeholder="Search any product…" />
        <div class="hint" v-if="productById(col.product_id)">qty/ctn: {{ productById(col.product_id).qty_per_ctn }}</div>
      </div>
      <div class="field" style="flex:1;">
        <label>Column code (short name shown on the sheet)</label>
        <input type="text" v-model="col.code" placeholder="e.g. OG 5K" />
      </div>
      <div class="field" style="flex:none;width:130px;" v-if="productById(col.product_id)">
        <label>Packing <span class="hint">(billing only)</span></label>
        <select :value="productById(col.product_id).packing_type || 'carton'" @change="setPackingType(col.product_id, $event.target.value)">
          <option value="carton">Carton</option>
          <option value="bag">Bag</option>
        </select>
      </div>
      <div class="field" style="flex:none;width:120px;" v-if="productById(col.product_id)">
        <label>Entry unit</label>
        <select :value="productById(col.product_id).entry_unit || 'CTN'" @change="setEntryUnit(col.product_id, $event.target.value)">
          <option value="CTN">Cartons</option>
          <option value="PCS">Pieces</option>
        </select>
      </div>
      <div class="field" style="flex:none;">
        <button class="danger" @click="removeColumn(i)">Remove</button>
      </div>
    </div>
    <button @click="addColumn" :disabled="columns.length >= 10">+ Add column ({{ columns.length }}/10)</button>
    <div class="modal-actions" style="justify-content:flex-start;margin-top:14px;">
      <button class="primary" @click="saveColumns">Save columns</button>
      <span class="hint" v-if="saved" style="color:var(--good)">Saved.</span>
    </div>
    <p class="hint" style="margin-top:10px;">Packing (Carton vs Bag) is only used to tell delivery cost apart, since 3rd-party
      vendors charge differently for each — it never changes any carton/package counts on the sheet. Entry unit (Cartons vs
      Pieces) just controls what unit the round-item quantity field defaults to and displays as for this product &mdash; it's
      always stored as cartons either way. Both are properties of the product itself, so setting them here updates them
      everywhere, including any other sheet that uses the same product. You can also set them on the Products page.</p>
  </div>

  <div class="panel">
    <h2 style="margin-top:0;font-size:15px;">Clerk names</h2>
    <p class="hint">Names offered on the login/switch-user screen so runsheets record who built them.</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
      <span v-for="c in clerks" :key="c" class="ri-chip">{{ c }} <button @click="removeClerk(c)">&times;</button></span>
      <span v-if="!clerks.length" class="hint">No clerks added yet.</span>
    </div>
    <div style="display:flex;gap:8px;max-width:340px;">
      <input type="text" v-model="newClerk" @keyup.enter="addClerk" placeholder="Add a clerk name" />
      <button class="primary" @click="addClerk">Add</button>
    </div>
  </div>
  `,
};
