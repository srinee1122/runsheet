// public/lib/excel-export.js — builds and downloads a fully formatted .xlsx for a
// runsheet, laid out to closely match the printed PDF (print.js/print.html): the same
// company header, the same grouped/bordered main table, the same All Round Items matrix,
// signatures, and Load Summary — not a raw data dump. This file is meant to work as a
// standalone backup that can be opened and printed directly if the app itself is ever
// unavailable, so the formatting IS the point, not an afterthought.
//
// Uses ExcelJS (window.ExcelJS), a separate library from the SheetJS (window.XLSX)
// already loaded for reading Item/Customer Master import files — confirmed directly
// (by inspecting a written file's raw XML) that SheetJS's free tier does not actually
// write cell styling at all, silently dropping fonts/fills/borders even when assigned;
// ExcelJS does write them for real, which this export depends on.
import { buildRunsheetData, ctnOf } from './runsheet-data.js';
import { round2 } from './round2.js';
import { Api } from './api.js';

const SIGN_ROLES = ["Prepared By", "Arranged By", "Bill Counter Checked By", "Puller",
  "Round Item Checked By", "Loaded By", "Taken Over From Driver", "Hand Over By Admin", "Taken Over By Admin"];

const THIN = { style: 'thin', color: { argb: 'FF999999' } };
const BORDER_ALL = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
const BAND_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD8E2F0' } };
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F3F3' } };

export async function downloadRunsheetExcel(runsheetId) {
  const [rs, products] = await Promise.all([
    Api.get(`/api/runsheets/${runsheetId}`),
    Api.get('/api/products'),
  ]);
  const DATA = buildRunsheetData(rs, products);
  const wb = buildRunsheetWorkbook(DATA);

  const filename = `Runsheet ${DATA.meta.sheet_no || runsheetId}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement('a');
  a.href = url; a.download = filename;
  window.document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// Separated from the download trigger above specifically so this part — the actual
// formatted content — can be built and inspected directly (e.g. in tests) without needing
// any browser-only download APIs at all.
export function buildRunsheetWorkbook(DATA) {
  const wb = new window.ExcelJS.Workbook();
  wb.creator = 'Sri Ambikas Runsheet Tool';
  const ws = wb.addWorksheet('Runsheet', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { top: 0.4, bottom: 0.4, left: 0.3, right: 0.3, header: 0.2, footer: 0.2 } },
  });

  let r = 1;
  r = writeHeader(ws, DATA, r);
  r += 1;
  const mainHeaderRow = r + 1; // writeMainTable's group-header band comes first, then the column-header row
  r = writeMainTable(ws, DATA, r);
  r += 1;
  if (DATA.all_round.length) {
    r = writeAllRoundTable(ws, DATA, r);
    r += 1;
  }
  r = writeSignaturesAndSummary(ws, DATA, r);

  // Freeze panes: keeps the column-header row visible on screen while scrolling through a
  // long list of invoices, exactly like the header row of a normal table would.
  ws.views = [{ state: 'frozen', ySplit: mainHeaderRow, xSplit: 0 }];
  // Print titles: repeats that same header row at the top of every printed page. Without
  // this, a runsheet with enough invoices to spill onto a second printed page would show
  // page 2 as a block of numbers with no column labels at all -- exactly the kind of thing
  // that defeats a document meant to be read and acted on while printed.
  ws.pageSetup.printTitlesRow = `${mainHeaderRow}:${mainHeaderRow}`;

  return wb;
}

const totalCols = (DATA) => 7 + DATA.cols.length + 3; // S.N..Cheque$ (7) + preset cols + CTNS/RI/TOTAL (3)

function writeHeader(ws, DATA, r) {
  const lastCol = Math.max(totalCols(DATA), 8);
  merge(ws, r, 1, r, 4);
  cell(ws, r, 1, 'SRI AMBIKAS PTE LTD', { font: { bold: true, size: 14 } });
  merge(ws, r, 5, r, lastCol);
  cell(ws, r, 5, 'RUNSHEET', { font: { bold: true, size: 14 }, alignment: { horizontal: 'right' } });
  r++;
  merge(ws, r, 1, r, 4);
  cell(ws, r, 1, '30 Boon Lay Way, #01-02 Mapletree Logistics Trust, Singapore 609957', { font: { size: 9, color: { argb: 'FF555555' } } });
  merge(ws, r, 5, r, lastCol);
  cell(ws, r, 5, `Sheet No: ${DATA.meta.sheet_no || ''}`, { font: { bold: true }, alignment: { horizontal: 'right' } });
  r++;
  merge(ws, r, 1, r, 4);
  cell(ws, r, 1, 'Tel: 6262 1234 · Fax: 6588 8251 · admin@sriambikas.com', { font: { size: 9, color: { argb: 'FF555555' } } });
  r++;
  const kv = [['Run Date', DATA.meta.run_date], ['Area', DATA.meta.area], ['Delivery Date', DATA.meta.del_date],
    ['Delivery Man', DATA.meta.del_man], ['Vehicle No', DATA.meta.veh_no]];
  let c = 1;
  kv.forEach(([label, val]) => {
    cell(ws, r, c, label, { font: { bold: true, size: 9 }, alignment: { horizontal: 'right' } });
    cell(ws, r, c + 1, val || '', { font: { size: 10 } });
    c += 2;
  });
  r++;
  if (DATA.meta.notes) {
    merge(ws, r, 1, r, lastCol);
    cell(ws, r, 1, 'NOTES: ' + DATA.meta.notes, { font: { italic: true, size: 9 } });
    r++;
  }
  return r;
}

function writeMainTable(ws, DATA, startRow) {
  const COLS = DATA.cols;
  const ROWS = DATA.rows;
  let r = startRow;

  merge(ws, r, 1, r, 7);
  cell(ws, r, 1, '', { fill: BAND_FILL });
  if (COLS.length) {
    merge(ws, r, 8, r, 7 + COLS.length);
    cell(ws, r, 8, 'ROUND ITEMS', { font: { bold: true }, alignment: { horizontal: 'center' }, fill: HEADER_FILL, border: BORDER_ALL });
  }
  merge(ws, r, 7 + COLS.length + 1, r, 7 + COLS.length + 3);
  cell(ws, r, 7 + COLS.length + 1, '', { fill: BAND_FILL });
  r++;

  const headerRow = r;
  const headers = ['S.N', 'Invoice', 'S.Order', 'Customer', 'Taken By', 'Cash $', 'Cheque $',
    ...COLS.map(c => `${c.code}\n${c.pack} · ${c.unit === 'PCS' ? 'Pcs' : 'Ctn'}`),
    'CTNS\nbox total', 'RI\nCTN', 'TOTAL\nPKGS'];
  headers.forEach((h, i) => cell(ws, r, i + 1, h, { font: { bold: true, size: 9 }, alignment: { horizontal: 'center', wrapText: true, vertical: 'middle' }, fill: HEADER_FILL, border: BORDER_ALL }));
  ws.getRow(r).height = 28;
  r++;

  const arCtnByInv = ROWS.map((_, i) => DATA.all_round.reduce((s, p) => s + ctnOf(p.byInv[i] || 0, p.qty), 0));
  const displayQty = (pcs, col) => col.unit === 'PCS' ? pcs : ctnOf(pcs, col.qty);
  const colPcs = COLS.map(() => 0);
  let grandRoundCtn = 0, sheetTotal = 0;

  ROWS.forEach((row, i) => {
    const otherC = Number(row.ctn) || 0;
    const roundCtn = row.pcs.reduce((s, p, j) => s + ctnOf(p, COLS[j].qty), 0);
    const riC = roundCtn + arCtnByInv[i];
    const total = otherC + riC;
    sheetTotal += total; grandRoundCtn += roundCtn;
    row.pcs.forEach((p, j) => colPcs[j] += p);

    const vals = [i + 1, row.inv, row.so, row.cust, row.by, '', '',
      ...row.pcs.map((p, j) => round2(displayQty(p, COLS[j]))),
      round2(otherC), round2(riC), round2(total)];
    vals.forEach((v, j) => cell(ws, r, j + 1, v, { font: { size: 9 }, border: BORDER_ALL, alignment: j >= 3 && j <= 4 ? { horizontal: 'left' } : { horizontal: 'center' } }));
    r++;
  });

  const otherT = ROWS.reduce((s, row) => s + (Number(row.ctn) || 0), 0);
  const arCtnT = arCtnByInv.reduce((a, b) => a + b, 0);
  const riT = grandRoundCtn + arCtnT;
  const footVals = ['', '', '', '', 'TOTAL ROUND ITEMS', '', '',
    ...colPcs.map((p, j) => round2(displayQty(p, COLS[j]))),
    round2(otherT), round2(riT), round2(sheetTotal)];
  footVals.forEach((v, j) => cell(ws, r, j + 1, v, { font: { bold: true, size: 9 }, border: BORDER_ALL, fill: TOTAL_FILL, alignment: { horizontal: j === 4 ? 'right' : 'center' } }));
  merge(ws, r, 1, r, 5);
  r++;

  const widths = [5, 11, 9, 20, 10, 9, 9, ...COLS.map(() => 10), 9, 8, 9];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  return r;
}

function writeAllRoundTable(ws, DATA, startRow) {
  const ROWS = DATA.rows;
  const ALL_ROUND = DATA.all_round;
  const displayQty = (pcs, p) => p.unit === 'PCS' ? pcs : ctnOf(pcs, p.qty);
  let r = startRow;

  merge(ws, r, 1, r, Math.max(totalCols(DATA), 8));
  cell(ws, r, 1, 'ALL ROUND ITEMS — distribution by invoice', { font: { bold: true, size: 11 } });
  r++;

  const headers = ['Product', 'Packing', 'Unit', ...ROWS.map((row, i) => `${i + 1}. ${row.inv}`), 'QTY', 'Q/C', 'CTN'];
  headers.forEach((h, i) => cell(ws, r, i + 1, h, { font: { bold: true, size: 9 }, alignment: { horizontal: 'center', wrapText: true }, fill: HEADER_FILL, border: BORDER_ALL }));
  r++;

  const arCtnByInv = ROWS.map((_, i) => ALL_ROUND.reduce((s, p) => s + ctnOf(p.byInv[i] || 0, p.qty), 0));
  let arCtnRowT = 0;
  ALL_ROUND.forEach(p => {
    const rowPcs = ROWS.reduce((s, _, i) => s + (p.byInv[i] || 0), 0);
    const rowCtn = ctnOf(rowPcs, p.qty);
    arCtnRowT += rowCtn;
    const vals = [p.name, p.packing === 'bag' ? 'Bag' : 'Carton', p.unit === 'PCS' ? 'Pcs' : (p.packing === 'bag' ? 'Bag' : 'Ctn'),
      ...ROWS.map((_, i) => round2(displayQty(p.byInv[i] || 0, p))),
      round2(displayQty(rowPcs, p)), p.qty, round2(rowCtn)];
    vals.forEach((v, j) => cell(ws, r, j + 1, v, { font: { size: 9 }, border: BORDER_ALL, alignment: j === 0 ? { horizontal: 'left' } : { horizontal: 'center' } }));
    r++;
  });

  const footVals = ['Total per shop — cartons', '', '', ...ROWS.map((_, i) => round2(arCtnByInv[i])), '', '', round2(arCtnRowT)];
  footVals.forEach((v, j) => cell(ws, r, j + 1, v, { font: { bold: true, size: 9 }, border: BORDER_ALL, fill: TOTAL_FILL, alignment: { horizontal: j === 0 ? 'left' : 'center' } }));
  merge(ws, r, 1, r, 3);
  r++;
  return r;
}

function writeSignaturesAndSummary(ws, DATA, startRow) {
  const ROWS = DATA.rows;
  const ALL_ROUND = DATA.all_round;
  let r = startRow;

  merge(ws, r, 1, r, 3);
  cell(ws, r, 1, 'Checked & Handover', { font: { bold: true, size: 11 } });
  const summaryStartCol = 5;
  merge(ws, r, summaryStartCol, r, summaryStartCol + 1);
  cell(ws, r, summaryStartCol, 'Load Summary', { font: { bold: true, size: 11 } });
  r++;
  const sectionStart = r;

  SIGN_ROLES.forEach(role => {
    cell(ws, r, 1, role, { font: { size: 9 }, border: BORDER_ALL });
    merge(ws, r, 2, r, 3);
    cell(ws, r, 2, '', { border: BORDER_ALL });
    r++;
  });

  const arCtnByInv = ROWS.map((_, i) => ALL_ROUND.reduce((s, p) => s + ctnOf(p.byInv[i] || 0, p.qty), 0));
  const arCtnRowT = arCtnByInv.reduce((a, b) => a + b, 0);
  let grandRoundCtn = 0;
  ROWS.forEach(row => { grandRoundCtn += row.pcs.reduce((s, p, j) => s + ctnOf(p, DATA.cols[j].qty), 0); });
  const otherT = ROWS.reduce((s, row) => s + (Number(row.ctn) || 0), 0);
  const grand = otherT + grandRoundCtn + arCtnRowT;
  const pk = DATA.packing || { cartons: 0, bags: 0, ctnsCartons: 0, ctnsBags: 0 };

  const summaryRows = [
    ['CTNS (manual) — Carton', round2(pk.ctnsCartons) || 0],
    ['CTNS (manual) — Bag', round2(pk.ctnsBags) || 0],
    ['Round items — columns', round2(grandRoundCtn)],
    ['Round items — matrix', round2(arCtnRowT)],
    ['Round items — packed as Carton', round2(pk.cartons)],
    ['Round items — packed as Bag', round2(pk.bags)],
    ['Invoices on run', ROWS.length],
    ['TOTAL PACKAGES LOADED', round2(grand)],
  ];
  let sr = sectionStart;
  summaryRows.forEach(([label, val], i) => {
    const isLast = i === summaryRows.length - 1;
    cell(ws, sr, summaryStartCol, label, { font: { bold: isLast, size: 9 }, border: BORDER_ALL, fill: isLast ? TOTAL_FILL : undefined });
    cell(ws, sr, summaryStartCol + 1, val, { font: { bold: isLast, size: 9 }, border: BORDER_ALL, alignment: { horizontal: 'center' }, fill: isLast ? TOTAL_FILL : undefined });
    sr++;
  });

  return Math.max(r, sr);
}

// ---- small helpers ----
function cell(ws, row, col, value, style = {}) {
  const c = ws.getCell(row, col);
  c.value = value;
  if (style.font) c.font = style.font;
  if (style.alignment) c.alignment = style.alignment;
  if (style.border) c.border = style.border;
  if (style.fill) c.fill = style.fill;
  return c;
}
function merge(ws, r1, c1, r2, c2) { ws.mergeCells(r1, c1, r2, c2); }
