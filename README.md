# flowicon

Deterministic geometric identicons. One generator, two views: crisp **SVG** for the web
and **ANSI block-glyph** art for the terminal.

Each icon is a 4×2 grid of cells (solids, halves, corner blocks, diagonals, corner
triangles) grown so adjacent cells share colour across their seams. Tiles are chosen so
no quarter-square is ever left orphaned, giving a continuous, legible flow. An optional
recolour pass remaps the icon onto a small bold OKLCH palette (on by default). Output is a
pure function of the input string — same text, same icon, everywhere.

## Install

```sh
npm install flowicon
```

## Library

```js
import { flowIcon, flowIconDataURI, flowIconAnsi } from "flowicon";

flowIcon("alice@example.com");                 // -> <svg>…</svg> (recoloured)
flowIcon("alice@example.com", { recolor: false, size: 48 });   // raw 16-colour flow
flowIconDataURI("alice@example.com");          // -> data:image/svg+xml,… for <img src>
flowIconAnsi("alice@example.com");             // -> two lines of ANSI block glyphs

// React:  <img src={flowIconDataURI(user.email)} alt="" width={48} height={48} />
```

Options:

| option      | default      | applies to | meaning                                            |
|-------------|--------------|------------|----------------------------------------------------|
| `recolor`   | `true`       | both       | remap onto the bold palette; `false` = raw flow    |
| `size`      | `64`         | SVG        | width/height in px                                 |
| `mode`      | `truecolor`  | ANSI       | `"256"` for 8-bit terminals                        |
| `canonical` | `true`       | ANSI       | `false` emits literal glyphs (no fg/bg-swap fold)  |

Also exported: `generate(text)` (the raw `cells[row][col]` grid), `buildRecolorMap`,
`makeRng`, `PALETTE`.

## CLI

```sh
flowicon alice@example.com        # terminal icon
flowicon --gallery                # a sample set
flowicon --svg alice@example.com  # emit SVG to stdout
flowicon alice --no-recolor --256 # raw flow, 8-bit colour
```

Run `flowicon --help` for all flags.

## License

MIT
