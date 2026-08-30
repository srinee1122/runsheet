// app.js — entry module. Vue + Vue Router are loaded as classic global scripts in
// index.html (see the comment there for why), so we read them off window here rather
// than importing them — everything else in this file is a real ES module import.
import { Api } from './lib/api.js';
import { onAuthChange, signOutUser } from './lib/firebase.js';
import { MODULES } from './lib/modules.js';
import BuilderPage from './components/builder.js';
import ProductsPage from './components/products.js';
import CustomersPage from './components/customers.js';
import SettingsPage from './components/settings.js';
import HistoryPage from './components/history.js';
import LoginPage from './components/login.js';
import UsersPage from './components/users.js';

const { createApp, reactive, watch } = window.Vue;
const { createRouter, createWebHashHistory } = window.VueRouter;

// Shared auth state — a single reactive object read by both the router guard below and
// the root component's template (for showing/hiding sidebar links). `ready` flips true
// once Firebase has resolved whatever session it found (or didn't) in this browser;
// nothing about permissions should be trusted before that. `generation` increments on
// every completed resolution (not just the first) — see the watcher below for why that
// matters.
const authState = reactive({ ready: false, user: null, permissions: null, generation: 0 });

onAuthChange(async (fbUser) => {
  authState.user = fbUser;
  if (fbUser) {
    try { authState.permissions = await Api.get('/api/me'); }
    catch { authState.permissions = null; }
  } else {
    authState.permissions = null;
  }
  authState.ready = true;
  authState.generation++;
});

function waitForAuthReady() {
  if (authState.ready) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = watch(() => authState.ready, (val) => { if (val) { stop(); resolve(); } });
  });
}

// Where to send someone who can't access wherever they were headed — the first module
// they actually have, or /no-access if they have none yet. Never redirects to a route
// they'd immediately get bounced from again, so this can't loop.
function fallbackRoute() {
  const perms = authState.permissions;
  if (!perms) return '/no-access';
  if (perms.isAdmin) return '/builder';
  const found = MODULES.find((m) => perms.modules[m.key]);
  return found ? '/' + found.key : '/no-access';
}

const routes = [
  { path: '/', redirect: '/builder' },
  { path: '/login', component: LoginPage, meta: { public: true } },
  { path: '/no-access', component: { template: `
      <div class="panel">
        <h1>No access yet</h1>
        <p class="hint">You're signed in, but no one's granted your account access to any page
        yet. Ask an admin to set your permissions in Users &amp; Permissions.</p>
      </div>` }, meta: { authedOnly: true } },
  { path: '/builder', component: BuilderPage, name: 'builder', meta: { module: 'builder' } },
  { path: '/builder/:id', component: BuilderPage, name: 'builder-edit', props: true, meta: { module: 'builder' } },
  { path: '/products', component: ProductsPage, meta: { module: 'products' } },
  { path: '/customers', component: CustomersPage, meta: { module: 'customers' } },
  { path: '/settings', component: SettingsPage, meta: { module: 'settings' } },
  { path: '/history', component: HistoryPage, meta: { module: 'history' } },
  { path: '/users', component: UsersPage, meta: { admin: true } },
];
const router = createRouter({ history: createWebHashHistory(), routes });

// authState.ready only ever transitions false→true once (it stays true after), so a
// watcher on it alone would only fire for the very first auth check — never again on a
// later sign-out or a different person signing in. Watching `generation` instead (which
// increments on every completed resolution) reliably catches every one of those, with
// permissions already fully loaded by the time it fires. This is what actually moves
// someone to /login on sign-out, or off it once a real sign-in resolves — router guards
// alone only run on navigation events, not on background reactive state changes like this.
watch(() => authState.generation, () => {
  const path = router.currentRoute.value.path;
  const meta = router.currentRoute.value.meta || {};
  if (!authState.user && !meta.public) {
    router.push('/login');
  } else if (authState.user && path === '/login') {
    router.push(fallbackRoute());
  }
});

router.beforeEach(async (to) => {
  await waitForAuthReady();
  if (to.meta.public) return true;
  if (!authState.user) return '/login';
  if (to.meta.authedOnly) return true; // signed in is enough (e.g. /no-access itself)
  const perms = authState.permissions;
  if (to.meta.admin) return (perms && perms.isAdmin) ? true : fallbackRoute();
  if (to.meta.module) {
    const ok = perms && (perms.isAdmin || perms.modules[to.meta.module]);
    return ok ? true : fallbackRoute();
  }
  return true;
});

const RootApp = {
  setup() {
    return { auth: authState, signOut: signOutUser, modules: MODULES };
  },
  template: `
    <template v-if="!auth.ready">
      <div class="login-screen"><p class="hint">Loading…</p></div>
    </template>
    <template v-else-if="$route.meta.public">
      <router-view />
    </template>
    <template v-else>
      <div class="sidebar">
        <div class="brand"><b>Sri Ambikas</b><span>Runsheet Tool</span></div>
        <nav class="nav">
          <template v-for="m in modules" :key="m.key">
            <router-link v-if="auth.permissions && (auth.permissions.isAdmin || auth.permissions.modules[m.key])"
              :to="'/' + m.key"><span class="label">{{ m.label }}</span></router-link>
          </template>
          <router-link v-if="auth.permissions && auth.permissions.isAdmin" to="/users"><span class="label">Users &amp; Permissions</span></router-link>
        </nav>
        <div class="user-pill">
          <span>Signed in as</span><br/>
          <b>{{ (auth.permissions && auth.permissions.displayName) || (auth.user && auth.user.email) }}</b><br/>
          <button class="small" @click="signOut">Sign out</button>
        </div>
      </div>
      <div class="main">
        <router-view :key="$route.fullPath" />
      </div>
    </template>
  `,
};

const app = createApp(RootApp);
app.use(router);
app.mount('#app');
