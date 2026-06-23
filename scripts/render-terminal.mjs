#!/usr/bin/env node
// Render the terminal gallery (scripts/demo.mjs --ansi) through a REAL terminal and
// screenshot it to assets/demo-terminal.png. Uses ghostty-web (Ghostty's VT parser +
// renderer compiled to WASM) driven in headless Chrome, so the block/triangle/diagonal
// glyphs are drawn geometrically exactly as a terminal would — not a CSS lookalike.
//
// Requires (dev-only; NOT needed to use agenticon):
//   - a local ghostty-web build:  https://github.com/rcarmo/ghostty-web
//       set GHOSTTY_WEB_DIST=/path/to/ghostty-web/dist  (default: ../ghostty-web/dist)
//   - Chrome/Chromium: set CHROME=/path/to/binary (default: macOS Google Chrome)
//
//   node scripts/render-terminal.mjs

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = process.env.GHOSTTY_WEB_DIST || join(ROOT, "..", "ghostty-web", "dist");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(ROOT, "assets", "demo-terminal.png");

for (const [label, p] of [["ghostty-web dist", DIST], ["Chrome", CHROME]]) {
  if (!existsSync(p)) { console.error(`✗ ${label} not found: ${p}\n  (see header of ${import.meta.url})`); process.exit(1); }
}

// canonical terminal gallery from --ansi. Strip the stdout-only framing (top/bottom blank
// lines + the 2-space edge indent) since this HTML frame supplies its own padding; keep the
// real layout (doubled gaps, blank rows between bands). Then hide cursor; no trailing newline.
let content = execFileSync("node", [join(ROOT, "scripts", "demo.mjs"), "--ansi"], { encoding: "utf8" }).replace(/^\n+|\n+$/g, "");
const dedent = Math.min(...content.split("\n").filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
content = content.split("\n").map((l) => l.slice(dedent)).join("\n");
const visibleLen = (l) => [...l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")].length;
const cols = Math.max(...content.split("\n").map(visibleLen));
const rows = content.split("\n").length;
content = "\x1b[?25l" + content;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0d1117}
body{display:flex;align-items:center;justify-content:center;font-family:Menlo,monospace}
#frame{padding:30px 36px}
#cap{color:#8b949e;font-size:15px;margin:0 0 14px 2px}
#terminal canvas{display:block}
</style></head><body>
<div id="frame"><div id="cap">agenticon — terminal view (rendered by Ghostty)</div><div id="terminal"></div></div>
<script type="module">
import { init, Terminal } from '/ghostty-web.js';
await init('/ghostty-vt.wasm');
const term = new Terminal({ cols:${cols}, rows:${rows}, fontSize:15, fontFamily:'Menlo, monospace',
  convertEol:true, cursorBlink:false,
  theme:{ background:'#0d1117', foreground:'#8b949e', cursor:'#0d1117', cursorAccent:'#0d1117' } });
term.open(document.getElementById('terminal'));
term.write(${JSON.stringify(content)});
</script></body></html>`;

const TYPES = { js: "application/javascript", wasm: "application/wasm" };
const server = createServer((req, res) => {
  const path = req.url.split("?")[0];
  if (path === "/" ) { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(PAGE); }
  try {
    const buf = readFileSync(join(DIST, path));
    res.writeHead(200, { "Content-Type": TYPES[path.split(".").pop()] || "application/octet-stream" });
    res.end(buf);
  } catch { res.writeHead(404); res.end("not found"); }
});

server.listen(0, () => {
  const port = server.address().port;
  console.log(`rendering ${cols}x${rows} terminal via ghostty-web …`);
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars",
    "--force-device-scale-factor=2", "--window-size=1300,486",
    "--virtual-time-budget=6000", `--screenshot=${OUT}`, `http://localhost:${port}/`,
  ], { stdio: "ignore" });
  chrome.on("exit", (code) => { server.close(); console.log(code ? `✗ Chrome exited ${code}` : `✓ wrote ${OUT}`); process.exit(code ?? 0); });
});
