# Sri Ambikas — Standalone Runsheet Tool

A standalone driver runsheet builder. It does **not** talk to Focus ERP, your
invoice system, or any other Sri Ambikas tool — every product, customer, and
saved sheet lives in its own local database file.

## What's inside

- `server.js` / `db.js` / `extraction-prompt.js` — the backend (Node.js + Express).
  Storage is SQLite via Node's built-in `node:sqlite` — **no native modules to
  compile**, which is why it deploys by copying files and running one command.
- `public/` — the browser app (Vue 3, loaded from a CDN, **no build step**):
  - `index.html` / `app.js` — shell, nav, and the name-picker login
  - `components/products.js`, `components/customers.js`, `components/settings.js`
  - `components/builder.js` — the runsheet builder (manual + photo flow)
  - `components/photo-review.js` — the photo review panel
  - `components/history.js`
  - `print.html` / `print.css` / `print.js` — the printed sheet. Plain
    HTML/CSS/vanilla JS on purpose (no Vue) so it stays pixel-stable and opens
    standalone.

## Requirements

- **Node.js 22.5 or newer** (for the built-in `node:sqlite` module — check
  with `node -v`; if you're on an older Node, install a current LTS from
  nodejs.org first).
- A machine that can stay on and reachable on your local network — one
  Windows PC or a small VM both work.
- An Anthropic API key, only needed for the "From photo" feature.
- A Firebase project with Email/Password sign-in enabled, for logging in —
  see **Users & sign-in** below for the one-time setup.

## Running it

```bash
cd runsheet-tool
npm install          # one-time, pulls in Express + Multer + Firebase Admin
set ANTHROPIC_API_KEY=sk-ant-...              # Windows cmd — the "from photo" feature
set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\serviceAccountKey.json   # login — see Users & sign-in below
                                        # use $env:VAR="..." in PowerShell, or export VAR=... on macOS/Linux
npm start
```

You'll see:

```
Sri Ambikas Runsheet Tool running at http://localhost:4500
Other machines on the same network: http://<this-PC's-LAN-IP>:4500
```

Open that address in a browser on the host machine, and the LAN address from
any other machine/tablet on the same network (find the host's LAN IP with
`ipconfig` on Windows or `ip addr` on Linux). Everyone shares the same
database file (`data/runsheet.db`), so History shows every clerk's sheets.

To keep it running in the background on Windows, the simplest options are
Task Scheduler ("run at startup") or a tool like `pm2` (`npm i -g pm2 && pm2
start server.js`). To change the port, set `PORT=xxxx` before `npm start`.

### Keeping the API key out of the shell history

Instead of exporting it every time, create a file named `.env` next to
`server.js` (do **not** commit or share this file):

```
ANTHROPIC_API_KEY=sk-ant-...
```

and start the server with:

```bash
node -r dotenv/config server.js
```

(run `npm install dotenv` once first if you want this option — it's not
included by default to keep the dependency list minimal).

## Users & sign-in

Everyone signs in with an email and password before they can use anything.
Firebase Authentication handles *who* someone is; this app's own database
decides *what they can access* — Firebase has no idea what a "module" is,
that's entirely local.

### One-time Firebase setup

1. Go to the [Firebase Console](https://console.firebase.google.com) →
   **Add project** → give it any name.
2. **Authentication** → **Sign-in method** → enable **Email/Password**.
   (No need for Google/social sign-in for an internal tool like this.)
3. **Authentication** → **Users** → **Add user** for each person — there's
   no self-signup, you control the whole list here. They can change their
   password later; for now just set a temporary one.
4. **Project settings** (gear icon) → scroll to "Your apps" → click the
   `</>` (Web) icon → register an app → copy the `firebaseConfig` object
   shown. Paste those values into `public/lib/firebase.js`, replacing the
   `REPLACE_ME` placeholders. These values identify *which* Firebase
   project to talk to, not who's signing in — they're not secret and are
   safe to commit.
5. **Project settings** → **Service accounts** → **Generate new private
   key** → downloads a JSON file. This one *is* secret — never commit it or
   paste it into chat. Point the server at it with an environment variable
   before starting it:
   ```
   set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\serviceAccountKey.json
   ```
   (On a host where writing a file isn't convenient, set
   `FIREBASE_SERVICE_ACCOUNT_JSON` to the file's full JSON contents
   instead — the server accepts either.)

### The first person to sign in becomes admin

There's no separate "create the first admin" step — whoever signs in
*first*, ever, is automatically made an admin with every module. Everyone
who signs in after that starts with **no access at all** until an admin
grants it in **Users & Permissions** (visible in the sidebar to admins
only). So sign in as yourself first, before handing out the other
credentials.

### Permissions

Access is granted per page — Runsheet Builder, History, Products,
Customers, Settings — plus a separate Admin flag that grants everything,
including managing everyone else's access. A person with only "Runsheet
Builder" can still see the product and customer lists while building a
sheet (it wouldn't work otherwise), but can't edit them — that needs the
Products/Customers module specifically. Permission checks happen on the
server, not just by hiding sidebar links, so they can't be bypassed by
calling the API directly.

A runsheet's "created by" is taken from the signed-in person's own
verified identity — nobody can attribute a sheet to someone else.

### Adding a new page or module

Every new permission-gated page needs an entry in exactly four places —
each one small and deliberately hard to silently skip:

1. **`db.js`** — add the key to the `MODULES` array (adds the database
   column and makes the server aware of it).
2. **`server.js`** — gate the new page's routes with `requireModule('key')`
   or `requireAnyModule(...)` as appropriate.
3. **`public/lib/modules.js`** — add `{ key, label }`. The sidebar link and
   the Users & Permissions column for the new page are both generated
   *from* this list, so nothing else needs updating for those two.
4. **`public/app.js`**'s `routes` array — the one piece that can't be
   folded into a shared list, since every page renders a different Vue
   component. Give it `meta: { module: 'key' }` (matching the same key
   used everywhere else above) so the route guard picks it up.

`auth.js` needs nothing added — it reads `db.js`'s `MODULES` generically,
so it already knows about any key added there.

## Loading your real Products / Customers lists

Both the **Products** and **Customers** pages have an **Import** button that accepts
your Item Master / Customer Master **directly as `.xlsx`** (or `.csv`) — no need to
export or convert anything first. Columns are matched by name, so the file can use
your source system's exact headers:

**Products** ← Item Master columns: `Name`, `Code`, `Supplier`, `Brand`, `Category`,
`Sub-category`, `Sub-category 2`, `Base unit`, `Group`, `Item type`, `Qty/Ctn`,
`Selling rate`. All of these are stored and shown in the Products table for reference;
`Qty/Ctn` (mapped to `qty_per_ctn`) is the one the runsheet math actually uses.
Round-item is **not** part of the Item Master — flag it yourself on the Products page,
and re-importing later never overwrites that flag.

**Customers** ← Customer Master columns: `Name`, `Code`, `Segment`, `Area`, `Contact`,
`Chain store`, `Address`, `Postal code`, `Mobile`, `WhatsApp`, `ROC no`.

Re-importing a name that already exists **updates** that row instead of creating a
duplicate, so you can re-run an import after a fresh export from your source system.
Both pages also let you search across every column shown (name, code, brand, area,
contact, etc.) — handy for looking something up even though the runsheet builder
itself only needs the name and Qty/Ctn.

## Round items

**Any product can be a round item.** When adding a round item to a stop, you get two
modes:

- **Regular round item** — a short dropdown of products you've flagged as "Regular
  round item" on the Products page. Flag your commonly-used bulk items here so they're
  quick to find instead of typing a search every time.
- **Other round item** — search across the whole catalog for anything not in that
  shortlist.

Either mode can add any product; the split just makes the common ones faster to reach.
This is separate from Settings → **Frequent round-item columns**, which controls which
up-to-10 products get their own dedicated column at the top of the printed sheet (with
a short code, e.g. `OG 5K`) — everything else still prints correctly, just in the "All
Round Items" matrix at the bottom instead.

## Packing type (Carton vs Bag)

Every product has a **Packing type** — Carton or Bag — used purely to tell delivery
cost apart, since 3rd-party vendors bill the two differently. It never changes any of
the carton/package counts elsewhere in the app.

- Set the default per product on the **Products page**, or inline next to each entry
  in Settings → **Frequent round-item columns** (both write to the same product
  record, so it stays in sync everywhere that product is used).
- When you add a round item to a stop in the **Runsheet Builder**, the packing type
  auto-fills from that product's default — but you can override it right there for a
  one-off delivery that happens to differ (e.g. the supplier substituted a bag for a
  carton that day). The override is saved with that specific round item, not the
  product.
- The printed sheet's **Load Summary** shows a Carton/Bag breakdown (in cartons-
  equivalent units) across the whole run, computed straight from what was actually
  entered — the figure to hand your delivery vendor for cost calculation.
- The manual **CTNS** field on each stop is split the same way — enter separate
  Carton and Bag counts for the box total the packing team counted. Both count
  identically toward CTNS and TOTAL PKGS; the split only feeds the Load Summary's
  billing breakdown. Runsheets saved before this existed still open fine — their
  old single CTNS number is treated as all-carton.

## Entry unit (Cartons vs Pieces)

Every product also has an **Entry unit** — Cartons or Pieces — controlling what
unit its round-item quantity field defaults to and displays as. Some products are
naturally counted in whole cartons; others (loose items, small packs) are easier
to count piece by piece. Either way it's always **stored** as cartons underneath
(same `qty_ctn` used everywhere else) — this only changes what the entry field
shows you and expects.

- Set it per product on the **Products page**, or inline next to Packing in
  Settings → **Frequent round-item columns** (same as Packing, both write to
  the product record, so it stays in sync everywhere).
- In **List view**, the Unit dropdown on the round-item row auto-fills from the
  product's setting when you pick it, same as Packing — still changeable per
  add if needed.
- In **Matrix view**, each column/row's cell shows and accepts quantities in
  that product's own entry unit directly (a small "pcs" or "ctn" label makes
  it clear which). Whatever you type stays exactly as typed — the cell is
  never silently reformatted while you're entering it, even for a qty/ctn
  that doesn't divide evenly. All the totals shown (column totals, RI, TOTAL
  PKGS) are still in cartons — the canonical unit — so they stay comparable
  and correct even when different products on the same sheet use different
  entry units. One caveat: only the cartons figure is actually saved, so if a
  piece-count doesn't divide evenly into cartons, *reopening* a saved sheet
  later can show a very slightly different number in that cell than what was
  originally typed (e.g. 100 pieces at qty/ctn 7 reopens as 100.03) — a small
  rounding artifact on reload only, never during entry, and it never affects
  any total or the printed sheet.

## Two ways to build a sheet: List view and Matrix view

The Runsheet Builder has a **List view** / **Matrix view** toggle near the top.
Both edit the exact same stops — switch between them anytime with nothing lost,
mid-sheet, even mid-edit.

- **List view** (the original) — one card per stop, add round items one at a
  time through the picker. Best for a handful of stops, or when you want the
  full per-item detail (packing-type override, "prints in top column" hint,
  etc.) visible as you go.
- **Matrix view** — laid out like the printed sheet itself, in two parts.
  Both tables size their columns dynamically to fit the screen — as you add
  stops or preset columns, every column shrinks together to keep the whole
  sheet visible without side-scrolling, and widens back out to use the
  available space when there's less on it. There's a sensible floor below
  which columns would stop being usable (a number you can't read isn't
  useful) — only past that point, which realistically means an unusually
  wide sheet on a narrow window, does the page fall back to horizontal
  scrolling.
  - A **main table** with one row per stop — S.N, Invoice, S.Order, Customer,
    Taken By, then a **Pre picked** group (Carton / Bag — the manual CTNS
    box total), Note, a **Round items** group (one column per preset
    product), an **RI** group (Carton / Bag — every round item on that stop,
    split by its packing type), and TOTAL PKGS, all computed live as you
    type. Pre Picked sits right after Taken By — not at the far end — since
    it's filled in on nearly every stop; keeping it close cuts how far Tab
    has to travel to reach it. Type a cartons quantity straight into a
    preset column's cell for that stop; clear it to remove it. The three
    groups are color-coded so it's clear at a glance which cells belong
    together.
  - **Enter's landing spot depends on where you press it.** From the
    Invoice field specifically, it stays in Invoice and moves down to the
    next row — invoice numbers are usually filled in last, as a pass
    straight down that column once everything else is in. From anywhere
    else in the row, it jumps to Sales Order of the next row instead, since
    that's normally known up front (the invoice number often isn't yet).
    Either way, Enter on the last row adds a new stop first and lands on
    the same field there, so a clerk can keep entering stop after stop
    without reaching for "+ Add stop".
  - **Arrow keys move around the grid** in the main table (and Left/Right
    also work in the All Round Items grid below it) — Up/Down move to the
    same column in the row above/below; Left/Right move to the previous/next
    field, but only once the cursor is already at that edge of the current
    text, so normal in-field cursor movement while editing is never
    interrupted. Reaching the end of a row with Right wraps to the start of
    the next one, the same way Tab already does.
  - **Reorder a stop by dragging its S.N cell** — hover it and the pointer
    turns into a grab handle; drag the row up or down and drop it where it
    belongs. Dragging only starts from that cell, never from clicking into
    an input, so normal data entry is unaffected. The &uarr;/&darr; buttons
    in the Actions column still work exactly as before too — drag-and-drop
    doesn't work reliably on touch devices, so they stay as the fallback
    for anyone building a sheet on a tablet.
  - An **All Round Items** grid below it — same idea as the printed matrix,
    with stops as columns (headed with a rotated "N·Invoice" label, so a
    long invoice number doesn't force the column wide) and everything *not*
    set up as a preset column running down as rows. A product's spot always
    matches exactly where it'll print — move it in or out of Settings'
    frequent columns and it moves between the two sections here too.
  - Rows start out as whatever's flagged "Regular round item", set up as a
    frequent column, or already has a quantity somewhere on the sheet. To add
    another, use the search field in the last row of the table, right under
    the Product column — since any product can be a round item, there's no
    Regular/Other split to pick from here, just search and it's added the
    moment you land on an exact match (typing the full name, or picking a
    suggestion). The field clears itself immediately after, so you can keep
    typing the next product name straight away — no button, no pause. Remove
    an empty row with its &times;.
  - **The product itself is editable, not just its quantities** — if the
    wrong product was picked for a row, search for the right one right there
    in the Product column and it swaps in, carrying over every quantity
    already typed for that row (re-tagged to the corrected product, not
    lost) along with the row's Pack/Unit settings. It won't offer a product
    that's already used elsewhere on the sheet, and typing something that
    doesn't match anything just reverts the field to what the row actually
    still is — it never leaves unconfirmed text sitting there looking like
    a change that didn't really happen. Enter jumps to the Product field of
    the next row, no matter which column you press it from.
  - Each All Round Items row has two small single-click toggle buttons that
    stay visible without scrolling past however many stop columns are on the
    sheet: a **Pack** toggle right next to the product name (Ctn/Bag — click
    to flip), and a separate **Unit** column (Pcs, or whatever Pack currently
    says — Ctn or Bag — since counting "one whole unit" means one bag when
    it's packed as a bag, not one carton). Both apply to every quantity typed
    into that row; preset columns use the product's own default automatically
    instead. Switching a row's unit re-converts every quantity already
    entered in it (from the canonical stored cartons figure) so a cell never
    silently means something different after a toggle. Neither has room for
    a per-cell override in a grid; for a one-off that genuinely needs to
    differ, switch to List view
    for that single item — the override there is per-entry.

## The math invariant

Everywhere in the app and on the print-out: **TOTAL PKGS = CTNS + RI**,
where CTNS is the manually-entered carton count and RI is every round item
for that stop converted to cartons. The builder computes this live per row
and for the whole sheet; the printed Load Summary's final "TOTAL PACKAGES
LOADED" line is the same figure.

## Background auto-save (drafts)

The Runsheet Builder saves your work automatically as you go — closing the
tab, switching to another tab, or the browser crashing mid-edit won't lose
what you've built.

- Any edit (List view, Matrix view, or the header fields) schedules a save
  about 2.5 seconds after you stop — long enough not to fire on every
  keystroke, short enough that little is ever at risk.
- Switching tabs or closing the page flushes immediately instead of waiting
  out that delay, so a fast exit doesn't outrun the debounce.
- The very first auto-save on a brand-new sheet creates it in the database
  (the URL updates to `/builder/<id>` automatically) exactly the same way
  clicking Save does; every edit after that updates the same record. A
  sheet you never touch is never auto-saved — only real edits trigger it.
- It's the exact same save path Save and Print use, so it gets the same
  version-conflict protection for free. If someone else has saved the same
  sheet in the meantime, auto-save pauses quietly (a small notice appears,
  no popup while you're mid-edit) rather than risking an overwrite —
  resolving it is just clicking Save, which shows the normal reload-or-
  keep-working choice.
- The header shows a quiet status ("draft saved automatically" /
  "saving draft…") so there's some visible confidence it's working. An
  auto-saved sheet shows up in **History** and reopens with everything
  intact, same as a manually-saved one.

## The one-page rule

A runsheet can hold at most **20 invoices**. The server rejects a save past
that limit as well, so it can't be bypassed by editing the browser state.

## Multiple clerks at once

Several people can use this at the same time from different machines — that's
what the shared server + shared database file are for. There's no live sync
between open browser tabs (you won't see someone else's edit appear on your
screen as they type), but saves are protected: each runsheet carries a
version number, and if you try to save a sheet that someone else has changed
since you opened it, the save is rejected rather than silently overwriting
their work — you'll be asked whether to reload the latest version (replacing
what's on your screen) or keep working and try again later. In practice this
only comes up if two people happen to open and edit the *same* runsheet at
the *same* time, which is uncommon if each clerk is building their own route
sheet.

## Photo flow notes

- Photos are downscaled in the browser (~2000px longest edge, JPEG ~0.85)
  before upload, then sent to the Anthropic API (model `claude-sonnet-4-6`)
  three at a time.
- Multi-page sales orders are merged by SO number: round items are unioned,
  the stamped box is taken from whichever page has it, and notes are
  combined.
- Nothing is added to the runsheet until you press **Confirm** on that
  sales order in the review panel — struck-out round items are shown
  (crossed out) for transparency but are excluded from the totals and can
  never reach the grid.
- Because this tool has no invoice number lookup, the Invoice No field is
  left empty and highlighted after a photo-confirm — key it in by hand.

## A note on the print template and product changes

The printed sheet fetches the **current** Products list (for pack sizes and
qty/ctn) at print time, alongside the runsheet's own saved stop data. If you
edit a product's qty/ctn *after* a sheet was built, reprinting that old
sheet will use the new number. For an internal same-day tool this is
rarely an issue, but it's worth knowing if you ever reprint a much older
sheet after a product correction.

**Print always saves first.** The print page reads the runsheet from the
database, not from whatever's currently on screen — so clicking **Print**
saves the sheet (same as clicking Save) before opening the print tab. That
way the printed sheet always matches what you were just looking at, even if
you never explicitly clicked Save.
