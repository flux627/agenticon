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

// One cell's faces as { color, poly (px) } -- four subpixels (Q) or two triangles (T).
function cellFaces(cell, x, y, cw, ch) {
  if (cell.kind === "Q") {
    const o = [[x, y], [x + cw / 2, y], [x, y + ch / 2], [x + cw / 2, y + ch / 2]];
    return o.map(([px, py], i) => ({ color: cell.data[i] ? cell.fg : cell.bg,
      poly: [[px, py], [px + cw / 2, py], [px + cw / 2, py + ch / 2], [px, py + ch / 2]] }));
  }
  const TL = [x, y], TR = [x + cw, y], BL = [x, y + ch], BR = [x + cw, y + ch];
  const [ft, bt] = { UL: [[TL, TR, BL], [TR, BR, BL]], UR: [[TL, TR, BR], [TL, BR, BL]],
                     LL: [[TL, BL, BR], [TL, TR, BR]], LR: [[TR, BL, BR], [TL, TR, BL]] }[cell.data];
  return [{ color: cell.fg, poly: ft }, { color: cell.bg, poly: bt }];
}
// Underlying colour at a pixel (ignores accents).
function colorAt(cells, px, py, cw, ch) {
  const gc = Math.min(GW - 1, Math.max(0, Math.floor(px / cw))), gr = Math.min(GH - 1, Math.max(0, Math.floor(py / ch)));
  const cell = cells[gr][gc], lx = (px - gc * cw) / cw, ly = (py - gr * ch) / ch;
  if (cell.kind === "Q") { const i = (lx < .5 ? 0 : 1) + (ly < .5 ? 0 : 2); return cell.data[i] ? cell.fg : cell.bg; }
  const fg = { UL: lx + ly < 1, UR: lx > ly, LL: lx < ly, LR: lx + ly > 1 }[cell.data]; return fg ? cell.fg : cell.bg;
}
// Clip a polygon to a convex one (inside side taken from its centroid, so winding doesn't matter).
function clipConvex(poly, clip) {
  let out = poly;
  const cx = clip.reduce((s, p) => s + p[0], 0) / clip.length, cy = clip.reduce((s, p) => s + p[1], 0) / clip.length;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], cr = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const sgn = cr([cx, cy]) >= 0 ? 1 : -1;
    out = clipHalf(out, (p) => -sgn * cr(p));
  }
  return out;
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
  // Accents ride on top: the borrowed colour leaking out of the vertex V into the host along its bisecting diagonal.
  // The band runs from the border end O, through the host, past V, and is clipped to three things: the host cell; every
  // accent-colour face (where it dissolves in invisibly, so the line merges into the matching shape and is cut only at a
  // foreign colour); and host-colour faces in EDGE-adjacent tiles only (a short poke that fills the pinch at V without
  // nubbing into the diagonal tile across V). Which side of the diagonal it leans onto is decided per-vertex below. All
  // pieces go in one <path> so the host-side and merged-side fuse seamlessly; the O end runs off the border (no chop).
  const cw = size / GW, ch = size / GH, rad = Math.min(cw, ch) * DIAG_STROKE / 2;
  for (let gr = 0; gr < GH; gr++) for (let gc = 0; gc < GW; gc++) {
    const cell = cells[gr][gc]; if (!cell.diag) continue;
    const dir = cell.diag.dir, color = cell.diag.color;
    const x = gc * cw, y = gr * ch, key = ckey(color);
    const hostKey = ckey(cellFaces(cell, x, y, cw, ch)[0].color);   // host's own colour
    const TL = [x, y], TR = [x + cw, y], BL = [x, y + ch], BR = [x + cw, y + ch];
    const [V, O] = dir === "\\" ? (gr === 0 ? [BR, TL] : [TL, BR]) : (gr === 0 ? [BL, TR] : [TR, BL]);
    const all = [], hostFaces = [];                            // band paints accent colour (it dissolves in, invisibly)
    for (let ar = 0; ar < GH; ar++) for (let ac = 0; ac < GW; ac++) {   // or host colour -- but host colour ONLY in cells
      if (ac === gc && ar === gr) continue;                    // that share an EDGE with the host, so the poke is a short
      const edgeAdj = Math.abs(ac - gc) + Math.abs(ar - gr) === 1;      // transversal wedge filling the pinch at V, never
      for (const f of cellFaces(cells[ar][ac], ac * cw, ar * ch, cw, ch)) {   // a nub hanging into the diagonal tile
        const fk = ckey(f.color);
        if (fk === key) all.push(f.poly);
        else if (fk === hostKey && edgeAdj) hostFaces.push(f.poly);
      }
    }
    const L = Math.hypot(V[0] - O[0], V[1] - O[1]), ux = (V[0] - O[0]) / L, uy = (V[1] - O[1]) / L;
    const nx = -uy, ny = ux;
    // Side selection from the geometry at V. Three tiles meet the host there: the diagonal tile (across V), the
    // cross-centre tile (CC, shares the host's centre-line edge -- the "above" tile) and the neighbour (NB, shares the
    // host's side edge). sCC fixes "toward CC" as +1/-1 (flips with the host's row). For CC and NB the corner reads as a
    // line-side half (toward the host) and a diagonal-side half (toward the diagonal tile); the diagonal tile's corner
    // reads as an above-side (+sCC) and neighbour-side (-sCC) half. Lean to connect the band to the target colour.
    const vc = Math.round(V[0] / cw), oc = 2 * vc - 1 - gc;    // the other column meeting at V
    const CC = [gc, 1 - gr], NB = [oc, gr], Dt = [oc, 1 - gr], eps = 0.06 * Math.min(cw, ch);
    const sCC = ((CC[0] + 0.5) * cw - V[0]) * nx + ((CC[1] + 0.5) * ch - V[1]) * ny >= 0 ? 1 : -1;
    const at = (dx, dy) => { const m = Math.hypot(dx, dy); return ckey(colorAt(cells, V[0] + eps * dx / m, V[1] + eps * dy / m, cw, ch)); };
    const edge = (ac, ar) => [Math.sign((ac + 0.5) * cw - V[0]) || 1, Math.sign((ar + 0.5) * ch - V[1]) || 1];
    const [nsx, nsy] = edge(NB[0], NB[1]), nbLine = at(nsx * 0.2, nsy), nbDiag = at(nsx, nsy * 0.2);   // NB: line=vertical edge
    const [csx, csy] = edge(CC[0], CC[1]), ccLine = at(csx, csy * 0.2), ccDiag = at(csx * 0.2, csy);   // CC: line=horizontal edge
    const [dsx, dsy] = edge(Dt[0], Dt[1]); let dAbove = false, dNeigh = false;
    for (const th of [15, 30, 45, 60, 75]) { const r = th * Math.PI / 180, dx = dsx * Math.cos(r), dy = dsy * Math.sin(r);
      if (at(dx, dy) === key) { if ((dx * nx + dy * ny) * sCC > 0) dAbove = true; else dNeigh = true; } }
    let ss, pokeOK = false;                                    // A-D connect cleanly on the host side; E and below may run
    if (nbLine === key) ss = -sCC;                             // A: neighbour target on its line side -> underside
    else if (ccLine === key) ss = sCC;                         // B: above target on its line side -> upper
    else if (nbDiag === key && nbLine === hostKey) ss = -sCC;  // C: neighbour target on diagonal side, base on line side
    else if (ccDiag === key && ccLine === hostKey) ss = sCC;   // D: above target on diagonal side, base on line side
    else { pokeOK = true;                                      // E and below: draw on top of the vertex tiles, poke and all
      if (dNeigh && !dAbove) ss = -sCC;                        // E: diagonal target on neighbour side only -> underside
      else if (dAbove && !dNeigh) ss = sCC;                    // F: diagonal target on above side only -> upper
      else if (nbLine === hostKey && nbDiag === hostKey) ss = -sCC;   // G: neighbour vertex all base -> underside
      else if (ccLine === hostKey && ccDiag === hostKey) ss = sCC;    // H: above vertex all base -> upper
      else ss = 0; }                                          // I: centre (incl. full-target diagonal -> straight through)
    const s = ss * rad;
    const aox = O[0] - ux * ch + nx * s, aoy = O[1] - uy * ch + ny * s;   // run-off end, pushed past the border
    const avx = V[0] + ux * L + nx * s, avy = V[1] + uy * L + ny * s;     // run past V; matching colour consumes it
    const band = [[aox + nx * rad, aoy + ny * rad], [avx + nx * rad, avy + ny * rad],
                  [avx - nx * rad, avy - ny * rad], [aox - nx * rad, aoy - ny * rad]];
    // A-D poke only into edge-adjacent host colour (the strict bridge); E and below draw over the perpendicular wedge
    // tiles at V (cross-centre and neighbour, any colour) so the line keeps full width through the foreign wedges
    // flanking a centre vertex instead of pinching there. The diagonal tile is NOT poked: the line continues into it
    // only where it is the accent colour (via the accent-face clip), so it never traverses the diagonal tile.
    const pokeFaces = pokeOK
      ? [CC, NB].flatMap(([ac, ar]) => cellFaces(cells[ar][ac], ac * cw, ar * ch, cw, ch).map((f) => f.poly))
      : hostFaces;
    const pieces = [clipConvex(band, [TL, TR, BR, BL]),
      ...all.map((f) => clipConvex(band, f)), ...pokeFaces.map((f) => clipConvex(band, f))].filter((p) => p.length > 2);
    if (pieces.length) body += `<path d="${pieces.map((p) => "M" + p.map((qq) => `${qq[0]} ${qq[1]}`).join("L") + "Z").join("")}" fill="${hex(color)}"/>`;
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
