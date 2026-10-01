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

# White margin, in canonical page units, added around a band to become the crop
# that the rasteriser cuts. Recorded into the record as ``bands[].cropUnits`` so
# the loader and the rasteriser agree on where the crop begins without either of
# them re-deriving the other's padding.
VIEW_PADDING_UNITS = 40

# --------------------------------------------------------------------------
# The content transform: layout units -> canonical page units
# --------------------------------------------------------------------------
#
# ## The coordinate spaces, and why there is more than one
#
# 1. **Verovio layout units.** The numbers written in the SVG: staff paths,
#    ``<text x y>``, note positions. The page grid is 21000 x 29700.
# 2. **Canonical page units.** Layout units after the document's own content
#    transform. *This is the canonical frame*: every ``boxUnits``, every
#    ``band.boxUnits`` and every ``band.cropUnits`` in a record lives here, and
#    every consumer - the rasteriser and the loader - works in it.
# 3. **Page raster pixels.** ``canonical * (render_width / viewBoxWidth)``. The
#    nested ``definition-scale`` viewBox supplies that ratio, not an offset.
# 4. **View crop-local pixels.** Page pixels minus the crop's origin.
# 5. **Trimmed, then resized, then plane coordinates**, then ROI coordinates.
#
# ## Why the transform has to be read, not assumed
#
# Verovio wraps the engraved content in ``<g class="page-margin"
# transform="translate(500, 500)">`` - the page margin. That translate is part of
# the document, so it is applied when the browser renders the page, but it is not
# applied to any coordinate *written into the record*. Every box and every band
# was therefore in space 1 while every pixel was in space 3, and the two differ by
# the wrapper transform.
#
# The cost was not subtle and was not a rounding error: the crop was cut 500 units
# (100 crop pixels) up and left of where the band said the content was, so every
# box landed hundreds of pixels from its glyph and the lowest digits fell outside
# the crop entirely. Measured over 180 fixtures: FINAL_ROI target signal was zero
# in 113 of 113, and a third of the targets had no pixels in the TAB view at all.
#
# So the transform is *composed from the document* rather than hardcoded as
# ``+500``: the ancestor chain of a real engraved element is walked and its
# transforms multiplied together. A different margin, an added scale, a matrix, or
# another nesting level all compose correctly, and the transforms inside
# ``<defs>`` - where glyph outlines carry their own ``scale(1,-1)`` - are never
# picked up, because nothing in the content is descended from them.

_IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)

# Start tags, end tags and self-closing tags. Attribute values may contain '>'
# inside quotes, which a naive pattern would mis-split, so both quote styles are
# consumed explicitly.
_SVG_TAG = re.compile(
    r"""<(/?)([a-zA-Z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(/?)>""", re.S
)


def _affine_multiply(outer: tuple[float, ...], inner: tuple[float, ...]) -> tuple[float, ...]:
    """Compose two 2-D affine matrices, ``outer`` applied after ``inner``."""
    a1, b1, c1, d1, e1, f1 = outer
    a2, b2, c2, d2, e2, f2 = inner
    return (
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1,
        b1 * e2 + d1 * f2 + f1,
    )


def _first_number(text: str) -> float:
    match = re.match(r"\s*(-?[\d.]+(?:[eE][-+]?\d+)?)", text)
    if not match:
        raise ValueError(f"no number in transform argument {text!r}")
    return float(match.group(1))


def parse_transform(value: str | None) -> tuple[float, ...]:
    """An SVG ``transform`` list as one affine.

    ``translate``, ``scale``, ``matrix``, ``rotate``, ``skewX`` and ``skewY`` are
    supported, applied left to right as the specification requires. An unknown
    function is skipped rather than guessed at, so an unrecognised transform
    cannot silently become a wrong number.
    """
    result = _IDENTITY
    if not value:
        return result
    for name, body in re.findall(r"([a-zA-Z]+)\s*\(([^)]*)\)", value):
        parts = [part for part in re.split(r"[,\s]+", body.strip()) if part]
        try:
            args = [_first_number(part) for part in parts]
        except ValueError:
            continue
        if name == "translate" and args:
            step = (1.0, 0.0, 0.0, 1.0, args[0], args[1] if len(args) > 1 else 0.0)
        elif name == "scale" and args:
            step = (args[0], 0.0, 0.0, args[1] if len(args) > 1 else args[0], 0.0, 0.0)
        elif name == "matrix" and len(args) >= 6:
            step = tuple(args[:6])
        elif name == "rotate" and args:
            angle = math.radians(args[0])
            cos, sin = math.cos(angle), math.sin(angle)
            step = (cos, sin, -sin, cos, 0.0, 0.0)
        elif name == "skewX" and args:
            step = (1.0, 0.0, math.tan(math.radians(args[0])), 1.0, 0.0, 0.0)
        elif name == "skewY" and args:
            step = (1.0, math.tan(math.radians(args[0])), 0.0, 1.0, 0.0, 0.0)
        else:
            continue
        result = _affine_multiply(result, step)
    return result


def content_transform(svg: str, probe_class: str = "staff") -> tuple[float, ...]:
    """The affine taking a content coordinate to a canonical page coordinate.

    Found by walking the document and composing the ``transform`` attributes on
    the *ancestor chain* of a real engraved element - the first ``class="staff"``
    group. Nothing is matched by shape, so the margin can be a translate, a scale,
    a matrix or any nesting of them, and a rename of the wrapper class does not
    matter.

    A document whose content is not transformed yields the identity, so this is
    safe to apply unconditionally rather than as a special case.
    """
    stack: list[tuple[float, ...]] = []
    for match in _SVG_TAG.finditer(svg):
        closing, _tag, attrs, self_closing = match.groups()
        if closing:
            if stack:
                stack.pop()
            continue
        transform = re.search(r'\btransform="([^"]*)"', attrs or "")
        step = parse_transform(transform.group(1) if transform else None)
        composed = _affine_multiply(stack[-1], step) if stack else step
        if probe_class in (attrs or ""):
            return composed
        if not self_closing:
            stack.append(composed)
    return _IDENTITY


def apply_transform(matrix: tuple[float, ...], x: float, y: float) -> tuple[float, float]:
    """Map one point through an affine."""
    a, b, c, d, e, f = matrix
    return (a * x + c * y + e, b * x + d * y + f)


def transform_box(
    matrix: tuple[float, ...], box: tuple[float, float, float, float]
) -> tuple[float, float, float, float]:
    """Map a box through an affine, keeping it axis-aligned.

    All four corners are mapped and re-bounded rather than mapping two of them,
    so a transform with a rotation or a shear still yields the box that actually
    encloses the geometry instead of a smaller one that does not.
    """
    x0, y0, x1, y1 = box
    corners = [
        apply_transform(matrix, x, y)
        for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))
    ]
    xs = [point[0] for point in corners]
    ys = [point[1] for point in corners]
    return (min(xs), min(ys), max(xs), max(ys))


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


def svg_staff_extents(svg: str) -> list[tuple[float, float, bool]]:
    """Vertical extent of every staff the engraver actually drew.

    Returns ``(top, bottom, is_tab)`` per ``class="staff"`` group, measured from the
    coordinates inside the group, and grouped across systems: a score with two
    systems yields two entries per kind.

    ## Why this and not a note-derived band

    A band is the crop rectangle for a whole view, so it has to span the entire
    staff - six lines for TAB, five for notation. Deriving it from the notes on the
    staff cannot work, and did not:

      - spanning the notes' own extent covers only the strings that happen to be
        used. A generated score played on strings 1-3 produces a three-line band
        for a six-line staff.
      - padding by a median note height cannot work either. A TAB staff spaces its
        digits a full line gap apart, so a band padded by half a note height
        reaches about three of six lines.

    Either way the crop is short, the digit boxes are placed in page coordinates by
    the engraver, and they fall outside the crop they belong to. Measured: a TAB
    crop held 3 staff lines instead of 6, and 96% of the ROI crop's sample points
    had no ink under them - which reads as "the model cannot see the glyph" and is
    in fact "the crop does not contain the glyph".

    The engraver already knows where the staff is, so it is read rather than
    inferred. A staff group is classified as TAB by whether it contains the
    ``tabGrp`` class, which is what the engraver uses for that distinction.
    """
    extents: list[tuple[float, float, bool]] = []
    for body in _iter_groups(svg, "staff"):
        values = [
            float(value)
            for value in re.findall(r'\b(?:y|y1|y2|cy)="(-?[\d.]+)"', body)
        ]
        if not values:
            continue
        extents.append((min(values), max(values), "tabGrp" in body))
    # Only TAB extents are taken from the SVG, and only the tallest of them.
    #
    # A TAB staff is engraved as a *vertical stack of staff groups* - one per
    # system position - so a score yields several, and they nest, and a depth
    # scan reports overlapping spans of which only the largest is the staff. The
    # notation staff, by contrast, draws its five lines as a single element with
    # no usable y attributes, so it never yields a value here at all.
    #
    # So TAB is taken from the engraver - the one case where the note-derived span
    # is provably wrong, since it can only cover the strings in use - and notation
    # is padded from its own noteheads by a line gap, which is enough because a
    # notehead is half a gap tall and sits within one gap of its line.
    tab_spans = [span for span in extents if span[2]]
    if tab_spans:
        # The tightest span that still contains every other span. The engraver
        # emits one group per string position and they nest, so the outermost is
        # the *system* - notation staff plus TAB staff - and would crop both views
        # to the same rectangle. The innermost complete span is the TAB staff.
        top = max(span[0] for span in tab_spans)
        bottom = min(span[1] for span in tab_spans)
        if bottom > top:
            return [(top, bottom, True)]
    return []


def _iter_groups(svg: str, wanted_class: str):
    """Yield the body of each ``<g class="wanted_class">`` element.

    Scanned with a depth counter rather than a non-greedy regex. A regex stops at
    the first ``</g>``, which for a staff containing nested groups - a layer, a
    clef, a note - returns a fragment ending mid-tree. That is how the notation
    staff went missing entirely: 8 staff elements exist in a typical score, and a
    naive pattern found 1.
    """
    open_tag = re.compile(r'<g\b[^>]*>')
    for match in re.finditer(r'<g\b[^>]*class="([^"]*)"[^>]*>', svg):
        classes = match.group(1)
        if wanted_class not in classes.split():
            continue
        depth = 1
        cursor = match.end()
        while depth and cursor < len(svg):
            nxt_open = open_tag.search(svg, cursor)
            nxt_close = svg.find("</g>", cursor)
            if nxt_close == -1:
                break
            if nxt_open is not None and nxt_open.start() < nxt_close:
                depth += 1
                cursor = nxt_open.end()
                continue
            depth -= 1
            cursor = nxt_close + 4
            if depth == 0:
                yield svg[match.end() : nxt_close]
                break


def derive_staff_bands(
    objects: list[dict[str, Any]],
    page_width: float,
    page_height: float,
    svg: str = "",
) -> tuple[list[StaffBand], list[str]]:
    bands: list[StaffBand] = []
    extents = svg_staff_extents(svg) if svg else []
    if extents:
        # Widen the engraver's span to cover every digit on the staff.
        #
        # The SVG's nested staff groups describe the *used* portion of the staff,
        # not all six lines: the innermost complete span started below the topmost
        # engraved digit, and a band that starts below a digit puts that digit
        # outside its own crop. The band's contract is that it contains the objects
        # it is a crop for, so the digit boxes - which are in the same coordinate
        # frame - bound it as well.
        for obj in objects:
            if not obj.get("onTab"):
                continue
            extents = [
                (min(top, obj["box"][1]), max(bottom, obj["box"][3]), is_tab)
                for top, bottom, is_tab in extents
            ]
        for index, (top, bottom, is_tab) in enumerate(extents):
            bands.append(
                StaffBand(
                    index=index,
                    box=Box(0.0, top, page_width, bottom),
                    is_tab=is_tab,
                    staff_lines=6 if is_tab else 5,
                )
            )
        return bands, []
    # No staff groups found - a score with no music on it, or an engraver that
    # groups differently. Fall back to clustering the notes, which at least yields
    # usable boxes, and say so, because a band derived this way does not cover the
    # whole staff and every crop made from it is short.
    return _clustered_bands(objects, page_width)


def _clustered_bands(
    objects: list[dict[str, Any]], page_width: float
) -> tuple[list[StaffBand], list[str]]:
    """Cluster note objects into engraved staff bands.

    Bands are derived from the notes themselves rather than from Verovio's
    ``staff`` container, whose extent is not recoverable for every score. Clustering
    on vertical proximity with a gap threshold is stable because a system is a tight
    stack of staves and the gap between systems is larger than a staff height.

    This is what makes the separate notation and TAB views possible, so getting
    the band boundaries right matters more than any other geometry here. Two rules
    below are load-bearing, and both were found by a digit sitting outside its own
    crop rather than by reading the code:

    - only **positive** centre-to-centre steps count as a line spacing. A notehead
      and its digit share a centre, and two digits on one string do too; taking the
      minimum step including those zeros set the padding to zero and left every band
      flush with its outermost centres.
    - a band is then widened to contain the boxes of the objects **it was clustered
      from**. The contract is that a band contains the objects it is a crop for, and
      padding from centres by half a gap does not deliver it: the outermost glyph is
      taller than half its own centre step, so the first and last digit of a staff
      fell outside the view. Measured on this corpus, that was 86 layout units and
      250 of 1162 fret digits.

    Both rules are arithmetic on the same coordinate frame the objects are already
    in, so neither introduces a padding guess.
    """
    warnings = [
        "no staff elements found in the SVG; bands fall back to clustering the "
        "notes"
    ]
    if not objects:
        return [], warnings

    # Median object height sets the clustering scale, robust to one odd glyph.
    heights = sorted(o["box"][3] - o["box"][1] for o in objects)
    typical = heights[len(heights) // 2] or 1.0
    clustering_gap = typical * 2.5

    # Single-linkage clustering on the gap to the previous object's centre.
    # Comparing to a running mean instead lets a tall cluster drift across the gap
    # and produce overlapping bands, which is useless as a crop box. Indices are
    # carried so a band can later be widened by exactly the objects it came from.
    order = sorted(
        range(len(objects)), key=lambda i: (objects[i]["box"][1] + objects[i]["box"][3]) / 2
    )
    clusters: list[list[int]] = [[order[0]]]
    for index in order[1:]:
        centre = (objects[index]["box"][1] + objects[index]["box"][3]) / 2
        previous = clusters[-1][-1]
        previous_centre = (objects[previous]["box"][1] + objects[previous]["box"][3]) / 2
        if centre - previous_centre <= clustering_gap:
            clusters[-1].append(index)
        else:
            clusters.append([index])

    bands: list[StaffBand] = []
    for index, cluster in enumerate(clusters):
        members = [objects[i] for i in cluster]
        is_tab = sum(1 for o in members if o.get("onTab")) > len(members) / 2
        centres = sorted((o["box"][1] + o["box"][3]) / 2 for o in members)
        # Line spacing, from adjacent centres on adjacent staff positions. Zeros are
        # excluded: two objects sharing a centre is not a spacing.
        steps = [b - a for a, b in zip(centres, centres[1:]) if b - a > 1e-6]
        spacing = min(steps) if steps else typical
        top = min(o["box"][1] for o in members)
        bottom = max(o["box"][3] for o in members)
        bands.append(
            StaffBand(
                index=index,
                box=Box(
                    0.0,
                    min(centres[0] - spacing / 2, top),
                    page_width,
                    max(centres[-1] + spacing / 2, bottom),
                ),
                is_tab=is_tab,
                staff_lines=6 if is_tab else 5,
            )
        )
    return bands, warnings


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
    bands, band_warnings = derive_staff_bands(objects, content_width, height, svg)
    warnings.extend(band_warnings)

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
    # The document's own content transform, composed from the SVG rather than
    # assumed. Everything written into this record is mapped through it, so the
    # record and the rasterised page agree about where the page origin is. See the
    # coordinate-space notes above the transform helpers.
    transform = content_transform(result.svg)

    # Objects and bands are transformed *first*, and the content extent is then
    # measured on the canonical geometry. Measuring the extent first and adding a
    # margin afterwards would leave the normalised `box` fields in the old frame.
    canonical_objects = [
        (obj, transform_box(transform, tuple(obj["box"]))) for obj in result.objects
    ]
    canonical_bands = [
        (band, transform_box(transform, (band.box.x0, band.box.y0, band.box.x1, band.box.y1)))
        for band in result.bands
    ]
    if canonical_objects:
        content_width = max(box[2] for _obj, box in canonical_objects)
        content_height = max(box[3] for _obj, box in canonical_objects)
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
    for index, (obj, (x0, y0, x1, y1)) in enumerate(canonical_objects):
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

    # Each band also records the padded rectangle the rasteriser will cut. The
    # loader frames a view by this rectangle rather than by the band, which is what
    # makes a box's fraction of the view image exactly its fraction of the trimmed
    # content - the inset composition and the tiling then need no correction.
    bands = []
    for band, (x0, y0, x1, y1) in canonical_bands:
        bands.append(
            {
                "index": band.index,
                "isTab": band.is_tab,
                "staffLines": band.staff_lines,
                "box": [x0 / content_width, y0 / content_height, x1 / content_width, y1 / content_height],
                "boxUnits": [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)],
                "cropUnits": [
                    round(x0 - VIEW_PADDING_UNITS, 2),
                    round(y0 - VIEW_PADDING_UNITS, 2),
                    round(x1 + VIEW_PADDING_UNITS, 2),
                    round(y1 + VIEW_PADDING_UNITS, 2),
                ],
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
        "bands": bands,
        # Recorded so the transform applied to every box above is auditable without
        # re-parsing the SVG, and so a mismatch is diagnosable rather than inferred.
        "contentTransform": {
            "a": transform[0], "b": transform[1], "c": transform[2],
            "d": transform[3], "e": transform[4], "f": transform[5],
        },
        "viewPaddingUnits": VIEW_PADDING_UNITS,
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
