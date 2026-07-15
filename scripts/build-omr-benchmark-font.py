#!/usr/bin/env python3
"""Build the tiny CC0 SMuFL-compatible font used by OMR benchmark PDFs.

The generated font deliberately implements only the glyphs used by the
benchmark corpus. Its outlines are simple, original geometric shapes. The PUA
code points follow SMuFL so PDF.js exposes the same text-layer semantics as a
modern notation engraver without redistributing a third-party music font.

Requires fonttools (`python -m pip install fonttools`). The generated TTF is
vendored, so ordinary corpus generation does not need fonttools.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = (
    ROOT
    / "benchmarks"
    / "omr-fixtures"
    / "font"
    / "CorranzoBenchmarkMusic.ttf"
)

CHARACTERS = {
    0xE050: "gClef",
    0xE062: "fClef",
    0xE083: "timeSig3",
    0xE084: "timeSig4",
    0xE0A2: "noteheadWhole",
    0xE0A3: "noteheadHalf",
    0xE0A4: "noteheadBlack",
    0xE260: "accFlat",
    0xE261: "accNatural",
    0xE262: "accSharp",
    0xE4A0: "articStaccato",
    0xE4A3: "articAccent",
    0xE4E3: "restWhole",
    0xE4E4: "restHalf",
    0xE4E6: "restEighth",
    0xE4E7: "rest16th",
}


def polygon(points: list[tuple[int, int]]):
    pen = TTGlyphPen(None)
    pen.moveTo(points[0])
    for point in points[1:]:
        pen.lineTo(point)
    pen.closePath()
    return pen.glyph()


def empty_glyph():
    return TTGlyphPen(None).glyph()


def glyphs():
    return {
        ".notdef": polygon([(50, 0), (550, 0), (550, 700), (50, 700)]),
        "space": empty_glyph(),
        "noteheadBlack": polygon(
            [(60, 250), (150, 100), (420, 120), (560, 260), (470, 410), (200, 390)]
        ),
        "noteheadHalf": polygon(
            [(60, 250), (150, 100), (420, 120), (560, 260), (470, 410), (200, 390)]
        ),
        "noteheadWhole": polygon(
            [(30, 250), (130, 80), (500, 100), (610, 250), (510, 420), (140, 400)]
        ),
        "gClef": polygon(
            [(250, -100), (100, 100), (170, 500), (390, 780), (500, 600), (300, 300), (440, 80)]
        ),
        "fClef": polygon([(80, 150), (220, 100), (420, 300), (250, 520), (80, 450)]),
        "restWhole": polygon([(80, 250), (500, 250), (500, 390), (80, 390)]),
        "restHalf": polygon([(80, 150), (500, 150), (500, 300), (80, 300)]),
        "restEighth": polygon([(250, 0), (360, 300), (150, 420), (450, 650), (360, 300)]),
        "rest16th": polygon([(240, 0), (350, 300), (120, 430), (430, 650), (330, 350), (100, 550)]),
        "timeSig4": polygon(
            [(420, 0), (420, 700), (310, 700), (70, 250), (70, 160), (520, 160), (520, 280), (220, 280), (420, 620)]
        ),
        "timeSig3": polygon(
            [(80, 620), (450, 700), (540, 520), (350, 350), (530, 160), (430, -10), (80, 60), (160, 190), (350, 140), (380, 250), (220, 310), (220, 400), (390, 470), (360, 580), (150, 520)]
        ),
        "accFlat": polygon([(200, 0), (200, 700), (300, 700), (300, 400), (500, 480), (520, 250), (300, 100)]),
        "accNatural": polygon(
            [(180, 0), (180, 700), (280, 700), (280, 400), (440, 450), (440, 700), (540, 700), (540, 0), (440, 0), (440, 300), (280, 250), (280, 0)]
        ),
        "accSharp": polygon(
            [(120, 150), (560, 250), (560, 350), (120, 250), (120, 450), (560, 550), (560, 650), (120, 550), (220, 0), (320, 0), (320, 700), (420, 700), (420, 0), (320, 0)]
        ),
        "articStaccato": polygon([(200, 200), (300, 100), (400, 200), (300, 300)]),
        "articAccent": polygon([(80, 100), (520, 300), (80, 500), (80, 400), (380, 300), (80, 200)]),
    }


def build_font(output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    order = [".notdef", "space", *CHARACTERS.values()]
    builder = FontBuilder(1000, isTTF=True)
    builder.setupGlyphOrder(order)
    builder.setupCharacterMap({32: "space", **CHARACTERS})
    builder.setupGlyf(glyphs())
    builder.setupHorizontalMetrics({name: (700, 0) for name in order})
    builder.setupHorizontalHeader(ascent=850, descent=-250)
    builder.setupNameTable(
        {
            "familyName": "Corranzo Benchmark Music",
            "styleName": "Regular",
            "uniqueFontIdentifier": "CorranzoBenchmarkMusic-Regular-1",
            "fullName": "Corranzo Benchmark Music Regular",
            "psName": "CorranzoBenchmarkMusic-Regular",
            "version": "Version 1.0",
        }
    )
    builder.setupOS2(
        sTypoAscender=850,
        sTypoDescender=-250,
        usWinAscent=850,
        usWinDescent=250,
    )
    builder.setupPost()
    builder.setupMaxp()
    builder.save(output)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    build_font(args.out.resolve())
    print(f"Wrote {args.out.resolve()}")


if __name__ == "__main__":
    main()
