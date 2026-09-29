"""Phase A / A2: effective resolution of the pitch evidence, in both domains.

Answers, with numbers:
  - how many PAGE pixels one staff space is in each domain
  - how many VIEW pixels (the 192x512 tensor the backbone sees) the object box
    and the 3x-expanded sampled region occupy
  - how many stride-1 pixels one notehead spans
  - how many staff lines / staff spaces are visible inside the sampled region
  - whether the staff line spacing survives the crop

No model call. Pure geometry on the records the model actually consumes.
"""
from __future__ import annotations

import math
import statistics as st
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

H.add_runtime_to_path()
from piano_vision.v2.data import _bounds, _center, source_order  # noqa: E402

QW, QH = 512, 192  # view width/height from the frozen config


def q(values, ps=(0.05, 0.25, 0.5, 0.75, 0.95)):
    if not values:
        return {}
    s = sorted(values)
    out = {}
    for p in ps:
        out[f"p{int(p*100)}"] = round(s[min(len(s) - 1, int(p * len(s)))], 4)
    out["mean"] = round(sum(s) / len(s), 4)
    return out


def view_px_per_page_px(page, record):
    """crop_view scale: the page-pixel -> view-pixel factor actually applied.

    crop_view pads the scope box by 8%, takes scale = min(W/cw, H/ch) in PAGE
    pixels, and centres the result. Reproduced exactly here.
    """
    b = record["input"]["modelInput"]["geometry"]["scopeBounds"]
    x0, y0, x1, y1 = float(b["x0"]), float(b["y0"]), float(b["x1"]), float(b["y1"])
    pw, ph = page.size
    px, py = max(.004, (x1 - x0) * .08), max(.004, (y1 - y0) * .08)
    cx0 = max(0, math.floor((x0 - px) * pw)); cy0 = max(0, math.floor((y0 - py) * ph))
    cx1 = min(pw, math.ceil((x1 + px) * pw)); cy1 = min(ph, math.ceil((y1 + py) * ph))
    cw, ch = cx1 - cx0, cy1 - cy0
    if min(cw, ch) <= 0:
        return None
    return min(QW / cw, QH / ch)


def audit_domain(name, ordered_by_score, resolver, limit_objects=4000):
    rows = []
    page_info = {}
    for entry in ordered_by_score:
        records = entry[1] if isinstance(entry, tuple) else entry
        score_id = entry[0] if isinstance(entry, tuple) else records[0]["scoreId"]
        for rec in records:
            m = rec["input"]["modelInput"]
            geo = m.get("geometry", {})
            bands = geo.get("staffBands", {}).get("staffBands", [])
            scope = geo.get("scopeBounds")
            if not scope or not bands:
                continue
            page = resolver.page(rec)
            scale = view_px_per_page_px(page, rec)
            if scale is None:
                continue
            pw, ph = page.size
            page_info.setdefault(score_id, {"page_px": [pw, ph]})
            # staff space in page px: a 5-line band spans 4 spaces
            for band in bands:
                h_page = (float(band["y1"]) - float(band["y0"])) * ph
                if h_page <= 0:
                    continue
                space_page_px = h_page / 4.0
                rows.append({
                    "kind": "staffband",
                    "space_page_px": space_page_px,
                    "space_view_px": space_page_px * scale,
                    "scale": scale,
                })
            scope_h_page = (float(scope["y1"]) - float(scope["y0"])) * ph
            for obj in m.get("physicalObjects", []):
                if obj.get("kind") != "notehead":
                    continue
                ox0, ox1, oy0, oy1 = _bounds(obj)
                cx, cy = _center(obj)
                band = min(bands, key=lambda b: abs(cy - (float(b["y0"]) + float(b["y1"])) / 2))
                space_page_px = (float(band["y1"]) - float(band["y0"])) * ph / 4.0
                if space_page_px <= 0:
                    continue
                rows.append({
                    "kind": "notehead",
                    "space_page_px": space_page_px,
                    "space_view_px": space_page_px * scale,
                    "scale": scale,
                    # object box in staff spaces
                    "obj_w_spaces": (ox1 - ox0) * pw / space_page_px,
                    "obj_h_spaces": (oy1 - oy0) * ph / space_page_px,
                    # object box in view px
                    "obj_w_view_px": (ox1 - ox0) * pw * scale,
                    "obj_h_view_px": (oy1 - oy0) * ph * scale,
                    # 3x-expanded sampled region in view px (data.py:272)
                    "region_w_view_px": (ox1 - ox0) * 3 * pw * scale,
                    "region_h_view_px": (oy1 - oy0) * 3 * ph * scale,
                    "region_w_spaces": (ox1 - ox0) * 3 * pw / space_page_px,
                    "region_h_spaces": (oy1 - oy0) * 3 * ph / space_page_px,
                    # staff space inside the sampled region, in view px
                    "space_in_region_view_px": space_page_px * scale,
                    "scope_h_page_px": scope_h_page,
                    "scope_h_view_px": scope_h_page * scale,
                })
                if len([r for r in rows if r["kind"] == "notehead"]) >= limit_objects:
                    break
    return rows, page_info


def summarise(rows):
    note = [r for r in rows if r["kind"] == "notehead"]
    band = [r for r in rows if r["kind"] == "staffband"]
    out = {
        "counts": {"noteheads": len(note), "staff_bands": len(band)},
    }
    def col(rs, k):
        return [r[k] for r in rs if k in r]
    for k in ("space_page_px", "space_view_px"):
        out[k] = q(col(note, k))
    for k in ("obj_w_spaces", "obj_h_spaces", "obj_w_view_px", "obj_h_view_px",
              "region_w_view_px", "region_h_view_px",
              "region_w_spaces", "region_h_spaces", "scope_h_view_px"):
        out[k] = q(col(note, k))
    # How many staff spaces tall is the sampled region? Below ~4 the 5 staff
    # lines are not fully inside it and pitch is not locally decodable.
    out["region_height_in_staff_spaces_note"] = q(col(note, "region_h_spaces"))
    return out


def main():
    runtime = H.load_runtime("cpu")

    src_scores = H.source_scores(3, split="validation")
    src_resolver = H.source_resolver()
    src_rows, src_pages = audit_domain("source", src_scores, src_resolver)

    prod = H.realpdf_scores("validation")
    prod_resolver = H.realpdf_resolver()
    prod_rows, prod_pages = audit_domain("production", prod, prod_resolver)

    report = {
        "view_geometry": {"width": QW, "height": QH, "region_grid": runtime.config.region_grid,
                          "pad": 0.08, "box_expansion": 3.0},
        "source": {"summary": summarise(src_rows), "pages": src_pages},
        "production": {"summary": summarise(prod_rows), "pages": prod_pages},
    }
    path = H.write_json("phase_a_resolution.json", report)
    print(json.dumps(report, indent=2, sort_keys=True) if False else "")
    import json as _j
    print(_j.dumps(report["source"]["summary"], indent=2, sort_keys=True))
    print("--- production ---")
    print(_j.dumps(report["production"]["summary"], indent=2, sort_keys=True))
    print("wrote", path)


if __name__ == "__main__":
    import json
    main()
