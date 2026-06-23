#!/usr/bin/env node
// Build the README demo gallery as one composite SVG (assets/demo.svg).
// Deterministic: every tile is just agenticon(text) embedded into a labelled grid, so
// re-running reproduces the same image. Rasterise to PNG with headless Chrome if needed.
//   node scripts/demo.mjs        (or: npm run demo)

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { agenticon } from "../src/index.js";

const T = 88, G = 22, P = 28, LABEL_H = 22, ROW_GAP = 18, CAP_H = 30, COLS = 6;
const LABEL = "#8a8a8a", HEAD = "#9aa0a6";        // greys legible on light AND dark themes
const FONT = `font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"`;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// each icon is a standalone <svg>; strip the wrapper and drop the body into a translated <g>
const iconBody = (text, opts) =>
  agenticon(text, { size: T, ...opts }).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
const tile = (x, y, text, opts, label) =>
  `<g transform="translate(${x} ${y})" clip-path="url(#r)">${iconBody(text, opts)}</g>` +
  `<text x="${x + T / 2}" y="${y + T + 15}" ${FONT} font-size="11" fill="${LABEL}" text-anchor="middle">${esc(label)}</text>`;

const GALLERY = ["alice", "bob", "carol", "dave", "octocat", "acme-corp",
                 "deploy-bot", "agenticon", "v2.0.0", "user_42", "sunrise", "otter"];
const VARIANTS = [[{}, "default"], [{ gray: true }, "--gray"], [{ bw: true }, "--bw"]];

const W = P + COLS * T + (COLS - 1) * G + P;
const y0 = P + CAP_H;

let grid = "";
GALLERY.forEach((t, k) => {
  const x = P + (k % COLS) * (T + G), y = y0 + Math.floor(k / COLS) * (T + LABEL_H + ROW_GAP);
  grid += tile(x, y, t, {}, t);
});
const rows = Math.ceil(GALLERY.length / COLS);
const yDiv = y0 + rows * (T + LABEL_H) + (rows - 1) * ROW_GAP + 14;
const yHead = yDiv + 24, yB = yDiv + 32;

const bX = (W - (VARIANTS.length * T + (VARIANTS.length - 1) * G)) / 2;
let strip = "";
VARIANTS.forEach(([opts, cap], i) => { strip += tile(bX + i * (T + G), yB, "agenticon", opts, cap); });

const H = yB + T + LABEL_H + P - 6;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><clipPath id="r" clipPathUnits="objectBoundingBox"><rect width="1" height="1" rx="0.16" ry="0.16"/></clipPath></defs>
<text x="${P}" y="${P + 14}" ${FONT} font-size="12" fill="${HEAD}">agenticon — every string maps to its own deterministic icon</text>
${grid}
<line x1="${P}" y1="${yDiv}" x2="${W - P}" y2="${yDiv}" stroke="#8080804d"/>
<text x="${P}" y="${yHead}" ${FONT} font-size="11" fill="${HEAD}" letter-spacing="0.6">MONOCHROME MODES — one icon, three views</text>
${strip}
</svg>
`;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "assets"), { recursive: true });
writeFileSync(join(root, "assets", "demo.svg"), svg);
console.log(`wrote assets/demo.svg  (${W}x${H}, ${GALLERY.length + VARIANTS.length} icons)`);
