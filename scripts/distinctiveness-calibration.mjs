import { GW, GH } from "/Users/julienheller/projects/agenticon/src/generate.js";
import { writeFileSync } from "fs";

// ---- OKLCh -> sRGB (from recolor.js) ----
function oklab2lrgb(L,a,b){const l=(L+0.3963377774*a+0.2158037573*b)**3,m=(L-0.1055613458*a-0.0638541728*b)**3,s=(L-0.0894841775*a-1.2914855480*b)**3;
  return [4.0767416621*l-3.3077115913*m+0.2309699292*s,-1.2684380046*l+2.6097574011*m-0.3413193965*s,-0.0041960863*l-0.7034186147*m+1.7076147010*s];}
const gam=x=>{x=Math.max(0,Math.min(1,x));return x<=0.0031308?12.92*x:1.055*x**(1/2.4)-0.055;};
const inGamut=(L,a,b)=>oklab2lrgb(L,a,b).every(v=>v>=-1e-3&&v<=1+1e-3);
function oklch(L,C,H){const h=H*Math.PI/180;let c=C;while(c>0&&!inGamut(L,c*Math.cos(h),c*Math.sin(h)))c-=0.004;const[R,G,B]=oklab2lrgb(L,c*Math.cos(h),c*Math.sin(h));return [Math.round(255*gam(R)),Math.round(255*gam(G)),Math.round(255*gam(B))];}
// sRGB->OKLab for the pixel-% metric
const dec=c=>{c/=255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;};
function oklab([R,G,B]){const r=dec(R),g=dec(G),b=dec(B);const l=0.4122214708*r+0.5363325363*g+0.0514459929*b,m=0.2119034982*r+0.6806995451*g+0.1073969566*b,s=0.0883024619*r+0.2817188376*g+0.6299787005*b;const L=Math.cbrt(l),M=Math.cbrt(m),S=Math.cbrt(s);return [0.2104542553*L+0.7936177850*M-0.0040720468*S,1.9779984951*L-2.4285922050*M+0.4505937099*S,0.0259040371*L+0.7827717662*M-0.8086757660*S];}

// ---- token cells -> resolved cells ----
const MASK={topHalf:[1,1,0,0],bottomHalf:[0,0,1,1],leftHalf:[1,0,1,0],rightHalf:[0,1,0,1],diag:[1,0,0,1],antidiag:[0,1,1,0],qUL:[1,0,0,0],qUR:[0,1,0,0],qLL:[0,0,1,0],qLR:[0,0,0,1]};
function mk(cls,fg,bg){ if(cls.startsWith("tri")) return {kind:"T",data:cls.slice(3),fg,bg};
  if(cls==="solid") return {kind:"Q",data:[0,0,0,0].map(Boolean),fg:fg,bg:fg};
  return {kind:"Q",data:MASK[cls].map(Boolean),fg,bg}; }
const resolve=(spec,pal)=>spec.map(row=>row.map(({cls,fg,bg})=>mk(cls,pal[fg],pal[bg]||pal[fg])));

// ---- SVG ----
const hex=c=>"#"+c.map(v=>v.toString(16).padStart(2,"0")).join("");
function rc(cell,x,y,w,h){const{kind,data,fg,bg}=cell;let s=`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${hex(bg)}" shape-rendering="crispEdges"/>`;
  if(kind==="Q"){const sub=[[x,y],[x+w/2,y],[x,y+h/2],[x+w/2,y+h/2]];for(let i=0;i<4;i++)if(data[i])s+=`<rect x="${sub[i][0]}" y="${sub[i][1]}" width="${w/2}" height="${h/2}" fill="${hex(fg)}" shape-rendering="crispEdges"/>`;}
  else{const v={UL:[[x,y],[x+w,y],[x,y+h]],UR:[[x,y],[x+w,y],[x+w,y+h]],LL:[[x,y],[x,y+h],[x+w,y+h]],LR:[[x+w,y],[x,y+h],[x+w,y+h]]}[data];s+=`<polygon points="${v.map(p=>p.join(",")).join(" ")}" fill="${hex(fg)}"/>`;}return s;}
const svg=(cells,size=150)=>{const cw=size/GW,ch=size/GH;let b="";for(let r=0;r<GH;r++)for(let c=0;c<GW;c++)b+=rc(cells[r][c],c*cw,r*ch,cw,ch);return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${b}</svg>`;};

// ---- pixel-% (old metric) at 64x32 ----
const RW=64,RH=32,PX=RW*RH,JND=0.02;
const cc=(cell,fx,fy)=>{if(cell.kind==="Q"){const i=(fy>=0.5?2:0)+(fx>=0.5?1:0);return cell.data[i]?cell.fg:cell.bg;}const ins={UL:fx+fy<1,UR:fx>fy,LL:fx<fy,LR:fx+fy>1}[cell.data];return ins?cell.fg:cell.bg;};
function ras(cells){const a=[];for(let py=0;py<RH;py++)for(let px=0;px<RW;px++){const x=(px+0.5)/RW*GW,y=(py+0.5)/RH*GH,c=Math.min(GW-1,x|0),r=Math.min(GH-1,y|0);a.push(oklab(cc(cells[r][c],x-c,y-r)));}return a;}
const pctMatch=(A,B)=>{let w=0;for(let i=0;i<A.length;i++)if(Math.hypot(A[i][0]-B[i][0],A[i][1]-B[i][1],A[i][2]-B[i][2])<JND)w++;return 100*w/PX;};

// ===== BRIGHTNESS-SHAPE: shapes & hue fixed, light/dark map rearranged =====
const H=200;
const bp0={d:oklch(0.30,0.09,H),m:oklch(0.58,0.12,H),l:oklch(0.88,0.06,H)};
const Bbase=[
 [{cls:"solid",fg:"l"},{cls:"topHalf",fg:"m",bg:"d"},{cls:"diag",fg:"l",bg:"m"},{cls:"solid",fg:"d"}],
 [{cls:"solid",fg:"d"},{cls:"leftHalf",fg:"l",bg:"m"},{cls:"solid",fg:"m"},{cls:"topHalf",fg:"d",bg:"l"}]];
const Bpals=[
 {d:oklch(0.36,0.09,H),m:oklch(0.64,0.12,H),l:oklch(0.94,0.05,H)},          // 1 uniform +0.06 lighten (pattern same)
 {d:bp0.d, m:bp0.l, l:bp0.m},                                               // 2 swap mid<->light
 {d:bp0.l, m:bp0.d, l:bp0.m},                                               // 3 rotate levels
 {d:bp0.l, m:bp0.m, l:bp0.d}];                                              // 4 invert dark<->light

// ===== ACCENTS: big regions fixed, only the small accent changes =====
const A0={bg1:oklch(0.55,0.05,265),bg2:oklch(0.42,0.06,265),acc:oklch(0.68,0.32,35)};
const Abase=[
 [{cls:"solid",fg:"bg1"},{cls:"topHalf",fg:"bg2",bg:"bg1"},{cls:"solid",fg:"bg1"},{cls:"solid",fg:"bg2"}],
 [{cls:"solid",fg:"bg2"},{cls:"qUL",fg:"acc",bg:"bg1"},{cls:"solid",fg:"bg1"},{cls:"solid",fg:"bg2"}]];
const Apals=[
 {...A0, acc:oklch(0.68,0.32,60)},                  // 1 accent hue +25 (subtle)
 {...A0, acc:oklch(0.68,0.32,215)},                 // 2 accent ~complementary
 {...A0, acc:oklch(0.60,0.06,265)},                 // 3 accent desaturated into surround family
 {...A0, acc:A0.bg1}];                              // 4 accent removed (= surround)

// ===== STRUCTURE: per-cell colours fixed (coarse luminance fixed), geometry changes =====
const S0={A:oklch(0.85,0.13,95),B:oklch(0.34,0.15,300)};
const Sbase=[
 [{cls:"topHalf",fg:"A",bg:"B"},{cls:"diag",fg:"B",bg:"A"},{cls:"leftHalf",fg:"A",bg:"B"},{cls:"triUR",fg:"A",bg:"B"}],
 [{cls:"triLL",fg:"B",bg:"A"},{cls:"antidiag",fg:"A",bg:"B"},{cls:"topHalf",fg:"B",bg:"A"},{cls:"diag",fg:"A",bg:"B"}]];
const CYCLE=["topHalf","diag","leftHalf","antidiag","bottomHalf","rightHalf","triUR","triLL"];
const swapN=(spec,n)=>{let k=0;return spec.map(row=>row.map(c=>{ if(k++<n){const i=CYCLE.indexOf(c.cls);return {...c,cls:CYCLE[(i+3)%CYCLE.length]};} return c;}));};
const Smags=[2,4,6,8];

// ---- assemble 12 pairs ----
const pairs=[];
Bpals.forEach((p,i)=>pairs.push({sec:"BRIGHTNESS-SHAPE  (structure+hue fixed; light/dark map rearranged)",n:`B${i+1}`,a:resolve(Bbase,bp0),b:resolve(Bbase,p)}));
Apals.forEach((p,i)=>pairs.push({sec:"ACCENTS  (big regions fixed; only the small corner accent changes)",n:`A${i+1}`,a:resolve(Abase,A0),b:resolve(Abase,p)}));
Smags.forEach((n,i)=>pairs.push({sec:"STRUCTURE  (per-cell colours & coarse brightness fixed; geometry changes)",n:`S${i+1}`,a:resolve(Sbase,S0),b:resolve(swapN(Sbase,n),S0)}));

let html=`<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}body{background:#1b1b21;color:#c7c9d1;font-family:"DejaVu Sans Mono",Menlo,monospace;padding:30px 40px;width:820px}
h1{font-size:20px;color:#8595ad;margin-bottom:2px}p.sub{font-size:12px;color:#777;margin-bottom:14px}
h2{font-size:14px;color:#9aa6bd;font-weight:400;margin:22px 0 6px}
.row{display:flex;align-items:center;gap:16px;margin:8px 0}.ic{width:150px;height:150px;line-height:0}.ic svg{display:block;border-radius:4px}
.lab{font-size:13px;line-height:1.5}.lab b{color:#e6e8ee;font-size:15px}.lab span{color:#8a8a94;font-size:12px}.mag{color:#c7c9d1}
</style></head><body>
<h1>distinctiveness calibration set</h1>
<p class="sub">left = reference (same in each section). right drifts on ONE channel, small→large. for each: clearly different / borderline / confusable? (pixel-% = the old metric, for contrast)</p>`;
let cur="";
const sanity=[];
for(const pr of pairs){
  if(pr.sec!==cur){cur=pr.sec;html+=`<h2>${cur}</h2>`;}
  const m=pctMatch(ras(pr.a),ras(pr.b)); sanity.push(`${pr.n}:${m.toFixed(0)}%`);
  html+=`<div class="row"><div class="ic">${svg(pr.a)}</div><div class="ic">${svg(pr.b)}</div>
    <div class="lab"><b>${pr.n}</b> <span class="mag">mag ${pr.n.slice(1)}/4</span><br><span>pixel-%: ${m.toFixed(0)}%</span><br><span>your label: ____________</span></div></div>`;
}
html+=`</body></html>`;
writeFileSync("/tmp/calib.html",html);
console.log("pixel-% per pair:", sanity.join("  "));
console.log("wrote /tmp/calib.html");
