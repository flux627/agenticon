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
  --256          8-bit colour, for terminals without truecolor
  --literal      emit literal glyphs (no fg/bg-swap canonicalisation)
  --svg          output SVG to stdout
  --size <n>     SVG size in px (default 64; implies --svg)
  -h, --help     show this help`;

const GALLERY = ["alice@example.com", "bob@example.com", "carol", "dave",
                 "git@github.com", "192.168.1.42", "production", "claude"];

function main(argv) {
  if (argv.includes("-h") || argv.includes("--help")) { console.log(USAGE); return 0; }

  const flag = (name) => argv.includes(name);
  let size;
  const si = argv.indexOf("--size");
  if (si !== -1 && argv[si + 1]) size = parseInt(argv[si + 1], 10);
  const svg = flag("--svg") || size !== undefined;
  const opts = {
    recolor: !flag("--no-recolor"),
    mode: flag("--256") ? "256" : "truecolor",
    canonical: !flag("--literal"),
    size: size || 64,
  };

  const skip = new Set(["--size", String(size)]);
  const texts = argv.filter((a, i) =>
    !a.startsWith("-") && !skip.has(a) && argv[i - 1] !== "--size");

  if (flag("--gallery")) {
    for (const name of GALLERY) {
      const [top, bot] = agenticonAnsi(name, opts).split("\n");
      console.log(`  ${top}   ${name}`);
      console.log(`  ${bot}`);
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
