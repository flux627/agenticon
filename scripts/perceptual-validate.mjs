import { generate, GW, GH } from "/Users/julienheller/projects/agenticon/src/generate.js";
import { buildRecolorMap } from "/Users/julienheller/projects/agenticon/src/recolor.js";
import { ckey } from "/Users/julienheller/projects/agenticon/src/palette.js";
import { writeFileSync } from "fs";

// --- render arbitrary cells -> SVG (mirrors src/render.js) ---
const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
function renderCell(cell, x, y, w, h) {
  const { kind, data, fg, bg } = cell;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${hex(bg)}" shape-rendering="crispEdges"/>`;
  if (kind === "Q") {
    const sub = [[x,y],[x+w/2,y],[x,y+h/2],[x+w/2,y+h/2]];
    for (let i=0;i<4;i++) if (data[i]) s += `<rect x="${sub[i][0]}" y="${sub[i][1]}" width="${w/2}" height="${h/2}" fill="${hex(fg)}" shape-rendering="crispEdges"/>`;
  } else {
    const v = { UL:[[x,y],[x+w,y],[x,y+h]], UR:[[x,y],[x+w,y],[x+w,y+h]], LL:[[x,y],[x,y+h],[x+w,y+h]], LR:[[x+w,y],[x,y+h],[x+w,y+h]] }[data];
    s += `<polygon points="${v.map(p=>p.join(",")).join(" ")}" fill="${hex(fg)}"/>`;
  }
  return s;
}
function svg(cells, size=140){
  const cw=size/GW, ch=size/GH; let body="";
  for (let r=0;r<GH;r++) for (let c=0;c<GW;c++) body+=renderCell(cells[r][c], c*cw, r*ch, cw, ch);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
}
const recolorWith = (base, seedText) => {
  const cmap = buildRecolorMap(seedText, base);
  return base.map(row=>row.map(c=>({...c, fg:cmap.get(ckey(c.fg))||c.fg, bg:cmap.get(ckey(c.bg))||c.bg})));
};

// --- perceptual match% at a faithful resolution (64x32 OKLab raster) ---
const dec=c=>{c/=255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;};
const oklab=(R,G,B)=>{const r=dec(R),g=dec(G),b=dec(B);
  const l=0.4122214708*r+0.5363325363*g+0.0514459929*b,m=0.2119034982*r+0.6806995451*g+0.1073969566*b,s=0.0883024619*r+0.2817188376*g+0.6299787005*b;
  const L=Math.cbrt(l),M=Math.cbrt(m),S=Math.cbrt(s);
  return [0.2104542553*L+0.7936177850*M-0.0040720468*S,1.9779984951*L-2.4285922050*M+0.4505937099*S,0.0259040371*L+0.7827717662*M-0.8086757660*S];};
const RW=64,RH=32;
const cc=(cell,fx,fy)=>{if(cell.kind==="Q"){const i=(fy>=0.5?2:0)+(fx>=0.5?1:0);return cell.data[i]?cell.fg:cell.bg;}
  const ins={UL:fx+fy<1,UR:fx>fy,LL:fx<fy,LR:fx+fy>1}[cell.data];return ins?cell.fg:cell.bg;};
function ras(cells){const a=new Float32Array(RW*RH*3);let o=0;for(let py=0;py<RH;py++)for(let px=0;px<RW;px++){const x=(px+0.5)/RW*GW,y=(py+0.5)/RH*GH,c=Math.min(GW-1,x|0),r=Math.min(GH-1,y|0);const L=oklab(...cc(cells[r][c],x-c,y-r));a[o++]=L[0];a[o++]=L[1];a[o++]=L[2];}return a;}
const JND=0.02;
function match(a,b){let w=0,sum=0,n=a.length/3;for(let i=0;i<a.length;i+=3){const d=Math.hypot(a[i]-b[i],a[i+1]-b[i+1],a[i+2]-b[i+2]);if(d<JND)w++;sum+=d;}return{pct:100*w/n,mean:sum/n};}

// --- build a same-structure colour ladder for a base ---
function ladder(baseText, dEtargets){
  const base=generate(baseText);
  const ref=recolorWith(base,"v0");
  const refR=ras(ref);
  const cands=[];
  for(let i=1;i<8000;i++){const cells=recolorWith(base,"v"+i);const{pct,mean}=match(refR,ras(cells));cands.push({i,pct,mean,cells});}
  const chosen=dEtargets.map(t=>cands.reduce((best,c)=>Math.abs(c.mean-t)<Math.abs(best.mean-t)?c:best));
  return {ref, refSvg:svg(ref), rows:chosen.map(c=>({pct:c.pct,mean:c.mean,svg:svg(c.cells)}))};
}

const L1 = ladder("claude",     [0.002,0.012,0.025,0.05,0.09,0.15,0.24]);
const L2 = ladder("production", [0.002,0.02,0.04,0.08,0.14,0.22]);

// --- cross-structure: real different-string pairs (the everyday case) ---
const pairs=[["alice@example.com","bob@example.com"],["carol","dave"],["james","staging"],["git@github.com","192.168.1.42"]];
const cross = pairs.map(([a,b])=>{const ca=generate(a),cb=generate(b);const{pct,mean}=match(ras(recolorWith(ca,a)),ras(recolorWith(cb,b)));
  return {a,b,pct,mean,sa:svg(recolorWith(ca,a)),sb:svg(recolorWith(cb,b))};});

const row=(left,right,pct,mean,note="")=>`
  <div class="row"><div class="ic">${left}</div><div class="ic">${right}</div>
   <div class="lab"><b>${pct.toFixed(1)}% match</b><br><span>mean ΔE ${mean.toFixed(3)}${mean<JND?" (&lt;JND)":""}</span>${note?`<br><span>${note}</span>`:""}</div></div>`;

const html=`<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}body{background:#1b1b21;color:#c7c9d1;font-family:"DejaVu Sans Mono",Menlo,monospace;padding:34px 40px;width:760px}
h1{font-size:22px;color:#8595ad;margin-bottom:4px}h2{font-size:16px;color:#9aa6bd;margin:26px 0 10px;font-weight:400}
p.sub{font-size:13px;color:#777;margin-bottom:6px}
.row{display:flex;align-items:center;gap:18px;margin:10px 0}
.ic{width:140px;height:140px;line-height:0}.ic svg{display:block;border-radius:4px}
.lab{font-size:14px;line-height:1.5}.lab b{color:#e6e8ee;font-weight:600}.lab span{color:#8a8a94;font-size:12px}
</style></head><body>
<h1>does perceptual match%% track what you see?</h1>
<p class="sub">match%% = %% of pixels within 1 JND in OKLab (the metric behind the ~10¹³ estimate)</p>

<h2>A. same structure, recoloured — colour-distance ladder ("claude")</h2>
<p class="sub">top = the two are within a JND everywhere → metric calls them identical. does it look identical?</p>
${L1.rows.map(r=>row(L1.refSvg,r.svg,r.pct,r.mean)).join("")}

<h2>B. same structure, recoloured ("production")</h2>
${L2.rows.map(r=>row(L2.refSvg,r.svg,r.pct,r.mean)).join("")}

<h2>C. different input strings — the everyday case</h2>
<p class="sub">two different users/seeds: almost always a tiny match%%, and they look nothing alike</p>
${cross.map(c=>row(c.sa,c.sb,c.pct,c.mean,`${c.a} vs ${c.b}`)).join("")}
</body></html>`;
writeFileSync("/tmp/validate.html",html);
console.log("ladder1 match%:",L1.rows.map(r=>r.pct.toFixed(1)).join(", "));
console.log("ladder2 match%:",L2.rows.map(r=>r.pct.toFixed(1)).join(", "));
console.log("cross match%:",cross.map(c=>c.pct.toFixed(1)).join(", "));
console.log("wrote /tmp/validate.html");
