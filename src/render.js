// Rendering. SVG (for the web) and ANSI block-glyphs (for the terminal) are two views
// of the same icon: both go through `cellsFor` (generate + optional recolour) and only
// the final per-cell drawing differs.

import { generate, GW, GH } from "./generate.js";
import { buildRecolorMap } from "./recolor.js";
import { ckey } from "./palette.js";

// Shared path: generate, then (by default) remap onto the bold palette.
function cellsFor(text, recolor) {
  let cells = generate(text);
  if (recolor) {
    const cmap = buildRecolorMap(text, cells);
    const m = (col) => cmap.get(ckey(col)) || col;
    cells = cells.map((row) => row.map((c) => {
      const nc = { ...c, fg: m(c.fg), bg: m(c.bg) };
      if (c.diag) nc.diag = { ...c.diag, color: m(c.diag.color) };   // borrowed accent rides the remap too
      return nc;
    }));
  }
  return cells;
}

// ---- SVG ----
const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
const DIAG_STROKE = 0.05;   // accent line width, as a fraction of the cell's shorter side

// The icon as polygon faces on an 8x4 vertex grid (each cell spans 2x2 units): a Q cell is four
// unit squares, a T cell two triangles. Faces are grouped by colour so each colour renders as a
// SINGLE <path> -- one fill, one antialiasing pass -- which makes adjacent same-colour faces a
// seamless union (no internal edges to conflate). Only genuine colour boundaries remain, and the
// dominant colour underlays everything as a backdrop so those never expose the page.
const shoelace = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
// Sutherland-Hodgman: keep the part of `poly` where f(point) <= 0 (clip to one half-plane).
function clipHalf(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa <= 0) !== (fb <= 0)) { const t = fa / (fa - fb); out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
  }
  return out;
}
function faceGroups(cells) {
  const groups = new Map();                                  // ckey -> { rgb, polys, area }
  const add = (rgb, pts) => {
    let g = groups.get(ckey(rgb));
    if (!g) groups.set(ckey(rgb), (g = { rgb, polys: [], area: 0 }));
    g.polys.push(pts); g.area += Math.abs(shoelace(pts));
  };
  for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
    const cell = cells[r][c], X = 2 * c, Y = 2 * r;
    if (cell.kind === "Q") {
      const o = [[X, Y], [X + 1, Y], [X, Y + 1], [X + 1, Y + 1]];   // UL UR LL LR origins
      for (let i = 0; i < 4; i++) { const [a, b] = o[i];
        add(cell.data[i] ? cell.fg : cell.bg, [[a, b], [a + 1, b], [a + 1, b + 1], [a, b + 1]]); }
    } else {
      const TL = [X, Y], TR = [X + 2, Y], BL = [X, Y + 2], BR = [X + 2, Y + 2];
      const [ft, bt] = { UL: [[TL, TR, BL], [TR, BR, BL]], UR: [[TL, TR, BR], [TL, BR, BL]],
                         LL: [[TL, BL, BR], [TL, TR, BR]], LR: [[TR, BL, BR], [TL, TR, BL]] }[cell.data];
      add(cell.fg, ft); add(cell.bg, bt);
    }
  }
  return [...groups.values()];
}

/** SVG string for `text`. opts: { size = 64, recolor = true }. */
export function agenticon(text, opts = {}) {
  const size = opts.size || 64;
  const cells = cellsFor(text, opts.recolor !== false);
  const sx = size / (GW * 2), sy = size / (GH * 2);          // unit-grid -> px
  const groups = faceGroups(cells);
  const bg = groups.reduce((a, b) => (b.area > a.area ? b : a));   // dominant colour = backdrop
  let body = `<rect width="${size}" height="${size}" fill="${hex(bg.rgb)}"/>`;
  for (const g of groups) {
    if (g === bg) continue;
    const d = g.polys.map((p) => "M" + p.map(([x, y]) => `${x * sx} ${y * sy}`).join("L") + "Z").join("");
    body += `<path d="${d}" fill="${hex(g.rgb)}"/>`;
  }
  // Accent strokes ride on top. The stroke is the borrowed colour leaking out of the vertex V into
  // the host tile, so its vertex end has to land *on* the matching colour. STRAIGHT (off=null): the
  // colour is straight across V, so the band tapers to a point at V (it meets that colour there) and
  // to a point at the far corner O. OFFSET (off=[dx,dy]): the colour is in a side tile, so the band
  // is shifted perpendicular toward that side and run past V across the bordering edge, where it is
  // consumed by the matching colour; it's clipped to host+neighbour so it can't spill elsewhere.
  const cw = size / GW, ch = size / GH, rad = Math.min(cw, ch) * DIAG_STROKE / 2;
  const taper = 2 * rad * Math.max(cw, ch) / Math.min(cw, ch);
  for (let gr = 0; gr < GH; gr++) for (let gc = 0; gc < GW; gc++) {
    const cell = cells[gr][gc]; if (!cell.diag) continue;
    const { dir, color, off } = cell.diag, x = gc * cw, y = gr * ch;
    const TL = [x, y], TR = [x + cw, y], BL = [x, y + ch], BR = [x + cw, y + ch];
    const [V, O] = dir === "\\" ? (gr === 0 ? [BR, TL] : [TL, BR]) : (gr === 0 ? [BL, TR] : [TR, BL]);
    const L = Math.hypot(V[0] - O[0], V[1] - O[1]), d = [(V[0] - O[0]) / L, (V[1] - O[1]) / L];   // O -> V
    const q = [-d[1] * rad, d[0] * rad];                       // perpendicular half-width
    const tx = d[0] * taper, ty = d[1] * taper;
    let pts;
    // O is always on the icon's top/bottom border, so that end runs off the icon: extend it past O
    // (away from V) and let the clip / viewport cut it along the border -- no taper, no chop.
    const eo = ch, ox = O[0] - d[0] * eo, oy = O[1] - d[1] * eo;
    if (!off) {
      // straight: a full-width band that runs through V and past it into the diagonally-opposite
      // tile (same colour), where its end is consumed -- no taper either side.
      const ex = V[0] + d[0] * taper, ey = V[1] + d[1] * taper;   // flat end pushed past V into the origin
      pts = [[ox + q[0], oy + q[1]], [ex + q[0], ey + q[1]], [ex - q[0], ey - q[1]], [ox - q[0], oy - q[1]]];
    } else {
      // The band sits entirely on the colour side of the diagonal: its trailing edge IS the
      // diagonal (through V and O) -- a perpendicular shift of exactly the half-width -- so it can't
      // spill into the far (non-matching) tile. Full width `2*rad` perpendicular; near V the leading
      // edge crosses the bordering edge into the matching colour and is consumed there. The crossing
      // length up the edge is 2*rad/sin(angle), which falls out of the geometry -- no magic constant.
      let n = [-d[1], d[0]];                                   // perpendicular toward the colour side
      if (n[0] * off[0] + n[1] * off[1] < 0) n = [d[1], -d[0]];
      const w = 2 * rad;                                      // clean parallelogram (the "rectangle"):
      pts = [[ox, oy], V, [V[0] + n[0] * w, V[1] + n[1] * w],  // one side IS the diagonal (O->V, bisects tile);
             [ox + n[0] * w, oy + n[1] * w]];                  // the opposite side rides at +w, into the colour
    }
    if (pts.length > 2) body += `<polygon points="${pts.map((p) => `${p[0]} ${p[1]}`).join(" ")}" fill="${hex(color)}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
}

/** data: URI for an <img src> or CSS url(). */
export function agenticonDataURI(text, opts = {}) {
  return "data:image/svg+xml," + encodeURIComponent(agenticon(text, opts));
}

// ---- terminal: half-block glyphs + ANSI colour ----
const MASK2GLYPH = {
  "0000": " ", "1000": "▘", "0100": "▝", "0010": "▖",
  "0001": "▗", "1100": "▀", "0011": "▄", "1010": "▌",
  "0101": "▐", "1001": "▚", "0110": "▞", "1110": "▛",
  "1101": "▜", "1011": "▙", "0111": "▟", "1111": "█",
};
const TRI2GLYPH = { UL: "◤", UR: "◥", LL: "◣", LR: "◢" };
const maskKey = (data) => data.map((b) => (b ? 1 : 0)).join("");

// Canonical form: fg/bg swaps shrink the glyph set (quadrants 16->8, triangles 4->2)
// and never emit the full block. Returns [glyph, fg, bg].
function toGlyph(cell, canonical) {
  const { kind, fg, bg } = cell;
  if (cell.diag)                                                              // accent stroke over a solid
    return [cell.diag.dir === "\\" ? "╲" : "╱", cell.diag.color, cell.data[0] ? fg : bg];
  if (kind === "Q") {
    let mask = cell.data, f = fg, b = bg;
    const sum = mask.reduce((s, x) => s + (x ? 1 : 0), 0);
    if (canonical && (sum > 2 || (sum === 2 && !mask[0]))) { mask = mask.map((x) => !x); f = bg; b = fg; }
    return [MASK2GLYPH[maskKey(mask)], f, b];
  }
  let corner = cell.data, f = fg, b = bg;
  if (canonical && corner === "LR") { corner = "UL"; f = bg; b = fg; }       // ◢(F,B) == ◤(B,F)
  else if (canonical && corner === "LL") { corner = "UR"; f = bg; b = fg; }  // ◣(F,B) == ◥(B,F)
  return [TRI2GLYPH[corner], f, b];
}

const ESC = "\x1b", RESET = "\x1b[0m";
function rgb256([r, g, b]) {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round((r - 8) / 247 * 24);
  }
  return 16 + 36 * Math.round(r / 255 * 5) + 6 * Math.round(g / 255 * 5) + Math.round(b / 255 * 5);
}
function sgr(fg, bg, mode) {
  if (mode === "256") return `${ESC}[38;5;${rgb256(fg)};48;5;${rgb256(bg)}m`;
  return `${ESC}[38;2;${fg[0]};${fg[1]};${fg[2]};48;2;${bg[0]};${bg[1]};${bg[2]}m`;
}

/** Two lines of ANSI-coloured block glyphs for `text`.
 *  opts: { recolor = true, mode = "truecolor" | "256", canonical = true }. */
export function agenticonAnsi(text, opts = {}) {
  const recolor = opts.recolor !== false;
  const mode = opts.mode === "256" ? "256" : "truecolor";
  const canonical = opts.canonical !== false;
  const cells = cellsFor(text, recolor);
  const lines = [];
  for (let r = 0; r < GH; r++) {
    let line = "";
    for (let c = 0; c < GW; c++) {
      const [g, f, b] = toGlyph(cells[r][c], canonical);
      line += sgr(f, b, mode) + g;
    }
    lines.push(line + RESET);
  }
  return lines.join("\n");
}

export default agenticon;
