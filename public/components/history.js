import { Api } from '../lib/api.js';

export default {
  data() { return { runsheets: [], search: '', currentPage: 1, pageSize: 15 }; },
  computed: {
    // Search always runs against the full dataset, never just the current page — this is
    // what makes it "universal": paginated() below slices whatever filtered() already
    // narrowed down, so a search result can span or land on any page correctly.
    filtered() {
      const q = this.search.trim().toLowerCase();
      if (!q) return this.runsheets;
      return this.runsheets.filter(r =>
        (r.sheet_no || '').toLowerCase().includes(q) ||
        (r.area || '').toLowerCase().includes(q) ||
        (r.delivery_man || '').toLowerCase().includes(q) ||
        (r.created_by || '').toLowerCase().includes(q));
    },
    totalPages() { return Math.max(1, Math.ceil(this.filtered.length / this.pageSize)); },
    paginated() {
      const start = (this.currentPage - 1) * this.pageSize;
      return this.filtered.slice(start, start + this.pageSize);
    },
  },
  watch: {
    // A new search could easily have far fewer matches than the page you were on — reset
    // to page 1 so you're never staring at a blank page that only existed for the old,
    // unfiltered count.
    search() { this.currentPage = 1; },
  },
  async mounted() { this.runsheets = await Api.get('/api/runsheets'); },
  methods: {
    open(r) { this.$router.push(`/builder/${r.id}`); },
    print(r) { window.open(`/print.html?id=${r.id}`, '_blank'); },
    goToPage(p) { this.currentPage = Math.min(Math.max(1, p), this.totalPages); },
  },
  template: `
  <div class="page-head">
    <div><h1>History</h1><div class="sub">Every runsheet ever built — reopen or reprint. {{ runsheets.length }} sheet(s).</div></div>
    <input type="text" v-model="search" placeholder="Search by sheet no, area, delivery man..." style="width:260px" />
  </div>
  <div class="panel">
    <table>
      <thead><tr>
        <th>Sheet No</th><th>Area</th><th>Delivery Man</th><th>Vehicle</th>
        <th>Run Date</th><th>Built by</th><th>Saved</th><th></th>
      </tr></thead>
      <tbody>
        <tr v-for="r in paginated" :key="r.id">
          <td class="mono">{{ r.sheet_no || '—' }}</td>
          <td>{{ r.area || '—' }}</td>
          <td>{{ r.delivery_man || '—' }}</td>
          <td>{{ r.vehicle_no || '—' }}</td>
          <td>{{ r.run_date || '—' }}</td>
          <td>{{ r.created_by || '—' }}</td>
          <td class="hint">{{ r.updated_at }}</td>
          <td class="right">
            <button class="small" @click="open(r)">Reopen</button>
            <button class="small" @click="print(r)">Print</button>
          </td>
        </tr>
        <tr v-if="!filtered.length"><td colspan="8" class="empty">No runsheets saved yet.</td></tr>
      </tbody>
    </table>
    <div class="pagination" v-if="totalPages > 1">
      <button class="small" @click="goToPage(currentPage - 1)" :disabled="currentPage === 1">&larr; Prev</button>
      <span class="hint">Page {{ currentPage }} of {{ totalPages }} &middot; {{ filtered.length }} sheet(s)</span>
      <button class="small" @click="goToPage(currentPage + 1)" :disabled="currentPage === totalPages">Next &rarr;</button>
    </div>
  </div>
  `,
};
