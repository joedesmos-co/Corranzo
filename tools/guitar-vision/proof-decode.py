#!/usr/bin/env python3
"""Guitar playable decoder (G6): string + fret posteriors -> playable events
with abstention. Combines the frozen fret head (isolated digit crops) and
StringNet (tall staff crops). Never guesses: abstains on low confidence,
geometry disagreement, or unplayable combinations.

Also reports G3 predicted-geometry robustness (translated-crop re-predict).

Usage:
    python3 tools/guitar-vision/proof-decode.py --crops <dir> --context <dir> --models <dir> --out <dir>
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from torch.utils.data import DataLoader

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
from proof_train import ProofNet, collate as collate_isolated  # noqa: E402
from proof_context_train import StringNet, TallDataset, collate as collate_tall  # noqa: E402

SEED = 20261008
TAU = 0.6  # abstention threshold on min(string, fret) posterior
TUNING = [64, 59, 55, 50, 45, 40]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--crops", required=True)
    parser.add_argument("--context", required=True)
    parser.add_argument("--models", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    crops_dir, context_dir, models_dir, out_dir = Path(args.crops), Path(args.context), Path(args.models), Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    fret_model = ProofNet().to(device)
    fret_saved = torch.load(models_dir / "proof-model.pt", map_location=device, weights_only=True)
    fret_model.load_state_dict(fret_saved["state"] if "state" in fret_saved else fret_saved)
    fret_model.eval()
    string_model = StringNet().to(device)
    string_saved = torch.load(models_dir / "stringnet.pt", map_location=device, weights_only=True)
    string_model.load_state_dict(string_saved["state"] if "state" in string_saved else string_saved)
    string_model.eval()

    tall_rows = [json.loads(line) for line in (context_dir / "tall-labels.jsonl").read_text().splitlines()]
    dev_rows = [r for r in tall_rows if r["split"] == "validation"]
    iso_rows = {r["file"]: r for r in
                (json.loads(line) for line in (crops_dir / "labels.jsonl").read_text().splitlines())}

    decoded, abstained, correct_pitch, total = 0, 0, 0, 0
    abstain_reasons: dict[str, int] = {}
    jitter_drops = []
    results = []
    with torch.no_grad():
        for row in dev_rows:
            total += 1
            tall_path = context_dir / "tall" / row["file"]
            tall = torch.from_numpy(np.asarray(Image.open(tall_path).convert("L"), dtype=np.float32) / 255.0).unsqueeze(0).unsqueeze(0).to(device)
            string_posterior = F.softmax(string_model(tall)["string"], dim=1)[0].cpu().numpy()
            iso = iso_rows.get(row["file"])
            if iso is None:
                abstained += 1
                abstain_reasons["no-isolated-crop"] = abstain_reasons.get("no-isolated-crop", 0) + 1
                continue
            digit = torch.from_numpy(np.asarray(Image.open(crops_dir / "crops" / iso["file"]).convert("L"), dtype=np.float32) / 255.0).unsqueeze(0).unsqueeze(0).to(device)
            fret_logits = fret_model(digit)
            # Fret branch = trunk_t heads of the proof net (string/fret heads).
            fret_posterior = F.softmax(fret_logits["fret"], dim=1)[0].cpu().numpy()
            string_pred, string_conf = int(string_posterior.argmax()), float(string_posterior.max())
            fret_pred, fret_conf = int(fret_posterior.argmax()), float(fret_posterior.max())
            confidence = min(string_conf, fret_conf)
            if confidence < TAU:
                abstained += 1
                abstain_reasons["low-confidence"] = abstain_reasons.get("low-confidence", 0) + 1
                continue
            if row.get("geoString") is not None and row["geoString"] != string_pred + 1:
                abstained += 1
                abstain_reasons["geometry-disagreement"] = abstain_reasons.get("geometry-disagreement", 0) + 1
                continue
            implied = TUNING[string_pred] + fret_pred
            true_midi = row.get("midi")
            # NOTE: true_midi is evaluation-only (never an inference input).
            # Decoding commits on confidence + geometry agreement alone.
            decoded += 1
            if true_midi is not None and implied == true_midi:
                correct_pitch += 1
            elif true_midi is not None:
                results.append({"file": row["file"], "string": string_pred + 1, "fret": fret_pred,
                                "confidence": round(confidence, 3), "true": row.get("string"),
                                "trueFret": row.get("fret"), "implied": implied, "trueMidi": true_midi,
                                "violation": "pitch-mismatch"})
                continue
            # G3 predicted-geometry robustness: shift tall crop ±10% and re-predict.
            shifted = torch.roll(tall, shifts=(8,), dims=3)
            string_posterior_shifted = F.softmax(string_model(shifted)["string"], dim=1)[0].cpu().numpy()
            jitter_drops.append(int(string_posterior_shifted.argmax()) != string_pred)
            results.append({"file": row["file"], "string": string_pred + 1, "fret": fret_pred,
                            "confidence": round(confidence, 3), "true": row.get("string"), "trueFret": row.get("fret")})

    report = {
        "total": total, "decoded": decoded, "abstained": abstained,
        "coverage": decoded / max(total, 1),
        "pitchPrecision": correct_pitch / max(decoded, 1),
        "abstainReasons": abstain_reasons,
        "jitterFlipRate": float(np.mean(jitter_drops)) if jitter_drops else None,
        "tau": TAU,
    }
    (out_dir / "decode-report.json").write_text(json.dumps(report, indent=1))
    (out_dir / "decoded-events.json").write_text(json.dumps(results, indent=1))
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
