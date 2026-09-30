"""Phase G5A/B - metric identity and component error intersection.

This runs BEFORE any readout training. The reported triplet

    step ~0.754, octave ~0.962, joint written pitch ~0.614

cannot be reconciled by eye, so the metrics are pinned down exactly and the
identity is unit-tested. If step and octave are scored on the SAME population
and "joint" means the literal intersection of their correctness, then

    P(step AND octave) >= P(step) + P(octave) - 1

For the reported numbers that bound is 0.754 + 0.962 - 1 = 0.716. A joint of
0.614 is only legitimate if written pitch also requires a THIRD component. This
script proves which, by direct counting, and locks the definition in a test so
it cannot silently drift.

Everything is evaluated on the FROZEN representation, the same committed cache
used by every readout experiment in this phase. No training, no images.
"""
from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import phase_f_cache as CACHE  # noqa: E402

LETTERS = "CDEFGAB"
SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
MIDDLE = {"upper": 34, "lower": 22}

# --------------------------------------------------------------- definitions
METRIC_DEFS = {
    "written_step": {
        "target_field": "targets.object.pitch_written_step",
        "class_vocabulary": "CDEFGAB -> 0..6 (piano_vision/data.py WRITTEN_STEPS)",
        "population": "objects whose written_step, octave AND accidental masks "
                      "are ALL true (the shared `_m`), intersected with object_mask",
        "masking": "m_step & m_oct & m_acc & object_mask",
        "predicate": "argmax(pitch_written_step logits) == target",
        "includes_accidental": False},
    "octave": {
        "target_field": "targets.object.pitch_octave",
        "class_vocabulary": "0..10 (clamped)",
        "population": "IDENTICAL to written_step (same `_m`)",
        "masking": "m_step & m_oct & m_acc & object_mask",
        "predicate": "argmax(pitch_octave logits) == target",
        "includes_accidental": False},
    "accidental": {
        "target_field": "targets.object.pitch_accidental",
        "class_vocabulary": "alter - 3, clamped to 0..6 (7 classes)",
        "population": "IDENTICAL to written_step (same `_m`)",
        "masking": "m_step & m_oct & m_acc & object_mask",
        "predicate": "argmax(pitch_accidental logits) == target",
        "includes_accidental": True},
    "written_pitch_joint": {
        "target_field": "the same three targets, simultaneously",
        "class_vocabulary": "n/a - a conjunction, not a classifier",
        "population": "IDENTICAL to written_step (same `_m`)",
        "masking": "m_step & m_oct & m_acc & object_mask",
        "predicate": "step_correct AND octave_correct AND accidental_correct",
        "includes_accidental": True,
        "note": "This is the campaign's canonical `written_pitch_accuracy`: "
                "the per-object conjunction of (step, octave, accidental)."},
    "derived_midi": {
        "target_field": "same three targets, mapped to MIDI",
        "population": "IDENTICAL to written_step",
        "predicate": "midi(pred_step,pred_oct,pred_acc-3) == "
                     "midi(true_step,true_oct,true_acc-3)",
        "includes_accidental": True},
    "closed_form_staff_position": {
        "target_field": "NOT a model metric. A closed form applied to the "
                        "DETECTED geometry: k = (bandCentreY - cy)/staffGap, "
                        "band chosen by nearest centre, middle-line diatonic "
                        "index = 34 (upper, G2) or 22 (lower, F4), plus round(2k).",
        "population": "every PITCH_STAFF label in corpus 2.1 with a stepsFromBandCenter "
                      "and a writtenPitch",
        "predicate": "diatonic_index(formula) == diatonic_index(MusicXML writtenPitch)",
        "includes_accidental": False,
        "warning": "This measures a LETTER+REGISTER match derived from staff "
                   "geometry. It is NOT written pitch: it never tests an "
                   "accidental. It must not be cited as a written-pitch target."},
}


def evaluate(logits, target, mask, object_mask):
    """Per-object component correctness on the SHARED population."""
    from v26_adapter import ADAPTED_PITCH_HEADS, PITCH_HEAD_SIZES
    off = np.cumsum([0] + [PITCH_HEAD_SIZES[h] for h in ADAPTED_PITCH_HEADS])
    j = ADAPTED_PITCH_HEADS.index

    def pred(head):
        lg = logits[..., off[j(head)]:off[j(head) + 1]]
        return lg.argmax(-1).numpy()

    p_step, p_oct, p_acc = (pred("pitch_written_step"), pred("pitch_octave"),
                            pred("pitch_accidental"))
    t_step = target[..., j("pitch_written_step")].astype(int)  # (R,N)
    t_oct = target[..., j("pitch_octave")].astype(int)
    t_acc = target[..., j("pitch_accidental")].astype(int)
    # cache layout is (records, objects, heads) -> select the head on the LAST axis
    m = (mask[..., j("pitch_written_step")] & mask[..., j("pitch_octave")]
         & mask[..., j("pitch_accidental")]) & object_mask
    c_step = (p_step == t_step) & m
    c_oct = (p_oct == t_oct) & m
    c_acc = (p_acc == t_acc) & m
    SEMI_ARR = np.array([SEMI[c] for c in LETTERS])
    pm = 12 * (p_oct + 1) + SEMI_ARR[p_step] + p_acc - 3
    tm = 12 * (t_oct + 1) + SEMI_ARR[t_step] + t_acc - 3
    c_midi = (pm == tm) & m
    return {"step": c_step, "oct": c_oct, "acc": c_acc, "midi": c_midi, "m": m,
            "p_step": p_step, "p_oct": p_oct, "p_acc": p_acc,
            "t_step": t_step, "t_oct": t_oct, "t_acc": t_acc}


def identity_check(ev):
    """The G5A identity, callable on ANY readout's component predictions."""
    m = ev["m"]
    N = int(m.sum())
    P = {k: float(ev[k][m].mean()) for k in ("step", "oct", "acc", "midi")}
    bound = P["step"] + P["oct"] - 1.0
    joint_so = float((ev["step"] & ev["oct"] & m).sum() / N)
    joint_all = float((ev["step"] & ev["oct"] & ev["acc"] & m).sum() / N)
    return {
        "N_shared_population": N,
        "P_step": round(P["step"], 6), "P_octave": round(P["oct"], 6),
        "P_accidental": round(P["acc"], 6), "P_midi": round(P["midi"], 6),
        "P_step_and_octave": round(joint_so, 6),
        "P_step_and_octave_and_accidental": round(joint_all, 6),
        "Frechet_lower_bound_on_step_and_octave": round(bound, 6),
        "bound_respected": bool(joint_so >= bound - 1e-9),
        "accidental_cost_given_step_and_octave": round(joint_so - joint_all, 6),
        "written_pitch_equals_triple_intersection": True,
        "note": ("written_pitch is by construction the intersection of all three "
                 "components on one shared population, so it is EXPECTED to sit "
                 "below the two-component Frechet bound. The bound constrains "
                 "P(step AND octave), and that is what is tested."),
    }


def intersection_table(ev, keys):
    m = ev["m"]
    N = int(m.sum())
    out = {}
    import itertools
    for bits in itertools.product((1, 0), repeat=len(keys)):
        sel = m.copy()
        for k, b in zip(keys, bits):
            sel = sel & ev[k] if b else sel & ~ev[k]
        n = int(sel.sum())
        out["_".join(f"{k}={'T' if b else 'F'}" for k, b in zip(keys, bits))] = \
            {"n": n, "pct": round(n / N, 6)}
    return out


def main():
    d = CACHE.load()
    frozen_sha = hashlib.sha256(
        (H.V26_ROOT / "out/phase_f_cache.npz").read_bytes()).hexdigest()
    logits = torch.tensor(d["logits"].astype(np.float32))
    ev = evaluate(logits, d["target"], d["mask"], d["object_mask"])
    m = ev["m"]
    N = int(m.sum())
    P = {k: float(ev[k][m].mean()) for k in ("step", "oct", "acc", "midi")}

    # ---- G5A: the probability bound -------------------------------------
    bound = P["step"] + P["oct"] - 1.0
    joint_so = float((ev["step"] & ev["oct"] & m).sum() / N)
    joint_all = float((ev["step"] & ev["oct"] & ev["acc"] & m).sum() / N)
    identity = {
        "N_shared_population": N,
        "P_step": round(P["step"], 6), "P_octave": round(P["oct"], 6),
        "P_accidental": round(P["acc"], 6),
        "P_step_and_octave": round(joint_so, 6),
        "P_step_and_octave_and_accidental": round(joint_all, 6),
        "Frechet_lower_bound_on_step_and_octave": round(bound, 6),
        "bound_respected": bool(joint_so >= bound - 1e-9),
        "written_pitch_below_step_octave_bound": bool(joint_all < bound),
        "resolution": ("written_pitch requires a THIRD component (accidental), so "
                       "it is expected to sit below the two-component bound. The "
                       "bound is tested against P(step AND octave), which is the "
                       "only quantity the bound actually constrains."),
        "cost_of_accidental_given_step_and_octave": round(joint_so - joint_all, 6),
    }

    # ---- G5B: the intersection table ------------------------------------
    cells = {}
    for cs, co, ca in ((1, 1, 1), (1, 1, 0), (1, 0, 1), (1, 0, 0),
                       (0, 1, 1), (0, 1, 0), (0, 0, 1), (0, 0, 0)):
        sel = m.copy()
        sel = sel & ev["step"] if cs else sel & ~ev["step"]
        sel = sel & ev["oct"] if co else sel & ~ev["oct"]
        sel = sel & ev["acc"] if ca else sel & ~ev["acc"]
        n = int(sel.sum())
        cells[f"step={'T' if cs else 'F'}_oct={'T' if co else 'F'}"
               f"_acc={'T' if ca else 'F'}"] = {"n": n, "pct": round(n / N, 6)}
    two = {}
    for cs, co in ((1, 1), (1, 0), (0, 1), (0, 0)):
        sel = m.copy()
        sel = sel & ev["step"] if cs else sel & ~ev["step"]
        sel = sel & ev["oct"] if co else sel & ~ev["oct"]
        two[f"step={'T' if cs else 'F'}_oct={'T' if co else 'F'}"] = \
            {"n": int(sel.sum()), "pct": round(int(sel.sum()) / N, 6)}

    # per-score and family
    per = {}
    score_per_record = d["score"]
    for r, s in enumerate(score_per_record.tolist()):
        sel = m[r]
        n = int(sel.sum())
        if not n:
            continue
        per[s] = {
            "n": n,
            "step": round(float(ev["step"][r][sel].mean()), 4),
            "octave": round(float(ev["oct"][r][sel].mean()), 4),
            "accidental": round(float(ev["acc"][r][sel].mean()), 4),
            "step_and_octave": round(float((ev["step"] & ev["oct"])[r][sel].mean()), 4),
            "written_pitch": round(float(
                (ev["step"] & ev["oct"] & ev["acc"])[r][sel].mean()), 4),
            "midi": round(float(ev["midi"][r][sel].mean()), 4),
            "engraving": str(d["engraving"][r])}

    out = {
        "frozen_representation": {
            "cache": "out/phase_f_cache.npz", "sha256": frozen_sha,
            "records": int(d["emb"].shape[0]),
            "embedding_dim": int(d["emb"].shape[2]),
            "note": "unchanged for every readout experiment in Phase G5"},
        "metric_definitions": METRIC_DEFS,
        "G5A_identity": identity,
        "G5B_intersection_step_octave": two,
        "G5B_intersection_step_octave_accidental": cells,
        "per_score": per,
    }
    p = H.write_json("phase_g5a_metrics.json", out)
    print("=== G5A metric identity ===")
    print(f"  shared population N = {N}")
    print(f"  P(step)                = {identity['P_step']:.4f}")
    print(f"  P(octave)              = {identity['P_octave']:.4f}")
    print(f"  P(accidental)          = {identity['P_accidental']:.4f}")
    print(f"  P(step AND octave)     = {joint_so:.4f}")
    print(f"  Frechet bound >=       = {bound:.4f}   "
          f"-> {'RESPECTED' if identity['bound_respected'] else 'VIOLATED'}")
    print(f"  P(step AND oct AND acc)= {joint_all:.4f}  (= reported written pitch)")
    print(f"  accidental costs       = {identity['cost_of_accidental_given_step_and_octave']:.4f}")
    print()
    print("=== G5B intersection (step x octave) ===")
    for k, v in two.items():
        print(f"  {k:<16} n={v['n']:<6} {v['pct']:.4f}")
    print()
    print("=== G5B intersection (step x octave x accidental) ===")
    for k, v in cells.items():
        print(f"  {k:<24} n={v['n']:<6} {v['pct']:.4f}")
    print("\nwrote", p)


if __name__ == "__main__":
    main()
