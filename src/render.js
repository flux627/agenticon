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
    cells = cells.map((row) => row.map((c) =>
      ({ ...c, fg: cmap.get(ckey(c.fg)) || c.fg, bg: cmap.get(ckey(c.bg)) || c.bg })));
  }
  return cells;
}

// ---- SVG ----
const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
function renderCell(cell, x, y, w, h) {
  const { kind, data, fg, bg } = cell;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${hex(bg)}" shape-rendering="crispEdges"/>`;
  if (kind === "Q") {
    const sub = [[x, y], [x + w / 2, y], [x, y + h / 2], [x + w / 2, y + h / 2]];
    for (let i = 0; i < 4; i++) if (data[i])
      s += `<rect x="${sub[i][0]}" y="${sub[i][1]}" width="${w / 2}" height="${h / 2}" fill="${hex(fg)}" shape-rendering="crispEdges"/>`;
  } else {
    const v = { UL: [[x, y], [x + w, y], [x, y + h]], UR: [[x, y], [x + w, y], [x + w, y + h]],
                LL: [[x, y], [x, y + h], [x + w, y + h]], LR: [[x + w, y], [x, y + h], [x + w, y + h]] }[data];
    s += `<polygon points="${v.map((p) => p.join(",")).join(" ")}" fill="${hex(fg)}"/>`;
  }
  return s;
}

/** SVG string for `text`. opts: { size = 64, recolor = true }. */
export function flowIcon(text, opts = {}) {
  const size = opts.size || 64;
  const cells = cellsFor(text, opts.recolor !== false);
  const cw = size / GW, ch = size / GH;
  let body = "";
  for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) body += renderCell(cells[r][c], c * cw, r * ch, cw, ch);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
}

/** data: URI for an <img src> or CSS url(). */
export function flowIconDataURI(text, opts = {}) {
  return "data:image/svg+xml," + encodeURIComponent(flowIcon(text, opts));
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
export function flowIconAnsi(text, opts = {}) {
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

export default flowIcon;
