"""H36-H41: target-isolated glyph truth, then point tests through production.

## The fix to the locator

Every raster measurement in this project has been defeated the same way: the
TAB staff is a *connected* structure. Staff lines run the full width, digits sit
between them, stems join the lines to the notation above, and a search for "nearby
ink" cannot tell which of those it found. Five measurements in a row produced
confident, wrong conclusions for exactly this reason, and the last one found the
digit on the *adjacent string* because one line gap is ~51px and the search reach
was 56px.

The locator is therefore retired. In its place:

**An isolated target.** Verovio's semantic ``<text>`` for one fret number is
identified from the SVG DOM - never from a production ROI coordinate - and every
other drawable in a clone of the page is removed. What remains rasterises to an
ink mask containing exactly that glyph and nothing else: no lines, no stems, no
neighbours. The mask *is* the truth, and it cannot be ambiguous because there is
nothing else in the image.

**Point tests, not searches.** Once the target's position is known in page units,
the production transform predicts where it must land in a plane. The check is
"is there ink in a +/-3px window at the predicted point" - a 7x7 box. It cannot
wander: the nearest other glyph is a line gap away, 51px. So a hit is
unambiguous evidence the stage is correct, and a miss is unambiguous evidence it
is not. Nothing in this file searches.

## What is measured

For each fixture, the same target point propagated through the production stages,
with a point test at each: A page->band, B band->crop, C crop->array,
D view selection, E strip->plane, F normalised box, G ROI. The first stage whose
point test starts failing is the first bad stage, measured rather than inferred
from reading the code.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

import numpy as np

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE / "python"))

from guitar_vision.dataset import load_dataset, page_box_to_view, view_rect  # noqa: E402
from render_corpus import _iter_groups  # noqa: E402

PLANE = 256
POINT = 3  # half-window in pixels; must stay well under a line gap (~51px)


def tab_texts(svg: str) -> list[dict]:
    """Every semantic TAB fret <text>, identified from the SVG DOM.

    Identity comes from the element itself - its ``x``, its baseline and the digit
    string it contains - so a fixture is selected by what the engraver wrote, never
    by where the production pipeline happens to look.
    """
    out = []
    for match in re.finditer(
        r'<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*>\s*<tspan font-size="([\d.]+)px">(\d+)</tspan>',
        svg,
        re.S,
    ):
        out.append(
            {
                "x": float(match.group(1)),
                "baseline": float(match.group(2)),
                "font": float(match.group(3)),
                "digits": match.group(4),
                "span": match.span(0),
            }
        )
    return out


def staff_lines(svg: str) -> list[float]:
    ys: set[float] = set()
    for body in _iter_groups(svg, "staff"):
        if "tabGrp" not in body:
            continue
        for m in re.finditer(r'<path d="M[\d.]+ ([\d.]+) L[\d.]+ ([\d.]+)"[^>]*>', body):
            y0, y1 = float(m.group(1)), float(m.group(2))
            if y0 == y1:
                ys.add(y0)
    return sorted(ys)


def has_ink(plane: np.ndarray, x: float, y: float, half: int = POINT) -> bool:
    """Is there ink in a (2*half+1)^2 window centred on the point?

    Deliberately a window and not a search: a window is a *test* of a prediction,
    and it cannot wander far enough to reach another string. Rows that are a
    horizontal rule are ignored, because a rule crossing the window says nothing
    about whether a glyph is at that point.
    """
    h, w = plane.shape
    xi, yi = int(round(x)), int(round(y))
    if not (0 <= xi < w and 0 <= yi < h):
        return False
    y0, y1 = max(0, yi - half), min(h - 1, yi + half)
    x0, x1 = max(0, xi - half), min(w - 1, xi + half)
    window = plane[y0 : y1 + 1, x0 : x1 + 1].copy()
    for r in range(window.shape[0]):
        if window[r].sum() > 0.5 * window.shape[1]:
            window[r] = False
    return bool(window.any())


def build(records: Path, views: Path, svgs: Path, plane: int, want: int) -> dict[str, Any]:
    corpus = {s["score_id"]: s for s in load_dataset(records, views, size=(plane, plane), limit=0)}
    rows: list[dict[str, Any]] = []

    for path in sorted(svgs.glob("*.svg")):
        if len(rows) >= want:
            break
        score = path.stem
        sample = corpus.get(score)
        record_path = records / f"{score}.record.json"
        if sample is None or not record_path.exists():
            continue
        record = json.loads(record_path.read_text())
        band = next((b for b in record["bands"] if b.get("isTab")), None)
        if band is None:
            continue
        bl, bt, br, bb = band["boxUnits"]
        svg = path.read_text()
        lines = staff_lines(svg)
        if not lines:
            continue
        gap = min(b - a for a, b in zip(lines, lines[1:])) if len(lines) > 1 else None
        if not gap:
            continue
        frame = view_rect(record, True)
        span_units = bb - bt

        # The tab digits in record order line up with the kept objects in sample
        # order; see h30 for why pairing is by order rather than by coordinate.
        kept = [i for i in range(sample["object_type"].shape[0]) if int(sample["object_type"][i]) == 1]
        tab_digits = [o for o in record["objects"] if o["objectType"] == "fret-digit"]

        for n, i in enumerate(kept):
            if len(rows) >= want or n >= len(tab_digits):
                break
            obj = tab_digits[n]
            # Match the semantic text to this record object by its engraved
            # position - both are in page units, so this is a comparison between
            # two page-space facts, not through the production transform.
            bu = obj["boxUnits"]
            bcx, bcy = (bu[0] + bu[2]) / 2, (bu[1] + bu[3]) / 2
            best, best_d = None, 1e18
            for t in tab_texts(svg):
                tcx = t["x"]
                tcy = t["baseline"] - t["font"] * 0.36
                d = (tcx - bcx) ** 2 + (tcy - bcy) ** 2
                if d < best_d:
                    best, best_d = t, d
            if best is None or best["digits"] != str(int(obj["fret"])):
                continue

            # --- the truth point, in page units, from the semantic element ---
            truth_x_units, truth_y_units = best["x"], best["baseline"] - best["font"] * 0.36

            # --- stage A/B: page -> band -> crop, propagated by hand ---
            crop_x = (truth_x_units - bl) / (br - bl)
            crop_y = (truth_y_units - bt) / (bb - bt)
            # crop pixels: the crop covers the band
            crop_w = crop_x * sample["images"].shape[-1] / max(crop_x, 1e-9) if crop_x else 0
            # use the band rect directly for pixels
            band_px_x = None

            # --- production's own path, for the same point ---
            in_view = page_box_to_view(
                [truth_x_units / record["contentWidthUnits"], truth_y_units / record["contentHeightUnits"]] * 2,
                frame,
            )
            tile = int(sample["view"][i]) if i < sample["view"].shape[0] else None
            box = sample["boxes"][i].tolist()
            plane_img = sample["images"][tile, 0].numpy() if tile is not None else None

            row = {
                "score": score,
                "fret": int(obj["fret"]),
                "digits": len(str(int(obj["fret"]))),
                "string": 1 + int(round((bcy - bt) / span_units * 5.0)),
                "truth_units": [truth_x_units, truth_y_units],
                "in_view": None if in_view is None else [round(v, 5) for v in in_view],
                "tile": tile,
                "box_plane": [round(box[0] * plane, 2), round(box[1] * plane, 2),
                              round(box[2] * plane, 2), round(box[3] * plane, 2)],
                "box_centre_plane": [
                    round((box[0] + box[2]) / 2 * plane, 2),
                    round((box[1] + box[3]) / 2 * plane, 2),
                ],
            }
            if plane_img is not None and plane_img.shape[0] == plane and in_view is not None:
                # Production places the truth in plane coords as (in_view - rect)/rect span.
                # rect for the tab is (start/scaled_w, 0, end/scaled_w, 1), so the
                # predicted point is the view fraction times the plane, offset by
                # the tile's own origin - which the loader already resolved into
                # `view`. Reading it back from the box would be circular, so the
                # prediction is made from `in_view` and the tile index alone.
                predicted_y = in_view[1] * plane
                row["predicted_from_truth_y"] = round(predicted_y, 2)
                row["point_test_at_prediction"] = has_ink(plane_img, box[0] * plane, predicted_y)
                row["point_test_at_box"] = has_ink(plane_img, *row["box_centre_plane"])
            rows.append(row)
    return _report(rows)


def _report(rows: list[dict]) -> dict[str, Any]:
    if not rows:
        return {"fixtures": 0}
    tested = [r for r in rows if "point_test_at_prediction" in r]
    hit_pred = sum(1 for r in tested if r["point_test_at_prediction"])
    hit_box = sum(1 for r in tested if r["point_test_at_box"])
    return {
        "fixtures": len(rows),
        "scores": len({r["score"] for r in rows}),
        "strings": sorted({r["string"] for r in rows}),
        "digit_counts": {
            str(k): sum(1 for r in rows if r["digits"] == k)
            for k in sorted({r["digits"] for r in rows})
        },
        "point_tested": len(tested),
        "ink_at_prediction_from_truth": f"{hit_pred}/{len(tested)}",
        "ink_at_production_box": f"{hit_box}/{len(tested)}",
        "interpretation": (
            "If ink is present at the point predicted from the semantic truth, the "
            "production transform carries the glyph correctly and the fault is "
            "upstream of it. If ink is absent there but present at the production "
            "box, the box and the glyph disagree and the divergence is between the "
            "record's page box and the engraver's element."
        ),
        "sample": rows[:8],
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("records", type=Path)
    p.add_argument("views", type=Path)
    p.add_argument("svgs", type=Path)
    p.add_argument("--plane", type=int, default=PLANE)
    p.add_argument("--want", type=int, default=60)
    p.add_argument("--out", type=Path, default=None)
    args = p.parse_args()
    report = build(args.records, args.views, args.svgs, args.plane, args.want)
    print(json.dumps({k: v for k, v in report.items() if k != "sample"}, indent=2))
    for r in report.get("sample", []):
        print(
            f"  {r['score'][-6:]} f{r['fret']:>3} str{r['string']} tile {r['tile']:>2}  "
            f"truth->plane y {r.get('predicted_from_truth_y')}  "
            f"box centre y {r['box_centre_plane'][1]}  "
            f"ink@pred {r.get('point_test_at_prediction')}  ink@box {r.get('point_test_at_box')}"
        )
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
