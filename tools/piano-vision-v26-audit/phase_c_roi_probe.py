"""Phase C / Gate 0 (fast): cache staff-anchored ROIs once, then probe them.

Phase A closed every other channel:
  raster identity          irrelevant  (factory-raster swap -0.005)
  graph/source scalars     irrelevant  (zeroing 0.000)
  clef / context path      perfect
  scalar geometry channels NO transferable signal under a split by score
                           (LOSO written_step 0.157 vs 0.189 majority)

The pixels are the only channel left. But the pitch head does not see the
pixels - it sees a 3x3 bilinear sample of a box ~4.6 staff spaces tall, which
is three samples across four staff-line intervals, with no staff-anchored
origin. This caches the candidate replacement - a crop anchored to the notehead's
own staff band, expressed in STAFF-SPACE UNITS so it is invariant to the
measure-scope height that broke the scalar channel - and probes it under the
identical leave-one-score-out protocol used in phase_a_detector_ceiling.

If the information is not in the ROI, no architecture recovers it and the
direction is dead before any GPU time is requested.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import torch
from torch import nn
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

H.add_runtime_to_path()
from piano_vision.v2.data import build_inputs, attach_targets, collate, _center  # noqa: E402
from piano_vision.v25.data import attach_object_page_geo  # noqa: E402
from piano_vision.v25.performance import prepare_batch  # noqa: E402

ROI_W_SPACES = 6.0
ROI_H_SPACES = 12.0
CACHE = H.V26_ROOT / ("out/roi_cache_" + H.REALPDF_ROOT.name + ".npz")
CURRENT = None


def staff_of(obj, bands):
    if not bands:
        return None
    cy = _center(obj)[1]
    return min(bands, key=lambda b: abs(
        cy - (float(b["y0"]) + float(b["y1"])) / 2))


def extract_roi(page, obj, bands, px_per_space):
    band = staff_of(obj, bands)
    if band is None:
        return None
    pw, ph = page.size
    gap = max(1e-9, (float(band["y0"]) * -1 + float(band["y1"])) / 4.0)
    cx, cy = _center(obj)
    hw, hh = ROI_W_SPACES * gap / 2, ROI_H_SPACES * gap / 2
    x0 = int(max(0, round((cx - hw) * pw))); x1 = int(min(pw, round((cx + hw) * pw)))
    y0 = int(max(0, round((cy - hh) * ph))); y1 = int(min(ph, round((cy + hh) * ph)))
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    out_w = int(round(ROI_W_SPACES * px_per_space))
    out_h = int(round(ROI_H_SPACES * px_per_space))
    img = page.crop((x0, y0, x1, y1)).resize((out_w, out_h), Image.Resampling.BILINEAR)
    centre = (float(band["y0"]) + float(band["y1"])) / 2
    return (np.asarray(img.convert("L"), dtype=np.float32) / 255.0,
            (centre - cy) / gap, float(gap))


def build_cache(density=8, max_records=30, per_score=320):
    groups = H.realpdf_scores("adaptation") + H.realpdf_scores("validation")
    rois, ks, scores, targets = [], [], [], []
    for sid, ordered in groups:
        resolver = H.realpdf_resolver()
        taken = 0
        for rec in ordered[:max_records]:
            if taken >= per_score:
                break
            try:
                page = resolver.page(rec)
                sample, selected, lookup, relations, nodes = build_inputs(
                    rec, ordered, resolver, CURRENT)
                sample = attach_targets(sample, rec, selected, lookup, relations, nodes)
                sample = attach_object_page_geo(sample, selected)
                batch = prepare_batch(collate([sample]), consistency=False)
            except Exception:
                continue
            m = rec["input"]["modelInput"]
            bands = m.get("geometry", {}).get("staffBands", {}).get("staffBands", [])
            t = batch["targets"]["object"]
            n_obj = int(t["pitch_staff_step"]["mask"][0].shape[0])
            for i, obj in enumerate(m.get("physicalObjects", [])):
                if obj.get("kind") != "notehead" or i >= n_obj or taken >= per_score:
                    continue
                r = extract_roi(page, obj, bands, density)
                if r is None:
                    continue
                roi, k, gap = r
                rois.append(roi[None].astype(np.float16))
                taken += 1
                ks.append([k, k * 2, k * 4, k / 2, k * k, float(k >= 0),
                           abs(k), float(np.sign(k)), gap * 1000])
                scores.append(sid)
                targets.append([t["pitch_staff_step"]["target"][0][i].item(),
                                t["pitch_written_step"]["target"][0][i].item(),
                                t["pitch_octave"]["target"][0][i].item(),
                                float(t["pitch_staff_step"]["mask"][0][i].item()),
                                float(t["pitch_written_step"]["mask"][0][i].item()),
                                float(t["pitch_octave"]["mask"][0][i].item())])
    d = {"roi": np.concatenate(rois, 0), "k": np.asarray(ks, np.float32),
         "score": np.asarray(scores), "y": np.asarray(targets, np.float32)}
    np.savez_compressed(CACHE, **d)
    return d


class RoiNet(nn.Module):
    def __init__(self, n_out, width=192):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(1, 16, 3, stride=2, padding=1), nn.GELU(),   # /2
            nn.Conv2d(16, 32, 3, stride=2, padding=1), nn.GELU(),  # /4
            nn.Conv2d(32, 64, 3, stride=2, padding=1), nn.GELU(),  # /8
            nn.AdaptiveAvgPool2d((4, 4)))
        self.head = nn.Sequential(nn.LayerNorm(64 * 16 + 9), nn.Linear(64 * 16 + 9, width),
                                  nn.GELU(), nn.Linear(width, width), nn.GELU(),
                                  nn.Linear(width, n_out))

    def forward(self, x, kf):
        return self.head(torch.cat((self.conv(x).flatten(1), kf), -1))


def loso(d, epochs=45, seed=0, bs=64, cols=(0, 1, 2, 3, 4, 5)):
    roi = torch.tensor(np.asarray(d["roi"], np.float32)).unsqueeze(1)  # (N,1,H,W)
    kf = torch.tensor(d["k"])
    sc = d["score"]
    Y = d["y"]
    scores = sorted(set(sc.tolist()))
    out = {}
    for j, name in ((0, "staff_step"), (1, "written_step"), (2, "octave")):
        msk = Y[:, cols[3 + j]] > 0
        y = Y[:, j][msk]
        s = sc[msk]
        if len(y) < 60:
            continue
        n_out = max(int(y.max()) + 1, 35)
        hit = tot = 0
        folds = []
        for held in scores:
            te = torch.tensor(s == held)
            tr = ~te
            if int(tr.sum()) < 60 or int(te.sum()) < 8:
                continue
            yy = torch.tensor(y).long()
            torch.manual_seed(seed)
            net = RoiNet(n_out)
            opt = torch.optim.AdamW(net.parameters(), lr=4e-3, weight_decay=1e-4)
            lossf = nn.CrossEntropyLoss()
            net.train()
            tr_i = torch.where(tr)[0]
            for _ in range(epochs):
                perm = tr_i[torch.randperm(len(tr_i))]
                for s0 in range(0, len(perm), bs):
                    b = perm[s0:s0 + bs]
                    opt.zero_grad()
                    lossf(net(roi[b], kf[b]), yy[b]).backward()
                    opt.step()
            net.eval()
            te_i = torch.where(te)[0]
            with torch.no_grad():
                pr = net(roi[te_i], kf[te_i]).argmax(-1)
                tr_acc = float((net(roi[tr_i[:400]], kf[tr_i[:400]]).argmax(-1)
                                == yy[tr_i[:400]]).float().mean())
            h = int((pr == yy[te_i]).sum()); t = int(len(te_i))
            hit += h; tot += t
            folds.append({"held": held, "acc": round(h / t, 4), "n": t,
                          "train": round(tr_acc, 4)})
        if not tot:
            continue
        maj = float(np.bincount(y.astype(int)).max() / len(y))
        out[name] = {"loso": round(hit / tot, 4), "majority": round(maj, 4),
                     "n": tot, "n_scores": len(folds), "folds": folds}
        print(f"  {name:<12} LOSO={hit/tot:.4f}  (majority {maj:.4f}, n={tot}, "
              f"{len(folds)} folds)", flush=True)
        for f in folds:
            print(f"      {f['held'][:30]:<32} {f['acc']}  (train {f['train']})  n={f['n']}")
    return out


def main():
    global CURRENT
    rt = H.load_runtime("cpu")
    CURRENT = rt.config
    if CACHE.exists() and "--rebuild" not in sys.argv:
        d = dict(np.load(CACHE, allow_pickle=True))
        print(f"loaded cache: {d['roi'].shape}")
    else:
        print("building ROI cache ...", flush=True)
        d = build_cache(density=8)
        print("cache", d["roi"].shape)
    out = {"roi_shape": list(d["roi"].shape),
           "px_per_space": 8, "roi_w_spaces": ROI_W_SPACES, "roi_h_spaces": ROI_H_SPACES}
    out["loso"] = loso(d)
    p = H.write_json("phase_c_roi_probe.json", out)
    print("\nwrote", p)


if __name__ == "__main__":
    main()
