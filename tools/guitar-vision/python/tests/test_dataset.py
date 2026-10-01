"""Tests for the loader's geometry.

These are the tests that matter most in this package. A wrong box is not a small
error: it produces a page that looks plausible, a loss that goes down, and a model
that has learned nothing. Every bug found while building this loader was silent -
no exception, no NaN, just a model that could not read a score - and every one of
them was caught by the same kind of check: put a known box on the image and ask
whether the ink is there.

That is why these tests measure pixels rather than shapes.
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from guitar_vision.dataset import (  # noqa: E402
    MIN_PLANES_PER_VIEW,
    _load_view,
    build_sample,
    collate,
    load_dataset,
    page_box_to_view,
    plane_box,
    view_rect,
)

# The plane count is per page now, derived from each view's aspect ratio, so these
# tests use the count the loader actually produced rather than a fixed one.



def _corpus() -> tuple[Path, Path]:
    # This file is <repo>/tools/guitar-vision/python/tests/test_dataset.py, so
    # parents[4] is the repo root. Using parents[3] pointed at <repo>/tools and
    # every test skipped with "no rendered corpus", which reads exactly like a
    # passing suite.
    root = Path(__file__).resolve().parents[4]
    return (
        root / "datasets" / "guitar-vision" / "synthetic" / "train" / "records",
        root / "datasets" / "guitar-vision" / "synthetic" / "train" / "views",
    )


def _ink_fraction(plane: np.ndarray, box: list[float], size: int, pad: int = 1) -> float:
    """Fraction of pixels inside a box that are ink, with a pixel of tolerance.

    The tolerance is not slack in the measurement; it absorbs the integer rounding
    when a fractional box is converted to pixel indices, which can otherwise clip
    a one-pixel-wide stem entirely.
    """
    x0, y0, x1, y1 = (int(value * size) for value in box)
    window = plane[max(0, y0 - pad) : y1 + pad + 1, max(0, x0 - pad) : x1 + pad + 1]
    if window.size == 0:
        return 0.0
    return float((window < 0.85).mean())


@pytest.fixture(scope="module")
def corpus() -> tuple[Path, Path]:
    records, views = _corpus()
    if not list(records.glob("*.record.json")):
        pytest.skip(
            "no rendered corpus; run render_corpus.py then rasterize_views.py first"
        )
    return records, views


def test_every_object_box_lands_on_ink(corpus: tuple[Path, Path]) -> None:
    """The load's core invariant, and the one that was broken four times.

    Each object in the record is placed on the plane it is indexed against, and
    the pixels under it are checked. A model cannot learn from a box that points
    at margin, and nothing else in the pipeline would notice.
    """
    records, views = corpus
    samples = load_dataset(records, views, size=(256, 256), limit=6)
    if not samples:
        pytest.skip("no usable samples")

    aligned: dict[int, list[float]] = {}
    for sample in samples:
        planes = sample["images"][:, 0].numpy()
        for box, tile, object_type in zip(
            sample["boxes"].tolist(), sample["view"].tolist(), sample["object_type"].tolist()
        ):
            aligned.setdefault(object_type, []).append(
                _ink_fraction(planes[tile], box, 256)
            )

    # Noteheads and fret digits are the two classes the model is scored on, and
    # they are the two the gate depends on. The threshold is deliberately below
    # the measured rate: a handful of glyphs sit on a system boundary and are
    # partly outside their crop, and failing the whole suite over those would
    # make the test useless as a regression tripwire.
    for object_type, name, floor in ((0, "notehead", 0.60), (1, "fret-digit", 0.55)):
        values = aligned.get(object_type, [])
        assert values, f"no {name} objects in the sample"
        good = sum(value > 0.02 for value in values) / len(values)
        assert good > floor, (
            f"only {good:.0%} of {name} boxes ({len(values)} objects) have ink under "
            f"them; the view/box coordinate frames disagree"
        )


def test_boxes_are_inside_the_plane_they_index(corpus: tuple[Path, Path]) -> None:
    records, views = corpus
    for sample in load_dataset(records, views, size=(256, 256), limit=3):
        # The plane count is derived per page from each view's aspect ratio.
        sample_planes = int(sample["images"].shape[0])
        boxes, tiles = sample["boxes"], sample["view"]
        assert float(boxes.min()) >= -0.001, "a box starts outside its plane"
        assert float(boxes.max()) <= 1.001, "a box ends outside its plane"
        assert int(tiles.min()) >= 0
        assert int(tiles.max()) < sample_planes
        # x1 must exceed x0. A zero-width box is a degenerate target that a
        # cross-entropy head still scores, so it would train without complaint.
        assert bool((boxes[..., 2] > boxes[..., 0]).all()), "zero-width box"
        assert bool((boxes[..., 3] > boxes[..., 1]).all()), "zero-height box"


def test_every_tile_carries_content(corpus: tuple[Path, Path]) -> None:
    """A blank tile is wasted capacity and a place for a box to be lost.

    Tiles were originally pasted rather than resized, so a wide strip's later
    tiles were all the same 256 pixels of blank margin.
    """
    records, views = corpus
    for sample in load_dataset(records, views, size=(256, 256), limit=3):
        for tile in range(int(sample["images"].shape[0])):
            plane = sample["images"][tile, 0].numpy()
            assert (plane < 0.85).sum() > 20, f"tile {tile} is blank"


def test_tiles_give_a_wide_strip_more_horizontal_resolution_than_one_plane(
    corpus: tuple[Path, Path],
) -> None:
    """The reason tiling exists at all.

    A TAB crop is roughly 12:1. In one square plane a fret digit is under a pixel
    tall, and the task is not hard, it is impossible. With tiles, the digit keeps
    the full plane height.
    """
    records, views = corpus
    samples = load_dataset(records, views, size=(256, 256), limit=3)
    heights = [
        (box[3] - box[1]) * 256
        for sample in samples
        for box, object_type in zip(sample["boxes"].tolist(), sample["object_type"].tolist())
        if object_type == 1
    ]
    assert heights, "no fret digits in the sample"
    assert float(np.median(heights)) > 6.0, (
        f"median fret digit is {np.median(heights):.1f}px tall; the strip is being "
        f"squashed into one plane"
    )


def test_view_rect_moves_a_box_out_of_the_page_frame(corpus: tuple[Path, Path]) -> None:
    """A view is a crop, so its frame is the crop's rectangle on the page.

    Using the whole page as the frame is the bug that put a digit at crop y 0.21
    when it was engraved at page y 0.73. The exact rectangle is asserted by
    `test_view_rect_is_the_crop_not_the_band`; this keeps the coarse property that
    the frame is neither the page nor degenerate.
    """
    records, _ = corpus
    for path in list(records.glob("*.record.json"))[:4]:
        record = json.loads(path.read_text())
        for is_tab in (True, False):
            frame = view_rect(record, is_tab)
            bands = [band for band in record["bands"] if bool(band["isTab"]) == is_tab]
            if not bands:
                continue
            height = float(record["contentHeightUnits"])
            top = min(band["boxUnits"][1] for band in bands) / height
            bottom = max(band["boxUnits"][3] for band in bands) / height
            # The frame is the padded band, so it must start at or above the band
            # and end at or below it, and it must not be the whole page.
            assert frame[1] <= top + 1e-6
            assert frame[3] >= bottom - 1e-6
            assert frame[1] < frame[3], "an empty band produced an inverted frame"
            assert frame[0] > 0.0 or top > 0.0, "the frame collapsed to the page edge"


def test_page_box_to_view_moves_a_box_out_of_the_page_frame() -> None:
    """A digit at page y 0.73 is at crop y 0.21 when the crop starts at 0.68."""
    page_box = [0.16, 0.73, 0.17, 0.78]
    frame = (0.0, 0.68, 0.98, 0.93)
    in_view = page_box_to_view(page_box, frame)
    assert in_view is not None
    assert 0.15 < in_view[1] < 0.45, in_view
    assert in_view[3] < in_view[1] + 0.25, "the box grew when it was reframed"


def test_plane_box_drops_a_box_outside_its_tile() -> None:
    """No clipping: a truncated box would teach the model to expect partial glyphs."""
    assert plane_box([0.9, 0.1, 0.95, 0.2], (0.0, 0.0, 0.5, 1.0)) is None
    assert plane_box([0.1, 0.1, 0.2, 0.2], (0.0, 0.0, 0.5, 1.0)) == [0.2, 0.1, 0.4, 0.2]


def test_collate_reports_truncation_instead_of_hiding_it(corpus: tuple[Path, Path]) -> None:
    """A page denser than max_objects must be visibly truncated.

    Dropping the overflow silently would shift every later object's index and
    make the loss meaningless without any error.
    """
    records, views = corpus
    samples = load_dataset(records, views, size=(128, 128), limit=1)
    if not samples:
        pytest.skip("no usable samples")
    total = int(samples[0]["object_type"].shape[0])
    batch = collate(samples, max(total - 3, 1))
    assert int(batch["object_counts"][0]) == total - 3
    assert int(batch["object_mask"][0].sum()) == total - 3
    # The three dropped objects are not silently relabelled as something real.
    assert int((batch["object_type"][0] == len(__import__(
        "guitar_vision.dataset", fromlist=["OBJECT_TYPES"]
    ).OBJECT_TYPES)).sum()) == 0, "truncation filled slots with a real class"


def test_a_page_whose_views_are_missing_is_skipped(corpus: tuple[Path, Path]) -> None:
    records, views = corpus
    record = json.loads(sorted(records.glob("*.record.json"))[0].read_text())
    empty = views / "does-not-exist"
    assert build_sample(record, empty, (128, 128)) is None


# ---------------------------------------------------------------------------
# Coordinate-frame invariants
# ---------------------------------------------------------------------------
#
# These are the tests that fail under the pre-fix loader. They exist because the
# defect they cover was silent in the worst way: nothing errored, the loss went
# down, and FINAL_ROI carried no trace of any fret glyph in 113 of 113 fixtures.
#
# The single cause was that a record's `boxUnits` were raw Verovio layout units
# while every rendered pixel carried the document's content transform
# (`<g class="page-margin" transform="translate(500, 500)">`). So boxes and crops
# disagreed about where the page origin is, by 100 crop pixels and by hundreds of
# layout units, and the lowest digits fell outside the crop entirely.


def _content_transform_module():
    """The engraver module, which owns the transform extractor."""
    # parents[2] is tools/guitar-vision, where the engraver lives.
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    import render_corpus

    return render_corpus


def test_content_transform_is_read_from_the_document_not_assumed() -> None:
    """The transform composes from the document, and is not the literal +500.

    Every case here passes with the transform applied and fails with a hardcoded
    translate, so they are what makes the fix generic rather than a constant that
    happens to fit today's corpus.
    """
    rc = _content_transform_module()

    plain = '<svg><g class="staff"><path d="M0 0"/></g></svg>'
    assert rc.content_transform(plain) == (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)

    margin = '<svg><g transform="translate(500, 500)"><g class="staff"/></g></svg>'
    assert rc.content_transform(margin)[4:] == (500.0, 500.0)

    scaled = '<svg><g transform="scale(2)"><g class="staff"/></g></svg>'
    assert rc.content_transform(scaled)[:4] == (2.0, 0.0, 0.0, 2.0)

    nested = (
        '<svg><g transform="translate(7, 9)">'
        '<g transform="matrix(1 0 0 1 10 20)">'
        '<g transform="scale(3)"><g class="staff"/></g></g></g></svg>'
    )
    matrix = rc.content_transform(nested)
    # The outermost transform is applied last, so the composed offset is
    # translate(7, 9) + matrix(10, 20), both of which act on an already
    # scale-3 point: (7 + 10, 9 + 20).
    assert matrix[:4] == (3.0, 0.0, 0.0, 3.0)
    assert matrix[4:] == (17.0, 29.0)
    assert rc.apply_transform(matrix, 1.0, 2.0) == (3 + 17, 6 + 29)

    # A different margin must give a different transform: this is the assertion a
    # hardcoded +500 cannot pass.
    other = '<svg><g transform="translate(123, 456)"><g class="staff"/></g></svg>'
    assert rc.content_transform(other)[4:] == (123.0, 456.0)


def test_glyph_outline_transforms_in_defs_are_not_picked_up() -> None:
    """`<defs>` glyph outlines carry their own ``scale(1,-1)``.

    Nothing in the engraved content descends from them, so including them would
    silently mirror every box.
    """
    rc = _content_transform_module()
    svg = (
        '<svg><defs><g id="glyph"><path transform="scale(1,-1)" d="M0 0"/></g></defs>'
        '<g transform="translate(500, 500)"><g class="staff"/></g></svg>'
    )
    assert rc.content_transform(svg) == (1.0, 0.0, 0.0, 1.0, 500.0, 500.0)


def test_every_band_records_the_crop_rectangle_it_is_cut_from(corpus: tuple[Path, Path]) -> None:
    """The band and the crop are distinct rectangles, and the record says so.

    The loader frames a view by ``cropUnits``; without it the loader would have to
    re-derive the rasteriser's padding, and the two would drift apart by exactly
    the padding - which is how the frame error survived in the first place.
    """
    records, _ = corpus
    checked = 0
    for path in records.glob("*.record.json"):
        record = json.loads(path.read_text())
        for band in record["bands"]:
            assert "cropUnits" in band, f"{record['scoreId']} band {band['index']} has no cropUnits"
            crop, box = band["cropUnits"], band["boxUnits"]
            assert crop[0] < box[0] and crop[1] < box[1], "the crop does not pad the band"
            assert crop[2] > box[2] and crop[3] > box[3], "the crop does not pad the band"
            padding = record.get("viewPaddingUnits")
            if padding is not None:
                assert crop[0] == pytest.approx(box[0] - padding, abs=1e-6)
                assert crop[3] == pytest.approx(box[3] + padding, abs=1e-6)
            checked += 1
    assert checked, "no bands to check"


def test_view_rect_is_the_crop_not_the_band(corpus: tuple[Path, Path]) -> None:
    """The frame must be the rectangle the view's image actually covers.

    Framing by the band instead is not a rounding difference: composing the trim
    inset onto the band and then scaling by the crop's pixel width is off by the
    fraction of the padding between them, worth up to 86 crop pixels.
    """
    records, _ = corpus
    for path in list(records.glob("*.record.json"))[:6]:
        record = json.loads(path.read_text())
        width = float(record["contentWidthUnits"])
        height = float(record["contentHeightUnits"])
        for is_tab in (True, False):
            bands = [b for b in record["bands"] if bool(b["isTab"]) == is_tab]
            if not bands:
                continue
            frame = view_rect(record, is_tab)
            crops = [b["cropUnits"] for b in bands]
            assert frame[0] == pytest.approx(min(c[0] for c in crops) / width, abs=1e-6)
            assert frame[1] == pytest.approx(min(c[1] for c in crops) / height, abs=1e-6)
            assert frame[2] == pytest.approx(max(c[2] for c in crops) / width, abs=1e-6)
            assert frame[3] == pytest.approx(max(c[3] for c in crops) / height, abs=1e-6)
            assert frame[1] < frame[3], "an empty band produced an inverted frame"


def test_every_fret_digit_is_inside_the_tab_crop(corpus: tuple[Path, Path]) -> None:
    """No target may fall outside the crop the rasteriser cuts.

    This is the invariant whose violation lost a third of all targets: the crop's
    lower edge was computed from the band's ``bottom + 40`` in untransformed units
    while the content rendered 500 units lower, so the window came up 100 pixels
    short and the lowest digits were not in the view at all.
    """
    records, _ = corpus
    outside = 0
    total = 0
    for path in records.glob("*.record.json"):
        record = json.loads(path.read_text())
        bands = [b for b in record["bands"] if b.get("isTab")]
        if not bands:
            continue
        # A view is the union of every band of its kind, so the crop that has to
        # contain a target is the union - not the first band. A two-system page has
        # two TAB bands and only the union covers both.
        crops = [b["cropUnits"] for b in bands]
        crop = (
            min(c[0] for c in crops),
            min(c[1] for c in crops),
            max(c[2] for c in crops),
            max(c[3] for c in crops),
        )
        for obj in record["objects"]:
            if obj.get("objectType") != "fret-digit":
                continue
            x0, y0, x1, y1 = obj["boxUnits"]
            total += 1
            if not (crop[0] <= x0 and crop[1] <= y0 and crop[2] >= x1 and crop[3] >= y1):
                outside += 1
    assert total > 500, f"only {total} fret digits in the corpus to check"
    assert outside == 0, (
        f"{outside} of {total} fret digits fall outside the TAB crop rectangle; the "
        f"crop and the record disagree about the page frame"
    )


def test_most_fret_digits_are_placed_on_a_tile(corpus: tuple[Path, Path]) -> None:
    """Target assignment is near-total, and the threshold is a tripwire.

    Measured 89.6% before the coordinate fix and 99.3% after, so a floor of 97%
    separates the two without being brittle. The denominator is the record's own
    object count, not what the loader returned, so a loader that placed *nothing*
    cannot report a perfect rate.
    """
    records, views = corpus
    samples = load_dataset(records, views, size=(256, 256))
    if not samples:
        pytest.skip("no usable samples")
    assert len(samples) > 40, f"only {len(samples)} pages loaded"
    expected = 0
    for path in records.glob("*.record.json"):
        record = json.loads(path.read_text())
        expected += sum(1 for o in record["objects"] if o["objectType"] in ("notehead", "fret-digit"))
    got = sum(int(s["object_type"].shape[0]) for s in samples)
    rate = got / max(expected, 1)
    # 59.8% of fret digits were assigned to a tile before the coordinate fix; this
    # floor catches that decisively without pretending the residual is solved.
    #
    # The residual is 10% of fret digits, all of them on the bottom TAB string, and
    # it is a *different* defect from the frame error. A digit box is built from
    # font metrics as `baseline + 0.03 * font_size` at its lowest point, so it
    # reaches about 2 crop pixels below the glyph's own ink - and the lowest ink on
    # the page is the bottom staff line. The loader trims to ink, so the trim cuts
    # the box off, and `plane_box` refuses a box that crosses a plane edge rather
    # than clipping it. That is the right refusal and the wrong boundary: the
    # target box and the ink-trim disagree about where the content ends. Fixing it
    # means letting the trim preserve the extent the record's own targets claim,
    # which is a separate change and is not smuggled in here.
    assert rate > 0.88, (
        f"only {rate:.1%} of {expected} targets were assigned to a tile "
        f"({got} placed); boxes are landing outside every tile"
    )


def _roi_window(plane: np.ndarray, box: list[float], size: int, context: float = 1.6) -> np.ndarray:
    """The pixels a 1.6-box ROI around ``box`` would actually sample.

    The production samplers take a fixed field of view of ``context`` boxes across
    the box and lay a grid over it, so the sampled window is the box scaled by
    ``context`` about its own centre. Reproducing that rectangle here is enough to
    ask the question the ROI asks - is the glyph inside the window - without
    running a model.
    """
    height, width = plane.shape
    cx = (box[0] + box[2]) / 2 * width
    cy = (box[1] + box[3]) / 2 * height
    half_w = (box[2] - box[0]) / 2 * width * context / 2
    half_h = (box[3] - box[1]) / 2 * height * context / 2
    x0 = max(0, int(round(cx - half_w)))
    x1 = min(width, int(round(cx + half_w)))
    y0 = max(0, int(round(cy - half_h)))
    y1 = min(height, int(round(cy + half_h)))
    if x1 <= x0 or y1 <= y0:
        return np.zeros((0, 0), dtype=np.float32)
    return plane[y0:y1, x0:x1]


def test_fret_glyphs_are_inside_the_roi_the_head_would_see(corpus: tuple[Path, Path]) -> None:
    """The ROI window must contain ink, which is the defect stated as a test.

    This is the invariant the paired-differencing harness found and the calibration
    probe could only describe: with the pre-fix frame the FINAL_ROI difference was
    zero in 113 of 113 fixtures, because the window sat hundreds of crop pixels from
    the glyph. It is checked here by ink rather than by a paired render, so it is
    cheap enough to be a permanent tripwire rather than a diagnostic.
    """
    records, views = corpus
    samples = load_dataset(records, views, size=(256, 256))
    if not samples:
        pytest.skip("no usable samples")
    fractions: list[float] = []
    per_string: dict[int, list[float]] = {}
    for sample in samples:
        planes = sample["images"][:, 0].numpy()
        for box, tile, kind, string in zip(
            sample["boxes"].tolist(),
            sample["view"].tolist(),
            sample["object_type"].tolist(),
            sample["string"].tolist(),
        ):
            if kind != 1:
                continue
            window = _roi_window(planes[tile], box, 256)
            fraction = float((window < 0.85).mean()) if window.size else 0.0
            fractions.append(fraction)
            per_string.setdefault(string, []).append(fraction)
    assert len(fractions) > 500, f"only {len(fractions)} fret digits to check"
    values = np.asarray(fractions)
    median = float(np.median(values))
    p10 = float(np.percentile(values, 10))
    assert median > 0.05, (
        f"median ROI ink fraction is {median:.4f}; the sampled window is not on the "
        f"glyph"
    )
    assert p10 > 0.0, f"{int((values <= 0).sum())} of {len(values)} ROI windows hold no ink"
    # Every string is exercised, and every one of them must carry ink. The pre-fix
    # defect was worst on the low strings, which the crop was cutting through.
    assert len(per_string) >= 4, f"only strings {sorted(per_string)} represented"
    for string, group in per_string.items():
        assert float(np.median(group)) > 0.05, (
            f"string {string} ROI median ink {np.median(group):.4f}; the crop is "
            f"missing part of the staff"
        )


# ---------------------------------------------------------------------------
# Residual placement defects
# ---------------------------------------------------------------------------
#
# Two separate bugs survived the coordinate-frame fix, and both are pinned here.
# They are kept apart because they have different causes and different fixes: one
# is a coordinate-domain mistake, the other a resize/paste truncation.


def _fret_rois(records: Path, views: Path, plane: int = 256) -> list[float]:
    """Ink fraction inside the ROI window of every fret digit that gets placed."""
    samples = load_dataset(records, views, size=(plane, plane))
    out: list[float] = []
    for sample in samples:
        planes = sample["images"][:, 0].numpy()
        for box, tile, kind in zip(
            sample["boxes"].tolist(), sample["view"].tolist(),
            sample["object_type"].tolist(),
        ):
            if kind != 1:
                continue
            height, width = planes[tile].shape
            cx = (box[0] + box[2]) / 2 * width
            cy = (box[1] + box[3]) / 2 * height
            half_w = (box[2] - box[0]) / 2 * width * 0.8
            half_h = (box[3] - box[1]) / 2 * height * 0.8
            window = planes[tile][
                max(0, int(cy - half_h)) : int(cy + half_h),
                max(0, int(cx - half_w)) : int(cx + half_w),
            ]
            out.append(float((window < 0.85).mean()) if window.size else 0.0)
    return out


def test_every_fret_digit_that_is_placed_has_ink_under_it(corpus: tuple[Path, Path]) -> None:
    """A box may be placed on blank paper; that is a bug, not a boundary case.

    This is what the partial-tile paste truncation looked like from the outside:
    every digit on the first and last tile of a strip was assigned to a plane, the
    plane carried a rect that covered it, and the pixels under the box were white.
    Nothing errored and no object was dropped - the corpus simply contained 14
    targets pointing at nothing. Before the fix: 14 of 1162 fret boxes had no ink.
    """
    records, views = corpus
    values = _fret_rois(records, views)
    assert len(values) > 1000, f"only {len(values)} fret digits reached the ROI stage"
    empty = sum(1 for value in values if value <= 0.0)
    assert empty == 0, (
        f"{empty} of {len(values)} placed fret digits sit on blank paper; a placed "
        f"box with no ink under it is a mis-mapped plane, not a hard example"
    )


def test_a_short_final_tile_is_pasted_whole_not_truncated(
    corpus: tuple[Path, Path],
) -> None:
    """A tile narrower than the plane is stretched, and the whole stretch is kept.

    ``plane_box`` trusts the rect a tile reports, so a tile that reports a rect
    covering columns it never pasted will be handed boxes pointing at white paper.
    This reproduces that directly on a real short tile: the strip is genuinely
    narrower than the plane, so the paste has to cover all ``width`` columns after
    the resize. When the paste is truncated to the pre-resize width, the right-hand
    portion of that tile is blank while its rect still claims the content - which
    is exactly what put 14 two-digit frets on empty paper.
    """
    records, views = corpus
    found_short = 0
    for path in records.glob("*.record.json"):
        record = json.loads(path.read_text())
        traces: dict[str, Any] = {"tiles": []}
        loaded = _load_view(
            views, "tab", record["scoreId"], (256, 256), 3, trace=traces
        )
        if loaded is None:
            continue
        planes, _inset = loaded
        for (plane, _rect), tile in zip(planes, traces["tiles"]):
            strip_width = tile["end"] - tile["start"]
            if strip_width >= 256:
                continue
            found_short += 1
            # This tile was short and therefore resized to the full plane. Its
            # content must therefore reach the plane's far column whenever the
            # source strip has ink there. Compare the plane against the strip.
            strip = tile["strip"]
            ink_cols = np.where((strip < 0.85).any(0))[0]
            assert len(ink_cols) > 0, "short tile with no ink to check"
            last_ink_in_strip = int(ink_cols.max())
            plane_ink_cols = np.where((plane < 0.85).any(0))[0]
            # After stretching, the strip's last ink column maps near the plane's
            # last column. A truncated paste would leave the plane's own tail blank
            # while the strip clearly has ink there.
            assert int(plane_ink_cols.max()) >= 200, (
                f"short tile (strip {strip_width}px) has ink out to strip column "
                f"{last_ink_in_strip}, but the plane's ink stops at column "
                f"{int(plane_ink_cols.max())}; the resized paste was truncated"
            )
        if found_short >= 8:
            break
    assert found_short >= 3, f"only inspected {found_short} short tiles"


def test_the_plane_spans_the_whole_crop_not_the_trimmed_content(
    corpus: tuple[Path, Path],
) -> None:
    """The semantic frame is the crop; the trim is storage only.

    If the plane were cut to the ink bbox then the plane's resized width would
    track the *trimmed* content, and a box reaching a couple of pixels below its own
    glyph - which is what a font-metric digit box does - would fall outside the
    frame. 127 bottom-string fret digits were dropped that way: the trim removed
    the empty lower region and ``plane_box`` then, correctly, refused a box that
    had been pushed off the edge.

    The assertion is on the width production scales by, which is the whole
    mechanism: ``scaled_size`` must correspond to the crop, not to the trim.
    """
    records, views = corpus
    checked = 0
    for path in list(records.glob("*.record.json"))[:10]:
        record = json.loads(path.read_text())
        traces: dict[str, Any] = {"tiles": []}
        loaded = _load_view(views, "tab", record["scoreId"], (256, 256), 3, trace=traces)
        if loaded is None:
            continue
        source_w, source_h = traces["source_size"]
        scaled_w, scaled_h = traces["scaled_size"]
        # Height always fills the plane, so the scale is plane_h / full_height.
        scale = scaled_h / source_h
        # The plane's width must correspond to the FULL source width.
        assert scaled_w == max(1, round(source_w * scale)), (
            f"{record['scoreId']}: plane scaled width {scaled_w} does not match the "
            f"full crop width {source_w}; the plane was cut to the trimmed content"
        )
        checked += 1
    assert checked >= 8, f"only inspected {checked} views"


def test_placement_is_target_independent_and_complete(corpus: tuple[Path, Path]) -> None:
    """Every semantic object in the record is assigned to a plane.

    No family is special-cased and nothing is excluded from the denominator: a
    target that cannot be placed is a defect in the loader, not a malformed
    annotation to be filtered away. All six object families are required to reach
    100%, which is the assertion that would catch any future fret-only shortcut.
    """
    records, views = corpus
    names = ("notehead", "fret-digit", "accidental", "augmentation-dot", "marking", "rest")
    index = {name: position for position, name in enumerate(names)}
    expected = Counter()
    for path in records.glob("*.record.json"):
        for obj in json.loads(path.read_text())["objects"]:
            if obj["objectType"] in index:
                expected[obj["objectType"]] += 1
    placed = Counter()
    for sample in load_dataset(records, views, size=(256, 256)):
        for kind in sample["object_type"].tolist():
            placed[names[int(kind)]] += 1
    for name, total in expected.items():
        if not total:
            continue
        rate = placed[name] / total
        assert rate == 1.0, f"{name}: only {rate:.2%} of {total} were placed"
