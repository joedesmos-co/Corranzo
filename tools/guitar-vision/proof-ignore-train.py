#!/usr/bin/env python3
"""Ignore-class detector (ONE capped run per GUITAR_IGNORECLASS_PREREG.md).

TinyFCN + 1 ignore channel (4 outputs), warm-started from frozen
heatmap16ep.pt (backbone + 3 output rows copied; ignore row fresh).
Positives: existing GT Gaussians. Negatives: self-mined TRAIN bg-FPs
(ignore-labels.json) + background. TRAIN standard+compact pages only
(score-grouped). <=12 epochs, fixed seed. DEV untouched.

Usage:
    python3 tools/guitar-vision/proof-ignore-train.py --labels <dir> --work ... --out <dir> --epochs 12
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image
from torch.utils.data import DataLoader, Dataset

SEED = 20261009
EPOCHS = 12
BATCH = 8
PATCH = 512
STRIDE = 8
SIGMA = 6.0
CLASSES = ["note", "rest", "tabdigit"]  # channel 3 = ignore
LAYOUTS = {"standard": ("/tmp/proof/hires", "joins.json", ""),
           "compact": ("/tmp/proof/hires-compact", "joins-compact.json", "-compact"),
           "large": ("/tmp/proof/hires-large", "joins-large.json", "-large")}


def load_train_ids():
    train = set()
    for manifest_path in ["datasets/guitar-vision/pdmx/dataset-manifest.json",
                          "datasets/guitar-vision/v2/dataset-manifest.json"]:
        manifest = json.loads(Path(manifest_path).read_text())
        for sample in manifest["splits"]["assignments"]:
            if sample["split"] == "train":
                train.add(sample["sample"])
    return train


class IgnoreDataset(Dataset):
    def __init__(self, work_dirs, scores, labels):
        self.items = []
        for layout, (hires, joins_name, suffix) in LAYOUTS.items():
            for manifest_path in sorted(Path(hires).glob("*-manifest.json")):
                sample = manifest_path.name.replace("-manifest.json", "")
                if suffix and sample.endswith(suffix):
                    sample = sample[: -len(suffix)]
                if sample not in scores:
                    continue
                manifest = json.loads(manifest_path.read_text())
                joins = None
                for root in work_dirs:
                    for cand in (root / sample / joins_name,
                                 root / joins_name if root.name == sample else None):
                        if cand is not None and cand.exists():
                            joins = json.loads(cand.read_text())
                            break
                    if joins is not None:
                        break
                if joins is None:
                    continue
                for tag, meta in manifest.items():
                    if not isinstance(meta, dict) or "file" not in meta:
                        continue
                    page_no = int(tag.replace("page", ""))
                    negs = labels.get(sample, {}).get(layout, {}).get(tag, [])
                    self.items.append({"file": meta["file"],
                                       "fx": meta["cssWidth"] / meta["viewBox"][0],
                                       "fy": meta["height"] / meta["viewBox"][1],
                                       "page": page_no, "joins": joins["joins"],
                                       "negs": [(n["x"], n["y"]) for n in negs]})
        # Deterministic patch plan: 3 object-centered + 2 ignore-centered
        # (when present) + 1 context patch per page.
        self.plans = []
        for index, item in enumerate(self.items):
            image = Image.open(item["file"])
            width, height = image.size
            image.close()
            centers = []
            for sid, join in item["joins"].items():
                if (join.get("page") or 1) != item["page"] or not join.get("boxes"):
                    continue
                ch = join.get("children", [])
                if not ("notehead" in ch or "rest" in ch or "tab-text" in ch):
                    continue
                boxes = join["boxes"]
                centers.append(((min(b[0] for b in boxes) + max(b[2] for b in boxes)) / 2 * item["fx"],
                                (min(b[1] for b in boxes) + max(b[3] for b in boxes)) / 2 * item["fy"]))
            picks = []
            if centers:
                order = np.random.RandomState(SEED + index).permutation(len(centers))
                for k in order[:3]:
                    picks.append(("obj", centers[k]))
            if item["negs"]:
                order = np.random.RandomState(SEED + 100000 + index).permutation(len(item["negs"]))
                for k in order[:2]:
                    picks.append(("ign", item["negs"][k]))
            picks.append(("ctx", None))
            self.plans.append({"size": (width, height), "picks": picks})

    def __len__(self):
        return sum(len(plan["picks"]) for plan in self.plans)

    def _render(self, item, x0, y0, size):
        heatmaps = np.zeros((4, size // STRIDE, size // STRIDE), dtype=np.float32)
        fx, fy = item["fx"], item["fy"]
        yy, xx = np.mgrid[0:size // STRIDE, 0:size // STRIDE]
        for sid, join in item["joins"].items():
            if (join.get("page") or 1) != item["page"]:
                continue
            ch = join.get("children", [])
            cls = 0 if "notehead" in ch else (1 if "rest" in ch else (2 if "tab-text" in ch else -1))
            if cls < 0 or not join.get("boxes"):
                continue
            boxes = join["boxes"]
            cx = (min(b[0] for b in boxes) + max(b[2] for b in boxes)) / 2 * fx
            cy = (min(b[1] for b in boxes) + max(b[3] for b in boxes)) / 2 * fy
            lx, ly = (cx - x0) / STRIDE, (cy - y0) / STRIDE
            if not (0 <= lx < size // STRIDE and 0 <= ly < size // STRIDE):
                continue
            heatmaps[cls] = np.maximum(heatmaps[cls], np.exp(-((xx - lx) ** 2 + (yy - ly) ** 2) / (2 * (SIGMA / STRIDE) ** 2)))
        for nx, ny in item["negs"]:
            lx, ly = (nx - x0) / STRIDE, (ny - y0) / STRIDE
            if not (0 <= lx < size // STRIDE and 0 <= ly < size // STRIDE):
                continue
            heatmaps[3] = np.maximum(heatmaps[3], np.exp(-((xx - lx) ** 2 + (yy - ly) ** 2) / (2 * (SIGMA / STRIDE) ** 2)))
        return heatmaps

    def __getitem__(self, index: int):
        cursor = index
        item_index = 0
        while cursor >= len(self.plans[item_index]["picks"]):
            cursor -= len(self.plans[item_index]["picks"])
            item_index += 1
        item = self.items[item_index]
        kind, pick = self.plans[item_index]["picks"][cursor]
        width, height = self.plans[item_index]["size"]
        image = Image.open(item["file"]).convert("L")
        pixels = np.asarray(image, dtype=np.float32) / 255.0
        if pick is not None:
            x0 = int(min(max(pick[0] - PATCH / 2, 0), max(width - PATCH, 0)))
            y0 = int(min(max(pick[1] - PATCH / 2, 0), max(height - PATCH, 0)))
        else:
            rng = np.random.RandomState(SEED + 999 + index)
            x0 = rng.randint(0, max(width - PATCH, 1) + 1)
            y0 = rng.randint(0, max(height - PATCH, 1) + 1)
        patch = np.zeros((PATCH, PATCH), dtype=np.float32)
        x1, y1 = min(x0 + PATCH, width), min(y0 + PATCH, height)
        patch[: y1 - y0, : x1 - x0] = pixels[y0:y1, x0:x1]
        return {"x": torch.from_numpy(patch).unsqueeze(0),
                "heatmaps": torch.from_numpy(self._render(item, x0, y0, PATCH))}


class TinyFCN4(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(1, 32, 3, padding=1), nn.ReLU(),
            nn.Conv2d(32, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding=1), nn.ReLU(),
            nn.Conv2d(64, 64, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(64, 128, 3, padding=1), nn.ReLU(),
            nn.Conv2d(128, 128, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(128, 4, 1),
        )

    def forward(self, x):
        return self.net(x)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--labels", required=True)
    parser.add_argument("--work", required=True, action="append")
    parser.add_argument("--out", required=True)
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    parser.add_argument("--warm", required=True, help="frozen v1 weights for warm start")
    args = parser.parse_args()
    assert args.epochs <= 12, "cap: <=12 epochs"
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"device: {device}", flush=True)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    work_dirs = [Path(w) for w in args.work]
    train_ids = load_train_ids()
    labels = json.loads((Path(args.labels) / "ignore-labels.json").read_text())

    model = TinyFCN4().to(device)
    saved = torch.load(args.warm, map_location=device, weights_only=True)
    v1 = saved["state"] if "state" in saved else saved
    own = model.state_dict()
    warm_out = int(v1["net.15.weight"].shape[0])  # 3 (v1/v2) or 4 (v3)
    for key, value in v1.items():
        if key in ("net.15.weight", "net.15.bias") and warm_out == 3:
            own[key][:3].copy_(value)
        else:
            own[key].copy_(value)
    if warm_out == 3:
        # Fresh ignore row: small random weights, negative bias (ignore
        # off unless evidence).
        nn.init.normal_(own["net.15.weight"][3], std=0.01)
        own["net.15.bias"][3].fill_(-1.0)
    model.load_state_dict(own)
    print(f"warm start: {args.warm} ({warm_out}ch output)", flush=True)

    loader = DataLoader(IgnoreDataset(work_dirs, train_ids, labels),
                        batch_size=BATCH, shuffle=True, num_workers=0)
    print(f"batches/epoch: {len(loader)}", flush=True)
    optimizer = torch.optim.Adam(model.parameters(), lr=3e-3)
    history = []
    for epoch in range(args.epochs):
        model.train()
        total, count = 0.0, 0
        for batch in loader:
            x = batch["x"].to(device)
            target = batch["heatmaps"].to(device)
            out = model(x)
            h, w = target.shape[2], target.shape[3]
            diff = (out[:, :, :h, :w] - target) ** 2
            weight = 1.0 + 19.0 * (target > 0.05).float()
            loss = (diff * weight).mean()
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total += loss.item()
            count += 1
        history.append({"epoch": epoch + 1, "trainLoss": total / max(count, 1)})
        print(f"epoch {epoch + 1}/{args.epochs} train={total / max(count, 1):.5f}", flush=True)
    torch.save({"state": model.state_dict()}, out_dir / "heatmap-ignore.pt")
    (out_dir / "ignore-history.json").write_text(json.dumps(history, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
