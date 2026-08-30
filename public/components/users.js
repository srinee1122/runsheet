import { Api } from '../lib/api.js';
import { MODULES } from '../lib/modules.js';

export default {
  data() {
    return { users: [], loading: true, savingUid: null, modules: MODULES };
  },
  async mounted() {
    await this.reload();
  },
  methods: {
    async reload() {
      this.loading = true;
      try { this.users = await Api.get('/api/users'); } finally { this.loading = false; }
    },
    async save(u) {
      this.savingUid = u.uid;
      try {
        await Api.put(`/api/users/${u.uid}`, { isAdmin: u.isAdmin, modules: u.modules });
      } catch (e) {
        alert(e.message);
        await this.reload(); // revert to server truth if the save was rejected (e.g. last-admin guard)
      } finally {
        this.savingUid = null;
      }
    },
  },
  template: `
  <div class="panel">
    <h1>Users &amp; Permissions</h1>
    <p class="hint" style="margin-top:-6px;">
      New sign-ins appear here automatically with no access — tick the pages each person should
      see, or make them an admin to grant everything (including managing this page itself).
      Changes save as soon as you change a checkbox.
    </p>

    <table v-if="!loading" style="margin-top:14px;">
      <thead><tr>
        <th style="text-align:left;">Person</th>
        <th class="center">Admin</th>
        <th v-for="m in modules" :key="m.key" class="center">{{ m.label }}</th>
      </tr></thead>
      <tbody>
        <tr v-for="u in users" :key="u.uid">
          <td>
            <div style="font-weight:500;">{{ u.displayName || u.email || u.uid }}</div>
            <div class="hint" v-if="u.displayName && u.email">{{ u.email }}</div>
          </td>
          <td class="center"><input type="checkbox" v-model="u.isAdmin" @change="save(u)" /></td>
          <td v-for="m in modules" :key="m.key" class="center">
            <input type="checkbox" v-model="u.modules[m.key]" :disabled="u.isAdmin" @change="save(u)" />
          </td>
        </tr>
        <tr v-if="!users.length"><td :colspan="modules.length + 2" class="empty">No one has signed in yet.</td></tr>
      </tbody>
    </table>
    <p class="hint" v-if="savingUid">Saving…</p>
  </div>
  `,
};
