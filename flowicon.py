#!/usr/bin/env python3
"""
flowicon - terminal identicon via edge-continuity flow.

A 4x2 grid of cells (solids, halves, corner blocks, diagonals, corner triangles).
Cells are filled in a shuffled order; at each one we enumerate the legal tiles -- those
that leave no orphaned 1/4 square (every quarter shares a colour with a neighbour
in-cell or across a seam) -- and pick the most edge-contiguous, growing a continuous
flow across the grid. A rare deadlock is resolved by re-placing one neighbour.

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
WEIGHTS = {"Q": 0.50, "T": 0.32}                  # kind preference among legal candidates
ALL_MASKS = [
    (False, False, False, False), (False, False, False, True),
    (False, False, True, False), (False, False, True, True),
    (False, True, False, False), (False, True, False, True),
    (False, True, True, False), (False, True, True, True),
    (True, False, False, False), (True, False, False, True),
    (True, False, True, False), (True, False, True, True),
    (True, True, False, False), (True, True, False, True),
    (True, True, True, False), (True, True, True, True),
]
TRIS = ("UL", "UR", "LL", "LR")
INCELL = {0: (1, 2), 1: (0, 3), 2: (0, 3), 3: (1, 2)}          # in-cell orthogonal subpixels
SUBPX_EDGES = {0: (("N", 0), ("W", 0)), 1: (("N", 1), ("E", 0)),
               2: (("S", 0), ("W", 1)), 3: (("S", 1), ("E", 1))}
EDGE_DIR = {"N": (0, -1), "S": (0, 1), "W": (-1, 0), "E": (1, 0)}


def edge_colors(cell, edge):
    kind, data, fg, bg = cell
    if kind == "Q":
        return [fg if data[i] else bg for i in EDGES[edge]]
    return [fg, fg] if edge in TRI_LEGS[data] else [bg, bg]    # triangle legs read fg


SOLIDS = [("Q", (False, False, False, False), x, x) for x in PALETTE]   # always-legal floor


def _order_dedup(seq):
    out = []
    for x in seq:
        if x not in out:
            out.append(x)
    return out


def _two_color(cols):
    """Every two-colour tile over `cols`: quadrant masks + corner triangles."""
    out = []
    for bg in cols:
        for fg in cols:
            if fg == bg or contrast(fg, bg) < MIN_CONTRAST:
                continue
            for m in ALL_MASKS:
                out.append(("Q", m, fg, bg))
            for d in TRIS:
                out.append(("T", d, fg, bg))
    return out


def _orphaned(cell, c, r, getcell):
    """True if `cell` at (c,r) has a quarter with no same-colour support: none in its
    own cell and none across a seam into a *placed* neighbour. An unplaced neighbour
    counts as deferred (undefined), so it is never a definite orphan."""
    if cell[0] == "T":
        return False                                  # triangles are self-connected
    _, data, fg, bg = cell
    cols = [fg if data[i] else bg for i in range(4)]
    for q in range(4):
        col = cols[q]
        if any(cols[j] == col for j in INCELL[q]):
            continue                                  # supported within the cell
        ok = False
        for edge, pos in SUBPX_EDGES[q]:
            dc, dr = EDGE_DIR[edge]
            nc, nr = c + dc, r + dr
            if not (0 <= nc < GW and 0 <= nr < GH):
                continue                              # image border: no support
            nb = getcell((nc, nr))
            if nb is None or edge_colors(nb, OPP[edge])[pos] == col:
                ok = True                             # deferred (unplaced) or placed match
                break
        if not ok:
            return True
    return False


def _legal(tile, c, r, cells):
    """Legal iff placing it orphans neither itself nor any placed neighbour."""
    def getcell(p):
        return tile if p == (c, r) else cells.get(p)
    if _orphaned(tile, c, r, getcell):
        return False
    for nc, nr, _ in _neighbours(c, r):
        if (nc, nr) in cells and _orphaned(cells[(nc, nr)], nc, nr, getcell):
            return False
    return True


def _has_legal(c, r, cells):
    """Feasibility: does any legal tile exist here? (free of the random colour draw)."""
    tcols = []
    for nc, nr, e in _neighbours(c, r):
        if (nc, nr) in cells:
            t = edge_colors(cells[(nc, nr)], OPP[e])
            tcols.append(t[0]); tcols.append(t[1])
    if any(_legal(x, c, r, cells) for x in SOLIDS):
        return True
    return any(_legal(x, c, r, cells) for x in _two_color(_order_dedup(tcols)))


def _neighbours(c, r):
    out = []
    for dc, dr, e in ((1, 0, "E"), (-1, 0, "W"), (0, 1, "S"), (0, -1, "N")):
        nc, nr = c + dc, r + dr
        if 0 <= nc < GW and 0 <= nr < GH:
            out.append((nc, nr, e))
    return out


def _shuffle(rng, a):
    """In-place Fisher-Yates; matches the JS shuffle draw-for-draw."""
    for i in range(len(a) - 1, 0, -1):
        j = int(rng() * (i + 1))
        a[i], a[j] = a[j], a[i]
    return a


def _targets(c, r, cells):
    return [(e, edge_colors(cells[(nc, nr)], OPP[e]))
            for nc, nr, e in _neighbours(c, r) if (nc, nr) in cells]


def _pick_legal(c, r, cells, rng):
    """Pick among the legal tiles: most edge-contiguous, then kind-weighted."""
    targets = _targets(c, r, cells)
    cols = [choice(rng, PALETTE) for _ in range(4)]   # free colours for unconstrained parts
    for e, t in targets:
        cols.append(t[0]); cols.append(t[1])
    cols = _order_dedup(cols)
    legals = [x for x in SOLIDS + _two_color(cols) if _legal(x, c, r, cells)]
    if not legals:
        return None
    def score(x):
        return sum((edge_colors(x, e)[0] == t[0]) + (edge_colors(x, e)[1] == t[1])
                   for e, t in targets)
    best_score = max(score(x) for x in legals)
    best = [x for x in legals if score(x) == best_score]
    pools = [(k, [x for x in best if x[0] == k]) for k in ("Q", "T")]
    pools = [(k, p) for k, p in pools if p]
    tot = sum(WEIGHTS[k] for k, _ in pools)
    x, acc, chosen = rng() * tot, 0.0, pools[-1][1]
    for k, p in pools:
        acc += WEIGHTS[k]
        if x < acc:
            chosen = p
            break
    return chosen[int(rng() * len(chosen))]


def _placed_nbrs(c, r, cells):
    return [(nc, nr) for nc, nr, _ in _neighbours(c, r) if (nc, nr) in cells]


def _unblocking(c, r, cells):
    """A placed neighbour whose removal would give (c,r) a legal option again."""
    for nb in _placed_nbrs(c, r, cells):
        saved = cells.pop(nb)
        ok = _has_legal(c, r, cells)
        cells[nb] = saved
        if ok:
            return nb
    return None


def _repair(start, cells, rng):
    """Deadlock fix: ignore one offending neighbour, place the stuck cell, then
    re-place the neighbour; cascade if that re-placement is itself stuck."""
    stack = [start]
    while stack:
        x = stack.pop()
        if x in cells:
            continue
        if _has_legal(x[0], x[1], cells):
            cells[x] = _pick_legal(x[0], x[1], cells, rng)
            continue
        nb = _unblocking(x[0], x[1], cells)
        if nb is None:
            pn = _placed_nbrs(x[0], x[1], cells)
            nb = pn[0] if pn else None
        if nb is None:
            cells[x] = ("Q", (False, False, False, False), PALETTE[0], PALETTE[0])
            continue
        del cells[nb]
        stack.append(nb)
        stack.append(x)


def generate(text):
    """text -> {(col,row): (kind, data, fg, bg)} for the 4x2 grid.

    Cells are filled in a shuffled order. At each cell we enumerate the legal tiles
    (those that orphan no quarter of themselves or a placed neighbour) and pick the
    most edge-contiguous one, kind-weighted. A rare deadlock (no legal tile) is fixed
    by re-placing one neighbour. Vocabulary: solids, halves, corner blocks, diagonals,
    and corner triangles -- byte-compatible with flowicon.js."""
    rng = make_rng(text)
    cells = {}
    for (c, r) in _shuffle(rng, [(c, r) for r in range(GH) for c in range(GW)]):
        if _has_legal(c, r, cells):
            cells[(c, r)] = _pick_legal(c, r, cells, rng)
        else:
            _repair((c, r), cells, rng)
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
