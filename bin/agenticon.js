#!/usr/bin/env node
// agenticon CLI — print identicons to the terminal (ANSI block glyphs) or emit SVG.
import { agenticon, agenticonAnsi } from "../src/index.js";

const USAGE = `agenticon — deterministic geometric identicons

Usage:
  agenticon <text...>        render each text as a terminal icon
  agenticon --gallery        render a sample set
  agenticon --svg <text>     emit an SVG document instead of terminal glyphs

Options:
  --no-recolor   raw 16-colour flow (skip the bold-palette remap)
  --bw           1-bit black-and-white (terminal and SVG)
  --gray         greyscale (terminal and SVG)
  --256          8-bit colour, for terminals without truecolor
  --literal      emit literal glyphs (no fg/bg-swap canonicalisation)
  --svg          output SVG to stdout
  --size <n>     SVG size in px (default 64; implies --svg)
  --tile-size <n>  terminal: blow each tile up into an n×n glyph block (default 1)
  -h, --help     show this help`;

const GALLERY = ["alice@example.com", "bob@example.com", "carol", "dave",
                 "git@github.com", "192.168.1.42", "production", "claude"];

function main(argv) {
  if (argv.includes("-h") || argv.includes("--help")) { console.log(USAGE); return 0; }

  const flag = (name) => argv.includes(name);
  const numArg = (name) => { const i = argv.indexOf(name); return (i !== -1 && argv[i + 1]) ? parseInt(argv[i + 1], 10) : undefined; };
  const size = numArg("--size"), tileSize = numArg("--tile-size");
  const svg = flag("--svg") || size !== undefined;
  const opts = {
    recolor: !flag("--no-recolor"),
    bw: flag("--bw"),
    gray: flag("--gray"),
    mode: flag("--256") ? "256" : "truecolor",
    canonical: !flag("--literal"),
  };
  if (svg) opts.size = size || 64;               // SVG: pixels
  else opts.scale = tileSize || 1;               // terminal: tile multiplier

  const valued = new Set(["--size", "--tile-size"]);
  const skip = new Set([...valued, String(size), String(tileSize)]);
  const texts = argv.filter((a, i) =>
    !a.startsWith("-") && !skip.has(a) && !valued.has(argv[i - 1]));

  if (flag("--gallery")) {
    for (const name of GALLERY) {
      const rows = agenticonAnsi(name, opts).split("\n");
      rows.forEach((row, i) => console.log(i === 0 ? `  ${row}   ${name}` : `  ${row}`));
      console.log();
    }
    return 0;
  }
  if (!texts.length) { console.log(USAGE); return 1; }

  for (const text of texts) {
    if (svg) console.log(agenticon(text, opts));
    else console.log(agenticonAnsi(text, opts) + "\n");
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
