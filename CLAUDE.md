# agenticon — notes for agents working in this directory

Deterministic geometric identicons. One generator → two renderers (crisp SVG for the
web, ANSI block-glyphs for the terminal). Pure JS, ESM, Node ≥18, **zero dependencies,
no build step**. (There is no Python — it was removed; JS is the single source of truth.)

## Layout
- `src/` — library modules: `rng` · `palette` · `generate` (the algorithm) · `recolor` · `render` (SVG + ANSI) · `index` (barrel).
- `bin/agenticon.js` — CLI.
- `scripts/analyze.mjs` — distribution + invariant checker (`npm run analyze`).
- `README.md` — public API/CLI. `DESIGN.md` — how & why, and dead-ends already ruled out (**read it before changing the algorithm**).

## Invariants — must hold after any change to `generate`
1. **No orphaned 1/4 squares** — every subpixel touches a same-colour subpixel.
2. **No crossovers** — edge matching is per-position (`[A,B]` must not meet `[B,A]`).
3. **Largest contiguous colour region ≤ `AREA_LIMIT`** (2.5 tiles; 1 = one cell).
4. **Deterministic** — same string → same icon (SVG and terminal). All randomness flows
   from `makeRng(text)`; never introduce `Date`/`Math.random` (they'd break determinism).

Verify with `npm run analyze` — it reports the tile/area distribution and checks #1 and #3
over 10k icons (expect `orphaned 1/4 squares: 0` and `largest region ≤ 2.5`). Eyeball with
`node bin/agenticon.js --gallery` or `node bin/agenticon.js --svg <text>`.

## Gotchas
- **Repair must never force/bias tile choice.** `pickLegal` takes a force flag that is
  `true` only on the forward pass and `false` in `repair`; forcing inside repair can stop
  it converging. (~2.5% of icons deadlock and need repair.)
- **Tiles are de-duped to canonical shapes** (`CANON_Q`/`CANON_T`); a mask and its
  complement are the same cell with fg/bg swapped, so don't re-add the full 16-mask /
  4-corner set — it double-counts and over-weights solids. This is why "3/4" is 0.
- **Solids come only from the `SOLIDS` floor** (always legal, single-colour, bypass the
  contrast gate); they're the reason the legal set is never empty.

## Knobs (constants in `src/generate.js`)
`AREA_LIMIT` (region cap) · `FORCE_DIAG_TURN` (which turn forces a diagonal) ·
`MIN_CONTRAST` (in `palette.js`; two-colour tile contrast floor) · `KIND_W` (Q-vs-T mix).
Changing any of these is an aesthetic call — re-run `npm run analyze` and re-render to check.

## Conventions
- Match the existing terse, comment-light-but-pointed style in `src/`.
- Commit only when asked. Keep diffs scoped to the algorithm; don't reformat untouched code.
- Throwaway analysis goes in `/tmp`; reusable measurement goes in `scripts/`.
