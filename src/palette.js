// 16-colour base palette + a WCAG-style contrast guard so a two-colour tile's
// fg/bg are never an indistinguishable pair.

export const PALETTE = [
  [0x1a, 0x1c, 0x2c], [0x5d, 0x27, 0x5d], [0xb1, 0x3e, 0x53], [0xef, 0x7d, 0x57],
  [0xff, 0xcd, 0x75], [0xa7, 0xf0, 0x70], [0x38, 0xb7, 0x64], [0x25, 0x71, 0x79],
  [0x29, 0x36, 0x6f], [0x3b, 0x5d, 0xc9], [0x41, 0xa6, 0xf6], [0x73, 0xef, 0xf7],
  [0xf4, 0xf4, 0xf4], [0x94, 0xb0, 0xc2], [0x56, 0x6c, 0x86], [0xb2, 0x8d, 0xff],
];
export const MIN_CONTRAST = 3.0;

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

export function contrast(a, b) {
  const la = lum(a), lb = lum(b), hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// Pack an [r,g,b] into one integer for fast equality / Map keys.
export const ckey = (c) => (c[0] << 16) | (c[1] << 8) | c[2];
