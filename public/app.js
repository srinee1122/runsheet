// app.js — entry module. Vue + Vue Router are loaded as classic global scripts in
// index.html (see the comment there for why), so we read them off window here rather
// than importing them — everything else in this file is a real ES module import.
import { Api, CurrentUser } from './lib/api.js';
import BuilderPage from './components/builder.js';
import ProductsPage from './components/products.js';
import CustomersPage from './components/customers.js';
import SettingsPage from './components/settings.js';
import HistoryPage from './components/history.js';

const { createApp, ref, onMounted } = window.Vue;
const { createRouter, createWebHashHistory } = window.VueRouter;

const routes = [
  { path: '/', redirect: '/builder' },
  { path: '/builder', component: BuilderPage, name: 'builder' },
  { path: '/builder/:id', component: BuilderPage, name: 'builder-edit', props: true },
  { path: '/products', component: ProductsPage },
  { path: '/customers', component: CustomersPage },
  { path: '/settings', component: SettingsPage },
  { path: '/history', component: HistoryPage },
];
const router = createRouter({ history: createWebHashHistory(), routes });

const RootApp = {
  setup() {
    const user = ref(CurrentUser.get());
    const clerks = ref([]);
    const showSwitch = ref(!user.value);
    const newName = ref('');

    async function loadClerks() {
      try { clerks.value = await Api.get('/api/settings/clerks'); } catch (e) { clerks.value = []; }
    }
    onMounted(loadClerks);

    function pick(name) {
      if (!name || !name.trim()) return;
      CurrentUser.set(name.trim());
      user.value = name.trim();
      showSwitch.value = false;
    }
    async function addAndPick() {
      const name = newName.value.trim();
      if (!name) return;
      const next = [...new Set([...clerks.value, name])];
      await Api.put('/api/settings/clerks', { names: next });
      clerks.value = next;
      pick(name);
      newName.value = '';
    }

    return { user, clerks, showSwitch, newName, pick, addAndPick };
  },
  template: `
    <div class="sidebar">
      <div class="brand"><b>Sri Ambikas</b><span>Runsheet Tool</span></div>
      <nav class="nav">
        <router-link to="/builder"><span class="label">Runsheet Builder</span></router-link>
        <router-link to="/history"><span class="label">History</span></router-link>
        <router-link to="/products"><span class="label">Products</span></router-link>
        <router-link to="/customers"><span class="label">Customers</span></router-link>
        <router-link to="/settings"><span class="label">Settings</span></router-link>
      </nav>
      <div class="user-pill">
        <span>Signed in as</span><br/>
        <b>{{ user || '(no name picked)' }}</b><br/>
        <button class="small" @click="showSwitch = true">Switch user</button>
      </div>
    </div>
    <div class="main">
      <router-view :key="$route.fullPath" />
    </div>

    <div class="overlay" v-if="showSwitch">
      <div class="modal">
        <h2>Who's building this runsheet?</h2>
        <p class="hint">Sheets record who built them. Pick your name or add a new one.</p>
        <div class="field" v-if="clerks.length">
          <label>Existing clerks</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            <button v-for="c in clerks" :key="c" @click="pick(c)">{{ c }}</button>
          </div>
        </div>
        <div class="field">
          <label>Add a new name</label>
          <div style="display:flex;gap:8px;">
            <input type="text" v-model="newName" @keyup.enter="addAndPick" placeholder="e.g. Muthu" />
            <button class="primary" @click="addAndPick">Use this name</button>
          </div>
        </div>
      </div>
    </div>
  `,
};

const app = createApp(RootApp);
app.use(router);
app.mount('#app');
