"""Phase A / P9: is the pitch evidence PRESENT in the representation?

Decisive separation of REPRESENTATION failure from PITCH-HEAD failure.

If a trivial probe (ridge / gradient boosting) can recover the true staff-relative
pitch from the SOURCE-ONLY scalar channels the model already receives, then the
information is present in production too, the trained pitch head is simply
using it badly, and the fix is in the head/representation wiring - not in more
pixels and not in more training.

Features per object, all source-only, all already delivered to the model:
  * the 24-dim _object_vector exactly as build_inputs emits it
  * the object box in page-normalised coords
  * the mapped staff-band geometry (centre, gap, scope height, role)
Targets: the same staff step / written step the model is asked to predict.

Trained on SOURCE, tested on SOURCE and on PRODUCTION (zero-shot transfer).
The production zero-shot number is the key one: it is the ceiling that any
head-side fix on the existing representation can reach without new pixels.
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

H.add_runtime_to_path()
from piano_vision.v2.data import (build_inputs, attach_targets, collate,  # noqa: E402
                                  _bounds, _center, _object_vector)
from piano_vision.v25.data import attach_object_page_geo  # noqa: E402
from piano_vision.v25.performance import prepare_batch  # noqa: E402

import torch  # noqa: E402
from torch import nn  # noqa: E402


class Probe(nn.Module):
    """Small MLP probe. Deliberately tiny: we are testing whether the
    information is present, not how well it can be fitted."""

    def __init__(self, d, n_out, width=128):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(d, width), nn.GELU(),
                                 nn.Linear(width, width), nn.GELU(),
                                 nn.Linear(width, n_out))

    def forward(self, x):
        return self.net(x)

FEATURE_NAMES = [
    "of0_notehead", "of1_rest", "of2_other", "of3_cx", "of4_cy", "of5_w", "of6_h",
    "of7_cx_scope", "of8_cy_scope", "of9_geomconf", "of10_cy_minus_upper_over_sh",
    "of11_cy_minus_lower_over_sh", "of12_scope_w", "of13_scope_h", "of14_graph_known",
    "of15_observed", "of16_coord_err", "of17_staff_role", "of18_glyph_bbox",
    "of19_vector", "of20_sin2p_cx", "of21_cos2p_cx", "of22_sin2p_cy", "of23_cos2p_cy",
    "box_cx", "box_cy", "box_w", "box_h",
    "band_centre_cy", "band_gap_cy", "scope_h", "cy_minus_bandcentre", "cy_over_gap",
    "cy_minus_upper", "cy_minus_lower", "num_bands", "is_upper_band",
]


def extract(ordered, resolver, max_records, limit=4000):
    X, Y, meta = [], [], []
    n = 0
    for rec in ordered[:max_records]:
        if len(X) >= limit:
            break
        try:
            sample, selected, lookup, relations, nodes = build_inputs(
                rec, ordered, resolver, CURRENT)
            sample = attach_targets(sample, rec, selected, lookup, relations, nodes)
            sample = attach_object_page_geo(sample, selected)
            batch = prepare_batch(collate([sample]), consistency=False)
        except Exception:
            continue
        n += 1
        m = rec["input"]["modelInput"]
        geo = m.get("geometry", {})
        bands = geo.get("staffBands", {}).get("staffBands", [])
        scope = geo.get("scopeBounds") or {"y0": 0, "y1": 1}
        sh = max(1e-6, float(scope["y1"]) - float(scope["y0"]))
        objs = m.get("physicalObjects", [])
        for i, obj in enumerate(objs):
            if i >= len(sample["object_features"]) or len(X) >= limit:
                break
            of = sample["object_features"][i].numpy().astype(np.float64)
            x0, x1, y0, y1 = _bounds(obj)
            cx, cy = _center(obj)
            band = min(bands, key=lambda b: abs(
                cy - (float(b["y0"]) + float(b["y1"])) / 2)) if bands else None
            if band:
                bc = (float(band["y0"]) + float(band["y1"])) / 2
                bg = max(1e-6, (float(band["y1"]) - float(band["y0"])) / 4.0)
                is_up = 1.0 if band.get("staffRole") == "upper" else 0.0
            else:
                bc = bg = 0.0
                is_up = 0.0
            ups = [b for b in bands if b.get("staffRole") == "upper"]
            los = [b for b in bands if b.get("staffRole") == "lower"]
            uy = (float(ups[0]["y0"]) + float(ups[0]["y1"])) / 2 if ups else cy
            ly = (float(los[0]["y0"]) + float(los[0]["y1"])) / 2 if los else cy
            extra = [cx, cy, x1 - x0, y1 - y0, bc, bg, sh, cy - bc, cy / bg,
                     cy - uy, cy - ly, float(len(bands)), is_up]
            X.append(np.concatenate([of, extra]))
            t = batch["targets"]["object"]
            def g(head, key="target"):
                return t[head][key][0][i].item() if i < len(t[head][key][0]) else -1
            def m_(head):
                return bool(t[head]["mask"][0][i].item()) if i < len(t[head]["mask"][0]) else False
            Y.append({
                "staff_step": (g("pitch_staff_step"), m_("pitch_staff_step")),
                "written_step": (g("pitch_written_step"), m_("pitch_written_step")),
                "octave": (g("pitch_octave"), m_("pitch_octave")),
            })
            meta.append((rec["scoreId"], rec["exampleId"], i))
    return np.array(X, dtype=np.float32), Y, meta


CURRENT = None


def fit_eval(Xs, Ys, Xp, Yp, target, name, epochs=400):
    ys_all = np.array([y[target][0] for y in Ys])
    ms = np.array([bool(y[target][1]) for y in Ys]) & (ys_all >= 0)
    yp_all = np.array([y[target][0] for y in Yp])
    mp = np.array([bool(y[target][1]) for y in Yp]) & (yp_all >= 0)
    ys = ys_all[ms]
    yp = yp_all[mp]
    if len(ys) < 20 or len(yp) < 5:
        return None
    n_out = int(max(ys.max(), yp.max())) + 1
    n_out = max(n_out, 35)
    mu, sd = Xs[ms].mean(0), Xs[ms].std(0) + 1e-6
    tr = torch.tensor((Xs[ms] - mu) / sd, dtype=torch.float32)
    trt = torch.tensor(ys, dtype=torch.long)
    te = torch.tensor((Xp[mp] - mu) / sd, dtype=torch.float32)
    tel = torch.tensor(yp, dtype=torch.long)
    net = Probe(tr.shape[1], n_out)
    opt = torch.optim.AdamW(net.parameters(), lr=3e-3, weight_decay=1e-4)
    lossf = nn.CrossEntropyLoss()
    net.train()
    for _ in range(epochs):
        opt.zero_grad()
        loss = lossf(net(tr), trt)
        loss.backward()
        opt.step()
    net.eval()
    with torch.no_grad():
        tr_acc = float((net(tr).argmax(-1) == trt).float().mean())
        te_acc = float((net(te).argmax(-1) == tel).float().mean())
    maj = float(np.bincount(yp).max() / len(yp))
    print(f"  {name:<14} source_fit={tr_acc:.4f}  PROD_zero_shot={te_acc:.4f}  "
          f"(prod majority {maj:.4f}, n_prod={len(yp)}, n_src={len(ys)})", flush=True)
    return {"target": target, "source_fit_accuracy": round(tr_acc, 4),
            "prod_zero_shot_accuracy": round(te_acc, 4),
            "prod_majority_baseline": round(maj, 4),
            "n_source": int(len(ys)), "n_prod": int(len(yp))}


def fit_self(Xa, Ya, Xb, Yb, target, name, epochs=400, seed=0):
    """Train and test IN THE SAME DOMAIN. Separates 'info absent' from
    'mapping does not transfer'."""
    ya = np.array([y[target][0] for y in Ya]); ma = np.array([bool(y[target][1]) for y in Ya]) & (ya >= 0)
    yb = np.array([y[target][0] for y in Yb]); mb = np.array([bool(y[target][1]) for y in Yb]) & (yb >= 0)
    if ma.sum() < 20 or mb.sum() < 5:
        return None
    ya, yb = ya[ma], yb[mb]
    n_out = max(int(max(ya.max(), yb.max())) + 1, 35)
    mu, sd = Xa[ma].mean(0), Xa[ma].std(0) + 1e-6
    A = torch.tensor((Xa[ma]-mu)/sd, dtype=torch.float32); At = torch.tensor(ya, dtype=torch.long)
    # held-out split of the production objects, by index
    idx = torch.randperm(len(A), generator=torch.Generator().manual_seed(seed))
    cut = int(len(A)*0.7)
    tr_i, te_i = idx[:cut], idx[cut:]
    net = Probe(A.shape[1], n_out)
    opt = torch.optim.AdamW(net.parameters(), lr=3e-3, weight_decay=1e-4)
    lossf = nn.CrossEntropyLoss()
    net.train()
    for _ in range(epochs):
        opt.zero_grad(); loss = lossf(net(A[tr_i]), At[tr_i]); loss.backward(); opt.step()
    net.eval()
    with torch.no_grad():
        f = float((net(A[tr_i]).argmax(-1)==At[tr_i]).float().mean())
        h = float((net(A[te_i]).argmax(-1)==At[te_i]).float().mean())
    print(f"  {name:<14} PROD_self_train={f:.4f}  PROD_heldout={h:.4f}  "
          f"(n_train={len(tr_i)}, n_held={len(te_i)})", flush=True)
    return {"train": round(f,4), "heldout": round(h,4)}


def main():
    global CURRENT
    runtime = H.load_runtime("cpu")
    CURRENT = runtime.config
    print("extracting SOURCE ...", flush=True)
    Xs, Ys = extract_merged(H.source_scores(3, split="validation"),
                            H.source_resolver, 40, 4000)
    print("extracting PRODUCTION ...", flush=True)
    Xp, Yp = extract_merged(H.realpdf_scores("validation"),
                            H.realpdf_resolver, 25, 4000)
    print(f"source X {Xs.shape}  production X {Xp.shape}\n", flush=True)
    out = {}
    # ---- channel ablation: EXACTLY the model's 24-dim input vs +scale-free ----
    N24 = 24
    print("\nChannel ablation (production self-supervised probe, held-out):", flush=True)
    ab = {}
    for tag, cols in (("model_24dim_object_vector_only", list(range(N24))),
                      ("plus_scale_free_staff_channels", None)):
        for target, name in (("staff_step", "STAFF STEP"), ("written_step", "WRITTEN STEP")):
            Xa = Xp if cols is None else Xp[:, cols]
            r = fit_self(Xa, Yp, Xa, Yp, target, f"{tag[:22]} {name[:11]}")
            if r:
                ab[f"{tag}|{target}"] = r
    out["channel_ablation"] = ab

    for target, name in (("staff_step", "STAFF STEP"), ("written_step", "WRITTEN STEP"),
                         ("octave", "OCTAVE")):
        print(f"{name}:", flush=True)
        r = fit_eval(Xs, Ys, Xp, Yp, target, name)
        if r:
            out[name] = r
        r2 = fit_self(Xp, Yp, Xp, Yp, target, name + " self")
        if r2:
            out[name + "_production_self"] = r2
    path = H.write_json("phase_a_probe.json", out)
    print("\nwrote", path)


def extract_merged(score_groups, resolver_factory, max_records, limit):
    X, Y, _ = extract_merged_with_meta(score_groups, resolver_factory, max_records, limit)
    return X, Y


def extract_merged_with_meta(score_groups, resolver_factory, max_records, limit):
    Xs, Ys, Ms = [], [], []
    for entry in score_groups:
        if isinstance(entry, tuple):
            sid, ordered = entry
        else:
            ordered = entry
            sid = ordered[0]["scoreId"] if ordered else "?"
        X, Y, meta = extract(ordered, resolver_factory(), max_records, limit)
        Xs.append(X)
        Ys.extend(Y)
        Ms.extend([(sid, m[1], m[2]) for m in meta])
    return np.concatenate(Xs, 0), Ys, Ms


if __name__ == "__main__":
    main()
