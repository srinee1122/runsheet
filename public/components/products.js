import { Api, parseSpreadsheetFile } from '../lib/api.js';

const BLANK_PRODUCT = () => ({
  name: '', code: '', supplier: '', brand: '', category: '', sub_category: '', sub_category_2: '',
  base_unit: '', group_name: '', item_type: '', qty_per_ctn: 1, selling_rate: 0, is_round_item: false,
  packing_type: 'carton', entry_unit: 'CTN',
});

export default {
  data() {
    return {
      products: [],
      editing: null, // product object being edited, or null
      showModal: false,
      form: BLANK_PRODUCT(),
      importFile: null,
      importText: '',
      showImport: false,
      importResult: null,
      importError: '',
      error: '',
      search: '',
    };
  },
  computed: {
    filtered() {
      const q = this.search.trim().toLowerCase();
      if (!q) return this.products;
      return this.products.filter(p => [
        p.name, p.code, p.supplier, p.brand, p.category, p.sub_category, p.sub_category_2,
        p.group_name, p.item_type, p.qty_per_ctn, p.selling_rate,
      ].some(v => String(v ?? '').toLowerCase().includes(q)));
    },
  },
  async mounted() { await this.load(); },
  methods: {
    async load() { this.products = await Api.get('/api/products'); },
    openNew() {
      this.editing = null;
      this.form = BLANK_PRODUCT();
      this.error = '';
      this.showModal = true;
    },
    openEdit(p) {
      this.editing = p;
      this.form = { ...BLANK_PRODUCT(), ...p };
      this.error = '';
      this.showModal = true;
    },
    async save() {
      this.error = '';
      try {
        if (this.editing) await Api.put(`/api/products/${this.editing.id}`, this.form);
        else await Api.post('/api/products', this.form);
        this.showModal = false;
        await this.load();
      } catch (e) { this.error = e.message; }
    },
    async remove(p) {
      if (!confirm(`Delete product "${p.name}"? This cannot be undone.`)) return;
      await Api.del(`/api/products/${p.id}`);
      await this.load();
    },
    handleFile(ev) {
      this.importFile = ev.target.files[0] || null;
      this.importText = '';
      this.importError = '';
    },
    async runImport() {
      this.importError = '';
      this.importResult = null;
      try {
        if (this.importFile) {
          const name = this.importFile.name.toLowerCase();
          if (name.endsWith('.csv')) {
            const text = await this.importFile.text();
            this.importResult = await Api.post('/api/products/import', { csv: text });
          } else {
            const rows = await parseSpreadsheetFile(this.importFile);
            this.importResult = await Api.post('/api/products/import', { rows });
          }
        } else if (this.importText.trim()) {
          this.importResult = await Api.post('/api/products/import', { csv: this.importText });
        } else {
          return;
        }
        await this.load();
      } catch (e) {
        this.importError = e.message;
      }
    },
  },
  template: `
  <div class="page-head">
    <div>
      <h1>Products</h1>
      <div class="sub">Item Master reference data + the app's own round-item flag. {{ products.length }} product(s).</div>
    </div>
    <div class="toolbar">
      <input type="text" v-model="search" placeholder="Search name, code, brand, category..." style="width:260px" />
      <button @click="showImport = true">Import Item Master</button>
      <button class="primary" @click="openNew">+ Add product</button>
    </div>
  </div>

  <div class="panel">
    <table>
      <thead><tr>
        <th>Name</th><th>Code</th><th>Supplier</th><th>Brand</th><th>Category</th>
        <th>Sub-cat</th><th>Sub-cat 2</th><th>Base unit</th><th>Group</th><th>Item type</th>
        <th class="right">Qty/Ctn</th><th class="right">Rate</th><th class="center">Packing</th>
        <th class="center">Entry unit</th><th class="center">Regular?</th><th></th>
      </tr></thead>
      <tbody>
        <tr v-for="p in filtered" :key="p.id">
          <td>{{ p.name }}</td>
          <td class="mono">{{ p.code }}</td>
          <td>{{ p.supplier }}</td>
          <td>{{ p.brand }}</td>
          <td>{{ p.category }}</td>
          <td>{{ p.sub_category }}</td>
          <td>{{ p.sub_category_2 }}</td>
          <td>{{ p.base_unit }}</td>
          <td>{{ p.group_name }}</td>
          <td>{{ p.item_type }}</td>
          <td class="right mono">{{ p.qty_per_ctn }}</td>
          <td class="right mono">{{ p.selling_rate }}</td>
          <td class="center"><span class="badge" :class="p.packing_type === 'bag' ? 'warn' : 'ok'">{{ p.packing_type === 'bag' ? 'BAG' : 'CARTON' }}</span></td>
          <td class="center"><span class="badge" :class="p.entry_unit === 'PCS' ? 'warn' : 'ok'">{{ p.entry_unit === 'PCS' ? 'PIECES' : 'CARTONS' }}</span></td>
          <td class="center"><span class="badge round" v-if="p.is_round_item">REGULAR</span></td>
          <td class="right">
            <button class="small" @click="openEdit(p)">Edit</button>
            <button class="small danger" @click="remove(p)">Delete</button>
          </td>
        </tr>
        <tr v-if="!filtered.length"><td colspan="16" class="empty">No products yet. Add one or import the Item Master.</td></tr>
      </tbody>
    </table>
  </div>

  <div class="overlay" v-if="showModal">
    <div class="modal" style="max-width:640px;">
      <h2>{{ editing ? 'Edit product' : 'Add product' }}</h2>
      <div class="field"><label>Product name</label><input type="text" v-model="form.name" /></div>
      <div class="field-row">
        <div class="field"><label>Code</label><input type="text" v-model="form.code" /></div>
        <div class="field"><label>Supplier</label><input type="text" v-model="form.supplier" /></div>
        <div class="field"><label>Brand</label><input type="text" v-model="form.brand" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Category</label><input type="text" v-model="form.category" /></div>
        <div class="field"><label>Sub-category</label><input type="text" v-model="form.sub_category" /></div>
        <div class="field"><label>Sub-category 2</label><input type="text" v-model="form.sub_category_2" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Base unit</label><input type="text" v-model="form.base_unit" /></div>
        <div class="field"><label>Group</label><input type="text" v-model="form.group_name" /></div>
        <div class="field"><label>Item type</label><input type="text" v-model="form.item_type" /></div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Qty / Ctn <span class="hint">(used for round-item math when this product is added as a round item)</span></label>
          <input type="number" min="1" step="1" v-model.number="form.qty_per_ctn" />
        </div>
        <div class="field"><label>Selling rate</label><input type="number" step="0.01" v-model.number="form.selling_rate" /></div>
        <div class="field">
          <label>Packing <span class="hint">(billing classification only)</span></label>
          <select v-model="form.packing_type"><option value="carton">Carton</option><option value="bag">Bag</option></select>
        </div>
      </div>
      <div class="field">
        <label>Entry unit <span class="hint">(how this product's round-item quantity is normally counted)</span></label>
        <select v-model="form.entry_unit" style="max-width:220px;">
          <option value="CTN">Cartons</option>
          <option value="PCS">Pieces</option>
        </select>
      </div>
      <div class="field">
        <label style="display:flex;align-items:center;gap:8px;font-weight:500;margin:0;">
          <input type="checkbox" v-model="form.is_round_item" style="width:auto;" /> Regular round item
        </label>
      </div>
      <p class="hint" style="margin-top:-4px;">Regular round items show up in a short dropdown when adding round items to a stop, so the common ones are quick to pick. Any product can still be added as a round item either way — this just makes the frequent ones faster to find. Packing (carton vs bag) is only used to tell delivery cost apart, since 3rd-party vendors charge differently for each — it doesn't change any of the carton/package counts on the sheet.</p>
      <div class="hint" style="color:var(--bad)" v-if="error">{{ error }}</div>
      <div class="modal-actions">
        <button @click="showModal=false">Cancel</button>
        <button class="primary" @click="save">Save</button>
      </div>
    </div>
  </div>

  <div class="overlay" v-if="showImport">
    <div class="modal">
      <h2>Import Item Master</h2>
      <p class="hint">Upload the Item Master directly as <b>.xlsx</b> (or a <b>.csv</b>) &mdash; columns
        are matched by name (Name, Code, Supplier, Brand, Category, Sub-category, Sub-category 2, Base unit,
        Group, Item type, Qty/Ctn, Selling rate). Re-importing an existing name updates its reference data
        but never touches the round-item flag you've set in the app.</p>
      <div class="field"><input type="file" accept=".xlsx,.xls,.csv" @change="handleFile" /></div>
      <div class="field" v-if="!importFile">
        <label>...or paste CSV text</label>
        <textarea rows="6" v-model="importText" placeholder="name,code,supplier,brand,category,sub_category,sub_category_2,base_unit,group_name,item_type,qty_per_ctn,selling_rate"></textarea>
      </div>
      <div class="hint" v-if="importResult" style="color:var(--good)">Imported / updated {{ importResult.imported }} product(s).</div>
      <div class="hint" v-if="importError" style="color:var(--bad)">{{ importError }}</div>
      <div class="modal-actions">
        <button @click="showImport=false; importResult=null; importFile=null; importText=''">Close</button>
        <button class="primary" @click="runImport">Import</button>
      </div>
    </div>
  </div>
  `,
};
