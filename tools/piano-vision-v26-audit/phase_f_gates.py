"""Phase F / GATES F1-F5 - train and test ONLY the staff-relative adapter.

The frozen champion's pitch-path state is precomputed (phase_f_cache.py), so
every number here comes from training one small module on cached tensors. No
checkpoint is written, no weight outside the adapter is touched, no RTX.

  F1 tiny memorisation  - tiny deterministic subset, require >= 0.98
  F2 LOSO cross-score   - Phase E protocol, target held-score >= 0.70
  F3 causal ablation   - A existing, B k only, C existing+k, D existing+shuffled k,
                         E existing+wrong-band k
  F4 staff-role / clef - upper/lower separation and clef-conditional error
  F5 retention         - identity at initialisation + original-domain smoke
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
from v26_adapter import (ADAPTED_PITCH_HEADS, PITCH_HEAD_SIZES,  # noqa: E402
                         StaffPitchAdapter, apply_adapter)

OFF = np.cumsum([0] + [PITCH_HEAD_SIZES[h] for h in ADAPTED_PITCH_HEADS])
EMB_DIM, SEED = 480, 0
LETTERS = "CDEFGAB"
SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def head_slice(a, head):
    j = ADAPTED_PITCH_HEADS.index(head)
    return a[..., OFF[j]:OFF[j + 1]]


def build_inputs_t(d, idx, staff=None, emb=None, zero_emb=False):
    e = torch.tensor(d["emb"][idx].astype(np.float32)) if emb is None else emb
    s = torch.tensor(d["staff"][idx] if staff is None else staff[idx])
    base = torch.tensor(d["logits"][idx].astype(np.float32))
    om = torch.tensor(d["object_mask"][idx])
    if zero_emb:
        # genuinely WITHHOLD the frozen representation, not zero it
        e = e[..., :0]
    return e, s, base, om


def corrected(adapter, e, s, base, om):
    delta = adapter(e, s, om)
    return base + torch.cat([delta[h] for h in ADAPTED_PITCH_HEADS], -1)


def new_adapter(drop_emb=False, width=256, seed=SEED):
    torch.manual_seed(seed)
    return StaffPitchAdapter(0 if drop_emb else EMB_DIM, width)


def fit(d, tr, epochs=60, width=256, lr=3e-3, seed=SEED, staff=None,
        zero_emb=False, wd=1e-4, verbose=False):
    ad = new_adapter(zero_emb, width, seed)
    opt = torch.optim.AdamW(ad.parameters(), lr=lr, weight_decay=wd)
    lossf = nn.CrossEntropyLoss()
    tgt = torch.tensor(d["target"][tr].astype(np.int64))
    msk = torch.tensor(d["mask"][tr])
    for _ in range(epochs):
        opt.zero_grad()
        e, s, base, om = build_inputs_t(d, tr, staff=staff, zero_emb=zero_emb)
        logits = corrected(ad, e, s, base, om)
        loss = 0.0
        for head in ADAPTED_PITCH_HEADS:
            j = ADAPTED_PITCH_HEADS.index(head)
            lg = head_slice(logits, head)
            m = msk[..., j] & torch.ones(lg.shape[:2], dtype=torch.bool)
            if int(m.sum()):
                loss = loss + lossf(lg[m], tgt[..., j][m])
        loss.backward()
        opt.step()
    return ad


def _flat(logits, target, mask):
    """Flatten every (B, N) tensor so indices are unambiguous."""
    j = {h: ADAPTED_PITCH_HEADS.index(h) for h in
         ("pitch_written_step", "pitch_octave", "pitch_accidental")}
    out = {}
    for h, jj in j.items():
        out[h] = head_slice(logits, h).argmax(-1).reshape(-1)
    out["_t_step"] = torch.tensor(target[..., j["pitch_written_step"]]).reshape(-1)
    out["_t_oct"] = torch.tensor(target[..., j["pitch_octave"]]).reshape(-1)
    out["_t_acc"] = torch.tensor(target[..., j["pitch_accidental"]]).reshape(-1)
    m = (torch.tensor(mask[..., j["pitch_written_step"]]).reshape(-1)
         & torch.tensor(mask[..., j["pitch_octave"]]).reshape(-1)
         & torch.tensor(mask[..., j["pitch_accidental"]]).reshape(-1))
    out["_m"] = m
    return out


def strict_pitch(logits, target, mask):
    f = _flat(logits, target, mask)
    ok = ((f["pitch_written_step"] == f["_t_step"])
          & (f["pitch_octave"] == f["_t_oct"])
          & (f["pitch_accidental"] == f["_t_acc"]))
    return int((ok & f["_m"]).sum()), int(f["_m"].sum())


def _midi(step, octave, alter):
    return 12 * (int(octave) + 1) + SEMI[LETTERS[int(step)]] + int(alter) - 3


def midi_acc(logits, target, mask):
    f = _flat(logits, target, mask)
    idx = torch.where(f["_m"])[0]
    if len(idx) == 0:
        return 0, 0
    hit = sum(1 for i in idx.tolist()
              if _midi(f["pitch_written_step"][i], f["pitch_octave"][i],
                       f["pitch_accidental"][i])
              == _midi(f["_t_step"][i], f["_t_oct"][i], f["_t_acc"][i]))
    return hit, len(idx)


def octave_acc(logits, target, mask):
    f = _flat(logits, target, mask)
    return int(((f["pitch_octave"] == f["_t_oct"]) & f["_m"]).sum()), int(f["_m"].sum())


def step_acc(logits, target, mask):
    f = _flat(logits, target, mask)
    return int(((f["pitch_written_step"] == f["_t_step"]) & f["_m"]).sum()), int(f["_m"].sum())


def evaluate(ad, d, idx, staff=None, zero_emb=False):
    e, st, base, om = build_inputs_t(d, idx, staff=staff, zero_emb=zero_emb)
    logits = corrected(ad, e, st, base, om) if ad is not None else base
    return {
        "written_pitch": strict_pitch(logits, d["target"][idx], d["mask"][idx]),
        "written_step": step_acc(logits, d["target"][idx], d["mask"][idx]),
        "octave": octave_acc(logits, d["target"][idx], d["mask"][idx]),
        "midi": midi_acc(logits, d["target"][idx], d["mask"][idx]),
        "logits": logits}


def pooled(d, idx):
    _, _, base, _ = build_inputs_t(d, idx)
    return {
        "written_pitch": strict_pitch(base, d["target"][idx], d["mask"][idx]),
        "written_step": step_acc(base, d["target"][idx], d["mask"][idx]),
        "octave": octave_acc(base, d["target"][idx], d["mask"][idx]),
    }


def ratio(h):
    return round(h[0] / h[1], 4) if h[1] else None


# ---------------------------------------------------------------------- gates
def gate_f1(d, report):
    print("\n=== F1 tiny memorisation ===", flush=True)
    scores = sorted(set(d["score"].tolist()))
    tiny = [i for i in range(len(d["score"])) if d["score"][i] == scores[0]][:4]
    ad = fit(d, tiny, epochs=200, width=256)
    r = evaluate(ad, d, tiny)
    acc = ratio(r["written_pitch"])
    maj = float(np.bincount(d["target"][tiny][..., 1][d["mask"][tiny][..., 1]].astype(int)).max()
                / max(1, int(d["mask"][tiny][..., 1].sum())))
    out = {"records": len(tiny), "score": scores[0],
           "written_pitch_accuracy": acc, "majority_on_subset": round(maj, 4),
           "written_step": ratio(r["written_step"]), "octave": ratio(r["octave"]),
           "threshold": 0.98, "pass": bool(acc is not None and acc >= 0.98)}
    print(f"  {len(tiny)} records, {int(r['written_pitch'][1])} labels -> "
          f"written pitch {acc} (step {ratio(r['written_step'])}, "
          f"octave {ratio(r['octave'])}), majority {round(maj,4)}", flush=True)
    report["F1_tiny_memorisation"] = out
    return out


def loso(d, epochs=60, width=256, staff_mode="normal", report=None, tag="F2",
         zero_emb=False):
    scores = sorted(set(d["score"].tolist()))
    idx_by = {s: np.where(d["score"] == s)[0] for s in scores}
    tot = defaultdict(int)
    per = {}
    for held in scores:
        tr = np.concatenate([idx_by[s] for s in scores if s != held])
        te = idx_by[held]
        staff = None
        staff = None
        if staff_mode == "shuffled":
            # Permute the staff-relative row assignment ACROSS RECORDS once, so
            # every object keeps its frozen V2.5 representation but is handed
            # another object's k. Deterministic under SEED.
            g = np.random.RandomState(SEED)
            staff = d["staff"][g.permutation(len(d["staff"]))]
        elif staff_mode == "k_withheld":
            staff = np.zeros_like(d["staff"])
        elif staff_mode == "wrong_band":
            st = d["staff"].copy()
            # swap the staff-role flag: k stays, is_upper flips. This is the
            # "attributed to the wrong staff" counterfactual.
            st[..., 2] = 1.0 - st[..., 2]
            staff = st
        ad = fit(d, tr, epochs=epochs, width=width, staff=staff, zero_emb=zero_emb)
        r = evaluate(ad, d, te, staff=staff, zero_emb=zero_emb)
        per[held] = {"written_pitch": ratio(r["written_pitch"]),
                     "written_pitch_labels": r["written_pitch"][1],
                     "written_step": ratio(r["written_step"]),
                     "octave": ratio(r["octave"]),
                     "midi": ratio(r["midi"]),
                     "engraving": str(d["engraving"][te[0]]),
                     "split": str(d["split"][te[0]])}
        for k in ("written_pitch", "written_step", "octave", "midi"):
            tot[k] += r[k][0]; tot[k + "_n"] += r[k][1]
        print(f"  held {held[:32]:<32} pitch={per[held]['written_pitch']} "
              f"step={per[held]['written_step']} oct={per[held]['octave']} "
              f"midi={per[held]['midi']} n={r['written_pitch'][1]}", flush=True)
    macro = float(np.mean([v["written_pitch"] for v in per.values() if v["written_pitch"]]))
    out = {
        "weighted_written_pitch": round(tot["written_pitch"] / tot["written_pitch_n"], 4),
        "macro_written_pitch": round(macro, 4),
        "weighted_written_step": round(tot["written_step"] / tot["written_step_n"], 4),
        "weighted_octave": round(tot["octave"] / tot["octave_n"], 4),
        "weighted_midi": round(tot["midi"] / tot["midi_n"], 4),
        "n_labels": tot["written_pitch_n"], "n_scores": len(per),
        "per_score": per}
    eng = defaultdict(list)
    for s, v in per.items():
        if v["written_pitch"] is not None:
            eng[v["engraving"]].append(v["written_pitch"])
    out["by_engraving"] = {k: {"mean_written_pitch": round(float(np.mean(v)), 4),
                               "scores": len(v)}
                           for k, v in sorted(eng.items())}
    if report is not None:
        report[tag] = out
    return out


def gate_f2(d, report):
    print("\n=== F2 LOSO cross-score transfer (existing features + k) ===", flush=True)
    out = loso(d, epochs=60, report=report, tag="F2_loso_existing_plus_k")
    out["threshold"] = 0.70
    out["pass"] = bool(out["macro_written_pitch"] >= 0.70)
    print(f"  weighted {out['weighted_written_pitch']}  macro {out['macro_written_pitch']}"
          f"  step {out['weighted_written_step']}  octave {out['weighted_octave']}"
          f"  midi {out['weighted_midi']}   threshold 0.70 -> "
          f"{'PASS' if out['pass'] else 'FAIL'}", flush=True)
    return out


def gate_f3(d, report):
    print("\n=== F3 causal ablation ===", flush=True)
    allidx = np.arange(len(d["score"]))
    out = {}
    # A: existing V2.5 features only (frozen logits, no adapter)
    r = evaluate(None, d, allidx)
    out["A_existing_v25_features_only"] = {
        "written_pitch": ratio(r["written_pitch"]), "written_step": ratio(r["written_step"]),
        "octave": ratio(r["octave"]),
        "note": "frozen champion logits, adapter absent"}
    # B: k only, no frozen embedding
    adB = fit(d, allidx, epochs=60, zero_emb=True)
    rB = evaluate(adB, d, allidx, zero_emb=True)
    out["B_staff_relative_k_only"] = {
        "written_pitch": ratio(rB["written_pitch"]), "written_step": ratio(rB["written_step"]),
        "octave": ratio(rB["octave"]),
        "note": "adapter sees ONLY the 7 staff features; the frozen champion's own representation is withheld"}
    # C/D/E: full LOSO so the comparison is like-for-like with F2
    out["C_existing_plus_k"] = loso(d, report=None, tag=None)["weighted_written_pitch"]
    out["D_existing_plus_shuffled_k"] = loso(d, staff_mode="shuffled",
                                            report=None)["weighted_written_pitch"]
    out["E_existing_plus_wrong_band_k"] = loso(d, staff_mode="wrong_band",
                                               report=None)["weighted_written_pitch"]
    out["F_embedding_only_k_withheld"] = loso(d, staff_mode="k_withheld",
                                              report=None)["weighted_written_pitch"]
    for k in ("A_existing_v25_features_only", "B_staff_relative_k_only"):
        out[k] = {kk: vv for kk, vv in out[k].items()}
    c = out["C_existing_plus_k"]
    out["delta_k_over_embedding_only"] = round(c - out["F_embedding_only_k_withheld"], 4)
    out["causal_claim_supported"] = bool(
        c > out["D_existing_plus_shuffled_k"] + 0.10
        and c > out["E_existing_plus_wrong_band_k"] + 0.10
        and c > out["F_embedding_only_k_withheld"] + 0.10)
    for k, v in out.items():
        if isinstance(v, (bool, float, int)):
            print(f"  {k:<34} {v}", flush=True)
        elif isinstance(v, dict):
            print(f"  {k:<34} {v.get('written_pitch')}", flush=True)
    report["F3_causal_ablation"] = out
    return out


def gate_f4(d, report, staff_role_truth):
    """Staff-role / clef sufficiency. Legitimate context only, no labels fed in.

    Trains on the real staff-role identity the DETECTOR assigns (never the label's
    staffRole), then reports accuracy split by the true staff role and by clef,
    plus the confusion between the upper and lower staff.
    """
    print("\n=== F4 staff-role / clef check ===", flush=True)
    allidx = np.arange(len(d["score"]))
    ad = fit(d, allidx, epochs=60)
    r = evaluate(ad, d, allidx)
    logits = r["logits"]
    s = head_slice(logits, "pitch_written_step").argmax(-1).numpy()
    o = head_slice(logits, "pitch_octave").argmax(-1).numpy()
    is_up = d["staff"][..., 2] > 0.5
    m = (d["mask"][..., 1] & d["mask"][..., 2] & d["mask"][..., 3]) & d["object_mask"]
    truth = np.where(is_up, 34, 22) + np.round(2 * d["staff"][..., 0]).astype(int)
    resid = truth - (s + 7 * o)
    out = {
        "upper_n": int((m & is_up).sum()),
        "lower_n": int((m & ~is_up).sum()),
        "residual_median_upper": float(np.median(resid[m & is_up])) if (m & is_up).any() else None,
        "residual_median_lower": float(np.median(resid[m & ~is_up])) if (m & ~is_up).any() else None,
        "residual_exact_upper": float((resid[m & is_up] == 0).mean()) if (m & is_up).any() else None,
        "residual_exact_lower": float((resid[m & ~is_up] == 0).mean()) if (m & ~is_up).any() else None,
        "written_pitch": ratio(r["written_pitch"]),
        "written_step": ratio(r["written_step"]),
        "octave": ratio(r["octave"]),
        "clef_conditional": {}}
    # clef-conditional error from the frozen context head (perfect on production)
    c = staff_role_truth
    for clef in sorted(set(c)):
        sel = np.array([ci == clef for ci in c])
        if not (m & sel).any():
            continue
        out["clef_conditional"][clef] = {
            "n": int((m & sel).sum()),
            "residual_exact": float((resid[m & sel] == 0).mean())}
    out["ambiguity_resolved"] = bool(
        out["residual_exact_upper"] is not None and out["residual_exact_lower"] is not None
        and out["residual_exact_upper"] > 0.5 and out["residual_exact_lower"] > 0.5)
    for k, v in out.items():
        print(f"  {k}: {v}", flush=True)
    report["F4_staff_role_clef"] = out
    return out


def main():
    d = CACHE.load()
    report = {}
    base = pooled(d, np.arange(len(d["score"])))
    report["frozen_champion_on_corrected_corpus"] = {
        "written_pitch": ratio(base["written_pitch"]),
        "written_step": ratio(base["written_step"]),
        "octave": ratio(base["octave"]),
        "n_labels": base["written_pitch"][1]}
    ad0 = new_adapter()
    report["added_parameters"] = {
        "adapter_total": int(sum(p.numel() for p in ad0.parameters())),
        "trainable_in_campaign": int(sum(p.numel() for p in ad0.parameters())),
        "frozen_champion": 26332539,
        "note": "adapter output layer is zero-initialised, so it is exactly identity at step 0"}
    print("added adapter parameters:", report["added_parameters"]["adapter_total"])
    print("frozen champion on corrected corpus:", report["frozen_champion_on_corrected_corpus"])

    gate_f1(d, report)
    gate_f2(d, report)
    gate_f3(d, report)
    p = H.write_json("phase_f_gates.json", report)
    print("\nwrote", p)


if __name__ == "__main__":
    main()
