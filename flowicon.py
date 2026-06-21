#!/usr/bin/env python3
"""
flowicon - terminal identicon via edge-continuity flow.

A 4x2 grid of cells, each an independent (glyph, fg, bg). Adjacent cells are grown
so they share a colour along their shared edge (phase A: re-seeded pairs, weak match;
phase B: isolated cells matched to >=2 neighbours). Vocabulary: quadrant blocks,
corner triangles (the legs read fg, the rest bg), and shades (which carry both
colours on every edge, so they bridge anything).

Deterministic, and byte-compatible with flowicon.js: both share the cyrb128 + sfc32
RNG and identical draw order, so a given string yields the same cells in the terminal
and on the web.

Usage:
    python3 flowicon.py "alice@example.com"
    python3 flowicon.py --gallery
    python3 flowicon.py "name" --mode 256      # 8-bit fallback for old terminals
    python3 flowicon.py "name" --raw           # canonical OFF (emit literal glyphs incl full block)
"""
import sys

# ---- deterministic hash -> PRNG (cyrb128 + sfc32), matching flowicon.js bit-for-bit ----
MASK = 0xFFFFFFFF


def _imul(a, b):
    """JS Math.imul: low 32 bits of the product."""
    return (a * b) & MASK


def _utf16_units(s):
    """JS String#charCodeAt sequence: UTF-16 code units."""
    data = s.encode("utf-16-le")
    return [data[i] | (data[i + 1] << 8) for i in range(0, len(data), 2)]


def _cyrb128(s):
    h1, h2, h3, h4 = 1779033703, 3144134277, 1013904242, 2773480762
    for k in _utf16_units(s):
        h1 = (h2 ^ _imul(h1 ^ k, 597399067)) & MASK
        h2 = (h3 ^ _imul(h2 ^ k, 2869860233)) & MASK
        h3 = (h4 ^ _imul(h3 ^ k, 951274213)) & MASK
        h4 = (h1 ^ _imul(h4 ^ k, 2716044179)) & MASK
    h1 = _imul(h3 ^ (h1 >> 18), 597399067)
    h2 = _imul(h4 ^ (h2 >> 22), 2869860233)
    h3 = _imul(h1 ^ (h3 >> 17), 951274213)
    h4 = _imul(h2 ^ (h4 >> 19), 2716044179)
    h1 = (h1 ^ (h2 ^ h3 ^ h4)) & MASK
    h2 = (h2 ^ h1) & MASK
    h3 = (h3 ^ h1) & MASK
    h4 = (h4 ^ h1) & MASK
    return [h1, h2, h3, h4]


def make_rng(text):
    """sfc32, seeded by cyrb128(text); returns a float in [0,1) per call."""
    st = _cyrb128(text)

    def rng():
        a, b, c, d = st
        t = (a + b) & MASK
        t = (t + d) & MASK
        d = (d + 1) & MASK
        a = (b ^ (b >> 9)) & MASK
        b = (c + ((c << 3) & MASK)) & MASK
        c = (((c << 21) & MASK) | (c >> 11)) & MASK
        c = (c + t) & MASK
        st[0], st[1], st[2], st[3] = a, b, c, d
        return t / 4294967296.0

    return rng


def choice(rng, seq):
    """JS arr[Math.floor(rng() * arr.length)]."""
    return seq[int(rng() * len(seq))]


# ---- palette + contrast (so a cell is never an invisible fg-on-equal-bg) ----
PALETTE = [
    (0x1a, 0x1c, 0x2c), (0x5d, 0x27, 0x5d), (0xb1, 0x3e, 0x53), (0xef, 0x7d, 0x57),
    (0xff, 0xcd, 0x75), (0xa7, 0xf0, 0x70), (0x38, 0xb7, 0x64), (0x25, 0x71, 0x79),
    (0x29, 0x36, 0x6f), (0x3b, 0x5d, 0xc9), (0x41, 0xa6, 0xf6), (0x73, 0xef, 0xf7),
    (0xf4, 0xf4, 0xf4), (0x94, 0xb0, 0xc2), (0x56, 0x6c, 0x86), (0xb2, 0x8d, 0xff),
]
MIN_CONTRAST = 3.0


def _lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def _lum(rgb):
    r, g, b = (_lin(x) for x in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = _lum(a), _lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


_PARTNERS_CACHE = {}


def partners(x):
    r = _PARTNERS_CACHE.get(x)                         # pure in x; only 16 palette inputs
    if r is None:
        r = [c for c in PALETTE if c != x and contrast(c, x) >= MIN_CONTRAST]
        _PARTNERS_CACHE[x] = r
    return r


# ---- grid / edge model ----
GW, GH = 4, 2
EDGES = {"N": (0, 1), "S": (2, 3), "W": (0, 2), "E": (1, 3)}   # subpixels 0UL 1UR 2LL 3LR
OPP = {"N": "S", "S": "N", "E": "W", "W": "E"}
TRI_LEGS = {"UL": {"N", "W"}, "UR": {"N", "E"}, "LL": {"S", "W"}, "LR": {"S", "E"}}
KINDS = [("Q", 0.50), ("T", 0.32), ("S", 0.18)]


def edge_colors(cell, edge):
    kind, data, fg, bg = cell
    if kind == "Q":
        return [fg if data[i] else bg for i in EDGES[edge]]
    if kind == "T":
        return [fg, fg] if edge in TRI_LEGS[data] else [bg, bg]
    return [fg, bg]                                   # shade: both colours everywhere


def _rand_data(rng, kind):
    if kind == "Q":
        return tuple(rng() < 0.5 for _ in range(4))
    if kind == "T":
        return choice(rng, ["UL", "UR", "LL", "LR"])
    return choice(rng, ["light", "med", "dark"])


def _pick_kind(rng):
    x, acc = rng(), 0.0
    for k, w in KINDS:
        acc += w
        if x < acc:
            return k
    return "Q"


def _rand_cell(rng):
    bg = choice(rng, PALETTE)
    fg = choice(rng, partners(bg))
    k = _pick_kind(rng)
    return (k, _rand_data(rng, k), fg, bg)


def _cell_touching(rng, edge, X):
    ps = partners(X)
    for _ in range(150):
        k = _pick_kind(rng)
        use_fg = rng() < 0.5
        data = _rand_data(rng, k)                     # drawn before the fg/bg pick (matches JS)
        fg, bg = (X, choice(rng, ps)) if use_fg else (choice(rng, ps), X)
        cell = (k, data, fg, bg)
        if X in edge_colors(cell, edge):
            return cell
    return ("S", "med", X, choice(rng, ps))           # shade always touches X


def _cell_matching(rng, cons):
    if not cons:
        return _rand_cell(rng)
    best, best_score = None, -1
    for _ in range(300):
        cell = _rand_cell(rng)
        score = sum(1 for e, allowed in cons
                    if any(c in allowed for c in edge_colors(cell, e)))
        if score > best_score:
            best, best_score = cell, score
            if score == len(cons):
                break
    return best


def _neighbours(c, r):
    out = []
    for dc, dr, e in ((1, 0, "E"), (-1, 0, "W"), (0, 1, "S"), (0, -1, "N")):
        nc, nr = c + dc, r + dr
        if 0 <= nc < GW and 0 <= nr < GH:
            out.append((nc, nr, e))
    return out


def generate(text):
    """text -> {(col,row): (kind, data, fg, bg)} for the 4x2 grid."""
    rng = make_rng(text)
    cells = {}

    def undet():
        return [(c, r) for r in range(GH) for c in range(GW) if (c, r) not in cells]

    def two_adj():
        return any((nc, nr) not in cells
                   for (c, r) in undet() for nc, nr, _ in _neighbours(c, r))

    while two_adj():                                              # phase A
        seeds = [(c, r) for (c, r) in undet()
                 if any((nc, nr) not in cells for nc, nr, _ in _neighbours(c, r))]
        c, r = choice(rng, seeds)
        cells[(c, r)] = _rand_cell(rng)
        nb = [(nc, nr, e) for nc, nr, e in _neighbours(c, r) if (nc, nr) not in cells]
        nc, nr, e = choice(rng, nb)
        X = choice(rng, edge_colors(cells[(c, r)], e))
        cells[(nc, nr)] = _cell_touching(rng, OPP[e], X)
    for (c, r) in undet():                                        # phase B
        cons = [(e, set(edge_colors(cells[(nc, nr)], OPP[e])))
                for nc, nr, e in _neighbours(c, r) if (nc, nr) in cells]
        cells[(c, r)] = _cell_matching(rng, cons)
    return cells


# ---- glyph mapping ----
MASK2GLYPH = {
    (0, 0, 0, 0): " ", (1, 0, 0, 0): "▘", (0, 1, 0, 0): "▝", (0, 0, 1, 0): "▖",
    (0, 0, 0, 1): "▗", (1, 1, 0, 0): "▀", (0, 0, 1, 1): "▄", (1, 0, 1, 0): "▌",
    (0, 1, 0, 1): "▐", (1, 0, 0, 1): "▚", (0, 1, 1, 0): "▞", (1, 1, 1, 0): "▛",
    (1, 1, 0, 1): "▜", (1, 0, 1, 1): "▙", (0, 1, 1, 1): "▟", (1, 1, 1, 1): "█",
}
TRI2GLYPH = {"UL": "◤", "UR": "◥", "LL": "◣", "LR": "◢"}
SHADE2GLYPH = {"light": "░", "med": "▒", "dark": "▓"}


def to_glyph(cell, canonical=True):
    """Return (glyph, fg, bg). Canonical form uses fg/bg swap to shrink the glyph
    set (quadrants 16->8, triangles 4->2) and never emits the full block."""
    kind, data, fg, bg = cell
    if kind == "Q":
        mask = data
        if canonical and (sum(mask) > 2 or (sum(mask) == 2 and not mask[0])):
            mask, fg, bg = tuple(not b for b in mask), bg, fg   # exact complement
        return MASK2GLYPH[mask], fg, bg
    if kind == "T":
        corner = data
        if canonical and corner == "LR":
            corner, fg, bg = "UL", bg, fg                       # ◢(F,B) == ◤(B,F)
        elif canonical and corner == "LL":
            corner, fg, bg = "UR", bg, fg                       # ◣(F,B) == ◥(B,F)
        return TRI2GLYPH[corner], fg, bg
    return SHADE2GLYPH[data], fg, bg                            # shades kept as-is


# ---- ANSI ----
ESC, RESET = "\x1b", "\x1b[0m"


def _rgb256(rgb):
    r, g, b = rgb
    if r == g == b:
        if r < 8:
            return 16
        if r > 248:
            return 231
        return 232 + round((r - 8) / 247 * 24)
    return 16 + 36 * round(r / 255 * 5) + 6 * round(g / 255 * 5) + round(b / 255 * 5)


def _sgr(fg, bg, mode):
    if mode == "256":
        return f"{ESC}[38;5;{_rgb256(fg)};48;5;{_rgb256(bg)}m"
    return f"{ESC}[38;2;{fg[0]};{fg[1]};{fg[2]};48;2;{bg[0]};{bg[1]};{bg[2]}m"


def render_ansi(text, mode="truecolor", canonical=True):
    cells = generate(text)
    lines = []
    for r in range(GH):
        line = ""
        for c in range(GW):
            g, fg, bg = to_glyph(cells[(c, r)], canonical)
            line += _sgr(fg, bg, mode) + g
        lines.append(line + RESET)
    return "\n".join(lines)


def _main(argv):
    mode = "256" if "--mode" in argv and "256" in argv else "truecolor"
    canonical = "--raw" not in argv
    args = [a for a in argv if not a.startswith("--") and a != "256"]

    if "--gallery" in argv:
        names = ["alice@example.com", "bob@example.com", "carol", "dave",
                 "git@github.com", "192.168.1.42", "production", "claude"]
        for n in names:
            top, bot = render_ansi(n, mode, canonical).split("\n")
            print(f"{top}   {n}")
            print(bot)
            print()
        return 0
    if not args:
        print(__doc__.strip())
        return 1
    print(render_ansi(args[0], mode, canonical))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
