"""S1 source-resolution audit (FIT/SAME train pages only; never held-out).

Measures, for every fret-digit object on the 40 train pages:
- source view PNG dimensions and render scale
- fret bbox dimensions in source pixels (via record boxUnits, verified mapping)
- pixels per staff space (row-projection staff-line spacing per score)
- ROI context-box dimensions in plane pixels (what grid_sample resamples to 32x32)
- effective ink contrast and stroke width in source pixels
- rasterization path constants (Chromium, page width, view scale, DPI equivalent)

Writes tmp/gvprobe/source-audit.json. No model, no held-out, no training.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE / "python"))

import d8_stage_probes as d8  # noqa: E402
from guitar_vision.dataset import collate, load_dataset  # noqa: E402

RECORDS = _REPO / "datasets/guitar-vision/synthetic/train/records"
VIEWS = _REPO / "datasets/guitar-vision/synthetic/train/views"
SPLIT_MATRIX = Path("tmp/gvprobe/P_std_step1200.npz")
OUT = Path("tmp/gvprobe/source-audit.json")

VIEW_SCALE = {"full-page": 1.0, "notation": 2.0, "tab": 2.0}
UNITS_PER_PX = 10.0  # record unitsPerPixel at 1x render


def staff_spacing(png: Path) -> float | None:
    """Median horizontal-line spacing in source px via row projection."""
    rows = np.asarray(Image.open(png).convert("L"), dtype=np.float32)
    dark = (rows < 128).mean(axis=1)
    lined = dark > 0.35
    groups: list[list[int]] = []
    for index, flag in enumerate(lined.tolist()):
        if flag and (not groups or index > groups[-1][-1] + 2):
            groups.append([index])
        elif flag:
            groups[-1].append(index)
    centers = [float(np.mean(group)) for group in groups if len(group) >= 1]
    if len(centers) < 2:
        return None
    diffs = np.diff(sorted(centers))
    # Staff gaps cluster; inter-staff gaps are much larger. Take the small cluster.
    small = diffs[diffs < np.median(diffs) * 2.5]
    if len(small) == 0:
        return None
    return round(float(np.median(small)), 2)


def main() -> int:
    blob = np.load(SPLIT_MATRIX)
    scores, page, row = blob["scores"], blob["page"], blob["row"]
    fit, same, held, _ = d8.splits(scores, page, row)
    assert (int(fit.sum()), int(same.sum()), int(held.sum())) == (614, 153, 395)

    everything = load_dataset(RECORDS, VIEWS, size=(256, 256), limit=40)
    assert len(everything) == 40, "audit must cover exactly the 40 train pages"

    # Order of fret rows in the live extraction must match the split matrix.
    order: list[tuple[int, int]] = []
    for page_index, sample in enumerate(everything):
        keep = (sample["object_type"] == 1).nonzero(as_tuple=True)[0].tolist()
        order.extend([(page_index, fret_row) for fret_row in keep])
    assert len(order) == 767 == int(fit[:767].sum() + 153)
    fit_rows = {position for position in range(767) if fit[position]}
    assert len(fit_rows) == 614

    per_score_spacing: dict[str, dict[str, float]] = {}
    glyphs: list[dict] = []
    for position, (page_index, fret_row) in enumerate(order):
        if position not in fit_rows and not same[position]:
            raise SystemExit("audit touched a non-train row")
        sample = everything[page_index]
        score_id = str(sample["score_id"])
        record = json.loads((RECORDS / f"{score_id}.record.json").read_text())
        fret_objects = [o for o in record["objects"] if o["objectType"] == "fret-digit"]
        # Live rows and record fret objects share document order.
        fret_index = sorted((sample["object_type"] == 1).nonzero(as_tuple=True)[0].tolist()).index(fret_row)
        obj = fret_objects[fret_index]
        assert int(obj["fret"]) == int(sample["fret"][fret_row]), (
            f"record/live order mismatch on {score_id} row {fret_row}")
        on_tab = bool(obj.get("onTab", True))
        view = "tab" if on_tab else "notation"
        band = next(b for b in record["bands"] if bool(b.get("isTab")) == on_tab)
        scale = VIEW_SCALE[view] / UNITS_PER_PX  # units -> source view px
        cx0, cy0, _, _ = band["cropUnits"]
        x0, y0, x1, y1 = obj["boxUnits"]
        src_w, src_h = (x1 - x0) * scale, (y1 - y0) * scale

        if score_id not in per_score_spacing:
            png = VIEWS / view / f"{score_id}.png"
            with Image.open(png) as image:
                view_size = image.size
            per_score_spacing[score_id] = {
                "view": view, "width": view_size[0], "height": view_size[1],
                "staff_space_px": staff_spacing(png),
            }
        # Ink contrast + stroke width from the source patch.
        patch = np.asarray(Image.open(VIEWS / view / f"{score_id}.png").convert("L"),
                           dtype=np.float32)
        px0, py0 = int(round((x0 - cx0) * scale)), int(round((y0 - cy0) * scale))
        px1, py1 = int(round((x1 - cx0) * scale)), int(round((y1 - cy0) * scale))
        patch = patch[max(0, py0):py1, max(0, px0):px1]
        border = np.concatenate([patch[0, :], patch[-1, :], patch[:, 0], patch[:, -1]])
        paper = float(np.median(border))
        ink = float(np.percentile(patch, 5))
        binary = patch < (paper + ink) / 2
        mid = binary[binary.shape[0] // 3: 2 * binary.shape[0] // 3, :]
        runs: list[int] = []
        for line in mid[::2]:
            padded = np.concatenate([[False], line, [False]])
            edges = np.diff(padded.astype(np.int8))
            starts = np.nonzero(edges == 1)[0]
            ends = np.nonzero(edges == -1)[0]
            runs.extend((ends - starts).tolist())
        stroke = round(float(np.median(runs)), 2) if runs else None

        # Plane-px box from the live sample (what the model sees pre-ROI).
        box = sample["boxes"][fret_row].tolist()
        plane_w = (box[2] - box[0]) * 256.0
        plane_h = (box[3] - box[1]) * 256.0

        glyphs.append({
            "subset": "fit" if position in fit_rows else "same",
            "score": score_id, "view": view,
            "src_w_px": round(src_w, 2), "src_h_px": round(src_h, 2),
            "plane_w_px": round(plane_w, 2), "plane_h_px": round(plane_h, 2),
            "roi_ctx_w_plane": round(plane_w * 1.6, 2),
            "roi_ctx_h_plane": round(plane_h * 1.6, 2),
            "contrast": round(paper - ink, 1),
            "stroke_px": stroke,
            "digits": 2 if src_w > src_h * 1.3 else 1,
        })

    heights = np.array([g["src_h_px"] for g in glyphs])
    widths = np.array([g["src_w_px"] for g in glyphs])
    report = {
        "scope": "40 train pages only; 614 FIT + 153 SAME rows; no held-out",
        "rasterization": {
            "engine": "headless Chromium via Playwright (tools/guitar-vision/rasterize_views.py)",
            "vector_source": "Verovio SVG, viewBox 21000x29700 units",
            "full_page_px": [2100, 2970],
            "band_view_scale": 2.0,
            "format": "lossless PNG, 8-bit",
            "dpi_equivalent": "254 at 1x (2100px / 210mm page width); 508 effective for notation/tab bands",
        },
        "views": per_score_spacing,
        "glyph_src_px": {
            "count": len(glyphs),
            "height": {"median": round(float(np.median(heights)), 2),
                       "p10": round(float(np.percentile(heights, 10)), 2),
                       "min": round(float(heights.min()), 2),
                       "max": round(float(heights.max()), 2)},
            "width": {"median": round(float(np.median(widths)), 2),
                      "p10": round(float(np.percentile(widths, 10)), 2),
                      "min": round(float(widths.min()), 2),
                      "max": round(float(widths.max()), 2)},
        },
        "contrast": {"median": round(float(np.median([g['contrast'] for g in glyphs])), 1)},
        "stroke_px": {"median": round(float(np.median([g['stroke_px'] for g in glyphs if g['stroke_px']])), 2)},
        "glyphs": glyphs,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2) + "\n")
    print(f"n={len(glyphs)} src_h median {report['glyph_src_px']['height']['median']} "
          f"p10 {report['glyph_src_px']['height']['p10']} min {report['glyph_src_px']['height']['min']}")
    print(f"contrast median {report['contrast']['median']} stroke median {report['stroke_px']['median']}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
