#!/usr/bin/env python3
"""Full-campaign DEV evaluation: families, rare classes, minority durations,
relationships (membership P/R), score-level reconstruction, inference controls.

Loads best checkpoints (common/membership/context), evaluates on dev20 items
+ full DEV reconstruction from canonical events. No TEST. Saves
manifests/full_eval.json.
"""
from __future__ import annotations
import gzip
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import torch

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
EVENTS = TRAIN / "data" / "events"
sys.path.insert(0, str(HERE))
from v1_probe import LocalModel, ContextModel, HEADS_BIN  # noqa: E402

HEADS_CAT = ["kind", "pitch", "dur", "dots", "staff", "acc", "voice"]


def load_split(name):
    raw = json.loads((PILOT / "manifests" / "splits.json").read_text())
    out = list(raw[name])
    del raw
    return out


def predict_all(ckpt_path, subset="dev20"):
    ckpt = torch.load(ckpt_path, map_location="cpu")
    is_context = "context" in ckpt_path.name
    model_cls = ContextModel if is_context else LocalModel
    model = model_cls(ckpt["sizes"])
    model.load_state_dict(ckpt["state"])
    model.eval()
    d = np.load(TRAIN / "data" / f"v1_{subset}.npz")
    meta = json.load(open(TRAIN / "manifests" / f"v1_items_{subset}_meta.json"))
    X = torch.from_numpy(d["X"][:, None]).float() / 255
    S = torch.from_numpy(d["S"]).float() / 255 if "S" in d else None
    if S is None:
        import cv2
        from v1_probe import page_png
        S = np.zeros((len(X), 1, 24, 128), np.float32)
        for j, mi in enumerate(meta):
            img = page_png(mi["sid"], mi["page"])
            y0, y1 = max(0, mi["strip_y0"]), min(img.shape[0], mi["strip_y1"])
            band = np.full((max(1, y1 - y0), img.shape[1]), 255, np.uint8)
            band[: max(0, y1 - y0), :] = img[y0:y1, :]
            S[j, 0] = cv2.resize(band, (128, 24), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
        S = torch.from_numpy(S)
    G = torch.from_numpy(d["G"])
    out = {}
    with torch.no_grad():
        for start in range(0, len(X), 1024):
            sl = slice(start, start + 1024)
            logits = model(X[sl], S[sl], G[sl])
            for h, lg in logits.items():
                out.setdefault(h, []).append(lg.argmax(-1).numpy())
    return {h: np.concatenate(v) for h, v in out.items()}, meta


def main():
    out = {"schema": "piano-full-eval/1", "families": {}, "rare": {},
           "minority_duration": {}, "relationships": {}, "reconstruction": {},
           "controls": {}}
    # --- per-head accuracy + P/R on dev20 ---
    for probe, ckpt in (("common", "full_common_normal_best"),
                        ("membership", "full_membership_normal_best"),
                        ("context", "full_context_normal_best")):
        p = TRAIN / "models" / f"{ckpt}.pt"
        if not p.is_file():
            out["families"][probe] = {"error": "missing checkpoint"}
            continue
        pred, meta = predict_all(p)
        d = np.load(TRAIN / "data" / "v1_dev20.npz")
        fam = {}
        for h in pred:
            y, m = d[f"y_{h}"], d[f"m_{h}"] > 0.5
            acc = float((pred[h][m] == y[m]).mean()) if m.sum() else float("nan")
            fam[h] = {"acc": round(acc, 4), "n": int(m.sum())}
            if h in HEADS_BIN or h in ("grace", "cue"):
                pos = (y == 1) & m
                tp = int(((pred[h] == 1) & pos).sum())
                fp = int(((pred[h] == 1) & m & (y == 0)).sum())
                fam[h]["precision"] = round(tp / max(1, tp + fp), 4)
                fam[h]["recall"] = round(tp / max(1, int(pos.sum())), 4)
                fam[h]["support"] = int(pos.sum())
        out["families"][probe] = fam

    # --- minority duration collapse (common probe pitch-style per-class) ---
    d = np.load(TRAIN / "data" / "v1_dev20.npz")
    p = TRAIN / "models" / "full_common_normal_best.pt"
    if p.is_file():
        pred, _ = predict_all(p)
        voc = json.loads((TRAIN / "manifests" / "v1_items.json").read_text())["vocab"]["dur"]
        y, m = d["y_dur"], d["m_dur"] > 0.5
        for di, dsym in enumerate(voc):
            mm = (y == di) & m
            if mm.sum():
                out["minority_duration"][dsym] = {
                    "acc": round(float((pred["dur"][mm] == di).mean()), 4),
                    "n": int(mm.sum())}

    # --- score-level reconstruction on full DEV (canonical events + predictions) ---
    dev_ids = set(load_split("dev"))
    ckpt = TRAIN / "models" / "full_common_normal_best.pt"
    if ckpt.is_file():
        pred, meta = predict_all(ckpt)
        # map meta rows -> predictions
        by_score = defaultdict(list)
        for j, mi in enumerate(meta):
            by_score[mi["sid"]].append(j)
        d = np.load(TRAIN / "data" / "v1_dev20.npz")
        recs, joint_ok, joint_n, per_score = [], 0, 0, []
        for sid in sorted(dev_ids):
            evs = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
            notes = [e for e in evs if e["kind"] == "note"]
            idx = [j for j, mi in enumerate(meta) if mi["sid"] == sid]
            if not idx:
                continue
            ok_pitch = ok_joint = tot = 0
            for j in idx:
                mi = meta[j]
                e = next(x for x in evs if x.get("id") == mi["mei_id"])
                if e["kind"] != "note":
                    continue
                tot += 1
                p_ok = pred["pitch"][j] == d["y_pitch"][j]
                d_ok = pred["dur"][j] == d["y_dur"][j]
                s_ok = pred["staff"][j] == d["y_staff"][j]
                v_ok = pred["voice"][j] == d["y_voice"][j]
                ok_pitch += p_ok
                if p_ok and d_ok and s_ok and v_ok:
                    ok_joint += 1
            joint_ok += ok_joint
            joint_n += tot
            per_score.append(round(ok_joint / max(1, tot), 4))
        out["reconstruction"] = {
            "joint_pitch_dur_staff_voice_exact": round(joint_ok / max(1, joint_n), 4),
            "notes": joint_n,
            "per_score_mean": round(float(np.mean(per_score)), 4) if per_score else None,
            "per_score_min": round(float(np.min(per_score)), 4) if per_score else None,
            "note": "per-note attribute sequences in source order; NOT sheet-music equivalence",
        }

    # --- inference controls on DEV: blank + wrong-page ---
    ckpt = TRAIN / "models" / "full_common_normal_best.pt"
    if ckpt.is_file():
        import torch as _t  # noqa
        ck = _t.load(ckpt, map_location="cpu")
        from v1_probe import LocalModel as _LM
        sizes = ckpt and None
        man = json.loads((TRAIN / "manifests" / "v1_items.json").read_text())["vocab"]
        sizes = {"kind": 2, "pitch": 88, "dur": len(man["dur"]), "dots": 4,
                 "staff": len(man["staff"]), "acc": len(man["acc"]), "grace": 2,
                 "cue": 2, "voice": len(man["voice"])}
        model = _LM(sizes)
        model.load_state_dict(ck["state"])
        model.eval()
        d = np.load(TRAIN / "data" / "v1_dev20.npz")
        X = torch.from_numpy(d["X"][:, None]).float() / 255
        S = torch.zeros(len(X), 1, 24, 128)  # LocalModel ignores strips/geometry inputs
        G = torch.from_numpy(d["G"])
        Y = {h: torch.from_numpy(d[f"y_{h}"]) for h in ("pitch", "dur", "kind")}
        M = {h: torch.from_numpy(d[f"m_{h}"]).float() for h in ("pitch", "dur", "kind")}
        with torch.no_grad():
            blank = model(torch.zeros_like(X), torch.zeros_like(S), G)
            perm = np.random.RandomState(7).permutation(len(X))
            wrong = model(X[perm], S[perm], G[perm])
            for name, lg in (("blank", blank), ("wrong_page", wrong)):
                row = {}
                for h in ("pitch", "dur", "kind"):
                    idx = (M[h] > 0.5)
                    row[h] = round(float((lg[h].argmax(-1)[idx] == Y[h][idx]).float().mean()), 4) \
                        if idx.sum() else None
                out["controls"][name] = row
    (TRAIN / "manifests" / "full_eval.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({k: v for k, v in out.items() if k != "families"}, indent=1)[:1200])


if __name__ == "__main__":
    main()
