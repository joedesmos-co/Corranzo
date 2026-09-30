"""Phase A3/A7 - the closed-form written-pitch predictor, and what caps it.

A0 established that the `accidental` target is a musical alteration derived from
the key signature (0 printed <accidental> elements in the paired MusicXML), and
that a pure key-signature rule reaches 0.8749 while the frozen head reaches
0.6874.

That raises the question the readout ablation could not answer, because its
oracles used TRUE labels. The closed form uses NO labels:

    d            = middle-line diatonic (34 upper / 22 lower) + round(2k)
    step_closed  = "CDEFGAB"[d mod 7]
    octave_closed= d // 7
    accidental_closed = key_alter(fifths, step_closed)

where `k` is the detector's own staff-relative position and `fifths` is the
FROZEN context head's key prediction (0.9804 accurate on production) - both
legitimate at inference.

If the closed form beats the trained readout, the readout has been discarding
information it was handed. If it does not, the 0.6494 is a genuine ceiling of
the detector geometry and the remaining loss is upstream.
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import phase_f_cache as CACHE  # noqa: E402
from phase_g5a_metrics import evaluate  # noqa: E402
import torch  # noqa: E402

LETTERS = "CDEFGAB"
SEMI = np.array([0, 2, 4, 5, 7, 9, 11])
MIDDLE = {"upper": 34, "lower": 22}
SHARP_ORDER = "FCGDAEB"
FLAT_ORDER = "BEADGCF"
CTX_KEY = slice(19, 34)          # context_staff key_fifths block, 15 classes


def key_alter_row(fifths):
    """Alteration the key signature applies to each step INDEX (0=C..6=B)."""
    f = int(fifths)
    if f > 0:
        k = SHARP_ORDER[:min(f, 7)]
    elif f < 0:
        k = FLAT_ORDER[:min(-f, 7)]
    else:
        k = ""
    out = np.zeros(7, np.int64)
    for i, ch in enumerate("CDEFGAB"):
        if ch in k:
            out[i] = 1 if f > 0 else -1
    return out


def main():
    d = CACHE.load()
    R, N = d["emb"].shape[0], d["emb"].shape[1]
    logits = torch.tensor(d["logits"].astype(np.float32))
    ev = evaluate(logits, d["target"], d["mask"], d["object_mask"])
    m = ev["m"]

    # NOTE: k is a float staff position. Casting it to an integer BEFORE
    # 2*k truncates it and silently destroys the sub-space precision this whole
    # calculation depends on (k=-3.0263 must not become -3).
    k = d["staff"][..., 0].astype(np.float64)
    is_up = d["staff"][..., 2] > 0.5
    d_idx = np.where(is_up, MIDDLE["upper"], MIDDLE["lower"]) + np.round(2 * k).astype(np.int64)
    step_cf = d_idx % 7
    oct_cf = d_idx // 7
    # frozen context head's key prediction (legitimate, 0.9804 on production)
    fifths = d["context_staff"][:, CTX_KEY].argmax(1) - 7

    t_step = d["target"][..., 1].astype(np.int64)
    t_oct = d["target"][..., 2].astype(np.int64)
    t_acc = d["target"][..., 3].astype(np.int64)

    rows = []
    per = {}
    for r in range(R):
        ka = key_alter_row(fifths[r])                    # (7,) per step index
        acc_cf = ka[step_cf[r]] + 3
        sel = m[r]
        n = int(sel.sum())
        if not n:
            continue
        s_ok = step_cf[r][sel] == t_step[r][sel]
        o_ok = oct_cf[r][sel] == t_oct[r][sel]
        a_ok = acc_cf[sel] == t_acc[r][sel]
        # predicted-step + closed-form accidental + closed-form octave
        a_rule_ok = (ka[t_step[r]] + 3)[sel] == t_acc[r][sel]
        acc = per.setdefault(str(d["score"][r]),
                             {"n": 0, "_s": 0, "_o": 0, "_a": 0, "_ar": 0,
                              "_so": 0, "_wp": 0, "engraving": str(d["engraving"][r])})
        acc["n"] += n
        for kk, vv in (("_s", s_ok), ("_o", o_ok), ("_a", a_ok),
                       ("_ar", a_rule_ok), ("_so", s_ok & o_ok),
                       ("_wp", s_ok & o_ok & a_ok)):
            acc[kk] = acc[kk] + int(vv.sum())
        _unused = {
            "n": n,
            "closed_form_step": round(float(s_ok.mean()), 4),
            "closed_form_octave": round(float(o_ok.mean()), 4),
            "closed_form_accidental": round(float(a_ok.mean()), 4),
            "key_rule_accidental_given_true_step": round(float(a_rule_ok.mean()), 4),
            "closed_form_written_pitch": round(float((s_ok & o_ok & a_ok).mean()), 4),
            "step_and_octave": round(float((s_ok & o_ok).mean()), 4),
        }
        rows.append((s_ok, o_ok, a_ok, a_rule_ok))
    S = np.concatenate([x[0] for x in rows])
    O = np.concatenate([x[1] for x in rows])
    A = np.concatenate([x[2] for x in rows])
    AR = np.concatenate([x[3] for x in rows])
    n = len(S)
    print("=== A3/A7 closed form on the SAME population (N=%d) ===" % n)
    print("  closed-form step            %.4f" % S.mean())
    print("  closed-form octave          %.4f" % O.mean())
    print("  closed-form accidental      %.4f" % A.mean())
    print("  key-rule accidental GIVEN TRUE step  %.4f" % AR.mean())
    print("  closed-form written pitch   %.4f" % (S & O & A).mean())
    print("  closed step AND octave      %.4f" % (S & O).mean())
    print()
    print("  reference: best trained readout (D_mlp_joint) written pitch 0.6494")
    print("             its P(step) 0.7591, P(octave) 0.9596, P(accidental) 0.7629")
    for s_, v in per.items():
        m_ = v["n"]
        v["closed_form_step"] = round(v.pop("_s") / m_, 4)
        v["closed_form_octave"] = round(v.pop("_o") / m_, 4)
        v["closed_form_accidental"] = round(v.pop("_a") / m_, 4)
        v["key_rule_accidental_given_true_step"] = round(v.pop("_ar") / m_, 4)
        v["step_and_octave"] = round(v.pop("_so") / m_, 4)
        v["closed_form_written_pitch"] = round(v.pop("_wp") / m_, 4)
    out = {
        "N": n,
        "macro_closed_form_written_pitch": round(
            float(np.mean([v["closed_form_written_pitch"] for v in per.values()])), 6),
        "by_engraving": {},
        "closed_form": {
            "step": round(float(S.mean()), 6),
            "octave": round(float(O.mean()), 6),
            "accidental": round(float(A.mean()), 6),
            "written_pitch": round(float((S & O & A).mean()), 6),
            "step_and_octave": round(float((S & O).mean()), 6),
            "key_rule_accidental_given_true_step": round(float(AR.mean()), 6)},
        "trained_readout_reference": {
            "written_pitch": 0.6494, "step": 0.7591, "octave": 0.9596,
            "accidental": 0.7629},
        "per_score": per}
    fam = {}
    for s_, v in per.items():
        fam.setdefault(v["engraving"], []).append(v["closed_form_written_pitch"])
    out["by_engraving"] = {k: {"mean": round(float(np.mean(x)), 4), "scores": len(x)}
                           for k, x in sorted(fam.items())}
    print("\n  macro over %d scores: %.4f"
          % (len(per), out["macro_closed_form_written_pitch"]))
    print("  by engraving:", out["by_engraving"])
    p = H.write_json("phase_a3_closed_form.json", out)
    print("\nwrote", p)


if __name__ == "__main__":
    main()
