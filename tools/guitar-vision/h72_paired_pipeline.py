"""H72-H79: paired differencing through the *real* loader, stage by stage.

## What this measures

The page-space fret box is already cleared: capture 1.0000, zero clipping, centre
dx 0.15px / dy 0.66px against a CTM of exactly 0.1. So the open question is no
longer "where should the glyph be" but "does its actual pixel contribution survive
the raster pipeline". A coordinate table cannot answer that: transforming the
target bbox and the production box by the same function preserves their relative
alignment by construction, so every row would read ~1.0 and prove nothing.

So each fixture produces two pages from the *same* SVG, differing in exactly one
respect:

    A   the semantic fret target rendered normally
    B   the same SVG with only that target's ``<text>`` element removed

Both are rasterised by **production** code (``rasterize_views``) and loaded by
**production** code (``guitar_vision.dataset.load_dataset``). Nothing here
re-implements the geometry: every array measured is the array production built.

## The trap this harness exists to survive

``_load_view`` derives its trim from raster content::

    trim = ImageOps.invert(grey).getbbox()

and the trim feeds ``scaled_width``, ``span``, ``overlap`` and therefore the tile
rects and the plane count. Delete a digit that happens to be the leftmost or
rightmost ink on a page and the trim narrows, the layout changes, and the
difference then measures a *layout change* rather than a glyph contribution. Such
a pair is evidence of nothing, so every pair is gated before a pixel is differenced:

  CLASS 1  natural equivalent - source dims, trim, post-trim dims, scaled dims,
           plane count and tile rects all identical. The only valid primary fixture.
  CLASS 2  trim differs - suppression moved the content bbox. The natural outputs
           are never differenced directly; these are re-run under ``trim_override``
           pinned to A's trim and reported separately as PINNED-TRIM DIAGNOSTIC.
  CLASS 3  same trim but a later layout stage differs - a hard failure.

Independently, every differenced pair must agree on the target's global tile index,
that tile's rect, and the target's plane box. A pair that does not is dropped and
reported; a differently tiled pair is never read as signal loss.

## Reading the numbers

Raw L1 is meaningless across stages, because each stage has a different resolution
and a different sample count. Two things are reported instead.

**Normalised retention** - per-sample L1 at each stage divided by the same quantity
at the previous stage. This reads as "how much of the signal survived this
operation", not "how many pixels does this array contain".

**EXPECTED_DIFF** - for each deterministic stage, take the *previous* stage's actual
difference and push it through the identical operation directly.
``|resize(A) - resize(B)|`` is not ``resize(|A-B|)``, because production resamples
8-bit images and re-quantises at each step. Comparing ACTUAL against EXPECTED
separates "the operation redistributes energy, as it must" from "production
discards signal specific to this glyph". That distinction is the point of the run.

## Provenance

Semantic pairing is the validated one - digit string plus an x tolerance - not a
re-derivation. Fixtures span multiple scores, single and double digit frets and
several strings, and a score-disjoint subset is held out and reported separately so
no conclusion rests only on the pages it was read from.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path
from typing import Any

import numpy as np
import torch
from PIL import Image

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE / "python"))
sys.path.insert(0, str(_HERE))

import rasterize_views as rv  # noqa: E402  production rasteriser
import render_corpus as rc  # noqa: E402  production record/SVG producer
from guitar_vision.dataset import (  # noqa: E402  production loader
    VIEW_NAMES,
    build_sample,
    load_dataset,
    page_box_to_view,
    view_rect,
)
from h1_direct_roi_probe import sample_roi  # noqa: E402  the real ROI sampler

TABS = "tab"

# A normalised difference below this is under half of one 8-bit code, so it cannot
# be told apart from the resampler's own quantisation.
HALF_CODE = 0.5 / 255.0

_TEXT_ELEMENT = re.compile(r"<text\b[^>]*>.*?</text>", re.S)
_NUMERIC_TSPAN = re.compile(r'<tspan[^>]*font-size="([\d.]+)px"[^>]*>(\d+)</tspan>')


# ---------------------------------------------------------------------------
# Fixture discovery
# ---------------------------------------------------------------------------


def semantic_targets(svg_text: str) -> list[dict[str, Any]]:
    """Every ``<text>`` element carrying a fret digit, in document order.

    Document order is what makes a target addressable: the element's index in this
    list is the only handle the suppression step needs, and it comes from the SVG
    itself rather than from any record ordering, so no order dependency is
    introduced anywhere else.
    """
    found: list[dict[str, Any]] = []
    for match in _TEXT_ELEMENT.finditer(svg_text):
        body = match.group(0)
        digits = _NUMERIC_TSPAN.findall(body)
        if not digits:
            continue
        x = re.search(r'\bx="(-?[\d.]+)"', body)
        y = re.search(r'\by="(-?[\d.]+)"', body)
        if x is None or y is None:
            continue
        found.append(
            {
                "span": (match.start(), match.end()),
                "digits": "".join(value for _size, value in digits),
                "font": max(float(size) for size, _ in digits),
                "x": float(x.group(1)),
                "baseline": float(y.group(1)),
            }
        )
    return found


def suppress(svg_text: str, index: int) -> str:
    """The SVG with exactly one fret digit's ``<text>`` element removed.

    Deleted rather than hidden, so no stylesheet, attribute or cascade can
    reinstate it. Everything else in the document - sibling digits, staff lines,
    rhythm stems, group structure - is byte-identical, which is what makes the
    page difference attributable to the target alone.
    """
    targets = semantic_targets(svg_text)
    if not 0 <= index < len(targets):
        raise IndexError(f"no semantic target at index {index}")
    start, end = targets[index]["span"]
    return svg_text[:start] + svg_text[end:]


def record_transform(record: dict[str, Any]) -> tuple[float, float, float, float, float, float]:
    """The content transform a record was built with, as recorded by the engraver.

    Read from the record rather than re-parsed, so the harness compares geometry in
    the same frame the record is written in. A record without the field predates the
    coordinate fix, where boxUnits were raw layout units - the identity applies.
    """
    stored = record.get("contentTransform")
    if not stored:
        return (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    return (
        float(stored["a"]), float(stored["b"]), float(stored["c"]),
        float(stored["d"]), float(stored["e"]), float(stored["f"]),
    )


def pair_targets(record: dict[str, Any], targets: list[dict[str, Any]]) -> dict[int, int]:
    """Map each record fret-digit object to its semantic target index.

    The validated pairing: the digit string must agree *and* the horizontal
    position must be within tolerance. The digit string alone is not enough - the
    same fret recurs on a page many times - and position alone is not enough
    either. An object matching zero or several targets is discarded, not guessed.

    Both sides are compared in one frame. A semantic target is a raw SVG position,
    and a record's ``boxUnits`` are canonical, so the target is mapped through the
    record's own content transform first. Comparing them untransformed is not a
    subtle failure: it mismatches almost every pair, which reads as an empty
    fixture set rather than as an error.
    """
    band = next((b for b in record["bands"] if b.get("isTab")), None)
    if band is None:
        return {}
    matrix = record_transform(record)
    band_span = band["boxUnits"][3] - band["boxUnits"][1]
    tolerance = 0.6 * band_span / 5
    by_value: dict[str, list[int]] = {}
    for index, target in enumerate(targets):
        by_value.setdefault(target["digits"], []).append(index)

    def canonical(target: dict[str, Any]) -> tuple[float, float]:
        x, y = _apply(matrix, target["x"], target["baseline"] - target["font"] * 0.36)
        return x, y

    pairs: dict[int, int] = {}
    for obj in record["objects"]:
        if obj.get("objectType") != "fret-digit" or not obj.get("fret"):
            continue
        fret = str(int(obj["fret"]))
        units = obj["boxUnits"]
        centre_x = (units[0] + units[2]) / 2
        centre_y = (units[1] + units[3]) / 2
        matches = []
        for index in by_value.get(fret, []):
            cx, cy = canonical(targets[index])
            if abs(cx - centre_x) <= tolerance and abs(cy - centre_y) <= tolerance:
                matches.append(index)
        if len(matches) == 1:
            pairs[obj["index"]] = matches[0]
    return pairs


def _apply(matrix: tuple[float, ...], x: float, y: float) -> tuple[float, float]:
    a, b, c, d, e, f = matrix
    return (a * x + c * y + e, b * x + d * y + f)


def choose_fixtures(
    records: list[tuple[Path, dict[str, Any], str]],
    per_score: int,
    held_out_every: int,
) -> list[dict[str, Any]]:
    """Pick fixtures, keeping the digit-count and string spread honest.

    Cycling the digit count rather than taking the first N per score means a score
    whose frets happen to all be one digit cannot quietly supply every fixture.
    """
    fixtures: list[dict[str, Any]] = []
    for order, (record_path, record, svg_text) in enumerate(records):
        band = next((b for b in record["bands"] if b.get("isTab")), None)
        if band is None:
            continue
        targets = semantic_targets(svg_text)
        pairs = pair_targets(record, targets)
        digits = [
            o for o in record["objects"] if o.get("objectType") == "fret-digit"
        ]
        one = [o for o in digits if len(str(int(o["fret"]))) == 1 and o["index"] in pairs]
        two = [o for o in digits if len(str(int(o["fret"]))) == 2 and o["index"] in pairs]
        chosen: list[dict[str, Any]] = []
        for turn in range(per_score):
            pool = one if turn % 2 == 0 else two
            if not pool:
                pool = one or two
            if not pool:
                break
            obj = pool[turn % len(pool)]
            chosen.append(
                {
                    "object_index": obj["index"],
                    "target_index": pairs[obj["index"]],
                    "fret": int(obj["fret"]),
                    "digits": len(str(int(obj["fret"]))),
                    "score": record["scoreId"],
                    "held_out": bool(held_out_every and order % held_out_every == held_out_every - 1),
                }
            )
        fixtures.extend(chosen)
    return fixtures


# ---------------------------------------------------------------------------
# Dataset construction
# ---------------------------------------------------------------------------


def render_views(
    svg_path: Path,
    record: dict[str, Any],
    score_id: str,
    out_dir: Path,
    tmp: Path,
    corpus: Path,
    carried: list[str],
) -> bool:
    """Produce the three production views for one score.

    ``rasterize_views.main``'s per-score body, called directly so A and B travel
    the same render path. The widest render is taken once and the other two views
    are crops of that single image, so all three views of a page are guaranteed to
    be the same pixels - the property the loader depends on.

    ``carried`` collects the view kinds production *refused* to render. It refuses
    when a page has no band of that kind, and 18 of the 60 corpus scores have a TAB
    band only - their committed ``notation`` PNGs predate that. A refused kind is
    carried from the committed corpus into A and B **identically**, because the
    loader needs all three views present. Carrying the same bytes into both sides
    cannot contribute to a difference, and every stage measured here is in the TAB
    view, which production always renders.
    """
    widest = int(rv.PAGE_WIDTH * rv.VIEW_SCALE)
    page_png = tmp / f"{score_id}.page.png"
    units_to_px, ok = rv.render_full_page(
        svg_path,
        page_png,
        widest,
        (float(record["viewBoxWidth"]), float(record["viewBoxHeight"])),
        tmp,
    )
    if not ok:
        return False
    with Image.open(page_png) as image:
        image.load()
        for view_name in ("full-page", "notation", "tab"):
            path = out_dir / view_name / f"{score_id}.png"
            if view_name == "full-page":
                path.parent.mkdir(parents=True, exist_ok=True)
                image.resize(
                    (int(image.width / rv.VIEW_SCALE), int(image.height / rv.VIEW_SCALE)),
                    Image.LANCZOS,
                ).save(path)
                continue
            box = rv.band_crop_units(
                record["bands"], is_tab=view_name == "tab", padding=rv.VIEW_PADDING_UNITS
            )
            ok, _reason = rv.crop_view(image, units_to_px, box, 1.0, path)
            if not ok:
                carried.append(view_name)
    page_png.unlink(missing_ok=True)
    return True


def write_record(record: dict[str, Any], score_id: str, out_dir: Path) -> None:
    """Write the record under a fixture-local scoreId.

    Object list, boxes and metadata are carried over untouched and in full -
    including the target's own object, deliberately. The loader has to place a box
    for that object in *both* A and B so the two runs can be asked which tile they
    chose for the same target. Only the scoreId differs, because it is the
    loader's filename key.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = dict(record)
    payload["scoreId"] = score_id
    (out_dir / f"{score_id}.record.json").write_text(json.dumps(payload, indent=1))


def build_pair(
    record: dict[str, Any],
    svg_text: str,
    target_index: int,
    fixture_id: str,
    root: Path,
    tmp: Path,
    corpus: Path,
    cache: dict[str, dict[str, Any]],
) -> tuple[Path, Path, dict[str, Any]]:
    """Materialise the A and B dataset copies for one fixture.

    A is the unmodified page, so it is rendered once per *score* into a cache and
    copied under each fixture's scoreId. Caching by score while writing by fixture
    is not a subtlety to get wrong: a cache keyed by score that writes under the
    first fixture's id leaves every later fixture of that score with no A view, and
    ``load_dataset`` then silently returns an empty list for it.
    """
    original = record["scoreId"]
    a_dir, b_dir = root / "A", root / "B"
    a_records, a_views = a_dir / "records", a_dir / "views"
    b_records, b_views = b_dir / "records", b_dir / "views"

    write_record(record, fixture_id, a_records)
    write_record(record, fixture_id, b_records)

    meta = cache.get(original)
    if meta is None:
        staged = tmp / f"{original}.a"
        if staged.exists():
            shutil.rmtree(staged)
        staged.mkdir(parents=True, exist_ok=True)
        a_svg = tmp / f"{original}.a.svg"
        a_svg.write_text(svg_text)
        carried_a: list[str] = []
        rendered = render_views(a_svg, record, original, staged / "views", tmp, corpus, carried_a)
        a_svg.unlink(missing_ok=True)
        meta = {"rendered": rendered, "staged": staged, "carried": carried_a}
        cache[original] = meta
    if not meta["rendered"]:
        raise RuntimeError(f"A render failed for {original}")

    b_svg = tmp / f"{fixture_id}.b.svg"
    b_svg.write_text(suppress(svg_text, target_index))
    carried_b: list[str] = []
    render_views(b_svg, record, fixture_id, b_views, tmp, corpus, carried_b)
    b_svg.unlink(missing_ok=True)

    # A is copied from the staged render; B was rendered directly. Both then get
    # the same carried views, byte for byte.
    for kind in ("full-page", "notation", "tab"):
        source = meta["staged"] / "views" / kind / f"{original}.png"
        destination = a_views / kind / f"{fixture_id}.png"
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.exists():
            shutil.copyfile(source, destination)
    for kind in sorted(set(meta["carried"]) | set(carried_b)):
        committed = corpus / "views" / kind / f"{original}.png"
        if not committed.exists():
            raise RuntimeError(f"no committed {kind} view to carry for {original}")
        for side_views in (a_views, b_views):
            destination = side_views / kind / f"{fixture_id}.png"
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(committed, destination)

    # Verify that the A side this harness differences is byte-identical to the
    # committed corpus view, for every kind production was able to re-render. If it
    # is not, the harness is measuring something other than the shipped corpus.
    identical: dict[str, bool] = {}
    for kind in ("full-page", "notation", "tab"):
        committed = corpus / "views" / kind / f"{original}.png"
        produced = a_views / kind / f"{fixture_id}.png"
        if not committed.exists() or not produced.exists():
            continue
        identical[kind] = committed.read_bytes() == produced.read_bytes()

    info = {
        "carried_a": list(meta["carried"]),
        "carried_b": sorted(set(carried_b)),
        "a_matches_committed": identical,
    }
    return a_records, b_records, info


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------


def diff_metrics(d: np.ndarray) -> dict[str, Any]:
    """Describe one difference array in resolution-independent terms."""
    strong = d > HALF_CODE
    count = int(strong.sum())
    out: dict[str, Any] = {
        "shape": list(d.shape),
        "samples": int(d.size),
        "nonzero": count,
        "zero_rate": round(1.0 - count / max(d.size, 1), 6),
        "mean_abs": round(float(d.mean()), 8),
        "max_abs": round(float(d.max()), 8),
        "l1": round(float(d.sum()), 6),
        "norm_l1_per_sample": round(float(d.sum() / max(d.size, 1)), 8),
    }
    if count:
        rows = np.where(strong.any(1))[0]
        cols = np.where(strong.any(0))[0]
        out["bbox"] = [int(cols.min()), int(rows.min()), int(cols.max()) + 1, int(rows.max()) + 1]
        out["eff_w"] = int(cols.max() - cols.min() + 1)
        out["eff_h"] = int(rows.max() - rows.min() + 1)
    else:
        out["bbox"] = None
        out["eff_w"] = 0
        out["eff_h"] = 0
    out["bottom"] = bottom_band_energy(d)
    return out


def lanczos_float(array: np.ndarray, width: int, height: int) -> np.ndarray:
    """Resample a float array with the kernel production uses.

    Applied to a *difference* this is the EXPECTED_DIFF for a production resize.
    Production resamples 8-bit and divides by 255, so its own result is
    additionally clipped and re-quantised at every stage. That quantisation is
    precisely the discrepancy this control exists to expose, so it must not be
    folded into the expectation.
    """
    image = Image.fromarray(np.asarray(array, dtype=np.float32), mode="F")
    return np.asarray(image.resize((width, height), Image.LANCZOS), dtype=np.float64)


def bottom_band_energy(d: np.ndarray, fraction: float = 0.2) -> dict[str, Any]:
    """Share of a difference's energy sitting in the bottom band of its extent.

    The bottom-margin hypothesis predicts resampling destroys the glyph's lowest
    rows preferentially, which would appear as the bottom band losing a larger
    share of the energy than the rest of the glyph. Measuring the *share* rather
    than absolute energy keeps the comparison independent of stage resolution.
    """
    strong = d > HALF_CODE
    if not strong.any():
        return {"bottom_share": None, "rows": 0, "bottom_rows": 0}
    rows = np.where(strong.any(1))[0]
    top, bottom = int(rows.min()), int(rows.max()) + 1
    height = max(bottom - top, 1)
    cut = max(bottom - max(1, int(round(height * fraction))), top)
    total = float(d[top:bottom].sum())
    edge = float(d[cut:bottom].sum())
    return {
        "bottom_share": round(edge / total, 6) if total else None,
        "rows": height,
        "bottom_rows": bottom - cut,
    }


def compare_actual_expected(actual: np.ndarray, expected: np.ndarray) -> dict[str, Any]:
    """How far production's own difference departs from the idealised one."""
    a = np.asarray(actual, np.float64)
    e = np.asarray(expected, np.float64)
    if a.shape != e.shape:
        return {"comparable": False, "shape_a": list(a.shape), "shape_e": list(e.shape)}
    delta = np.abs(a - e)
    out: dict[str, Any] = {
        "comparable": True,
        "mae": round(float(delta.mean()), 10),
        "max": round(float(delta.max()), 10),
        "norm_l1_discrepancy": round(float(delta.sum() / max(delta.size, 1)), 10),
        # Carried so retention can be expressed as ACTUAL/EXPECTED, which is the
        # only ratio that survives a change of resolution between stages.
        "actual_l1": round(float(a.sum()), 6),
        "expected_l1": round(float(e.sum()), 6),
    }
    a_rows = np.where((a > HALF_CODE).any(1))[0]
    e_rows = np.where((e > HALF_CODE).any(1))[0]
    a_cols = np.where((a > HALF_CODE).any(0))[0]
    e_cols = np.where((e > HALF_CODE).any(0))[0]
    out["bbox_actual"] = (
        [int(a_cols.min()), int(a_rows.min()), int(a_cols.max()), int(a_rows.max())]
        if len(a_rows)
        else None
    )
    out["bbox_expected"] = (
        [int(e_cols.min()), int(e_rows.min()), int(e_cols.max()), int(e_rows.max())]
        if len(e_rows)
        else None
    )
    if out["bbox_actual"] and out["bbox_expected"]:
        out["centroid_shift"] = [
            round(float((a_cols.min() + a_cols.max() - e_cols.min() - e_cols.max()) / 2), 3),
            round(float((a_rows.min() + a_rows.max() - e_rows.min() - e_rows.max()) / 2), 3),
        ]
    else:
        out["centroid_shift"] = None
    return out


# ---------------------------------------------------------------------------
# Locating the target through production
# ---------------------------------------------------------------------------


def tab_offset(traces: dict[str, dict[str, Any]]) -> int:
    """Global plane index at which the TAB view's planes begin."""
    offset = 0
    for name in VIEW_NAMES:
        if name == TABS:
            return offset
        offset += traces[name]["plane_count"]
    raise KeyError(TABS)


def locate_target(
    record: dict[str, Any], views_dir: Path, size: tuple[int, int], object_index: int
) -> dict[str, Any] | None:
    """Ask production where the target lands, without re-deriving it.

    ``build_sample`` assigns each object to the first tile whose rect contains it,
    which is a loop with a real drop rule in it. Rather than copy that loop - the
    kind of reimplementation this project has been burned by twice - the target is
    isolated into a one-object record and handed to the production builder.
    Assignment is independent per object, so the single row it returns carries
    exactly the tile index and plane box the full record gives it.
    """
    target = next(obj for obj in record["objects"] if obj["index"] == object_index)
    probe = dict(record)
    probe["objects"] = [target]
    sample = build_sample(probe, views_dir, size)
    if sample is None:
        return None
    return {
        "tile": int(sample["view"][0]),
        "box": sample["boxes"][0].tolist(),
        "fret": int(sample["fret"][0]),
        "string": int(sample["string"][0]),
    }


def roi_for_row(sample, row: int, crop: int) -> np.ndarray:
    """The ROI tensor production's sampler hands the head, for one object."""
    mask = torch.ones(sample["object_type"].shape[0], dtype=torch.bool)
    roi = sample_roi(
        sample["images"].unsqueeze(0),
        sample["boxes"].unsqueeze(0),
        mask.unsqueeze(0),
        sample["view"].unsqueeze(0),
        crop,
    )
    return roi.reshape(-1, crop, crop)[row].numpy().astype(np.float64)


def roi_expected(pre_d: np.ndarray, sample, global_tile: int, row: int, crop: int) -> np.ndarray:
    """EXPECTED_DIFF for the ROI: run production's sampler on the plane difference.

    ``grid_sample`` with bilinear weights is linear, so applying it to the plane
    difference is the correct idealisation - production's own ROI difference should
    equal this up to floating-point association alone, with no resampling loss
    budgeted in.
    """
    diff_stack = torch.zeros_like(sample["images"])
    diff_stack[global_tile, 0] = torch.from_numpy(np.asarray(pre_d, dtype=np.float32))
    mask = torch.ones(sample["object_type"].shape[0], dtype=torch.bool)
    roi = sample_roi(
        diff_stack.unsqueeze(0),
        sample["boxes"].unsqueeze(0),
        mask.unsqueeze(0),
        sample["view"].unsqueeze(0),
        crop,
    )
    return roi.reshape(-1, crop, crop)[row].numpy().astype(np.float64)


def target_row(sample, box: list[float]) -> int | None:
    """Which row of the object axis is this target."""
    for index, candidate in enumerate(sample["boxes"].tolist()):
        if all(abs(a - b) < 1e-6 for a, b in zip(candidate, box)):
            return index
    return None


# ---------------------------------------------------------------------------
# Per-fixture measurement
# ---------------------------------------------------------------------------


def _load_side(
    records: Path,
    views: Path,
    score_id: str,
    size: tuple[int, int],
    trims: dict[str, tuple[int, int, int, int]] | None,
):
    traces: dict[str, dict[str, Any]] = {score_id: {}}
    samples = load_dataset(
        records,
        views,
        size=size,
        traces=traces,
        trim_overrides={score_id: trims} if trims else None,
    )
    if not samples:
        return None, None
    return samples[0], traces[score_id]


def _box_geometry_per_stage(
    in_view: list[float],
    inset: tuple[float, float, float, float],
    source: tuple[int, int],
    trimmed: tuple[int, int],
    scaled: tuple[int, int],
    tile: dict[str, Any],
    plane_box: list[float],
    crop: int,
) -> dict[str, tuple[float, float, float, float]]:
    """Where production's target box sits in each stage's pixel grid.

    Returns ``(centre_x, centre_y, width, height)`` per stage. All the scale factors
    come from production's own trace - the insets, the scaled size, the tile's own
    start - so this reports where the box already is rather than re-deriving how it
    got there.

    Two things this gets right that an earlier version of this harness did not, both
    of which fabricate a placement failure that does not exist:

    - the **centre** of the box is used, not its left edge. Using the left edge put
      the box half its own width away from the glyph at every fractional stage, while
      the plane stages - which take the box straight from production - disagreed with
      it by exactly that half-width.
    - the inset is composed **once**. Composing it twice narrows the fraction twice,
      which moved the early stages by tens of pixels and again disagreed with the
      plane stages.
    """
    left, right = inset[0], 1.0 - inset[2]
    top, bottom = inset[1], 1.0 - inset[3]
    span_x = max(right - left, 1e-9)
    span_y = max(bottom - top, 1e-9)
    # `in_view` is a fraction of the whole crop; the inset says which part of the
    # crop survived the trim. The result is a fraction of the trimmed content, which
    # is also a fraction of the resized array because the resize is uniform.
    crop_cx = (in_view[0] + in_view[2]) / 2
    crop_cy = (in_view[1] + in_view[3]) / 2
    crop_w = in_view[2] - in_view[0]
    crop_h = in_view[3] - in_view[1]
    cx = (crop_cx - left) / span_x
    cy = (crop_cy - top) / span_y
    w = crop_w / span_x
    h = crop_h / span_y

    source_w, source_h = source
    trimmed_w, trimmed_h = trimmed
    scaled_w, scaled_h = scaled
    out: dict[str, tuple[float, float, float, float]] = {
        "PAGE": (crop_cx * source_w, crop_cy * source_h, crop_w * source_w, crop_h * source_h),
        "TRIMMED_CROP": (cx * trimmed_w, cy * trimmed_h, w * trimmed_w, h * trimmed_h),
        "RESIZED_ARRAY": (cx * scaled_w, cy * scaled_h, w * scaled_w, h * scaled_h),
        "TILE": (cx * scaled_w - float(tile["start"]), cy * scaled_h, w * scaled_w, h * scaled_h),
    }
    # The plane stages use production's own box, not a reconstruction of it.
    plane_w = 256.0
    box_w = (plane_box[2] - plane_box[0]) * plane_w
    box_h = (plane_box[3] - plane_box[1]) * 256.0
    out["SQUARE_PLANE"] = (
        (plane_box[0] + plane_box[2]) / 2 * plane_w,
        (plane_box[1] + plane_box[3]) / 2 * 256.0,
        box_w,
        box_h,
    )
    out["PRE_ROI"] = out["SQUARE_PLANE"]
    # The sampler lays `crop` samples across a 1.6-box field of view centred on the
    # box, so the box itself spans crop / 1.6 samples and sits at the grid's centre.
    out["FINAL_ROI"] = (crop / 2.0, crop / 2.0, crop / 1.6, crop / 1.6)
    return out


def _centroid(d: np.ndarray) -> tuple[float, float] | None:
    strong = d > HALF_CODE
    if not strong.any():
        return None
    cols = np.where(strong.any(0))[0]
    rows = np.where(strong.any(1))[0]
    return (float(cols.min() + cols.max()) / 2, float(rows.min() + rows.max()) / 2)


def _energy_in_window(d: np.ndarray, cx: float, cy: float, w: float, h: float) -> float | None:
    """Share of a stage's difference energy falling inside the box window.

    This is the question that actually matters at every stage: not "is there ink"
    but "is there *this glyph's* ink where the box says the glyph is". A stage can
    carry the signal perfectly and still contribute nothing to a head, because the
    head only ever sees the window.
    """
    total = float(d.sum())
    if total <= 0:
        return None
    height, width = d.shape
    x0 = max(0, int(round(cx - w / 2)))
    x1 = min(width, int(round(cx + w / 2)))
    y0 = max(0, int(round(cy - h / 2)))
    y1 = min(height, int(round(cy + h / 2)))
    if x1 <= x0 or y1 <= y0:
        return 0.0
    return round(float(d[y0:y1, x0:x1].sum()) / total, 6)


def _displacement(
    d: np.ndarray, cx: float, cy: float, w: float, h: float, extent: tuple[float, float]
) -> dict[str, Any]:
    """Offset from the box centre to the difference's own centre, in stage pixels.

    Reported alongside the normalised form because stage pixels are not comparable
    across stages: 80 array pixels and 80 plane pixels are not the same distance.
    """
    centre = _centroid(d)
    if centre is None:
        return {"dx": None, "dy": None, "dx_fraction": None, "dy_fraction": None}
    dx, dy = centre[0] - cx, centre[1] - cy
    return {
        "dx": round(dx, 3),
        "dy": round(dy, 3),
        "dx_fraction": round(dx / max(extent[0], 1e-9), 6),
        "dy_fraction": round(dy / max(extent[1], 1e-9), 6),
    }


def stage_diffs(
    a_tab: dict[str, Any],
    b_tab: dict[str, Any],
    local_tile: int,
    a_sample,
    b_sample,
    global_tile: int,
    row: int,
    crop: int,
    in_view: list[float],
    plane_box: list[float],
) -> dict[str, Any]:
    """Difference A against B at every production stage, plus EXPECTED controls."""
    stages: dict[str, Any] = {}

    # PAGE - the view PNG exactly as production first reads it, before any trim.
    page_d = np.abs(
        np.asarray(a_tab["source_grey"], np.float64)
        - np.asarray(b_tab["source_grey"], np.float64)
    ) / 255.0
    stages["PAGE"] = diff_metrics(page_d)

    # TRIMMED_CROP - production's post-trim array. Its expectation is the page
    # difference cropped by the same rect: a pure selection, so any discrepancy
    # here would mean the trim did not do what the trace says it did.
    crop_d = np.abs(
        np.asarray(a_tab["trimmed_grey"], np.float64)
        - np.asarray(b_tab["trimmed_grey"], np.float64)
    ) / 255.0
    trim = tuple(int(v) for v in a_tab["trim_applied"])
    stages["TRIMMED_CROP"] = diff_metrics(crop_d)
    stages["TRIMMED_CROP"]["expected"] = compare_actual_expected(
        crop_d, page_d[trim[1] : trim[3], trim[0] : trim[2]]
    )

    # RESIZED_ARRAY - the loader's LANCZOS resize onto the plane height.
    res_d = np.abs(
        np.asarray(a_tab["resized_array"], np.float64)
        - np.asarray(b_tab["resized_array"], np.float64)
    )
    scaled_w, scaled_h = a_tab["scaled_size"]
    stages["RESIZED_ARRAY"] = diff_metrics(res_d)
    stages["RESIZED_ARRAY"]["expected"] = compare_actual_expected(
        res_d, lanczos_float(crop_d, scaled_w, scaled_h)
    )

    # TILE - the slice the loader actually cut for the target's tile.
    a_tile, b_tile = a_tab["tiles"][local_tile], b_tab["tiles"][local_tile]
    strip_d = np.abs(
        np.asarray(a_tile["strip"], np.float64) - np.asarray(b_tile["strip"], np.float64)
    )
    stages["TILE"] = diff_metrics(strip_d)
    stages["TILE"]["expected"] = compare_actual_expected(
        strip_d, res_d[:, int(a_tile["start"]) : int(a_tile["end"])]
    )

    # SQUARE_PLANE - after the strip is resized into the plane.
    plane_d = np.abs(
        np.asarray(a_tile["plane"], np.float64) - np.asarray(b_tile["plane"], np.float64)
    )
    stages["SQUARE_PLANE"] = diff_metrics(plane_d)
    stages["SQUARE_PLANE"]["expected"] = compare_actual_expected(
        plane_d, lanczos_float(strip_d, plane_d.shape[1], plane_d.shape[0])
    )

    # PRE_ROI - the tensor the sampler will read, i.e. the model input plane.
    pre_d = np.abs(
        a_sample["images"][global_tile, 0].numpy().astype(np.float64)
        - b_sample["images"][global_tile, 0].numpy().astype(np.float64)
    )
    stages["PRE_ROI"] = diff_metrics(pre_d)
    stages["PRE_ROI"]["matches_square_plane"] = bool(
        pre_d.shape == plane_d.shape and np.allclose(pre_d, plane_d, atol=1e-6)
    )

    # FINAL_ROI - the tensor handed to the fret head. The endpoint.
    roi_a = roi_for_row(a_sample, row, crop)
    roi_b = roi_for_row(b_sample, row, crop)
    roi_d = np.abs(roi_a - roi_b)
    stages["FINAL_ROI"] = diff_metrics(roi_d)
    stages["FINAL_ROI"]["expected"] = compare_actual_expected(
        roi_d, roi_expected(pre_d, a_sample, global_tile, row, crop)
    )

    # ---- where the box is, against where the difference is --------------------
    box_geometry = _box_geometry_per_stage(
        in_view,
        a_tab["inset"],
        a_tab["source_size"],
        a_tab["trimmed_size"],
        a_tab["scaled_size"],
        a_tile,
        plane_box,
        crop,
    )
    arrays = {
        "PAGE": page_d,
        "TRIMMED_CROP": crop_d,
        "RESIZED_ARRAY": res_d,
        "TILE": strip_d,
        "SQUARE_PLANE": plane_d,
        "PRE_ROI": pre_d,
        "FINAL_ROI": roi_d,
    }
    for stage, d in arrays.items():
        cx, cy, bw, bh = box_geometry[stage]
        stages[stage]["box_centre_px"] = [round(cx, 2), round(cy, 2)]
        stages[stage]["box_size_px"] = [round(bw, 2), round(bh, 2)]
        stages[stage]["energy_in_box"] = _energy_in_window(d, cx, cy, bw, bh)
        stages[stage]["displacement"] = _displacement(
            d, cx, cy, bw, bh, (float(d.shape[1]), float(d.shape[0]))
        )

    # ---- DIAGNOSTIC: the ROI re-centred on the glyph --------------------------
    # Labelled separately and never pooled with the primary metrics. It answers a
    # question the primary ROI cannot: is the tensor blind to the glyph, or is the
    # window blind? Only one box is moved, by the offset measured above, and only
    # for this diagnostic.
    plane_c = _centroid(pre_d)
    plane_centre = box_geometry["PRE_ROI"][:2]
    if plane_c is not None:
        dx = plane_c[0] - plane_centre[0]
        dy = plane_c[1] - plane_centre[1]
        height, width = pre_d.shape
        moved = a_sample["boxes"].clone()
        moved[row, 0] += dx / width
        moved[row, 2] += dx / width
        moved[row, 1] += dy / height
        moved[row, 3] += dy / height
        moved_roi = _roi_with_boxes(a_sample, moved, row, crop)
        moved_b = b_sample["boxes"].clone()
        moved_b[row, 0] += dx / width
        moved_b[row, 2] += dx / width
        moved_b[row, 1] += dy / height
        moved_b[row, 3] += dy / height
        moved_roi_b = _roi_with_boxes(b_sample, moved_b, row, crop)
        moved_d = np.abs(moved_roi - moved_roi_b)
        stages["FINAL_ROI_ON_GLYPH"] = diff_metrics(moved_d)
        stages["FINAL_ROI_ON_GLYPH"]["is_diagnostic"] = True
        stages["FINAL_ROI_ON_GLYPH"]["shift_px"] = [round(dx, 2), round(dy, 2)]
        stages["roi_geometry"] = {
            "roi_crop_px": crop,
            "box_in_plane": [round(v, 6) for v in plane_box],
            "box_w_px": round((plane_box[2] - plane_box[0]) * width, 3),
            "box_h_px": round((plane_box[3] - plane_box[1]) * height, 3),
            # The sampler takes a fixed field of view of 1.6 boxes and lays `crop`
            # samples across it, so this is the plane footprint per ROI sample.
            "roi_span_px": [
                round((plane_box[2] - plane_box[0]) * width * 1.6, 3),
                round((plane_box[3] - plane_box[1]) * height * 1.6, 3),
            ],
            "glyph_shift_px": [round(dx, 2), round(dy, 2)],
        }
    else:
        stages["FINAL_ROI_ON_GLYPH"] = {"comparable": False, "reason": "no plane difference"}
        stages["roi_geometry"] = None
    return stages


def _roi_with_boxes(sample, boxes, row: int, crop: int) -> np.ndarray:
    mask = torch.ones(sample["object_type"].shape[0], dtype=torch.bool)
    roi = sample_roi(
        sample["images"].unsqueeze(0),
        boxes.unsqueeze(0),
        mask.unsqueeze(0),
        sample["view"].unsqueeze(0),
        crop,
    )
    return roi.reshape(-1, crop, crop)[row].numpy().astype(np.float64)


def measure(
    record: dict[str, Any],
    svg_text: str,
    fixture: dict[str, Any],
    fixture_dir: Path,
    size: tuple[int, int],
    crop: int,
    pinned: bool,
) -> dict[str, Any]:
    """Gate one A/B pair, then difference it if - and only if - the gate passes."""
    score_id = fixture["fixture_id"]
    a_records, a_views = fixture_dir / "A" / "records", fixture_dir / "A" / "views"
    b_records, b_views = fixture_dir / "B" / "records", fixture_dir / "B" / "views"

    # The views on disk are named for the fixture, so the record handed to the
    # builder has to carry the fixture's scoreId too. Passing the original would
    # make every lookup miss, and `build_sample` reports a miss by returning
    # nothing at all - a silent empty result, not an error.
    local = dict(record)
    local["scoreId"] = score_id

    a_sample, a_traces = _load_side(a_records, a_views, score_id, size, None)
    b_sample, b_traces = _load_side(b_records, b_views, score_id, size, None)
    if a_sample is None or b_sample is None:
        return {"fixture": fixture, "ok": False, "reason": "load failed"}

    trims_differ = any(
        tuple(a_traces[v]["trim_applied"]) != tuple(b_traces[v]["trim_applied"])
        for v in VIEW_NAMES
        if v in a_traces and v in b_traces
    )
    used_pin = False
    if pinned and trims_differ:
        pinned_trims = {v: tuple(a_traces[v]["trim_applied"]) for v in VIEW_NAMES if v in a_traces}
        b_sample, b_traces = _load_side(b_records, b_views, score_id, size, pinned_trims)
        used_pin = True
        if b_sample is None:
            return {"fixture": fixture, "ok": False, "reason": "pinned reload failed"}

    a_tab, b_tab = a_traces[TABS], b_traces[TABS]
    gate = {
        "source_dims_equal": a_tab["source_size"] == b_tab["source_size"],
        "trim_equal": tuple(a_tab["trim_applied"]) == tuple(b_tab["trim_applied"]),
        "trim_a": [int(v) for v in a_tab["trim_applied"]],
        "trim_b": [int(v) for v in b_tab["trim_applied"]],
        "trimmed_dims_equal": a_tab["trimmed_size"] == b_tab["trimmed_size"],
        "scaled_dims_equal": a_tab["scaled_size"] == b_tab["scaled_size"],
        "plane_count_equal": a_tab["plane_count"] == b_tab["plane_count"],
        "tile_rects_equal": [t["rect"] for t in a_tab["tiles"]] == [t["rect"] for t in b_tab["tiles"]],
    }
    if all(v for k, v in gate.items() if k.endswith("_equal")):
        klass = 1
    elif not gate["trim_equal"]:
        klass = 2
    else:
        klass = 3

    rects_a = [tuple(t["rect"]) for t in a_tab["tiles"]]
    rects_b = [tuple(t["rect"]) for t in b_tab["tiles"]]
    a_where = locate_target(local, a_views, size, fixture["object_index"])
    b_where = locate_target(local, b_views, size, fixture["object_index"])
    tile_equal = bool(a_where and b_where and a_where["tile"] == b_where["tile"])
    box_equal = bool(a_where and b_where and a_where["box"] == b_where["box"])
    rect_equal = bool(
        a_where
        and b_where
        and tile_equal
        and rects_a[a_where["tile"] - tab_offset(a_traces)]
        == rects_b[b_where["tile"] - tab_offset(b_traces)]
    )

    out: dict[str, Any] = {
        "fixture": fixture,
        "ok": True,
        "class": klass,
        "pinned_trim_used": used_pin,
        "gate": gate,
        "tile": {
            "index_a": a_where["tile"] if a_where else None,
            "index_b": b_where["tile"] if b_where else None,
            "index_equal": tile_equal,
            "rect_equal": rect_equal,
            "box_equal": box_equal,
            "string": a_where["string"] if a_where else None,
        },
    }

    if a_where is None:
        # Production placed no box for this target: `plane_box` refused it in every
        # tile, which is its documented behaviour for a box crossing a tile edge.
        # That is a real production outcome, not an A/B disagreement, so it is
        # counted separately from the tile-identity assertion.
        out["stages"] = None
        out["dropped"] = "target not placed by production"
        return out
    if not (tile_equal and rect_equal and box_equal):
        out["stages"] = None
        out["dropped"] = "tile identity failed"
        return out
    if klass == 2 and not used_pin:
        out["stages"] = None
        out["dropped"] = "CLASS 2: trim differs, natural outputs not differenced"
        return out
    if klass == 3 and not used_pin:
        out["stages"] = None
        out["dropped"] = "CLASS 3: layout differs beyond the trim"
        return out

    local_tile = a_where["tile"] - tab_offset(a_traces)
    row = target_row(a_sample, a_where["box"])
    if row is None:
        out["stages"] = None
        out["dropped"] = "target row not found in the loaded sample"
        return out
    out["local_tile"] = local_tile
    out["object_row"] = row
    # The box as the loader's own view frame expresses it, for the displacement
    # measurement. Production computes this same value inside build_sample; here it
    # is only read, to compare where the box is against where the ink is.
    # The un-composed fraction of the view *crop*. The trim inset is applied once,
    # in `_box_geometry_per_stage`, against the same inset production reports.
    # Composing it here as well measures a box that is inset-compounded twice, which
    # reads as a placement failure that does not exist - the plane stages, which use
    # production's own box, are unaffected and disagree with it.
    in_view = page_box_to_view(
        next(o for o in local["objects"] if o["index"] == fixture["object_index"])["box"],
        view_rect(local, True),
    )
    out["in_view"] = in_view
    out["mechanism"] = mechanism(
        local, svg_text, fixture["target_index"], score_id, a_views, b_views, in_view
    )
    out["stages"] = stage_diffs(
        a_tab,
        b_tab,
        local_tile,
        a_sample,
        b_sample,
        a_where["tile"],
        row,
        crop,
        in_view,
        a_where["box"],
    )
    return out


def mechanism(
    record: dict[str, Any],
    svg_text: str,
    target_index: int,
    fixture_id: str,
    a_views: Path,
    b_views: Path,
    in_view: list[float],
    units_to_px: float = 0.2,
) -> dict[str, Any]:
    """Separate "the render moved the glyph" from "the box points elsewhere".

    Two independent predictions are compared against the same measured difference:

    ``render``
        Where the SVG's own declared position lands in the TAB view, from the
        production crop geometry with the document's content transform applied. If
        this matches the measurement, the render and the crop are faithful and the
        glyph is exactly where the SVG says it is.

    ``box``
        Where production's target box lands in the same view, same units.

    The gap is the defect. Before the coordinate fix it was 505-2212 layout units;
    after it, both predictions should agree to within raster rounding, and any
    remaining gap is reported rather than explained away.
    """
    matrix = record_transform(record)
    band = next(b for b in record["bands"] if b.get("isTab"))
    crop = band.get("cropUnits") or band["boxUnits"]
    x0 = int(round(float(crop[0]) * units_to_px))
    y0 = int(round(float(crop[1]) * units_to_px))

    declared = semantic_targets(svg_text)[target_index]
    # Read out of the SVG, not assumed: the same extractor the engraver used.
    render_x, render_y = _apply(
        matrix, declared["x"], declared["baseline"] - declared["font"] * 0.36
    )

    a = np.asarray(Image.open(a_views / TABS / f"{fixture_id}.png").convert("L"), np.int32)
    b = np.asarray(Image.open(b_views / TABS / f"{fixture_id}.png").convert("L"), np.int32)
    mask = np.abs(a - b) > 0
    if not mask.any():
        return {"render_error_px": None, "box_error_px": None, "box_error_units": None}
    rows = np.where(mask.any(1))[0]
    cols = np.where(mask.any(0))[0]
    measured_x = float(cols.min() + cols.max()) / 2
    measured_y = float(rows.min() + rows.max()) / 2
    box_x = (in_view[0] + in_view[2]) / 2 * a.shape[1]
    box_y = (in_view[1] + in_view[3]) / 2 * a.shape[0]
    return {
        "render_error_px": [
            round(measured_x - (render_x * units_to_px - x0), 2),
            round(measured_y - (render_y * units_to_px - y0), 2),
        ],
        "box_error_px": [round(measured_x - box_x, 2), round(measured_y - box_y, 2)],
        "box_error_units": [
            round((measured_x - box_x) / units_to_px, 1),
            round((measured_y - box_y) / units_to_px, 1),
        ],
        "crop_width_px": int(a.shape[1]),
        "content_translate": [matrix[4], matrix[5]],
    }


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

STAGE_ORDER = (
    "PAGE",
    "TRIMMED_CROP",
    "RESIZED_ARRAY",
    "TILE",
    "SQUARE_PLANE",
    "PRE_ROI",
    "FINAL_ROI",
)


def _median(values: list[float]) -> float | None:
    clean = [v for v in values if v is not None]
    return round(float(np.median(clean)), 6) if clean else None


def summarise(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Reduce the per-fixture rows to the report, keeping pools separate.

    ``primary`` is CLASS 1 only and never pooled with the pinned-trim diagnostic.
    The two answer different questions and averaging them would manufacture a
    number that describes neither.
    """
    def outcome(r: dict[str, Any]) -> str:
        if not r.get("ok"):
            return "load_failed"
        if r.get("stages"):
            return "measured"
        return r.get("dropped", "unknown")

    usable = [
        r for r in rows
        if r.get("ok") and r.get("stages") and r["class"] == 1 and not r.get("pinned_trim_used")
    ]
    pinned = [r for r in rows if r.get("ok") and r.get("stages") and r.get("pinned_trim_used")]
    outcomes: dict[str, int] = {}
    for r in rows:
        key = outcome(r)
        outcomes[key] = outcomes.get(key, 0) + 1

    report: dict[str, Any] = {
        "fixture_count": len(rows),
        "class_1": sum(1 for r in rows if r.get("class") == 1),
        "class_2": sum(1 for r in rows if r.get("class") == 2),
        "class_3": sum(1 for r in rows if r.get("class") == 3),
        "outcomes": outcomes,
        "primary_fixtures": len(usable),
        "pinned_trim_fixtures": len(pinned),
        "held_out_primary": sum(1 for r in usable if r["fixture"].get("held_out")),
    }

    for label, group in (("primary", usable), ("pinned_trim", pinned)):
        if not group:
            report[label] = None
            continue
        block: dict[str, Any] = {"n": len(group)}
        for stage in STAGE_ORDER:
            block[stage] = {
                key: _median([r["stages"][stage].get(key) for r in group])
                for key in ("nonzero", "zero_rate", "mean_abs", "max_abs",
                            "norm_l1_per_sample", "eff_w", "eff_h")
            }
        # Retention is measured against EXPECTED_DIFF, not against the previous
        # stage's raw count. ACTUAL/EXPECTED = 1 means the operation moved the
        # signal exactly as an ideal linear resample of that same signal would
        # have, which is the only comparison that survives a change of resolution.
        block["retention_actual_over_expected"] = {}
        for stage in STAGE_ORDER:
            ratios = []
            for r in group:
                stage_row = r["stages"][stage]
                if "expected" not in stage_row:
                    continue
                actual = stage_row.get("l1") or 0.0
                expected = stage_row.get("expected", {}).get("expected_l1")
                if expected:
                    ratios.append(actual / expected)
            block["retention_actual_over_expected"][stage] = _median(ratios)
        block["per_sample_ratio_vs_previous"] = {
            stage: (
                1.0
                if index == 0
                else _median([
                    (r["stages"][stage].get("norm_l1_per_sample") or 0)
                    / (r["stages"][STAGE_ORDER[index - 1]].get("norm_l1_per_sample") or 1)
                    for r in group
                    if (r["stages"][stage].get("norm_l1_per_sample") or 0) > 0
                ])
            )
            for index, stage in enumerate(STAGE_ORDER)
        }
        block["actual_vs_expected"] = {
            stage: {
                key: _median([
                    r["stages"][stage]["expected"].get(key) for r in group
                    if "expected" in r["stages"][stage]
                ])
                for key in ("mae", "max", "norm_l1_discrepancy")
            }
            for stage in STAGE_ORDER
            if any("expected" in r["stages"][stage] for r in group)
        }
        # Where the box is, against where the difference is. Normalised by the
        # stage extent, because stage pixels are not comparable between stages.
        block["displacement_fraction"] = {
            stage: {
                key: _median([
                    r["stages"][stage]["displacement"].get(key) for r in group
                ])
                for key in ("dx_fraction", "dy_fraction")
            }
            for stage in STAGE_ORDER
        }
        block["displacement_px"] = {
            stage: {
                key: _median([r["stages"][stage]["displacement"].get(key) for r in group])
                for key in ("dx", "dy")
            }
            for stage in STAGE_ORDER
        }
        block["energy_in_box"] = {
            stage: _median([r["stages"][stage].get("energy_in_box") for r in group])
            for stage in STAGE_ORDER
        }
        block["bottom_edge_share"] = {
            stage: _median([r["stages"][stage]["bottom"]["bottom_share"] for r in group])
            for stage in STAGE_ORDER
        }
        block["extent_rows"] = {
            stage: _median([r["stages"][stage]["bottom"]["rows"] for r in group])
            for stage in STAGE_ORDER
        }
        diagnostic = [r for r in group if "FINAL_ROI_ON_GLYPH" in r["stages"]]
        if diagnostic:
            block["final_roi_on_glyph"] = {
                key: _median([r["stages"]["FINAL_ROI_ON_GLYPH"].get(key) for r in diagnostic])
                for key in ("nonzero", "max_abs", "mean_abs", "norm_l1_per_sample",
                            "eff_w", "eff_h", "zero_rate")
            }
            block["final_roi_on_glyph"]["note"] = (
                "DIAGNOSTIC, never pooled with FINAL_ROI: the same production ROI "
                "sampler run with the target box translated by the offset measured "
                "at PRE_ROI. It separates 'the tensor is blind to the glyph' from "
                "'the window is not on the glyph'."
            )
        block["roi_geometry"] = {
            key: _median([
                r["stages"]["roi_geometry"][key] for r in group if r["stages"].get("roi_geometry")
            ])
            for key in ("box_w_px", "box_h_px")
        } if any(r["stages"].get("roi_geometry") for r in group) else None
        block["roi_span_px"] = {
            axis: _median([
                r["stages"]["roi_geometry"]["roi_span_px"][i]
                for r in group if r["stages"].get("roi_geometry")
            ])
            for i, axis in enumerate(("x", "y"))
        } if any(r["stages"].get("roi_geometry") for r in group) else None
        block["by_digit_count"] = {
            str(count): {
                "n": sum(1 for r in group if r["fixture"]["digits"] == count),
                "page_median_nonzero": _median([
                    r["stages"]["PAGE"]["nonzero"] for r in group if r["fixture"]["digits"] == count
                ]),
                "square_plane_median_nonzero": _median([
                    r["stages"]["SQUARE_PLANE"]["nonzero"] for r in group if r["fixture"]["digits"] == count
                ]),
                "final_roi_median_nonzero": _median([
                    r["stages"]["FINAL_ROI"]["nonzero"] for r in group if r["fixture"]["digits"] == count
                ]),
                "final_roi_on_glyph_median_nonzero": _median([
                    r["stages"].get("FINAL_ROI_ON_GLYPH", {}).get("nonzero")
                    for r in group if r["fixture"]["digits"] == count
                ]),
            }
            for count in sorted({r["fixture"]["digits"] for r in group})
        }
        report[label] = block

    mech = [r.get("mechanism") for r in usable if r.get("mechanism")]
    if mech:
        report["mechanism"] = {
            "n": len(mech),
            "render_error_px_median": [
                _median([m["render_error_px"][0] for m in mech if m.get("render_error_px")]),
                _median([m["render_error_px"][1] for m in mech if m.get("render_error_px")]),
            ],
            "render_error_px_p90_abs": [
                _median([
                    abs(m["render_error_px"][0]) for m in mech if m.get("render_error_px")
                ]),
                _median([
                    abs(m["render_error_px"][1]) for m in mech if m.get("render_error_px")
                ]),
            ],
            "box_error_units_median": [
                _median([m["box_error_units"][0] for m in mech if m.get("box_error_units")]),
                _median([m["box_error_units"][1] for m in mech if m.get("box_error_units")]),
            ],
            "box_error_units_range": [
                [
                    round(min(m["box_error_units"][0] for m in mech if m.get("box_error_units")), 1),
                    round(max(m["box_error_units"][0] for m in mech if m.get("box_error_units")), 1),
                ],
                [
                    round(min(m["box_error_units"][1] for m in mech if m.get("box_error_units")), 1),
                    round(max(m["box_error_units"][1] for m in mech if m.get("box_error_units")), 1),
                ],
            ],
            "content_translate_units": [
                _median([m["content_translate"][0] for m in mech if m.get("content_translate")]),
                _median([m["content_translate"][1] for m in mech if m.get("content_translate")]),
            ],
            "box_error_units_after_subtracting_translate": [
                _median([
                    m["box_error_units"][0] - m["content_translate"][0]
                    for m in mech if m.get("box_error_units") and m.get("content_translate")
                ]),
                _median([
                    m["box_error_units"][1] - m["content_translate"][1]
                    for m in mech if m.get("box_error_units") and m.get("content_translate")
                ]),
            ],
        }

    if usable:
        held = [r for r in usable if r["fixture"].get("held_out")]
        report["held_out_primary_n"] = len(held)
        report["held_out_primary_metrics"] = {
            stage: {
                key: _median([r["stages"][stage].get(key) for r in held])
                for key in ("nonzero", "mean_abs", "max_abs", "eff_w", "eff_h")
            }
            for stage in STAGE_ORDER
        } if held else None
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=_REPO / "datasets/guitar-vision/synthetic/train")
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--root", type=Path, default=_REPO / "tmp/gvprobe/paired")
    parser.add_argument("--tmp", type=Path, default=_REPO / "tmp/gvprobe/render")
    parser.add_argument("--scores", type=int, default=24)
    parser.add_argument("--per-score", type=int, default=3)
    parser.add_argument("--held-out-every", type=int, default=6)
    parser.add_argument("--size", type=int, default=256)
    parser.add_argument("--crop", type=int, default=32)
    parser.add_argument("--pinned-trim", action="store_true")
    parser.add_argument(
        "--regenerate-svg",
        action="store_true",
        help="re-derive missing corpus SVGs with production's engraver, into tmp",
    )
    parser.add_argument("--keep-artifacts", action="store_true")
    args = parser.parse_args()

    corpus = args.corpus
    args.tmp.mkdir(parents=True, exist_ok=True)
    args.root.mkdir(parents=True, exist_ok=True)

    # Only 12 of the 60 corpus SVGs survive on disk. Rather than run the study on
    # 12 scores, the missing ones are re-derived with production's own engraver
    # straight from the committed MusicXML, into tmp and never into the corpus. The
    # guard is `a_side_reproduces_committed_corpus` below: if a re-derived SVG did
    # not render back to the committed view byte for byte, the fixture using it
    # would be reported as a mismatch and is not evidence.
    svg_cache: dict[str, str] = {}
    records: list[tuple[Path, dict[str, Any], str]] = []
    regenerated: list[str] = []
    for path in sorted((corpus / "records").glob("*.record.json"))[: args.scores]:
        record = json.loads(path.read_text())
        score_id = record["scoreId"]
        svg_path = corpus / "svg" / f"{score_id}.svg"
        if svg_path.exists():
            svg_cache[score_id] = svg_path.read_text()
        elif args.regenerate_svg:
            musicxml = corpus / f"{score_id}.musicxml"
            if not musicxml.exists():
                continue
            svg_cache[score_id] = rc.render_score(musicxml).svg
            regenerated.append(score_id)
        else:
            continue
        records.append((path, record, svg_cache[score_id]))

    fixtures = choose_fixtures(records, args.per_score, args.held_out_every)
    print(f"scores {len(records)} | svgs regenerated {len(regenerated)} | fixtures {len(fixtures)}")

    a_cache: dict[str, dict[str, Any]] = {}
    rows: list[dict[str, Any]] = []
    committed_checks: list[dict[str, Any]] = []
    try:
        for number, fixture in enumerate(fixtures, 1):
            record = next(r for r in records if r[1]["scoreId"] == fixture["score"])
            fixture_id = f"{fixture['score']}__t{fixture['target_index']}"
            fixture["fixture_id"] = fixture_id
            fixture_dir = args.root / fixture_id
            if fixture_dir.exists():
                shutil.rmtree(fixture_dir)
            a_records, _b_records, info = build_pair(
                record[1], record[2], fixture["target_index"], fixture_id,
                fixture_dir, args.tmp, corpus, a_cache,
            )
            fixture["carried_views"] = info["carried_b"]
            committed_checks.append(
                {"fixture_id": fixture_id, "a_matches_committed": info["a_matches_committed"]}
            )
            row = measure(
                record[1], record[2], fixture, fixture_dir,
                (args.size, args.size), args.crop, args.pinned_trim,
            )
            rows.append(row)
            if not args.keep_artifacts:
                shutil.rmtree(fixture_dir, ignore_errors=True)
            if number % 5 == 0 or number == len(fixtures):
                stage = "ok" if row.get("ok") else "FAIL"
                roi = (row.get("stages") or {}).get("FINAL_ROI", {}).get("nonzero")
                print(
                    f"  {number:>3}/{len(fixtures)} {fixture_id[-26:]:<26} "
                    f"class {row.get('class')} {stage} roi_nonzero {roi}"
                )
    finally:
        shutil.rmtree(args.tmp, ignore_errors=True)

    report = summarise(rows)
    re_rendered = {
        entry["fixture_id"]: entry["a_matches_committed"] for entry in committed_checks
    }
    checked = {
        kind: sum(1 for value in re_rendered.values() if value.get(kind) is True)
        for kind in ("full-page", "notation", "tab")
    }
    mismatched = sorted(
        fixture for fixture, value in re_rendered.items() if value.get("tab") is False
    )
    report["a_side_reproduces_committed_corpus"] = {
        "fixtures_checked": len(re_rendered),
        "scores_used": len(records),
        "svgs_regenerated": len(regenerated),
        "byte_identical": checked,
        "tab_mismatches": mismatched,
        "carried_kinds_not_re_rendered": sorted(
            {k for r in rows for k in r["fixture"].get("carried_views", [])}
        ),
    }
    report["config"] = {
        "plane": args.size,
        "roi_crop": args.crop,
        "per_score": args.per_score,
        "held_out_every": args.held_out_every,
        "pinned_trim": args.pinned_trim,
        "scores": len(records),
    }
    payload = {"report": report, "fixtures": rows}
    print(json.dumps(report, indent=2)[:6000])
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(payload, indent=2) + "\n")
        print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())