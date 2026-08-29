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

## Running it

```bash
cd runsheet-tool
npm install          # one-time, pulls in Express + Multer (pure JS, no compiling)
set ANTHROPIC_API_KEY=sk-ant-...      # Windows cmd; use $env:ANTHROPIC_API_KEY="..." in PowerShell
                                        # or export ANTHROPIC_API_KEY=... on macOS/Linux
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

## The math invariant

Everywhere in the app and on the print-out: **TOTAL PKGS = CTNS + RI**,
where CTNS is the manually-entered carton count and RI is every round item
for that stop converted to cartons. The builder computes this live per row
and for the whole sheet; the printed Load Summary's final "TOTAL PACKAGES
LOADED" line is the same figure.

## The one-page rule

A runsheet can hold at most **20 invoices**. The server rejects a save past
that limit as well, so it can't be bypassed by editing the browser state.

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
