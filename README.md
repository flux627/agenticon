# agenticon

Deterministic geometric identicons. One generator, two views: crisp **SVG** for the web
and **ANSI block-glyph** art for the terminal.

Each icon is a 4×2 grid of cells (solids, halves, corner blocks, diagonals, corner
triangles) grown so adjacent cells share colour across their seams. Tiles are chosen so
no quarter-square is ever left orphaned, giving a continuous, legible flow. An optional
recolour pass remaps the icon onto a small bold OKLCH palette (on by default). Output is a
pure function of the input string — same text, same icon, everywhere.

## Install

```sh
npm install agenticon
```

## Library

```js
import { agenticon, agenticonDataURI, agenticonAnsi } from "agenticon";

agenticon("alice@example.com");                 // -> <svg>…</svg> (recoloured)
agenticon("alice@example.com", { recolor: false, size: 48 });   // raw 16-colour flow
agenticon("alice@example.com", { bw: true });    // -> 1-bit black-and-white SVG
agenticon("alice@example.com", { gray: true });  // -> greyscale SVG
agenticonDataURI("alice@example.com");          // -> data:image/svg+xml,… for <img src>
agenticonAnsi("alice@example.com");             // -> two lines of ANSI block glyphs
agenticonAnsi("alice@example.com", { scale: 2 });  // -> each tile as a 2×2 block of glyphs
agenticonAnsi("alice@example.com", { bw: true });  // -> glyphs only, NO colour codes (terminal fg/bg)

// React:  <img src={agenticonDataURI(user.email)} alt="" width={48} height={48} />
```

Options:

| option      | default      | applies to | meaning                                            |
|-------------|--------------|------------|----------------------------------------------------|
| `recolor`   | `true`       | both       | remap onto the bold palette; `false` = raw flow    |
| `bw`        | `false`      | both       | 1-bit black-and-white; in the terminal emits **no colour codes** (glyphs only, your terminal's fg/bg) |
| `gray`      | `false`      | both       | greyscale (luma ramp); `bw` wins if both set        |
| `size`      | `64`         | SVG        | width/height in px                                 |
| `mode`      | `truecolor`  | ANSI       | `"256"` for 8-bit terminals                        |
| `canonical` | `true`       | ANSI       | `false` emits literal glyphs (no fg/bg-swap fold)  |
| `scale`     | `1`          | ANSI       | tile size multiplier — each tile fills `scale²` glyphs |

Also exported: `generate(text)` (the raw `cells[row][col]` grid), `buildRecolorMap`,
`buildGrayMap`, `buildBwMap`, `makeRng`, `PALETTE`.

## CLI

```sh
agenticon alice@example.com        # terminal icon
agenticon --tile-size 2 alice      # bigger: each tile becomes a 2×2 glyph block
agenticon --bw alice               # 1-bit B&W; terminal output is glyphs only (no colour codes)
agenticon --gray alice             # greyscale
agenticon --gallery                # a sample set
agenticon --svg alice@example.com  # emit SVG to stdout
agenticon --svg --bw alice         # black-and-white SVG
agenticon --size 128 alice         # SVG at 128px (--size implies --svg)
agenticon alice --no-recolor --256 # raw flow, 8-bit colour
```

Run `agenticon --help` for all flags.

## License

MIT
