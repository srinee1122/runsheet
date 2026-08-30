import { signIn } from '../lib/firebase.js';

const TODAY = new Date().toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long' });
// <animateMotion> is SVG's own native animation system, not CSS — the existing
// prefers-reduced-motion handling (which works by setting `animation:none` in CSS)
// has no effect on it. Checked once here instead, so the moving vehicles simply
// aren't rendered at all for anyone who's asked for reduced motion.
const REDUCED_MOTION = typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default {
  data() {
    return { email: '', password: '', error: '', signingIn: false, today: TODAY, showVehicles: !REDUCED_MOTION };
  },
  methods: {
    async submit() {
      if (!this.email.trim() || !this.password) return;
      this.signingIn = true;
      this.error = '';
      try {
        await signIn(this.email.trim(), this.password);
        // onAuthChange in app.js picks up the sign-in and redirects on its own.
      } catch (e) {
        // Firebase's own error codes are verbose (auth/invalid-credential, auth/too-many-requests,
        // etc.) — translate the common ones into something a non-technical person can act on.
        const code = e && e.code;
        if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
          this.error = 'Incorrect email or password.';
        } else if (code === 'auth/too-many-requests') {
          this.error = 'Too many attempts — please wait a moment and try again.';
        } else if (code === 'auth/user-disabled') {
          this.error = 'This account has been disabled. Contact an admin.';
        } else {
          this.error = 'Could not sign in. Please try again.';
        }
      } finally {
        this.signingIn = false;
      }
    },
  },
  template: `
  <div class="login-screen">
    <svg class="route-svg" viewBox="0 0 900 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path class="route-path" id="routePath" d="M -40 640 C 120 600, 160 520, 260 480 S 420 380, 480 340 S 620 240, 680 200 S 820 100, 940 60" />
      <circle class="stop-dot d1" cx="260" cy="480" r="7" />
      <circle class="stop-dot d2" cx="480" cy="340" r="7" />
      <circle class="stop-dot d3" cx="680" cy="200" r="7" />
      <circle class="final-ring" cx="680" cy="200" r="16" />

      <!-- reusable vehicle shapes, drawn facing right (0°) so rotate="auto" orients them
           correctly as they follow the route path's curves. Each carries a real brand
           logo on its cargo box instead of a plain text badge. -->
      <defs>
        <symbol id="truckShape" viewBox="-24 -14 48 28">
          <rect x="-24" y="-11" width="30" height="18" rx="2" fill="#f4efe6" />
          <image href="assets/logos/sri-ambikas-seal.png" x="-22.5" y="-9.5" width="27" height="15" preserveAspectRatio="xMidYMid meet" />
          <path d="M 6 -11 L 20 -11 L 24 -2 L 24 7 L 6 7 Z" fill="#e6dfcf" />
          <rect x="10" y="-8" width="9" height="7" rx="1" fill="#2b3a5e" opacity=".85" />
          <circle cx="-14" cy="9" r="4.5" fill="#1a1f2e" /><circle cx="-14" cy="9" r="1.8" fill="#777" />
          <circle cx="16" cy="9" r="4.5" fill="#1a1f2e" /><circle cx="16" cy="9" r="1.8" fill="#777" />
        </symbol>
        <symbol id="vanShape" viewBox="-18 -12 36 24">
          <rect x="-17" y="-9" width="32" height="15" rx="5" fill="#f4efe6" />
          <image href="assets/logos/ambikas-oval.png" x="-15.5" y="-7.5" width="28" height="12" preserveAspectRatio="xMidYMid meet" />
          <rect x="9" y="-7" width="6" height="6" rx="1" fill="#2b3a5e" opacity=".85" />
          <circle cx="-9" cy="7" r="3.6" fill="#1a1f2e" /><circle cx="-9" cy="7" r="1.4" fill="#777" />
          <circle cx="10" cy="7" r="3.6" fill="#1a1f2e" /><circle cx="10" cy="7" r="1.4" fill="#777" />
        </symbol>
        <symbol id="truck2Shape" viewBox="-24 -14 48 28">
          <rect x="-24" y="-11" width="30" height="18" rx="2" fill="#f4efe6" />
          <image href="assets/logos/ooty-logo.png" x="-22.5" y="-9.5" width="27" height="15" preserveAspectRatio="xMidYMid meet" />
          <path d="M 6 -11 L 20 -11 L 24 -2 L 24 7 L 6 7 Z" fill="#e6dfcf" />
          <rect x="10" y="-8" width="9" height="7" rx="1" fill="#2b3a5e" opacity=".85" />
          <circle cx="-14" cy="9" r="4.5" fill="#1a1f2e" /><circle cx="-14" cy="9" r="1.8" fill="#777" />
          <circle cx="16" cy="9" r="4.5" fill="#1a1f2e" /><circle cx="16" cy="9" r="1.8" fill="#777" />
        </symbol>
      </defs>

      <use v-if="showVehicles" href="#truckShape" x="-24" y="-14" width="48" height="28" class="vehicle veh-1">
        <animateMotion dur="9s" begin="0s" repeatCount="indefinite" rotate="auto">
          <mpath href="#routePath" />
        </animateMotion>
      </use>
      <use v-if="showVehicles" href="#vanShape" x="-18" y="-12" width="36" height="24" class="vehicle veh-2">
        <animateMotion dur="7s" begin="2.4s" repeatCount="indefinite" rotate="auto">
          <mpath href="#routePath" />
        </animateMotion>
      </use>
      <use v-if="showVehicles" href="#truck2Shape" x="-24" y="-14" width="48" height="28" class="vehicle veh-3">
        <animateMotion dur="11s" begin="5.2s" repeatCount="indefinite" rotate="auto">
          <mpath href="#routePath" />
        </animateMotion>
      </use>
    </svg>

    <div class="login-card">
      <div class="login-eyebrow">TODAY'S RUN &middot; {{ today }}</div>
      <div class="brand" style="margin-bottom:22px;"><b>Sri Ambikas</b><span>Runsheet Tool</span></div>
      <h2 style="margin:0 0 4px;">Sign in</h2>
      <p class="hint" style="margin:0 0 18px;">Use the email and password an admin set up for you.</p>
      <div class="field">
        <label>Email</label>
        <input type="email" v-model="email" @keyup.enter="submit" autocomplete="username" autofocus />
      </div>
      <div class="field">
        <label>Password</label>
        <input type="password" v-model="password" @keyup.enter="submit" autocomplete="current-password" />
      </div>
      <div class="limit-banner" v-if="error">{{ error }}</div>
      <button class="primary login-btn" style="width:100%;margin-top:6px;" :disabled="signingIn" @click="submit">
        {{ signingIn ? 'Signing in…' : 'Sign in' }}
      </button>
    </div>
  </div>
  `,
};
