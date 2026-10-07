"""S3/S4 one-shot augmented training of the dedicated ROI head (FIT crops only).

Preregistered in docs/GUITAR_VISION_SCALE_ROBUSTNESS_PREREG.md. This script:
- extracts the 767 train crops through the model's own roi_crops path (held-out
  never loaded),
- trains RoiFretCnn on FIT crops with the preregistered train-only degradation
  mixture (0.5 native, uniform over the six frozen lattice levels),
- evaluates FIT native, SAME native, and the full frozen FIT/SAME lattice,
- applies the frozen CASE B/C decision rule. It never reads held-out.

Same CNN, optimizer, budget, and seed as h82; the only difference is the
per-crop augmentation draw from the same seeded generator.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE / "python"))

import d8_stage_probes as d8  # noqa: E402
from guitar_vision.dataset import collate, load_dataset  # noqa: E402
from guitar_vision.fret_experiments import build  # noqa: E402
from guitar_vision.qualify import Device  # noqa: E402
from guitar_vision.roi import ROI_CONTEXT, ROI_CROP  # noqa: E402
from guitar_vision.scale_stress import (  # noqa: E402
    accuracy_by_subset,
    perturb_crop,
    severity_levels,
)
from h82_dedicated_roi_branch import args_for  # noqa: E402

SEED = 11
STEPS = 3000
BATCH = 64
LR = 1e-3
VARIANT = "DEDICATED_ROI_FRET"
NATIVE_PROB = 0.5
CASE_B_NATIVE_FLOOR = 0.999
CASE_B_DEGRADED_FLOOR = 0.50

LEVELS = [level for level in severity_levels() if level.resolution != 1.0]
assert len(LEVELS) == 6


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase1", type=Path, default=Path("tmp/gvprobe/std-ckpt/step1200"))
    parser.add_argument("--cached-p", type=Path, default=Path("tmp/gvprobe/P_std_step1200.npz"))
    parser.add_argument("--ckpt", type=Path,
                        default=Path("tmp/gvprobe/dedicated-roi-aug-ckpt/head.pt"))
    parser.add_argument("--out", type=Path, default=Path("tmp/gvprobe/scale-robustness.json"))
    args = parser.parse_args()

    device = Device("cpu")
    everything = load_dataset(
        _REPO / "datasets/guitar-vision/synthetic/train/records",
        _REPO / "datasets/guitar-vision/synthetic/train/views",
        size=(256, 256), limit=40)
    assert len(everything) == 40, "augmented training sees train pages only"
    blob = np.load(args.cached_p)
    labels_all, scores, page, row = blob["labels"], blob["scores"], blob["page"], blob["row"]
    fit_all, same_all, held_all, _ = d8.splits(scores, page, row)
    assert (int(fit_all.sum()), int(same_all.sum()), int(held_all.sum())) == (614, 153, 395)
    fit = fit_all[:767]
    same = same_all[:767]
    assert int(fit.sum()) == 614 and int(same.sum()) == 153

    torch.manual_seed(SEED)
    model = build(VARIANT, args_for(VARIANT, 256, 128), device)
    state = torch.load(args.phase1 / "state.pt", map_location="cpu", weights_only=False)
    base_weights = {k: v for k, v in state["model"].items() if k.startswith("base.")}
    missing, unexpected = model.load_state_dict(base_weights, strict=False)
    assert all(k.startswith("roi_head.") for k in missing), sorted(missing)
    assert unexpected == [], unexpected
    model.eval()

    crops = []
    crop_labels = []
    with torch.no_grad():
        for sample in everything:
            batch = collate([sample], 128)
            batch = {k: (v.to(device.torch) if torch.is_tensor(v) else v)
                     for k, v in batch.items()}
            this = model.roi_crops(batch)
            keep = (batch["object_type"][0] == 1).nonzero(as_tuple=True)[0].tolist()
            crops.append(this[0, keep].numpy())
            crop_labels.extend(int(batch["fret"][0, r]) for r in keep)
    X = np.concatenate(crops).astype(np.float32)
    y = np.asarray(crop_labels)
    assert X.shape == (767, 1024) and np.array_equal(y, labels_all[:767])

    head = model.roi_head
    head.train()
    optimiser = torch.optim.Adam(head.parameters(), lr=LR)
    generator = torch.Generator().manual_seed(SEED)
    loss_fn = torch.nn.CrossEntropyLoss()
    xt = torch.from_numpy(X[fit]).reshape(-1, ROI_CROP, ROI_CROP)
    yt = torch.from_numpy(y[fit].astype(np.int64))

    def augment(batch: torch.Tensor, gen: torch.Generator) -> torch.Tensor:
        draws = torch.rand(batch.shape[0], generator=gen)
        out = []
        for crop, draw in zip(batch, draws.tolist()):
            if draw < NATIVE_PROB:
                out.append(crop.clone())
            else:
                slot = int(torch.randint(0, len(LEVELS), (1,), generator=gen).item())
                out.append(perturb_crop(crop, LEVELS[slot]))
        return torch.stack(out).reshape(batch.shape[0], -1)

    curve = []
    for step in range(1, STEPS + 1):
        index = torch.randint(0, xt.shape[0], (BATCH,), generator=generator)
        inputs = augment(xt[index], generator)
        optimiser.zero_grad()
        loss = loss_fn(head(inputs), yt[index])
        loss.backward()
        optimiser.step()
        if step in (200, 400, 700, 1200, 2000, 3000):
            head.eval()
            with torch.no_grad():
                entry = {"step": step, "batch_loss": round(float(loss.detach()), 6),
                         "train_acc": round(float(
                             (head(xt.reshape(xt.shape[0], -1)).argmax(-1) == yt)
                             .float().mean()), 6)}
            head.train()
            curve.append(entry)
            print(entry, flush=True)
    head.eval()

    report: dict = {
        "preregistration": "docs/GUITAR_VISION_SCALE_ROBUSTNESS_PREREG.md",
        "recipe": {"native_prob": NATIVE_PROB,
                   "levels": [level.name for level in LEVELS],
                   "steps": STEPS, "batch": BATCH, "lr": LR,
                   "optimizer": "Adam", "seed": SEED},
        "curve": curve,
    }
    with torch.no_grad():
        Xsq = torch.from_numpy(X).reshape(-1, ROI_CROP, ROI_CROP)
        native = head(Xsq.reshape(-1, 1024)).argmax(-1).numpy()
        fit_native = accuracy_by_subset(native, y, fit)
        same_native = accuracy_by_subset(native, y, same)
        report["fit_native"] = fit_native
        report["same_native"] = same_native
        print(f"FIT native {fit_native} SAME native {same_native}", flush=True)
        lattice = []
        for level in severity_levels():
            perturbed = torch.stack([perturb_crop(crop, level) for crop in Xsq])
            prediction = head(perturbed.reshape(len(Xsq), -1)).argmax(-1).numpy()
            entry = {"level": level.name, "resolution": level.resolution,
                     "fit": accuracy_by_subset(prediction, y, fit),
                     "same": accuracy_by_subset(prediction, y, same)}
            lattice.append(entry)
            print(f"{level.name:<11} fit {entry['fit']['accuracy']:.4f} "
                  f"same {entry['same']['accuracy']:.4f}", flush=True)
        report["lattice"] = lattice

    degraded = [entry["fit"]["accuracy"] for entry in lattice[1:]]
    case_b = (fit_native["accuracy"] >= CASE_B_NATIVE_FLOOR
              and same_native["accuracy"] >= CASE_B_NATIVE_FLOOR
              and float(np.mean(degraded)) >= CASE_B_DEGRADED_FLOOR)
    report["decision"] = {
        "rule": ("CASE B iff FIT native >= 0.999 and SAME native >= 0.999 and "
                 "mean degraded FIT >= 0.50"),
        "mean_degraded_fit": round(float(np.mean(degraded)), 6),
        "verdict": "CASE B" if case_b else "CASE C",
    }
    print(f"mean degraded FIT {report['decision']['mean_degraded_fit']} "
          f"-> {report['decision']['verdict']}", flush=True)

    args.ckpt.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"model": {f"roi_head.{k}": v.cpu() for k, v in head.state_dict().items()}},
               args.ckpt)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(f"wrote {args.ckpt} {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
