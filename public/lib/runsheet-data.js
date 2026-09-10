// public/lib/runsheet-data.js — turns a saved runsheet + the current product list into the
// DATA shape both the print view and the Excel export need: the main per-invoice table
// (preset columns, CTNS, RI, totals), the "All Round Items" distribution matrix, and the
// packing-type breakdown used for the Load Summary. Extracted out of print.js so both
// exports build on the exact same logic rather than two copies that could quietly drift
// apart from each other over time — every comment here is carried over unchanged from
// there, since the reasoning behind each piece hasn't changed, only where it lives.
export function buildRunsheetData(rs, products) {
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

// ctnOf and cell() live here too — both print.js's render() and the Excel export need the
// same pieces-to-cartons conversion and zero-as-dot display convention to stay consistent
// with each other and with the Builder.
// No ceiling — matches the Matrix Builder exactly, which shows the raw decimal on
// purpose (a fractional cartons figure is usually a sign of a wrong entry, and
// rounding it away here would hide that on the one document a driver actually acts
// on, which is worse than hiding it during entry).
export const ctnOf = (pcs, qty) => qty <= 1 ? pcs : pcs / qty;
