// Recolour pass: remap a generated icon onto a small bold palette.
//
// Unique chromatic colours are hue-sorted at a random phase, split into N (1-5)
// contiguous groups, and each is shifted 70% toward its group's bold OKLCH colour in
// hue + saturation -- brightness left untouched so the icon's light/dark structure, and
// thus every shape's legibility, is preserved. Achromatic colours go to the nearest
// bold colour by brightness. Seeded independently of generation ("recolor|" + text).

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
  return cmap;
}
