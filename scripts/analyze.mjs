#!/usr/bin/env node
// Measure the generator over N icons (default 10000):
//   - tile-type distribution
//   - exact contiguous-region area distribution (ranked, in tile units; 1 = one cell)
//   - invariants: no orphaned 1/4 squares, largest region <= the area cap
// Region areas are computed independently here (union-find over quarter-squares and
// triangles) so this doubles as a check on the generator, not a restatement of it.
//
//   node scripts/analyze.mjs [N]        (or: npm run analyze)

import { generate, GW, GH, AREA_LIMIT, buildRecolorMap } from "../src/index.js";

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

// recolour separation check: smallest OKLab dE between any two ADJACENT recoloured
// colours in an icon (the `separate` pass should hold this at/above the 0.15 gate).
const s2l = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const rgb2oklab = ([r, g, b]) => {
  const R = s2l(r), G = s2l(g), B = s2l(b);
  const l = Math.cbrt(0.4122214708*R + 0.5363325363*G + 0.0514459929*B), m = Math.cbrt(0.2119034982*R + 0.6806995451*G + 0.1073969566*B), s = Math.cbrt(0.0883024619*R + 0.2817188376*G + 0.6299787005*B);
  return [0.2104542553*l + 0.7936177850*m - 0.0040720468*s, 1.9779984951*l - 2.4285922050*m + 0.4505937099*s, 0.0259040371*l + 0.7827717662*m - 0.8086757660*s];
};
const oklabDE = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const REPAIR_DE = 0.15;
function minAdjacentDE(cells, cmap) {
  const lab = (col) => rgb2oklab(cmap.get(ckey(col)) || col);
  const seen = new Set(); let m = Infinity;
  const pair = (a, b) => { const ka = ckey(a), kb = ckey(b); if (ka === kb) return; const key = ka < kb ? ka + "," + kb : kb + "," + ka; if (seen.has(key)) return; seen.add(key); m = Math.min(m, oklabDE(lab(a), lab(b))); };
  for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
    const cell = cells[r][c];
    if (cell.kind === "Q") { const sc = [0, 1, 2, 3].map((i) => cell.data[i] ? cell.fg : cell.bg); for (const [a, d] of [[0, 1], [0, 2], [1, 3], [2, 3]]) pair(sc[a], sc[d]); }
    else pair(cell.fg, cell.bg);
    if (cell.diag) { pair(cell.diag.color, cell.fg); pair(cell.diag.color, cell.bg); }
    if (c + 1 < GW) { const a = edgeColors(cell, "E"), b = edgeColors(cells[r][c + 1], "W"); pair(a[0], b[0]); pair(a[1], b[1]); }
    if (r + 1 < GH) { const a = edgeColors(cell, "S"), b = edgeColors(cells[r + 1][c], "N"); pair(a[0], b[0]); pair(a[1], b[1]); }
  }
  return m;
}

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
const des = [];                                       // per-icon min adjacent recoloured dE
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const cells = generate(String(i));
  for (const row of cells) for (const cell of row) { tile[category(cell)]++; cells_n++; }
  orphans += orphanCount(cells);
  const s = regionAreas(cells); regions += s.length;
  if (s[0] > maxRegion) maxRegion = s[0];
  for (let k = 0; k < s.length && k < MAXR; k++) rank[k] += s[k];
  const md = minAdjacentDE(cells, buildRecolorMap(String(i), cells));
  if (isFinite(md)) des.push(md);
}

console.log(`agenticon — analysis over ${N} icons (${cells_n} cells), ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
console.log("Tile distribution:");
for (const k of ORDER) console.log(`  ${k.padEnd(18)} ${(tile[k] / cells_n * 100).toFixed(2).padStart(6)}%   (${(tile[k] / N).toFixed(2)}/icon)`);
console.log("\nRanked contiguous-region area (mean tiles, icon = 8):");
let cum = 0;
for (let k = 0; k < MAXR; k++) { const a = rank[k] / N; cum += a; if (a < 0.005) break; console.log(`  #${String(k + 1).padEnd(3)} ${a.toFixed(3).padStart(7)}   (cum ${cum.toFixed(2)})`); }
console.log(`\n  mean regions/icon: ${(regions / N).toFixed(2)}`);
console.log("\nInvariants:");
const regionOk = maxRegion <= AREA_LIMIT + 1e-9;
console.log(`  orphaned 1/4 squares: ${orphans}   ${orphans === 0 ? "OK" : "*** VIOLATION ***"}`);
console.log(`  largest region: ${maxRegion.toFixed(3)} tiles (limit ${AREA_LIMIT})   ${regionOk ? "OK" : "*** VIOLATION ***"}`);

des.sort((a, b) => a - b);
const q = (p) => des[Math.min(des.length - 1, Math.floor(p / 100 * des.length))];
const below = des.filter((d) => d < REPAIR_DE - 1e-3).length;
console.log(`\nRecolour separation (min OKLab dE between adjacent colours; gate ${REPAIR_DE}):`);
console.log(`  min ${des[0].toFixed(3)}   p1 ${q(1).toFixed(3)}   p5 ${q(5).toFixed(3)}   median ${q(50).toFixed(3)}`);
console.log(`  icons below gate: ${below} (${(below / des.length * 100).toFixed(2)}%)   ${below === 0 ? "OK" : "gamut-limited tail"}`);

// Exit non-zero on any invariant breach so this doubles as the test gate (npm test).
if (orphans !== 0 || !regionOk) process.exit(1);
