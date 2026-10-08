#!/usr/bin/env python3
"""Guitar supervised proof (G3/G4): small two-branch multi-head CNN.

Branch N (notation objects, shared trunk): family, pitch, duration, dots,
voice, technique-presence. Branch T (TAB digits, DEDICATED trunk — the fret
lesson: shared representations destroyed fret information): string + fret.

Capped deterministic proof: fixed seed, CPU, no sweep, frozen TRAIN only.
Missing labels mask their head (never negatives). Masked-measure rows keep
object/pitch/string/fret loss but drop rhythm/voice loss.

Usage:
    python3 tools/guitar-vision/proof-train.py --crops <dir> --out <dir> [--epochs N] [--control NAME]
Controls: none | blank | shuffled | wrongcrop | geometry
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

SEED = 20261007
EPOCHS = 12
BATCH = 128

DURATIONS = ["whole", "half", "quarter", "eighth", "16th", "32nd", "64th"]
FAMILIES = ["note", "rest", "tabdigit"]


def set_deterministic():
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    torch.set_num_threads(10)


class CropDataset(Dataset):
    TAB_OVERSAMPLE = 8

    def __init__(self, crops_dir: Path, split: str, control: str, cache: dict | None = None):
        rows = [json.loads(line) for line in (crops_dir / "labels.jsonl").read_text().splitlines()]
        self.rows = [r for r in rows if r["split"] == split]
        if split == "train":
            # Class-imbalance handling (deterministic): TAB digits are 4% of
            # rows; without oversampling the string/fret heads sit on the
            # majority class forever. Duplication factor fixed, no tuning.
            tab = [r for r in self.rows if r["family"] == "tabdigit"]
            self.rows = self.rows + tab * (self.TAB_OVERSAMPLE - 1)
        self.crops_dir = crops_dir
        self.control = control
        self.cache = cache or {}
        if control == "shuffled":
            # Permute labels jointly (keeps marginals, destroys mapping).
            perm = np.random.RandomState(SEED).permutation(len(self.rows))
            shuffled = [self.rows[i] for i in perm]
            for target, source in zip(self.rows, shuffled):
                target["_shuffled"] = source

    def __len__(self):
        return len(self.rows)

    def label(self, row: dict, key: str):
        if self.control == "shuffled":
            row = row["_shuffled"]
        return row[key]

    def __getitem__(self, index: int):
        row = self.rows[index]
        cached = self.cache.get(row["file"])
        if cached is None:
            image = Image.open(self.crops_dir / "crops" / row["file"]).convert("L")
            pixels = np.asarray(image, dtype=np.float32) / 255.0
            cached = torch.from_numpy(pixels).unsqueeze(0)
            self.cache[row["file"]] = cached
        tensor = cached.clone()
        if self.control == "blank":
            tensor = torch.zeros_like(tensor)
        family = FAMILIES.index(self.label(row, "family"))
        midi = row["midi"] if row["midi"] is not None else -1
        duration = DURATIONS.index(row["duration"]) if row["duration"] in DURATIONS else -1
        dots = int(row.get("dots") or 0)
        voice = int(row.get("voice") or 1) - 1
        string = (row.get("string") or 1) - 1 if row.get("string") else -1
        fret = row.get("fret") if row.get("fret") is not None else -1
        masked = bool(row.get("maskedMeasure"))
        has_tech = 1.0 if (row.get("techniques") or []) else 0.0
        return {
            "x": tensor, "family": family, "midi": midi, "duration": duration,
            "dots": dots, "voice": voice, "string": string, "fret": fret,
            "masked": masked, "has_tech": has_tech,
            "is_tab": 1 if row["family"] == "tabdigit" else 0,
            "is_rest": 1 if row["family"] == "rest" else 0,
        }


def collate(batch):
    out = {}
    for key in batch[0]:
        values = [item[key] for item in batch]
        tensor = torch.stack(values) if isinstance(values[0], torch.Tensor) else torch.tensor(values)
        if torch.is_floating_point(tensor):
            tensor = tensor.float()
        out[key] = tensor
    return out


class Trunk(nn.Module):
    def __init__(self, channels=(32, 64, 128)):
        super().__init__()
        layers = []
        in_ch = 1
        for out_ch in channels:
            layers += [nn.Conv2d(in_ch, out_ch, 3, padding=1), nn.ReLU(), nn.Conv2d(out_ch, out_ch, 3, padding=1),
                       nn.ReLU(), nn.MaxPool2d(2)]
            in_ch = out_ch
        self.conv = nn.Sequential(*layers)
        self.pool = nn.AdaptiveAvgPool2d(1)

    def forward(self, x):
        return self.pool(self.conv(x)).flatten(1)


class ProofNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.trunk_n = Trunk((32, 64, 128))
        self.trunk_t = Trunk((16, 32, 64))
        self.head_family = nn.Linear(128, 3)
        self.head_midi = nn.Linear(128, 128)
        self.head_duration = nn.Linear(128, len(DURATIONS))
        self.head_dots = nn.Linear(128, 3)
        self.head_voice = nn.Linear(128, 6)
        self.head_tech = nn.Linear(128, 1)
        self.head_string = nn.Linear(64, 6)
        self.head_fret = nn.Linear(64, 25)

    def forward(self, x):
        features_n = self.trunk_n(x)
        features_t = self.trunk_t(x)
        return {
            "family": self.head_family(features_n),
            "midi": self.head_midi(features_n),
            "duration": self.head_duration(features_n),
            "dots": self.head_dots(features_n),
            "voice": self.head_voice(features_n),
            "tech": self.head_tech(features_n).squeeze(1),
            "string": self.head_string(features_t),
            "fret": self.head_fret(features_t),
        }


def masked_ce(logits, target, mask):
    mask = mask.float()
    if mask.sum() <= 0:
        return logits.sum() * 0.0
    loss = nn.functional.cross_entropy(logits, target.clamp_min(0), reduction="none")
    return (loss * mask).sum() / mask.sum().clamp_min(1.0)


def move_batch(batch, device):
    moved = {}
    for k, v in batch.items():
        if isinstance(v, torch.Tensor):
            if torch.is_floating_point(v):
                v = v.float()
            try:
                moved[k] = v.to(device)
            except Exception as error:
                raise RuntimeError(f"transfer failed for {k} dtype={v.dtype}") from error
        else:
            moved[k] = v
    return moved


def train_epoch(model, loader, optimizer, device):
    model.train()
    total, count = 0.0, 0
    for batch in loader:
        batch = move_batch(batch, device)
        out = model(batch["x"])
        not_rest = (batch["family"] != 1).float()
        not_masked = (1 - batch["masked"].float())
        is_tab = batch["is_tab"].float()
        loss = (
            nn.functional.cross_entropy(out["family"], batch["family"])
            + masked_ce(out["midi"], batch["midi"], not_rest)
            + masked_ce(out["duration"], batch["duration"], not_rest * not_masked * (batch["duration"] >= 0).float())
            + masked_ce(out["dots"], batch["dots"], not_rest * not_masked)
            + masked_ce(out["voice"], batch["voice"], not_masked)
            + nn.functional.binary_cross_entropy_with_logits(out["tech"], batch["has_tech"].float())
            + masked_ce(out["string"], batch["string"], is_tab)
            + masked_ce(out["fret"], batch["fret"], is_tab)
        )
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        total += loss.item()
        count += 1
    return total / max(count, 1)


@torch.no_grad()
def evaluate(model, loader, device):
    model.eval()
    stats = {}
    totals = {}

    def acc(key, pred, target, mask):
        pred, target, mask = pred.cpu(), target.cpu(), mask.cpu().bool()
        if mask.sum() <= 0:
            return
        correct = (pred[mask] == target[mask]).float().sum().item()
        stats[key] = stats.get(key, 0.0) + correct
        totals[key] = totals.get(key, 0) + int(mask.sum().item())

    for batch in loader:
        batch = move_batch(batch, device)
        out = model(batch["x"])
        not_rest = batch["family"] != 1
        valid_duration = (batch["duration"] >= 0) & (not_rest == 1) & (batch["masked"] == 0)
        acc("family", out["family"].argmax(1).cpu(), batch["family"].cpu(), torch.ones_like(batch["family"], dtype=torch.bool))
        acc("midi", out["midi"].argmax(1).cpu(), batch["midi"].cpu(), not_rest.cpu())
        acc("duration", out["duration"].argmax(1).cpu(), batch["duration"].cpu(), valid_duration.cpu())
        acc("dots", out["dots"].argmax(1).cpu(), batch["dots"].cpu(), (not_rest & (batch["masked"] == 0)).cpu())
        acc("voice", out["voice"].argmax(1).cpu(), batch["voice"].cpu(), (batch["masked"] == 0).cpu())
        acc("tech", (out["tech"] > 0).long().cpu(), batch["has_tech"].long().cpu(), torch.ones_like(batch["family"], dtype=torch.bool))
        is_tab = (batch["is_tab"] == 1).cpu()
        acc("string", out["string"].argmax(1).cpu(), batch["string"].cpu(), is_tab)
        acc("fret", out["fret"].argmax(1).cpu(), batch["fret"].cpu(), is_tab)
    return {key: stats[key] / totals[key] for key in stats}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--crops", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    parser.add_argument("--control", default="none", choices=["none", "blank", "shuffled"])
    args = parser.parse_args()
    set_deterministic()
    # MPS when available (CPU fallback); seeds fixed, single process.
    if torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    print(f"device: {device}", flush=True)
    crops_dir = Path(args.crops)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    train_loader = DataLoader(CropDataset(crops_dir, "train", args.control), batch_size=BATCH, shuffle=(args.control != "shuffled"), num_workers=0)
    dev_loader = DataLoader(CropDataset(crops_dir, "validation", "none"), batch_size=BATCH, shuffle=False, num_workers=0)
    model = ProofNet().to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=3e-3)
    history = []
    for epoch in range(args.epochs):
        loss = train_epoch(model, train_loader, optimizer, device)
        dev = evaluate(model, dev_loader, device)
        history.append({"epoch": epoch + 1, "trainLoss": loss, "dev": dev})
        print(f"epoch {epoch + 1}/{args.epochs} loss={loss:.4f} " + " ".join(f"{k}={v:.3f}" for k, v in sorted(dev.items())), flush=True)
    torch.save({"state": model.state_dict(), "control": args.control}, out_dir / "proof-model.pt")
    (out_dir / "history.json").write_text(json.dumps(history, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
