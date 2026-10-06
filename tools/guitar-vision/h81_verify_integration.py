"""Integration verification: reproduce the golden two-phase numbers through production.

This is not a training script and not a test. It loads the validated artifact with the
production loader and re-measures every headline number through the public page-at-a-time
API, so that "the integration works" means the same measurements as before and not merely
that the checkpoint opens.

Nothing is trained. The model is read-only.

## Golden values

    score-disjoint   0.5899   233 / 395
    1-digit          0.6744
    2-digit          0.4889
    blank            0.0532
    wrong ROI        0.0684
    pixel ablation   0.0608

Any deviation beyond the tolerances below is an integration defect, not a result.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE / "python"))

from guitar_vision.dataset import load_dataset  # noqa: E402
from guitar_vision.inference import GuitarFretModel, load  # noqa: E402

GOLDEN = {
    "score_disjoint": 0.5899,
    "correct": 233,
    "total": 395,
    "one_digit": 0.6744,
    "two_digit": 0.4889,
    "blank": 0.0532,
    "wrong_roi": 0.0684,
    "pixel_ablation": 0.0608,
}
TOLERANCE = 0.002


def measure(model: GuitarFretModel, pages, intervention=None) -> dict:
    correct = total = 0
    one_correct = one_total = 0
    two_correct = two_total = 0
    for page, prediction in zip(pages, model.infer(pages, intervention=intervention)):
        target = page["fret"]
        keep = prediction.is_fret
        hits = prediction.fret[keep] == target[keep]
        correct += int(hits.sum())
        total += int(keep.sum())
        digits = target[keep] >= 10
        one_correct += int(hits[~digits].sum())
        one_total += int((~digits).sum())
        two_correct += int(hits[digits].sum())
        two_total += int(digits.sum())
    return {
        "accuracy": round(correct / max(total, 1), 6),
        "correct": correct,
        "total": total,
        "one_digit": round(one_correct / max(one_total, 1), 6),
        "two_digit": round(two_correct / max(two_total, 1), 6),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path,
                        default=Path("tmp/gvprobe/two-phase-ckpt/phase2.pt"))
    parser.add_argument("--out", type=Path, default=Path("tmp/gvprobe/integration-verify.json"))
    parser.add_argument("--image-size", type=int, default=256)
    args = parser.parse_args()

    model = load(args.checkpoint, "cpu")
    print(json.dumps(model.describe(), indent=2), flush=True)

    everything = load_dataset(
        _REPO / "datasets/guitar-vision/synthetic/train/records",
        _REPO / "datasets/guitar-vision/synthetic/train/views",
        size=(args.image_size, args.image_size), limit=0)
    # The score-disjoint split used throughout, rebuilt from the cached keys so this
    # script cannot silently score a different set.
    import numpy as np
    import d8_stage_probes as d8
    cached = np.load(_REPO / "tmp/gvprobe/P_std_step1200.npz")
    _, _, held_mask, _ = d8.splits(cached["scores"], cached["page"], cached["row"])
    held_pages = [everything[i] for i in range(40, 60)]

    normal = measure(model, held_pages)
    print(f"\nscore-disjoint  {normal['accuracy']:.4f}  "
          f"({normal['correct']}/{normal['total']})", flush=True)
    print(f"1-digit {normal['one_digit']:.4f}   2-digit {normal['two_digit']:.4f}",
          flush=True)

    controls = {}
    for mode in ("blank", "wrong_roi", "pixel_ablation"):
        controls[mode] = measure(model, held_pages, intervention=mode)
        print(f"{mode:<16} {controls[mode]['accuracy']:.4f}", flush=True)

    # Page-at-a-time contract, through the public API.
    pair = held_pages[:2]
    together = model.infer(pair)
    separate = [model.infer_page(pair[0]), model.infer_page(pair[1])]
    pagewise = all(torch.equal(a.fret_logits, b.fret_logits)
                   for a, b in zip(together, separate))
    print(f"\nmulti-page call is pagewise-equivalent: {pagewise}", flush=True)

    checks = {
        "score_disjoint": abs(normal["accuracy"] - GOLDEN["score_disjoint"]) < TOLERANCE,
        "correct": normal["correct"] == GOLDEN["correct"],
        "one_digit": abs(normal["one_digit"] - GOLDEN["one_digit"]) < TOLERANCE,
        "two_digit": abs(normal["two_digit"] - GOLDEN["two_digit"]) < TOLERANCE,
        "blank": abs(controls["blank"]["accuracy"] - GOLDEN["blank"]) < TOLERANCE,
        "wrong_roi": abs(controls["wrong_roi"]["accuracy"] - GOLDEN["wrong_roi"]) < TOLERANCE,
        "pixel_ablation": abs(controls["pixel_ablation"]["accuracy"]
                              - GOLDEN["pixel_ablation"]) < TOLERANCE,
        "pagewise_equivalent": bool(pagewise),
    }
    report = {
        "checkpoint": str(args.checkpoint),
        "checkpoint_sha256": model.checkpoint_sha256,
        "two_phase": model.two_phase,
        "metadata": None if model.metadata is None else model.metadata.__dict__,
        "observed": {"score_disjoint": normal, "controls": controls},
        "golden": GOLDEN, "tolerance": TOLERANCE, "checks": checks,
        "all_passed": all(checks.values()),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, default=str) + "\n")
    print("\n" + json.dumps(checks, indent=1), flush=True)
    print(f"ALL PASSED: {report['all_passed']}", flush=True)
    return 0 if report["all_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())