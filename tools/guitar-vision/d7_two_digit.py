"""D7 - two-digit structure, plus the leakage check the ROI probe requires.

## The leakage question

The ROI crop contains the TAB staff lines, and their vertical positions encode
which *string* the object sits on. String is a coordinate the probe is forbidden to
receive - but pixels are pixels. So "the probe never saw a coordinate" is only
meaningful if the fret label is not recoverable from the string alone.

If P(fret | string) is near uniform, a probe that scored well could not have got
there by reading staff-line position, because staff-line position carries no fret
information. If instead fret were largely determined by string, the ROI probe's
result would be a coordinate leak wearing a pixel mask, and the whole D3 result
would have to be discarded.

This measures that directly.

## Two-digit structure

Staff lines span the full crop, so a raw ink bbox measures the crop, not the glyph.
Staff-line rows are identified (mostly-ink rows) and removed first; what remains is
the glyph, and that is what gets compared between one-digit and two-digit frets.
Measurement only - nothing here changes a crop.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np

INK = 0.85


def glyph_mask(crop: np.ndarray) -> np.ndarray:
    """Ink with horizontal staff-line rows removed."""
    ink = crop < INK
    if not ink.any():
        return ink
    row_fill = ink.mean(axis=1)
    staff_rows = row_fill > 0.8
    if staff_rows.any():
        clean = ink.copy()
        clean[staff_rows, :] = False
        # Drop columns that only had ink on staff rows, so a digit touching a line
        # is not erased by the line being removed.
        if clean.any():
            return clean
    return ink


def glyph_bbox(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    if not mask.any():
        return None
    rows = np.where(mask.any(1))[0]
    cols = np.where(mask.any(0))[0]
    return int(cols.min()), int(rows.min()), int(cols.max()), int(rows.max())


def split_columns(mask: np.ndarray, bbox) -> tuple[float, float] | None:
    """Centre of each half of a two-digit glyph, if two ink clusters exist.

    Used only to ask whether the first digit is reliably the left one. A crude
    column-split at the midpoint is enough to answer "is digit order stable"
    without claiming to be a segmenter.
    """
    if bbox is None:
        return None
    x0, _, x1, _ = bbox
    if x1 - x0 < 8:
        return None
    mid = (x0 + x1) // 2
    cols = mask.any(0)
    left = np.where(cols[x0:mid])[0]
    right = np.where(cols[mid : x1 + 1])[0]
    if left.size == 0 or right.size == 0:
        return None
    return float(left.mean() + x0), float(right.mean() + mid)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    blob = np.load(args.data, allow_pickle=True)
    rois = blob["rois"].astype(np.float32)
    labels = blob["labels"].astype(np.int64)
    strings = blob["strings"].astype(np.int64)
    scores = blob["scores"]
    split = blob["split"].astype(np.int64)

    # ---- leakage: how much fret is recoverable from string alone? ----------
    contingency: dict[int, Counter] = defaultdict(Counter)
    for fret, string in zip(labels.tolist(), strings.tolist()):
        contingency[string][fret] += 1
    majority_by_string = sum(max(c.values()) for c in contingency.values())
    string_only_accuracy = majority_by_string / len(labels)

    rows = []
    for string in sorted(contingency):
        counts = contingency[string]
        total = sum(counts.values())
        rows.append({
            "string": string,
            "n": total,
            "distinct_frets": len(counts),
            "majority_fret": max(counts, key=counts.get),
            "majority_share": round(max(counts.values()) / total, 4),
        })

    # ---- two-digit structure ------------------------------------------------
    one = labels < 10
    stats: dict[str, list] = {"one": [], "two": []}
    order_stable = 0
    order_total = 0
    touching_edge = 0
    per_class: dict[int, dict[str, Any]] = {}
    for crop, fret, is_one in zip(rois, labels.tolist(), one.tolist()):
        mask = glyph_mask(crop)
        bbox = glyph_bbox(mask)
        key = "one" if is_one else "two"
        if bbox is None:
            continue
        x0, y0, x1, y1 = bbox
        w, h = x1 - x0 + 1, y1 - y0 + 1
        stats[key].append((w, h))
        if x0 == 0 or y0 == 0 or x1 == 31 or y1 == 31:
            touching_edge += 1
        if not is_one:
            halves = split_columns(mask, bbox)
            if halves:
                order_total += 1
                if halves[0] < halves[1]:
                    order_stable += 1
        entry = per_class.setdefault(fret, {"w": [], "h": [], "n": 0})
        entry["w"].append(w)
        entry["h"].append(h)
        entry["n"] += 1

    def summarise(values):
        if not values:
            return None
        arr = np.asarray(values, dtype=float)
        return {
            "n": int(len(arr)),
            "w_median": round(float(np.median(arr[:, 0])), 2),
            "w_p10": round(float(np.percentile(arr[:, 0], 10)), 2),
            "w_p90": round(float(np.percentile(arr[:, 0], 90)), 2),
            "h_median": round(float(np.median(arr[:, 1])), 2),
            "h_p10": round(float(np.percentile(arr[:, 1], 10)), 2),
            "h_p90": round(float(np.percentile(arr[:, 1], 90)), 2),
        }

    report = {
        "leakage_check": {
            "note": "if fret were determined by string, the ROI probe could read "
                    "staff-line position instead of glyphs and the D3 result would "
                    "be a coordinate leak",
            "string_only_majority_accuracy": round(string_only_accuracy, 6),
            "uniform_chance": round(1.0 / len(set(labels.tolist())), 6),
            "per_string": rows,
        },
        "glyph_extent": {
            "note": "staff-line rows removed before measuring; raw ink bbox measures "
                    "the crop, not the glyph",
            "one_digit": summarise(stats["one"]),
            "two_digit": summarise(stats["two"]),
            "crops_touching_roi_edge": touching_edge,
            "crops_total": len(labels),
        },
        "two_digit_order": {
            "resolved": order_total,
            "first_digit_left_of_second": order_stable,
            "share": round(order_stable / max(order_total, 1), 4),
        },
        "per_class_extent": {
            str(f): {
                "n": v["n"],
                "w_median": round(float(np.median(v["w"])), 2),
                "h_median": round(float(np.median(v["h"])), 2),
            }
            for f, v in sorted(per_class.items())
        },
        "class_support": {
            str(f): {
                "n": int((labels == f).sum()),
                "scores": int(len(set(scores[labels == f].tolist()))),
            }
            for f in sorted(set(labels.tolist()))
        },
    }

    print("D7 two-digit analysis")
    print("=" * 74)
    leak = report["leakage_check"]
    print(
        f"LEAKAGE CHECK: fret recoverable from string alone = "
        f"{leak['string_only_majority_accuracy']:.4f} (uniform {leak['uniform_chance']:.4f})"
    )
    for row in leak["per_string"]:
        print(
            f"  string {row['string']}: n {row['n']:>4} distinct frets {row['distinct_frets']:>2} "
            f"majority fret {row['majority_fret']} at {row['majority_share']:.1%}"
        )
    print()
    g = report["glyph_extent"]
    print(f"glyph extent (staff lines removed), 1-digit: {g['one_digit']}")
    print(f"glyph extent (staff lines removed), 2-digit: {g['two_digit']}")
    print(
        f"crops whose glyph touches the ROI edge: {g['crops_touching_roi_edge']}/{g['crops_total']}"
    )
    t = report["two_digit_order"]
    print(
        f"two-digit order: first digit left of second in {t['first_digit_left_of_second']}"
        f"/{t['resolved']} = {t['share']:.1%}"
    )
    print()
    print("per-class glyph extent:")
    for fret, entry in report["per_class_extent"].items():
        support = report["class_support"][fret]
        print(
            f"  fret {fret:>2}: n {entry['n']:>3} scores {support['scores']:>3} "
            f"w {entry['w_median']:>5.1f} h {entry['h_median']:>5.1f}"
        )

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n")
        print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())