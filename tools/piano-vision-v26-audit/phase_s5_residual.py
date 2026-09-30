"""Phase S5-S9 - structured decoding + residual correction, and its causal test.

S4 showed the closed form's diatonic residual is ALWAYS in {-1, 0, +1}. So the
model never has to re-derive the pitch class: it predicts a 3-class correction
on top of a deterministic decoder. That is a fundamentally easier and much
smaller problem than the absolute-pitch readouts already falsified.

Arms, all sharing the SAME frozen representation and the SAME decoder base:
  A  closed form only                     0 learned parameters
  B  + linear residual
  C  + small MLP residual
  D  + frozen embedding residual
  E  + frozen embedding + legitimate context residual

S9 structure ablation, to prove the gain comes from the structured base:
  geometry + residual   vs   geometry SHUFFLED + residual
                     vs   WRONG-BAND geometry + residual
If destroying the decoder base does not destroy performance, the base is not
doing the work.
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

LETTERS = "CDEFGAB"
SEMI = np.array([0, 2, 4, 5, 7, 9, 11])
MIDDLE = {"upper": 34, "lower": 22}
SHARP_ORDER = "FCGDAEB"
FLAT_ORDER = "BEADGCF"
CTX_KEY = slice(19, 34)
J = {"step": 1, "oct": 2, "acc": 3}


def key_alter_row(f):
    f = int(f)
    k = (SHARP_ORDER[:min(f, 7)] if f > 0
         else FLAT_ORDER[:min(-f, 7)] if f < 0 else "")
    out = np.zeros(7, np.int64)
    for i, ch in enumerate("CDEFGAB"):
        if ch in k:
            out[i] = 1 if f > 0 else -1
    return out


def build(d, shuffle_k=False, wrong_band=False, seed=0):
    """Per-object rows for the residual task, with the closed-form base."""
    R, N = d["emb"].shape[0], d["emb"].shape[1]
    k = d["staff"][..., 0].astype(np.float64)
    is_up = d["staff"][..., 2] > 0.5
    if shuffle_k:
        rs = np.random.RandomState(seed)
        perm = rs.permutation(k.size)
        k = k.reshape(-1)[perm].reshape(k.shape)
    if wrong_band:
        is_up = ~is_up
    d0 = np.where(is_up, MIDDLE["upper"], MIDDLE["lower"]) + np.round(2 * k).astype(np.int64)
    m = (d["mask"][..., J["step"]] & d["mask"][..., J["oct"]]
         & d["mask"][..., J["acc"]]) & d["object_mask"]
    t_step = d["target"][..., J["step"]].astype(np.int64)
    t_oct = d["target"][..., J["oct"]].astype(np.int64)
    t_acc = d["target"][..., J["acc"]].astype(np.int64)
    flat = m.reshape(-1)
    d0f = d0.reshape(-1)[flat]
    t_dia = (t_step + 7 * t_oct).reshape(-1)[flat]
    # residual is ALWAYS in {-1,0,+1} (S4). Map -1/0/+1 -> 0/1/2.
    resid = (t_dia - d0f)
    resid_c = np.clip(resid + 1, 0, 2)
    fifths = np.repeat(d["context_staff"][:, CTX_KEY].argmax(1) - 7, N)[flat]
    ka = np.stack([key_alter_row(f) for f in fifths])          # (M,7)
    step0 = d0f % 7
    acc0 = ka[np.arange(len(ka)), step0] + 3
    acc_res = np.clip((t_acc.reshape(-1)[flat] - acc0) + 1, 0, 2)
    emb = d["emb"].reshape(-1, d["emb"].shape[-1])[flat].astype(np.float32)
    staff = d["staff"].reshape(-1, d["staff"].shape[-1])[flat].astype(np.float32)
    ctx = d["context_staff"][:, :34].astype(np.float32)
    ctx = np.repeat(ctx, N, axis=0)[flat]
    return {
        "d0": d0f, "step0": step0, "acc0": acc0,
        "resid": resid_c, "acc_res": acc_res,
        "t_step": t_step.reshape(-1)[flat], "t_oct": t_oct.reshape(-1)[flat],
        "t_acc": t_acc.reshape(-1)[flat],
        "emb": emb, "staff": staff, "ctx": ctx,
        "score": np.repeat(d["score"], N)[flat],
        "engraving": np.repeat(d["engraving"], N)[flat],
    }


class Residual(nn.Module):
    def __init__(self, d_in, hidden=0, seed=0):
        super().__init__()
        torch.manual_seed(seed)
        if hidden:
            self.trunk = nn.Sequential(nn.LayerNorm(d_in), nn.Linear(d_in, hidden),
                                       nn.GELU())
        else:
            self.trunk = nn.LayerNorm(d_in)
        z = hidden or d_in
        self.dia = nn.Linear(z, 3)
        self.acc = nn.Linear(z, 3)

    def forward(self, x):
        z = self.trunk(x)
        return self.dia(z), self.acc(z)

    def n_params(self):
        return sum(p.numel() for p in self.parameters())


def features(D, idx, use_emb, use_ctx):
    parts = [D["staff"][idx], (D["d0"][idx] - D["step0"][idx])[:, None] / 7.0]
    if use_emb:
        parts.append(D["emb"][idx])
    if use_ctx:
        parts.append(D["ctx"][idx])
    return np.concatenate(parts, -1)


def run(D, use_emb, use_ctx, hidden=64, epochs=60, seed=0, subsample=0):
    score = D["score"]
    scores = sorted(set(score.tolist()))
    per, tot = {}, defaultdict(int)
    ins = []
    for held in scores:
        tr = np.where(score != held)[0]
        te = np.where(score == held)[0]
        rs = np.random.RandomState(12345)
        if subsample and len(tr) > subsample:
            tr = rs.choice(tr, subsample, replace=False)
        Xtr = torch.tensor(features(D, tr, use_emb, use_ctx), dtype=torch.float32)
        dtr = torch.tensor(D["resid"][tr], dtype=torch.long)
        atr = torch.tensor(D["acc_res"][tr], dtype=torch.long)
        model = Residual(Xtr.shape[1], hidden, seed)
        opt = torch.optim.AdamW(model.parameters(), lr=5e-3, weight_decay=1e-4)
        lossf = nn.CrossEntropyLoss()
        for _ in range(epochs):
            opt.zero_grad()
            a, b = model(Xtr)
            (lossf(a, dtr) + lossf(b, atr)).backward()
            opt.step()
        with torch.no_grad():
            Xte = torch.tensor(features(D, te, use_emb, use_ctx), dtype=torch.float32)
            ad, aa = model(Xte)
            dr = ad.argmax(-1).numpy() - 1
            ar = aa.argmax(-1).numpy() - 1
            Xin = torch.tensor(features(D, tr, use_emb, use_ctx), dtype=torch.float32)
            adi, aai = model(Xin)
            oki = ((adi.argmax(-1) == torch.tensor(D["resid"][tr]))
                   & (aai.argmax(-1) == torch.tensor(D["acc_res"][tr])))
            ins.append(float(oki.float().mean()))
        d_fin = D["d0"][te] + dr
        s_ok = (d_fin % 7) == D["t_step"][te]
        o_ok = (d_fin // 7) == D["t_oct"][te]
        a_fin = D["acc0"][te] + ar
        a_ok = a_fin == D["t_acc"][te]
        wp = s_ok & o_ok & a_ok
        n = len(te)
        # base (no residual)
        bs = (D["step0"][te] == D["t_step"][te])
        bo = (D["d0"][te] // 7) == D["t_oct"][te]
        ba = (D["acc0"][te] == D["t_acc"][te])
        per[held] = {"n": n, "written_pitch": round(float(wp.mean()), 4),
                     "base_written_pitch": round(float((bs & bo & ba).mean()), 4),
                     "step": round(float(s_ok.mean()), 4),
                     "octave": round(float(o_ok.mean()), 4),
                     "accidental": round(float(a_ok.mean()), 4),
                     "resid_acc": round(float((dr == (D["t_step"][te] + 7 * D["t_oct"][te] - D["d0"][te])).mean()), 4),
                     "engraving": str(D["engraving"][te[0]])}
        tot["wp"] += int(wp.sum()); tot["n"] += n
        tot["bwp"] += int((bs & bo & ba).sum())
        tot["s"] += int(s_ok.sum()); tot["o"] += int(o_ok.sum())
        tot["a"] += int(a_ok.sum())
    macro = float(np.mean([v["written_pitch"] for v in per.values()]))
    bmacro = float(np.mean([v["base_written_pitch"] for v in per.values()]))
    return {"weighted": round(tot["wp"] / tot["n"], 4),
            "macro": round(macro, 4),
            "base_weighted": round(tot["bwp"] / tot["n"], 4),
            "base_macro": round(bmacro, 4),
            "step": round(tot["s"] / tot["n"], 4),
            "octave": round(tot["o"] / tot["n"], 4),
            "accidental": round(tot["a"] / tot["n"], 4),
            "in_sample": round(float(np.mean(ins)), 4),
            "n": tot["n"], "per_score": per,
            "improvement_over_base": round(tot["wp"] / tot["n"] - tot["bwp"] / tot["n"], 4)}


def main():
    d = CACHE.load()
    hidden = int(sys.argv[1]) if len(sys.argv) > 1 else 64
    epochs = int(sys.argv[2]) if len(sys.argv) > 2 else 60
    D = build(d)
    print("base (closed form) on this build: step %.4f  acc0 rule %.4f"
          % ((D["step0"] == D["t_step"]).mean(), (D["acc0"] == D["t_acc"]).mean()),
          flush=True)
    report = {"hidden": hidden, "epochs": epochs, "arms": {}}
    for name, (ue, uc, hid) in {
            "B_linear": (False, False, 0),
            "C_mlp": (False, False, hidden),
            "D_embedding": (True, False, hidden),
            "E_embedding_context": (True, True, hidden)}.items():
        r = run(D, ue, uc, hidden=hid, epochs=epochs)
        model = Residual(features(D, np.arange(8), ue, uc).shape[1], hid)
        r["params"] = model.n_params() if hid or ue or uc else \
            2 * (features(D, np.arange(8), ue, uc).shape[1] + 1)
        report["arms"][name] = r
        print("  %-22s wp %.4f (base %.4f, %+.4f) macro %.4f (base %.4f) "
              "step %.4f acc %.4f params %d"
              % (name, r["weighted"], r["base_weighted"], r["improvement_over_base"],
                 r["macro"], r["base_macro"], r["step"], r["accidental"], r["params"]),
              flush=True)
    best = max(report["arms"], key=lambda k: report["arms"][k]["weighted"])
    report["best"] = best
    report["best_weighted"] = report["arms"][best]["weighted"]
    report["improvement_over_closed_form_0_7342"] = round(
        report["arms"][best]["weighted"] - 0.7342, 4)
    report["GATE_pass"] = bool(report["arms"][best]["weighted"] >= 0.70
                               and report["arms"][best]["improvement_over_base"] >= 0.02)

    # ---- S9 structure ablation: does the base do the work? ----
    print("\n=== S9 structure ablation ===", flush=True)
    abl = {}
    for tag, kw in (("correct_geometry", {}),
                    ("shuffled_k", {"shuffle_k": True}),
                    ("wrong_band", {"wrong_band": True})):
        Da = build(d, **kw)
        r = run(Da, True, True, hidden=hidden, epochs=epochs)
        abl[tag] = {k: r[k] for k in ("weighted", "base_weighted", "step",
                                      "accidental", "improvement_over_base")}
        print("  %-18s wp %.4f  base %.4f  step %.4f  acc %.4f"
              % (tag, r["weighted"], r["base_weighted"], r["step"], r["accidental"]),
              flush=True)
    report["structure_ablation"] = abl
    p = H.write_json("phase_s5_residual.json", report)
    print("\nbest:", best, report["best_weighted"],
          " improvement over 0.7342: %+.4f" % report["improvement_over_closed_form_0_7342"],
          "\nGATE:", "PASS" if report["GATE_pass"] else "FAIL")
    print("wrote", p)


if __name__ == "__main__":
    main()
