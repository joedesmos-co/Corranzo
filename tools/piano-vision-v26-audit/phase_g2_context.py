"""Phase G2 - how much does legitimate frozen musical context add?

Only context the FROZEN champion already predicts is used: its own `context`
head outputs for clef / clef line / clef octave / key fifths, taken over the
scope's staff nodes. These are model predictions available at inference, never
ground truth, and Phase E measured them as near-perfect on production
(clef 1.0000, clef_line 1.0000, key_fifths 0.9804).

Arms, identical protocol, identical seed, leave-one-score-out:
  A  frozen embedding only
  B  A + staff role
  C  A + clef
  D  A + key signature
  E  A + all context
  F  A + staff-relative k (the Phase F arm, for reference)

The context is per-record and broadcast to that record's objects, so the
adapter's input width changes per arm; the parameter count is reported for each
so the comparison is not confounded by capacity.
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
import phase_f_gates as G  # noqa: E402
import v26_staff as S  # noqa: E402
from v26_adapter import ADAPTED_PITCH_HEADS, PITCH_HEAD_SIZES  # noqa: E402

CTX = {"clef": slice(0, 8), "clef_line": slice(8, 14),
       "clef_octave": slice(14, 19), "key_fifths": slice(19, 34)}
ARMS = {
    "A_embedding_only": [],
    "B_plus_staff_role": ["role"],
    "C_plus_clef": ["clef", "clef_line", "clef_octave"],
    "D_plus_key": ["key_fifths"],
    "E_plus_all_context": ["clef", "clef_line", "clef_octave", "key_fifths"],
    "F_plus_staff_k": ["role", "k"],
}


def build_extra(d, idx, parts):
    """Per-object extra columns for one arm, concatenated on the staff axis."""
    cols = [d["staff"][idx]]
    for p in parts:
        if p == "role":
            cols.append(d["staff"][idx][..., 2:3])
        elif p == "k":
            cols.append(d["staff"][idx][..., 0:2])
        else:
            cols.append(np.repeat(d["context_staff"][idx][:, None, CTX[p]],
                                  cols[0].shape[1], axis=1))
    return np.concatenate(cols, -1).astype(np.float32)


def run_arm(d, parts, epochs=60, width=256, seed=0):
    scores = sorted(set(d["score"].tolist()))
    idx_by = {s: np.where(d["score"] == s)[0] for s in scores}
    n_extra = build_extra(d, np.arange(len(d["score"])), parts).shape[-1]
    tot = defaultdict(int)
    per = {}
    for held in scores:
        tr = np.concatenate([idx_by[s] for s in scores if s != held])
        te = idx_by[held]
        # pass a FULL-LENGTH array; build_inputs_t indexes it like every other
        # input, so train and test see the same arm definition.
        Xfull = build_extra(d, np.arange(len(d["score"])), parts)
        ad = G.fit(d, tr, epochs=epochs, width=width, staff=Xfull, seed=seed,
                   n_features=int(Xfull.shape[-1]))
        r = G.evaluate(ad, d, te, staff=Xfull)
        per[held] = {"written_pitch": G.ratio(r["written_pitch"]),
                     "accidental": None, "engraving": str(d["engraving"][te[0]])}
        for k in ("written_pitch", "written_step", "octave", "midi"):
            tot[k] += r[k][0]; tot[k + "_n"] += r[k][1]
        # accidental head accuracy
        lg = G.head_slice(r["logits"], "pitch_accidental").argmax(-1)
        ta = torch.tensor(d["target"][te][..., 3])
        ma = torch.tensor(d["mask"][te][..., 3]) & torch.ones_like(lg, dtype=torch.bool)
        per[held]["accidental"] = round(float((lg == ta)[ma].float().mean()), 4)
    macro = float(np.mean([v["written_pitch"] for v in per.values()]))
    out = {
        "extra_columns": int(n_extra),
        "adapter_params": int(sum(p.numel() for p in G.new_adapter(
            False, width, 0, n_features=int(n_extra)).parameters())),
        "weighted_written_pitch": round(tot["written_pitch"] / tot["written_pitch_n"], 4),
        "macro_written_pitch": round(macro, 4),
        "weighted_written_step": round(tot["written_step"] / tot["written_step_n"], 4),
        "weighted_octave": round(tot["octave"] / tot["octave_n"], 4),
        "weighted_midi": round(tot["midi"] / tot["midi_n"], 4),
        "accidental_macro": round(float(np.mean([v["accidental"] for v in per.values()])), 4),
        "n_labels": tot["written_pitch_n"],
        "per_score": per}
    eng = defaultdict(list)
    for s, v in per.items():
        eng[v["engraving"]].append(v["written_pitch"])
    out["by_engraving"] = {k: round(float(np.mean(v)), 4) for k, v in sorted(eng.items())}
    return out


def main():
    d = CACHE.load()
    report = {"reference": {
        "frozen_champion_written_pitch": 0.1204,
        "detected_geometry_ceiling": 0.7484,
        "perfect_geometry_ceiling": 0.8054,
        "threshold": 0.70}}
    res = {}
    for name, parts in ARMS.items():
        out = run_arm(d, parts)
        res[name] = out
        print(f"{name:<24} pitch={out['weighted_written_pitch']} "
              f"macro={out['macro_written_pitch']} step={out['weighted_written_step']} "
              f"oct={out['weighted_octave']} acc={out['accidental_macro']} "
              f"midi={out['weighted_midi']} cols={out['extra_columns']} "
              f"params={out['adapter_params']}", flush=True)
    best = max(res, key=lambda k: res[k]["weighted_written_pitch"])
    report["arms"] = res
    report["best_arm"] = best
    report["best_weighted_written_pitch"] = res[best]["weighted_written_pitch"]
    report["G2_pass"] = bool(res[best]["weighted_written_pitch"] >= 0.70)
    p = H.write_json("phase_g2_context.json", report)
    print("\nbest:", best, res[best]["weighted_written_pitch"],
          "G2:", "PASS" if report["G2_pass"] else "FAIL")
    print("wrote", p)


if __name__ == "__main__":
    main()
