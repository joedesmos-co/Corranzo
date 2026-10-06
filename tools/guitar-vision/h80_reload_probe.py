"""Fresh-process reload probe for the two-phase checkpoint (P10).

Loads the saved phase-2 checkpoint in a clean interpreter with no cached feature
matrix, runs deterministic evaluation, and prints hashes of the statistics and the
held-out predictions. The parent compares them against its own, so a serialisation or
load-order difference shows up as a hash mismatch rather than as a plausible-looking
accuracy.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import torch

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE / "python"))

import d8_stage_probes as d8  # noqa: E402
from guitar_vision.dataset import collate, load_dataset  # noqa: E402
from guitar_vision.fret_experiments import build  # noqa: E402
from guitar_vision.qualify import Device  # noqa: E402

VARIANT = "TWO_PHASE_STANDARDIZED"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--cached-p", type=Path, default=Path("tmp/gvprobe/P_std_step1200.npz"))
    parser.add_argument("--image-size", type=int, default=256)
    parser.add_argument("--max-objects", type=int, default=128)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    device = Device("cpu")
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    config = checkpoint["config"]
    namespace = argparse.Namespace(
        variant=VARIANT, steps=1200, pages=40, batch_pages=4, held_out=20,
        image_size=config["image_size"], max_objects=config["max_objects"],
        hidden=config["hidden"], layers=config["layers"], lr=3e-3, train_jitter=0.35,
        roi_grid=config["roi_grid"], roi_context=config["roi_context"],
        seed=config["seed"], device="cpu", out=None)
    model = build(VARIANT, namespace, device)
    model.load_state_dict(checkpoint["model"])
    model.eval()

    blob = np.load(args.cached_p)
    labels, scores, page, row = blob["labels"], blob["scores"], blob["page"], blob["row"]
    _, _, held, _ = d8.splits(scores, page, row)

    everything = load_dataset(
        _REPO / "datasets/guitar-vision/synthetic/train/records",
        _REPO / "datasets/guitar-vision/synthetic/train/views",
        size=(config["image_size"], config["image_size"]), limit=0)
    collected, held_labels = [], []
    # One page per forward, the convention the artifact was trained under.
    for start in range(0, len(everything), 1):
        batch = collate(everything[start:start + 1], config["max_objects"])
        batch = {k: (v.to(device.torch) if torch.is_tensor(v) else v)
                 for k, v in batch.items()}
        with torch.no_grad():
            out = model(batch)
        is_fret = batch["object_mask"] & (batch["object_type"] == 1)
        collected.append(out["fret"].argmax(-1)[is_fret].numpy())
    prediction = np.concatenate(collected)
    held_prediction = prediction[held]
    held_truth = labels[held]

    payload = {
        "mean_sha": hashlib.sha256(model.p_standardizer.mean.numpy().tobytes()).hexdigest(),
        "sigma_sha": hashlib.sha256(model.p_standardizer.sigma.numpy().tobytes()).hexdigest(),
        "count": float(model.p_standardizer.count.item()),
        "prediction_sha": hashlib.sha256(held_prediction.tobytes()).hexdigest(),
        "score_disjoint": round(float((held_prediction == held_truth).mean()), 6),
        "correct": int((held_prediction == held_truth).sum()),
        "n": int(len(held_truth)),
    }
    args.out.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())