"""Write the derived colour themes: one rule, one JSON file per theme (web/src/compile/schemes/<id>.json).

Run from the repository root:  uv run --with coloraide python scripts/gen_themes.py

A theme is a list of anchor colours and a few knobs (Knobs, set per theme in THEMES at the end). The rule moves VESTA's
colour of each element into the anchors' world, in five steps (derive):
 1 target   The element's VESTA colour, in OKLCH. Its hue family is the chemistry convention.
 2 hue      The target hue lies between two neighbouring anchor hues on the wheel and is pulled toward them: `pull` 0
            keeps it, 1 takes the nearer anchor hue. It never moves more than `max_shift` degrees.
 3 L and C  By rank. An element at the p-th lightness percentile of VESTA gets the anchors' p-th lightness percentile,
            and chroma likewise among the chromatic elements and anchors, so a pastel palette stays pastel and a deep
            one deep. `trim` drops the anchors' extreme tails and `chroma_scale` scales C. Oxygen is kept a clear red.
 4 snap     Optionally (`snap`), the colour is replaced by the nearest anchor of the same hue family, so a large palette
            (Tailwind, Japanese, Chinese ...) shows only its real swatches.
 5 rules    The same for every theme. Each element stays `bg_min` away from the backgrounds the theme is made for
            (OKLab distance), and the pairs in PAIRS stay MIN_PAIR apart: the later element of a colliding pair moves.

Each theme's file is {id, name, description, source, colours}; the names, descriptions and sources are in INFO. The
colour library is coloraide. The anchor lists are in scripts/theme_data/ (their licences are in INFO). The output is
deterministic: rerunning the script reproduces the committed files byte for byte.
"""

import itertools
import json
import math
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import NamedTuple

from coloraide import Color

HERE = Path(__file__).resolve().parent
DATA = HERE / "theme_data"  # the anchor lists the themes read
OUT = HERE.parent / "web" / "src" / "compile" / "schemes"  # one JSON file per theme, listed by the registry

# VESTA is the reference: its committed scheme file (written by gen_element_styles.py), element symbol to "#rrggbb".
VESTA = json.loads((OUT / "vesta.json").read_text())["colours"]

BACKGROUNDS = {"light": "#fafafa", "dark": "#18181b"}
NEUTRAL_CHROMA = 0.045  # an anchor below this chroma is a neutral
TARGET_NEUTRAL_CHROMA = 0.035  # a VESTA colour below this chroma is a neutral element (it keeps no hue)
MIN_PAIR = 0.10  # OKLab; the just-noticeable difference is ~.02, below .10 sphere colours blur at figure size
# The element pairs that sit next to each other in the common structures and must stay apart. The later element moves.
PAIRS = [
    ("Si", "O"),
    ("Fe", "O"),
    ("C", "N"),
    ("C", "O"),
    ("C", "H"),
    ("N", "O"),
    ("O", "H"),
    ("N", "H"),
    ("Na", "Cl"),
    ("Zr", "O"),
    ("Mg", "Fe"),
    ("Mg", "O"),
    ("Ca", "Si"),
    ("Ca", "O"),
    ("Al", "Si"),
    ("Al", "O"),
    ("Ti", "O"),
    ("Li", "Co"),
    ("Li", "O"),
    ("Co", "O"),
    ("P", "O"),
    ("Si", "Ti"),
    ("Sr", "Zr"),
    ("Al", "Ca"),
    ("Co", "Cu"),
    ("Si", "Cu"),
    ("Si", "Co"),
    ("Ti", "Ca"),
    ("Ti", "Al"),
]


@dataclass(frozen=True)
class Knobs:
    """What differs between themes. The defaults are the rule's; THEMES overrides them per theme."""

    pull: float = 0.6  # 0 keeps the VESTA hue between two anchor hues, 1 takes the nearer anchor hue (step 2)
    max_shift: float = 25  # the most a hue moves, in degrees (step 2)
    trim: float = 0.05  # the share of the anchors' lightness and chroma ranks cut off at each end (step 3)
    chroma_scale: float = 1.0  # multiplies the chroma step 3 finds
    snap: bool = False  # replace each colour by the nearest anchor of its hue family (step 4)
    o_chroma_min: float = 0.17  # oxygen's least chroma: it stays a clear red
    o_lmax: float = 0.72  # oxygen's greatest lightness
    bg_min: float = 0.12  # the least OKLab distance from each background (step 5)
    backgrounds: tuple[str, ...] = ("light", "dark")  # the backgrounds the theme is made for


# ------------------------------------------------------------------ colour helpers
class Anchor(NamedTuple):
    name: str
    hex: str
    lch: tuple[float, float, float]  # OKLCH lightness, chroma, hue in degrees


def lch_of_hex(hex_colour: str) -> tuple[float, float, float]:
    colour = Color(hex_colour).convert("oklch")
    hue = colour["hue"]
    chroma = colour["chroma"]
    return colour["lightness"], chroma, (hue if chroma > 1e-4 and hue == hue else 0.0)  # a grey has no hue (NaN)


def to_hex(lightness: float, chroma: float, hue: float) -> str:
    """The OKLCH colour as "#rrggbb", its chroma reduced until it fits sRGB."""
    return (
        Color("oklch", [lightness, max(chroma, 0), hue % 360])
        .fit("srgb", method="oklch-chroma")
        .convert("srgb")
        .to_string(hex=True, fixup=True)
        .lower()
    )


def lab_of(hex_colour: str) -> tuple[float, float, float]:
    colour = Color(hex_colour).convert("oklab")
    return colour["lightness"], colour["a"], colour["b"]


def distance(a: str, b: str) -> float:
    """OKLab distance between two "#rrggbb" colours."""
    return math.dist(lab_of(a), lab_of(b))


def hue_gap(a: float, b: float) -> float:
    """The angle between two hues, 0 to 180 degrees."""
    d = abs(a - b) % 360
    return min(d, 360 - d)


# ------------------------------------------------------------------ the rule
def quantile(values: list[float], p: float) -> float:
    """The p-th quantile (p in 0..1), interpolating between neighbours."""
    values = sorted(values)
    position = p * (len(values) - 1)
    i = int(position)
    fraction = position - i
    return values[i] if i + 1 >= len(values) else values[i] * (1 - fraction) + values[i + 1] * fraction


def percentiles(values: list[float]) -> list[float]:
    """The mid-rank percentile (0..1) of each value among all values."""
    return [(sum(v < x for v in values) + 0.5 * sum(v == x for v in values)) / len(values) for x in values]


def pulled_hue(hue: float, anchor_hues: list[float], pull: float) -> float:
    """The hue moved toward the anchor hues on each side of it: `pull` 0 leaves it, 1 puts it on the nearer one."""
    hues = sorted(anchor_hues)
    below = max((a for a in hues if a <= hue), default=hues[-1] - 360)
    above = min((a for a in hues if a > hue), default=hues[0] + 360)
    t = (hue - below) / ((above - below) or 1)  # where the hue sits between its neighbours, 0..1
    moved = (1 - pull) * t + pull * (1.0 if t > 0.5 else 0.0)
    return (below + (above - below) * moved) % 360


def place_by_rank(anchors: list[Anchor], k: Knobs) -> dict[str, tuple[float, float, float]]:
    """Steps 1 to 3: each element's OKLCH colour, from VESTA's hue, lightness rank and chroma rank."""
    chromatic = [a for a in anchors if a.lch[1] >= NEUTRAL_CHROMA]
    neutral = [a for a in anchors if a.lch[1] < NEUTRAL_CHROMA]
    anchor_lightness = [a.lch[0] for a in anchors]
    anchor_chroma = [a.lch[1] for a in chromatic]
    anchor_hues = [a.lch[2] for a in chromatic]
    neutral_hue = sum(a.lch[2] for a in neutral) / len(neutral) if neutral else 70.0
    neutral_chroma = quantile([a.lch[1] for a in neutral], 0.5) if neutral else 0.015

    target = {element: lch_of_hex(hex_colour) for element, hex_colour in VESTA.items()}
    lightness_rank = dict(zip(target, percentiles([lch[0] for lch in target.values()]), strict=True))
    coloured = [element for element, lch in target.items() if lch[1] >= TARGET_NEUTRAL_CHROMA]
    chroma_rank = dict(zip(coloured, percentiles([target[element][1] for element in coloured]), strict=True))

    def trimmed(rank: float) -> float:
        return k.trim + (1 - 2 * k.trim) * rank

    placed = {}
    for element, (_, _, hue) in target.items():
        lightness = quantile(anchor_lightness, trimmed(lightness_rank[element]))
        if element not in chroma_rank:
            placed[element] = (lightness, min(neutral_chroma, 0.03), neutral_hue)
            continue
        chroma = quantile(anchor_chroma, trimmed(chroma_rank[element])) * k.chroma_scale
        shift = ((pulled_hue(hue, anchor_hues, k.pull) - hue + 180) % 360) - 180
        placed[element] = (lightness, chroma, hue + max(-k.max_shift, min(k.max_shift, shift)))
    lightness, chroma, hue = placed["O"]
    placed["O"] = (min(lightness, k.o_lmax), max(chroma, k.o_chroma_min), min(max(hue, 14), 40))  # red hues only
    return placed


def snapper(anchors: list[Anchor], k: Knobs) -> Callable[[str, str], str]:
    """Step 4 as a function of (colour, element): the nearest anchor of the colour's hue family (the neutral anchors for
    a neutral), or the colour itself when the theme does not snap."""
    chromatic = [a for a in anchors if a.lch[1] >= NEUTRAL_CHROMA]
    neutral = [a for a in anchors if a.lch[1] < NEUTRAL_CHROMA]

    def snap(hex_colour: str, element: str) -> str:
        if not k.snap:
            return hex_colour
        _, chroma, hue = lch_of_hex(hex_colour)
        if chroma < NEUTRAL_CHROMA:
            pool = neutral
        else:
            pool = []
            for tolerance in (22, 35, 50, 90):  # the tightest hue window that holds an anchor
                pool = [
                    a
                    for a in chromatic
                    if hue_gap(a.lch[2], hue) <= tolerance and (element != "O" or a.lch[1] >= k.o_chroma_min * 0.9)
                ]
                if pool:
                    break
        pool = pool or chromatic or anchors
        return min(pool, key=lambda a: distance(hex_colour, a.hex)).hex

    return snap


def keep_off_backgrounds(palette: dict[str, str], snap: Callable[[str, str], str], k: Knobs) -> None:
    """Step 5, backgrounds: an element too near a background has its lightness stepped away from it until it is not."""
    backgrounds = [BACKGROUNDS[name] for name in k.backgrounds]

    def clear(hex_colour: str) -> bool:
        return all(distance(hex_colour, b) >= k.bg_min for b in backgrounds)

    for element, hex_colour in palette.items():
        if clear(hex_colour):
            continue
        lightness, chroma, hue = lch_of_hex(hex_colour)
        too_near_dark = any(distance(hex_colour, b) < k.bg_min and lab_of(b)[0] < lightness for b in backgrounds)
        direction = 1 if too_near_dark else -1  # lighter away from a dark background, darker away from a light one
        for step in range(1, 16):
            moved = snap(to_hex(lightness + direction * 0.02 * step, chroma, hue), element)
            if clear(moved):
                palette[element] = moved
                break


def partners(element: str) -> set[str]:
    return {x for pair in PAIRS for x in pair if element in pair} - {element}


def separate_pairs(palette: dict[str, str], snap: Callable[[str, str], str], anchors: list[Anchor], k: Knobs) -> None:
    """Step 5, pairs: a pair of elements closer than MIN_PAIR moves its later element (the earlier one if that finds
    nothing, never oxygen), trying small changes of lightness, hue and chroma until the colour clears the backgrounds
    and every partner. A snapped palette needs no extra margin; a continuous one keeps 0.005 more."""
    backgrounds = [BACKGROUNDS[name] for name in k.backgrounds]
    margin = MIN_PAIR + (0 if k.snap else 0.005)
    lightness_range = (min(a.lch[0] for a in anchors) - 0.03, max(a.lch[0] for a in anchors) + 0.03)
    lightness_steps = [0] + [sign * d for d in (0.02, 0.04, 0.06, 0.08, 0.10, 0.12, 0.15) for sign in (1, -1)]
    hue_steps = [0, 8, -8, 16, -16, 24, -24, 36, -36, 48, -48]
    chroma_steps = (0, 0.02, 0.04, 0.06)

    def fits(hex_colour: str, element: str) -> bool:
        if any(distance(hex_colour, b) < k.bg_min for b in backgrounds):
            return False
        return all(distance(hex_colour, palette[p]) >= margin for p in partners(element) if p in palette)

    def move(element: str) -> bool:
        lightness, chroma, hue = lch_of_hex(palette[element])
        for d_chroma, d_hue, d_lightness in itertools.product(chroma_steps, hue_steps, lightness_steps):
            if not lightness_range[0] <= lightness + d_lightness <= lightness_range[1]:
                continue
            moved = snap(to_hex(lightness + d_lightness, chroma + d_chroma, hue + d_hue), element)
            if moved != palette[element] and fits(moved, element):
                palette[element] = moved
                return True
        return False

    for _ in range(3):
        for first, second in PAIRS:
            if distance(palette[first], palette[second]) >= MIN_PAIR:
                continue
            movers = (first,) if second == "O" else (second, first)
            for element in movers:
                if element != "O" and move(element):
                    break


def derive(anchor_list: list[tuple[str, str]], k: Knobs) -> dict[str, str]:
    """The theme's palette, {element: "#rrggbb"}, from its anchors, (name, hex) pairs, and its knobs."""
    anchors = [Anchor(name, hex_colour.lower(), lch_of_hex(hex_colour)) for name, hex_colour in anchor_list]
    snap = snapper(anchors, k)
    palette = {element: snap(to_hex(*lch), element) for element, lch in place_by_rank(anchors, k).items()}
    keep_off_backgrounds(palette, snap, k)
    separate_pairs(palette, snap, anchors, k)
    return palette


# ------------------------------------------------------------------ anchor lists
def tailwind(fams, shades):
    tw = json.loads((DATA / "tailwind-colors.json").read_text())
    return [(f"{f}-{s}", to_hex(*tw[f][s])) for f in fams for s in map(str, shades) if s in tw[f]]


TW_CHROMATIC = [
    "red",
    "orange",
    "amber",
    "yellow",
    "lime",
    "green",
    "emerald",
    "teal",
    "cyan",
    "sky",
    "blue",
    "indigo",
    "violet",
    "purple",
    "fuchsia",
    "pink",
    "rose",
]
TW_NEUTRAL = ["slate", "stone"]


def tw_all(lo, hi):
    return tailwind(
        TW_CHROMATIC + TW_NEUTRAL, [s for s in range(100, 1000, 100) if lo <= s <= hi] + ([950] if hi >= 950 else [])
    )


def opencolor(shades=(4, 5, 6, 7)):
    oc = json.loads((DATA / "open-color.json").read_text())
    return [(f"{f}-{i}", arr[i]) for f, arr in oc.items() if isinstance(arr, list) for i in shades]


def metbrewer(*keys):
    mb = json.loads((DATA / "metbrewer.json").read_text())
    return [(c, c) for c in dict.fromkeys(c for k in keys for c in mb[k])]


def banded(lst, lo=0.45, hi=0.88):
    return [(n, h) for n, h in lst if lo <= lch_of_hex(h)[0] <= hi]


def nippon():
    return banded(
        [
            (f"{c['name']} {c['romanized'].lower()}", c["value"])
            for c in json.loads((DATA / "nippon-colors.json").read_text())
        ]
    )


def zhongguo():
    return banded(
        [(f"{c['name']} {c['pinyin']}", c["hex"]) for c in json.loads((DATA / "zhongguose-colors.json").read_text())]
    )


OKABE_ITO = [
    ("vermillion", "#d55e00"),
    ("orange", "#e69f00"),
    ("yellow", "#f0e442"),
    ("bluish green", "#009e73"),
    ("sky blue", "#56b4e9"),
    ("blue", "#0072b2"),
    ("reddish purple", "#cc79a7"),
    ("grey", "#8c8c8c"),
]
MIDCENTURY = [
    ("mustard", "#d9a21b"),
    ("burnt orange", "#c8581e"),
    ("coral", "#e8735a"),
    ("tomato", "#b8322a"),
    ("teal", "#1f7a7a"),
    ("turquoise", "#4fa3a5"),
    ("olive", "#8a8a2f"),
    ("avocado", "#6b7a2a"),
    ("warm brown", "#7a4a2b"),
    ("cream", "#efe2c0"),
    ("slate blue", "#4a6a8a"),
    ("dusty blue", "#86a5b8"),
    ("plum", "#7a4a62"),
    ("charcoal", "#3a3a3a"),
]

WATERCOLOUR = [
    ("ultramarine", "#5b73c4"),
    ("cerulean", "#6fa8cf"),
    ("viridian", "#4fa58a"),
    ("sap green", "#8fa94a"),
    ("raw sienna", "#c99a5b"),
    ("burnt sienna", "#b8694a"),
    ("yellow ochre", "#d4a84b"),
    ("alizarin crimson", "#c2506a"),
    ("quinacridone rose", "#d0698f"),
    ("Payne's grey", "#6b7a8c"),
    ("cadmium orange", "#e08a4a"),
]  # diluted washes, approximated

# The display name, one-line description and source/licence of each theme, as the record carries them. The licences
# are stated as they are: a list with no stated licence says so, and its colour values are facts.
INFO = {
    "modern": (
        "Modern",
        "VESTA colours re-expressed through Tailwind shade 400-600 anchors, continuous (not snapped).",
        "Tailwind CSS v4.3 theme.css, MIT, Tailwind Labs.",
    ),
    "print": (
        "Print",
        "Deeper, quieter variant for white paper; checked on the light background only.",
        "Tailwind CSS v4.3, MIT (shades 500-700).",
    ),
    "dark": (
        "Night",
        "Lifted lightness band for dark pages; checked on the dark background only.",
        "Tailwind CSS v4.3, MIT (shades 300-500).",
    ),
    "pastel": (
        "Pastel",
        "Soft, high-lightness, low-chroma; O stays a clear coral red.",
        "Tailwind CSS v4.3, MIT (shades 200-300), chroma x0.65.",
    ),
    "tailwind": (
        "Tailwind",
        "The viewer's own palette: every atom is a real Tailwind swatch.",
        "Tailwind CSS v4.3 theme.css, MIT (shades 300-700; slate, stone, 17 hue families).",
    ),
    "opencolor": (
        "Open Color",
        "Flat, bright UI colours from Open Color; 38 distinct swatches.",
        "Open Color 1.9.1, MIT, heeyeun (shades 4-7).",
    ),
    "nippon": (
        "Nippon",
        "Traditional Japanese colours (日本の伝統色), snapped.",
        "List as in the syaning/nippon-colors npm package (MIT; 250 names with romanisation and hex, the "
        "nipponcolors.com set). No descriptive text copied. Colour values are facts; the package's MIT licence "
        "covers its compilation.",
    ),
    "zhongguo": (
        "Zhongguo",
        "Traditional Chinese colours (中国传统色), snapped.",
        "zhongguose.com/colors.json (526 entries with pinyin and hex), fetched 2026-11-26. No licence stated: "
        "zhongguose.com publishes none for the list. Colour values are facts; hex values and names only, no "
        "site text. Confirm before shipping the data in a distribution.",
    ),
    "cvd": (
        "Colour-blind safe",
        "Colour-vision-safe: Okabe-Ito hues, VESTA lightness ordering.",
        "Okabe and Ito 2008, 'Color Universal Design'. No licence stated; the eight colours are a published, freely "
        "usable standard, and colour values are facts.",
    ),
    "hokusai": (
        "Hokusai",
        "Great-wave blues, sienna and sea-green (Hokusai).",
        "MetBrewer by Blake R. Mills, CC0; palettes Hokusai1, Hokusai2, Hokusai3 (Metropolitan Museum works).",
    ),
    "klimt": (
        "Klimt",
        "Jewel tones: rose, ruby, gold, emerald, ultramarine, violet.",
        "MetBrewer, CC0; palette Klimt.",
    ),
    "vangogh": (
        "Van Gogh",
        "Night-sky indigos with sunflower yellows and olive.",
        "MetBrewer, CC0; palettes VanGogh1, VanGogh2.",
    ),
    "renoir": ("Renoir", "Warm skin tones, madder red, deep blues, olive.", "MetBrewer, CC0; palette Renoir."),
    "watercolour": (
        "Watercolour",
        "Diluted washes: ultramarine, cerulean, viridian, sienna, ochre, alizarin.",
        "Anchor hex approximated by eye for this project from pigment names (listed in WATERCOLOUR here); "
        "no external source, not a published palette.",
    ),
    "midcentury": (
        "Mid-century",
        "Mustard, burnt orange, teal, avocado, walnut: 1950s-60s design.",
        "Anchor hex curated by eye for this project (listed in MIDCENTURY here); no external source.",
    ),
}

# ------------------------------------------------------------------ the table: id -> (anchors, knobs)
THEMES: dict[str, tuple[Callable[[], list[tuple[str, str]]], Knobs]] = {
    "modern": (lambda: tw_all(400, 600), Knobs(pull=0.5, o_chroma_min=0.22)),
    "print": (
        lambda: tw_all(500, 700),
        Knobs(pull=0.5, chroma_scale=0.8, o_chroma_min=0.19, backgrounds=("light",)),
    ),
    "dark": (lambda: tw_all(300, 500), Knobs(pull=0.5, backgrounds=("dark",))),
    "pastel": (
        lambda: tw_all(200, 300),
        Knobs(
            pull=0.5, trim=0.0, chroma_scale=0.65, o_chroma_min=0.15, o_lmax=0.74, backgrounds=("light",), bg_min=0.10
        ),
    ),
    "tailwind": (lambda: tw_all(300, 700), Knobs(pull=1, snap=True, o_chroma_min=0.2)),
    "opencolor": (opencolor, Knobs(pull=1, snap=True)),
    "nippon": (nippon, Knobs(pull=1, snap=True)),
    "zhongguo": (zhongguo, Knobs(pull=1, snap=True)),
    "cvd": (lambda: OKABE_ITO, Knobs(pull=1, trim=0, o_chroma_min=0.15)),
    "hokusai": (lambda: metbrewer("Hokusai1", "Hokusai2", "Hokusai3"), Knobs(pull=0.6, o_chroma_min=0.12)),
    "klimt": (lambda: metbrewer("Klimt"), Knobs()),
    "vangogh": (lambda: metbrewer("VanGogh1", "VanGogh2"), Knobs()),
    "renoir": (lambda: metbrewer("Renoir"), Knobs()),
    "watercolour": (lambda: WATERCOLOUR, Knobs(chroma_scale=0.9, trim=0.0, o_chroma_min=0.17)),
    "midcentury": (lambda: MIDCENTURY, Knobs()),
}


def theme_text(theme_id: str) -> str:
    """The text of the theme's file."""
    anchors, knobs = THEMES[theme_id]
    name, description, source = INFO[theme_id]
    record = {
        "id": theme_id,
        "name": name,
        "description": description,
        "source": source,
        "colours": derive(anchors(), knobs),
    }
    return json.dumps(record, indent=2, ensure_ascii=False) + "\n"


def main() -> None:
    for theme_id in THEMES:
        path = OUT / f"{theme_id}.json"
        path.write_text(theme_text(theme_id), encoding="utf-8")
        print(f"wrote {path.relative_to(HERE.parent)}")


if __name__ == "__main__":
    main()
