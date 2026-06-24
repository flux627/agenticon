// Estimate how many *perceptually distinct* agenticons exist.
//
// Exact-byte counting overcounts: the recolour pass jitters colours below the eye's
// just-noticeable-difference (JND). So we count in OKLab (perceptually ~uniform), collapse
// anything within a JND, and birthday-extrapolate the effective space size.
//
// The unified birthday (draw N icons, look for a perceptually-identical pair) is collision-
// starved at feasible N -- perceptual identity needs both the same structure AND colours
// within a JND, prob ~1e-12. So we factor it:
//
//     D_perceptual  =  D_structure  x  colour_multiplier_per_structure
//
// and measure each factor by its own birthday experiment, where collisions are plentiful.
//
// Usage:  node scripts/perceptual-space.mjs [Nstruct] [Rcolor] [Kstruct]

import { generate, GW, GH } from "../src/generate.js";
import { buildRecolorMap } from "../src/recolor.js";
import { ckey } from "../src/palette.js";

// ---- sRGB(0-255) -> OKLab (Euclidean distance ~ perceived difference; JND ~ 0.02) ----
const dec = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function oklab(R, G, B) {
  const r = dec(R), g = dec(G), b = dec(B);
  const l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b;
  const m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b;
  const s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b;
  const L = Math.cbrt(l), M = Math.cbrt(m), S = Math.cbrt(s);
  return [0.2104542553*L + 0.7936177850*M - 0.0040720468*S,
          1.9779984951*L - 2.4285922050*M + 0.4505937099*S,
          0.0259040371*L + 0.7827717662*M - 0.8086757660*S];
}
const JND = 0.02;

// ---- rasterise cells -> per-pixel OKLab, quantised to a JND grid (Int8 buckets) ----
const W = GW * 2, H = GH * 2, PX = W * H;        // 2 samples/cell: enough to separate shapes
function cellColor(cell, fx, fy) {
  if (cell.kind === "Q") { const i = (fy >= 0.5 ? 2 : 0) + (fx >= 0.5 ? 1 : 0); return cell.data[i] ? cell.fg : cell.bg; }
  const inside = { UL: fx + fy < 1, UR: fx > fy, LL: fx < fy, LR: fx + fy > 1 }[cell.data];
  return inside ? cell.fg : cell.bg;
}
function recolour(text) {
  let cells = generate(text);
  const cmap = buildRecolorMap(text, cells);
  return cells.map((row) => row.map((c) => ({ ...c, fg: cmap.get(ckey(c.fg)) || c.fg, bg: cmap.get(ckey(c.bg)) || c.bg })));
}
function quantRaster(cells, grid, out = new Int8Array(PX * 3)) {
  let o = 0;
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const x = (px + 0.5) / W * GW, y = (py + 0.5) / H * GH;
    const c = Math.min(GW - 1, x | 0), r = Math.min(GH - 1, y | 0);
    const lab = oklab(...cellColor(cells[r][c], x - c, y - r));
    out[o++] = Math.round(lab[0] / grid); out[o++] = Math.round(lab[1] / grid); out[o++] = Math.round(lab[2] / grid);
  }
  return out;
}
const keyOf = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString("latin1");
// effective space size from a birthday experiment (Simpson / participation size)
const birthday = (n, collisions) => collisions > 0 ? (n * (n - 1) / 2) / collisions : Infinity;
const drawsTo50 = (D) => isFinite(D) ? Math.sqrt(2 * D * Math.LN2) : Infinity;
const fmt = (x) => isFinite(x) ? Math.round(x).toLocaleString() : "infinite";

// Defaults sized for a ~3-4 min run. buildRecolorMap is ~1.7ms/call, so the colour loop
// cost is K*R recolourings -- keep K*R <= ~200k unless you want a long run.
const [Nstruct = 300000, Rcolor = 4000, Kstruct = 40] = process.argv.slice(2).map(Number);

// ---- (1) structural birthday: exact distinct generated grids ----
function structSig(cells) {
  return cells.map((row) => row.map((c) =>
    (c.kind === "Q" ? c.data.map((b) => (b ? 1 : 0)).join("") : c.data) + c.fg.join("") + c.bg.join("")).join("|")).join("/");
}
function measureStructure(n) {
  const seen = new Set(); let coll = 0;
  for (let i = 0; i < n; i++) {
    const k = structSig(generate("struct#" + i + "~" + ((i * 2654435761) >>> 0).toString(36)));
    if (seen.has(k)) coll++; else seen.add(k);
  }
  return { n, distinct: seen.size, coll, D: birthday(n, coll) };
}

// ---- (2) per-structure colour birthday: recolour ONE structure many ways, JND-collapse ----
function measureColour(baseCells, r) {
  const seen = new Map(); let coll = 0; const buf = new Int8Array(PX * 3);
  for (let i = 0; i < r; i++) {
    const cmap = buildRecolorMap("c#" + i, baseCells);
    const cells = baseCells.map((row) => row.map((c) => ({ ...c, fg: cmap.get(ckey(c.fg)) || c.fg, bg: cmap.get(ckey(c.bg)) || c.bg })));
    quantRaster(cells, JND, buf);
    const k = keyOf(buf); const c = seen.get(k) || 0; if (c > 0) coll++; seen.set(k, c + 1);
  }
  return birthday(r, coll);
}

console.log(`perceptual space of agenticon  (OKLab, JND=${JND}, ${W}x${H}px raster)\n`);

console.log(`[1] structural birthday  (N=${Nstruct.toLocaleString()} exact grids)`);
const st = measureStructure(Nstruct);
console.log(`    distinct=${st.distinct.toLocaleString()}  collisions=${st.coll}  ->  D_structure ~ ${fmt(st.D)}\n`);

console.log(`[2] colour birthday per structure  (K=${Kstruct} structures x R=${Rcolor.toLocaleString()} recolourings, JND-collapsed)`);
const colDs = [];
for (let s = 0; s < Kstruct; s++) {
  const base = generate("base#" + s + "~" + ((s * 40503) >>> 0).toString(36));
  colDs.push(measureColour(base, Rcolor));
}
const finite = colDs.filter(isFinite).sort((a, b) => a - b);
const colMed = finite.length ? finite[finite.length >> 1] : Infinity;
const colMean = finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : Infinity;
console.log(`    colour multiplier/structure: median ~ ${fmt(colMed)}  mean ~ ${fmt(colMean)}  (${colDs.length - finite.length}/${Kstruct} unsaturated)\n`);

// ---- synthesis ----
const Dperc = st.D * colMed;
console.log(`[3] synthesis`);
console.log(`    D_perceptual  ~  D_structure x colour/structure  ~  ${fmt(st.D)} x ${fmt(colMed)}  ~  ${Dperc.toExponential(2)}`);
console.log(`    draws to a 50% chance of mining one perceptually-identical pair: ~ ${fmt(drawsTo50(Dperc))}`);
console.log(`    (vs ~${fmt(drawsTo50(st.D))} draws to collide on STRUCTURE alone)`);
