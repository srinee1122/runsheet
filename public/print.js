// public/print.js — plain JS, no framework. Fetches the saved runsheet + current product
// list, builds the same DATA shape this template's render() expects, then renders it.
// The render() function itself, and the math inside it, are kept verbatim from the
// supplied template — only how DATA gets built (fetched live instead of injected at
// build time) is different.
(function () {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const SIGN_ROLES = ["Prepared By", "Arranged By", "Bill Counter Checked By", "Puller",
    "Round Item Checked By", "Loaded By", "Taken Over From Driver", "Hand Over By Admin", "Taken Over By Admin"];

  const ctnOf = (pcs, qty) => qty <= 1 ? pcs : Math.ceil(pcs / qty);
  const cell = (v, cls = "") => `<td class="num ${v === 0 ? 'zero' : ''} ${cls}">${v === 0 ? '·' : v}</td>`;

  async function main() {
    if (!id) { document.body.insertAdjacentHTML('afterbegin', '<div style="color:#fff;padding:16px;">Missing ?id= in the URL.</div>'); return; }
    let rs, products;
    try {
      const [rsRes, prodRes] = await Promise.all([fetch(`/api/runsheets/${id}`), fetch('/api/products')]);
      rs = await rsRes.json();
      products = await prodRes.json();
      if (!rsRes.ok) throw new Error(rs.error || 'failed to load runsheet');
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
    const frequentColumns = ((rs.data && rs.data.frequentColumns) || []).filter(c => c.product_id).slice(0, 10);

    const cols = frequentColumns.map(c => {
      const p = productById.get(c.product_id);
      return { code: c.code || (p ? p.name : ''), pack: p ? `${p.qty_per_ctn}/ctn` : '', qty: (p && p.qty_per_ctn) || 1, _pid: c.product_id };
    });
    const columnProductIds = new Set(cols.map(c => c._pid));

    // pieces for one product on one stop, from our stored round_items (qty in cartons)
    function piecesFor(stop, productId, qtyPerCtn) {
      let pcs = 0;
      for (const ri of stop.round_items || []) {
        if (ri.product_id === productId) pcs += (Number(ri.qty_ctn) || 0) * (qtyPerCtn || 1);
      }
      return Math.round(pcs);
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

    // products that appear as round items on some stop but aren't one of the up-to-10 preset columns
    const matrixIds = new Set();
    for (const s of stops) for (const ri of s.round_items || []) if (!columnProductIds.has(ri.product_id)) matrixIds.add(ri.product_id);
    const matrixProducts = [...matrixIds].map(pid => productById.get(pid)).filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));

    const all_round = matrixProducts.map(p => ({
      name: p.name, qty: p.qty_per_ctn || 1,
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
    const arPcsByInv = ROWS.map((_, i) =>
      ALL_ROUND.reduce((s, p) => s + (p.byInv[i] || 0), 0));

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
        <th colspan="${COLS.length}">ROUND ITEMS — QUANTITY IN PIECES</th>
        <th colspan="3" style="background:var(--band)"></th>
      </tr>
      <tr>
        <th style="width:22px">S.N</th><th style="width:56px">Invoice</th><th style="width:48px">S.Order</th>
        <th>Customer Name</th><th style="width:60px">Taken By</th>
        <th style="width:50px">Cash $</th><th style="width:54px">Cheque $</th>`;
    COLS.forEach(c => h += `<th style="width:38px">${c.code}<span class="pack">${c.pack}</span></th>`);
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
      r.pcs.forEach(p => h += cell(p));
      h += cell(otherC) + cell(riC) + `<td class="tot-col">${total}</td></tr>`;
    });

    const otherT = ROWS.reduce((s, r) => s + (Number(r.ctn != null ? r.ctn : r.other) || 0), 0);
    const arCtnT = arCtnByInv.reduce((a, b) => a + b, 0);
    const riT = grandRoundCtn + arCtnT;
    h += `<tfoot>
      <tr><td colspan="5" class="lbl">TOTAL ROUND — PIECES</td>
          <td></td><td></td>
          ${colPcs.map(p => `<td>${p}</td>`).join("")}
          <td>${otherT}</td><td>${riT}</td><td class="tot-col">${sheetTotal}</td></tr>
      <tr class="ctn-row"><td colspan="7" class="lbl">CONVERTED — CARTONS / BAGS &nbsp;(pcs ÷ qty/ctn)</td>
          ${colPcs.map((p, j) => `<td>${ctnOf(p, COLS[j].qty)}</td>`).join("")}
          <td>${otherT}</td><td>${riT}</td><td class="tot-col">${sheetTotal}</td></tr>
    </tfoot>`;
    document.getElementById("mainTable").innerHTML = h;
    document.getElementById("cashTot").innerHTML = "$ ____________";
    document.getElementById("chqTot").innerHTML = "$ ____________";

    /* ---- All Round Items distribution matrix ---- */
    let a = `<thead><tr><th style="text-align:left">Product · pcs by invoice →</th>`;
    ROWS.forEach((r, i) => a += `<th class="inv"><span class="sn">${i + 1}·</span>${r.inv}</th>`);
    a += `<th style="width:32px">PCS</th><th style="width:34px">Q/C</th><th style="width:32px">CTN</th></tr></thead><tbody>`;

    let arPcsT = 0, arCtnRowT = 0;
    ALL_ROUND.forEach(p => {
      const rowPcs = ROWS.reduce((s, _, i) => s + (p.byInv[i] || 0), 0);
      const rowCtn = ctnOf(rowPcs, p.qty);
      arPcsT += rowPcs; arCtnRowT += rowCtn;
      a += `<tr><td class="txt">${p.name}</td>`;
      ROWS.forEach((_, i) => { const v = p.byInv[i] || 0; a += `<td class="${v === 0 ? 'zero' : ''}">${v === 0 ? '·' : v}</td>`; });
      a += `<td class="rt">${rowPcs}</td><td>${p.qty}</td><td class="rt">${rowCtn}</td></tr>`;
    });
    a += `</tbody><tfoot><tr><td class="lbl">Pieces per shop (driver drops)</td>`;
    ROWS.forEach((_, i) => a += `<td>${arPcsByInv[i] || "·"}</td>`);
    a += `<td>${arPcsT}</td><td></td><td>${arCtnRowT}</td></tr></tfoot>`;
    document.getElementById("allRound").innerHTML = a;

    /* ---- signatures ---- */
    document.getElementById("signRows").innerHTML =
      SIGN_ROLES.map(r => `<tr><td class="role">${r}</td><td class="blank"></td></tr>`).join("");

    /* ---- load summary ---- */
    const grand = otherT + grandRoundCtn + arCtnRowT;
    const pk = DATA.packing || { cartons: 0, bags: 0, ctnsCartons: 0, ctnsBags: 0 };
    document.getElementById("grandBox").innerHTML = `
      <tr><td class="lbl">CTNS (manual) — Carton</td><td class="val">${pk.ctnsCartons || 0}</td></tr>
      <tr><td class="lbl">CTNS (manual) — Bag</td><td class="val">${pk.ctnsBags || 0}</td></tr>
      <tr><td class="lbl">Round items — columns</td><td class="val">${grandRoundCtn}</td></tr>
      <tr><td class="lbl">Round items — matrix</td><td class="val">${arCtnRowT}</td></tr>
      <tr><td class="lbl">Round items — packed as Carton</td><td class="val">${pk.cartons}</td></tr>
      <tr><td class="lbl">Round items — packed as Bag</td><td class="val">${pk.bags}</td></tr>
      <tr><td class="lbl">Invoices on run</td><td class="val">${ROWS.length}</td></tr>
      <tr class="final"><td class="lbl">TOTAL PACKAGES LOADED</td><td class="val">${grand}</td></tr>`;
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
