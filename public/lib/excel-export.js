// public/lib/excel-export.js — builds and downloads an .xlsx workbook for a runsheet,
// using the exact same buildRunsheetData() transformation the print view uses, so the
// numbers in the spreadsheet always agree with the numbers on the printed sheet. Relies
// on the SheetJS (XLSX) global already loaded by index.html for the Item Master importer.
//
// Deliberately does NOT reuse print.js's "·" convention for a zero cell — that's a print-
// readability trick for a static page, not something you want in a spreadsheet where the
// whole point is being able to sum, filter, and calculate on the real numbers.
import { round2 } from './round2.js';
import { buildRunsheetData, ctnOf } from './runsheet-data.js';
import { Api } from './api.js';

export async function downloadRunsheetExcel(runsheetId) {
  const [rs, products] = await Promise.all([
    Api.get(`/api/runsheets/${runsheetId}`),
    Api.get('/api/products'),
  ]);

  const DATA = buildRunsheetData(rs, products);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, buildMainSheet(DATA), 'Runsheet');
  if (DATA.all_round.length) {
    window.XLSX.utils.book_append_sheet(wb, buildAllRoundSheet(DATA), 'All Round Items');
  }
  window.XLSX.utils.book_append_sheet(wb, buildSummarySheet(DATA), 'Summary');

  const filename = `Runsheet ${DATA.meta.sheet_no || runsheetId}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
  window.XLSX.writeFile(wb, filename);
}

function buildMainSheet(DATA) {
  const COLS = DATA.cols;
  const ROWS = DATA.rows;

  const aoa = [];
  aoa.push(['Sheet No', DATA.meta.sheet_no, '', 'Run Date', DATA.meta.run_date]);
  aoa.push(['Area', DATA.meta.area, '', 'Delivery Man', DATA.meta.del_man]);
  aoa.push(['Vehicle No', DATA.meta.veh_no, '', 'Delivery Date', DATA.meta.del_date]);
  if (DATA.meta.notes) aoa.push(['Notes', DATA.meta.notes]);
  aoa.push([]);

  const header = ['S.N', 'Invoice', 'S.Order', 'Customer', 'Taken By',
    ...COLS.map(c => `${c.code} (${c.unit === 'PCS' ? 'pcs' : 'ctn'}, ${c.pack})`),
    'CTNS (manual)', 'RI (ctn)', 'TOTAL PKGS'];
  aoa.push(header);

  const arCtnByInv = ROWS.map((_, i) =>
    DATA.all_round.reduce((s, p) => s + ctnOf(p.byInv[i] || 0, p.qty), 0));

  const displayQty = (pcs, col) => col.unit === 'PCS' ? pcs : ctnOf(pcs, col.qty);
  const colPcs = COLS.map(() => 0);
  let grandRoundCtn = 0, sheetTotal = 0;

  ROWS.forEach((r, i) => {
    const otherC = Number(r.ctn) || 0;
    const roundCtn = r.pcs.reduce((s, p, j) => s + ctnOf(p, COLS[j].qty), 0);
    const riC = roundCtn + arCtnByInv[i];
    const total = otherC + riC;
    sheetTotal += total; grandRoundCtn += roundCtn;
    r.pcs.forEach((p, j) => colPcs[j] += p);
    aoa.push([i + 1, r.inv, r.so, r.cust, r.by,
      ...r.pcs.map((p, j) => round2(displayQty(p, COLS[j]))),
      round2(otherC), round2(riC), round2(total)]);
  });

  const otherT = ROWS.reduce((s, r) => s + (Number(r.ctn) || 0), 0);
  const arCtnT = arCtnByInv.reduce((a, b) => a + b, 0);
  const riT = grandRoundCtn + arCtnT;
  aoa.push(['', '', '', '', 'TOTAL ROUND ITEMS',
    ...colPcs.map((p, j) => round2(displayQty(p, COLS[j]))),
    round2(otherT), round2(riT), round2(sheetTotal)]);

  const ws = window.XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 5 }, { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 12 },
    ...COLS.map(() => ({ wch: 12 })), { wch: 12 }, { wch: 10 }, { wch: 12 }];
  return ws;
}

function buildAllRoundSheet(DATA) {
  const ROWS = DATA.rows;
  const ALL_ROUND = DATA.all_round;
  const displayQty = (pcs, p) => p.unit === 'PCS' ? pcs : ctnOf(pcs, p.qty);

  const aoa = [];
  const header = ['Product', 'Packing', 'Unit', ...ROWS.map((r, i) => `${i + 1}. ${r.inv}`), 'QTY total', 'Qty/Ctn', 'CTN total'];
  aoa.push(header);

  const arCtnByInv = ROWS.map((_, i) =>
    ALL_ROUND.reduce((s, p) => s + ctnOf(p.byInv[i] || 0, p.qty), 0));
  let arCtnRowT = 0;

  ALL_ROUND.forEach(p => {
    const rowPcs = ROWS.reduce((s, _, i) => s + (p.byInv[i] || 0), 0);
    const rowCtn = ctnOf(rowPcs, p.qty);
    arCtnRowT += rowCtn;
    aoa.push([p.name, p.packing === 'bag' ? 'Bag' : 'Carton', p.unit === 'PCS' ? 'Pcs' : (p.packing === 'bag' ? 'Bag' : 'Ctn'),
      ...ROWS.map((_, i) => round2(displayQty(p.byInv[i] || 0, p))),
      round2(displayQty(rowPcs, p)), p.qty, round2(rowCtn)]);
  });

  aoa.push(['Total per shop — cartons', '', '', ...ROWS.map((_, i) => round2(arCtnByInv[i])), '', '', round2(arCtnRowT)]);

  const ws = window.XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 28 }, { wch: 10 }, { wch: 8 }, ...ROWS.map(() => ({ wch: 10 })), { wch: 10 }, { wch: 10 }, { wch: 10 }];
  return ws;
}

function buildSummarySheet(DATA) {
  const ROWS = DATA.rows;
  const ALL_ROUND = DATA.all_round;
  const arCtnByInv = ROWS.map((_, i) =>
    ALL_ROUND.reduce((s, p) => s + ctnOf(p.byInv[i] || 0, p.qty), 0));
  const arCtnRowT = arCtnByInv.reduce((a, b) => a + b, 0);

  let grandRoundCtn = 0;
  ROWS.forEach(r => { grandRoundCtn += r.pcs.reduce((s, p, j) => s + ctnOf(p, DATA.cols[j].qty), 0); });
  const otherT = ROWS.reduce((s, r) => s + (Number(r.ctn) || 0), 0);
  const grand = otherT + grandRoundCtn + arCtnRowT;
  const pk = DATA.packing || { cartons: 0, bags: 0, ctnsCartons: 0, ctnsBags: 0 };

  const aoa = [
    ['Load Summary', ''],
    ['CTNS (manual) — Carton', round2(pk.ctnsCartons) || 0],
    ['CTNS (manual) — Bag', round2(pk.ctnsBags) || 0],
    ['Round items — columns', round2(grandRoundCtn)],
    ['Round items — matrix', round2(arCtnRowT)],
    ['Round items — packed as Carton', round2(pk.cartons)],
    ['Round items — packed as Bag', round2(pk.bags)],
    ['Invoices on run', ROWS.length],
    ['TOTAL PACKAGES LOADED', round2(grand)],
  ];
  const ws = window.XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 30 }, { wch: 14 }];
  return ws;
}
