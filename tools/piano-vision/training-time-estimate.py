#!/usr/bin/env python3
"""Training time estimator for Piano Vision v1 (Phase 2.15B, measured MPS).

Usage:
  python3 training-time-estimate.py [TRAIN_EXAMPLES [EPOCHS]]
  python3 training-time-estimate.py               # print formula + presets

Uses the Phase 2.16 MEASURED real-trainer sustained Apple Silicon MPS throughput for TINY
at the representative 192x512 config (no assumed 3x multiplier):
  median  ~45.5 examples/s   (warm sustained window, production-throughput-baseline.json)
  fastest ~51.3 examples/s   (last warm-run rolling floor)
  slowest ~44.2 examples/s   (A/B equilibrium lower bound)

The previous 21.07 examples/s value was superseded: it came from a single bounded 24-step
run whose median was contaminated by a 300-520 ms cold-start prefix.

The final train-example count is not known until semantic assembly finishes;
supply it as the first argument for an instant recalculation. Default epochs
remain 40 (frozen); the estimator only reports time, it never shortens the plan.

No training is started. This only computes an estimate.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Phase 2.16 reconciled sustained MPS TINY (192x512) examples/sec.
MEASURED_MPS_EPS = {"slowest": 44.2, "median": 45.5, "fastest": 51.3}


def format_duration(seconds):
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes = seconds / 60
    if minutes < 60:
        return f"{minutes:.1f}m"
    hours = minutes / 60
    if hours < 48:
        return f"{hours:.1f}h"
    days = hours / 24
    return f"{days:.1f}d"


def estimate(train_examples, epochs=40):
    total_examples = int(train_examples) * int(epochs)
    worst = total_examples / MEASURED_MPS_EPS["slowest"]
    med = total_examples / MEASURED_MPS_EPS["median"]
    best = total_examples / MEASURED_MPS_EPS["fastest"]
    return {
        "train_examples": int(train_examples),
        "epochs": int(epochs),
        "total_example_steps": total_examples,
        "device": "mps",
        "measured_examples_per_second": MEASURED_MPS_EPS,
        "estimated_seconds": {
            "conservative_slowest": round(worst),
            "median": round(med),
            "optimistic_fastest": round(best),
        },
        "estimated_human": {
            "conservative_slowest": format_duration(worst),
            "median": format_duration(med),
            "optimistic_fastest": format_duration(best),
        },
        "per_1M_examples_hours": {
            "10_epochs": {
                "conservative": round(1_000_000 * 10 / MEASURED_MPS_EPS["slowest"] / 3600, 1),
                "median": round(1_000_000 * 10 / MEASURED_MPS_EPS["median"] / 3600, 1),
                "optimistic": round(1_000_000 * 10 / MEASURED_MPS_EPS["fastest"] / 3600, 1),
            },
            "20_epochs": {
                "conservative": round(1_000_000 * 20 / MEASURED_MPS_EPS["slowest"] / 3600, 1),
                "median": round(1_000_000 * 20 / MEASURED_MPS_EPS["median"] / 3600, 1),
                "optimistic": round(1_000_000 * 20 / MEASURED_MPS_EPS["fastest"] / 3600, 1),
            },
            "40_epochs": {
                "conservative": round(1_000_000 * 40 / MEASURED_MPS_EPS["slowest"] / 3600, 1),
                "median": round(1_000_000 * 40 / MEASURED_MPS_EPS["median"] / 3600, 1),
                "optimistic": round(1_000_000 * 40 / MEASURED_MPS_EPS["fastest"] / 3600, 1),
            },
        },
        "disclaimer": "Measured sustained MPS (Phase 2.16 reconciled) TINY 192x512 batch=8 FP32; informational only. Frozen 40-epoch default unchanged.",
    }


def main():
    args = sys.argv[1:]
    if not args:
        print(json.dumps({
            "formula": "training_hours = (final_train_examples * epochs) / (measured_examples_per_second * 3600)",
            "measured_mps_examples_per_second_tiny_192x512": MEASURED_MPS_EPS,
            "run_with": "python3 training-time-estimate.py <TRAIN_EXAMPLES> [EPOCHS]",
        }, indent=2, sort_keys=True))
        return
    train_examples = int(args[0])
    epochs = int(args[1]) if len(args) > 1 else 40
    print(json.dumps(estimate(train_examples, epochs), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
