// Recolour pass: remap a generated icon onto a small bold palette.
//
// Unique chromatic colours are hue-sorted at a random phase, split into N (1-5)
// contiguous groups, and each is shifted 70% toward its group's bold OKLCH colour in
// hue + saturation -- brightness mostly drives the icon's light/dark structure, so it's
// kept. Achromatic colours go to the nearest bold colour by brightness. A final pass
// (`separate`) then pushes any two ADJACENT recoloured colours at least REPAIR_DE apart in
// OKLab, opening the gap along lightness within a bold band -- so neighbouring regions
// never collapse into the same colour, and nothing washes out to white or black. Seeded
// independently of generation ("recolor|" + text).

import { makeRng } from "./rng.js";
import { ckey } from "./palette.js";

function oklab2lrgb(L, a, b) {
  const l = (L + 0.3963377774*a + 0.2158037573*b) ** 3;
  const m = (L - 0.1055613458*a - 0.0638541728*b) ** 3;
  const s = (L - 0.0894841775*a - 1.2914855480*b) ** 3;
  return [4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
          -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
          -0.0041960863*l - 0.7034186147*m + 1.7076147010*s];
}
const gam = (x) => { x = Math.max(0, Math.min(1, x)); return x <= 0.0031308 ? 12.92*x : 1.055 * x ** (1/2.4) - 0.055; };
const inGamut = (L, a, b) => oklab2lrgb(L, a, b).every((v) => v >= -1e-3 && v <= 1 + 1e-3);
function oklch(L, C, Hdeg) {
  const h = Hdeg * Math.PI / 180; let c = C;
  while (c > 0 && !inGamut(L, c*Math.cos(h), c*Math.sin(h))) c -= 0.004;
  const [R, G, B] = oklab2lrgb(L, c*Math.cos(h), c*Math.sin(h));
  return [Math.round(255*gam(R)), Math.round(255*gam(G)), Math.round(255*gam(B))];
}
const srgb2lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function rgb2oklab([r, g, b]) {                                  // forward of oklab2lrgb, for dE
  const R = srgb2lin(r), G = srgb2lin(g), B = srgb2lin(b);
  const l = Math.cbrt(0.4122214708*R + 0.5363325363*G + 0.0514459929*B);
  const m = Math.cbrt(0.2119034982*R + 0.6806995451*G + 0.1073969566*B);
  const s = Math.cbrt(0.0883024619*R + 0.2817188376*G + 0.6299787005*B);
  return [0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
          1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
          0.0259040371*l + 0.7827717662*m - 0.8086757660*s];
}
function boldPalette(N, H0) {
  if (N === 1) return [oklch(0.58, 0.34, H0)];
  const Ls = []; for (let i = 0; i < N; i++) Ls.push(0.95 - (0.95 - 0.15)*i/(N-1));
  const span = Math.min(40, 14*(N-1));
  const pts = []; for (let i = 0; i < N; i++) pts.push([Ls[i], H0 - span + 2*span*i/(N-1)]);
  if (N >= 3) { const m = Math.floor(N/2); pts[m] = [pts[m][0], H0 + 180]; }   // one complementary accent
  return pts.map(([L, H]) => oklch(L, 0.34, H));
}
function rgb2hsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r)/d + 2; else h = (r - g)/d + 4;
    h /= 6; if (h < 0) h += 1;
  }
  return [h, mx === 0 ? 0 : d / mx, mx];
}
function hsv2rgb(h, s, v) {
  const i = Math.floor(h * 6), f = h*6 - i, p = v*(1-s), q = v*(1-f*s), t = v*(1-(1-f)*s);
  const [r, g, b] = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][((i % 6) + 6) % 6];
  return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}
function blend(orig, neu, tHs = 0.7, tV = 0.0) {
  const [ho, so, vo] = rgb2hsv(orig), [hn, sn, vn] = rgb2hsv(neu);
  const dh = (((hn - ho + 0.5) % 1) + 1) % 1 - 0.5;             // shortest hue path
  return hsv2rgb((((ho + tHs*dh) % 1) + 1) % 1, so + tHs*(sn - so), vo + tV*(vn - vo));
}
const N_WEIGHTS = [[1, 0.12], [2, 0.28], [3, 0.30], [4, 0.20], [5, 0.10]];
function pickN(rng) { let x = rng(), acc = 0; for (const [n, w] of N_WEIGHTS) { acc += w; if (x < acc) return n; } return 3; }

// --- final separation: keep adjacent recoloured colours perceptually apart ---
// REPAIR_DE: min OKLab distance two touching colours must clear (0 = off). REPAIR_AIM aims
// a hair higher to absorb 8-bit + gamut rounding. The gap is opened along lightness, clamped
// to [L_LO,L_HI] so a pushed colour never reaches white or black.
const REPAIR_DE = 0.15, REPAIR_AIM = REPAIR_DE + 0.005, L_LO = 0.18, L_HI = 0.90;
const Q_ADJ = [[0, 1], [0, 2], [1, 3], [2, 3]];                 // touching sub-squares within a Q cell
const E_IDX = { N: [0, 1], S: [2, 3], W: [0, 2], E: [1, 3] };
const T_LEGS = { UL: ["N", "W"], UR: ["N", "E"], LL: ["S", "W"], LR: ["S", "E"] };
const edgeOf = (cell, e) => cell.kind === "Q"                   // the two colours along edge e
  ? E_IDX[e].map((i) => cell.data[i] ? cell.fg : cell.bg)
  : (T_LEGS[cell.data].includes(e) ? [cell.fg, cell.fg] : [cell.bg, cell.bg]);

// Unordered [keyA,keyB] pairs of colours that share an edge anywhere in the icon.
function adjacentKeys(cells) {
  const pairs = new Set();
  const add = (a, b) => { const ka = ckey(a), kb = ckey(b); if (ka !== kb) pairs.add(ka < kb ? ka + "," + kb : kb + "," + ka); };
  for (let r = 0; r < cells.length; r++) for (let c = 0; c < cells[r].length; c++) {
    const cell = cells[r][c];
    if (cell.kind === "Q") { const s = [0, 1, 2, 3].map((i) => cell.data[i] ? cell.fg : cell.bg); for (const [a, d] of Q_ADJ) add(s[a], s[d]); }
    else add(cell.fg, cell.bg);
    if (cell.diag) { add(cell.diag.color, cell.fg); add(cell.diag.color, cell.bg); }
    const right = cells[r][c + 1]; if (right) { const a = edgeOf(cell, "E"), b = edgeOf(right, "W"); add(a[0], b[0]); add(a[1], b[1]); }
    const down = cells[r + 1] && cells[r + 1][c]; if (down) { const a = edgeOf(cell, "S"), b = edgeOf(down, "N"); add(a[0], b[0]); add(a[1], b[1]); }
  }
  return [...pairs].map((s) => s.split(",").map(Number)).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

// Push every sub-REPAIR_DE adjacent pair apart along lightness, in place on `cmap`.
// Relaxation over the pairs to a fixpoint; a colour in several tight pairs settles between
// them. Only lightness moves (hue/chroma stay bold); the band clamp keeps it off the rails.
function separate(cmap, cells) {
  if (REPAIR_DE <= 0) return;
  const pairs = adjacentKeys(cells).filter(([a, b]) => cmap.has(a) && cmap.has(b));
  if (!pairs.length) return;
  const lab = new Map([...cmap].map(([k, rgb]) => [k, rgb2oklab(rgb)]));   // [L,a,b]; only L moves
  for (let it = 0; it < 200; it++) {
    let moved = false;
    for (const [ka, kb] of pairs) {
      const A = lab.get(ka), B = lab.get(kb);
      const dab = Math.hypot(A[1] - B[1], A[2] - B[2]);
      if (dab >= REPAIR_AIM) continue;                          // already far enough off the L axis
      const gap = Math.sqrt(REPAIR_AIM * REPAIR_AIM - dab * dab);
      const hi = A[0] >= B[0] ? A : B, lo = A[0] >= B[0] ? B : A;
      if (hi[0] - lo[0] >= gap - 1e-6) continue;
      const mid = (hi[0] + lo[0]) / 2; let h = mid + gap / 2, l = mid - gap / 2;
      if (h > L_HI) { l -= h - L_HI; h = L_HI; }                // clamp to the bold band,
      if (l < L_LO) { h += L_LO - l; l = L_LO; }                // spilling the remainder onto the partner
      if (h > L_HI) h = L_HI;
      if (Math.abs(h - hi[0]) > 1e-7 || Math.abs(l - lo[0]) > 1e-7) { hi[0] = h; lo[0] = l; moved = true; }
    }
    if (!moved) break;
  }
  for (const [k, [L, a, b]] of lab) cmap.set(k, oklch(L, Math.hypot(a, b), Math.atan2(b, a) * 180 / Math.PI));
}

/** Map from each original colour (ckey) to its recoloured rgb, for `cells` of `text`. */
export function buildRecolorMap(text, cells) {
  const uniq = [], seen = new Set();
  for (const row of cells) for (const cell of row) for (const col of [cell.fg, cell.bg]) {
    const k = ckey(col); if (!seen.has(k)) { seen.add(k); uniq.push(col); }
  }
  const rng = makeRng("recolor|" + text);
  const chrom = uniq.filter((c) => rgb2hsv(c)[1] >= 0.08);
  const achrom = uniq.filter((c) => rgb2hsv(c)[1] < 0.08);
  const phase = rng();
  chrom.sort((a, b) => (((rgb2hsv(a)[0] - phase) % 1 + 1) % 1) - (((rgb2hsv(b)[0] - phase) % 1 + 1) % 1));
  const N = pickN(rng), H0 = rng() * 360;
  const neu = boldPalette(N, H0);
  const cmap = new Map(), M = chrom.length;
  chrom.forEach((c, i) => cmap.set(ckey(c), blend(c, neu[M ? Math.floor(i*N/M) : 0])));
  for (const c of achrom) {
    const v = rgb2hsv(c)[2];
    let best = neu[0], bd = Infinity;
    for (const nc of neu) { const dd = Math.abs(rgb2hsv(nc)[2] - v); if (dd < bd) { bd = dd; best = nc; } }
    cmap.set(ckey(c), blend(c, best));
  }
  separate(cmap, cells);                                         // pull touching colours apart in L
  return cmap;
}

// Monochrome passes. Both are per-colour remaps over an icon's unique colours, so (like
// recolour) they preserve region topology and feed SVG and terminal identically.
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function uniqueColours(cells) {
  const u = new Map();                                          // ckey -> rgb (fg/bg + accents)
  for (const row of cells) for (const cell of row) {
    u.set(ckey(cell.fg), cell.fg); u.set(ckey(cell.bg), cell.bg);
    if (cell.diag) u.set(ckey(cell.diag.color), cell.diag.color);
  }
  return [...u.values()];
}
// Greyscale: each colour -> a grey of its Rec.709 luma, with the icon's luma range stretched
// to span true black..white. A two-colour icon comes out pure B&W, richer ones a crisp ramp.
export function buildGrayMap(cells) {
  const cols = uniqueColours(cells), ys = cols.map(luma);
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const map = new Map();
  cols.forEach((c, i) => { const g = Math.round((ys[i] - lo) / span * 255); map.set(ckey(c), [g, g, g]); });
  return map;
}
// Black-and-white (1-bit): threshold the stretched greys at their midpoint, so every colour
// lands on pure black or pure white. Two adjacent same-side colours merge -- that's 1-bit.
const BLACK = [0, 0, 0], WHITE = [255, 255, 255];
export function buildBwMap(cells) {
  const map = new Map();
  for (const [k, g] of buildGrayMap(cells)) map.set(k, g[0] > 127 ? WHITE : BLACK);
  return map;
}
