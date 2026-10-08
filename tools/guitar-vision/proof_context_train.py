#!/usr/bin/env python3
"""Guitar context proof (G2/G4/G5): StringNet (tall TAB context -> string) and
RhythmNet (wide beat context -> duration + voice). Capped deterministic runs,
frozen TRAIN only, oversampling at most x4 (preregistered).

Usage:
    python3 tools/guitar-vision/proof-context-train.py --context <dir> --out <dir> --epochs N [--control NAME]
Controls: none | shuffled-string | shuffled-rhythm
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from torch.utils.data import DataLoader, Dataset

SEED = 20261008
EPOCHS = 8
BATCH = 128
DURATIONS = ["whole", "half", "quarter", "eighth", "16th", "32nd", "64th"]


class TallDataset(Dataset):
    OVERSAMPLE = 4

    def __init__(self, context_dir: Path, split: str, control: str, cache: dict | None = None):
        rows = [json.loads(line) for line in (context_dir / "tall-labels.jsonl").read_text().splitlines()]
        self.rows = [r for r in rows if r["split"] == split]
        if split == "train":
            self.rows = self.rows + self.rows * (self.OVERSAMPLE - 1)
        self.context_dir = context_dir
        self.control = control
        self.cache = cache or {}
        if control == "shuffled-string":
            perm = np.random.RandomState(SEED).permutation(len(self.rows))
            shuffled = [self.rows[i] for i in perm]
            for target, source in zip(self.rows, shuffled):
                target["_shuffled"] = source

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, index: int):
        row = self.rows[index]
        cached = self.cache.get(row["file"])
        if cached is None:
            image = Image.open(self.context_dir / "tall" / row["file"]).convert("L")
            cached = torch.from_numpy(np.asarray(image, dtype=np.float32) / 255.0).unsqueeze(0)
            self.cache[row["file"]] = cached
        tensor = cached.clone()
        source = row.get("_shuffled", row) if self.control == "shuffled-string" else row
        string = (source.get("string") or 1) - 1 if source.get("string") else 0
        return {"x": tensor, "string": string}


class WideDataset(Dataset):
    OVERSAMPLE = 1

    def __init__(self, context_dir: Path, split: str, control: str, cache: dict | None = None):
        rows = [json.loads(line) for line in (context_dir / "wide-labels.jsonl").read_text().splitlines()]
        self.rows = [r for r in rows if r["split"] == split]
        self.context_dir = context_dir
        self.control = control
        self.cache = cache or {}
        if control == "shuffled-rhythm":
            perm = np.random.RandomState(SEED).permutation(len(self.rows))
            shuffled = [self.rows[i] for i in perm]
            for target, source in zip(self.rows, shuffled):
                target["_shuffled"] = source

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, index: int):
        row = self.rows[index]
        cached = self.cache.get(row["file"])
        if cached is None:
            image = Image.open(self.context_dir / "wide" / row["file"]).convert("L")
            cached = torch.from_numpy(np.asarray(image, dtype=np.float32) / 255.0).unsqueeze(0)
            self.cache[row["file"]] = cached
        tensor = cached.clone()
        source = row.get("_shuffled", row) if self.control == "shuffled-rhythm" else row
        duration = DURATIONS.index(source["duration"]) if source["duration"] in DURATIONS else -1
        voice = int(source.get("voice") or 1) - 1
        masked = bool(row.get("maskedMeasure"))
        return {"x": tensor, "duration": duration, "voice": voice, "masked": masked,
                "is_rest": 1 if row["family"] == "rest" else 0}


def collate(batch):
    out = {}
    for key in batch[0]:
        values = [item[key] for item in batch]
        tensor = torch.stack(values) if isinstance(values[0], torch.Tensor) else torch.tensor(values)
        if torch.is_floating_point(tensor):
            tensor = tensor.float()
        out[key] = tensor
    return out


class StringNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(1, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d((2, 4)),
            nn.Conv2d(32, 64, 3, padding=1), nn.ReLU(), nn.MaxPool2d((2, 4)),
            nn.Conv2d(64, 128, 3, padding=1), nn.ReLU(), nn.MaxPool2d((1, 2)),
            nn.Conv2d(128, 128, 3, padding=1), nn.ReLU(),
            # Keep vertical bins: string identity IS vertical position.
            # Global pooling would erase the signal this head must read.
            nn.AdaptiveAvgPool2d((8, 1)),
        )
        self.head = nn.Linear(128 * 8, 6)

    def forward(self, x):
        return {"string": self.head(self.conv(x).flatten(1))}


class RhythmNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(1, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d((2, 2)),
            nn.Conv2d(32, 64, 3, padding=1), nn.ReLU(), nn.MaxPool2d((2, 2)),
            nn.Conv2d(64, 128, 3, padding=1), nn.ReLU(),
            # Keep horizontal bins (neighbor/beaming context) and some
            # vertical structure (staff position for voice).
            nn.AdaptiveAvgPool2d((4, 8)),
        )
        self.head_duration = nn.Linear(128 * 32, len(DURATIONS))
        self.head_voice = nn.Linear(128 * 32, 6)

    def forward(self, x):
        features = self.conv(x).flatten(1)
        return {"duration": self.head_duration(features), "voice": self.head_voice(features)}


def move_batch(batch, device):
    moved = {}
    for k, v in batch.items():
        if isinstance(v, torch.Tensor):
            if torch.is_floating_point(v):
                v = v.float()
            moved[k] = v.to(device)
        else:
            moved[k] = v
    return moved


def masked_ce(logits, target, mask):
    mask = mask.float()
    if mask.sum() <= 0:
        return logits.sum() * 0.0
    loss = nn.functional.cross_entropy(logits, target.clamp_min(0), reduction="none")
    return (loss * mask).sum() / mask.sum().clamp_min(1.0)


def run(model, loader, optimizer, device, train: bool):
    model.train(train)
    total, count = 0.0, 0
    correct: dict[str, float] = {}
    totals: dict[str, int] = {}
    for batch in loader:
        batch = move_batch(batch, device)
        is_string = "string" in batch
        if train:
            optimizer.zero_grad()
        with torch.set_grad_enabled(train):
            out = model(batch["x"])
            if is_string:
                loss = nn.functional.cross_entropy(out["string"], batch["string"])
                pred = out["string"].argmax(1).cpu()
                correct["string"] = correct.get("string", 0.0) + (pred == batch["string"].cpu()).float().sum().item()
                totals["string"] = totals.get("string", 0) + len(pred)
            else:
                not_rest = (batch["is_rest"] == 0).float()
                not_masked = (1 - batch["masked"].float())
                valid_duration = (batch["duration"] >= 0).float() * not_rest * not_masked
                loss = (masked_ce(out["duration"], batch["duration"], valid_duration)
                        + masked_ce(out["voice"], batch["voice"], not_masked))
                for key, head in (("duration", "duration"), ("voice", "voice")):
                    mask = valid_duration if key == "duration" else not_masked
                    chosen = (mask > 0).cpu()
                    if chosen.sum() > 0:
                        pred = out[head].argmax(1).cpu()[chosen]
                        target = batch[key].cpu()[chosen]
                        correct[key] = correct.get(key, 0.0) + (pred == target).float().sum().item()
                        totals[key] = totals.get(key, 0) + int(chosen.sum().item())
            if train:
                loss.backward()
                optimizer.step()
        total += loss.item()
        count += 1
    metrics = {key: correct[key] / totals[key] for key in correct}
    return total / max(count, 1), metrics


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--context", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    parser.add_argument("--head", default="both", choices=["both", "string", "rhythm"])
    parser.add_argument("--control", default="none", choices=["none", "shuffled-string", "shuffled-rhythm"])
    args = parser.parse_args()
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"device: {device}", flush=True)
    context_dir, out_dir = Path(args.context), Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    history = []

    if args.head in ("both", "string"):
        train_loader = DataLoader(TallDataset(context_dir, "train", args.control if "string" in args.control else "none"),
                                  batch_size=128, shuffle=True, num_workers=0, collate_fn=collate)
        dev_loader = DataLoader(TallDataset(context_dir, "validation", "none"),
                                batch_size=256, shuffle=False, num_workers=0, collate_fn=collate)
        model = StringNet().to(device)
        optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
        for epoch in range(args.epochs):
            loss, _ = run(model, train_loader, optimizer, device, True)
            _, dev = run(model, dev_loader, None, device, False)
            history.append({"head": "string", "epoch": epoch + 1, "trainLoss": loss, "dev": dev})
            print(f"[string] epoch {epoch + 1}/{args.epochs} loss={loss:.4f} " + " ".join(f"{k}={v:.3f}" for k, v in sorted(dev.items())), flush=True)
        torch.save({"state": model.state_dict()}, out_dir / "stringnet.pt")

    if args.head in ("both", "rhythm"):
        train_loader = DataLoader(WideDataset(context_dir, "train", args.control if "rhythm" in args.control else "none"),
                                  batch_size=128, shuffle=True, num_workers=0, collate_fn=collate)
        dev_loader = DataLoader(WideDataset(context_dir, "validation", "none"),
                                batch_size=256, shuffle=False, num_workers=0, collate_fn=collate)
        model = RhythmNet().to(device)
        optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
        for epoch in range(args.epochs):
            loss, _ = run(model, train_loader, optimizer, device, True)
            _, dev = run(model, dev_loader, None, device, False)
            history.append({"head": "rhythm", "epoch": epoch + 1, "trainLoss": loss, "dev": dev})
            print(f"[rhythm] epoch {epoch + 1}/{args.epochs} loss={loss:.4f} " + " ".join(f"{k}={v:.3f}" for k, v in sorted(dev.items())), flush=True)
        torch.save({"state": model.state_dict()}, out_dir / "rhythmnet.pt")

    (out_dir / "context-history.json").write_text(json.dumps(history, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
