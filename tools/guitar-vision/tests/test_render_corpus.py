"""Guitar Vision data engine — geometry and target-extraction tests.

These lock in the failures found while building the engine, each of which
produced a *plausible but wrong* result rather than an error:

  * SVG path bounds computed by pairing raw numbers, which treats relative
    commands as absolute and inflates a glyph by ~7x;
  * a nested-group scanner that terminated at the first inner ``</g>``, so a
    staff group inherited the rest of the document;
  * a glyph-id pattern that demanded one hex digit too many;
  * a ``tabGrp`` box that included the duration symbol, making every fret
    500 units tall;
  * Verovio's ``definition-scale`` viewBox being confused with the page box, so
    the content was shrunk and letterboxed and every crop came back blank.

The last one is the important one: it fails silently. The pipeline reported
"3 views written" while every crop was empty margin.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
TOOLS = ROOT / "tools" / "guitar-vision"
sys.path.insert(0, str(TOOLS))

import render_corpus as rc  # noqa: E402

SAMPLE = ROOT / "datasets" / "guitar-vision" / "synthetic" / "train" / "synthetic-train-20260928000.musicxml"


class TestPathBounds:
    def test_relative_curve_does_not_drift(self):
        # A relative cubic: the endpoint is (40, 10), not (30, 10).
        box = rc._path_bounds("M10 10 c10 0 20 0 30 0")
        assert box.x0 == pytest.approx(10.0)
        assert box.x1 == pytest.approx(40.0)
        assert box.y0 == pytest.approx(10.0)
        assert box.y1 == pytest.approx(10.0)

    def test_absolute_and_relative_horizontals(self):
        assert rc._path_bounds("M0 0 h50 v20 h-50 z").as_list() == [0.0, 0.0, 50.0, 20.0]
        assert rc._path_bounds("M0 0 H50 V20").as_list() == [0.0, 0.0, 50.0, 20.0]

    def test_implicit_lineto_after_moveto(self):
        assert rc._path_bounds("M5 5 L10 5 10 10").as_list() == [5.0, 5.0, 10.0, 10.0]

    def test_arc_and_shorthands_terminate(self):
        assert rc._path_bounds("M0 0 a5 5 0 0 1 10 10 l5 5") is not None
        assert rc._path_bounds("M0 0 q10 10 20 0 t20 0 s5 5 10 0") is not None

    def test_known_notehead_outline_is_notehead_sized(self):
        # SMuFL black notehead (E0A4): about 1.26 x 1.06 staff spaces at 250.
        path = (
            "M0 -39c0 68 73 172 200 172c66 0 114 -37 114 -95c0 -84 -106 -171 -218 -171"
            "c-64 0 -96 30 -96 94z"
        )
        box = rc._path_bounds(path)
        assert 280 < box.width < 340
        assert 240 < box.height < 290


class TestGroupScanner:
    def test_nested_group_does_not_swallow_the_document(self):
        svg = (
            '<g class="staff"><g class="note"><g class="notehead"/></g>'
            '<g class="layer"><g class="tabGrp"/></g></g>'
            '<g class="other"/>'
        )
        groups = list(rc._iter_group_elements(svg, "staff"))
        assert len(groups) == 1
        # The staff's content includes its own nested groups.
        assert 'class="note"' in groups[0][1]
        assert 'class="tabGrp"' in groups[0][1]

    def test_self_closing_group_does_not_break_depth(self):
        svg = '<g class="a"><g class="b"/><g class="c"/></g><g class="d"/>'
        a = list(rc._iter_group_elements(svg, "a"))
        assert len(a) == 1
        assert 'class="c"' in a[0][1]

    def test_non_matching_group_is_not_yielded(self):
        svg = '<g class="layer"><g class="note"/></g>'
        assert list(rc._iter_group_elements(svg, "note")) != []


class TestGlyphIds:
    def test_four_hex_digit_ids_match(self):
        # E0A4 is four hex digits; a pattern expecting five finds nothing.
        svg = '<g id="E0A4-abc123"><path d="M0 0 L10 10"/></g><use xlink:href="#E0A4-abc123"/>'
        outlines = rc.glyph_outline_bounds(svg)
        assert "E0A4-abc123" in outlines
        assert outlines["E0A4-abc123"].width == pytest.approx(10.0)


class TestTabDigits:
    def test_two_glyph_fret_is_wider_than_one(self):
        inner = (
            '<text x="100" y="500" font-size="0px"><tspan font-size="324px">12</tspan></text>'
        )
        boxes, texts = rc._tab_digit_boxes(inner)
        assert texts == ["12"]
        single, _ = rc._tab_digit_boxes(
            '<text x="100" y="500" font-size="0px"><tspan font-size="324px">2</tspan></text>'
        )
        assert boxes[0].width > single[0].width * 1.5

    def test_duration_symbol_is_not_part_of_the_digit_box(self):
        # A tabDurSym stem spans hundreds of units; it must not inflate the box.
        inner = (
            '<g class="tabDurSym"><g class="stem"><path d="M100 900 L100 500"/>'
            '<g class="flag"><use xlink:href="#E240-x"/></g></g></g>'
            '<g class="note"><text x="100" y="500" font-size="0px">'
            '<tspan font-size="324px">3</tspan></text></g>'
        )
        boxes, texts = rc._tab_digit_boxes(inner)
        assert texts == ["3"]
        assert boxes[0].height < 400


class TestDefinitionViewbox:
    def test_reads_the_real_page_space(self):
        svg = (
            '<svg width="2100px" height="2970px">'
            '<svg class="definition-scale" viewBox="0 0 21000 29700">'
            '<g class="page"/></svg></svg>'
        )
        assert rc.definition_viewbox(svg) == (21000.0, 29700.0)
        assert rc.svg_units_per_pixel(svg) == pytest.approx(10.0)

    def test_falls_back_to_one_to_one_without_a_definition_scale(self):
        svg = '<svg width="100" height="100"><g/></svg>'
        assert rc.svg_units_per_pixel(svg) == pytest.approx(1.0)


class TestBandDerivation:
    def test_separates_notation_from_tab(self):
        objects = []
        for index in range(6):
            objects.append(
                {"box": [index * 100, 1000, index * 100 + 60, 1100], "onTab": False}
            )
            objects.append(
                {"box": [index * 100, 4000, index * 100 + 60, 4100], "onTab": True}
            )
        bands = rc.derive_staff_bands(objects, page_width=600, page_height=5000)
        assert len(bands) == 2
        assert bands[0].is_tab is False
        assert bands[1].is_tab is True
        # Non-overlapping, or neither is usable as a crop box.
        assert bands[0].box.y1 <= bands[1].box.y0

    def test_six_line_staff_is_reported_for_tab(self):
        objects = [
            {"box": [index * 100, 4000, index * 100 + 60, 4100], "onTab": True}
            for index in range(4)
        ]
        bands = rc.derive_staff_bands(objects, 400, 5000)
        assert bands[0].staff_lines == 6


@pytest.mark.skipif(not SAMPLE.exists(), reason="synthetic corpus not generated")
class TestEndToEnd:
    """The real check: do the extracted boxes land on the rendered ink?"""

    @pytest.fixture(scope="class")
    def rendered(self, tmp_path_factory):
        """Render and rasterise one score, returning the record and its views.

        Rasterising here rather than inside the test is what makes the ink test
        meaningful: a test that quietly skips when the views are missing is
        exactly the test that would have let the letterboxing bug through.
        """
        out = tmp_path_factory.mktemp("records")
        svg = tmp_path_factory.mktemp("svg")
        views = tmp_path_factory.mktemp("views")
        subprocess.run(
            [
                sys.executable,
                str(TOOLS / "render_corpus.py"),
                "--in", str(SAMPLE.parent),
                "--out", str(out),
                "--svg-out", str(svg),
                "--limit", "1",
            ],
            check=True,
            capture_output=True,
        )
        subprocess.run(
            [
                sys.executable,
                str(TOOLS / "rasterize_views.py"),
                "--records", str(out),
                "--svg", str(svg),
                "--out", str(views),
                "--limit", "1",
            ],
            capture_output=True,
        )
        record = json.loads(next(out.glob("*.record.json")).read_text())
        page = next((views / "full-page").glob("*.png"), None)
        return record, next(svg.glob("*.svg")), page

    def test_pairs_every_notation_note_with_a_tab_digit(self, rendered):
        record, _svg, _page = rendered
        counts = record["objectCounts"]
        assert counts.get("notehead", 0) > 0
        # A paired score engraves each note twice; a mismatch means the TAB staff
        # was not read as a staff of its own.
        assert counts.get("fret-digit", 0) == counts.get("notehead", 0)

    def test_reads_multi_digit_frets(self, rendered):
        record, _svg, _page = rendered
        frets = [o["fret"] for o in record["objects"] if o["objectType"] == "fret-digit"]
        assert any(f and len(f) > 1 for f in frets), "no two-glyph fret was read"

    def test_all_boxes_are_normalised(self, rendered):
        record, _svg, _page = rendered
        for obj in record["objects"]:
            assert min(obj["box"]) >= 0.0
            assert max(obj["box"]) <= 1.0

    def test_reports_a_definition_scale_viewbox(self, rendered):
        record, _svg, _page = rendered
        # A4 in tenths of a millimetre, which is the real page coordinate space.
        assert record["viewBoxWidth"] == pytest.approx(21000.0)
        assert record["unitsPerPixel"] == pytest.approx(10.0, rel=0.01)

    def test_notehead_boxes_land_on_rendered_ink(self, rendered):
        """The test that would have caught the letterboxing bug.

        A box can be internally consistent - right size, plausible coordinates -
        and still point at empty margin, because the renderer shrank and
        letterboxed the content. Only comparing against the actual pixels
        distinguishes those two cases, so this must not be allowed to skip.
        """
        record, _svg, page = rendered
        assert page is not None and page.exists(), "full-page view was not written"
        from PIL import Image
        import numpy as np

        image = np.array(Image.open(page).convert("L"))
        units_per_px = record["viewBoxWidth"] / image.shape[1]

        noteheads = [o for o in record["objects"] if o["objectType"] == "notehead"][:8]
        hits = 0
        for obj in noteheads:
            x0, y0, x1, y1 = (value / units_per_px for value in obj["boxUnits"])
            patch = image[int(y0) : int(y1) + 1, int(x0) : int(x1) + 1]
            if patch.size and int((patch < 200).sum()) > 0:
                hits += 1
        assert hits == len(noteheads), f"{len(noteheads) - hits} notehead boxes missed the ink"
