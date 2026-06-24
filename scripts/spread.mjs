// How well does agenticon DISTRIBUTE icons across perceptual space?
// (distinct from "how many exist" -- this is about evenness + separation, the mnemonic value.)
//
//   evenness   : are the salient perceptual axes (hue, lightness, colourfulness, #colours,
//                shape-busyness) used uniformly, or piled into favourites?  -> Pielou J, eff. bins
//   separation : in a realized batch, how far is each icon from its NEAREST neighbour, and how
//                many land in the "confusable" zone (>=35% pixel-match)?     -> NN distribution
//   practical  : for a working set of k icons, odds any two look alike?      -> birthday(k)
//
// Usage: node scripts/spread.mjs [Nmarg] [Nnn]
import { generate, GW, GH } from "../src/generate.js";
import { buildRecolorMap } from "../src/recolor.js";
import { ckey } from "../src/palette.js";

const dec = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function oklab([R, G, B]) {
  const r = dec(R), g = dec(G), b = dec(B);
  const l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b, m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b, s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b;
  const L = Math.cbrt(l), M = Math.cbrt(m), S = Math.cbrt(s);
  return [0.2104542553*L+0.7936177850*M-0.0040720468*S, 1.9779984951*L-2.4285922050*M+0.4505937099*S, 0.0259040371*L+0.7827717662*M-0.8086757660*S];
}
function recolour(text) {
  const base = generate(text), m = buildRecolorMap(text, base);
  return base.map((row) => row.map((c) => ({ ...c, fg: m.get(ckey(c.fg)) || c.fg, bg: m.get(ckey(c.bg)) || c.bg })));
}
// area-weighted colour stats + shape busyness for one icon
function features(cells) {
  const area = new Map(); let nonSolid = 0;
  for (const row of cells) for (const cell of row) {
    if (cell.kind === "Q") {
      const solid = cell.data.every((x) => !x) || cell.data.every((x) => x);
      if (!solid) nonSolid++;
      for (let i = 0; i < 4; i++) { const col = cell.data[i] ? cell.fg : cell.bg; const k = ckey(col); area.set(k, (area.get(k) || 0) + 0.25); }
    } else { nonSolid++; area.set(ckey(cell.fg), (area.get(ckey(cell.fg)) || 0) + 0.5); area.set(ckey(cell.bg), (area.get(ckey(cell.bg)) || 0) + 0.5); }
  }
  let domK = 0, domA = 0, sumL = 0, sumC = 0, tot = 0;
  const labOf = (k) => oklab([(k >> 16) & 255, (k >> 8) & 255, k & 255]);
  for (const [k, a] of area) { if (a > domA) { domA = a; domK = k; } const [L, A, B] = labOf(k); sumL += L * a; sumC += Math.hypot(A, B) * a; tot += a; }
  const [dL, dA, dB] = labOf(domK);
  const hue = (Math.atan2(dB, dA) * 180 / Math.PI + 360) % 360;
  return { hue, meanL: sumL / tot, chroma: sumC / tot, nColors: area.size, nonSolid };
}
// evenness of a sample of scalars binned into [lo,hi]/B
function evenness(vals, lo, hi, B) {
  const h = new Array(B).fill(0);
  for (const v of vals) { let b = Math.floor((v - lo) / (hi - lo) * B); b = Math.max(0, Math.min(B - 1, b)); h[b]++; }
  const n = vals.length; let H = 0;
  for (const c of h) if (c) { const p = c / n; H -= p * Math.log(p); }
  return { J: H / Math.log(B), effBins: Math.exp(H), of: B, hist: h };
}
const bar = (h) => { const mx = Math.max(...h); return h.map((c) => " ▁▂▃▄▅▆▇█"[Math.min(8, Math.round(c / mx * 8))]).join(""); };

const [Nmarg = 40000, Nnn = 2000] = process.argv.slice(2).map(Number);

// ---- (1) evenness across perceptual feature marginals ----
console.log(`[1] evenness of the realized distribution  (N=${Nmarg.toLocaleString()} icons)`);
const F = { hue: [], meanL: [], chroma: [], nColors: [], nonSolid: [] };
for (let i = 0; i < Nmarg; i++) { const f = features(recolour("u#" + i + "~" + ((i * 2654435761) >>> 0).toString(36))); for (const k in F) F[k].push(f[k]); }
const report = (name, lo, hi, B) => { const e = evenness(F[name], lo, hi, B); console.log(`  ${name.padEnd(9)} J=${e.J.toFixed(3)}  eff.bins ${e.effBins.toFixed(1)}/${B}   ${bar(e.hist)}`); };
report("hue", 0, 360, 24);
report("meanL", 0, 1, 16);
report("chroma", 0, 0.32, 16);
report("nColors", 1, 9, 8);
report("nonSolid", 0, 9, 9);
console.log(`  (J=1 means perfectly even use of that axis; the bar is the histogram low->high)\n`);

// ---- (2) nearest-neighbour separation in a realized batch ----
console.log(`[2] nearest-neighbour perceptual separation  (batch of N=${Nnn.toLocaleString()})`);
const RW = 32, RH = 16, PX = RW * RH, JND = 0.02;
const cc = (cell, fx, fy) => { if (cell.kind === "Q") { const i = (fy >= 0.5 ? 2 : 0) + (fx >= 0.5 ? 1 : 0); return cell.data[i] ? cell.fg : cell.bg; } const ins = { UL: fx + fy < 1, UR: fx > fy, LL: fx < fy, LR: fx + fy > 1 }[cell.data]; return ins ? cell.fg : cell.bg; };
function ras(cells) { const a = new Float32Array(PX * 3); let o = 0; for (let py = 0; py < RH; py++) for (let px = 0; px < RW; px++) { const x = (px + 0.5) / RW * GW, y = (py + 0.5) / RH * GH, c = Math.min(GW - 1, x | 0), r = Math.min(GH - 1, y | 0); const L = oklab(cc(cells[r][c], x - c, y - r)); a[o++] = L[0]; a[o++] = L[1]; a[o++] = L[2]; } return a; }
const matchPct = (a, b) => { let w = 0; for (let i = 0; i < a.length; i += 3) if (Math.hypot(a[i]-b[i], a[i+1]-b[i+1], a[i+2]-b[i+2]) < JND) w++; return 100 * w / PX; };
const imgs = []; for (let i = 0; i < Nnn; i++) imgs.push(ras(recolour("nn#" + i)));
const nn = new Array(Nnn).fill(0);
for (let i = 0; i < Nnn; i++) for (let j = i + 1; j < Nnn; j++) { const m = matchPct(imgs[i], imgs[j]); if (m > nn[i]) nn[i] = m; if (m > nn[j]) nn[j] = m; }
nn.sort((a, b) => a - b);
const pct = (p) => nn[Math.floor(p / 100 * (Nnn - 1))];
const confus = nn.filter((m) => m >= 35).length;
console.log(`  NN match% (higher = closer twin):  min ${nn[0].toFixed(0)}  p50 ${pct(50).toFixed(0)}  p95 ${pct(95).toFixed(0)}  max ${nn[Nnn-1].toFixed(0)}`);
console.log(`  icons whose nearest neighbour is "confusable" (>=35% match): ${confus}/${Nnn} (${(100*confus/Nnn).toFixed(2)}%)\n`);

// ---- (3) practical confusability at working-set size k ----
console.log(`[3] confusability in a working set of k icons  (D_perceptual ~ 2.0e11)`);
const D = 2.06e11;
for (const k of [10, 50, 100, 1000, 10000, 100000]) { const p = 1 - Math.exp(-(k * (k - 1) / 2) / D); console.log(`  k=${String(k).padStart(6)}  P(some confusable pair) = ${(p < 1e-4 ? p.toExponential(1) : (p*100).toFixed(3) + "%")}`); }
