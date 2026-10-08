#!/usr/bin/env python3
"""Full supervised training campaign (preregistered plan).

Trains common / membership / context probes on trainFull (all 792 TRAIN
scores) with DEV selection, early stopping (patience 4, max 20 epochs),
best-checkpoint saving, and the v1_domain photometric recipe applied on the
fly (seeded, label-invariant for classification; geometry left unmapped and
documented as approximate under augmentation).

Usage:
  python3 train_full.py --probe common --mode normal
  python3 train_full.py --probe membership --mode blank   # control
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn as nn

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
sys.path.insert(0, str(HERE))
from v1_probe import (HEADS, HEADS_CAT, HEADS_BIN, LocalModel, ContextModel,  # noqa: E402
                      load_items, masked_acc, page_png)

PROBE_HEADS = {"common": ["kind", "pitch", "dur", "dots", "staff", "acc", "grace", "cue", "voice"],
               "membership": HEADS_BIN,
               "context": ["staff", "voice", "kind", "pitch", "dur"]}

SELECT_METRIC = {"common": ["pitch", "dur"],
                 "membership": ["in_beam", "chord_tone"],
                 "context": ["staff", "voice"]}


def augment_batch(xb, seed):
    """Label-invariant photometric + mild affine augmentation (float32 [0,1]).
    Deterministic given seed. Geometry inputs are NOT remapped (documented
    approximation: affine stays within +-3px/3deg, sub-bbox scale)."""
    rng = np.random.RandomState(seed)
    out = xb.copy().astype(np.float32)
    n = len(out)
    if rng.rand() < 0.5:
        k = 3
        for i in range(n):
            if rng.rand() < 0.5:
                out[i, 0] = cv2.GaussianBlur(out[i, 0], (k, k), 0.8)
    noise = rng.normal(0, 4 / 255, out.shape).astype(np.float32)
    out = np.clip(out + noise * (rng.rand(n, 1, 1, 1) < 0.5), 0, 1)
    gamma = rng.choice([1.0, 0.8, 1.25], p=[0.5, 0.25, 0.25])
    out = np.clip(out ** gamma, 0, 1)
    tilt = (rng.rand() - 0.5) * 0.2
    xs = np.linspace(-1, 1, out.shape[3], dtype=np.float32)
    gain = (1 + tilt * xs)[None, None, None, :]
    out = np.clip(out * gain, 0, 1)
    # expensive ops (affine + JPEG) at low rate to bound CPU cost
    if rng.rand() < 0.2:
        ang = rng.uniform(-3, 3)
        sc = rng.uniform(0.95, 1.05)
        tx, ty = rng.uniform(-2, 2, size=2)
        M = cv2.getRotationMatrix2D((32, 32), ang, sc)
        M[:, 2] += [tx, ty]
        for i in range(n):
            out[i, 0] = cv2.warpAffine(out[i, 0], M, (64, 64),
                                       borderValue=1.0, flags=cv2.INTER_LINEAR)
    if rng.rand() < 0.2:
        for i in range(n):
            _, buf = cv2.imencode(".jpg", (out[i, 0] * 255).astype(np.uint8),
                                  [cv2.IMWRITE_JPEG_QUALITY, 85])
            out[i, 0] = cv2.imdecode(buf, cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
    return np.clip(out, 0, 1).astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", required=True, choices=["common", "membership", "context"])
    ap.add_argument("--mode", default="normal", choices=["normal", "blank", "shuffled"])
    ap.add_argument("--subset", default="trainFull")
    ap.add_argument("--max-epochs", type=int, default=20)
    ap.add_argument("--patience", type=int, default=4)
    ap.add_argument("--batch-size", type=int, default=256)
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--no-augment", action="store_true")
    args = ap.parse_args()
    SEED = args.seed
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    torch.set_num_threads(args.threads)
    t_start = time.time()
    PH = PROBE_HEADS[args.probe]

    Xt, St, Gt, Yt, Mt, metat, voc, sizes = load_items(args.subset)
    Xd, Sd, Gd, Yd, Md, metad, _, _ = load_items("dev20")
    # restrict to probe heads (load_items returns all 25)
    ph_sizes = {h: sizes[h] for h in PH}

    if args.mode == "blank":
        Xt = np.zeros_like(Xt)
        Xd = np.zeros_like(Xd)
        # strips zeroed too (geometry kept, documented)
        St = np.zeros_like(St)
        Sd = np.zeros_like(Sd)
    if args.mode == "shuffled":
        perm = np.random.RandomState(SEED).permutation(len(Xt))
        Yt = {h: v[perm] for h, v in Yt.items()}
        Mt = {h: v[perm] for h, v in Mt.items()}

    majority = {}
    for h in PH:
        vals, counts = np.unique(Yt[h][Mt[h] > 0.5], return_counts=True)
        majority[h] = {"label": int(vals[counts.argmax()]), "train_acc": float(counts.max() / counts.sum())}

    Xd_t = torch.from_numpy(Xd[:, None]).float()  # load_items already [0,1]
    Sd_t = torch.from_numpy(Sd).float() / 255
    Gd_t = torch.from_numpy(Gd)
    Yd_t = {h: torch.from_numpy(Yd[h]) for h in PH}
    Md_t = {h: torch.from_numpy(Md[h]) for h in PH}

    model = {"common": LocalModel, "membership": LocalModel,
             "context": ContextModel}[args.probe](ph_sizes)
    opt = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=1e-4)
    ce = nn.CrossEntropyLoss(reduction="none")

    def run_eval():
        model.eval()
        out = {}
        with torch.no_grad():
            logits = model(Xd_t, Sd_t, Gd_t)
            for h in PH:
                l = ce(logits[h], Yd_t[h].clamp(min=0))
                l = (l * Md_t[h]).sum() / Md_t[h].sum().clamp(min=1)
                acc, n = masked_acc(logits[h], Yd_t[h], Md_t[h])
                out[h] = {"loss": float(l), "acc": acc, "n": n}
        return out

    def head_loss(logits, y, m):
        l = ce(logits, y.clamp(min=0))
        return (l * m).sum() / m.sum().clamp(min=1)

    best_metric, best_ep, wait = -1.0, 0, 0
    curve = []
    order = np.arange(len(Xt))
    SEL = SELECT_METRIC[args.probe]
    (TRAIN / "models").mkdir(exist_ok=True)
    mp_best = TRAIN / "models" / f"full_{args.probe}_{args.mode}_best.pt"
    mp_final = TRAIN / "models" / f"full_{args.probe}_{args.mode}_final.pt"
    tmp_best = TRAIN / "models" / f".tmp_{args.probe}_{args.mode}_best.pt"
    for ep in range(args.max_epochs):
        np.random.RandomState(SEED + ep).shuffle(order)
        model.train()
        tot, nstep = 0.0, 0
        for start in range(0, len(Xt), args.batch_size):
            sl = order[start:start + args.batch_size]
            xb = torch.from_numpy(Xt[sl][:, None]).float()  # already [0,1]
            sb = torch.from_numpy(St[sl]).float() / 255
            gb = torch.from_numpy(Gt[sl])
            if args.mode == "normal" and not args.no_augment:
                xb = torch.from_numpy(augment_batch(xb.numpy(), SEED * 1000 + ep * 100000 + start))
            yb = {h: torch.from_numpy(Yt[h][sl]) for h in PH}
            mb = {h: torch.from_numpy(Mt[h][sl]) for h in PH}
            opt.zero_grad()
            logits = model(xb, sb, gb)
            loss = sum(head_loss(logits[h], yb[h], mb[h]) for h in PH) / len(PH)
            loss.backward()
            opt.step()
            tot += float(loss.detach())
            nstep += 1
        dev = run_eval()
        metric = float(np.mean([dev[h]["acc"] for h in SEL]))
        curve.append({"epoch": ep + 1, "train_loss": tot / nstep,
                      "dev": {h: dev[h]["acc"] for h in PH}, "metric": metric})
        improved = metric > best_metric + 1e-4
        if improved:
            best_metric, best_ep, wait = metric, ep + 1, 0
            torch.save({"state": model.state_dict(), "sizes": ph_sizes,
                        "probe": args.probe, "mode": args.mode, "epoch": ep + 1,
                        "metric": best_metric, "seed": SEED}, str(tmp_best))
        else:
            wait += 1
        show = " ".join(f"dev_{h}={dev[h]['acc']:.3f}" for h in PH[:4])
        print(f"[{args.probe}/{args.mode}] epoch {ep+1}/{args.max_epochs} "
              f"train_loss={tot/nstep:.4f} metric={metric:.4f} {show} "
              f"{'(best)' if improved else ''}", flush=True)
        if wait >= args.patience:
            print(f"[early-stop] patience {args.patience} exhausted at epoch {ep+1}", flush=True)
            break

    print(f"[done] best {args.probe}/{args.mode}: metric={best_metric:.4f} at epoch {best_ep} "
          f"after {len(curve)} epochs, {round(time.time()-t_start,1)}s", flush=True)
    torch.save({"state": model.state_dict(), "sizes": ph_sizes,
                "probe": args.probe, "mode": args.mode, "epoch": len(curve),
                "seed": SEED}, str(mp_final))
    import shutil
    if tmp_best.is_file():
        shutil.move(str(tmp_best), str(mp_best))
    res = {"schema": "piano-full-fit/1", "mode": args.mode, "probe": args.probe,
           "subset": args.subset,
           "budget": {"max_epochs": args.max_epochs, "patience": args.patience,
                      "batch": args.batch_size, "lr": 3e-4, "seed": SEED, "device": "cpu",
                      "augment": args.mode == "normal" and not args.no_augment},
           "runtime_s": round(time.time() - t_start, 1),
           "model_best": mp_best.name if mp_best.is_file() else None,
           "model_best_sha256": hashlib.sha256(mp_best.read_bytes()).hexdigest() if mp_best.is_file() else None,
           "model_final": mp_final.name,
           "model_final_sha256": hashlib.sha256(mp_final.read_bytes()).hexdigest(),
           "majority": majority, "curve": curve,
           "best_metric": best_metric, "best_epoch": best_ep,
           "n_train": len(Xt), "n_dev": len(Xd)}
    (TRAIN / "manifests" / f"full_fit_{args.probe}_{args.mode}.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
