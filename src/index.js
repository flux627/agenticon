// agenticon — deterministic geometric identicons.
//   SVG for the web, ANSI block glyphs for the terminal, from one shared generator.
export { agenticon, agenticonDataURI, agenticonAnsi, default } from "./render.js";
export { generate, GW, GH } from "./generate.js";
export { buildRecolorMap, buildGrayMap, buildBwMap } from "./recolor.js";
export { makeRng } from "./rng.js";
export { PALETTE } from "./palette.js";
