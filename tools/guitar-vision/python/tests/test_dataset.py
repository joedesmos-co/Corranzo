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
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from guitar_vision.dataset import (  # noqa: E402
    TILES_PER_VIEW,
    build_sample,
    load_dataset,
    page_box_to_view,
    plane_box,
    view_rect,
)

TILE_COUNT = sum(TILES_PER_VIEW.values())


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
        boxes, tiles = sample["boxes"], sample["view"]
        assert float(boxes.min()) >= -0.001, "a box starts outside its plane"
        assert float(boxes.max()) <= 1.001, "a box ends outside its plane"
        assert int(tiles.min()) >= 0
        assert int(tiles.max()) < TILE_COUNT
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
        for tile in range(TILE_COUNT):
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


def test_view_rect_matches_the_record_bands(corpus: tuple[Path, Path]) -> None:
    """A view is a crop, so its frame is the band's rectangle on the page.

    Using the whole page as the frame is the bug that put a digit at crop y 0.21
    when it was engraved at page y 0.73.
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
            assert frame[1] == pytest.approx(top, abs=1e-6)
            assert frame[3] == pytest.approx(bottom, abs=1e-6)
            assert frame[1] < frame[3], "an empty band produced an inverted frame"


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
    from guitar_vision.dataset import collate

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
