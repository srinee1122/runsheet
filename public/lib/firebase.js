// lib/firebase.js — Firebase Authentication for the browser. The v9+ "modular" SDK
// ships as genuine ES modules, loaded directly from Firebase's own CDN — same pattern
// this app already uses for its own code, no bundler or import map needed.
//
// firebaseConfig below points at the sa-runsheet Firebase project. These values
// identify *which* Firebase project to talk to, not who's signing in — they are not
// secret and are safe to commit to this repo (unlike the service-account key the
// server uses, which is). To point this at a different project later, get a fresh
// config from: Firebase Console → Project settings → General → "Your apps" → the web
// app (the </> icon).
const firebaseConfig = {
  apiKey: 'AIzaSyDkJUAPR_7RFQhuGCo_W9TGkKMZ8uDn7vI',
  authDomain: 'sa-runsheet.firebaseapp.com',
  projectId: 'sa-runsheet',
  storageBucket: 'sa-runsheet.firebasestorage.app',
  messagingSenderId: '818761938647',
  appId: '1:818761938647:web:c7820dc4abe565f991e292',
};

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function signOutUser() {
  return signOut(auth);
}

// Firebase restoring a persisted session (from a previous sign-in in this browser) is
// itself async — reading auth.currentUser before that first check completes can wrongly
// look like "nobody's signed in" even when they are. This resolves once, the first time
// Firebase settles that check, and is cached so every caller shares the same one wait
// rather than each subscribing separately.
let firstAuthState = null;
function waitForFirstAuthState() {
  if (!firstAuthState) {
    firstAuthState = new Promise((resolve) => {
      const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(u); });
    });
  }
  return firstAuthState;
}

// Resolves to the current user's ID token, letting Firebase silently refresh it first
// if it's close to expiring — that's what makes this async. Resolves to null if
// nobody's signed in (api.js treats that as "send the request with no auth header",
// which the server will correctly reject with 401). Safe to call immediately on page
// load from any page — waits for Firebase's session restore first, so it never races it.
export async function getIdToken() {
  await waitForFirstAuthState();
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

// Fires once immediately with whatever the current auth state already is, then again
// on every sign-in/out — the one thing app.js needs to decide whether to show the
// login page or the real app.
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}
