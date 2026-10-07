"""G5 normalization test (train pages only; FROZEN production head; never held-out).

Builds source-direct canonical 32x32 ROIs (preregistered in
docs/GUITAR_VISION_GLYPH_NORMALIZATION_PREREG.md): record boxUnits -> source view
px, 1.6x context, one LANCZOS downsample to 32x32. Runs the frozen c1d8ff7ba0 head:
FIT native, SAME native, frozen FIT/SAME lattice, batch-invariance of the path.
Writes tmp/gvprobe/glyph-normalization.json. No training.
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
from guitar_vision.dataset import load_dataset  # noqa: E402
from guitar_vision.inference import load as load_model  # noqa: E402
from guitar_vision.roi import ROI_CONTEXT, ROI_CROP  # noqa: E402
from guitar_vision.scale_stress import accuracy_by_subset, perturb_crop, severity_levels

RECORDS = _REPO / "datasets/guitar-vision/synthetic/train/records"
VIEWS = _REPO / "datasets/guitar-vision/synthetic/train/views"
SPLIT_MATRIX = Path("tmp/gvprobe/P_std_step1200.npz")
ARTIFACT = Path("tmp/gvprobe/dedicated-roi-production.pt")
OUT = Path("tmp/gvprobe/glyph-normalization.json")


def direct_rois() -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Source-direct 32x32 ROIs for the 767 train fret objects in matrix order."""
    blob = np.load(SPLIT_MATRIX)
    scores, page, row = blob["scores"], blob["page"], blob["row"]
    fit_all, same_all, held_all, _ = d8.splits(scores, page, row)
    assert (int(fit_all.sum()), int(same_all.sum()), int(held_all.sum())) == (614, 153, 395)
    everything = load_dataset(RECORDS, VIEWS, size=(256, 256), limit=40)
    assert len(everything) == 40
    order = []
    for page_index, sample in enumerate(everything):
        keep = (sample["object_type"] == 1).nonzero(as_tuple=True)[0].tolist()
        order.extend([(page_index, r) for r in keep])
    assert len(order) == 767

    crops = []
    labels = []
    for position, (page_index, fret_row) in enumerate(order):
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
        full = np.asarray(Image.open(VIEWS / view / f"{score_id}.png").convert("L"))
        cx = ((x0 + x1) / 2 - cx0) * unit_to_src
        cy = ((y0 + y1) / 2 - cy0) * unit_to_src
        half_w = (x1 - x0) * unit_to_src * ROI_CONTEXT / 2
        half_h = (y1 - y0) * unit_to_src * ROI_CONTEXT / 2
        region = full[max(0, int(round(cy - half_h))):int(round(cy + half_h)),
                      max(0, int(round(cx - half_w))):int(round(cx + half_w))]
        roi = np.asarray(Image.fromarray(region).resize(
            (ROI_CROP, ROI_CROP), Image.LANCZOS), dtype=np.float32) / 255.0
        crops.append(roi.reshape(-1))
        labels.append(int(sample["fret"][fret_row]))
    X = np.asarray(crops, dtype=np.float32)
    y = np.asarray(labels)
    assert X.shape == (767, 1024) and np.array_equal(y, blob["labels"][:767])
    return X, y, fit_all[:767], same_all[:767]


def main() -> int:
    X, y, fit, same = direct_rois()
    model = load_model(ARTIFACT, "cpu")
    head = model._model.roi_head
    head.eval()
    for name, parameter in model._model.named_parameters():
        assert not parameter.requires_grad, name  # frozen means frozen

    report: dict = {
        "method": "source-direct canonical ROI (preregistered)",
        "scope": "40 train pages; 614 FIT + 153 SAME; frozen c1d8ff7ba0 head; no held-out",
    }
    with torch.no_grad():
        Xsq = torch.from_numpy(X).reshape(-1, ROI_CROP, ROI_CROP)
        # G10: the candidate path reads static PNGs per object; verify repeat
        # computation is bitwise identical (batch composition cannot enter).
        again = torch.from_numpy(direct_rois()[0]).reshape(-1, ROI_CROP, ROI_CROP)
        assert torch.equal(Xsq, again), "direct ROI path is not deterministic"
        report["batch_invariance"] = {"repeat_equal": True}

        native = head(Xsq.reshape(-1, 1024)).argmax(-1).numpy()
        report["fit_native"] = accuracy_by_subset(native, y, fit)
        report["same_native"] = accuracy_by_subset(native, y, same)
        print(f"FIT native {report['fit_native']} SAME native {report['same_native']}",
              flush=True)
        lattice = []
        for level in severity_levels():
            perturbed = torch.stack([perturb_crop(crop, level) for crop in Xsq])
            prediction = head(perturbed.reshape(len(Xsq), -1)).argmax(-1).numpy()
            entry = {"level": level.name,
                     "fit": accuracy_by_subset(prediction, y, fit),
                     "same": accuracy_by_subset(prediction, y, same)}
            lattice.append(entry)
            print(f"{level.name:<11} fit {entry['fit']['accuracy']:.4f} "
                  f"same {entry['same']['accuracy']:.4f}", flush=True)
        report["lattice"] = lattice

    degraded = [entry["fit"]["accuracy"] for entry in lattice[1:]]
    case_a = (report["fit_native"]["accuracy"] >= 0.999
              and report["same_native"]["accuracy"] >= 0.999
              and float(np.mean(degraded)) >= 0.50)
    native_harmed = (report["fit_native"]["accuracy"] < 0.999
                     or report["same_native"]["accuracy"] < 0.999)
    verdict = "CASE A" if case_a else ("CASE B" if native_harmed else "CASE C")
    report["decision"] = {"mean_degraded_fit": round(float(np.mean(degraded)), 6),
                          "verdict": verdict}
    print(f"mean degraded FIT {report['decision']['mean_degraded_fit']} -> {verdict}",
          flush=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
