// components/customer-picker.js
// A search-as-you-type shop/customer field with its own rendered suggestion list, not a
// native <input list>/<datalist> — a native datalist's dropdown is entirely owned by the
// browser, so JS has no way to drive Up/Down highlighting through it or make Enter/Left/
// Right confirm a choice. This renders its own list instead, specifically so that's
// possible, while still behaving like a plain free-text field: nothing here ever forces
// picking from the list — a shop that isn't in Customers yet can still just be typed.
export default {
  props: {
    customers: { type: Array, required: true },
    modelValue: { type: String, default: '' },
  },
  emits: ['update:modelValue'],
  data() {
    return { query: this.modelValue || '', open: false, highlighted: 0, dropStyle: {} };
  },
  watch: {
    // Keeps this in sync if the stop's customer is changed from outside this component
    // (e.g. loading a different sheet) — but not on every keystroke, since onInput
    // already emits the update and re-syncing from modelValue on that same keystroke
    // would just be redundant.
    modelValue(v) { if (v !== this.query) this.query = v || ''; },
  },
  computed: {
    suggestions() {
      const q = this.query.trim().toLowerCase();
      if (!q) return [];
      return this.customers
        .filter(c => c.name.toLowerCase().includes(q))
        .slice(0, 8);
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
    onInput() {
      this.$emit('update:modelValue', this.query);
      this.open = this.suggestions.length > 0;
      this.highlighted = 0;
      if (this.open) this.updateDropPosition();
    },
    select(name) {
      this.query = name;
      this.$emit('update:modelValue', name);
      this.open = false;
    },
    // Only intercepts a key when the dropdown is actually open with something to act on —
    // otherwise lets it bubble up untouched to the table's own cell-to-cell handleKeyNav,
    // same as before this component existed.
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
        this.select(this.suggestions[this.highlighted].name);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        // Left/Right always confirm the top match specifically, regardless of anything
        // highlighted via Up/Down — a quick "that's the one, moving on" shortcut, distinct
        // from Enter's "confirm whatever I've navigated to."
        event.preventDefault(); event.stopPropagation();
        this.select(this.suggestions[0].name);
      } else if (event.key === 'Escape') {
        this.open = false;
      }
    },
    // Delayed so a click on a suggestion (a mousedown + blur) still registers as a
    // selection before the list disappears out from under it.
    onBlur() { setTimeout(() => { this.open = false; }, 150); },
    onFocus() {
      this.open = this.suggestions.length > 0;
      if (this.open) this.updateDropPosition();
    },
  },
  template: `
  <div class="mx-cust-picker">
    <input ref="input" type="text" v-model="query" @input="onInput" @keydown="onKeydown" @blur="onBlur" @focus="onFocus" />
    <ul class="mx-cust-dropdown" :style="dropStyle" v-if="open && suggestions.length">
      <li v-for="(c, i) in suggestions" :key="c.id" :class="{ active: i === highlighted }" @mousedown.prevent="select(c.name)">{{ c.name }}</li>
    </ul>
  </div>
  `,
};
