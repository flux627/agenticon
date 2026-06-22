# agenticon — design notes

The *why* behind the generator, the invariants it guarantees, the knobs, and the
dead-ends we already ruled out. For the user-facing API see `README.md`; for a
reproducible measurement of any of the numbers here run `npm run analyze`.

## Pipeline

`text` is a pure seed. Everything is a deterministic function of it through one
RNG (`makeRng` = cyrb128 → sfc32). One generator feeds both renderers:

```
text ─▶ generate() ─▶ cells[row][col]  ─▶ faceGroups ─▶ SVG   (agenticon / agenticonDataURI)
                          │  (+ optional recolour)    └▶ toGlyph ─▶ ANSI (agenticonAnsi)
```

SVG and terminal differ only in the final drawing; `generate` and the recolour
pass are shared (`src/render.js → cellsFor`).

### SVG: one path per colour (seamless at any scale)

The naive renderer drew a rect/triangle per cell. Abutting **antialiased** fills
*conflate*: at a shared edge the rasteriser composites them in sequence and each
contributes <100 % coverage, so a sliver of whatever is behind leaks through — a
1px seam that appears whenever the icon is displayed at a fractional scale (the
common case on a web page). `crispEdges` avoids it but snaps each shape to the
device grid independently (gaps) and kills the diagonals' antialiasing.

So the SVG renderer works from **vertices, not cells**. `faceGroups` decomposes the
grid into polygon faces on an 8×4 unit lattice (a Q cell → four unit squares, a T
cell → two triangles), keyed by colour. Each colour is then emitted as **one
`<path>`** holding all its faces as subpaths. A single path fills in one
antialiasing pass, so adjacent same-colour faces become a seamless union with no
internal edges to conflate — and because the algorithm matches colours across
seams, *most* boundaries are same-colour and simply vanish. The few genuine
colour boundaries that remain are underlaid by a full-canvas rect of the dominant
colour, so a conflation sliver there shows that colour, never the page. Accent
strokes draw last, on top. No overlap, no pixel-snapping, no fudge.

## The grid and the tiles

A 4×2 grid of **cells**. Each cell is 2×2 **subpixels** (quarters). A tile is
`{ kind, data, fg, bg }`:

- **Q** (quadrant): `data` is a 4-bool mask; subpixel `i` is `fg` if `data[i]` else `bg`.
- **T** (triangle): `data` is a corner (`UL`/`UR`); the triangle legs read `fg`, the rest `bg`.

Visual shapes: **solid, half, single-corner, diagonal** (Q) and **triangle** (T).

### Canonical de-dup (why there is no "3/4")

A mask and its complement render the *same cell* with fg/bg swapped — e.g. a 3/4
tile `(1,1,1,0)/A,B` is pixel-identical to a 1/4 tile `(1,0,0,0)/B,A`; likewise
`LR`/`LL` triangles equal `UL`/`UR` with colours swapped. Enumerating all 16
masks + 4 corners therefore counted **every visual tile twice**, and counted
solids many extra times (once per colour pairing). So the candidate set uses
**canonical shapes only** — `CANON_Q` (7 masks) + `CANON_T` (`UL`,`UR`); solids
come solely from the `SOLIDS` floor. Consequence: 3/4 folds into single-corner
(reported as 0), and the tile mix is honest (solids are not inflated).

## Generation algorithm

Cells are filled in a **shuffled order**. At each cell:

1. **Candidates.** `SOLIDS` (16, one per palette colour — the always-legal
   floor) + every two-colour canonical tile over the cell's colour list (4
   random "free" colours + the colours its placed neighbours expose).
   *Contrast gate:* a two-colour tile is only generated if `contrast(fg,bg) ≥
   MIN_CONTRAST`. (Solids are single-colour, so the gate doesn't apply to them.)
2. **Legality** (`legal`): keep a candidate iff
   - it **orphans no 1/4 square** — every quarter shares a colour with a
     neighbour, in-cell or across a seam into a *placed* neighbour. A quarter
     facing an *unplaced* neighbour is **deferred** (undefined, not an orphan).
     The check is bidirectional: a tile is illegal if it would strand a *placed*
     neighbour's last-hope quarter too.
   - placing it keeps the **largest contiguous colour region ≤ `AREA_LIMIT`**.
3. **Selection** among the legal tiles:
   - **Contiguity score** = number of matched seam-halves vs. placed neighbours
     (per-position: position 0 must equal position 0, etc.). Keep only the
     top-scoring tier (hard cut — there is no rank-2).
   - On the **3rd placement** (`FORCE_DIAG_TURN`), if any legal diagonal exists,
     restrict to diagonals first (a single clean accent placed early where it
     threads). The forward pass forces; **repair never does**.
   - Pick **kind** Q/T by fixed `KIND_W` weights, then **uniform** within kind.

### Deadlocks and repair

A cell can dead-end (no legal tile) when neighbours over-commit it — roughly
**2.5% of icons**. Repair: ignore one offending neighbour, place the stuck cell,
re-place the neighbour, cascade if needed. It converges in **≤2 iterations**
(observed) and ends orphan-free. Repair must stay **unforced** (no diagonal
force) — forcing inside repair can stop it converging.

### Diagonal accents (post-pass)

Once the grid is settled, `addDiagonals` decorates some solid tiles. The 4×2 grid has a
5×3 lattice of vertices; only **3** sit off the icon's border — the mid-grid points on the
horizontal centre line (columns 1–3). Each solid tile touches 1 or 2 of them (a top-row
tile's bottom corners, a bottom-row tile's top corners). For each solid, with probability
`DIAG_PROB` (0.5), pick one of its interior-vertex corners and draw a `╱`/`╲` stroke from
that vertex across the tile to the opposite corner, in a colour **borrowed from a neighbour
meeting at the vertex** (the corner-quarter colours of the other ≤3 cells there, minus the
tile's own colour).

Three things disqualify a candidate, so the realised rate is well under half the solids
(~0.7 accents/icon):

- **Colour-isolated solids are skipped.** A solid is self-supporting, so it can be a lone
  island of its colour; such a tile gets no accent. Eligibility requires at least one
  edge-neighbour that shares the tile's colour across their seam.
- **One line per vertex.** A vertex that already carries a line is off-limits to every other
  tile (the pass tracks claimed vertices in a `used` set, scanned left-to-right top-to-bottom).
  A tile whose pick is taken simply falls back to its other interior vertex, if it has one.
- **No borrowable colour.** If every neighbour at a candidate vertex matches the tile's own
  colour, there is nothing to draw with, and that vertex is dropped.

It is a pure overlay: it sets `cell.diag = { dir, color }` and never touches `kind/data/
fg/bg`, so the tile structure — and every invariant below — is unchanged. The stroke draws
as a round-capped `<line>` (SVG, width `DIAG_STROKE`×cell, ends centred on the vertex and the
opposite corner) or a `╱`/`╲` glyph (terminal, accent fg over the solid bg). One stroke per
tile by design (matching "╱ or ╲"); two never combine into a cross. The borrowed colour is a
real cell colour, so the recolour remap carries it along.

> A placed solid is a **shared** `SOLIDS` object reused across every icon, so the pass
> *clones* the cell to attach `diag` — mutating in place would leak the accent into later
> icons in the same process.

## Invariants (must always hold)

- **No orphaned 1/4 squares.** Every subpixel touches a same-colour subpixel.
- **No crossovers.** Matching is per-position, so `[A,B]` never meets `[B,A]`.
- **Largest contiguous region ≤ `AREA_LIMIT`** (currently 2.5 tiles; 1 = one cell).
- **Deterministic.** Same string → same icon, in SVG and terminal alike. No
  `Date`/`Math.random`; all randomness flows from `makeRng(text)`.

`npm run analyze` checks the first three over 10k icons.

## Tunable knobs

All in `src/generate.js` unless noted:

| constant | value | effect |
|---|---|---|
| `AREA_LIMIT` | 2.5 | max tiles in one contiguous colour region (∞ = no cap) |
| `FORCE_DIAG_TURN` | 2 | 0-based turn to force a diagonal (lower = more often/earlier; `-1`-style disable = remove the call) |
| `MIN_CONTRAST` | 3.0 | min fg/bg contrast for two-colour tiles (lower = muddier tiles, fewer deadlocks) |
| `KIND_W` | `{Q:.5, T:.32}` | Q-vs-T balance among the best-contiguity tiles |
| `DIAG_PROB` | 0.5 | chance a solid tile gets a diagonal accent (0 = off) |
| `DIAG_STROKE` | 0.05 | accent line width (SVG, round-capped), as a fraction of the cell's shorter side (`render.js`) |
| recolour `N_WEIGHTS` | (`recolor.js`) | distribution of palette size (1–5 colours) |

## Recolour

Independent pass (`buildRecolorMap`, seeded `"recolor|"+text`): hue-sort the
unique colours, split into N (1–5) bold OKLCH groups, shift hue+saturation 70%
toward the group colour, **brightness locked** (keeps light/dark structure, so
every shape stays legible). It's a per-colour remap, so it preserves region
topology — recoloured and raw icons have identical shapes.

## Decisions & dead-ends (don't re-tread)

- **Per-position contiguity, not set-overlap.** The original matcher accepted a
  neighbour if edge colours *overlapped as a set*, which let `[A,B]` meet `[B,A]`
  — a crossover that isolated quadrants. Per-position matching fixed it; this was
  the root cause behind most "orphan" artifacts, not any single tile.
- **Diagonals — three approaches tried.** (a) *Mandatory force* whenever legal →
  floods to ~26% / 95% of icons and breaks repair convergence. (b) *Probability
  boost* (×N within the best tier) → structural **~10% ceiling**, because the
  boost only reweights tiles already tied for most-contiguous. (c) *Force on the
  3rd turn* (chosen) → ~6% / one accent in ~43% of icons, no convergence issues.
- **The area cap was first tuned against inflated solid counts.** After the
  de-dup made solids honest (~25% → ~22%), the cap was re-evaluated; 2.5 was
  chosen from a fresh sweep (4 / 3.5 / 3 / 2.5). Natural (uncapped) lead region
  averages ~3.3 tiles with a tail to a full 8-tile solid; the cap tames that tail.
- **Python was dropped.** Earlier there was a parallel Python implementation kept
  byte-identical to the JS. It was removed; JS is the single source of truth and
  renders to the terminal directly (the Python ANSI renderer was ported over,
  verified byte-identical, then deleted).

## Distribution at the committed settings

Tile mix (cap 2.5, force-diagonal-turn-3), 10k icons — regenerate with `npm run analyze`:

| tile | share |
|---|---|
| triangle | ~30% |
| single-corner | ~23% |
| solid | ~22% |
| half | ~19% |
| diagonal | ~6% |
| 3/4 | 0 (folded) |

Mean ~6.6 contiguous regions/icon; largest region averages ~2.3 tiles (capped at 2.5).
