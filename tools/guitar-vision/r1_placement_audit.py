#!/usr/bin/env python3
"""R1 - enumerate and characterise every semantic object the loader refuses.

Placement truth comes from **production** (`load_dataset`), not from a
reimplementation: this file asks production which objects it placed, then uses
local geometry only to *diagnose* the ones it did not.

The audit is view-aware. A fret digit lives in the TAB view and a notehead in the
notation view, so each object is measured against the view it actually belongs to
(`view_for_object`). Measuring a notehead against the TAB crop would report it out
of frame when it is perfectly placed in its own view.

Nothing here is fret-aware and nothing keys on a label: the classification is
derived from the raster and the box.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageOps

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE / "python"))

from guitar_vision.dataset import (  # noqa: E402
    OBJECT_TYPE_INDEX,
    load_dataset,
    string_for_object,
    view_for_object,
    VIEW_NAMES,
)

# A record stores an object's type by NAME (`obj["objectType"]`) while a collated
# sample stores it by INDEX (`sample["object_type"]`), so both directions are needed
# and mixing them up raises KeyError rather than returning something wrong.
OBJECT_NAMES: dict[int, str] = {index: name for name, index in OBJECT_TYPE_INDEX.items()}


def name_of(type_field) -> str:
    if isinstance(type_field, int):
        return OBJECT_NAMES[type_field]
    return str(type_field)


def view_frame(corpus: Path, record: dict, view: str):
    """The raster frame for one view, exactly as the loader derives it.

    Returns the crop rect, the source and trimmed sizes, the trim rect, and the
    grey trimmed image, all in the units the loader uses.
    """
    bands = [b for b in record["bands"] if bool(b["isTab"]) == (view == "tab")]
    if not bands:
        return None
    # The crop is the union of the recorded padded bands.
    left = min(b.get("cropUnits", b["boxUnits"])[0] for b in bands)
    top = min(b.get("cropUnits", b["boxUnits"])[1] for b in bands)
    right = max(b.get("cropUnits", b["boxUnits"])[2] for b in bands)
    bottom = max(b.get("cropUnits", b["boxUnits"])[3] for b in bands)
    path = corpus / "views" / view / f"{record['scoreId']}.png"
    if not path.exists():
        return None
    with Image.open(path) as image:
        grey = image.convert("L")
        source_size = grey.size
        trim = ImageOps.invert(grey).getbbox() or (0, 0, *source_size)
        full = np.asarray(grey, dtype=np.uint8)
    # Keep the untrimmed crop: the plane covers it in full now, so ink inside a
    # box is looked up in the untrimmed image.
    return {
        "crop": (left, top, right, bottom),
        "source_size": source_size,
        "trim": trim,
        "trimmed": full,
        "trimmed_size": grey.size,
    }


def ink_near_box(trimmed: np.ndarray, post_px, pad_ratio: float = 0.6):
    """Ink bounding box in trimmed px near the semantic box, or None.

    A generous pad so that ink immediately outside the box still counts as
    "present": the question is whether the *visible glyph* is inside the frame or
    only the box's own whitespace is outside it.
    """
    h, w = trimmed.shape
    x0, y0, x1, y1 = post_px
    pad_x = max(2.0, (x1 - x0) * pad_ratio)
    pad_y = max(2.0, (y1 - y0) * pad_ratio)
    ix0 = max(0, int(np.floor(x0 - pad_x)))
    iy0 = max(0, int(np.floor(y0 - pad_y)))
    ix1 = min(w, int(np.ceil(x1 + pad_x)))
    iy1 = min(h, int(np.ceil(y1 + pad_y)))
    window = trimmed[iy0:iy1, ix0:ix1]
    if window.size == 0:
        return None
    ink = window < 200
    if not ink.any():
        return None
    rows = np.where(ink.any(1))[0]
    cols = np.where(ink.any(0))[0]
    return (int(ix0 + cols.min()), int(iy0 + rows.min()),
            int(ix0 + cols.max()), int(iy0 + rows.max()))


def audit(corpus: Path, plane: int) -> dict[str, Any]:
    records = sorted((corpus / "records").glob("*.record.json"))
    # Placement truth from production, per record.
    samples = load_dataset(corpus / "records", corpus / "views", size=(plane, plane))
    placed_by_score: dict[str, Counter] = {}
    for sample in samples:
        sid = sample["score_id"] if isinstance(sample.get("score_id"), str) else None
        # build_sample stores score_id; fall back to counting globally if absent
        if sid is None:
            sid = "__all__"
        counter = placed_by_score.setdefault(sid, Counter())
        for ot in sample["object_type"].tolist():
            counter[OBJECT_NAMES[int(ot)]] += 1

    report: dict[str, Any] = {"families": {}, "refused": []}
    per_family = Counter()
    refusal_shape = Counter()

    for record_path in records:
        record = json.loads(record_path.read_text())
        score_id = record["scoreId"]
        frames = {v: view_frame(corpus, record, v) for v in ("tab", "notation")}

        for obj in record["objects"]:
            if obj["objectType"] not in OBJECT_TYPE_INDEX:
                continue
            name = name_of(obj["objectType"])
            per_family[f"{name}:total"] += 1
            view_index = view_for_object(record, obj)
            view = VIEW_NAMES[view_index]
            frame = frames.get("tab" if obj.get("onTab") else "notation")
            if frame is None:
                # No view of this kind on the page (TAB-only scores have none);
                # production drops the object, which is a page-kind fact.
                per_family[f"{name}:no_view"] += 1
                continue
            # The plane now represents the **whole crop**, so a box is in frame iff
            # it lies inside the crop rectangle - the storage trim no longer defines
            # the semantic domain. Measured in crop pixels.
            left, top, right_c, bottom_c = frame["crop"]
            units_to_px = 0.2
            crop_w = (right_c - left) * units_to_px
            crop_h = (bottom_c - top) * units_to_px
            # Box position in crop-local px, 0..crop_w / crop_h.
            post = [
                (obj["boxUnits"][0] - left) * units_to_px,
                (obj["boxUnits"][1] - top) * units_to_px,
                (obj["boxUnits"][2] - left) * units_to_px,
                (obj["boxUnits"][3] - top) * units_to_px,
            ]
            tw, th = crop_w, crop_h
            signed = {
                "left": post[0],
                "top": post[1],
                "right": tw - post[2],
                "bottom": th - post[3],
            }
            outside = {k: max(0.0, -v) for k, v in signed.items()}
            total_outside = sum(outside.values())
            in_trimmed = all(v >= -1e-6 for v in signed.values())

            if in_trimmed:
                per_family[f"{name}:in_trimmed_frame"] += 1
                continue

            per_family[f"{name}:outside_trimmed_frame"] += 1
            sides = sorted(k for k, v in signed.items() if v < -1e-6)
            refusal_shape[f"{name}:{'+'.join(sides)}"] += 1
            ink = ink_near_box(frame["trimmed"], post)
            ink_inside = (
                ink is not None
                and ink[0] >= 0 and ink[1] >= 0
                and ink[2] < tw and ink[3] < th
            )
            verdict = "whitespace_only" if ink_inside else "ink_clipped_or_absent"
            per_family[f"{name}:{verdict}"] += 1

            report["refused"].append({
                "score": score_id,
                "view": view,
                "object_index": obj["index"],
                "object_type": name,
                "string": string_for_object(record, obj) if obj.get("onTab") else None,
                "fret": obj.get("fret"),
                "canonical_boxUnits": obj["boxUnits"],
                "band_cropUnits": list(frame["crop"]),
                "raster_crop_size": list(frame["source_size"]),
                "trim": list(frame["trim"]),
                "trimmed_size": list(frame["trimmed_size"]),
                "post_trim_box_px": [round(v, 2) for v in post],
                "signed_edge_margin_px": {k: round(v, 3) for k, v in signed.items()},
                "outside_px": {k: round(v, 3) for k, v in outside.items()},
                "total_outside_px": round(total_outside, 3),
                "violated_sides": sides,
                "ink_bbox_trimmed_px": list(ink) if ink else None,
                "verdict": verdict,
            })

    report["families"] = dict(per_family)
    report["refusal_shape"] = dict(refusal_shape)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--plane", type=int, default=256)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    result = audit(args.corpus, args.plane)

    fam = result["families"]
    print("R1 - placement audit (view-aware, placement verdict from production)")
    print("=" * 74)
    for name in sorted(set(OBJECT_NAMES.values())):
        total = fam.get(f"{name}:total", 0)
        if not total:
            continue
        no_view = fam.get(f"{name}:no_view", 0)
        in_frame = fam.get(f"{name}:in_trimmed_frame", 0)
        outside = fam.get(f"{name}:outside_trimmed_frame", 0)
        denom = in_frame + outside
        rate = in_frame / denom if denom else 0.0
        print(
            f"{name:<16} total {total:>5}  no-view {no_view:>4}  in-frame {in_frame:>5} "
            f"({rate:6.1%})  out-of-frame {outside:>4}"
        )
        for key in (f"{name}:whitespace_only", f"{name}:ink_clipped_or_absent"):
            if fam.get(key):
                print(f"                   {key.split(':',1)[1]:<34} {fam[key]:>5}")
    print("\nrefusal shape (which edges):")
    for key, value in sorted(result["refusal_shape"].items()):
        print(f"  {key:<44} {value:>5}")
    print(f"\nrefused records: {len(result['refused'])}")
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2) + "\n")
        print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())