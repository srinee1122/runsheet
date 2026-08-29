import { Api, parseSpreadsheetFile } from '../lib/api.js';

const BLANK_CUSTOMER = () => ({
  name: '', code: '', segment: '', area: '', contact: '', chain_store: '', address: '',
  postal_code: '', mobile: '', whatsapp: '', roc_no: '', modified_source: '',
});

export default {
  data() {
    return {
      customers: [],
      editing: null,
      showModal: false,
      form: BLANK_CUSTOMER(),
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
      if (!q) return this.customers;
      return this.customers.filter(c => [
        c.name, c.code, c.segment, c.area, c.contact, c.chain_store, c.address,
        c.postal_code, c.mobile, c.whatsapp, c.roc_no,
      ].some(v => String(v ?? '').toLowerCase().includes(q)));
    },
  },
  async mounted() { await this.load(); },
  methods: {
    async load() { this.customers = await Api.get('/api/customers'); },
    openNew() { this.editing = null; this.form = BLANK_CUSTOMER(); this.error = ''; this.showModal = true; },
    openEdit(c) { this.editing = c; this.form = { ...BLANK_CUSTOMER(), ...c }; this.error = ''; this.showModal = true; },
    async save() {
      this.error = '';
      try {
        if (this.editing) await Api.put(`/api/customers/${this.editing.id}`, this.form);
        else await Api.post('/api/customers', this.form);
        this.showModal = false;
        await this.load();
      } catch (e) { this.error = e.message; }
    },
    async remove(c) {
      if (!confirm(`Delete customer "${c.name}"?`)) return;
      await Api.del(`/api/customers/${c.id}`);
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
            this.importResult = await Api.post('/api/customers/import', { csv: text });
          } else {
            const rows = await parseSpreadsheetFile(this.importFile);
            this.importResult = await Api.post('/api/customers/import', { rows });
          }
        } else if (this.importText.trim()) {
          this.importResult = await Api.post('/api/customers/import', { csv: this.importText });
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
      <h1>Customers</h1>
      <div class="sub">Customer Master reference data. {{ customers.length }} customer(s).</div>
    </div>
    <div class="toolbar">
      <input type="text" v-model="search" placeholder="Search name, code, area, contact..." style="width:260px" />
      <button @click="showImport = true">Import Customer Master</button>
      <button class="primary" @click="openNew">+ Add customer</button>
    </div>
  </div>

  <div class="panel">
    <table>
      <thead><tr>
        <th>Name</th><th>Code</th><th>Segment</th><th>Area</th><th>Contact</th>
        <th>Chain store</th><th>Address</th><th>Postal</th><th>Mobile</th><th>WhatsApp</th><th>ROC no</th><th></th>
      </tr></thead>
      <tbody>
        <tr v-for="c in filtered" :key="c.id">
          <td>{{ c.name }}</td>
          <td class="mono">{{ c.code }}</td>
          <td>{{ c.segment }}</td>
          <td>{{ c.area }}</td>
          <td>{{ c.contact }}</td>
          <td>{{ c.chain_store }}</td>
          <td style="max-width:220px;white-space:normal;">{{ c.address }}</td>
          <td class="mono">{{ c.postal_code }}</td>
          <td class="mono">{{ c.mobile }}</td>
          <td class="mono">{{ c.whatsapp }}</td>
          <td class="mono">{{ c.roc_no }}</td>
          <td class="right">
            <button class="small" @click="openEdit(c)">Edit</button>
            <button class="small danger" @click="remove(c)">Delete</button>
          </td>
        </tr>
        <tr v-if="!filtered.length"><td colspan="12" class="empty">No customers yet. Add one or import the Customer Master.</td></tr>
      </tbody>
    </table>
  </div>

  <div class="overlay" v-if="showModal">
    <div class="modal" style="max-width:640px;">
      <h2>{{ editing ? 'Edit customer' : 'Add customer' }}</h2>
      <div class="field-row">
        <div class="field"><label>Customer name</label><input type="text" v-model="form.name" /></div>
        <div class="field"><label>Code</label><input type="text" v-model="form.code" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Segment</label><input type="text" v-model="form.segment" /></div>
        <div class="field"><label>Area / route</label><input type="text" v-model="form.area" /></div>
        <div class="field"><label>Contact</label><input type="text" v-model="form.contact" /></div>
      </div>
      <div class="field"><label>Address</label><textarea rows="2" v-model="form.address"></textarea></div>
      <div class="field-row">
        <div class="field"><label>Postal code</label><input type="text" v-model="form.postal_code" /></div>
        <div class="field"><label>Mobile</label><input type="text" v-model="form.mobile" /></div>
        <div class="field"><label>WhatsApp</label><input type="text" v-model="form.whatsapp" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Chain store</label><input type="text" v-model="form.chain_store" /></div>
        <div class="field"><label>ROC no</label><input type="text" v-model="form.roc_no" /></div>
      </div>
      <div class="hint" style="color:var(--bad)" v-if="error">{{ error }}</div>
      <div class="modal-actions">
        <button @click="showModal=false">Cancel</button>
        <button class="primary" @click="save">Save</button>
      </div>
    </div>
  </div>

  <div class="overlay" v-if="showImport">
    <div class="modal">
      <h2>Import Customer Master</h2>
      <p class="hint">Upload the Customer Master directly as <b>.xlsx</b> (or a <b>.csv</b>) &mdash; columns
        are matched by name (Name, Code, Segment, Area, Contact, Chain store, Address, Postal code,
        Mobile, WhatsApp, ROC no). Re-importing an existing name updates its data.</p>
      <div class="field"><input type="file" accept=".xlsx,.xls,.csv" @change="handleFile" /></div>
      <div class="field" v-if="!importFile">
        <label>...or paste CSV text</label>
        <textarea rows="6" v-model="importText" placeholder="name,code,segment,area,contact,chain_store,address,postal_code,mobile,whatsapp,roc_no"></textarea>
      </div>
      <div class="hint" v-if="importResult" style="color:var(--good)">Imported / updated {{ importResult.imported }} customer(s).</div>
      <div class="hint" v-if="importError" style="color:var(--bad)">{{ importError }}</div>
      <div class="modal-actions">
        <button @click="showImport=false; importResult=null; importFile=null; importText=''">Close</button>
        <button class="primary" @click="runImport">Import</button>
      </div>
    </div>
  </div>
  `,
};
