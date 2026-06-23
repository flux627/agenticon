#!/usr/bin/env node
// Build the README demo gallery — the SAME icon set / layout in two views:
//   (default)   write assets/demo.svg   — composite SVG (one agenticon() per tile)
//   --ansi      print the gallery as ANSI block glyphs (the terminal renderer)
// Deterministic: every tile is just agenticon(text) / agenticonAnsi(text). The terminal
// PNG in the README is this --ansi output rendered through a real terminal; see
// scripts/render-terminal.mjs.
//   node scripts/demo.mjs            (or: npm run demo)

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { agenticon, agenticonAnsi, GW, GH } from "../src/index.js";

const GALLERY = ["alice", "bob", "carol", "dave", "octocat", "acme-corp",
                 "deploy-bot", "agenticon", "v2.0.0", "user_42", "sunrise", "otter"];
const COLS = 6;
const ROWS = Math.ceil(GALLERY.length / COLS);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- SVG gallery ----
function buildSvg() {
  const T = 88, G = 29, P = 28, LABEL_H = 22, ROW_GAP = 23, CAP_H = 30;   // G/ROW_GAP: +30% gutters
  const LABEL = "#8a8a8a", HEAD = "#9aa0a6";        // greys legible on light AND dark themes
  const FONT = `font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"`;
  const iconBody = (text) =>                          // each icon is a standalone <svg>; strip the wrapper
    agenticon(text, { size: T }).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  const tile = (x, y, text) =>
    `<g transform="translate(${x} ${y})">${iconBody(text)}</g>` +
    `<text x="${x + T / 2}" y="${y + T + 15}" ${FONT} font-size="11" fill="${LABEL}" text-anchor="middle">${esc(text)}</text>`;

  const W = P + COLS * T + (COLS - 1) * G + P;
  const y0 = P + CAP_H;
  let grid = "";
  GALLERY.forEach((t, k) => {
    grid += tile(P + (k % COLS) * (T + G), y0 + Math.floor(k / COLS) * (T + LABEL_H + ROW_GAP), t);
  });
  const H = y0 + (ROWS - 1) * (T + LABEL_H + ROW_GAP) + T + LABEL_H + P - 6;

  return { W, H, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<text x="${P}" y="${P + 14}" ${FONT} font-size="12" fill="${HEAD}">agenticon — every string maps to its own deterministic icon</text>
${grid}
</svg>
` };
}

// ---- terminal gallery (ANSI block glyphs) ----
const padCentre = (t, w) => {
  if (t.length >= w) return t.slice(0, w);
  const l = Math.floor((w - t.length) / 2);
  return " ".repeat(l) + t + " ".repeat(w - t.length - l);
};
function buildAnsi({ scale = 4, gap = 6 } = {}) {
  const sep = " ".repeat(gap), pad = "  ", iconW = GW * scale, h = GH * scale, out = [];
  for (let r = 0; r < ROWS; r++) {
    const items = GALLERY.slice(r * COLS, (r + 1) * COLS);
    const blocks = items.map((t) => agenticonAnsi(t, { scale }).split("\n"));
    for (let ln = 0; ln < h; ln++) out.push(pad + blocks.map((b) => b[ln]).join(sep));
    out.push("");                                          // breathing room under the icons
    out.push(pad + items.map((t) => padCentre(t, iconW)).join(sep));
    if (r < ROWS - 1) out.push("", "");                    // two blank rows between bands
  }
  return "\n\n" + out.join("\n") + "\n\n";                 // top & bottom breathing room
}

// ---- entry ----
const argv = process.argv.slice(2);
if (argv.includes("--ansi")) process.stdout.write(buildAnsi());
else {
  const { W, H, svg } = buildSvg();
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "assets", "demo.svg"), svg);
  console.log(`wrote assets/demo.svg  (${W}x${H}, ${GALLERY.length} icons)`);
}
