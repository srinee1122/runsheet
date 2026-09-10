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
import { buildRunsheetData, ctnOf } from './lib/runsheet-data.js';

(function () {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const SIGN_ROLES = ["Prepared By", "Arranged By", "Bill Counter Checked By", "Puller",
    "Round Item Checked By", "Loaded By", "Taken Over From Driver", "Hand Over By Admin", "Taken Over By Admin"];

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
    const DATA = buildRunsheetData(rs, products);
    render(DATA);
    fit();
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
