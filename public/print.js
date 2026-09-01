// public/print.js — plain JS, no framework. Fetches the saved runsheet + current product
// list, builds the same DATA shape this template's render() expects, then renders it.
// The render() function itself, and the math inside it, are kept verbatim from the
// supplied template — only how DATA gets built (fetched live instead of injected at
// build time) is different.
//
// This page opens in its own browser tab (via window.open from the builder), completely
// separate from the main Vue app — so unlike every other page, which gets its auth token
// attached automatically by lib/api.js, this one has to fetch its own token directly.
import { getIdToken } from './lib/firebase.js';
import { round2 } from './lib/round2.js';

(function () {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const SIGN_ROLES = ["Prepared By", "Arranged By", "Bill Counter Checked By", "Puller",
    "Round Item Checked By", "Loaded By", "Taken Over From Driver", "Hand Over By Admin", "Taken Over By Admin"];

  // No ceiling — matches the Matrix Builder exactly, which shows the raw decimal on
  // purpose (a fractional cartons figure is usually a sign of a wrong entry, and
  // rounding it away here would hide that on the one document a driver actually acts
  // on, which is worse than hiding it during entry). round2() at cell() below is
  // display-only cleanup for float precision, not a rounding rule.
  const ctnOf = (pcs, qty) => qty <= 1 ? pcs : pcs / qty;
  const cell = (v, cls = "") => { const rv = round2(v); return `<td class="num ${rv === 0 ? 'zero' : ''} ${cls}">${rv === 0 ? '·' : rv}</td>`; };

  async function main() {
    if (!id) { document.body.insertAdjacentHTML('afterbegin', '<div style="color:#fff;padding:16px;">Missing ?id= in the URL.</div>'); return; }
    let rs, products;
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Not signed in — open this from the Runsheet Builder while signed in.');
      const authHeader = { Authorization: `Bearer ${token}` };
      const [rsRes, prodRes] = await Promise.all([
        fetch(`/api/runsheets/${id}`, { headers: authHeader }),
        fetch('/api/products', { headers: authHeader }),
      ]);
      rs = await rsRes.json();
      if (!rsRes.ok) throw new Error(rs.error || 'failed to load runsheet');
      products = await prodRes.json();
      if (!prodRes.ok) throw new Error((products && products.error) || 'failed to load products');
    } catch (e) {
      document.body.insertAdjacentHTML('afterbegin', `<div style="color:#fff;padding:16px;">Failed to load: ${e.message}</div>`);
      return;
    }
    const DATA = buildData(rs, products);
    render(DATA);
    fit();
  }

  // ---- turns our saved runsheet + product list into the DATA shape the template expects ----
  function buildData(rs, products) {
    const productById = new Map(products.map(p => [p.id, p]));
    const stops = (rs.data && rs.data.stops) || [];
    const frequentColumns = ((rs.data && rs.data.frequentColumns) || []).filter(c => c.product_id).slice(0, 15);

    const cols = frequentColumns.map(c => {
      const p = productById.get(c.product_id);
      // The unit this specific product is meant to be entered/shown in — mixed units
      // across columns on the same sheet are expected, matching whatever each product's
      // own Settings say, same as the Builder already shows while building.
      const unit = (p && p.entry_unit === 'PCS') ? 'PCS' : 'CTN';
      return { code: c.code || (p ? p.name : ''), pack: p ? `${p.qty_per_ctn}/ctn` : '', qty: (p && p.qty_per_ctn) || 1, unit, _pid: c.product_id };
    });
    const columnProductIds = new Set(cols.map(c => c._pid));

    // pieces for one product on one stop, from our stored round_items (qty in cartons).
    // Kept as the exact decimal, not rounded — that's what makes the cartons figure
    // downstream (pieces ÷ qty/ctn) come out mathematically identical to the Builder's
    // own raw qty_ctn sum, rather than drifting from a round-trip through a rounded
    // intermediate value.
    function piecesFor(stop, productId, qtyPerCtn) {
      let pcs = 0;
      for (const ri of stop.round_items || []) {
        if (ri.product_id === productId) pcs += (Number(ri.qty_ctn) || 0) * (qtyPerCtn || 1);
      }
      return pcs;
    }

    // manual box-total CTNS, split by packing type; falls back to the pre-split `ctns`
    // field (as all-carton) for runsheets saved before this existed.
    function stopCtns(s) {
      if (s.ctns_carton != null || s.ctns_bag != null) {
        return { carton: Number(s.ctns_carton) || 0, bag: Number(s.ctns_bag) || 0 };
      }
      return { carton: Number(s.ctns) || 0, bag: 0 };
    }

    const rows = stops.map(s => {
      const c = stopCtns(s);
      return {
        inv: s.invoice_no || '', so: s.so_no || '', cust: s.customer || '', by: s.taken_by || '',
        cash: '', chq: '', ctn: c.carton + c.bag,
        pcs: cols.map(col => piecesFor(s, col._pid, col.qty)),
      };
    });

    // products that appear as round items on some stop but aren't one of the up-to-15 preset columns
    const matrixIds = new Set();
    for (const s of stops) for (const ri of s.round_items || []) if (!columnProductIds.has(ri.product_id)) matrixIds.add(ri.product_id);
    const matrixProducts = [...matrixIds].map(pid => productById.get(pid)).filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));

    // The Builder's per-row packing toggle applies to every existing AND new quantity in
    // that row at once, so every stop's saved entry for a given product should already
    // agree — this just reads back whichever one is actually stored, rather than assuming.
    function packingTypeFor(productId) {
      for (const s of stops) {
        const ri = (s.round_items || []).find(r => r.product_id === productId);
        if (ri) return ri.packing_type === 'bag' ? 'bag' : 'carton';
      }
      return 'carton';
    }

    // Same idea for the entry-unit toggle — the Builder now saves whichever unit was
    // actually active when each quantity was entered/last toggled, so this reads that
    // back rather than falling back to the product's current Settings default, which
    // could easily have changed since (or just never matched what was toggled for this
    // specific runsheet).
    function entryUnitFor(productId, product) {
      for (const s of stops) {
        const ri = (s.round_items || []).find(r => r.product_id === productId);
        if (ri && ri.entry_unit) return ri.entry_unit === 'PCS' ? 'PCS' : 'CTN';
      }
      return (product && product.entry_unit === 'PCS') ? 'PCS' : 'CTN';
    }

    const all_round = matrixProducts.map(p => ({
      name: p.name, qty: p.qty_per_ctn || 1,
      unit: entryUnitFor(p.id, p),
      packing: packingTypeFor(p.id),
      byInv: stops.map(s => piecesFor(s, p.id, p.qty_per_ctn)),
    }));

    const notes = stops.filter(s => s.note && s.note.trim()).map(s => `${s.so_no || ''}: ${s.note}`).join(' · ');

    // packing-type breakdown for delivery cost (3rd-party vendors bill cartons and bags
    // differently) — computed straight from the stored round items, not re-derived through
    // the pieces/ceiling conversion used elsewhere, so it stays exact. Manual CTNS gets the
    // same breakdown, since that's billed the same way.
    let cartonUnits = 0, bagUnits = 0, ctnsCartonUnits = 0, ctnsBagUnits = 0;
    for (const s of stops) {
      for (const ri of s.round_items || []) {
        const qty = Number(ri.qty_ctn) || 0;
        if (ri.packing_type === 'bag') bagUnits += qty; else cartonUnits += qty;
      }
      const c = stopCtns(s);
      ctnsCartonUnits += c.carton;
      ctnsBagUnits += c.bag;
    }

    return {
      meta: {
        sheet_no: rs.sheet_no || '', run_date: rs.run_date || '', area: rs.area || '',
        del_date: rs.delivery_date || '', del_man: rs.delivery_man || '', veh_no: rs.vehicle_no || '',
        notes,
      },
      cols, rows, all_round,
      packing: {
        cartons: Math.round(cartonUnits * 100) / 100, bags: Math.round(bagUnits * 100) / 100,
        ctnsCartons: Math.round(ctnsCartonUnits * 100) / 100, ctnsBags: Math.round(ctnsBagUnits * 100) / 100,
      },
    };
  }

  // ---- render(), kept verbatim from the supplied template (operates on a DATA object) ----
  function render(DATA) {
    const COLS = DATA.cols;
    const ROWS = DATA.rows;
    const ALL_ROUND = DATA.all_round;

    const arCtnByInv = ROWS.map((_, i) =>
      ALL_ROUND.reduce((s, p) => s + ctnOf(p.byInv[i] || 0, p.qty), 0));

    // r.pcs (built in buildData) is always tracked internally in pieces, regardless of
    // what gets displayed — this is purely a display-time conversion, using the exact
    // same math ctnOf already does for the "converted" footer row below. Cartons/RI/
    // TOTAL PKGS totals stay computed from the internal pieces figure throughout, never
    // from this display value, so mixing units on screen never mixes units in the math.
    const displayQty = (pcs, col) => col.unit === 'PCS' ? pcs : ctnOf(pcs, col.qty);

    document.title = "Runsheet " + DATA.meta.sheet_no;
    document.getElementById("m-sheet").textContent = DATA.meta.sheet_no;
    document.getElementById("m-date").textContent = DATA.meta.run_date;
    document.getElementById("m-area").textContent = DATA.meta.area;
    document.getElementById("m-deldate").textContent = DATA.meta.del_date;
    document.getElementById("m-delman").textContent = DATA.meta.del_man;
    document.getElementById("m-veh").textContent = DATA.meta.veh_no || "\u00a0";
    if (DATA.meta.notes) {
      const n = document.getElementById("m-notes");
      n.style.display = "block";
      n.innerHTML = "<b>NOTES</b>";
      n.appendChild(document.createTextNode(DATA.meta.notes));
    }

    /* ---- main table ---- */
    let h = `<thead>
      <tr class="group">
        <th colspan="7" style="background:var(--band)"></th>
        <th colspan="${COLS.length}">ROUND ITEMS</th>
        <th colspan="3" style="background:var(--band)"></th>
      </tr>
      <tr>
        <th style="width:22px">S.N</th><th style="width:56px">Invoice</th><th style="width:48px">S.Order</th>
        <th>Customer Name</th><th style="width:60px">Taken By</th>
        <th style="width:50px">Cash $</th><th style="width:54px">Cheque $</th>`;
    COLS.forEach(c => h += `<th style="width:38px">${c.code}<span class="pack">${c.pack} &middot; ${c.unit === 'PCS' ? 'Pcs' : 'Ctn'}</span></th>`);
    h += `<th style="width:40px">CTNS<span class="pack">box total</span></th>
          <th style="width:40px">RI<span class="pack">CTN</span></th>
          <th style="width:44px">TOTAL<span class="pack">PKGS</span></th></tr></thead><tbody>`;

    const colPcs = COLS.map(() => 0);
    let cashT = 0, chqT = 0, grandRoundCtn = 0, sheetTotal = 0;

    ROWS.forEach((r, i) => {
      const otherC = Number(r.ctn != null ? r.ctn : r.other) || 0;
      const roundCtn = r.pcs.reduce((s, p, j) => s + ctnOf(p, COLS[j].qty), 0);
      const riC = roundCtn + arCtnByInv[i];
      const total = otherC + riC;
      sheetTotal += total; cashT += Number(r.cash) || 0; chqT += Number(r.chq) || 0; grandRoundCtn += roundCtn;
      r.pcs.forEach((p, j) => colPcs[j] += p);
      h += `<tr><td>${i + 1}</td><td>${r.inv}</td><td>${r.so}</td>
        <td class="txt">${r.cust}</td><td class="by">${r.by}</td>
        <td class="num"></td><td class="num"></td>`;
      r.pcs.forEach((p, j) => h += cell(displayQty(p, COLS[j])));
      h += cell(otherC) + cell(riC) + `<td class="tot-col">${round2(total)}</td></tr>`;
    });

    const otherT = ROWS.reduce((s, r) => s + (Number(r.ctn != null ? r.ctn : r.other) || 0), 0);
    const arCtnT = arCtnByInv.reduce((a, b) => a + b, 0);
    const riT = grandRoundCtn + arCtnT;
    h += `<tfoot>
      <tr><td colspan="5" class="lbl">TOTAL ROUND ITEMS</td>
          <td></td><td></td>
          ${colPcs.map((p, j) => `<td>${round2(displayQty(p, COLS[j]))}</td>`).join("")}
          <td>${round2(otherT)}</td><td>${round2(riT)}</td><td class="tot-col">${round2(sheetTotal)}</td></tr>
      <tr class="ctn-row"><td colspan="7" class="lbl">CONVERTED — CARTONS / BAGS &nbsp;(pcs ÷ qty/ctn)</td>
          ${colPcs.map((p, j) => `<td>${round2(ctnOf(p, COLS[j].qty))}</td>`).join("")}
          <td>${round2(otherT)}</td><td>${round2(riT)}</td><td class="tot-col">${round2(sheetTotal)}</td></tr>
    </tfoot>`;
    document.getElementById("mainTable").innerHTML = h;
    document.getElementById("cashTot").innerHTML = "$ ____________";
    document.getElementById("chqTot").innerHTML = "$ ____________";

    /* ---- All Round Items distribution matrix ---- */
    let a = `<thead><tr><th style="text-align:left">Product</th><th style="width:38px">Unit</th>`;
    ROWS.forEach((r, i) => a += `<th class="inv"><span class="sn">${i + 1}·</span>${r.inv}</th>`);
    a += `<th style="width:32px">QTY</th><th style="width:34px">Q/C</th><th style="width:32px">CTN</th></tr></thead><tbody>`;

    let arCtnRowT = 0;
    ALL_ROUND.forEach(p => {
      const rowPcs = ROWS.reduce((s, _, i) => s + (p.byInv[i] || 0), 0);
      const rowCtn = ctnOf(rowPcs, p.qty);
      arCtnRowT += rowCtn;
      a += `<tr><td class="txt">${p.name}<span class="pack"> &middot; ${p.packing === 'bag' ? 'Bag' : 'Carton'}</span></td>`;
      a += `<td>${p.unit === 'PCS' ? 'Pcs' : (p.packing === 'bag' ? 'Bag' : 'Ctn')}</td>`;
      ROWS.forEach((_, i) => { const v = round2(displayQty(p.byInv[i] || 0, p)); a += `<td class="${v === 0 ? 'zero' : ''}">${v === 0 ? '·' : v}</td>`; });
      a += `<td class="rt">${round2(displayQty(rowPcs, p))}</td><td>${p.qty}</td><td class="rt">${round2(rowCtn)}</td></tr>`;
    });
    a += `</tbody><tfoot><tr><td colspan="2" class="lbl">Total per shop — cartons</td>`;
    ROWS.forEach((_, i) => a += `<td>${round2(arCtnByInv[i]) || "·"}</td>`);
    a += `<td></td><td></td><td class="rt">${round2(arCtnRowT)}</td></tr></tfoot>`;
    document.getElementById("allRound").innerHTML = a;

    /* ---- signatures ---- */
    document.getElementById("signRows").innerHTML =
      SIGN_ROLES.map(r => `<tr><td class="role">${r}</td><td class="blank"></td></tr>`).join("");

    /* ---- load summary ---- */
    const grand = otherT + grandRoundCtn + arCtnRowT;
    const pk = DATA.packing || { cartons: 0, bags: 0, ctnsCartons: 0, ctnsBags: 0 };
    document.getElementById("grandBox").innerHTML = `
      <tr><td class="lbl">CTNS (manual) — Carton</td><td class="val">${round2(pk.ctnsCartons) || 0}</td></tr>
      <tr><td class="lbl">CTNS (manual) — Bag</td><td class="val">${round2(pk.ctnsBags) || 0}</td></tr>
      <tr><td class="lbl">Round items — columns</td><td class="val">${round2(grandRoundCtn)}</td></tr>
      <tr><td class="lbl">Round items — matrix</td><td class="val">${round2(arCtnRowT)}</td></tr>
      <tr><td class="lbl">Round items — packed as Carton</td><td class="val">${round2(pk.cartons)}</td></tr>
      <tr><td class="lbl">Round items — packed as Bag</td><td class="val">${round2(pk.bags)}</td></tr>
      <tr><td class="lbl">Invoices on run</td><td class="val">${ROWS.length}</td></tr>
      <tr class="final"><td class="lbl">TOTAL PACKAGES LOADED</td><td class="val">${round2(grand)}</td></tr>`;
  }

  /* scale sheet to fit narrow screens */
  function fit() {
    const s = Math.min(1, (window.innerWidth - 24) / 1123);
    document.getElementById("scaler").style.transform = `scale(${s})`;
    document.getElementById("scaler").style.height = s < 1 ? (document.getElementById("sheet").offsetHeight * s) + "px" : "auto";
  }
  window.addEventListener("resize", fit);

  main();
})();
