"""H28-H33: the vertical trace, and an error shape that must be predicted.

## What this measures and why residual, not raw error

The +33px figure was the distance from the box centre to the nearest digit ink.
Two things sit between those quantities, and only one of them is a bug:

  1. A font box and visible ink are different physical objects. Verovio's digit box
     runs from 0.895em above the baseline to 0.247em below it - the second half of
     which a digit never inks, because digits have no descender. So the box centre
     is *systematically* above the ink centre by a fixed amount, on every digit,
     and that is engraving convention rather than a defect.
  2. Everything the production pipeline does afterwards.

So the raw 33px is not a bug measurement. What is measured here is a **residual**:
the production box centre in the plane, minus the ink centre in the *same* plane,
with the ink located independently of the production box. Any remaining structure
in that residual belongs to the pipeline.

## Why the residual is fitted rather than eyeballed

A median of 33 with a p90 of 155 is not an offset - an offset cannot exceed the
box, and the box is 51px tall. The magnitude scales, so one of the pipeline's
vertical *scales* or *origins* is wrong, and the fit is what says which:

    residual ~ string index        a staff-line spacing error
    residual ~ relative band y     a band/crop scale composition error
    residual stepwise by tile      a view-assignment or view-origin error
    residual ~ trim fraction       the inset composition
    actual = a * expected + b      a scale (a) or origin (b) error

## Derive on two thirds, verify on one third

Several hypotheses here have already been retracted after measurement, so the
fixtures are split: the first two thirds derive the relationship and the held-out
third is only allowed to confirm it. A fit that does not also explain the held-out
fixtures is reported as not proven, whatever it looks like on the data it was
derived from.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE / "python"))
sys.path.insert(0, str(_HERE.parent))

from guitar_vision.dataset import (  # noqa: E402
    load_dataset,
    page_box_to_view,
    plane_box,
    view_rect,
)
from h21_glyph_truth import _digit_gap, mask_lines, staff_lines  # noqa: E402

PLANE = 256


def ink_centre_in_plane(plane: np.ndarray, guess: tuple[float, float], reach: int) -> tuple[float, float] | None:
    """Digit ink centre in a plane, found without using the production box.

    Horizontal rules are blanked first: on an engraved staff they span the full
    width, so a search that does not remove them returns the rule.
    """
    out = plane.copy()
    rules = np.where(out.sum(1) > 0.5 * out.shape[1])[0]
    for r in rules:
        for d in (-2, -1, 0, 1, 2):
            if 0 <= r + d < out.shape[0]:
                out[r + d] = False
    cx, cy = guess
    ys, xs = np.where(out)
    if len(ys) == 0:
        return None
    keep = (np.abs(xs - cx) <= reach) & (np.abs(ys - cy) <= reach)
    if keep.sum() < 3:
        return None
    return float(xs[keep].mean()), float(ys[keep].mean())


def build(records: Path, views: Path, svgs: Path, plane: int) -> dict[str, Any]:
    # A page sample carries no score id - `load_dataset` returns the tensors only -
    # so the id is recovered from the views path that produced it.
    corpus = {}
    for sample in load_dataset(records, views, size=(plane, plane), limit=0):
        sid = sample.get("score_id") or getattr(sample, "score_id", None)
        corpus[sid] = sample
    rows: list[dict[str, Any]] = []

    for path in sorted(svgs.glob("*.svg")):
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
        gap = _digit_gap(record)
        if not gap:
            continue
        svg = path.read_text()
        lines = staff_lines(svg)
        span = bb - bt

        # Production's own view frame for this record.
        frame = view_rect(record, True)

        # Pair production objects with record objects by order. The loader walks
        # the record's objects in order and appends the ones it places, so the
        # n-th TAB digit it kept is the n-th TAB digit in the record. Matching on
        # coordinates instead would require undoing the plane transform, which is
        # the thing under test.
        tab_digits = [o for o in record["objects"] if o["objectType"] == "fret-digit"]
        kept = [i for i in range(sample["object_type"].shape[0]) if int(sample["object_type"][i]) == 1]
        for n, i in enumerate(kept):
            if n >= len(tab_digits):
                break
            obj = tab_digits[n]
            box = sample["boxes"][i].tolist()
            tile = int(sample["view"][i])
            plane_img = sample["images"][tile, 0].numpy()
            if plane_img.shape[0] != plane:
                continue
            cx, cy = (box[0] + box[2]) / 2 * plane, (box[1] + box[3]) / 2 * plane
            if not (-plane < cx < 2 * plane and -plane < cy < 2 * plane):
                continue
            found = ink_centre_in_plane(plane_img, (cx, cy), reach=max(8, int(plane * 0.22)))
            if found is None:
                continue
            ix, iy = found
            bu = obj["boxUnits"]
            rows.append(
                {
                    "score": score,
                    "fret": int(obj["fret"]),
                    "digits": len(str(int(obj["fret"]))),
                    "tile": tile,
                    "string": 1 + int(round(((bu[1] + bu[3]) / 2 - bt) / span * 5.0)),
                    "gap": gap,
                    "band_span": span,
                    "rel_band_y": cy / plane,
                    "abs_page_y": (bu[1] + bu[3]) / 2,
                    "box_centre_plane_y": cy,
                    "ink_centre_plane_y": iy,
                    "residual_y": cy - iy,
                    "residual_x": cx - ix,
                    "box_h_plane": (box[3] - box[1]) * plane,
                }
            )
    return _analyse(rows)


def _group(rows: list[dict], key: str) -> dict:
    out: dict[str, dict] = {}
    values = sorted({r[key] for r in rows})
    for v in values:
        sub = [r for r in rows if r[key] == v]
        out[str(v)] = {
            "n": len(sub),
            "median_residual_y": round(float(np.median([r["residual_y"] for r in sub])), 2),
            "p90_residual_y": round(float(np.percentile(np.abs([r["residual_y"] for r in sub]), 90)), 2),
        }
    return out


def _fit(x: np.ndarray, y: np.ndarray) -> tuple[float, float, float]:
    a, b = np.polyfit(x, y, 1)
    pred = a * x + b
    ss_res = float(((y - pred) ** 2).sum())
    ss_tot = float(((y - y.mean()) ** 2).sum())
    return float(a), float(b), (1 - ss_res / ss_tot if ss_tot > 0 else 0.0)


def _analyse(rows: list[dict]) -> dict[str, Any]:
    if len(rows) < 8:
        return {"fixtures": len(rows), "note": "too few"}

    # H28: the legitimate font-box vs visible-ink offset, in layout units.
    # The font box runs 0.895em above the baseline to 0.247em below it; digits ink
    # only the upper part, so the box centre is systematically above the ink.
    y = np.asarray([r["residual_y"] for r in rows])
    x = np.asarray([r["residual_x"] for r in rows])
    gap_plane = np.asarray([r["gap"] * r["box_h_plane"] / r["band_span"] for r in rows])

    a, b, r2 = _fit(gap_plane, y)
    a2, b2, r22 = _fit(
        np.asarray([r["rel_band_y"] for r in rows]), y
    )
    a3, b3, r23 = _fit(
        np.asarray([r["abs_page_y"] for r in rows]), y
    )

    # derive / hold-out split, by score so no score straddles the split
    scores = sorted({r["score"] for r in rows})
    cut = max(1, int(len(scores) * 2 / 3))
    derive = [r for r in rows if r["score"] in scores[:cut]]
    hold = [r for r in rows if r["score"] in scores[cut:]]
    ad, bd, r2d = _fit(
        np.asarray([r["gap"] * r["box_h_plane"] / r["band_span"] for r in derive]),
        np.asarray([r["residual_y"] for r in derive]),
    )
    if hold:
        xh = np.asarray([r["gap"] * r["box_h_plane"] / r["band_span"] for r in hold])
        pred = ad * xh + bd
        actual = np.asarray([r["residual_y"] for r in hold])
        hold_mae = float(np.abs(pred - actual).mean())
    else:
        hold_mae = None

    return {
        "fixtures": len(rows),
        "scores": len(scores),
        "residual_y_px": {
            "median": round(float(np.median(y)), 2),
            "p10": round(float(np.percentile(y, 10)), 2),
            "p90": round(float(np.percentile(np.abs(y), 90)), 2),
        },
        "residual_x_px": {
            "median": round(float(np.median(x)), 2),
            "p90": round(float(np.percentile(np.abs(x), 90)), 2),
        },
        "median_box_h_px": round(float(np.median([r["box_h_plane"] for r in rows])), 1),
        "by_string": _group(rows, "string"),
        "by_rel_band_y_decile": _decile(rows),
        "by_tile": _group(rows, "tile"),
        "fit_residual_vs_line_gap_px": {"a": round(a, 4), "b": round(b, 3), "r2": round(r2, 4)},
        "fit_residual_vs_rel_band_y": {"a": round(a2, 3), "b": round(b2, 3), "r2": round(r22, 4)},
        "fit_residual_vs_abs_page_y": {"a": round(a3, 5), "b": round(b3, 3), "r2": round(r23, 4)},
        "split": {
            "derive_scores": scores[:cut],
            "holdout_scores": scores[cut:],
            "derive_fit": {"a": round(ad, 4), "b": round(bd, 3), "r2": round(r2d, 4)},
            "holdout_mae_px": None if hold_mae is None else round(hold_mae, 2),
        },
        "rows": rows,
    }


def _decile(rows: list[dict]) -> dict:
    out = {}
    for d in range(10):
        lo, hi = d / 10, (d + 1) / 10
        sub = [r for r in rows if lo <= r["rel_band_y"] < hi or (d == 9 and r["rel_band_y"] == 1.0)]
        if sub:
            out[f"{lo:.1f}-{hi:.1f}"] = {
                "n": len(sub),
                "median_residual_y": round(float(np.median([r["residual_y"] for r in sub])), 2),
            }
    return out


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("records", type=Path)
    p.add_argument("views", type=Path)
    p.add_argument("svgs", type=Path)
    p.add_argument("--plane", type=int, default=PLANE)
    p.add_argument("--out", type=Path, default=None)
    args = p.parse_args()
    report = build(args.records, args.views, args.svgs, args.plane)
    print(json.dumps({k: v for k, v in report.items() if k != "rows"}, indent=2))
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
