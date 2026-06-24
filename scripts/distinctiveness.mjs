// A perceptual DISTINCTIVENESS metric for agenticons, calibrated to human judgement.
// Channels (combined disjunctively -- you tell two icons apart if ANY channel differs):
//   brightness-shape : correlation of mean-removed coarse luminance maps; a photo-negative
//                       counts as only HALF a change (partial contrast-polarity invariance).
//   accents          : strength of the most salient small high-contrast "pop" (hue-blind).
//   colour           : area-weighted dominant-colour (a,b) centroid.
//   structure        : orientation/busyness  (LOW weight -- fine shape barely registers).
// Lower combined distance = more confusable.  Run with "twins" arg to re-rank a batch.

import { generate, GW, GH } from "../src/generate.js";
import { buildRecolorMap } from "../src/recolor.js";
import { ckey } from "../src/palette.js";

// ---- colour maths ----
const dec = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function oklab([R, G, B]) { const r = dec(R), g = dec(G), b = dec(B);
  const l = 0.4122214708*r+0.5363325363*g+0.0514459929*b, m = 0.2119034982*r+0.6806995451*g+0.1073969566*b, s = 0.0883024619*r+0.2817188376*g+0.6299787005*b;
  const L = Math.cbrt(l), M = Math.cbrt(m), S = Math.cbrt(s);
  return [0.2104542553*L+0.7936177850*M-0.0040720468*S, 1.9779984951*L-2.4285922050*M+0.4505937099*S, 0.0259040371*L+0.7827717662*M-0.8086757660*S]; }
// OKLCh -> sRGB (for building calibration colours)
function oklab2lrgb(L,a,b){const l=(L+0.3963377774*a+0.2158037573*b)**3,m=(L-0.1055613458*a-0.0638541728*b)**3,s=(L-0.0894841775*a-1.2914855480*b)**3;return [4.0767416621*l-3.3077115913*m+0.2309699292*s,-1.2684380046*l+2.6097574011*m-0.3413193965*s,-0.0041960863*l-0.7034186147*m+1.7076147010*s];}
const gam=x=>{x=Math.max(0,Math.min(1,x));return x<=0.0031308?12.92*x:1.055*x**(1/2.4)-0.055;};
const inGamut=(L,a,b)=>oklab2lrgb(L,a,b).every(v=>v>=-1e-3&&v<=1+1e-3);
function oklch(L,C,H){const h=H*Math.PI/180;let c=C;while(c>0&&!inGamut(L,c*Math.cos(h),c*Math.sin(h)))c-=0.004;const[R,G,B]=oklab2lrgb(L,c*Math.cos(h),c*Math.sin(h));return [Math.round(255*gam(R)),Math.round(255*gam(G)),Math.round(255*gam(B))];}

// ---- rasterise a cell ----
const cc = (cell, fx, fy) => { if (cell.kind === "Q") { const i = (fy >= 0.5 ? 2 : 0) + (fx >= 0.5 ? 1 : 0); return cell.data[i] ? cell.fg : cell.bg; }
  const ins = { UL: fx + fy < 1, UR: fx > fy, LL: fx < fy, LR: fx + fy > 1 }[cell.data]; return ins ? cell.fg : cell.bg; };

// ---- per-icon descriptor ----
const LW = GW, LH = GH, LN = LW * LH;        // coarse luminance map = per-cell mean ("squint to cells")
function descriptor(cells) {
  // per-cell mean luminance (mean-removed) + contrast.  Per-cell (not finer) so that
  // within-cell geometry changes -- which preserve cell-average luminance -- do NOT leak
  // into the brightness-shape channel (they belong to structure).
  const L = new Float64Array(LN);
  for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
    const cell = cells[r][c];                  // exact area-weighted mean luminance per cell
    if (cell.kind === "T") L[r * GW + c] = 0.5 * oklab(cell.fg)[0] + 0.5 * oklab(cell.bg)[0];
    else { let m = 0; for (let i = 0; i < 4; i++) m += oklab(cell.data[i] ? cell.fg : cell.bg)[0]; L[r * GW + c] = m / 4; }
  }
  let mean = 0; for (const v of L) mean += v; mean /= LN;
  const dev = L.map((v) => v - mean); let std = 0; for (const v of dev) std += v * v; std = Math.sqrt(std);
  // area map -> colour centroid + accent strength
  const area = new Map();
  for (const row of cells) for (const cell of row) {
    if (cell.kind === "Q") for (let i = 0; i < 4; i++) { const col = cell.data[i] ? cell.fg : cell.bg; const k = ckey(col); area.set(k, (area.get(k) || { a: 0, col }).a !== undefined ? { a: (area.get(k)?.a || 0) + 0.25, col } : { a: 0.25, col }); }
    else { for (const col of [cell.fg, cell.bg]) { const k = ckey(col); area.set(k, { a: (area.get(k)?.a || 0) + 0.5, col }); } }
  }
  const labOf = (col) => oklab(col);
  // chroma-weighted hue histogram (WHICH hues are present, not their average -- averaging
  // opposite hues cancels to neutral and falsely matches vivid icons).
  const NB = 12; const hue = new Float64Array(NB); let chrom = 0, tot = 0; const items = [];
  for (const { a, col } of area.values()) {
    const lab = labOf(col), C = Math.hypot(lab[1], lab[2]), w = a * C;
    const h = ((Math.atan2(lab[2], lab[1]) / (2 * Math.PI)) % 1 + 1) % 1, f = h * NB, b0 = Math.floor(f) % NB, fr = f - Math.floor(f);
    hue[b0] += w * (1 - fr); hue[(b0 + 1) % NB] += w * fr;     // linear spread = light smoothing on the ring
    chrom += w; tot += a; items.push({ a, lab });
  }
  let hs = 0; for (const v of hue) hs += v; if (hs > 0) for (let i = 0; i < NB; i++) hue[i] /= hs;
  const colorful = chrom / tot;
  // accent = small region with high contrast to the (area-weighted) rest
  let accent = 0;
  for (const it of items) {
    let ra = 0, rA = 0, rB = 0, rL = 0;
    for (const o of items) if (o !== it) { ra += o.a; rA += o.lab[1] * o.a; rB += o.lab[2] * o.a; rL += o.lab[0] * o.a; }
    if (ra <= 0) continue; rA /= ra; rB /= ra; rL /= ra;
    const contrast = Math.hypot(it.lab[0] - rL, it.lab[1] - rA, it.lab[2] - rB);
    const smallness = Math.max(0, 1 - it.a / 2);     // peaks for tiny isolated regions
    accent = Math.max(accent, contrast * smallness);
  }
  // structure: orientation energy + busyness
  let orient = 0, busy = 0;
  for (const row of cells) for (const cell of row) {
    if (cell.kind === "T") { orient += 1; busy += 1; }
    else { const sum = cell.data.reduce((s, x) => s + (x ? 1 : 0), 0);
      if (sum > 0 && sum < 4) busy += 1;
      if ((cell.data[0] && cell.data[3] && !cell.data[1] && !cell.data[2]) || (cell.data[1] && cell.data[2] && !cell.data[0] && !cell.data[3])) orient += 1; }
  }
  // saturate accent strength -> near-binary "is there a salient pop?" (hue/strength-blind once present)
  return { dev, std, hue, colorful, accent: accent / (accent + 0.15), orient: orient / 8, busy: busy / 8 };
}

function pearson(a, b) { let saa = 0, sbb = 0, sab = 0; for (let i = 0; i < a.length; i++) { saa += a[i]*a[i]; sbb += b[i]*b[i]; sab += a[i]*b[i]; }
  const ca = Math.sqrt(saa), cb = Math.sqrt(sbb);
  if (ca < 1e-4 && cb < 1e-4) return 1; if (ca < 1e-4 || cb < 1e-4) return 0; return sab / (ca * cb); }

// raw per-channel distances
function channels(p, q) {
  const rho = pearson(p.dev, q.dev);
  const dB = 1 - Math.max(rho, 0.5 * -rho);                 // [0,1]; negative corr (negative img) -> ~0.5
  const dA = Math.abs(p.accent - q.accent);
  // colour: hue-ring distribution distance, down-weighted when either icon is near-grey,
  // plus a colourful-vs-muted term.
  const conf = Math.min(1, Math.min(p.colorful, q.colorful) / 0.04);
  let tv = 0; for (let i = 0; i < p.hue.length; i++) tv += Math.abs(p.hue[i] - q.hue[i]); tv *= 0.5;
  const dC = conf * tv + 0.5 * Math.abs(p.colorful - q.colorful) / 0.12;
  const dS = Math.hypot(p.orient - q.orient, p.busy - q.busy);
  return { dB, dA, dC, dS };
}
// combine with calibration weights, disjunctive (power-mean, p=3 ~ soft max)
const W = { dB: 1.0, dA: 0.9, dC: 0.6, dS: 0.25 };
function combine(ch, norm) {
  const x = [W.dB * ch.dB / norm.dB, W.dA * ch.dA / norm.dA, W.dC * ch.dC / norm.dC, W.dS * ch.dS / norm.dS];
  const p = 3; let s = 0; for (const v of x) s += v ** p; return s ** (1 / p);
}

// ===== PART A: self-test on the calibration set =====
const MASK={topHalf:[1,1,0,0],bottomHalf:[0,0,1,1],leftHalf:[1,0,1,0],rightHalf:[0,1,0,1],diag:[1,0,0,1],antidiag:[0,1,1,0],qUL:[1,0,0,0]};
function mk(cls,fg,bg){ if(cls.startsWith("tri")) return {kind:"T",data:cls.slice(3),fg,bg}; if(cls==="solid") return {kind:"Q",data:[false,false,false,false],fg,bg:fg}; return {kind:"Q",data:MASK[cls].map(Boolean),fg,bg}; }
const resolve=(spec,pal)=>spec.map(row=>row.map(({cls,fg,bg})=>mk(cls,pal[fg],pal[bg]||pal[fg])));
const H=200, bp0={d:oklch(0.30,0.09,H),m:oklch(0.58,0.12,H),l:oklch(0.88,0.06,H)};
const Bbase=[[{cls:"solid",fg:"l"},{cls:"topHalf",fg:"m",bg:"d"},{cls:"diag",fg:"l",bg:"m"},{cls:"solid",fg:"d"}],[{cls:"solid",fg:"d"},{cls:"leftHalf",fg:"l",bg:"m"},{cls:"solid",fg:"m"},{cls:"topHalf",fg:"d",bg:"l"}]];
const Bpals=[{d:oklch(0.36,0.09,H),m:oklch(0.64,0.12,H),l:oklch(0.94,0.05,H)},{d:bp0.d,m:bp0.l,l:bp0.m},{d:bp0.l,m:bp0.d,l:bp0.m},{d:bp0.l,m:bp0.m,l:bp0.d}];
const A0={bg1:oklch(0.55,0.05,265),bg2:oklch(0.42,0.06,265),acc:oklch(0.68,0.32,35)};
const Abase=[[{cls:"solid",fg:"bg1"},{cls:"topHalf",fg:"bg2",bg:"bg1"},{cls:"solid",fg:"bg1"},{cls:"solid",fg:"bg2"}],[{cls:"solid",fg:"bg2"},{cls:"qUL",fg:"acc",bg:"bg1"},{cls:"solid",fg:"bg1"},{cls:"solid",fg:"bg2"}]];
const Apals=[{...A0,acc:oklch(0.68,0.32,60)},{...A0,acc:oklch(0.68,0.32,215)},{...A0,acc:oklch(0.60,0.06,265)},{...A0,acc:A0.bg1}];
const S0={A:oklch(0.85,0.13,95),B:oklch(0.34,0.15,300)};
const Sbase=[[{cls:"topHalf",fg:"A",bg:"B"},{cls:"diag",fg:"B",bg:"A"},{cls:"leftHalf",fg:"A",bg:"B"},{cls:"triUR",fg:"A",bg:"B"}],[{cls:"triLL",fg:"B",bg:"A"},{cls:"antidiag",fg:"A",bg:"B"},{cls:"topHalf",fg:"B",bg:"A"},{cls:"diag",fg:"A",bg:"B"}]];
const CYCLE=["topHalf","diag","leftHalf","antidiag","bottomHalf","rightHalf","triUR","triLL"];
const swapN=(spec,n)=>{let k=0;return spec.map(row=>row.map(c=>{if(k++<n){const i=CYCLE.indexOf(c.cls);return {...c,cls:CYCLE[(i+3)%CYCLE.length]};}return c;}));};

const cal=[];
Bpals.forEach((p,i)=>cal.push(["B"+(i+1),resolve(Bbase,bp0),resolve(Bbase,p)]));
Apals.forEach((p,i)=>cal.push(["A"+(i+1),resolve(Abase,A0),resolve(Abase,p)]));
[2,4,6,8].forEach((n,i)=>cal.push(["S"+(i+1),resolve(Sbase,S0),resolve(swapN(Sbase,n),S0)]));

// calibration-scale normalisers (rough, so weights are comparable)
const norm = { dB: 1, dA: 0.5, dC: 0.6, dS: 0.6 };
console.log("self-test on calibration set (raw channel dists; D=combined; lower=more confusable)\n");
console.log("pair  dB    dA    dC    dS    ->  D");
for (const [name, a, b] of cal) { const ch = channels(descriptor(a), descriptor(b)); const D = combine(ch, norm);
  console.log(`${name}   ${ch.dB.toFixed(2)}  ${ch.dA.toFixed(2)}  ${ch.dC.toFixed(2)}  ${ch.dS.toFixed(2)}  ->  ${D.toFixed(2)}`); }
console.log("\nexpected from your calibration: B1<B2<B4<B3 ; A1~A2 < A3~A4 ; S1..S4 all low, slightly rising");

// ===== PART B: re-rank a batch's "confusable twins" with the calibrated metric =====
if (process.argv.includes("twins")) {
  const { writeFileSync } = await import("fs");
  const recolour = (t) => { const base = generate(t), m = buildRecolorMap(t, base); return base.map(row => row.map(c => ({ ...c, fg: m.get(ckey(c.fg)) || c.fg, bg: m.get(ckey(c.bg)) || c.bg }))); };
  // 32x16 raster for the OLD pixel-% metric
  const RW = 32, RH = 16, PX = RW * RH;
  const ras = (cells) => { const a = []; for (let py = 0; py < RH; py++) for (let px = 0; px < RW; px++) { const x = (px + .5) / RW * GW, y = (py + .5) / RH * GH, c = Math.min(GW - 1, x | 0), r = Math.min(GH - 1, y | 0); a.push(oklab(cc(cells[r][c], x - c, y - r))); } return a; };
  const pixpct = (A, B) => { let w = 0; for (let i = 0; i < A.length; i++) if (Math.hypot(A[i][0] - B[i][0], A[i][1] - B[i][1], A[i][2] - B[i][2]) < 0.02) w++; return 100 * w / PX; };
  // SVG
  const hx = c => "#" + c.map(v => v.toString(16).padStart(2, "0")).join("");
  const rcell = (cell, x, y, w, h) => { const { kind, data, fg, bg } = cell; let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${hx(bg)}" shape-rendering="crispEdges"/>`;
    if (kind === "Q") { const sub = [[x, y], [x + w / 2, y], [x, y + h / 2], [x + w / 2, y + h / 2]]; for (let i = 0; i < 4; i++) if (data[i]) s += `<rect x="${sub[i][0]}" y="${sub[i][1]}" width="${w / 2}" height="${h / 2}" fill="${hx(fg)}" shape-rendering="crispEdges"/>`; }
    else { const v = { UL: [[x, y], [x + w, y], [x, y + h]], UR: [[x, y], [x + w, y], [x + w, y + h]], LL: [[x, y], [x, y + h], [x + w, y + h]], LR: [[x + w, y], [x, y + h], [x + w, y + h]] }[data]; s += `<polygon points="${v.map(p => p.join(",")).join(" ")}" fill="${hx(fg)}"/>`; } return s; };
  const svg = (cells, size = 140) => { const cw = size / GW, ch = size / GH; let b = ""; for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) b += rcell(cells[r][c], c * cw, r * ch, cw, ch); return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${b}</svg>`; };

  const N = 3000, cells = [], desc = [], rast = [];
  for (let i = 0; i < N; i++) { const cl = recolour("z#" + i); cells.push(cl); desc.push(descriptor(cl)); rast.push(ras(cl)); }
  const ins = (arr, x, key, K = 10) => { if (arr.length < K || key(x) < key(arr[arr.length - 1])) { arr.push(x); arr.sort((a, b) => key(a) - key(b)); if (arr.length > K) arr.pop(); } };
  const insMax = (arr, x, key, K = 10) => { if (arr.length < K || key(x) > key(arr[arr.length - 1])) { arr.push(x); arr.sort((a, b) => key(b) - key(a)); if (arr.length > K) arr.pop(); } };
  let lowD = [], hiPix = [];
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const ch = channels(desc[i], desc[j]); const D = combine(ch, norm); const pp = pixpct(rast[i], rast[j]);
    const rec = { i, j, D, pp, ch };
    ins(lowD, rec, r => r.D); insMax(hiPix, rec, r => r.pp);
  }
  const row = (r, showD = true) => `<div class="row"><div class="ic">${svg(cells[r.i])}</div><div class="ic">${svg(cells[r.j])}</div>
    <div class="lab"><b>D=${r.D.toFixed(2)}</b> <span>(${r.D < 0.35 ? "confusable" : r.D < 0.7 ? "borderline" : "distinct"})</span><br>
    <span>pixel-%: ${r.pp.toFixed(0)}%</span><br><span>bright ${r.ch.dB.toFixed(2)} · accent ${r.ch.dA.toFixed(2)} · colour ${r.ch.dC.toFixed(2)}</span></div></div>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}body{background:#1b1b21;color:#c7c9d1;font-family:"DejaVu Sans Mono",Menlo,monospace;padding:30px 38px;width:820px}
  h1{font-size:19px;color:#8595ad}h2{font-size:14px;color:#9aa6bd;font-weight:400;margin:20px 0 6px}p.sub{font-size:12px;color:#777;margin:2px 0 10px}
  .row{display:flex;align-items:center;gap:15px;margin:8px 0}.ic{width:140px;height:140px;line-height:0}.ic svg{display:block;border-radius:4px}
  .lab{font-size:13px;line-height:1.45}.lab b{color:#e6e8ee;font-size:15px}.lab span{color:#8a8a94;font-size:12px}</style></head><body>
  <h1>re-ranking the twins with the calibrated distinctiveness metric (batch of ${N})</h1>
  <h2>A. MOST confusable per the new metric (lowest D) — should look genuinely samey</h2>
  <p class="sub">same brightness-pattern + colour + accent-presence</p>
  ${lowD.map(r => row(r)).join("")}
  <h2>B. the old pixel-% "twins" (highest pixel-%) — re-scored by the new metric</h2>
  <p class="sub">where new D is high, the new metric "rescues" them: pixel-% called them similar, but they differ on a channel your eye uses</p>
  ${hiPix.map(r => row(r)).join("")}
  </body></html>`;
  writeFileSync("/tmp/rerank.html", html);
  console.log("NEW most-confusable D:", lowD.map(r => r.D.toFixed(2)).join(", "));
  console.log("old pixel-% twins:", hiPix.map(r => r.pp.toFixed(0) + "%").join(", "), "-> their new D:", hiPix.map(r => r.D.toFixed(2)).join(", "));
  console.log("wrote /tmp/rerank.html");
}
