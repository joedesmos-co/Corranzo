"""D3-D7 - ROI-only probes: can the fret pixels alone support score-disjoint classes?

This is a **falsification probe**, not a production architecture proposal. The
production model is not modified, imported for its representation, or proposed as a
design. The probe receives exactly one thing:

    a 32x32 greyscale crop, produced by the production ROI sampler

and an integer label. It never sees box coordinates, page coordinates, staff
position, string, score identity, any context feature, or any backbone activation.
The string and score fields are carried only to *build the splits* and are dropped
before the tensor reaches the network.

## The three splits

    A  train-instance          accuracy on the training instances themselves
    B  same-score, unseen inst held-out *instances* drawn from the same 40 scores
    C  score-disjoint          the frozen 20 held-out scores

B and C differ only in whether the score is shared, and that difference is the
whole question. B is built by splitting *instances* within each train score by a
deterministic stride, so no exact crop can appear on both sides: instances are
distinct objects with distinct boxes and therefore distinct pixels.

## Why these probes and not more training

The 1200-step run established that the production model learns training fret
appearance (41.7%) and does not transfer (6.8% vs 7.3% chance), while using pixels
strongly. That leaves open whether the *pixels* are insufficient or the *model* is.
Running the production model again cannot separate those. This can.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn

SEED = 11


class RoiProbe(nn.Module):
    """A small CNN with enough capacity to fit 20 classes, and no more.

    Three conv blocks then global average pooling and a linear head. Global pooling
    is deliberate: it removes the *position* of ink from the representation, so the
    probe cannot answer "where is the ink" and must answer "what shape is it".
    """

    def __init__(self, classes: int = 20) -> None:
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 32, 3, padding=1), nn.BatchNorm2d(32), nn.ReLU(inplace=True),
            nn.Conv2d(32, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(inplace=True),
            nn.Conv2d(64, 128, 3, padding=1), nn.BatchNorm2d(128), nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool2d(1),
        )
        self.head = nn.Linear(128, classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.head(self.features(x).flatten(1))


def set_seed(seed: int = SEED) -> None:
    torch.manual_seed(seed)
    np.random.seed(seed)


def instance_split(rows: np.ndarray, scores: np.ndarray, stride: int) -> np.ndarray:
    """Within each score, hold out every ``stride``-th instance.

    Deterministic and instance-level, so the same crop never lands on both sides.
    The offset is per-score so the held-out fraction does not correlate with the
    order instances happen to appear in.
    """
    held = np.zeros(len(rows), dtype=np.int64)
    for score in sorted(set(scores.tolist())):
        where = np.where(scores == score)[0]
        offset = sum(ord(c) for c in str(score)) % stride
        held[where[offset::stride]] = 1
    return held


def evaluate(model: nn.Module, x: torch.Tensor, y: torch.Tensor) -> dict[str, Any]:
    model.eval()
    with torch.no_grad():
        pred = model(x).argmax(-1)
    correct = pred == y
    one = y < 10
    return {
        "accuracy": round(float(correct.float().mean()), 6),
        "n": int(len(y)),
        "correct": int(correct.sum()),
        "one_digit_accuracy": round(float(correct[one].float().mean()), 6),
        "two_digit_accuracy": round(float(correct[~one].float().mean()), 6),
        "one_digit_n": int(one.sum()),
        "two_digit_n": int((~one).sum()),
        "predicted_class_histogram": {
            str(k): v for k, v in sorted(Counter(pred.tolist()).items())
        },
    }


def train_probe(x_train, y_train, steps, batch, lr, balanced):
    set_seed()
    model = RoiProbe(classes=int(y_train.max().item()) + 1)
    optimiser = torch.optim.Adam(model.parameters(), lr=lr)
    generator = torch.Generator().manual_seed(SEED)
    loss_fn = nn.CrossEntropyLoss()
    if balanced:
        counts = torch.bincount(y_train, minlength=int(y_train.max()) + 1).float()
        weights = counts.sum() / (counts * (counts > 0)).clamp_min(1)
        loss_fn = nn.CrossEntropyLoss(weight=weights)
    history = []
    model.train()
    n = len(y_train)
    for step in range(1, steps + 1):
        index = torch.randint(0, n, (batch,), generator=generator)
        optimiser.zero_grad(set_to_none=True)
        loss = loss_fn(model(x_train[index]), y_train[index])
        loss.backward()
        optimiser.step()
        if step % max(1, steps // 8) == 0 or step == steps:
            history.append({"step": step, "loss": round(float(loss.detach()), 6)})
    return model, history


def template_nn(x_train: torch.Tensor, y_train: torch.Tensor, x_test: torch.Tensor) -> torch.Tensor:
    """Nearest neighbour on mean-removed, L2-normalised crops. No parameters.

    Returns the *label* of the nearest training crop. Returning the neighbour index
    and comparing it to a label is a bug that scores below chance on training data,
    which is how it was caught.
    """
    a = x_train.flatten(1)
    b = x_test.flatten(1)
    a = a - a.mean(1, keepdim=True)
    b = b - b.mean(1, keepdim=True)
    a = a / a.norm(dim=1, keepdim=True).clamp_min(1e-8)
    b = b / b.norm(dim=1, keepdim=True).clamp_min(1e-8)
    nearest = (b @ a.T).argmax(1)
    return y_train[nearest]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--steps", type=int, default=3000)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--stride", type=int, default=5)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    blob = np.load(args.data, allow_pickle=True)
    rois = blob["rois"].astype(np.float32)
    labels = blob["labels"].astype(np.int64)
    scores = blob["scores"]
    split = blob["split"].astype(np.int64)

    x = torch.from_numpy(rois).unsqueeze(1)
    y = torch.from_numpy(labels)

    train_rows = np.where(split == 0)[0]
    score_disjoint_rows = np.where(split == 1)[0]
    held_mask = instance_split(train_rows, scores[train_rows], args.stride)
    same_score_test = train_rows[held_mask == 1]
    same_score_train = train_rows[held_mask == 0]

    splits = {
        "A_train_instance": train_rows,
        "B_same_score_unseen_instance": same_score_test,
        "C_score_disjoint": score_disjoint_rows,
    }
    # The check that matters: no crop may appear on both sides of the within-score
    # split. `same_score_test` is a subset of `train_rows` by construction, so
    # comparing those would always report an overlap and prove nothing.
    overlap = len(set(same_score_train.tolist()) & set(same_score_test.tolist()))
    print(f"crops {len(labels)} | classes {len(set(labels.tolist()))}")
    print(
        f"  A train-instance {len(train_rows)} | B same-score unseen-instance "
        f"{len(same_score_test)} | C score-disjoint {len(score_disjoint_rows)}"
    )
    print(
        f"  fit rows {len(same_score_train)} | fit/B crop overlap {overlap} (must be 0) "
        f"| A/B disjoint by construction"
    )

    results: dict[str, Any] = {
        "config": {
            "seed": SEED, "steps": args.steps, "batch": args.batch, "lr": args.lr,
            "instance_stride": args.stride, "crop": int(rois.shape[1]),
            "fit_rows": int(len(same_score_train)), "fit_test_crop_overlap": int(overlap),
        },
        "splits": {k: int(len(v)) for k, v in splits.items()},
    }

    for mode, balanced in (("natural", False), ("balanced", True)):
        model, history = train_probe(
            x[same_score_train], y[same_score_train], args.steps, args.batch, args.lr, balanced
        )
        entry: dict[str, Any] = {"loss_history": history}
        for name, rows in splits.items():
            entry[name] = evaluate(model, x[rows], y[rows])
        results[f"cnn_{mode}"] = entry
        print(f"\n--- CNN, {mode} sampling (fit on {len(same_score_train)} rows) ---")
        for name in splits:
            e = entry[name]
            print(
                f"  {name:<30} acc {e['accuracy']:.4f}  1-digit {e['one_digit_accuracy']:.4f}"
                f"  2-digit {e['two_digit_accuracy']:.4f}  (n={e['n']})"
            )

    def nn_stats(pred, rows):
        correct = pred == y[rows]
        one = y[rows] < 10
        return {
            "accuracy": round(float(correct.float().mean()), 6),
            "one_digit_accuracy": round(float(correct[one].float().mean()), 6),
            "two_digit_accuracy": round(float(correct[~one].float().mean()), 6),
            "n": int(len(rows)),
        }

    nn = {
        "A_train_instance": nn_stats(
            template_nn(x[same_score_train], y[same_score_train], x[train_rows]), train_rows
        ),
        "B_same_score_unseen_instance": nn_stats(
            template_nn(x[same_score_train], y[same_score_train], x[same_score_test]),
            same_score_test,
        ),
        "C_score_disjoint": nn_stats(
            template_nn(x[same_score_train], y[same_score_train], x[score_disjoint_rows]),
            score_disjoint_rows,
        ),
    }
    results["template_nn"] = {
        "note": "mean-removed L2-normalised nearest neighbour on raw pixels; no parameters, no tuning",
        **nn,
    }
    print("\n--- template nearest neighbour (parameter-free) ---")
    for name in splits:
        e = nn[name]
        print(
            f"  {name:<30} acc {e['accuracy']:.4f}  1-digit {e['one_digit_accuracy']:.4f}"
            f"  2-digit {e['two_digit_accuracy']:.4f}"
        )

    chance = 1.0 / len(set(labels.tolist()))
    results["chance"] = round(chance, 6)
    print(f"\nuniform chance {chance:.4f}")

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(results, indent=2) + "\n")
        print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())