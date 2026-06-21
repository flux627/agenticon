#!/usr/bin/env python3
"""
flowicon recolor — remap a generated icon onto a small bold palette.

After flowicon builds the 4x2 grid, this post-pass:
  1. sorts the icon's unique chromatic colours by hue at a random phase offset
  2. picks 1-5 bold new colours (OKLCH, full lightness + chroma range)
  3. splits the hue-sorted originals into that many contiguous groups
  4. shifts each original's HUE and SATURATION 70% toward its group's new colour,
     leaving BRIGHTNESS untouched so the icon's light/dark structure — and thus
     every shape's legibility — is preserved.

Achromatic originals (near-black / near-white) are routed to the nearest-lightness
new colour. Deterministic and byte-compatible with the recolour pass in flowicon.js
(shared cyrb128 + sfc32 RNG, OKLCH maths, and rgb<->hsv), so a given string yields the
same recolouring in the terminal and on the web.

Usage:
    python3 recolor.py "alice@example.com"
    python3 recolor.py --gallery
    python3 recolor.py "name" --raw        # literal glyphs (no fg/bg-swap reduction)
"""
import math
import sys
import flowicon as FI
from flowicon import make_rng


def _ckey(c):
    return (c[0] << 16) | (c[1] << 8) | c[2]


def _jround(x):                                                 # JS Math.round (half up); x >= 0
    return int(math.floor(x + 0.5))


# ---- bold OKLCH palette (analogous cluster + lightness ramp + one accent) ----
def _oklab_lrgb(L, a, b):
    l = (L + 0.3963377774*a + 0.2158037573*b)**3
    m = (L - 0.1055613458*a - 0.0638541728*b)**3
    s = (L - 0.0894841775*a - 1.2914855480*b)**3
    return (4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
            -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
            -0.0041960863*l - 0.7034186147*m + 1.7076147010*s)
def _gam(x):
    x = max(0.0, min(1.0, x)); return 12.92*x if x <= 0.0031308 else 1.055*x**(1/2.4) - 0.055
def _in_gamut(L, a, b):
    return all(-1e-3 <= v <= 1+1e-3 for v in _oklab_lrgb(L, a, b))
def oklch(L, C, H):
    h = math.radians(H); c = C
    while c > 0 and not _in_gamut(L, c*math.cos(h), c*math.sin(h)): c -= 0.004
    R, G, B = _oklab_lrgb(L, c*math.cos(h), c*math.sin(h))
    return (_jround(255*_gam(R)), _jround(255*_gam(G)), _jround(255*_gam(B)))

def bold_palette(N, H0):
    if N == 1:
        return [oklch(0.58, 0.34, H0)]
    Ls = [0.95 - (0.95 - 0.15)*i/(N-1) for i in range(N)]       # near-white -> near-black
    span = min(40, 14*(N-1))
    pts = [(Ls[i], H0 - span + 2*span*i/(N-1)) for i in range(N)]
    if N >= 3:
        m = N // 2; pts[m] = (pts[m][0], H0 + 180)              # one complementary accent
    return [oklch(L, 0.34, H) for L, H in pts]

# ---- colour helpers (rgb<->hsv ported from flowicon.js bit-for-bit) ----
def _hsv(c):
    r, g, b = c[0]/255.0, c[1]/255.0, c[2]/255.0
    mx = max(r, g, b); mn = min(r, g, b); d = mx - mn
    h = 0.0
    if d != 0.0:
        if mx == r:
            h = math.fmod((g - b) / d, 6.0)                     # JS % can be negative
        elif mx == g:
            h = (b - r) / d + 2.0
        else:
            h = (r - g) / d + 4.0
        h /= 6.0
        if h < 0:
            h += 1.0
    return (h, 0.0 if mx == 0 else d / mx, mx)
def _rgb(h, s, v):
    i = math.floor(h*6); f = h*6 - i
    p = v*(1-s); q = v*(1-f*s); t = v*(1-(1-f)*s)
    r, g, b = [(v, t, p), (q, v, p), (p, v, t),
               (p, q, v), (t, p, v), (v, p, q)][int(i % 6)]
    return (_jround(r*255), _jround(g*255), _jround(b*255))
def blend(orig, new, t_hs=0.7, t_v=0.0):
    ho, so, vo = _hsv(orig); hn, sn, vn = _hsv(new)
    dh = (((hn - ho + 0.5) % 1.0) + 1.0) % 1.0 - 0.5            # shortest hue path
    return _rgb((((ho + t_hs*dh) % 1.0) + 1.0) % 1.0, so + t_hs*(sn - so), vo + t_v*(vn - vo))

WEIGHTS = [(1, 0.12), (2, 0.28), (3, 0.30), (4, 0.20), (5, 0.10)]
def _pick_n(rng):
    x, acc = rng(), 0.0
    for n, w in WEIGHTS:
        acc += w
        if x < acc: return n
    return 3

# ---- the recolour map (steps 1-4); brightness locked by default (t_v=0.0) ----
def recolor_map(text, t_hs=0.7, t_v=0.0):
    cells = FI.generate(text)
    uniq, seen = [], set()                                      # row-major order, matches flowicon.js
    for r in range(FI.GH):
        for c in range(FI.GW):
            _, _, fg, bg = cells[(c, r)]
            for col in (fg, bg):
                k = _ckey(col)
                if k not in seen:
                    seen.add(k); uniq.append(col)
    rng = make_rng("recolor|" + text)
    chrom = [c for c in uniq if _hsv(c)[1] >= 0.08]
    achrom = [c for c in uniq if _hsv(c)[1] < 0.08]
    phase = rng()                                               # 1) hue sort, random phase
    chrom.sort(key=lambda c: (((_hsv(c)[0] - phase) % 1.0) + 1.0) % 1.0)
    N = _pick_n(rng); H0 = rng() * 360                          # 2) pick 1-5 bold colours
    new = bold_palette(N, H0)
    cmap, M = {}, len(chrom)                                    # 3) groups + 4) blend
    for i, c in enumerate(chrom):
        cmap[c] = blend(c, new[(i*N // M) if M else 0], t_hs, t_v)
    for c in achrom:                                            # nearest-lightness new colour
        v = _hsv(c)[2]
        best, bd = new[0], float("inf")
        for nc in new:
            dd = abs(_hsv(nc)[2] - v)
            if dd < bd:
                bd, best = dd, nc
        cmap[c] = blend(c, best, t_hs, t_v)
    return cells, cmap, new

def recolored_cells(text, **kw):
    cells, cmap, _ = recolor_map(text, **kw)
    return {pos: (k, d, cmap[fg], cmap[bg]) for pos, (k, d, fg, bg) in cells.items()}

# ---- terminal output (truecolor; recoloured values are arbitrary RGB) ----
ESC, RESET = "\x1b", "\x1b[0m"
def _sgr(fg, bg):
    return f"{ESC}[38;2;{fg[0]};{fg[1]};{fg[2]};48;2;{bg[0]};{bg[1]};{bg[2]}m"
def render_ansi(text, canonical=True, **kw):
    cells = recolored_cells(text, **kw)
    lines = []
    for r in range(FI.GH):
        line = ""
        for c in range(FI.GW):
            g, fg, bg = FI.to_glyph(cells[(c, r)], canonical)
            line += _sgr(fg, bg) + g
        lines.append(line + RESET)
    return "\n".join(lines)

def _main(argv):
    canonical = "--raw" not in argv
    args = [a for a in argv if not a.startswith("--")]
    if "--gallery" in argv:
        for n in ["alice@example.com", "bob@example.com", "carol", "dave",
                  "git@github.com", "192.168.1.42", "production", "claude"]:
            top, bot = render_ansi(n, canonical).split("\n")
            print(f"{top}   {n}"); print(bot); print()
        return 0
    if not args:
        print(__doc__.strip()); return 1
    print(render_ansi(args[0], canonical))
    return 0

if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
