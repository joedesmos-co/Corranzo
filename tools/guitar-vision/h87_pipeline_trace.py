"""G1 pipeline trace (40 train pages only; FIT/SAME rows; never held-out).

For every FIT/SAME fret object, measures the same ink metrics at three stages:
  S0 source view patch  (record boxUnits -> 2x view PNG px)
  S1 plane patch        (loaded 256-plane sample, box * 256)
  S2 ROI 32x32          (model.roi_crops, grid_sample bilinear from the plane)

Plus: resampling-op inventory, distinct source pixels per ROI output pixel,
tile-stretch prevalence, and pipeline-vs-direct downsample disagreement.
Writes tmp/gvprobe/pipeline-trace.json. No training, no head inference.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE / "python"))

import d8_stage_probes as d8  # noqa: E402
from guitar_vision.dataset import collate, load_dataset  # noqa: E402
from guitar_vision.fret_experiments import build  # noqa: E402
from guitar_vision.qualify import Device  # noqa: E402
from guitar_vision.roi import ROI_CONTEXT, ROI_CROP  # noqa: E402
from h82_dedicated_roi_branch import args_for  # noqa: E402

RECORDS = _REPO / "datasets/guitar-vision/synthetic/train/records"
VIEWS = _REPO / "datasets/guitar-vision/synthetic/train/views"
SPLIT_MATRIX = Path("tmp/gvprobe/P_std_step1200.npz")
OUT = Path("tmp/gvprobe/pipeline-trace.json")


def metrics(patch: np.ndarray) -> dict:
    gray = patch.astype(np.float32)
    if min(gray.shape) < 2:
        energy = 0.0
    else:
        gy, gx = np.gradient(gray)
        energy = float(np.sqrt((gx ** 2 + gy ** 2).mean()))
    return {
        "h": int(patch.shape[0]), "w": int(patch.shape[1]),
        "distinct_levels": int(len(np.unique(patch))),
        "ink_occupancy": round(float((patch < 128).mean()), 4),
        "edge_energy_per_px": round(energy, 3),
    }


def main() -> int:
    blob = np.load(SPLIT_MATRIX)
    scores, page, row = blob["scores"], blob["page"], blob["row"]
    fit_all, same_all, held_all, _ = d8.splits(scores, page, row)
    assert (int(fit_all.sum()), int(same_all.sum()), int(held_all.sum())) == (614, 153, 395)

    device = Device("cpu")
    everything = load_dataset(RECORDS, VIEWS, size=(256, 256), limit=40)
    torch.manual_seed(11)
    model = build("DEDICATED_ROI_FRET", args_for("DEDICATED_ROI_FRET", 256, 128), device)
    model.eval()

    order = []
    for page_index, sample in enumerate(everything):
        keep = (sample["object_type"] == 1).nonzero(as_tuple=True)[0].tolist()
        order.extend([(page_index, r) for r in keep])
    assert len(order) == 767

    stages = {"s0": [], "s1": [], "s2": []}
    degenerate = {"s0": 0, "s1": 0}
    src_per_roi_px = []
    stretched = 0
    direct_disagree = []
    subsets = []
    with torch.no_grad():
        for position, (page_index, fret_row) in enumerate(order):
            subset = "fit" if fit_all[position] else "same"
            assert subset in ("fit", "same")
            subsets.append(subset)
            sample = everything[page_index]
            score_id = str(sample["score_id"])
            record = json.loads((RECORDS / f"{score_id}.record.json").read_text())
            fret_objects = [o for o in record["objects"] if o["objectType"] == "fret-digit"]
            fret_index = sorted(
                (sample["object_type"] == 1).nonzero(as_tuple=True)[0].tolist()).index(fret_row)
            obj = fret_objects[fret_index]
            assert int(obj["fret"]) == int(sample["fret"][fret_row])
            on_tab = bool(obj.get("onTab", True))
            view = "tab" if on_tab else "notation"
            band = next(b for b in record["bands"] if bool(b.get("isTab")) == on_tab)
            unit_to_src = 2.0 / 10.0
            cx0, cy0, _, _ = band["cropUnits"]
            x0, y0, x1, y1 = obj["boxUnits"]
            view_png = VIEWS / view / f"{score_id}.png"
            full = np.asarray(Image.open(view_png).convert("L"))
            view_h = full.shape[0]
            px = [int(round((x0 - cx0) * unit_to_src)), int(round((y0 - cy0) * unit_to_src)),
                  int(round((x1 - cx0) * unit_to_src)), int(round((y1 - cy0) * unit_to_src))]
            s0 = full[max(0, px[1]):px[3], max(0, px[0]):px[2]]
            if min(s0.shape) == 0:
                degenerate["s0"] += 1
                continue
            stages["s0"].append(metrics(s0))

            batch = collate([sample], 128)
            box = sample["boxes"][fret_row].tolist()
            plane_index = int(batch["view"][0, fret_row])
            plane = (batch["images"][0, plane_index, 0].numpy() * 255).astype(np.uint8)
            bx = [int(round(box[0] * 256)), int(round(box[1] * 256)),
                  int(round(box[2] * 256)), int(round(box[3] * 256))]
            s1 = plane[bx[1]:bx[3], bx[0]:bx[2]]
            if min(s1.shape) == 0:
                degenerate["s1"] += 1
                continue
            stages["s1"].append(metrics(s1))

            tbatch = {k: (v.to(device.torch) if torch.is_tensor(v) else v)
                      for k, v in batch.items()}
            roi = model.roi_crops(tbatch)[0, fret_row].numpy().reshape(ROI_CROP, ROI_CROP)
            roi_u8 = np.clip(roi * 255, 0, 255).astype(np.uint8)
            stages["s2"].append(metrics(roi_u8))

            # Distinct source pixels feeding one ROI output pixel.
            ctx_w_plane = (box[2] - box[0]) * 256.0 * ROI_CONTEXT
            ctx_h_plane = (box[3] - box[1]) * 256.0 * ROI_CONTEXT
            plane_to_src = view_h / 256.0
            src_per_roi_px.append(round((ctx_w_plane * plane_to_src / ROI_CROP)
                                        * (ctx_h_plane * plane_to_src / ROI_CROP), 2))
            # Stretch flag: plane box width vs LANCZOS-only expectation.
            expected_w = (x1 - x0) * unit_to_src * (256.0 / view_h)
            if abs((box[2] - box[0]) * 256.0 - expected_w) / expected_w > 0.15:
                stretched += 1
            # One clean downsample (view -> 32x32 LANCZOS) vs the two-step path.
            ctx_src_w = (x1 - x0) * unit_to_src * ROI_CONTEXT
            ctx_src_h = (y1 - y0) * unit_to_src * ROI_CONTEXT
            cx = (px[0] + px[2]) / 2
            cy = (px[1] + px[3]) / 2
            dx0, dy0 = int(round(cx - ctx_src_w / 2)), int(round(cy - ctx_src_h / 2))
            dx1, dy1 = int(round(cx + ctx_src_w / 2)), int(round(cy + ctx_src_h / 2))
            region = full[max(0, dy0):dy1, max(0, dx0):dx1]
            direct = np.asarray(
                Image.fromarray(region).resize((ROI_CROP, ROI_CROP), Image.LANCZOS),
                dtype=np.float32) / 255.0
            direct_disagree.append(float(np.abs(direct - roi).mean()))

    def summarize(rows: list[dict]) -> dict:
        out: dict = {"n": len(rows)}
        for key in ("h", "w", "distinct_levels", "ink_occupancy", "edge_energy_per_px"):
            values = np.array([r[key] for r in rows], dtype=np.float64)
            out[key] = {"median": round(float(np.median(values)), 3)}
        return out

    report = {
        "scope": "40 train pages; 614 FIT + 153 SAME; no held-out; no inference",
        "resampling_ops": [
            "1. Chromium SVG->PNG at 2x for notation/tab bands (view source)",
            "2. loader: band crop height -> 256 LANCZOS (uniform x/y), tile slicing; "
            "short final tiles stretched to 256 wide (documented)",
            "3. sample_roi: 1.6x context box in plane px -> 32x32 grid_sample bilinear",
        ],
        "stages": {name: summarize(rows) for name, rows in stages.items()},
        "distinct_source_px_per_roi_output_px_median": round(float(np.median(src_per_roi_px)), 2),
        "degenerate_patches_skipped": degenerate,
        "stretched_tile_objects": stretched,
        "direct_view_to_32_vs_pipeline_mean_abs_delta": round(float(np.mean(direct_disagree)), 5),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k != "stages"}, indent=2))
    print("stages:", json.dumps(report["stages"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
