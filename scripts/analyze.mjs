#!/usr/bin/env node
// Measure the generator over N icons (default 10000):
//   - tile-type distribution
//   - exact contiguous-region area distribution (ranked, in tile units; 1 = one cell)
//   - invariants: no orphaned 1/4 squares, largest region <= the area cap
// Region areas are computed independently here (union-find over quarter-squares and
// triangles) so this doubles as a check on the generator, not a restatement of it.
//
//   node scripts/analyze.mjs [N]        (or: npm run analyze)

import { generate, GW, GH } from "../src/index.js";

const N = parseInt(process.argv[2], 10) || 10000;
const ckey = (c) => (c[0] << 16) | (c[1] << 8) | c[2];
const EDGES = { N: [0, 1], S: [2, 3], W: [0, 2], E: [1, 3] };
const OPP = { N: "S", S: "N", E: "W", W: "E" };
const TRI_LEGS = { UL: ["N", "W"], UR: ["N", "E"], LL: ["S", "W"], LR: ["S", "E"] };
const INCELL = { 0: [1, 2], 1: [0, 3], 2: [0, 3], 3: [1, 2] };
const SUBPX_EDGES = { 0: [["N", 0], ["W", 0]], 1: [["N", 1], ["E", 0]], 2: [["S", 0], ["W", 1]], 3: [["S", 1], ["E", 1]] };
const DIR = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };

const edgeColors = (cell, e) => cell.kind === "Q"
  ? EDGES[e].map((i) => (cell.data[i] ? cell.fg : cell.bg))
  : (TRI_LEGS[cell.data].includes(e) ? [cell.fg, cell.fg] : [cell.bg, cell.bg]);

function category(cell) {
  if (cell.kind === "T") return "triangle";
  const d = cell.data, pc = d.reduce((s, x) => s + (x ? 1 : 0), 0);
  if (pc === 0 || pc === 4) return "solid";
  if (pc === 1) return "single-corner";
  if (pc === 3) return "three-corner(3/4)";
  return ((d[0] && d[3]) || (d[1] && d[2])) ? "diagonal" : "half";
}

// orphaned subpixels in the finished grid (should be 0)
function orphanCount(cells) {
  let n = 0;
  for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
    const cell = cells[r][c]; if (cell.kind !== "Q") continue;
    const cols = [0, 1, 2, 3].map((i) => (cell.data[i] ? cell.fg : cell.bg));
    for (let q = 0; q < 4; q++) {
      const col = cols[q];
      if (INCELL[q].some((j) => ckey(cols[j]) === ckey(col))) continue;
      let ok = false;
      for (const [e, p] of SUBPX_EDGES[q]) {
        const [dc, dr] = DIR[e], nc = c + dc, nr = r + dr;
        if (nc < 0 || nc >= GW || nr < 0 || nr >= GH) continue;
        if (ckey(edgeColors(cells[nr][nc], OPP[e])[p]) === ckey(col)) { ok = true; break; }
      }
      if (!ok) n++;
    }
  }
  return n;
}

// exact contiguous same-colour region areas (tile units), descending
function regionAreas(cells) {
  const M = GW * GH * 4, col = new Int32Array(M).fill(-1), ar = new Float64Array(M), par = new Int32Array(M);
  for (let i = 0; i < M; i++) par[i] = i;
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  const own = (cell, base, e, p) => cell.kind === "Q" ? base + EDGES[e][p] : (TRI_LEGS[cell.data].includes(e) ? base : base + 1);
  for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
    const cell = cells[r][c], b = (r * GW + c) * 4;
    if (cell.kind === "Q") {
      for (let s = 0; s < 4; s++) { col[b + s] = ckey(cell.data[s] ? cell.fg : cell.bg); ar[b + s] = 0.25; }
      for (const [a, d] of [[0, 1], [0, 2], [1, 3], [2, 3]]) if (col[b + a] === col[b + d]) uni(b + a, b + d);
    } else { col[b] = ckey(cell.fg); ar[b] = 0.5; col[b + 1] = ckey(cell.bg); ar[b + 1] = 0.5; }
  }
  for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
    const cell = cells[r][c], b = (r * GW + c) * 4;
    if (c + 1 < GW) { const nb = cells[r][c + 1], z = (r * GW + c + 1) * 4;
      for (const p of [0, 1]) { const a = own(cell, b, "E", p), d = own(nb, z, "W", p); if (col[a] === col[d]) uni(a, d); } }
    if (r + 1 < GH) { const nb = cells[r + 1][c], z = ((r + 1) * GW + c) * 4;
      for (const p of [0, 1]) { const a = own(cell, b, "S", p), d = own(nb, z, "N", p); if (col[a] === col[d]) uni(a, d); } }
  }
  const sum = new Float64Array(M), out = [];
  for (let i = 0; i < M; i++) if (col[i] !== -1) sum[find(i)] += ar[i];
  for (let i = 0; i < M; i++) if (sum[i] > 0) out.push(sum[i]);
  return out.sort((a, b) => b - a);
}

const ORDER = ["triangle", "single-corner", "solid", "half", "diagonal", "three-corner(3/4)"];
const tile = Object.fromEntries(ORDER.map((k) => [k, 0]));
const MAXR = 12, rank = new Float64Array(MAXR);
let cells_n = 0, regions = 0, orphans = 0, maxRegion = 0;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const cells = generate(String(i));
  for (const row of cells) for (const cell of row) { tile[category(cell)]++; cells_n++; }
  orphans += orphanCount(cells);
  const s = regionAreas(cells); regions += s.length;
  if (s[0] > maxRegion) maxRegion = s[0];
  for (let k = 0; k < s.length && k < MAXR; k++) rank[k] += s[k];
}

console.log(`agenticon — analysis over ${N} icons (${cells_n} cells), ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
console.log("Tile distribution:");
for (const k of ORDER) console.log(`  ${k.padEnd(18)} ${(tile[k] / cells_n * 100).toFixed(2).padStart(6)}%   (${(tile[k] / N).toFixed(2)}/icon)`);
console.log("\nRanked contiguous-region area (mean tiles, icon = 8):");
let cum = 0;
for (let k = 0; k < MAXR; k++) { const a = rank[k] / N; cum += a; if (a < 0.005) break; console.log(`  #${String(k + 1).padEnd(3)} ${a.toFixed(3).padStart(7)}   (cum ${cum.toFixed(2)})`); }
console.log(`\n  mean regions/icon: ${(regions / N).toFixed(2)}`);
console.log("\nInvariants:");
console.log(`  orphaned 1/4 squares: ${orphans}   ${orphans === 0 ? "OK" : "*** VIOLATION ***"}`);
console.log(`  largest region: ${maxRegion.toFixed(3)} tiles`);
