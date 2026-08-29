// components/photo-review.js
// Presentational review panel for extracted sales orders. Nothing here writes to the
// runsheet grid until the clerk presses Confirm on a specific card.
import RoundItemPicker from './round-item-picker.js';

export default {
  components: { RoundItemPicker },
  props: {
    salesOrders: { type: Array, required: true }, // merged-by-so_no extraction results
    products: { type: Array, required: true },
    frequentColumns: { type: Array, default: () => [] },
  },
  emits: ['confirm', 'discard', 'close'],
  computed: {
    allUncertain() {
      const out = [];
      for (const so of this.salesOrders) {
        for (const u of so.uncertain || []) out.push({ so_no: so.so_no, text: u });
      }
      return out;
    },
    pendingCount() { return this.salesOrders.filter(s => !s.confirmed).length; },
  },
  methods: {
    // Any product can be a round item now, so we only auto-fill on an exact name match —
    // a fuzzy/substring guess across the full catalog would misfire too often to trust.
    // A clerk can always search and pick the right one if this doesn't find it.
    matchProduct(itemName) {
      const name = (itemName || '').trim().toLowerCase();
      if (!name) return null;
      return this.products.find(p => p.name.trim().toLowerCase() === name) || null;
    },
    // ensure every non-struck round item on a card has a working `mapped_product_id`
    ensureMappings(so) {
      for (const ri of so.round_items || []) {
        if (ri.struck) continue;
        if (ri.mapped_product_id === undefined) {
          const m = this.matchProduct(ri.item);
          ri.mapped_product_id = m ? m.id : null;
        }
      }
    },
    unmappedCount(so) {
      return (so.round_items || []).filter(r => !r.struck && !r.mapped_product_id).length;
    },
    canConfirm(so) { return this.unmappedCount(so) === 0; },
    confirm(so) {
      if (!this.canConfirm(so)) return;
      this.$emit('confirm', so);
    },
  },
  mounted() {
    for (const so of this.salesOrders) this.ensureMappings(so);
  },
  updated() {
    for (const so of this.salesOrders) this.ensureMappings(so);
  },
  template: `
  <div class="panel">
    <div class="page-head" style="margin-bottom:10px;">
      <div>
        <h1 style="font-size:16px;">Review extracted sales orders</h1>
        <div class="sub">{{ pendingCount }} pending &middot; nothing is added to the runsheet until you confirm each one.</div>
      </div>
      <button @click="$emit('close')">Close review</button>
    </div>

    <div class="uncertain-box" v-if="allUncertain.length">
      <b>Flagged for your attention ({{ allUncertain.length }})</b>
      <ul style="margin:8px 0 0;padding-left:18px;">
        <li v-for="(u,i) in allUncertain" :key="i"><span class="mono">SO {{ u.so_no || '?' }}:</span> {{ u.text }}</li>
      </ul>
    </div>

    <div v-for="so in salesOrders" :key="so._key" class="review-card" :class="{confirmed: so.confirmed}">
      <div class="field-row" style="align-items:flex-start;">
        <div style="flex:1;">
          <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:6px;">
            <div><span class="hint">SO NO.</span><br/><b class="mono">{{ so.so_no || '—' }}</b></div>
            <div><span class="hint">CUSTOMER</span><br/><b>{{ so.customer || '—' }}</b></div>
            <div><span class="hint">AREA</span><br/>{{ so.area || '—' }}</div>
            <div><span class="hint">SALESMAN</span><br/>{{ so.salesman || '—' }}</div>
            <div v-if="so.pallet_no"><span class="hint">PALLET</span><br/>{{ so.pallet_no }}</div>
          </div>

          <div style="margin-bottom:8px;">
            <span class="hint">BOX &mdash; TAKEN BY / CTNS</span><br/>
            <span v-if="so.box">
              <b>{{ so.box.reader_name || '(name unclear)' }}</b>
              &middot; carton {{ so.box.carton ?? '—' }} + loose {{ so.box.loose ?? '—' }}
              = <b class="mono">{{ (so.box.carton||0) + (so.box.loose||0) }} CTNS</b>
            </span>
            <span v-else class="hint">No stamped box found on this page — CTNS will need to be entered manually.</span>
          </div>

          <div style="margin-bottom:8px;">
            <span class="hint">ROUND ITEMS</span><br/>
            <div v-if="!(so.round_items||[]).length" class="hint">None circled.</div>
            <div v-for="(ri,i) in so.round_items" :key="i" style="display:flex;align-items:center;gap:8px;margin:4px 0;">
              <span :class="{struck: ri.struck}">{{ ri.item }} &mdash; {{ ri.qty }} {{ ri.uom }}</span>
              <span class="badge bad" v-if="ri.struck">EXCLUDED (struck)</span>
              <RoundItemPicker v-else :products="products" :frequentColumns="frequentColumns" v-model="ri.mapped_product_id" />
            </div>
          </div>

          <div v-if="(so.notes||[]).length" style="margin-bottom:8px;">
            <span class="hint">NOTES</span><br/>{{ so.notes.join(' · ') }}
          </div>

          <div class="hint" style="color:var(--warn)" v-if="!canConfirm(so)">
            Map every non-struck round item to a product before confirming.
          </div>
        </div>
        <div style="flex:none;display:flex;flex-direction:column;gap:8px;">
          <button class="primary" :disabled="so.confirmed || !canConfirm(so)" @click="confirm(so)">
            {{ so.confirmed ? 'Added' : 'Confirm & add row' }}
          </button>
          <button class="danger small" v-if="!so.confirmed" @click="$emit('discard', so)">Discard</button>
        </div>
      </div>
    </div>
    <div class="empty" v-if="!salesOrders.length">No sales orders extracted yet.</div>
  </div>
  `,
};
