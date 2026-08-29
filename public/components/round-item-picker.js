// components/round-item-picker.js
// Two-mode round-item selector: "Regular round item" shows a short <select> of the
// products that are quick-access — either flagged "Regular round item" on the Products
// page, or already configured as one of the up-to-10 preset columns in Settings (no
// reason to make someone flag a product twice). "Other round item" falls back to the
// full searchable ProductPicker across the whole catalog. Either mode can select any
// product that's in its list — the mode is just which list you're browsing.
import ProductPicker from './product-picker.js';

export default {
  components: { ProductPicker },
  props: {
    products: { type: Array, required: true },
    frequentColumns: { type: Array, default: () => [] },
    modelValue: { type: [Number, null], default: null },
  },
  emits: ['update:modelValue'],
  data() {
    return { userMode: null }; // null = no explicit choice yet; follow the default below
  },
  computed: {
    regularProducts() {
      const presetIds = new Set((this.frequentColumns || []).map(c => c.product_id));
      return this.products
        .filter(p => p.is_round_item || presetIds.has(p.id))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    // Reactive, not a one-time snapshot: if `products` is still loading when this component
    // is first created (e.g. a stop card added before the parent's product fetch resolves),
    // this recomputes as soon as `products` arrives instead of getting stuck on an empty list.
    mode() {
      return this.userMode || (this.regularProducts.length ? 'regular' : 'other');
    },
    localValue: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },
  },
  methods: {
    setMode(m) {
      if (this.mode === m) return;
      this.userMode = m;
      this.localValue = null; // avoid a stale selection carrying across a mode switch
    },
  },
  template: `
  <div>
    <div style="display:flex;gap:6px;margin-bottom:6px;">
      <button type="button" class="small" :class="{primary: mode==='regular'}" @click="setMode('regular')">Regular round item</button>
      <button type="button" class="small" :class="{primary: mode==='other'}" @click="setMode('other')">Other round item</button>
    </div>
    <select v-if="mode==='regular'" v-model.number="localValue">
      <option :value="null">— select regular round item —</option>
      <option v-for="p in regularProducts" :key="p.id" :value="p.id">{{ p.name }}</option>
    </select>
    <p class="hint" v-if="mode==='regular' && !regularProducts.length">
      No products are flagged as regular round items yet — flag some on the Products page, or set up frequent columns in Settings.
    </p>
    <ProductPicker v-if="mode==='other'" :products="products" v-model="localValue" placeholder="Search any product…" />
  </div>
  `,
};
