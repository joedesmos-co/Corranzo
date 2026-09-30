"""Phase G5C/D/E/F/H - readout structure ablation on the FROZEN representation.

The input is fixed and never changes: the cached champion object embedding plus
the 7 staff-relative features. No backbone, no ROI, no images. The only thing
that varies is the STRUCTURE OF THE READOUT, which is the one live finding left
(0.120 -> ~0.61 on the same embedding).

Structures, budget-matched to the same trunk width:
  A  factorized          trunk -> 3 independent linear heads
  B  direct joint        trunk -> one (step,octave,accidental) classifier, 539 ways
  C  hierarchical        predict the staff-relative diatonic position, then
                         condition octave on it
  D  MLP joint           trunk -> wider joint MLP -> 539-way
  E  factorized + compatibility   3 heads plus a learned pairwise compatibility
                         term over (step, octave, accidental) co-occurrences

Every structure is scored with the SAME predicate on the SAME population:
written pitch is the per-object conjunction of (step, octave, accidental). The
G5A identity test and the G5B intersection table are recomputed for each, so a
structure that wins by a metric change rather than by better reading is visible.
"""
from __future__ import annotations

import hashlib
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
from phase_g5a_metrics import identity_check, intersection_table  # noqa: E402
from v26_adapter import ADAPTED_PITCH_HEADS, PITCH_HEAD_SIZES  # noqa: E402

LETTERS = "CDEFGAB"
SEMI = np.array([0, 2, 4, 5, 7, 9, 11])          # C D E F G A B
N_STEP, N_OCT, N_ACC = 7, 11, 7
N_JOINT = N_STEP * N_OCT * N_ACC                   # 539
J = {"step": 1, "oct": 2, "acc": 3}               # head index in the cache


# --------------------------------------------------------------- structures
class Factorized(nn.Module):
    def __init__(self, d_in, width, seed=0):
        super().__init__()
        torch.manual_seed(seed)
        self.trunk = nn.Sequential(nn.LayerNorm(d_in), nn.Linear(d_in, width),
                                   nn.GELU(), nn.Linear(width, width), nn.GELU())
        self.step = nn.Linear(width, N_STEP)
        self.oct = nn.Linear(width, N_OCT)
        self.acc = nn.Linear(width, N_ACC)

    def forward(self, x):
        z = self.trunk(x)
        return {"step": self.step(z), "oct": self.oct(z), "acc": self.acc(z)}

    def params(self):
        return sum(p.numel() for p in self.parameters())


class DirectJoint(nn.Module):
    def __init__(self, d_in, width, seed=0):
        super().__init__()
        torch.manual_seed(seed)
        self.trunk = nn.Sequential(nn.LayerNorm(d_in), nn.Linear(d_in, width),
                                   nn.GELU(), nn.Linear(width, width), nn.GELU())
        self.out = nn.Linear(width, N_JOINT)

    def forward(self, x):
        return {"joint": self.out(self.trunk(x))}

    def params(self):
        return sum(p.numel() for p in self.parameters())


class MLPJoint(nn.Module):
    def __init__(self, d_in, width, seed=0):
        super().__init__()
        torch.manual_seed(seed)
        self.trunk = nn.Sequential(nn.LayerNorm(d_in), nn.Linear(d_in, width),
                                   nn.GELU(), nn.Linear(width, width), nn.GELU())
        self.mlp = nn.Sequential(nn.Linear(width, width), nn.GELU())
        self.out = nn.Linear(width, N_JOINT)

    def forward(self, x):
        return {"joint": self.out(self.mlp(self.trunk(x)))}

    def params(self):
        return sum(p.numel() for p in self.parameters())


class Hierarchical(nn.Module):
    """Predict the staff-relative diatonic position first, then octave from it.

    The position head is supervised by the label's own staff-relative step
    (round(2k) + 34/22), i.e. by the DETECTED geometry, never by a target pitch.
    Octave and accidental are then predicted from a representation that already
    contains the position, so the two cannot disagree about register.
    """

    def __init__(self, d_in, width, n_pos, seed=0):
        super().__init__()
        torch.manual_seed(seed)
        self.trunk = nn.Sequential(nn.LayerNorm(d_in), nn.Linear(d_in, width),
                                   nn.GELU(), nn.Linear(width, width), nn.GELU())
        self.pos = nn.Linear(width, n_pos)
        self.post = nn.Sequential(nn.Linear(width + n_pos, width), nn.GELU())
        self.oct = nn.Linear(width, N_OCT)
        self.acc = nn.Linear(width, N_ACC)
        self.step = nn.Linear(width, N_STEP)
        self.n_pos = n_pos

    def forward(self, x):
        z = self.trunk(x)
        p = self.pos(z)
        z2 = self.post(torch.cat((z, p), -1))
        return {"step": self.step(z2), "oct": self.oct(z2), "acc": self.acc(z2),
                "pos": p}

    def params(self):
        return sum(p.numel() for p in self.parameters())


class Compatible(nn.Module):
    """Factorized heads plus a learned pairwise compatibility term.

    Score(step, oct, acc) = sum of the three head logits + b[step, oct]
    + c[oct, acc]. The compatibility tables are what the factorized structure
    structurally cannot express, and they are the only extra capacity over A.
    """

    def __init__(self, d_in, width, seed=0):
        super().__init__()
        torch.manual_seed(seed)
        self.base = Factorized(d_in, width, seed)
        self.bo = nn.Parameter(torch.zeros(N_STEP, N_OCT))
        self.oa = nn.Parameter(torch.zeros(N_OCT, N_ACC))

    def forward(self, x):
        o = self.base(x)
        return {"step": o["step"], "oct": o["oct"], "acc": o["acc"],
                "bo": self.bo, "oa": self.oa}

    def params(self):
        return sum(p.numel() for p in self.parameters())


STRUCTURES = {
    "A_factorized": Factorized, "B_direct_joint": DirectJoint,
    "C_hierarchical": Hierarchical, "D_mlp_joint": MLPJoint,
    "E_compatible": Compatible,
}


# ------------------------------------------------------------------ plumbing
def build_inputs(d):
    """FROZEN representation, flattened to per-object rows: champion embedding
    (480) + the 7 staff features. No backbone, no ROI, no images.

    Only objects on the shared metric population are kept, so every structure is
    scored on exactly the same rows and the identity test is comparable.
    """
    r, n = d["emb"].shape[0], d["emb"].shape[1]
    emb = d["emb"].astype(np.float32)
    st = d["staff"].astype(np.float32)
    x = np.concatenate((emb, st), -1)
    m = (d["mask"][..., J["step"]] & d["mask"][..., J["oct"]]
         & d["mask"][..., J["acc"]]) & d["object_mask"]
    y = np.stack((d["target"][..., J["step"]], d["target"][..., J["oct"]],
                  d["target"][..., J["acc"]]), -1).astype(np.int64)
    k = st[..., 0]
    is_up = st[..., 2] > 0.5
    pos_raw = np.where(is_up, 34, 22) + np.round(2 * k).astype(np.int64)
    sel = m.reshape(-1)
    pos = pos_raw.reshape(-1)[sel]
    lo, hi = int(pos.min()), int(pos.max())
    return {"x": x.reshape(-1, x.shape[-1])[sel],
            "y": y.reshape(-1, 3)[sel],
            "m": sel,
            "pos": np.clip(pos - lo, 0, hi - lo),
            "pos_lo": lo, "n_pos": hi - lo + 1,
            "score": np.repeat(d["score"], n)[sel],
            "engraving": np.repeat(d["engraving"], n)[sel],
            "emb_dim": int(emb.shape[2])}


def joint_index(step, octv, acc):
    return (step.astype(np.int64) * N_OCT + octv.astype(np.int64)) * N_ACC + acc.astype(np.int64)


def decode_joint(j):
    j = j.astype(np.int64)
    acc = j % N_ACC
    octv = (j // N_ACC) % N_OCT
    step = j // (N_ACC * N_OCT)
    return step, octv, acc


def predictions(out, kind):
    """Component predictions as (step, oct, acc) int arrays."""
    kind = kind.split("_", 1)[-1]
    if "joint" in kind:
        s, o, a = decode_joint(out["joint"].argmax(-1).numpy())
        return s, o, a
    if kind.startswith("compat"):
        # argmax of the composed score, not of the independent heads
        # (N,7,11,7): step, octave, accidental + a b[step,oct] and c[oct,acc]
        N = out["step"].shape[0]
        S = out["step"].reshape(N, N_STEP, 1, 1)
        O = out["oct"].reshape(N, 1, N_OCT, 1)
        A = out["acc"].reshape(N, 1, 1, N_ACC)
        comp = S + O + A + out["bo"].reshape(1, N_STEP, N_OCT, 1) \
            + out["oa"].reshape(1, 1, N_OCT, N_ACC)
        j = comp.reshape(N, N_JOINT).argmax(-1).numpy()
        return decode_joint(j)
    return (out["step"].argmax(-1).numpy(), out["oct"].argmax(-1).numpy(),
            out["acc"].argmax(-1).numpy())


def loss_for(out, kind, y):
    # structure keys are lettered ("B_direct_joint"); normalise to the short form
    kind = kind.split("_", 1)[-1]
    lf = nn.CrossEntropyLoss()
    if "joint" in kind:
        return lf(out["joint"], torch.tensor(joint_index(y[:, 0], y[:, 1], y[:, 2])))
    if kind == "hierarchical":
        l = lf(out["step"], torch.tensor(y[:, 0])) + lf(out["oct"], torch.tensor(y[:, 1])) \
            + lf(out["acc"], torch.tensor(y[:, 2]))
        return l
    return lf(out["step"], torch.tensor(y[:, 0])) + lf(out["oct"], torch.tensor(y[:, 1])) \
        + lf(out["acc"], torch.tensor(y[:, 2]))


def train_one(D, tr, kind, width, epochs, seed=0, lr=3e-3, subsample=0):
    d_in = D["x"].shape[-1]
    model = (Hierarchical(d_in, width, D["n_pos"], seed) if kind == "C_hierarchical"
             else Compatible(d_in, width, seed) if kind == "E_compatible"
             else STRUCTURES[kind](d_in, width, seed))
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    rs = np.random.RandomState(12345)
    idx_all = tr
    if subsample and len(tr) > subsample:
        idx_all = rs.choice(tr, subsample, replace=False)
    X = torch.tensor(D["x"][idx_all])
    Y = D["y"][idx_all]
    P = torch.tensor(D["pos"][idx_all])
    assert Y.ndim == 2, Y.shape
    for _ in range(epochs):
        opt.zero_grad()
        out = model(X)
        loss = loss_for(out, kind, Y)
        if kind == "C_hierarchical":
            loss = loss + nn.CrossEntropyLoss()(out["pos"], P)
        loss.backward()
        opt.step()
    return model


def evaluate_model(D, model, kind, idx):
    with torch.no_grad():
        out = model(torch.tensor(D["x"][idx]))
    s, o, a = predictions(out, kind)
    m = D["m"][idx]
    y = D["y"][idx]
    return {"step": (s == y[:, 0]) & m, "oct": (o == y[:, 1]) & m,
            "acc": (a == y[:, 2]) & m, "m": m, "p_step": s, "p_oct": o, "p_acc": a,
            "p_midi": (12 * (o + 1) + SEMI[s] + a - 3),
            "t_midi": (12 * (y[:, 1] + 1) + SEMI[y[:, 0]] + y[:, 2] - 3)}


def loso(D, kind, width, epochs, subsample=0, seed=0):
    score = D["score"]
    scores = sorted(set(score.tolist()))
    per = {}
    acc = {"step": [], "oct": [], "acc": [], "m": [],
           "p_step": [], "p_oct": [], "p_acc": [], "t_step": [], "t_oct": [], "t_acc": [],
           "score": []}
    insample = {}
    for held in scores:
        tr = np.where(score != held)[0]
        te = np.where(score == held)[0]
        model = train_one(D, tr, kind, width, epochs, seed, subsample=subsample)
        ev = evaluate_model(D, model, kind, te)
        N = int(ev["m"].sum())
        if N == 0:
            per[held] = {"n": 0, "written_pitch": None}
            continue
        for k in ("step", "oct", "acc", "m", "p_step", "p_oct", "p_acc"):
            acc[k].append(ev[k])
        acc["t_step"].append(D["y"][te][:, 0])
        acc["t_oct"].append(D["y"][te][:, 1])
        acc["t_acc"].append(D["y"][te][:, 2])
        acc["score"].append(score[te])
        wp = float((ev["step"] & ev["oct"] & ev["acc"]).sum() / N)
        per[held] = {
            "n": N, "written_pitch": round(wp, 4),
            "step": round(float(ev["step"][ev["m"]].mean()), 4),
            "octave": round(float(ev["oct"][ev["m"]].mean()), 4),
            "accidental": round(float(ev["acc"][ev["m"]].mean()), 4),
            "midi": round(float((ev["p_midi"] == ev["t_midi"])[ev["m"]].mean()), 4),
            "engraving": str(D["engraving"][int(te[0])])}
        # in-sample memorisation on this fold's own training rows
        ev_in = evaluate_model(D, model, kind, tr)
        insample[held] = round(float(
            (ev_in["step"] & ev_in["oct"] & ev_in["acc"])[ev_in["m"]].mean()), 4)

    G = {k: (np.concatenate(v) if k not in ("m",) else np.concatenate(v))
         for k, v in acc.items() if v}
    N = int(G["m"].sum())
    ident = identity_check({
        "step": G["step"], "oct": G["oct"], "acc": G["acc"], "m": G["m"],
        "midi": (12 * (G["p_oct"] + 1) + SEMI[G["p_step"]] + G["p_acc"] - 3)
        == (12 * (G["t_oct"] + 1) + SEMI[G["t_step"]] + G["t_acc"] - 3)})
    table = intersection_table({
        "step": G["step"], "oct": G["oct"], "acc": G["acc"], "m": G["m"]},
        ["step", "oct", "acc"])
    # ---- G5E: oracle component substitution, evaluation only ----
    oracles = {}
    combos = {
        "predicted_all (no oracle)": (G["p_step"], G["p_oct"], G["p_acc"]),
        "pred_step + TRUE_octave": (G["p_step"], G["t_oct"], G["p_acc"]),
        "TRUE_step + pred_octave": (G["t_step"], G["p_oct"], G["p_acc"]),
        "pred_step + pred_oct + TRUE_acc": (G["p_step"], G["p_oct"], G["t_acc"]),
        "TRUE_step + pred_oct + pred_acc": (G["t_step"], G["p_oct"], G["p_acc"]),
        "TRUE_step + TRUE_octave + pred_acc": (G["t_step"], G["t_oct"], G["p_acc"]),
        "pred_step + TRUE_octave + TRUE_acc": (G["p_step"], G["t_oct"], G["t_acc"]),
    }
    for name, (ps, po, pa) in combos.items():
        ok = (ps == G["t_step"]) & (po == G["t_oct"]) & (pa == G["t_acc"]) & G["m"]
        oracles[name] = {"written_pitch": round(float(ok.sum()) / N, 4)}
    macro_scores = [v["written_pitch"] for v in per.values() if v["written_pitch"]]
    wp = float((G["step"] & G["oct"] & G["acc"] & G["m"]).sum() / N)
    mem = float(np.mean(list(insample.values()))) if insample else None
    return {"weighted_written_pitch": round(wp, 4),
            "macro_written_pitch": round(float(np.mean(macro_scores)), 4),
            "weighted_step": round(float(G["step"][G["m"]].mean()), 4),
            "weighted_octave": round(float(G["oct"][G["m"]].mean()), 4),
            "weighted_accidental": round(float(G["acc"][G["m"]].mean()), 4),
            "n": N, "G5A_identity": ident, "G5B_intersection": table,
            "G5E_oracles": oracles,
            "G5H_in_sample_memorisation": round(mem, 4) if mem else None,
            "G5H_train_minus_LOSO_gap": round(mem - wp, 4) if mem else None,
            "per_score": per}


def main():
    width = int(sys.argv[1]) if len(sys.argv) > 1 else 256
    epochs = int(sys.argv[2]) if len(sys.argv) > 2 else 40
    subsample = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    d = CACHE.load()
    D = build_inputs(d)
    frozen_sha = hashlib.sha256(
        (H.V26_ROOT / "out/phase_f_cache.npz").read_bytes()).hexdigest()
    print("frozen representation sha256:", frozen_sha[:24], "x", D["x"].shape, flush=True)
    report = {"frozen_representation_sha256": frozen_sha,
              "input": "champion object embedding (480) + 7 staff features",
              "embedding_dim": D["emb_dim"], "width": width, "epochs": epochs,
              "subsample": subsample, "structures": {}}
    for kind in STRUCTURES:
        r = loso(D, kind, width, epochs, subsample)
        r["param_count"] = int(STRUCTURES[kind](D["x"].shape[-1], width, 0).params()) \
            if kind != "C_hierarchical" else \
            int(Hierarchical(D["x"].shape[-1], width, D["n_pos"], 0).params())
        report["structures"][kind] = r
        print("  %-16s wp %.4f macro %.4f step %.4f oct %.4f acc %.4f params %d" % (
            kind, r["weighted_written_pitch"], r["macro_written_pitch"],
            r["weighted_step"], r["weighted_octave"], r["weighted_accidental"],
            r["param_count"]), flush=True)
    best = max(report["structures"],
               key=lambda k: report["structures"][k]["weighted_written_pitch"])
    report["best"] = best
    report["best_weighted_written_pitch"] = report["structures"][best]["weighted_written_pitch"]
    report["improvement_over_0_61_baseline"] = round(
        report["structures"][best]["weighted_written_pitch"] - 0.6132, 4)
    report["G5I_pass"] = bool(report["improvement_over_0_61_baseline"] >= 0.05)
    p = H.write_json("phase_g5d_readout.json", report)
    print("\nbest:", best, report["best_weighted_written_pitch"],
          "improvement over 0.6132: %+.4f" % report["improvement_over_0_61_baseline"],
          "\nG5I:", "PASS" if report["G5I_pass"] else "FAIL")
    print("wrote", p)


if __name__ == "__main__":
    main()
