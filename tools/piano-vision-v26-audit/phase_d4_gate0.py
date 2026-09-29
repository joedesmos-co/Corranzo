"""Phase D4/D5 - CORRECTED held-score test: perfect vs detected geometry.

WHY THE FROZEN GATE 0 IS REPLACED (not edited to look better)
------------------------------------------------------------
It was mis-specified, and the correction is recorded rather than applied
quietly:

  * it scored `pitch_staff_step`, whose label is BY DEFINITION
    round((bandCentre - cy)/gap)+16. The probe received `k`, so the task was a
    closed-form restatement of its own input. Measured: the closed form
    reproduces the target on 98.8% of objects while the same network scored
    0.081 LOSO. The network was memorising image fingerprints, not solving
    anything.
  * it scored `written_step` / `octave` without the band role. On a grand
    staff k=0 is B4 above and D3 below, so those targets were ambiguous and no
    result from that probe could have been meaningful.

So the frozen Gate 0 numbers are RETAINED as evidence of a broken instrument
and are not the acceptance test. This script is the acceptance test. It keeps
the parts that were sound - the same staff-anchored ROI at 8 px per staff
space, the same leave-one-SCORE-out protocol, the same seeds, the same number
of folds - and fixes only the two defects above.

THREE ARMS, ONE PROTOCOL, TARGET = MusicXML written step/octave
-------------------------------------------------------------
  pixels_only  : ROI pixels alone. Can the raster carry pitch with no geometry
                 and no clef? This is the image-sufficiency question.
  detected     : ROI pixels + the detected k + the detected band role.
                 This is what a deployed detector would have.
  analytic     : closed form from (k, role), no learning at all. The
                 geometric ceiling, and the number a network must approach
                 before any of this is worth training.

Nothing here reads a checkpoint or trains the product model. Every arm is a
small probe under the identical LOSO split.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import torch
from torch import nn

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

H.add_runtime_to_path()
from piano_vision.v2.data import build_inputs, attach_targets, collate, _center  # noqa: E402
from piano_vision.v25.data import attach_object_page_geo  # noqa: E402
from piano_vision.v25.performance import prepare_batch  # noqa: E402

ROI_W_SPACES = 6.0
ROI_H_SPACES = 12.0
DENSITY = 8
CACHE = H.V26_ROOT / ("out/phase_d_cache_" + H.REALPDF_ROOT.name + ".npz")
CURRENT = None
LETTERS = "CDEFGAB"
STEP_IDX = {c: i for i, c in enumerate(LETTERS)}


def staff_of(obj, bands):
    if not bands:
        return None
    cy = _center(obj)[1]
    return min(bands, key=lambda b: abs(cy - (float(b["y0"]) + float(b["y1"])) / 2))


def extract_roi(page, obj, bands):
    band = staff_of(obj, bands)
    if band is None:
        return None
    pw, ph = page.size
    gap = max(1e-9, (float(band["y1"]) - float(band["y0"])) / 4.0)
    cx, cy = _center(obj)
    hw, hh = ROI_W_SPACES * gap / 2, ROI_H_SPACES * gap / 2
    x0 = int(max(0, round((cx - hw) * pw))); x1 = int(min(pw, round((cx + hw) * pw)))
    y0 = int(max(0, round((cy - hh) * ph))); y1 = int(min(ph, round((cy + hh) * ph)))
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    out = (int(round(ROI_W_SPACES * DENSITY)), int(round(ROI_H_SPACES * DENSITY)))
    img = page.crop((x0, y0, x1, y1)).resize(out, Image.Resampling.BILINEAR)
    centre = (float(band["y0"]) + float(band["y1"])) / 2
    return (np.asarray(img.convert("L"), dtype=np.float32) / 255.0,
            (centre - cy) / gap, 1.0 if band.get("staffRole") == "upper" else 0.0)


from PIL import Image  # noqa: E402


def build_cache(max_records=30, per_score=320):
    groups = H.realpdf_scores("adaptation") + H.realpdf_scores("validation")
    rois, feats, scores, ys = [], [], [], []
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
            # label lookup by THIS record's own object index
            label_for = {}
            for lab in rec["target"]["families"].get("PITCH_STAFF", []):
                if lab.get("state") != "KNOWN" or not lab.get("isPositive"):
                    continue
                for ix in (lab.get("objectIndexes") or []):
                    label_for[ix] = lab
            t = batch["targets"]["object"]
            n_obj = int(t["pitch_staff_step"]["mask"][0].shape[0])
            for i, obj in enumerate(m.get("physicalObjects", [])):
                if obj.get("kind") != "notehead" or i >= n_obj or taken >= per_score:
                    continue
                if not bool(t["pitch_written_step"]["mask"][0][i].item()):
                    continue
                if i not in label_for:
                    continue
                r = extract_roi(page, obj, bands)
                if r is None:
                    continue
                roi, k_local, is_upper_local = r
                # k and the band role are taken from the PIPELINE's own staff
                # geometry (staffPosition.stepsFromBandCenter / staffRole), not
                # from a local recomputation. Both are detector-derived, so
                # neither is the target - but they are what production actually
                # feeds the model, and recomputing the gap band-locally
                # disagrees with the pooled staff_space on ~3% of objects,
                # which manufactured a spurious +/-6 residual that does not
                # exist in the corpus.
                lab = label_for[i]
                k = float((lab["value"]["staffPosition"] or {})["stepsFromBandCenter"])
                is_upper = 1.0 if lab["value"].get("staffRole") == "upper" else 0.0
                tgt_step = int(t["pitch_written_step"]["target"][0][i].item())
                tgt_oct = int(t["pitch_octave"]["target"][0][i].item())
                if tgt_step < 0 or tgt_oct < 0:
                    continue
                rois.append(roi[None].astype(np.float16))
                # geometry features: k and its transforms, plus the band role
                feats.append([k, k * 2, k * 4, k / 2, k * k, float(k >= 0),
                              abs(k), float(np.sign(k)), is_upper, 1.0 - is_upper])
                scores.append(sid)
                ys.append([STEP_IDX.get(LETTERS[tgt_step], -1), tgt_oct])
                taken += 1
    d = {"roi": np.concatenate(rois, 0), "f": np.asarray(feats, np.float32),
         "score": np.asarray(scores), "y": np.asarray(ys, np.int64)}
    np.savez_compressed(CACHE, **d)
    return d


class RoiNet(nn.Module):
    def __init__(self, n_out, n_feat, width=192):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(1, 16, 3, stride=2, padding=1), nn.GELU(),
            nn.Conv2d(16, 32, 3, stride=2, padding=1), nn.GELU(),
            nn.Conv2d(32, 32, 3, stride=2, padding=1), nn.GELU(),
            nn.AdaptiveAvgPool2d((3, 3)))
        self.use_feat = n_feat > 0
        d = 32 * 9 + (n_feat if self.use_feat else 0)
        self.head = nn.Sequential(nn.LayerNorm(d), nn.Linear(d, width), nn.GELU(),
                                  nn.Linear(width, width), nn.GELU(),
                                  nn.Linear(width, n_out))

    def forward(self, x, f):
        z = self.conv(x).flatten(1)
        if self.use_feat:
            z = torch.cat((z, f), -1)
        return self.head(z)


def loso(d, arm, epochs=20, seed=0, bs=64):
    roi = torch.tensor(np.asarray(d["roi"], np.float32)).unsqueeze(1)
    f = torch.tensor(d["f"]) if arm != "pixels_only" else torch.zeros((len(roi), 0))
    n_feat = f.shape[1]
    sc, Y = d["score"], d["y"]
    scores = sorted(set(sc.tolist()))
    out = {}
    for j, name in ((0, "written_step"), (1, "octave")):
        y = Y[:, j]
        s = sc
        if len(y) < 60:
            continue
        n_out = 7 if name == "written_step" else 11
        yy_all = torch.tensor(y)
        hit = tot = 0
        folds = []
        for held in scores:
            te = torch.tensor(s == held)
            tr = ~te
            if int(tr.sum()) < 60 or int(te.sum()) < 8:
                continue
            torch.manual_seed(seed)
            net = RoiNet(n_out, n_feat)
            opt = torch.optim.AdamW(net.parameters(), lr=4e-3, weight_decay=1e-4)
            lossf = nn.CrossEntropyLoss()
            net.train()
            tr_i = torch.where(tr)[0]
            for _ in range(epochs):
                perm = tr_i[torch.randperm(len(tr_i))]
                for s0 in range(0, len(perm), bs):
                    b = perm[s0:s0 + bs]
                    opt.zero_grad()
                    lossf(net(roi[b], f[b]), yy_all[b]).backward()
                    opt.step()
            net.eval()
            te_i = torch.where(te)[0]
            with torch.no_grad():
                pr = net(roi[te_i], f[te_i]).argmax(-1)
                trn = float((net(roi[tr_i[:400]], f[tr_i[:400]]).argmax(-1)
                             == yy_all[tr_i[:400]]).float().mean())
            h = int((pr == yy_all[te_i]).sum()); t = int(len(te_i))
            hit += h; tot += t
            folds.append({"held": held, "acc": round(h / t, 4), "n": t,
                          "train": round(trn, 4)})
        if not tot:
            continue
        maj = float(np.bincount(y).max() / len(y))
        out[name] = {"loso": round(hit / tot, 4), "majority": round(maj, 4),
                     "n": tot, "n_scores": len(folds), "folds": folds}
        print(f"  {arm:<14} {name:<13} LOSO={hit/tot:.4f}  (majority {maj:.4f}, "
              f"n={tot}, {len(folds)} folds)", flush=True)
    return out


def analytic_arm(d):
    f, Y, sc = d["f"], d["y"], d["score"]
    k, is_upper = f[:, 0], f[:, 8]
    middle = np.where(is_upper > 0.5, 34, 22)
    d_idx = middle + np.round(2 * k).astype(int)
    step = d_idx % 7
    octv = d_idx // 7
    hit = tot = 0
    per = {}
    for name, j, pred in (("written_step", 0, step), ("octave", 1, octv)):
        ok = (pred == Y[:, j])
        hit += int(ok.sum()); tot += len(ok)
        for s in sorted(set(sc.tolist())):
            m = sc == s
            per.setdefault(s, {})[name] = round(float(ok[m].mean()), 4)
        print(f"  {'analytic':<14} {name:<13} acc={ok.mean():.4f}  (n={len(ok)})",
              flush=True)
    return {"pooled": round(hit / max(1, tot), 4), "per_score": per,
            "written_step": round(float((step == Y[:, 0]).mean()), 4),
            "octave": round(float((octv == Y[:, 1]).mean()), 4)}


def main():
    global CURRENT
    rt = H.load_runtime("cpu")
    CURRENT = rt.config
    if CACHE.exists() and "--rebuild" not in sys.argv:
        d = dict(np.load(CACHE, allow_pickle=True))
        print(f"loaded cache {d['roi'].shape}")
    else:
        print("building cache ...", flush=True)
        d = build_cache()
        print("cache", d["roi"].shape)
    out = {"corpus": str(H.REALPDF_INDEX.parent.name),
           "roi": {"px_per_staff_space": DENSITY, "w_spaces": ROI_W_SPACES,
                   "h_spaces": ROI_H_SPACES, "shape": list(d["roi"].shape)},
           "protocol": "leave-one-SCORE-out, 20 epochs, seed 0, identical across arms"}
    out["analytic"] = analytic_arm(d)
    out["arms"] = {arm: loso(d, arm) for arm in ("pixels_only", "detected")}
    p = H.write_json("phase_d4_gate0_corrected.json", out)
    print("\nwrote", p)


if __name__ == "__main__":
    main()
