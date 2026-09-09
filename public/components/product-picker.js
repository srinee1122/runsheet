// components/product-picker.js
// A search-as-you-type product picker with its own rendered suggestion list, not a
// native <input list>/<datalist> — a native datalist's dropdown is entirely owned by the
// browser, so JS has no way to drive Up/Down highlighting through it or make Enter/Left/
// Right confirm a choice. This renders its own list instead, matching CustomerPicker's
// pattern. Typing the exact full name still selects it directly too, unchanged from
// before — the dropdown is an added way to pick, not the only way.
// Emits a product id via standard v-model (modelValue / update:modelValue).
export default {
  props: {
    products: { type: Array, required: true },
    modelValue: { type: [Number, null], default: null },
    placeholder: { type: String, default: 'Search product…' },
  },
  emits: ['update:modelValue'],
  data() {
    return { query: '', open: false, highlighted: 0, dropStyle: {} };
  },
  computed: {
    suggestions() {
      const q = this.query.trim().toLowerCase();
      if (!q) return [];
      return this.products
        .filter(p => p.name.toLowerCase().includes(q) || (p.code || '').toLowerCase().includes(q))
        .slice(0, 8);
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
    // Positions the dropdown with position:fixed, coordinates computed directly from the
    // input's real on-screen location, rather than position:absolute anchored to a
    // positioned ancestor. This app has more than one scrollable/clipping container
    // between this field and the page root (the All Round Items table's own sticky
    // columns, the outer page wrapper's overflow for the wide table) — position:fixed
    // is the one approach that's genuinely immune to all of that at once, since a
    // fixed-position element escapes every ancestor's stacking context and overflow
    // clipping and renders directly against the viewport, rather than needing each
    // clipping/stacking ancestor found and individually special-cased. Also decides
    // up vs down the same way as before: only flips upward when there's genuinely more
    // room that way, rather than trading one cramped position for another.
    updateDropPosition() {
      const el = this.$refs.input;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const estimatedHeight = 200; // matches the dropdown's own max-height in CSS
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < estimatedHeight && rect.top > spaceBelow;
      this.dropStyle = openUp
        ? { position: 'fixed', left: rect.left + 'px', bottom: (window.innerHeight - rect.top) + 'px', top: 'auto', minWidth: rect.width + 'px' }
        : { position: 'fixed', left: rect.left + 'px', top: rect.bottom + 'px', bottom: 'auto', minWidth: rect.width + 'px' };
    },
    // Only emits when the current text is an exact match — NOT on every non-matching
    // keystroke like the old version did. Some places this component is used in (the All
    // Round Items row-label picker, specifically) reject a null selection by force-
    // remounting this entire component, which would destroy its own open/highlighted
    // dropdown state on every single intermediate keystroke while still typing a search.
    // Leaving the model untouched during that in-between typing avoids triggering that
    // rejection path at all; onBlur below is what snaps the visible text back if nothing
    // was ever actually confirmed.
    onInput() {
      const q = this.query.trim().toLowerCase();
      const match = this.products.find(p => p.name.trim().toLowerCase() === q);
      if (match) this.$emit('update:modelValue', match.id);
      this.open = this.suggestions.length > 0;
      this.highlighted = 0;
      if (this.open) this.updateDropPosition();
    },
    select(product) {
      this.query = product.name;
      this.$emit('update:modelValue', product.id);
      this.open = false;
    },
    // Only intercepts a key when the dropdown is actually open with something to act on —
    // otherwise lets it bubble up untouched to whatever the surrounding context listens
    // for (the table's cell-to-cell handleKeyNav, or the Add-product row's keyup.enter).
    onKeydown(event) {
      if (!this.open || !this.suggestions.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault(); event.stopPropagation();
        this.highlighted = (this.highlighted + 1) % this.suggestions.length;
      } else if (event.key === 'ArrowUp') {
        event.preventDefault(); event.stopPropagation();
        this.highlighted = (this.highlighted - 1 + this.suggestions.length) % this.suggestions.length;
      } else if (event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation();
        this.select(this.suggestions[this.highlighted]);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        // Left/Right always confirm the top match specifically, regardless of anything
        // highlighted via Up/Down — a quick "that's the one, moving on" shortcut, distinct
        // from Enter's "confirm whatever I've navigated to."
        event.preventDefault(); event.stopPropagation();
        this.select(this.suggestions[0]);
      } else if (event.key === 'Escape') {
        this.open = false;
      }
    },
    // If focus leaves without a selection ever having been confirmed, snap the visible
    // text back to whatever's actually still selected (or blank) — restores the display
    // to reality without ever having emitted an intermediate null that would trigger the
    // row-label picker's remount-on-rejection behavior.
    onBlur() {
      setTimeout(() => {
        this.open = false;
        const p = this.products.find(x => x.id === this.modelValue);
        this.query = p ? p.name : '';
      }, 150);
    },
    onFocus() {
      this.open = this.suggestions.length > 0;
      if (this.open) this.updateDropPosition();
    },
  },
  template: `
  <div class="mx-cust-picker">
    <input ref="input" type="text" v-model="query" @input="onInput" @keydown="onKeydown" @blur="onBlur" @focus="onFocus" :placeholder="placeholder" />
    <ul class="mx-cust-dropdown" :style="dropStyle" v-if="open && suggestions.length">
      <li v-for="(p, i) in suggestions" :key="p.id" :class="{ active: i === highlighted }" @mousedown.prevent="select(p)">
        {{ p.name }}<span class="mx-pick-hint"> &middot; {{ p.code }} &middot; qty/ctn {{ p.qty_per_ctn }}</span>
      </li>
    </ul>
  </div>
  `,
};
