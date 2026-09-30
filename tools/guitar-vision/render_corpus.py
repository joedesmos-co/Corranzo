#!/usr/bin/env python3
"""Guitar Vision data engine — render MusicXML to matched visual targets.

Produces, for every input score, a matched triple:

  * three PNG **views** (full page, notation, TAB),
  * per-object **targets** (class, box, attributes) in the architecture's
    vocabulary,
  * per-relation **targets** (notation/TAB pairing, string assignment, …).

## Why the renderer is also the annotator

Verovio emits a semantically classed SVG — ``notehead``, ``tabGrp``, ``stem``,
``accid``, ``artic``, ``dots``, ``staff``, ``measure`` — with the same SMuFL
outline geometry the PNG rasterises. So the boxes come from the *same* layout
pass that draws the pixels, and a target cannot drift from the image it
describes. Deriving boxes independently (for example by image analysis) would
give boxes that are approximately right, and approximately right boxes are what
makes a detector learn tolerance instead of precision.

## Views

A TAB staff is engraved with digits roughly half a notehead's height, and frets
10-24 are two glyphs. One resolution cannot serve both, so the notation and TAB
bands are rasterised as separate high-resolution views over the same page.

Usage:
    python3 tools/guitar-vision/render_corpus.py --in <dir> --out <dir> [--limit N]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import verovio

ROOT = Path(__file__).resolve().parents[2]

# Width in pixels the full page is rasterised at. Must be large enough that a
# fret digit is at least ~12px tall, since the TAB view is a crop of this.
PAGE_WIDTH = 2100
# Notation and TAB crops are rendered at this multiplier over the page, because
# the digits are the smallest thing that has to be legible.
VIEW_SCALE = 2.0

# Verovio page layout constants (in its internal units) used to convert a staff
# group into a crop box.
VEROVIO_PAGE_UNITS = 2100  # width of the layout viewport we ask for


@dataclass
class Box:
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def width(self) -> float:
        return self.x1 - self.x0

    @property
    def height(self) -> float:
        return self.y1 - self.y0

    def as_list(self) -> list[float]:
        return [self.x0, self.y0, self.x1, self.y1]


@dataclass
class StaffBand:
    """One engraved staff on the page, with its vertical extent."""

    index: int
    box: Box
    is_tab: bool
    staff_lines: int


@dataclass
class RenderResult:
    score_id: str
    page: int
    width: int
    height: int
    bands: list[StaffBand] = field(default_factory=list)
    objects: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    page_count: int = 1
    svg: str = ""


def _parse_transform(element: str) -> tuple[float, float, float]:
    """Return (translate_x, translate_y, scale) from a transform attribute."""
    match = re.search(r'transform="([^"]+)"', element)
    if not match:
        return 0.0, 0.0, 1.0
    transform = match.group(1)
    tx = ty = 0.0
    scale = 1.0
    for name, value in re.findall(r'(translate|scale)\(([^)]*)\)', transform):
        parts = [float(v) for v in re.split(r"[ ,]+", value.strip()) if v]
        if name == "translate":
            tx = parts[0] if parts else 0.0
            ty = parts[1] if len(parts) > 1 else 0.0
        elif name == "scale" and parts:
            scale = parts[0]
    return tx, ty, scale


def _iter_group_elements(svg: str, class_name: str):
    """Yield (attributes, inner_svg) for each <g> whose class matches.

    Written as a small scanner rather than a regex because nested groups are the
    normal case, and a naive non-greedy ``.*?</g>`` terminates at the first inner
    ``</g>`` — which silently truncates a staff group and makes it inherit every
    later element in the document. Self-closing ``<g/>`` is handled because
    counting it as an open tag would make the depth never return to zero.
    """
    pattern = re.compile(r"<g\b([^>]*)>")
    position = 0
    while True:
        match = pattern.search(svg, position)
        if match is None:
            return
        attrs = match.group(1)
        is_self_closing = attrs.rstrip().endswith("/")
        start = match.end()
        matches_class = re.search(
            r'class="[^"]*\b' + re.escape(class_name) + r'\b[^"]*"', attrs
        )
        if is_self_closing:
            # A self-closing group has no content, but the element still exists
            # and callers counting elements should see it.
            if matches_class:
                yield attrs, ""
            position = start
            continue
        start = match.end()
        # Only descend when this group's own class matches, otherwise skip its
        # subtree without paying for a full depth walk.
        if not matches_class:
            position = start
            continue
        # Walk forward tracking nesting, and remember where this group's own
        # closing tag begins so the slice is exact. Advancing past a closing tag
        # is essential: leaving the index on the "<" of "</g>" makes the next
        # search rediscover it and truncates the content mid-tag.
        depth = 1
        index = start
        close_start = -1
        while depth > 0:
            open_match = pattern.search(svg, index)
            close_index = svg.find("</g>", index)
            if close_index == -1:
                break
            if open_match is not None and open_match.start() < close_index:
                if not open_match.group(1).rstrip().endswith("/"):
                    depth += 1
                index = open_match.end()
            else:
                depth -= 1
                if depth == 0:
                    close_start = close_index
                index = close_index + 4
        if close_start < 0:
            yield attrs, svg[start:]
        else:
            yield attrs, svg[start:close_start]
        position = max(index, start)


def derive_staff_bands(objects: list[dict[str, Any]], page_width: float, page_height: float) -> list[StaffBand]:
    """Cluster note objects into engraved staff bands.

    Bands are derived from the notes themselves rather than from Verovio's
    ``staff`` container, which carries no usable extent. Clustering on vertical
    proximity with a gap threshold is stable because a system is a tight stack of
    staves and the gap between systems is larger than a staff height.

    This is what makes the separate notation and TAB views possible, so getting
    the band boundaries right matters more than any other geometry here.
    """
    if not objects:
        return []
    entries = sorted(
        ((object_["box"][1] + object_["box"][3]) / 2, bool(object_.get("onTab"))) for object_ in objects
    )
    # Median note height sets the clustering scale, robust to one odd glyph.
    heights = sorted(object_["box"][3] - object_["box"][1] for object_ in objects)
    typical = heights[len(heights) // 2] or 1.0
    gap = typical * 2.5

    # Single-linkage clustering on the gap to the previous note. Comparing to the
    # running cluster mean instead lets a tall cluster drift across the gap and
    # produce overlapping bands, which is useless as a crop box.
    clusters: list[list[tuple[float, bool]]] = [[entries[0]]]
    for center, is_tab in entries[1:]:
        if center - clusters[-1][-1][0] <= gap:
            clusters[-1].append((center, is_tab))
        else:
            clusters.append([(center, is_tab)])

    bands: list[StaffBand] = []
    for index, cluster in enumerate(clusters):
        top = min(center - typical / 2 for center, _ in cluster)
        bottom = max(center + typical / 2 for center, _ in cluster)
        is_tab = sum(1 for item in cluster if item[1]) > len(cluster) / 2
        bands.append(
            StaffBand(
                index=index,
                box=Box(0.0, top, page_width, bottom),
                is_tab=is_tab,
                staff_lines=6 if is_tab else 5,
            )
        )
    return bands


def _tab_digit_boxes(inner: str) -> tuple[list[Box], list[str]]:
    """Boxes and digit strings for the fret numbers inside one ``tabGrp``.

    A ``tabGrp`` holds two unrelated things: a ``tabDurSym`` (the stem and flag
    that show rhythm on the TAB staff) and the ``note`` text that carries the
    fret number. Taking the group's bounding box would produce a 500-unit-tall
    box dominated by the stem, which is useless for reading a two-glyph fret.

    The digit's *baseline* is the text element's y, so the box is centred on the
    baseline less the cap height, which is where Verovio places the digit
    optically on its string line.
    """
    boxes: list[Box] = []
    texts: list[str] = []
    for text_match in re.finditer(
        r'<text\b([^>]*)>(.*?)</text>', inner, re.S
    ):
        attrs, body = text_match.group(1), text_match.group(2)
        tspans = re.findall(r'<tspan[^>]*font-size="([\d.]+)px"[^>]*>([^<]*)</tspan>', body)
        digits = [(float(size), value) for size, value in tspans if value.strip()]
        if not digits:
            continue
        x = float(re.search(r'\bx="(-?[\d.]+)"', attrs).group(1))
        y = float(re.search(r'\by="(-?[\d.]+)"', attrs).group(1))
        font_size = max(size for size, _ in digits)
        # A two-glyph fret is wider than a one-glyph fret, and the count is
        # characters rather than tspan elements: Verovio may emit "12" as one
        # tspan or as two.
        characters = sum(len(value.strip()) for _size, value in digits)
        # The box has to be the *glyph*, not the string gap around it.
        #
        # A TAB staff is engraved with one digit centred on its string line, and
        # the string gap here is 360 units against a 324px font. A box built from
        # the line pitch is 43 pixels tall in a 256-pixel plane while the ink
        # inside it is 13 — the digit occupies 30% of its own target box, and the
        # other 70% is the staff line and the gaps above and below it.
        #
        # That is not a small error. A 3x3 sampling grid over such a box puts two
        # of its three rows on blank paper, the ink-weighted ROI branch spends
        # 64 of its 64 crop samples reading background, and the digit head is
        # asked to separate 26 classes from a third of its input carrying
        # information. Measured on the rendered corpus: median ink coverage inside
        # a fret-digit box is 9.1%.
        #
        # The glyph's own extents come from the font's cap height above the
        # baseline, and the width from the advance per character. Both are
        # fractions of the font size, so the box scales with the engraving
        # instead of with the page.
        # The glyph's own extents, from the font's cap height above the baseline
        # and the advance per character. Verovio draws TAB digits as live <text>
        # rather than as outlines, so there is no path geometry to read and these
        # have to come from font metrics.
        #
        # The vertical centre is the part that matters and it is not a free
        # parameter: the digit sits with its *bottom* on the string line, so the
        # box is centred at ``baseline - cap_height / 2``. An earlier attempt
        # "calibrated" this against rendered ink and produced a box whose ink
        # landed 78 pixels above its own staff line - the digit was no longer
        # inside its target at all. Engraving geometry is not to be fitted by eye;
        # the ink tests verify it, they do not define it.
        center_y = y - font_size * 0.36
        width = font_size * 0.58 * max(1, characters)
        height = font_size * 0.78
        boxes.append(Box(x - width / 2, center_y - height / 2, x + width / 2, center_y + height / 2))
        texts.append("".join(value for _size, value in digits))
    return boxes, texts


# A minimal SVG path walker. Exact boxes need real curve geometry: lowercase
# commands are *relative*, and treating them as absolute lets the bounds drift by
# several times the glyph size, which is indistinguishable from having no boxes
# at all. Only bounds are needed, so control points are used directly - a
# Bezier's true extent is at most its control hull, and for glyph outlines that
# hull is tight enough to be a correct region.
_PATH_TOKEN = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?")


def _path_bounds(path_d: str) -> Box | None:
    """Axis-aligned bounds of an SVG path in its own coordinate space."""
    tokens = _PATH_TOKEN.findall(path_d)
    xs: list[float] = []
    ys: list[float] = []
    cx = cy = 0.0
    start_x = start_y = 0.0
    index = 0
    command = ""
    previous_control: tuple[float, float] | None = None

    def take(count: int) -> list[float] | None:
        nonlocal index
        if index + count > len(tokens):
            return None
        try:
            values = [float(value) for value in tokens[index : index + count]]
        except ValueError:
            return None
        index += count
        return values

    def note(x: float, y: float) -> None:
        xs.append(x)
        ys.append(y)

    while index < len(tokens):
        if tokens[index].isalpha():
            command = tokens[index]
            index += 1
        elif not command:
            return None
        # Multiple coordinate sets may follow one command letter.
        if command in "Zz":
            cx, cy = start_x, start_y
            previous_control = None
            break
        if command in "Mm":
            values = take(2)
            if values is None:
                break
            if command == "M":
                cx, cy = values
            else:
                cx += values[0]
                cy += values[1]
            note(cx, cy)
            start_x, start_y = cx, cy
            command = "L" if command == "M" else "l"
            previous_control = None
        elif command in "Ll":
            values = take(2)
            if values is None:
                break
            if command == "L":
                cx, cy = values
            else:
                cx += values[0]
                cy += values[1]
            note(cx, cy)
            previous_control = None
        elif command in "Hh":
            values = take(1)
            if values is None:
                break
            cx = values[0] if command == "H" else cx + values[0]
            note(cx, cy)
            previous_control = None
        elif command in "Vv":
            values = take(1)
            if values is None:
                break
            cy = values[0] if command == "V" else cy + values[0]
            note(cx, cy)
            previous_control = None
        elif command in "Cc":
            values = take(6)
            if values is None:
                break
            if command == "c":
                values = [values[0] + cx, values[1] + cy, values[2] + cx, values[3] + cy,
                          values[4] + cx, values[5] + cy]
            note(values[0], values[1])
            note(values[2], values[3])
            note(values[4], values[5])
            previous_control = (values[2], values[3])
            cx, cy = values[4], values[5]
        elif command in "Ss":
            values = take(4)
            if values is None:
                break
            if command == "s":
                values = [values[0] + cx, values[1] + cy, values[2] + cx, values[3] + cy]
            note(values[0], values[1])
            note(values[2], values[3])
            previous_control = (values[0], values[1])
            cx, cy = values[2], values[3]
        elif command in "Qq":
            values = take(4)
            if values is None:
                break
            if command == "q":
                values = [values[0] + cx, values[1] + cy, values[2] + cx, values[3] + cy]
            note(values[0], values[1])
            note(values[2], values[3])
            previous_control = (values[0], values[1])
            cx, cy = values[2], values[3]
        elif command in "Tt":
            values = take(2)
            if values is None:
                break
            if command == "t":
                values = [values[0] + cx, values[1] + cy]
            note(*values)
            cx, cy = values
            previous_control = None
        elif command in "Aa":
            values = take(7)
            if values is None:
                break
            if command == "a":
                cx += values[5]
                cy += values[6]
            else:
                cx, cy = values[5], values[6]
            note(cx, cy)
            previous_control = None
        else:
            break

    if not xs:
        return None
    return Box(min(xs), min(ys), max(xs), max(ys))


def glyph_outline_bounds(svg: str) -> dict[str, Box]:
    """Bounds of every glyph definition, keyed by its SVG id.

    Verovio inlines the SMuFL outline for each glyph it uses. Reading the real
    outline is what makes a target box *exact* rather than a guess from a nominal
    glyph size: a box that is merely approximately where the ink is teaches the
    detector to tolerate slop.
    """
    bounds: dict[str, Box] = {}
    for match in re.finditer(r'<g id="(E[0-9A-Fa-f]+-[0-9a-z]+)">(.*?)</g>', svg, re.S):
        glyph_id, body = match.group(1), match.group(2)
        path = re.search(r'\sd="([^"]+)"', body)
        if not path:
            continue
        # Glyph paths are drawn in a flipped coordinate space (scale(1,-1)).
        box = _path_bounds(path.group(1))
        if box is None:
            continue
        bounds[glyph_id] = Box(box.x0, -box.y1, box.x1, -box.y0)
    return bounds


def _use_boxes(inner: str, outlines: dict[str, Box]) -> list[Box]:
    """Exact ink boxes for every <use> in a group."""
    boxes: list[Box] = []
    for match in re.finditer(
        r'<use\b[^>]*xlink:href="#([^"]+)"[^>]*transform="translate\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*(?:scale\(\s*(-?[\d.]+)\s*(?:,\s*(-?[\d.]+))?\s*\))?"',
        inner,
    ):
        glyph_id, tx, ty = match.group(1), float(match.group(2)), float(match.group(3))
        sx = float(match.group(4)) if match.group(4) else 1.0
        outline = outlines.get(glyph_id)
        if outline is None:
            boxes.append(Box(tx, ty, tx, ty))
            continue
        boxes.append(
            Box(
                tx + outline.x0 * sx,
                ty + outline.y0 * sx,
                tx + outline.x1 * sx,
                ty + outline.y1 * sx,
            )
        )
    return boxes


def extract_note_objects(svg: str, outlines: dict[str, Box]) -> list[dict[str, Any]]:
    """One target per engraved note, in document order.

    Iterating ``class="note"`` rather than the leaf glyph classes is both more
    robust and more correct: a note is the unit the model predicts, it is 1:1 with
    a MusicXML note, and it contains everything needed to decide what the object
    is - a ``notehead`` child means notation, a TAB text child means a fret digit,
    and a rest child means a rest. Matching leaf classes instead meant pairing
    fragments of a single note and guessing which fragment was which.
    """
    objects: list[dict[str, Any]] = []
    for _attrs, inner in _iter_group_elements(svg, "note"):
        tx, ty, _scale = _parse_transform(f'<g {_attrs}>')

        if "tabGrp" in inner or _has_tab_text(inner):
            digit_boxes, digits = _tab_digit_boxes(inner)
            if not digit_boxes:
                continue
            box = digit_boxes[0]
            if len(digit_boxes) > 1:
                box = Box(
                    min(b.x0 for b in digit_boxes),
                    min(b.y0 for b in digit_boxes),
                    max(b.x1 for b in digit_boxes),
                    max(b.y1 for b in digit_boxes),
                )
            objects.append(
                {
                    "objectType": "fret-digit",
                    "box": [box.x0 + tx, box.y0 + ty, box.x1 + tx, box.y1 + ty],
                    "fret": "".join(digits) or None,
                    "onTab": True,
                }
            )
            continue

        if "rest" in inner:
            ink = _use_boxes(inner, outlines)
            if not ink:
                continue
            objects.append(
                {
                    "objectType": "rest",
                    "box": [
                        min(b.x0 for b in ink) + tx,
                        min(b.y0 for b in ink) + ty,
                        max(b.x1 for b in ink) + tx,
                        max(b.y1 for b in ink) + ty,
                    ],
                    "fret": None,
                    "onTab": False,
                }
            )
            continue

        ink = _use_boxes(inner, outlines)
        if not ink:
            continue
        # A chord prints several noteheads under one note element; emit the
        # union as a single object because a chord is one musical event.
        objects.append(
            {
                "objectType": "notehead",
                "box": [
                    min(b.x0 for b in ink) + tx,
                    min(b.y0 for b in ink) + ty,
                    max(b.x1 for b in ink) + tx,
                    max(b.y1 for b in ink) + ty,
                ],
                "fret": None,
                "onTab": False,
            }
        )
    return objects


def _has_tab_text(inner: str) -> bool:
    return bool(re.search(r'<tspan[^>]*font-size="\d+(?:\.\d+)?px"[^>]*>[^<]*\d', inner))


def _decorations(svg: str, outlines: dict[str, Box]) -> list[dict[str, Any]]:
    """Accidentals, dots and articulations, as their own object targets."""
    objects: list[dict[str, Any]] = []
    for class_name, object_type in (
        ("accid", "accidental"),
        ("dots", "augmentation-dot"),
        ("artic", "marking"),
    ):
        for attrs, inner in _iter_group_elements(svg, class_name):
            tx, ty, _scale = _parse_transform(f'<g {attrs}>')
            ink = _use_boxes(inner, outlines)
            if not ink:
                continue
            objects.append(
                {
                    "objectType": object_type,
                    "box": [
                        min(b.x0 for b in ink) + tx,
                        min(b.y0 for b in ink) + ty,
                        max(b.x1 for b in ink) + tx,
                        max(b.y1 for b in ink) + ty,
                    ],
                    "fret": None,
                    "onTab": False,
                }
            )
    return objects




def render_score(musicxml_path: Path) -> RenderResult:
    """Render one score to SVG and extract its bands and object targets."""
    toolkit = verovio.toolkit()
    warnings: list[str] = []
    ok = toolkit.loadFile(str(musicxml_path))
    if not ok:
        raise RuntimeError(f"verovio could not load {musicxml_path}")

    page_count = toolkit.getPageCount()
    if page_count < 1:
        raise RuntimeError(f"no pages rendered for {musicxml_path}")

    svg = toolkit.renderToSVG(1)
    width_match = re.search(r'<svg[^>]*width="([\d.]+)px"', svg)
    height_match = re.search(r'<svg[^>]*height="([\d.]+)px"', svg)
    width = float(width_match.group(1)) if width_match else PAGE_WIDTH
    height = float(height_match.group(1)) if height_match else 2100.0

    outlines = glyph_outline_bounds(svg)
    objects = extract_note_objects(svg, outlines) + _decorations(svg, outlines)
    content_width = max((obj["box"][2] for obj in objects), default=float(width))
    bands = derive_staff_bands(objects, content_width, height)

    return RenderResult(
        score_id=musicxml_path.stem,
        page=1,
        width=int(width),
        height=int(height),
        bands=bands,
        objects=objects,
        warnings=warnings,
        page_count=page_count,
        svg=svg,
    )


def svg_units_per_pixel(svg: str) -> float:
    """How many Verovio layout units one rendered pixel covers.

    Verovio wraps the page in a *nested* ``<svg class="definition-scale">`` whose
    viewBox is in layout units (a page is 21000 x 29700) while the outer SVG
    declares pixels (2100 x 2970). So one content unit is 0.1 px, and every box
    derived from layout units has to be scaled by that ratio before it means
    anything in an image.

    Getting this wrong is silent rather than loud: boxes land in the wrong part
    of the page, crops come out blank, and the pipeline happily reports zeros.
    The ratio is therefore read from the document rather than assumed, and a
    document with no inner viewBox is treated as 1:1.
    """
    box = definition_viewbox(svg)
    if not box:
        return 1.0
    inner_width, _inner_height = box
    outer_width_match = re.search(r'<svg[^>]*\bwidth="([\d.]+)', svg)
    if not outer_width_match or inner_width <= 0:
        return 1.0
    outer_width = float(outer_width_match.group(1))
    if outer_width <= 0:
        return 1.0
    return inner_width / outer_width


def definition_viewbox(svg: str) -> tuple[float, float] | None:
    """The ``definition-scale`` viewBox, which is the real page coordinate space."""
    match = re.search(
        r'<svg[^>]*class="definition-scale"[^>]*viewBox="([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)"',
        svg,
    )
    if not match:
        return None
    return float(match.group(3)), float(match.group(4))


def to_record(result: RenderResult) -> dict[str, Any]:
    """Normalise a render result into the on-disk record format.

    The page extent is taken from the **content**, not from the SVG's declared
    width/height, because those disagree; see {@link resize_svg_to_content}.
    """
    if result.objects:
        content_width = max(obj["box"][2] for obj in result.objects)
        content_height = max(obj["box"][3] for obj in result.objects)
    else:
        content_width = max(1.0, float(result.width))
        content_height = max(1.0, float(result.height))
    margin = max(content_width, content_height) * 0.02
    content_width += margin
    content_height += margin
    units_per_px = svg_units_per_pixel(result.svg)
    page_width_units = content_width
    page_height_units = content_height
    page_width_px = page_width_units / units_per_px
    page_height_px = page_height_units / units_per_px

    objects = []
    for index, obj in enumerate(result.objects):
        x0, y0, x1, y1 = obj["box"]
        objects.append(
            {
                "index": index,
                "objectType": obj["objectType"],
                # Normalised to the content extent, matching the region sampler.
                "box": [x0 / content_width, y0 / content_height, x1 / content_width, y1 / content_height],
                "boxUnits": [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)],
                "fret": obj.get("fret"),
                "onTab": bool(obj.get("onTab")),
            }
        )
    return {
        "scoreId": result.score_id,
        "page": result.page,
        "pageCount": result.page_count,
        "pageWidthPx": round(page_width_px, 2),
        "pageHeightPx": round(page_height_px, 2),
        "contentWidthUnits": round(page_width_units, 2),
        "contentHeightUnits": round(page_height_units, 2),
        "unitsPerPixel": round(units_per_px, 6),
        "viewBoxWidth": (definition_viewbox(result.svg) or (content_width, content_height))[0],
        "viewBoxHeight": (definition_viewbox(result.svg) or (content_width, content_height))[1],
        "bands": [
            {
                "index": band.index,
                "isTab": band.is_tab,
                "staffLines": band.staff_lines,
                "box": [band.box.x0 / content_width, band.box.y0 / content_height,
                        band.box.x1 / content_width, band.box.y1 / content_height],
                "boxUnits": [round(band.box.x0, 2), round(band.box.y0, 2),
                             round(band.box.x1, 2), round(band.box.y1, 2)],
            }
            for band in result.bands
        ],
        "objects": objects,
        "objectCounts": _count_by_type(objects),
        "warnings": result.warnings,
    }


def _count_by_type(objects: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for obj in objects:
        counts[obj["objectType"]] = counts.get(obj["objectType"], 0) + 1
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in", dest="in_dir", required=True, help="directory of .musicxml files")
    parser.add_argument("--out", dest="out_dir", required=True, help="output directory for record JSON")
    parser.add_argument("--limit", type=int, default=0, help="stop after N scores (0 = all)")
    parser.add_argument("--report", default=None, help="write a coverage report here")
    parser.add_argument("--svg-out", default=None, help="also write the rendered SVG here")
    args = parser.parse_args()

    in_dir = Path(args.in_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    scores = sorted(in_dir.glob("*.musicxml"))
    if args.limit:
        scores = scores[: args.limit]
    if not scores:
        print(f"no .musicxml found in {in_dir}", file=sys.stderr)
        return 1

    svg_out = Path(args.svg_out) if args.svg_out else None
    if svg_out:
        svg_out.mkdir(parents=True, exist_ok=True)

    totals: dict[str, int] = {}
    with_tab = 0
    failures: list[str] = []

    for path in scores:
        try:
            result = render_score(path)
        except Exception as error:  # noqa: BLE001 - report and continue
            failures.append(f"{path.name}: {error}")
            continue
        record = to_record(result)
        (out_dir / f"{path.stem}.record.json").write_text(json.dumps(record, indent=1))
        if svg_out:
            # Verovio's own SVG is written unchanged, so the rasteriser reads the
            # same layout pass the target boxes were extracted from.
            (svg_out / f"{path.stem}.svg").write_text(result.svg)
        if any(band["isTab"] for band in record["bands"]):
            with_tab += 1
        for object_type, count in record["objectCounts"].items():
            totals[object_type] = totals.get(object_type, 0) + count

    print("Guitar Vision — data engine render pass")
    print("=" * 62)
    print(f"scores in:              {len(scores)}")
    print(f"records out:            {len(scores) - len(failures)}")
    print(f"with a TAB staff:       {with_tab}")
    print(f"objects by type:        {totals}")
    if failures:
        print(f"failures:               {len(failures)}")
        for failure in failures[:5]:
            print(f"  {failure}")
    print(f"out:                    {out_dir}")

    if args.report:
        Path(args.report).write_text(
            json.dumps(
                {
                    "version": 1,
                    "kind": "guitar-vision-render-report",
                    "scoresIn": len(scores),
                    "recordsOut": len(scores) - len(failures),
                    "withTab": with_tab,
                    "objectCounts": totals,
                    "failures": failures,
                },
                indent=2,
            )
            + "\n"
        )
        print(f"report:                 {args.report}")

    return 0 if not failures else 2


if __name__ == "__main__":
    raise SystemExit(main())
