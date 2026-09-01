# Deployment

This app needs a host that runs a real, persistent Node.js process (not a
serverless function that resets between requests) and gives it a **persistent
disk** for `data/runsheet.db` to survive restarts and redeploys. It's currently
running on **GoDaddy Node.js Hosting**.

## Environment variables / secrets the app needs

| Name | Required? | What it's for |
|---|---|---|
| `ANTHROPIC_API_KEY` | For the "From photo" feature | Anthropic API key |
| `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` | Yes (see below) | Firebase Admin credential, base64-encoded — **the recommended form**, see "The GoDaddy secrets issue" |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Alternative to the above | Same credential as raw JSON — works on some platforms, failed silently on GoDaddy |
| `GOOGLE_APPLICATION_CREDENTIALS` | Alternative to both above | A *file path* to the credential — only works if you can actually place a file on the host, which most PaaS platforms don't let you do ahead of time |
| `BOOTSTRAP_ADMIN_EMAIL` | Recommended | Promotes this exact email to admin on its next login, regardless of whether it was the first account to ever sign in. Safe to leave set permanently — see below. |
| `NODE_VERSION` | Sometimes needed | Some platforms default to an older Node than this app needs (`>=22.5.0`, for the built-in `node:sqlite` module) |

Generate the base64 value from `servicekey.json` (the file downloaded from
Firebase Console → Project settings → Service accounts → Generate new private
key) with:
```
node -e "console.log(require('fs').readFileSync('servicekey.json').toString('base64'))" > b64.txt
```
Copy the single long line from `b64.txt` into the secret, then **delete
`b64.txt`** — it's a plaintext copy of a real credential and shouldn't be left
sitting around, and should never be added to git.

## The "signed in, but No access" symptom — how to diagnose it

This app's sign-in has two genuinely separate halves, and it's easy to
mistake one kind of failure for the other:

- **Signing in itself happens entirely in the browser**, talking directly to
  Firebase using only the *public* config baked into the login page
  (`public/lib/firebase.js`). The server isn't involved. This part can
  succeed — showing "Signed in as [email]" — even when everything below is
  completely broken.
- **Every permission check happens on the server**, and needs the Firebase
  Admin credential (one of the three env vars above) to cryptographically
  verify that the browser's token is real. Without it, every check fails.

Both failure modes — genuinely having zero permissions, and the server being
unable to verify anyone at all — used to show the identical "No access yet"
page, which was actively misleading while debugging this. The app now tells
them apart:

- The **`/no-access` page** shows a different message and the real server
  error inline when it's a verification failure, not a permissions one.
- **Server startup logs** two sets of diagnostic lines (safe to leave in
  place permanently — they never print the secret itself):
  - `[env check] ...` (in `server.js`) — one line per secret, confirming
    presence and length side by side.
  - `[auth] ...` (in `auth.js`) — specifically for the Firebase credential:
    whether it's present, and whether it parses as valid JSON with the
    fields that actually matter (`project_id`, `private_key`,
    `client_email`).

If you ever see "signed in but no access" again on any platform, check these
logs first before assuming it's a permissions problem.

## The GoDaddy secrets issue (resolved)

On GoDaddy Node.js Hosting specifically, `FIREBASE_SERVICE_ACCOUNT_JSON`
(added correctly through their Secrets UI, in several different careful
formats, across multiple redeploys) never actually reached
`process.env` — the `[auth]` diagnostic consistently reported it as
completely unset, not malformed. The root cause on GoDaddy's side was never
pinned down.

**What fixed it:** switching to `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`
instead — the same credential, reduced to plain alphanumeric text with no
curly braces, quotes, or embedded newlines (the `private_key` field's own
literal `\n` sequences included) for a secrets UI to possibly mishandle. This
worked on the first attempt. If this app is ever moved to yet another
platform and hits the same symptom, reach for the base64 form first.

## Recovering admin access if the wrong account becomes admin

The very first person to ever sign in automatically becomes admin (so
someone has to be able to grant everyone else access). If someone other than
the intended admin happens to sign in first on a fresh deploy:

- **`BOOTSTRAP_ADMIN_EMAIL`** (see table above) fixes this with just an
  environment variable and a redeploy — no server shell access needed. Set
  it once and leave it; it only ever grants that one account admin, never
  removes access from anyone else.
- **`fix-admin.js`** (project root) is a one-time script for direct database
  access instead, if you have shell/SSH access to the host: `node
  fix-admin.js`. It prints everyone currently in the `users` table, then
  promotes `srini@sriambikas.com` specifically (edit the `EMAIL_TO_PROMOTE`
  constant at the top of the file to target a different account).

## Secret files — keep them out of git

`.gitignore` explicitly excludes `flattened.json`, `servicekey.json`, and
anything matching `*serviceaccount*.json` / `*service-account*.json` — added
after a close call where a temporary flattened copy of the service account
key almost got pushed to GitHub via an overly-broad `git add -A`. GitHub's
push protection caught it before it went public, but treat any key that ever
touched a commit (even one that was rejected) as compromised anyway —
generate a fresh one from Firebase Console rather than trust it.
