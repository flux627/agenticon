// Edge-continuity flow on a 4x2 grid of cells.
//
// Cells are filled in a shuffled order. At each cell we enumerate the *legal* tiles --
// those that leave no orphaned 1/4 square: every quarter must share a colour with a
// neighbour, either inside its own cell or across a seam into a placed neighbour. A
// quarter facing an unplaced neighbour is deferred (its fate is still undefined), so it
// is never a definite orphan. Among the legal tiles we pick the most edge-contiguous,
// kind-weighted. A rare deadlock (no legal tile) is resolved by re-placing one neighbour.
//
// Vocabulary: solids, halves, corner blocks, diagonals, and corner triangles.

import { makeRng, choice } from "./rng.js";
import { PALETTE, MIN_CONTRAST, contrast, ckey } from "./palette.js";

export const GW = 4, GH = 2;

const EDGES = { N: [0, 1], S: [2, 3], W: [0, 2], E: [1, 3] };   // subpixels 0UL 1UR 2LL 3LR
const OPP = { N: "S", S: "N", E: "W", W: "E" };
const TRI_LEGS = { UL: ["N", "W"], UR: ["N", "E"], LL: ["S", "W"], LR: ["S", "E"] };
const KIND_W = { Q: 0.50, T: 0.32 };                            // kind preference among legal tiles
const ALL_MASKS = [
  [false,false,false,false],[false,false,false,true],[false,false,true,false],[false,false,true,true],
  [false,true,false,false],[false,true,false,true],[false,true,true,false],[false,true,true,true],
  [true,false,false,false],[true,false,false,true],[true,false,true,false],[true,false,true,true],
  [true,true,false,false],[true,true,false,true],[true,true,true,false],[true,true,true,true],
];
const TRIS = ["UL", "UR", "LL", "LR"];
const SOLIDS = PALETTE.map((x) => ({ kind: "Q", data: [false, false, false, false], fg: x, bg: x }));
const INCELL = { 0: [1, 2], 1: [0, 3], 2: [0, 3], 3: [1, 2] };  // in-cell orthogonal subpixels
const SUBPX_EDGES = { 0: [["N", 0], ["W", 0]], 1: [["N", 1], ["E", 0]], 2: [["S", 0], ["W", 1]], 3: [["S", 1], ["E", 1]] };
const EDGE_DIR = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };

function edgeColors(cell, edge) {
  const { kind, data, fg, bg } = cell;
  if (kind === "Q") return EDGES[edge].map((i) => (data[i] ? fg : bg));
  return TRI_LEGS[data].includes(edge) ? [fg, fg] : [bg, bg];   // triangle legs read fg
}

const orderDedup = (seq) => {
  const out = [], seen = new Set();
  for (const x of seq) { const k = ckey(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
};

function twoColor(cols) {                                       // every two-colour tile over `cols`
  const out = [];
  for (const bg of cols) for (const fg of cols) {
    if (ckey(fg) === ckey(bg) || contrast(fg, bg) < MIN_CONTRAST) continue;
    for (const m of ALL_MASKS) out.push({ kind: "Q", data: m, fg, bg });
    for (const d of TRIS) out.push({ kind: "T", data: d, fg, bg });
  }
  return out;
}

function neighbours(c, r) {
  const out = [];
  for (const [dc, dr, e] of [[1, 0, "E"], [-1, 0, "W"], [0, 1, "S"], [0, -1, "N"]]) {
    const nc = c + dc, nr = r + dr;
    if (nc >= 0 && nc < GW && nr >= 0 && nr < GH) out.push([nc, nr, e]);
  }
  return out;
}

function orphaned(cell, c, r, getcell) {                        // a quarter with no same-colour support
  if (cell.kind === "T") return false;                          // triangles are self-connected
  const { data, fg, bg } = cell, cols = [0, 1, 2, 3].map((i) => (data[i] ? fg : bg));
  for (let q = 0; q < 4; q++) {
    const col = cols[q];
    if (INCELL[q].some((j) => ckey(cols[j]) === ckey(col))) continue;   // supported within the cell
    let ok = false;
    for (const [edge, pos] of SUBPX_EDGES[q]) {
      const [dc, dr] = EDGE_DIR[edge], nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= GW || nr < 0 || nr >= GH) continue;   // image border: no support
      const nb = getcell(nc, nr);
      if (nb === null || ckey(edgeColors(nb, OPP[edge])[pos]) === ckey(col)) { ok = true; break; }
    }
    if (!ok) return true;
  }
  return false;
}

function legal(tile, c, r, cells) {                             // orphans neither itself nor a placed neighbour
  const getcell = (gc, gr) => (gc === c && gr === r ? tile : cells[gr][gc]);
  if (orphaned(tile, c, r, getcell)) return false;
  for (const [nc, nr] of neighbours(c, r))
    if (cells[nr][nc] !== null && orphaned(cells[nr][nc], nc, nr, getcell)) return false;
  return true;
}

function hasLegal(c, r, cells) {                                // feasibility, free of the colour draw
  const tcols = [];
  for (const [nc, nr, e] of neighbours(c, r))
    if (cells[nr][nc] !== null) { const t = edgeColors(cells[nr][nc], OPP[e]); tcols.push(t[0], t[1]); }
  for (const x of SOLIDS) if (legal(x, c, r, cells)) return true;
  for (const x of twoColor(orderDedup(tcols))) if (legal(x, c, r, cells)) return true;
  return false;
}

function shuffle(rng, a) {                                      // Fisher-Yates
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function targetsOf(c, r, cells) {
  const out = [];
  for (const [nc, nr, e] of neighbours(c, r))
    if (cells[nr][nc] !== null) out.push([e, edgeColors(cells[nr][nc], OPP[e])]);
  return out;
}

function pickLegal(c, r, cells, rng) {                          // most edge-contiguous legal tile, kind-weighted
  const targets = targetsOf(c, r, cells), cols = [];
  for (let i = 0; i < 4; i++) cols.push(choice(rng, PALETTE));  // free colours for unconstrained parts
  for (const [, t] of targets) cols.push(t[0], t[1]);
  const cand = SOLIDS.concat(twoColor(orderDedup(cols)));
  const legals = cand.filter((x) => legal(x, c, r, cells));
  if (!legals.length) return null;
  const score = (x) => targets.reduce((s, [e, t]) =>
    s + (ckey(edgeColors(x, e)[0]) === ckey(t[0])) + (ckey(edgeColors(x, e)[1]) === ckey(t[1])), 0);
  const scores = legals.map(score), bestScore = Math.max(...scores);
  const best = legals.filter((_, i) => scores[i] === bestScore);
  const pools = [["Q", best.filter((x) => x.kind === "Q")], ["T", best.filter((x) => x.kind === "T")]].filter(([, p]) => p.length);
  const tot = pools.reduce((s, [k]) => s + KIND_W[k], 0);
  let x = rng() * tot, acc = 0, chosen = pools[pools.length - 1][1];
  for (const [k, p] of pools) { acc += KIND_W[k]; if (x < acc) { chosen = p; break; } }
  return chosen[Math.floor(rng() * chosen.length)];
}

function placedNbrs(c, r, cells) {
  return neighbours(c, r).filter(([nc, nr]) => cells[nr][nc] !== null).map(([nc, nr]) => [nc, nr]);
}

function unblocking(c, r, cells) {                              // a placed neighbour whose removal frees (c,r)
  for (const [nc, nr] of placedNbrs(c, r, cells)) {
    const saved = cells[nr][nc]; cells[nr][nc] = null;
    const ok = hasLegal(c, r, cells); cells[nr][nc] = saved;
    if (ok) return [nc, nr];
  }
  return null;
}

function repair(start, cells, rng) {                           // ignore one neighbour, place, re-place; cascade
  const stack = [start];
  while (stack.length) {
    const x = stack.pop(), [xc, xr] = x;
    if (cells[xr][xc] !== null) continue;
    if (hasLegal(xc, xr, cells)) { cells[xr][xc] = pickLegal(xc, xr, cells, rng); continue; }
    let nb = unblocking(xc, xr, cells);
    if (nb === null) { const pn = placedNbrs(xc, xr, cells); nb = pn.length ? pn[0] : null; }
    if (nb === null) { cells[xr][xc] = { kind: "Q", data: [false, false, false, false], fg: PALETTE[0], bg: PALETTE[0] }; continue; }
    const [nc, nr] = nb; cells[nr][nc] = null;
    stack.push(nb); stack.push(x);
  }
}

/** text -> 2D array cells[row][col] of { kind, data, fg, bg } for the 4x2 grid. */
export function generate(text) {
  const rng = makeRng(text);
  const cells = Array.from({ length: GH }, () => Array(GW).fill(null));
  const order = [];
  for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) order.push([c, r]);
  shuffle(rng, order);
  for (const [c, r] of order) {
    if (hasLegal(c, r, cells)) cells[r][c] = pickLegal(c, r, cells, rng);
    else repair([c, r], cells, rng);
  }
  return cells;
}
