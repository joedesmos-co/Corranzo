#!/usr/bin/env python3
"""Guitar proof evaluation (G5/G6/G7): DEV metrics, causal controls, playable
reconstruction.

Reads a trained proof model + crops, writes:
- dev-metrics.json (per head, per tier/class/layout subgroup)
- causal.json (blank / shuffled / wrong-crop / geometry-only results)
- reconstruction.json (playable-event rebuild from predicted labels:
  pitch/string/fret consistency, same-string conflicts, voice-measure sums)

Usage:
    python3 tools/guitar-vision/proof-eval.py --crops <dir> --model <dir> --out <dir>
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from torch.utils.data import DataLoader

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parents[2]
sys.path.insert(0, str(TOOLS))
from proof_train import CropDataset, ProofNet, collate, move_batch  # noqa: E402

SEED = 20261007
DURATIONS = ["whole", "half", "quarter", "eighth", "16th", "32nd", "64th"]


def load_model(model_dir: Path, device):
    from proof_train import ProofNet
    model = ProofNet().to(device)
    saved = torch.load(model_dir / "proof-model.pt", map_location=device, weights_only=True)
    model.load_state_dict(saved["state"])
    model.eval()
    return model


@torch.no_grad()
def predict_all(model, loader, device):
    rows, predictions = [], {}
    for batch in loader:
        batch = move_batch(batch, device)
        out = model(batch["x"])
        for key in ("family", "midi", "duration", "dots", "voice", "string", "fret"):
            predictions.setdefault(key, []).append(out[key].argmax(1).cpu())
        predictions.setdefault("tech", []).append((out["tech"] > 0).long().cpu())
    return {key: torch.cat(values).numpy() for key, values in predictions.items()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--crops", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    crops_dir, model_dir, out_dir = Path(args.crops), Path(args.model), Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    dev_set = CropDataset(crops_dir, "validation", "none")
    dev_loader = DataLoader(dev_set, batch_size=256, shuffle=False, num_workers=0, collate_fn=collate)
    model = load_model(model_dir, device)
    preds = predict_all(model, dev_loader, device)
    rows = dev_set.rows

    # ---- G5: per-head accuracy overall + by tier/family subgroup.
    metrics: dict = {"overall": {}, "byTier": {}, "byFamily": {}}
    heads = ["family", "midi", "duration", "dots", "voice", "string", "fret", "tech"]
    truth = {
        "family": np.array([["note", "rest", "tabdigit"].index(r["family"]) for r in rows]),
        "midi": np.array([r["midi"] if r["midi"] is not None else -1 for r in rows]),
        "duration": np.array([DURATIONS.index(r["duration"]) if r["duration"] in DURATIONS else -1 for r in rows]),
        "dots": np.array([int(r.get("dots") or 0) for r in rows]),
        "voice": np.array([int(r.get("voice") or 1) - 1 for r in rows]),
        "string": np.array([(r.get("string") or 1) - 1 if r.get("string") else -1 for r in rows]),
        "fret": np.array([r.get("fret") if r.get("fret") is not None else -1 for r in rows]),
        "tech": np.array([1 if (r.get("techniques") or []) else 0 for r in rows]),
    }
    masks = {
        "family": np.ones(len(rows), dtype=bool),
        "midi": np.array([r["family"] != "rest" for r in rows]),
        "duration": np.array([(r["duration"] in DURATIONS) and r["family"] != "rest" and not r.get("maskedMeasure") for r in rows]),
        "dots": np.array([r["family"] != "rest" and not r.get("maskedMeasure") for r in rows]),
        "voice": np.array([not r.get("maskedMeasure") for r in rows]),
        "string": np.array([r["family"] == "tabdigit" for r in rows]),
        "fret": np.array([r["family"] == "tabdigit" for r in rows]),
        "tech": np.ones(len(rows), dtype=bool),
    }
    tiers = np.array([r["tier"] for r in rows])
    families = np.array([r["family"] for r in rows])
    support: dict = {}
    for head in heads:
        mask = masks[head]
        support[head] = int(mask.sum())
        metrics["overall"][head] = float((preds[head][mask] == truth[head][mask]).mean()) if mask.sum() else None
        metrics["byTier"][head] = {}
        for tier in sorted(set(tiers)):
            sub = mask & (tiers == tier)
            metrics["byTier"][head][tier] = {
                "accuracy": float((preds[head][sub] == truth[head][sub]).mean()) if sub.sum() else None,
                "support": int(sub.sum()),
            }
        metrics["byFamily"][head] = {}
        for family in sorted(set(families)):
            sub = mask & (families == family)
            if sub.sum():
                metrics["byFamily"][head][family] = {
                    "accuracy": float((preds[head][sub] == truth[head][sub]).mean()),
                    "support": int(sub.sum()),
                }
    metrics["support"] = support
    (out_dir / "dev-metrics.json").write_text(json.dumps(metrics, indent=1))

    # ---- G6 causal controls.
    causal = {}
    # blank: all-zero input through the TRAINED model.
    blank_set = CropDataset(crops_dir, "validation", "blank")
    blank_loader = DataLoader(blank_set, batch_size=256, shuffle=False, num_workers=0, collate_fn=collate)
    blank_preds = predict_all(model, blank_loader, device)
    causal["blank_family_accuracy"] = float((blank_preds["family"] == truth["family"]).mean())
    # wrong-crop proxy: permute crop<->label mapping (right pixels, wrong
    # associations). A pixel-reading model must collapse to chance.
    perm = np.random.RandomState(SEED + 1).permutation(len(rows))
    permuted = {head: preds[head][perm] for head in heads}
    causal["wrongcrop_family_accuracy"] = float((permuted["family"] == truth["family"]).mean())
    causal["wrongcrop_fret_accuracy"] = float((permuted["fret"][masks["fret"]] == truth["fret"][masks["fret"]]).mean()) if masks["fret"].sum() else None
    # majority floors from TRAIN marginals (no-signal reference).
    train_rows = [json.loads(line) for line in (crops_dir / "labels.jsonl").read_text().splitlines() if json.loads(line)["split"] == "train"]
    from collections import Counter
    for head, key in [("family", "family"), ("duration", "duration"), ("voice", "voice")]:
        values = [r[key] for r in train_rows if r.get(key) is not None]
        top, count = Counter(values).most_common(1)[0]
        dev_values = [r[key] for r in rows]
        causal[f"majority_{head}"] = {"label": top, "accuracy": float(sum(1 for v in dev_values if v == top) / max(len(dev_values), 1))}
    (out_dir / "causal.json").write_text(json.dumps(causal, indent=1))

    # ---- G7 playable reconstruction from predicted labels on GT boxes.
    # Tab-digit rows: implied pitch from PREDICTED string/fret vs the event's
    # TRUE midi: do the predictions compose to playable truth?
    # Same-string conflicts group tabdigit rows by (score, measure) with
    # predicted vs true positions (coarse simultaneity proxy; comparative).
    TUNING = [64, 59, 55, 50, 45, 40]
    recon = {"digitPitchMatch": 0, "digitTotal": 0, "predConflicts": 0, "trueConflicts": 0, "byMeasure": {}}
    tab_rows = [(i, r) for i, r in enumerate(rows) if r["family"] == "tabdigit"]
    for i, r in tab_rows:
        true_midi = r["midi"]
        implied = TUNING[int(preds["string"][i])] + int(preds["fret"][i])
        recon["digitTotal"] += 1
        if true_midi is not None and implied == true_midi:
            recon["digitPitchMatch"] += 1
    groups: dict[tuple, list[int]] = defaultdict(list)
    for i, r in tab_rows:
        groups[(r["score"], r.get("measure"))].append(i)
    for key, indices in groups.items():
        for positions, label in (("pred", None), ("true", None)):
            seen = set()
            for i in indices:
                s = int(preds["string"][i]) if positions == "pred" else ((rows[i].get("string") or 1) - 1)
                if s in seen:
                    if positions == "pred":
                        recon["predConflicts"] += 1
                    else:
                        recon["trueConflicts"] += 1
                else:
                    seen.add(s)
    recon["digitPitchAccuracy"] = recon["digitPitchMatch"] / max(recon["digitTotal"], 1)
    (out_dir / "reconstruction.json").write_text(json.dumps(recon, indent=1))
    print(json.dumps({"dev": metrics["overall"], "causal": causal, "reconstruction": {k: v for k, v in recon.items() if k != "byMeasure"}}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
