#!/usr/bin/env python3
"""StringNet refresh (ONE capped run per GUITAR_STRING_REFRESH_PREREG.md).

Fine-tunes StringNet from stringnet.pt on TRAIN-fit GT tall crops
(chain geometry, live-rendered) with vertical window jitter (+-30px)
and class-balanced resampling. Fixed 8 epochs, Adam 1e-4, fixed seed.
Fallback stringnet.pt untouched. Output stringnet-sr.pt.

Usage:
    python3 tools/guitar-vision/proof-string-refresh.py --fit a,b,c --held d,e,f --work ... --out <dir> --epochs 8
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from torch.utils.data import DataLoader, Dataset

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, TOOLS / path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_pct = _load("proof_context_train_mod", "proof_context_train.py")
_evlink = _load("proof_event_link_mod", "proof-event-link.py")

SEED = 20261009
EPOCHS = 8
BATCH = 64
JIT = 30  # vertical window jitter px


class FitCrops(Dataset):
    def __init__(self, samples, work_dirs, jitter: bool):
        self.items = []
        for sample in samples:
            man = json.load(open(f"/tmp/proof/hires/{sample}-manifest.json"))
            joins = canon = None
            for root in work_dirs:
                for cand in (root / sample / "joins.json",
                             root / "joins.json" if Path(root).name == sample else None):
                    if cand is not None and Path(cand).exists():
                        joins = json.loads(Path(cand).read_text())
                        break
                if joins is not None:
                    break
            for root in work_dirs:
                for cand in (root / sample / "canonical.json",
                             root / "canonical.json" if Path(root).name == sample else None):
                    if cand is not None and Path(cand).exists():
                        canon = json.loads(Path(cand).read_text())
                        break
                if canon is not None:
                    break
            if joins is None:
                continue
            links, _ = _evlink.build_links(joins, canon, sample)
            for tag, meta in man.items():
                if not isinstance(meta, dict) or "file" not in meta:
                    continue
                pno = int(tag.replace("page", ""))
                fx = meta["cssWidth"] / meta["viewBox"][0]
                fy = meta["height"] / meta["viewBox"][1]
                for sid, join in joins["joins"].items():
                    if (join.get("page") or 1) != pno or not join.get("boxes"):
                        continue
                    if "tab-text" not in (join.get("children") or []):
                        continue
                    ev = (links.get(sid) or {}).get("event")
                    if ev is None:
                        continue
                    tab = ev.get("tab") or {}
                    if tab.get("string") is None:
                        continue
                    boxes = join["boxes"]
                    self.items.append({"file": meta["file"], "string": tab["string"] - 1,
                                       "cx": (min(b[0] for b in boxes) + max(b[2] for b in boxes)) / 2 * fx,
                                       "cy": (min(b[1] for b in boxes) + max(b[3] for b in boxes)) / 2 * fy,
                                       "w": (max(b[2] for b in boxes) - min(b[0] for b in boxes)) * fx,
                                       "h": (max(b[3] for b in boxes) - min(b[1] for b in boxes)) * fy})
        self.jitter = jitter
        self.rng = np.random.RandomState(SEED)
        by_cls: dict[int, list] = {}
        for i, it in enumerate(self.items):
            by_cls.setdefault(it["string"], []).append(i)
        self.balanced = []
        if jitter:
            # Oversample minorities to majority size (fixed order per epoch
            # via epoch-seeded permutation in __getitem__? simpler: fixed
            # balanced index list, reshuffled each epoch by loader? Loader
            # shuffle handles epoch reshuffle; jitter drawn per sample).
            target = max(len(v) for v in by_cls.values())
            for cls, idxs in by_cls.items():
                rep = (target // len(idxs)) + 1
                self.balanced.extend((idxs * rep)[:target])
        else:
            self.balanced = list(range(len(self.items)))

    def __len__(self):
        return len(self.balanced)

    def __getitem__(self, index: int):
        it = self.items[self.balanced[index]]
        image = Image.open(it["file"]).convert("L")
        iw, ih = image.size
        cx, cy, w, h = it["cx"], it["cy"], it["w"], it["h"]
        if self.jitter:
            cy = cy + float(self.rng.uniform(-JIT, JIT))
        half_h = max(h * 1.1, 160 * (h / 253))
        tall = image.crop((max(int(cx - w), 0), max(int(cy - half_h), 0),
                           min(int(cx + w), iw), min(int(cy + half_h), ih)))
        tall = tall.resize((64, 256), Image.BILINEAR)
        x = torch.from_numpy(np.asarray(tall, dtype=np.float32) / 255.0).unsqueeze(0)
        return {"x": x, "y": it["string"]}


def accuracy(model, loader, device) -> float:
    model.eval()
    ok = tot = 0
    with torch.no_grad():
        for batch in loader:
            out = F.softmax(model(batch["x"].to(device))["string"], dim=1)
            pred = out.argmax(dim=1).cpu()
            ok += (pred == batch["y"]).sum().item()
            tot += len(pred)
    return ok / max(tot, 1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fit", required=True)
    parser.add_argument("--held", required=True)
    parser.add_argument("--work", required=True, action="append")
    parser.add_argument("--out", required=True)
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    parser.add_argument("--warm", default="/tmp/proof/chain-models/stringnet.pt")
    args = parser.parse_args()
    assert args.epochs <= 10, "cap: <=10 epochs"
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"device: {device}", flush=True)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    work_dirs = [Path(w) for w in args.work]
    fit_ids = args.fit.split(",")
    held_ids = args.held.split(",")

    model = _pct.StringNet().to(device)
    saved = torch.load(args.warm, map_location=device, weights_only=True)
    model.load_state_dict(saved["state"] if "state" in saved else saved)
    print("warm start ok", flush=True)
    train_ds = FitCrops(fit_ids, work_dirs, jitter=True)
    fit_ds = FitCrops(fit_ids, work_dirs, jitter=False)
    held_ds = FitCrops(held_ids, work_dirs, jitter=False)
    print(f"train items: {len(train_ds)} fit: {len(fit_ds)} held: {len(held_ds)}", flush=True)
    loader = DataLoader(train_ds, batch_size=BATCH, shuffle=True, num_workers=0)
    fit_loader = DataLoader(fit_ds, batch_size=256, shuffle=False, num_workers=0)
    held_loader = DataLoader(held_ds, batch_size=256, shuffle=False, num_workers=0)
    print(f"fit acc before: {accuracy(model, fit_loader, device):.3f} "
          f"held acc before: {accuracy(model, held_loader, device):.3f}", flush=True)
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-4)
    history = []
    for epoch in range(args.epochs):
        model.train()
        total, count = 0.0, 0
        for batch in loader:
            out = model(batch["x"].to(device))["string"]
            loss = F.cross_entropy(out, batch["y"].to(device))
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total += loss.item()
            count += 1
        fa, ha = accuracy(model, fit_loader, device), accuracy(model, held_loader, device)
        history.append({"epoch": epoch + 1, "loss": total / max(count, 1),
                        "fitAcc": round(fa, 4), "heldAcc": round(ha, 4)})
        print(f"epoch {epoch + 1}/{args.epochs} loss={total / max(count, 1):.4f} "
              f"fit={fa:.3f} held={ha:.3f}", flush=True)
    torch.save({"state": model.state_dict()}, out_dir / "stringnet-sr.pt")
    (out_dir / "sr-history.json").write_text(json.dumps(history, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
