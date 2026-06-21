/*
 * flowicon - SVG identicons via edge-continuity flow, recoloured onto a bold palette.
 *
 * A 4x2 grid of cells (quadrant blocks, corner triangles, shades), grown so adjacent
 * cells share a colour along their shared edge. A recolour pass then remaps the icon
 * onto a small bold palette (1-5 OKLCH colours): originals are hue-sorted, grouped,
 * and shifted 70% toward their group's new colour in hue + saturation, with brightness
 * left untouched so every shape stays legible. On by default.
 *
 * Deterministic, and byte-compatible with the Python flowicon.py/recolor.py: both share
 * the cyrb128 + sfc32 RNG, draw order, OKLCH recolour maths, and rgb<->hsv, so a given
 * string yields the same cells (same symbols + colours) here and in the terminal.
 *
 *   import { flowIcon, flowIconDataURI } from "./flowicon.js";
 *
 *   el.innerHTML = flowIcon("alice@example.com");                 // recoloured SVG
 *   img.src      = flowIconDataURI("alice@example.com", {size:48});
 *   flowIcon("alice@example.com", { recolor: false });            // raw 16-colour flow
 *   // React:  <img src={flowIconDataURI(user.email)} alt="" width={48} height={48} />
 */

// ---- palette + contrast guard ----
const PALETTE = [
  [0x1a, 0x1c, 0x2c], [0x5d, 0x27, 0x5d], [0xb1, 0x3e, 0x53], [0xef, 0x7d, 0x57],
  [0xff, 0xcd, 0x75], [0xa7, 0xf0, 0x70], [0x38, 0xb7, 0x64], [0x25, 0x71, 0x79],
  [0x29, 0x36, 0x6f], [0x3b, 0x5d, 0xc9], [0x41, 0xa6, 0xf6], [0x73, 0xef, 0xf7],
  [0xf4, 0xf4, 0xf4], [0x94, 0xb0, 0xc2], [0x56, 0x6c, 0x86], [0xb2, 0x8d, 0xff],
];
const MIN_CONTRAST = 3.0;
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
function contrast(a, b) {
  const la = lum(a), lb = lum(b), hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
const ckey = (c) => (c[0] << 16) | (c[1] << 8) | c[2];
const has = (arr, x) => arr.some((c) => ckey(c) === ckey(x));
const _partnersCache = new Map();                         // pure in x; only 16 palette inputs
function partners(x) {
  const k = ckey(x);
  let r = _partnersCache.get(k);
  if (r === undefined) {
    r = PALETTE.filter((c) => ckey(c) !== ckey(x) && contrast(c, x) >= MIN_CONTRAST);
    _partnersCache.set(k, r);
  }
  return r;
}

// ---- deterministic hash -> PRNG (cyrb128 + sfc32) ----
function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}
function makeRng(text) {
  let [a, b, c, d] = cyrb128(text);
  return function () {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0; a = b ^ b >>> 9; b = c + (c << 3) | 0;
    c = (c << 21 | c >>> 11); c = c + t | 0;
    return (t >>> 0) / 4294967296;
  };
}
const choice = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// ---- grid / edge model ----
const GW = 4, GH = 2;
const EDGES = { N: [0, 1], S: [2, 3], W: [0, 2], E: [1, 3] };
const OPP = { N: "S", S: "N", E: "W", W: "E" };
const TRI_LEGS = { UL: ["N", "W"], UR: ["N", "E"], LL: ["S", "W"], LR: ["S", "E"] };
const KINDS = [["Q", 0.50], ["T", 0.32], ["S", 0.18]];

function edgeColors(cell, edge) {
  const { kind, data, fg, bg } = cell;
  if (kind === "Q") return EDGES[edge].map((i) => (data[i] ? fg : bg));
  if (kind === "T") return TRI_LEGS[data].includes(edge) ? [fg, fg] : [bg, bg];
  return [fg, bg];
}
function randData(rng, kind) {
  if (kind === "Q") return [0, 1, 2, 3].map(() => rng() < 0.5);
  if (kind === "T") return choice(rng, ["UL", "UR", "LL", "LR"]);
  return choice(rng, ["light", "med", "dark"]);
}
function pickKind(rng) {
  let x = rng(), acc = 0;
  for (const [k, w] of KINDS) { acc += w; if (x < acc) return k; }
  return "Q";
}
function randCell(rng) {
  const bg = choice(rng, PALETTE), fg = choice(rng, partners(bg)), k = pickKind(rng);
  return { kind: k, data: randData(rng, k), fg, bg };
}
function cellTouching(rng, edge, X) {
  const ps = partners(X);
  for (let i = 0; i < 150; i++) {
    const k = pickKind(rng), useFg = rng() < 0.5;
    const cell = { kind: k, data: randData(rng, k), fg: useFg ? X : choice(rng, ps), bg: useFg ? choice(rng, ps) : X };
    if (has(edgeColors(cell, edge), X)) return cell;
  }
  return { kind: "S", data: "med", fg: X, bg: choice(rng, ps) };
}
function cellMatching(rng, cons) {
  if (!cons.length) return randCell(rng);
  let best = null, bestScore = -1;
  for (let i = 0; i < 300; i++) {
    const cell = randCell(rng);
    let score = 0;
    for (const [edge, allowed] of cons) if (edgeColors(cell, edge).some((c) => allowed.has(ckey(c)))) score++;
    if (score > bestScore) { best = cell; bestScore = score; if (score === cons.length) break; }
  }
  return best;
}
function neighbours(c, r) {
  const out = [];
  for (const [dc, dr, e] of [[1, 0, "E"], [-1, 0, "W"], [0, 1, "S"], [0, -1, "N"]]) {
    const nc = c + dc, nr = r + dr;
    if (nc >= 0 && nc < GW && nr >= 0 && nr < GH) out.push([nc, nr, e]);
  }
  return out;
}
function generate(text) {
  const rng = makeRng(text);
  const cells = Array.from({ length: GH }, () => Array(GW).fill(null));
  const undet = () => { const u = []; for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) if (!cells[r][c]) u.push([c, r]); return u; };
  const twoAdj = () => undet().some(([c, r]) => neighbours(c, r).some(([nc, nr]) => !cells[nr][nc]));
  while (twoAdj()) {
    const seeds = undet().filter(([c, r]) => neighbours(c, r).some(([nc, nr]) => !cells[nr][nc]));
    const [c, r] = choice(rng, seeds);
    cells[r][c] = randCell(rng);
    const nb = neighbours(c, r).filter(([nc, nr]) => !cells[nr][nc]);
    const [nc, nr, e] = choice(rng, nb);
    cells[nr][nc] = cellTouching(rng, OPP[e], choice(rng, edgeColors(cells[r][c], e)));
  }
  for (const [c, r] of undet()) {
    const cons = neighbours(c, r).filter(([nc, nr]) => cells[nr][nc])
      .map(([nc, nr, e]) => [e, new Set(edgeColors(cells[nr][nc], OPP[e]).map(ckey))]);
    cells[r][c] = cellMatching(rng, cons);
  }
  return cells;
}

// ---- recolour: bold OKLCH palette + hue/sat remap, brightness locked ----
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
function boldPalette(N, H0) {
  if (N === 1) return [oklch(0.58, 0.34, H0)];
  const Ls = []; for (let i = 0; i < N; i++) Ls.push(0.95 - (0.95 - 0.15)*i/(N-1));
  const span = Math.min(40, 14*(N-1));
  const pts = []; for (let i = 0; i < N; i++) pts.push([Ls[i], H0 - span + 2*span*i/(N-1)]);
  if (N >= 3) { const m = Math.floor(N/2); pts[m] = [pts[m][0], H0 + 180]; }
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
  const dh = (((hn - ho + 0.5) % 1) + 1) % 1 - 0.5;
  return hsv2rgb((((ho + tHs*dh) % 1) + 1) % 1, so + tHs*(sn - so), vo + tV*(vn - vo));
}
const WEIGHTS = [[1, 0.12], [2, 0.28], [3, 0.30], [4, 0.20], [5, 0.10]];
function pickN(rng) { let x = rng(), acc = 0; for (const [n, w] of WEIGHTS) { acc += w; if (x < acc) return n; } return 3; }

function buildRecolorMap(text, cells) {
  const uniq = [], seen = new Set();
  for (const row of cells) for (const cell of row) for (const col of [cell.fg, cell.bg]) {
    const k = ckey(col); if (!seen.has(k)) { seen.add(k); uniq.push(col); }
  }
  const rng = makeRng("recolor|" + text);
  const key = (c) => (((rgb2hsv(c)[0] - 0) % 1) + 1) % 1;
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
  return cmap;
}

// ---- SVG rendering ----
const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
function renderCell(cell, x, y, w, h) {
  const { kind, data, fg, bg } = cell;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${hex(bg)}" shape-rendering="crispEdges"/>`;
  if (kind === "Q") {
    const sub = [[x, y], [x + w / 2, y], [x, y + h / 2], [x + w / 2, y + h / 2]];
    for (let i = 0; i < 4; i++) if (data[i])
      s += `<rect x="${sub[i][0]}" y="${sub[i][1]}" width="${w / 2}" height="${h / 2}" fill="${hex(fg)}" shape-rendering="crispEdges"/>`;
  } else if (kind === "T") {
    const v = { UL: [[x, y], [x + w, y], [x, y + h]], UR: [[x, y], [x + w, y], [x + w, y + h]],
                LL: [[x, y], [x, y + h], [x + w, y + h]], LR: [[x + w, y], [x, y + h], [x + w, y + h]] }[data];
    s += `<polygon points="${v.map((p) => p.join(",")).join(" ")}" fill="${hex(fg)}"/>`;
  } else {
    const nx = 4, ny = 8, dw = w / nx, dh = h / ny;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const on = data === "med" ? (i + j) % 2 === 0 : data === "light" ? (i % 2 === 0 && j % 2 === 0) : !(i % 2 === 1 && j % 2 === 1);
      if (on) s += `<rect x="${x + i*dw}" y="${y + j*dh}" width="${dw}" height="${dh}" fill="${hex(fg)}" shape-rendering="crispEdges"/>`;
    }
  }
  return s;
}

/** SVG string for `text`. opts: { size = 64, recolor = true }. */
export function flowIcon(text, opts = {}) {
  const size = opts.size || 64;
  let cells = generate(text);
  if (opts.recolor !== false) {
    const cmap = buildRecolorMap(text, cells);
    cells = cells.map((row) => row.map((c) => ({ ...c, fg: cmap.get(ckey(c.fg)) || c.fg, bg: cmap.get(ckey(c.bg)) || c.bg })));
  }
  const cw = size / GW, ch = size / GH;
  let body = "";
  for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) body += renderCell(cells[r][c], c * cw, r * ch, cw, ch);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
}

/** data: URI for <img src> or CSS url(). */
export function flowIconDataURI(text, opts = {}) {
  return "data:image/svg+xml," + encodeURIComponent(flowIcon(text, opts));
}

export default flowIcon;
