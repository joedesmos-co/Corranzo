#!/usr/bin/env python3
"""Top-k pitch probe analysis (DEV only, frozen checkpoints, no training).

For F-clef notes: is the clef-correct reading present in the common probe's
top-3 pitch classes? Decides between decoder-side repair (top-k + oracle
clef, no training) and a clef-conditioned fine-tune.
Writes /tmp/pitch_topk.json + reports/pitch_topk_summary.json.
"""
from __future__ import annotations
import gzip
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import torch

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
sys.path.insert(0, str(HERE))
from infer import load_models, build_inputs  # noqa: E402

DEV_SIDS = json.loads((PILOT / "manifests" / "splits.json").read_text())["dev"]
RENDER = PILOT / "data" / "render"
EVENTS = TRAIN / "data" / "events"


def main():
    models = load_models()
    common, _ = models["common"]
    common.eval()
    agg = Counter()
    n_f = n_f_top1 = n_f_top3 = 0
    n_all = n_all_top3 = 0
    with torch.no_grad():
        for n, sid in enumerate(DEV_SIDS):
            evs = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
            meta = json.loads((RENDER / sid / "meta.json").read_text())
            items, X, S, G, _sk = build_inputs(sid, evs, meta, {})
            if not items:
                continue
            Xt = torch.from_numpy(X[:, None]).float() / 255
            St = torch.from_numpy(S[:, None]).float() / 255
            Gt = torch.from_numpy(G)
            logits = []
            for s in range(0, len(Xt), 1024):
                sl = slice(s, s + 1024)
                logits.append(common(Xt[sl], St[sl], Gt[sl])["pitch"])
            P = torch.softmax(torch.cat(logits), -1).numpy()
            top3 = np.argsort(-P, axis=1)[:, :3]
            by_id = {e["id"]: e for e in evs if e.get("id")}
            voc = json.loads((TRAIN / "manifests" / "v1_items.json").read_text())["vocab"]
            for i, it in enumerate(items):
                e = by_id.get(it["mei_id"])
                if e is None or e.get("kind") != "note":
                    continue
                tm = e.get("midi_printed")
                if tm is None:
                    continue
                pred_cls = int(np.argmax(P[i]))
                tcls = tm - 21
                n_all += 1
                n_all_top3 += (tcls in top3[i])
                cl = (e.get("clef") or {}).get("shape", "?")
                if cl == "F":
                    n_f += 1
                    n_f_top1 += (pred_cls == tcls)
                    n_f_top3 += (tcls in top3[i])
                    if pred_cls != tcls:
                        agg["F_err_top3_hit" if tcls in top3[i] else "F_err_top3_miss"] += 1
            if (n + 1) % 25 == 0:
                print(f"[topk] {n+1}/{len(DEV_SIDS)}", flush=True)
    out = {"n_all": n_all, "top3_all": n_all_top3,
           "rate_top3_all": round(n_all_top3 / max(1, n_all), 4),
           "n_F": n_f, "top1_F": n_f_top1,
           "rate_top1_F": round(n_f_top1 / max(1, n_f), 4),
           "top3_F": n_f_top3, "rate_top3_F": round(n_f_top3 / max(1, n_f), 4),
           "F_err_split": dict(agg)}
    Path(TRAIN / "reports" / "pitch_topk_summary.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
