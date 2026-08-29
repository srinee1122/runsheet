// lib/round2.js — shared rounding helper (2 decimal places), used by several components.
// Pulled out on its own so builder.js and matrix-view.js can both import it without
// creating a circular dependency between the two (builder.js imports MatrixView).
export function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
