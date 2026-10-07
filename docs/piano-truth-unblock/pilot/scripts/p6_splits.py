#!/usr/bin/env python3
"""P6 — frozen score-level TRAIN/DEV/TEST splits.

Deterministic from a recorded seed; only PASS scores are split. No page or
measure from one source can cross splits because assignment is per source id.
Writes manifests/splits.json + sha256.

Usage:
  python3 p6_splits.py --seed 20261007 --train 0.8 --dev 0.1
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PILOT = HERE.parent
RENDER = PILOT / "data" / "render"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20261007)
    ap.add_argument("--train", type=float, default=0.8)
    ap.add_argument("--dev", type=float, default=0.1)
    args = ap.parse_args()

    passed = []
    for meta in sorted(RENDER.glob("*/meta.json")):
        try:
            m = json.loads(meta.read_text())
        except Exception:
            continue
        if m.get("status") == "PASS":
            passed.append(m["source_id"])

    ranked = sorted(passed, key=lambda sid: hashlib.sha256(f"{args.seed}|split|{sid}".encode()).hexdigest())
    n = len(ranked)
    n_train = int(n * args.train)
    n_dev = int(n * args.dev)
    splits = {
        "schema": "corranzo.piano.pilot.splits/1",
        "seed": args.seed,
        "basis": "sha256(seed|split|source_id) ascending over PASS scores",
        "level": "score",
        "counts": {"train": n_train, "dev": n_dev, "test": n - n_train - n_dev},
        "train": ranked[:n_train],
        "dev": ranked[n_train:n_train + n_dev],
        "test": ranked[n_train + n_dev:],
    }
    out = PILOT / "manifests" / "splits.json"
    text = json.dumps(splits, indent=1, sort_keys=True)
    out.write_text(text)
    (out.with_suffix(".sha256")).write_text(
        hashlib.sha256(text.encode()).hexdigest() + "  " + out.name + "\n")
    print(f"[p6] splits: {splits['counts']} -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
