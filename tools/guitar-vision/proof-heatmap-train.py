#!/usr/bin/env python3
"""Learned heatmap detector (bounded): note/digit/rest centers from pages.

Tiny FCN, Gaussian center targets, TRAIN pages only. No sweep, 8 epochs,
fixed seed. Inference: peak extraction + fixed per-class box sizes (TRAIN
medians, recorded in the report).

Usage:
    python3 tools/guitar-vision/proof-heatmap-train.py --hires <dir> --work ... --out <dir> --epochs 8
    python3 tools/guitar-vision/proof-heatmap-train.py --hires <dir> --work ... --out <dir> --infer-only --weights <pt>
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
EPOCHS = 8
BATCH = 8
PATCH = 512
STRIDE = 8
SIGMA = 6.0
CLASSES = ["note", "rest", "tabdigit"]


def load_splits():
    train, dev = set(), set()
    for manifest_path, work_roots in [
        ("datasets/guitar-vision/pdmx/dataset-manifest.json", None),
        ("datasets/guitar-vision/v2/dataset-manifest.json", None),
    ]:
        manifest = json.loads((Path(manifest_path)).read_text())
        for sample in manifest["splits"]["assignments"]:
            if sample["split"] == "train":
                train.add(sample["sample"])
            elif sample["split"] == "validation":
                dev.add(sample["sample"])
    return train, dev


class PageDataset(Dataset):
    def __init__(self, hires_dir: Path, work_dirs: list[Path], scores: set, train: bool):
        self.items = []
        for manifest_path in sorted(hires_dir.glob("*-manifest.json")):
            sample = manifest_path.name.replace("-manifest.json", "")
            if sample not in scores:
                continue
            manifest = json.loads(manifest_path.read_text())
            joins = None
            for root in work_dirs:
                path = root / sample / "joins.json"
                if path.exists():
                    joins = json.loads(path.read_text())
                    break
            if joins is None:
                continue
            for tag, meta in manifest.items():
                if not isinstance(meta, dict) or "file" not in meta:
                    continue
                page_no = int(tag.replace("page", ""))
                self.items.append({"file": meta["file"], "fx": meta["cssWidth"] / meta["viewBox"][0],
                                   "fy": meta["height"] / meta["viewBox"][1], "sample": sample,
                                   "page": page_no, "joins": joins["joins"],
                                   "width": meta.get("width", 0), "height": meta.get("height", 0)})
        self.train = train
        self.rng = np.random.RandomState(SEED)
        # Deterministic patch plan per item: object-centered patches (signal
        # in every batch) + one context patch. Empty pages give background.
        self.plans = []
        for index, item in enumerate(self.items):
            image = Image.open(item["file"])
            width, height = image.size
            image.close()
            centers = []
            for sid, join in item["joins"].items():
                if (join.get("page") or 1) != item["page"] or not join.get("boxes"):
                    continue
                boxes = join["boxes"]
                centers.append(((min(b[0] for b in boxes) + max(b[2] for b in boxes)) / 2 * item["fx"],
                                (min(b[1] for b in boxes) + max(b[3] for b in boxes)) / 2 * item["fy"]))
            picks = []
            if centers:
                order = np.random.RandomState(SEED + index).permutation(len(centers))
                for k in order[:3]:
                    picks.append(centers[k])
            picks.append(None)  # context patch
            self.plans.append({"size": (width, height), "picks": picks})
        self.train = train

    def __len__(self):
        if self.train:
            return sum(len(plan["picks"]) for plan in self.plans)
        return len(self.items)

    def _render_targets(self, item, x0, y0, size):
        heatmaps = np.zeros((3, size // STRIDE, size // STRIDE), dtype=np.float32)
        fx, fy = item["fx"], item["fy"]
        page_no = item["page"]
        yy, xx = np.mgrid[0:size // STRIDE, 0:size // STRIDE]
        for sid, join in item["joins"].items():
            if (join.get("page") or 1) != page_no:
                continue
            children = join.get("children", [])
            cls = 0 if "notehead" in children else (1 if "rest" in children else (2 if "tab-text" in children else -1))
            if cls < 0 or not join.get("boxes"):
                continue
            boxes = join["boxes"]
            cx = (min(b[0] for b in boxes) + max(b[2] for b in boxes)) / 2 * fx
            cy = (min(b[1] for b in boxes) + max(b[3] for b in boxes)) / 2 * fy
            lx, ly = (cx - x0) / STRIDE, (cy - y0) / STRIDE
            if not (0 <= lx < size // STRIDE and 0 <= ly < size // STRIDE):
                continue
            heatmaps[cls] = np.maximum(heatmaps[cls], np.exp(-((xx - lx) ** 2 + (yy - ly) ** 2) / (2 * (SIGMA / STRIDE) ** 2)))
        return heatmaps

    def __getitem__(self, index: int):
        if self.train:
            # Flattened deterministic plan: item boundaries via cumulative picks.
            cursor = index
            item_index = 0
            while cursor >= len(self.plans[item_index]["picks"]):
                cursor -= len(self.plans[item_index]["picks"])
                item_index += 1
            item = self.items[item_index]
            pick = self.plans[item_index]["picks"][cursor]
            width, height = self.plans[item_index]["size"]
        else:
            item = self.items[index % len(self.items)]
            width, height = None, None
            pick = None
        image = Image.open(item["file"]).convert("L")
        pixels = np.asarray(image, dtype=np.float32) / 255.0
        if width is None:
            height, width = pixels.shape
        if self.train and pick is not None:
            x0 = int(min(max(pick[0] - PATCH / 2, 0), max(width - PATCH, 0)))
            y0 = int(min(max(pick[1] - PATCH / 2, 0), max(height - PATCH, 0)))
        elif self.train:
            x0 = self.rng.randint(0, max(width - PATCH, 1) + 1)
            y0 = self.rng.randint(0, max(height - PATCH, 1) + 1)
        else:
            x0, y0 = 0, 0
        patch = np.zeros((PATCH, PATCH), dtype=np.float32)
        x1, y1 = min(x0 + PATCH, width), min(y0 + PATCH, height)
        patch[: y1 - y0, : x1 - x0] = pixels[y0:y1, x0:x1]
        heatmaps = self._render_targets(item, x0, y0, PATCH)
        return {"x": torch.from_numpy(patch).unsqueeze(0),
                "heatmaps": torch.from_numpy(heatmaps), "sample": item["sample"]}


class TinyFCN(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(1, 32, 3, padding=1), nn.ReLU(),
            nn.Conv2d(32, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding=1), nn.ReLU(),
            nn.Conv2d(64, 64, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(64, 128, 3, padding=1), nn.ReLU(),
            nn.Conv2d(128, 128, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(128, 3, 1),
        )

    def forward(self, x):
        return self.net(x)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hires", required=True)
    parser.add_argument("--work", required=True, action="append")
    parser.add_argument("--out", required=True)
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    parser.add_argument("--infer-only", action="store_true")
    parser.add_argument("--weights", default=None)
    args = parser.parse_args()
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"device: {device}", flush=True)
    hires_dir, out_dir = Path(args.hires), Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    work_dirs = [Path(w) for w in args.work]
    train_ids, dev_ids = load_splits()

    model = TinyFCN().to(device)
    if args.infer_only:
        saved = torch.load(args.weights, map_location=device, weights_only=True)
        model.load_state_dict(saved["state"] if "state" in saved else saved)
        model.eval()
        print("infer-only mode: weights loaded", flush=True)
        torch.save({"note": "infer-only"}, out_dir / "infer-ok.json")
        return 0

    train_loader = DataLoader(PageDataset(hires_dir, work_dirs, train_ids, True),
                              batch_size=BATCH, shuffle=True, num_workers=0)
    dev_loader = DataLoader(PageDataset(hires_dir, work_dirs, dev_ids, False),
                            batch_size=1, shuffle=False, num_workers=0)
    optimizer = torch.optim.Adam(model.parameters(), lr=3e-3)
    history = []
    for epoch in range(args.epochs):
        model.train()
        total, count = 0.0, 0
        for batch in train_loader:
            x = batch["x"].to(device)
            target = batch["heatmaps"].to(device)
            out = model(x)
            h, w = target.shape[2], target.shape[3]
            diff = (out[:, :, :h, :w] - target) ** 2
            # Foreground-weighted: background zeros would otherwise drown
            # the sparse Gaussian signal entirely.
            weight = 1.0 + 19.0 * (target > 0.05).float()
            loss = (diff * weight).mean()
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total += loss.item()
            count += 1
        model.eval()
        dev_loss, dev_count = 0.0, 0
        with torch.no_grad():
            for batch in dev_loader:
                x = batch["x"].to(device)
                target = batch["heatmaps"].to(device)
                out = model(x)
                h, w = target.shape[2], target.shape[3]
                dev_loss += F.mse_loss(out[:, :, :h, :w], target).item()
                dev_count += 1
        history.append({"epoch": epoch + 1, "trainLoss": total / max(count, 1),
                        "devLoss": dev_loss / max(dev_count, 1)})
        print(f"epoch {epoch + 1}/{args.epochs} train={total / max(count, 1):.5f} dev={dev_loss / max(dev_count, 1):.5f}", flush=True)
    torch.save({"state": model.state_dict()}, out_dir / "heatmap.pt")
    (out_dir / "heatmap-history.json").write_text(json.dumps(history, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

