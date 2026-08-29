// components/product-picker.js
// A search-as-you-type product picker (input + datalist) so choosing from thousands of
// products stays fast. Emits a product id via standard v-model (modelValue / update:modelValue).
export default {
  props: {
    products: { type: Array, required: true },
    modelValue: { type: [Number, null], default: null },
    placeholder: { type: String, default: 'Search product…' },
  },
  emits: ['update:modelValue'],
  data() {
    return { query: '', listId: 'pp-' + Math.random().toString(36).slice(2) };
  },
  computed: {
    suggestions() {
      const q = this.query.trim().toLowerCase();
      if (!q) return [];
      return this.products
        .filter(p => p.name.toLowerCase().includes(q) || (p.code || '').toLowerCase().includes(q))
        .slice(0, 200);
    },
  },
  watch: {
    modelValue: {
      immediate: true,
      handler(id) {
        const p = this.products.find(x => x.id === id);
        this.query = p ? p.name : '';
      },
    },
  },
  methods: {
    onInput() {
      const q = this.query.trim().toLowerCase();
      const match = this.products.find(p => p.name.trim().toLowerCase() === q);
      this.$emit('update:modelValue', match ? match.id : null);
    },
  },
  template: `
  <div>
    <input type="text" v-model="query" @input="onInput" :list="listId" :placeholder="placeholder" />
    <datalist :id="listId">
      <option v-for="p in suggestions" :key="p.id" :value="p.name">{{ p.code }} &middot; qty/ctn {{ p.qty_per_ctn }}</option>
    </datalist>
  </div>
  `,
};
