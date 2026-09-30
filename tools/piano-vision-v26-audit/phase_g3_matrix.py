"""Phase G3 - the ROI experiment matrix, resolution sweep and causal ablation.

Everything V2.5 stays frozen. One small CNN encodes the staff-anchored ROI; one
small head reads pitch. The frozen object embedding is optional per arm so the
ROI's marginal contribution is separable.

Matrix (identical protocol, identical seed, leave-one-score-out):
  A  frozen embedding only            (the corpus/2.1 baseline)
  B  ROI only
  C  frozen embedding + ROI
  D  frozen embedding + ROI + legitimate context

Resolution sweep at fixed physical field of view (7.0 x 12.0 staff spaces), so
the only variable is sampling density: 4 / 8 / 16 px per staff space.

Causal ablation on the winning configuration: correct / blank / shuffled /
wrong-score / wrong-staff / +1 space / -1 space / reduced-resolution. If a
destroyed ROI retains the performance, the gain is not coming from the pixels
and this is a leakage, not a result.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
from torch import nn

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import phase_f_cache as CACHE  # noqa: E402
import v26_staff as S  # noqa: E402
from v26_adapter import ADAPTED_PITCH_HEADS, PITCH_HEAD_SIZES  # noqa: E402

OFF = np.cumsum([0] + [PITCH_HEAD_SIZES[h] for h in ADAPTED_PITCH_HEADS])
LETTERS = "CDEFGAB"
SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
CTX = {"clef": slice(0, 8), "clef_line": slice(8, 14),
       "clef_octave": slice(14, 19), "key_fifths": slice(19, 34)}


def head_slice(a, head):
    j = ADAPTED_PITCH_HEADS.index(head)
    return a[..., OFF[j]:OFF[j + 1]]


class RoiEncoder(nn.Module):
    def __init__(self, width=64, out=96):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(1, width, 3, stride=2, padding=1), nn.GroupNorm(4, width), nn.GELU(),
            nn.Conv2d(width, width, 3, stride=2, padding=1), nn.GroupNorm(8, width), nn.GELU(),
            nn.Conv2d(width, width, 3, stride=2, padding=1), nn.GroupNorm(8, width), nn.GELU(),
            nn.AdaptiveAvgPool2d((3, 3)))
        self.out = nn.Linear(width * 9, out)

    def forward(self, x):
        return self.out(self.conv(x).flatten(1))


class Readout(nn.Module):
    """Small pitch readout. `use_emb` selects the frozen representation arm."""

    def __init__(self, emb_dim, roi_dim, n_feat, use_emb, use_roi, width=256, seed=0):
        super().__init__()
        torch.manual_seed(seed)
        self.use_emb, self.use_roi = use_emb, use_roi
        self.roi_dim = roi_dim
        d_in = (emb_dim if use_emb else 0) + (roi_dim if use_roi else 0) + n_feat
        self.trunk = nn.Sequential(nn.LayerNorm(d_in), nn.Linear(d_in, width), nn.GELU(),
                                   nn.Linear(width, width), nn.GELU())
        self.heads = nn.ModuleDict({h: nn.Linear(width, PITCH_HEAD_SIZES[h])
                                    for h in ADAPTED_PITCH_HEADS})

    def forward(self, emb, roi, feat):
        parts = []
        if self.use_emb:
            parts.append(emb)
        if self.use_roi:
            parts.append(self.roi_enc(roi))
        parts.append(feat)
        z = self.trunk(torch.cat(parts, -1))
        return {h: self.heads[h](z) for h in self.heads}


class Bundle:
    """Per-object tensors joined from the frozen cache and an ROI cache."""

    def __init__(self, frozen, roi, ctx=True):
        self.ex = {str(e): i for i, e in enumerate(frozen["example"])}
        keep, rows = [], []
        for n, (e, o) in enumerate(zip(roi["example"], roi["obj"])):
            r = self.ex.get(str(e))
            if r is None or o >= frozen["emb"].shape[1]:
                continue
            if not frozen["object_mask"][r, o]:
                continue
            keep.append(n)
            rows.append((r, int(o)))
        self.rows = rows
        self.n = len(rows)
        self.roi = roi
        self.emb = frozen["emb"]
        self.staff = frozen["staff"]
        self.ctxv = frozen["context_staff"]
        self.y = roi["y"]
        self.score = roi["score"]
        self.keep = np.asarray(keep)
        self.frozen = frozen

    def gather(self, name, idx):
        rows = [self.rows[i] for i in idx]
        r = np.asarray([x[0] for x in rows])
        o = np.asarray([x[1] for x in rows])
        if name == "emb":
            return self.emb[r, o].astype(np.float32)
        if name == "roi":
            return np.asarray(self.roi["roi"][self.keep[idx]], dtype=np.float32)[:, None]
        if name == "staff":
            return self.staff[r, o].astype(np.float32)
        if name == "ctx":
            return self.ctxv[r]
        if name == "y":
            return self.y[idx]
        if name == "score":
            return self.score[idx]
        raise KeyError(name)


def targets(y):
    """Targets aligned to the adapted head order (step, octave, accidental)."""
    t = np.full((len(y), 5), -1, np.int64)
    t[:, 1] = y[:, 0]
    t[:, 2] = y[:, 1]
    t[:, 3] = y[:, 2]
    return t


def head_pred(z, head):
    return z[head].argmax(-1)


def score_logits(z, y, m):
    """z is the Readout's dict of per-head logits."""
    s, o, a = head_pred(z, "pitch_written_step"), head_pred(z, "pitch_octave"), \
        head_pred(z, "pitch_accidental")
    ok = (s == torch.tensor(y[:, 0])) & (o == torch.tensor(y[:, 1])) & \
         (a == torch.tensor(y[:, 2]))
    return int((ok & m).sum()), int(m.sum())


def run(bundle, use_emb, use_roi, ctx_mode="none", epochs=15, width=256,
        roi_transform=None, seed=0, lr=3e-3, verbose=False, subsample=0,
        enc_width=64):
    scores = sorted(set(bundle.score.tolist()))
    idx_by = {s: np.where(bundle.score == s)[0] for s in scores}
    tot = defaultdict(int)
    per = {}
    rs = np.random.RandomState(12345)          # fixed, so all arms see the same data
    for held in scores:
        tr = np.concatenate([idx_by[s] for s in scores if s != held])
        te = idx_by[held]
        if subsample and len(tr) > subsample:
            # stratified by score so every held-out score keeps representation
            per_score_cap = max(1, subsample // max(1, len(scores) - 1))
            tr = np.concatenate([rs.choice(idx_by[s],
                                          min(per_score_cap, len(idx_by[s])),
                                          replace=False)
                                 for s in scores if s != held])
        # derive every input width from the ACTUAL tensors, never a constant
        n_feat = 3 + (int(bundle.ctxv.shape[1]) if ctx_mode == "all" else 0)
        enc = RoiEncoder(width=enc_width) if use_roi else None
        roi_dim = 96 if use_roi else 0
        model = Readout(int(bundle.emb.shape[-1]), roi_dim, n_feat,
                        use_emb, use_roi, width, seed)
        model.roi_enc = enc
        params = list(model.trunk.parameters()) + list(model.heads.parameters())
        if use_roi:
            params += list(enc.parameters())
        opt = torch.optim.AdamW(params, lr=lr, weight_decay=1e-4)
        lossf = nn.CrossEntropyLoss()
        for _ in range(epochs):
            opt.zero_grad()
            z = _forward(model, bundle, tr, use_emb, use_roi, ctx_mode, roi_transform)
            y = bundle.gather("y", tr)
            loss = 0.0
            for h, col in (("pitch_written_step", 0), ("pitch_octave", 1),
                           ("pitch_accidental", 2)):
                loss = loss + lossf(z[h], torch.tensor(y[:, col], dtype=torch.long))
            loss.backward()
            opt.step()
        if verbose:
            print("      fold %-34s done" % held[:33], flush=True)
        with torch.no_grad():
            z = _forward(model, bundle, te, use_emb, use_roi, ctx_mode, roi_transform)
            y = bundle.gather("y", te)
            m = (y[:, 0] >= 0) & (y[:, 1] >= 0) & (y[:, 2] >= 0)
            h_, t_ = score_logits(z, y, m)
            o_ = head_pred(z, "pitch_octave") == torch.tensor(y[:, 1])
            a_ = head_pred(z, "pitch_accidental") == torch.tensor(y[:, 2])
            st_ = head_pred(z, "pitch_written_step") == torch.tensor(y[:, 0])
            per[held] = {"written_pitch": round(h_ / t_, 4) if t_ else None,
                         "written_step": round(float(st_[m].float().mean()), 4),
                         "octave": round(float(o_[m].float().mean()), 4),
                         "accidental": round(float(a_[m].float().mean()), 4),
                         "n": t_, "engraving": str(bundle.score[te[0]])}
            tot["p"] += h_; tot["n"] += t_
    macro = float(np.mean([v["written_pitch"] for v in per.values()
                           if v["written_pitch"] is not None]))
    return {"weighted_written_pitch": round(tot["p"] / tot["n"], 4) if tot["n"] else None,
            "macro_written_pitch": round(macro, 4), "n": tot["n"],
            "per_score": per}


def _forward(model, bundle, idx, use_emb, use_roi, ctx_mode, roi_transform):
    emb = torch.tensor(bundle.gather("emb", idx)) if use_emb else \
        torch.zeros((len(idx), 0))
    if use_roi:
        roi = torch.tensor(bundle.gather("roi", idx))
        if roi_transform is not None:
            roi = roi_transform(roi)
    else:
        roi = torch.zeros((len(idx), 0))
    st = bundle.gather("staff", idx)
    feat = [st[:, 0:1], st[:, 2:3], st[:, 1:2]]
    if ctx_mode == "all":
        feat.append(bundle.gather("ctx", idx))
    return model(emb, roi, torch.tensor(np.concatenate(feat, -1), dtype=torch.float32))


def main():
    frozen = CACHE.load()
    densities = (4, 8, 16)
    roi = {d: dict(np.load(H.V26_ROOT / f"out/roi21_d{d}.npz", allow_pickle=True))
           for d in densities}
    bundle = Bundle(frozen, roi[8])
    report = {"protocol": "leave-one-score-out over 17 corpus/2.1 scores, seed 0, "
                          "30 epochs, frozen V2.5, field of view 7.0 x 12.0 staff spaces",
              "roi_objects": bundle.n,
              "reference": {"champion": 0.1204, "fresh_embedding_head": 0.6056,
                            "detected_geometry_ceiling": 0.7484,
                            "perfect_geometry_ceiling": 0.8054, "threshold": 0.70}}
    section = sys.argv[1] if len(sys.argv) > 1 else "all"
    EPOCHS = int(sys.argv[2]) if len(sys.argv) > 2 else 15
    SUBSAMPLE = int(sys.argv[4]) if len(sys.argv) > 4 else 0
    ENC_W = int(sys.argv[5]) if len(sys.argv) > 5 else 64
    ARMS_SEL = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] not in ("0", "") else ""
    print("epochs=%d subsample=%d enc_w=%d arms=%s section=%s" % (
        EPOCHS, SUBSAMPLE, ENC_W, ARMS_SEL or "all", section), flush=True)
    report["section"] = section
    print("=== G3 matrix (ROI at 8 px/staff space) ===", flush=True)
    mat = {}
    ARMS = {
        "A_frozen_embedding_only": (True, False, "none"),
        "B_roi_only": (False, True, "none"),
        "C_embedding_plus_roi": (True, True, "none"),
        "D_embedding_roi_context": (True, True, "all")}
    chosen = ([k for k in ARMS if k in ARMS_SEL.split(",")] if ARMS_SEL else list(ARMS))
    for name, (ue, ur, cm) in (
            [(k, ARMS[k]) for k in chosen] if section in ("all", "matrix") else []):
        r = run(bundle, ue, ur, ctx_mode=cm, epochs=EPOCHS, subsample=SUBSAMPLE,
                enc_width=ENC_W)
        mat[name] = r
        print("  %-26s weighted %.4f macro %.4f n=%d" % (
            name, r["weighted_written_pitch"], r["macro_written_pitch"], r["n"]), flush=True)
    report["matrix"] = mat
    if section == "matrix":
        p = H.write_json("phase_g3_roi.json", report)
        top = max(mat, key=lambda k: mat[k]["weighted_written_pitch"])
        print("\nbest", top, mat[top]["weighted_written_pitch"])
        print("wrote", p)
        return

    print("\n=== resolution sweep (arm C, fixed 7.0 x 12.0 staff-space field) ===",
          flush=True)
    sweep = {}
    for d in (densities if section in ("all", "sweep") else []):
        b = Bundle(frozen, roi[d])
        r = run(b, True, True)
        sweep[f"{d}_px_per_space"] = {**r, "roi_tensor": list(roi[d]["roi"].shape[1:])}
        print("  %2d px/space  roi %-12s weighted %.4f macro %.4f" % (
            d, "x".join(str(x) for x in roi[d]["roi"].shape[1:]),
            r["weighted_written_pitch"], r["macro_written_pitch"]), flush=True)
    report["resolution_sweep"] = sweep
    if section == "sweep":
        p = H.write_json("phase_g3_roi.json", report)
        print("wrote", p)
        return

    best = max(sweep, key=lambda k: sweep[k]["weighted_written_pitch"])
    bd = int(best.split("_")[0])
    b = Bundle(frozen, roi[bd])
    print(f"\n=== causal ablation (winner: {bd} px/space) ===", flush=True)
    g = torch.Generator().manual_seed(0)
    abl = {}
    cases = {
        "correct_roi": None,
        "blank_roi": lambda x: torch.zeros_like(x),
        "shuffled_roi": lambda x: x[torch.randperm(x.shape[0], generator=g)],
        "wrong_score_roi": lambda x: x[torch.randperm(x.shape[0], generator=g)],
        "reduced_resolution": lambda x: torch.nn.functional.interpolate(
            x, size=(max(1, x.shape[2] // 4), max(1, x.shape[3] // 4)),
            mode="bilinear", align_corners=False),
    }
    for name, fn in (cases.items() if section in ("all", "causal") else []):
        r = run(b, True, True, roi_transform=fn)
        abl[name] = r
        print("  %-20s weighted %.4f macro %.4f" % (
            name, r["weighted_written_pitch"], r["macro_written_pitch"]), flush=True)
    report["causal_ablation"] = abl
    report["winner_density_px_per_space"] = bd

    top = max(mat, key=lambda k: mat[k]["weighted_written_pitch"])
    report["best_arm"] = top
    report["best_weighted_written_pitch"] = mat[top]["weighted_written_pitch"]
    report["best_macro_written_pitch"] = mat[top]["macro_written_pitch"]
    report["G3_pass"] = bool(mat[top]["weighted_written_pitch"] >= 0.70)
    p = H.write_json("phase_g3_roi.json", report)
    print("\nG3:", "PASS" if report["G3_pass"] else "FAIL",
          "best", top, report["best_weighted_written_pitch"])
    print("wrote", p)


if __name__ == "__main__":
    main()
