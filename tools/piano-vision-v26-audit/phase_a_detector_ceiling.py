"""Phase A / P10 (revised): empirical ceilings, and a negative result worth keeping.

NEGATIVE RESULT, RECORDED DELIBERATELY
-------------------------------------
A closed-form detector ceiling was attempted by comparing each label's
`staffPosition.stepsFromBandCenter` (a geometric quantity from production
staff_bands/staff_space) against the diatonic position implied by that same
label's `writtenPitch` + `clefContext`.

It FAILS ITS OWN CONTROL. Run on the SOURCE corpus - where the champion scores
0.9879 on this very head - the comparison returns 0.061 exact agreement. A
ceiling that sits far below the model's own accuracy on the domain where the
model is near-perfect is measuring label convention, not detector quality. The
attempt is discarded rather than reported. `stepsFromBandCenter` is documented
in the campaign README as corpus-specific and "expected to move as the
representation re-registers", which is consistent with this.

WHAT IS REPORTED INSTEAD
------------------------
1. PROPOSAL RECALL - the fraction of MusicXML truth events the production
   detector actually explains, read from the corpus alignment itself.
2. EMPIRICAL REPRESENTATION CEILING - a high-capacity probe trained on
   production features and tested on held-out PRODUCTION SCORES, for the
   targets the product actually cares about. This is the honest upper bound on
   what any head sitting on the current source-only representation can reach,
   and therefore the number the architecture must be judged against.
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import torch
from torch import nn

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import phase_a_probe as P  # noqa: E402

H.add_runtime_to_path()


# ---------------------------------------------------------------- 1
def proposal_recall(split="validation"):
    sys.path.insert(0, str(H.V26_ROOT / "tools/real-pdf-adaptation"))
    from realpdf_data import load_realpdf_records
    index = json.loads(H.REALPDF_INDEX.read_text())
    cov = json.loads((H.REALPDF_ROOT / "coverage.json").read_text())
    per = {}
    for c in cov["scores"]:
        if c.get("split") != split:
            continue
        s = c.get("score_id", "")
        det = c.get("objects_total")
        mat = c.get("objects_labelled_pitch")
        per[s] = {"objects_total": det, "objects_labelled_pitch": mat,
                  "true_printed_events": c.get("true_printed_events"),
                  "note_recall_of_detected": c.get("note_recall_of_detected"),
                  "binding_rate": round(mat / det, 4) if det else None}
    tot_d = sum(v["objects_total"] or 0 for v in per.values())
    tot_m = sum(v["objects_labelled_pitch"] or 0 for v in per.values())
    return {"split": split, "per_score": per,
            "pooled_binding_rate": round(tot_m / tot_d, 4) if tot_d else None,
            "objects_total": tot_d, "objects_bound_to_truth": tot_m,
            "note": ("objects the aligner could bind to MusicXML truth / objects the "
                     "raster detector emitted; an upper bound on evaluable pitch, not "
                     "on detection recall of unlabelled objects")}


# ---------------------------------------------------------------- 2
class Big(nn.Module):
    def __init__(self, d, n_out, w=256):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(d, w), nn.GELU(), nn.Linear(w, w), nn.GELU(),
                                 nn.Linear(w, w), nn.GELU(), nn.Linear(w, n_out))

    def forward(self, x):
        return self.net(x)


def representation_ceiling(Xp, Yp, meta, epochs=1200, seed=0):
    """Leave-one-SCORE-out CV, trained on production, tested on production.

    Every object is held out exactly once, and the split is by score, so the
    number reflects generalisation to unseen engraving rather than to unseen
    objects inside a score the probe memorised.
    """
    out = {}
    for target in ("staff_step", "written_step", "octave"):
        y = np.array([t[target][0] for t in Yp])
        m = np.array([bool(t[target][1]) for t in Yp]) & (y >= 0)
        X, yy = Xp[m], y[m]
        sc = np.array([mm[0] for mm in meta])[m]
        scores = sorted(set(sc.tolist()))
        if len(scores) < 2:
            continue
        n_out = max(int(yy.max()) + 1, 35)
        hit = tot = 0
        folds = []
        for held in scores:
            te = sc == held
            tr = ~te
            if tr.sum() < 30 or te.sum() < 5:
                continue
            mu, sd = X[tr].mean(0), X[tr].std(0) + 1e-6
            A = torch.tensor((X[tr] - mu) / sd, dtype=torch.float32)
            At = torch.tensor(yy[tr], dtype=torch.long)
            B = torch.tensor((X[te] - mu) / sd, dtype=torch.float32)
            Bt = torch.tensor(yy[te], dtype=torch.long)
            torch.manual_seed(seed)
            net = Big(A.shape[1], n_out)
            opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-3)
            lossf = nn.CrossEntropyLoss(label_smoothing=0.05)
            net.train()
            for _ in range(epochs):
                opt.zero_grad()
                lossf(net(A), At).backward()
                opt.step()
            net.eval()
            with torch.no_grad():
                h = int((net(B).argmax(-1) == Bt).sum())
                t = int(len(Bt))
            hit += h
            tot += t
            folds.append({"held_out_score": held, "correct": h, "n": t,
                          "acc": round(h / t, 4) if t else None,
                          "majority": round(float(np.bincount(yy[te]).max() / t), 4) if t else None})
        if not tot:
            continue
        maj = float(np.bincount(yy).max() / len(yy))
        out[target] = {
            "loso_accuracy": round(hit / tot, 4),
            "pooled_majority_baseline": round(maj, 4),
            "n_objects": tot, "n_scores": len(scores), "folds": folds}
        print(f"  {target:<12} LOSO={hit/tot:.4f}  (pooled majority {maj:.4f}, "
              f"n={tot}, {len(scores)} scores)", flush=True)
        for f in folds:
            print(f"      held {f['held_out_score'][:30]:<32} {f['acc']}  (maj {f['majority']}, n={f['n']})")
    return out


def main():
    out = {}
    for s in ("validation", "heldout-test", "adaptation"):
        r = proposal_recall(s)
        out[f"proposal_recall_{s}"] = r
        print(f"binding rate [{s}]: {r['pooled_binding_rate']} "
              f"({r['objects_bound_to_truth']}/{r['objects_total']})")
    print("\nrepresentation ceiling (production-trained, held-out SCORE):")
    rt = H.load_runtime("cpu")
    P.CURRENT = rt.config
    Xp, Yp, meta = P.extract_merged_with_meta(
        H.realpdf_scores("validation"), H.realpdf_resolver, 25, 6000)
    out["representation_ceiling_validation"] = representation_ceiling(Xp, Yp, meta)
    Xa, Ya, ma = P.extract_merged_with_meta(
        H.realpdf_scores("adaptation"), H.realpdf_resolver, 40, 8000)
    Xall = np.concatenate([Xp, Xa], 0)
    Yall = list(Yp) + list(Ya)
    mall = list(meta) + list(ma)
    out["representation_ceiling_validation_plus_adaptation"] = representation_ceiling(
        Xall, Yall, mall)
    path = H.write_json("phase_a_ceilings.json", out)
    print("\nwrote", path)


if __name__ == "__main__":
    main()
