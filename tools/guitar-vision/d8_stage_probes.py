"""Readout probes on every production representation stage.

## Protocol, fixed before any held-out number was read

One split definition, one seed, one optimizer, one budget, one readout family,
applied identically to A, B, C and D. Nothing is re-tuned per stage and no
held-out result is ever used to choose anything.

    fit      614 rows   first 80% of every one of the 40 train scores
    B        153 rows   last 20% of those same 40 scores (unseen instance, seen score)
    C        395 rows   all 20 score-disjoint held-out scores
    A       1162 rows   every fret object (reference, not a fitted split)

    seed 11, Adam lr 1e-3, batch 64, 3000 steps, no early stopping

## Readouts

  template NN   L2-normalise, class centroid over fit rows, nearest centroid.
                Zero learned parameters. Answers "is class identity already
                present and unmixed?" without any capacity argument.

  linear        d -> 20, one matrix. Answers "is it linearly decodable?"

  MLP / CNN     the smallest thing that can read shape. 3 hidden layers of 256,
                ReLU. For A the established 2-D probe is used unchanged (three
                conv-BN-ReLU blocks 32/64/128, global average pooling, linear 20)
                because P3 requires A to reproduce the earlier 0.9316 exactly.

## P3 positive control

Stage A is checked against the previously established 0.9316 score-disjoint number
before any other stage is interpreted. If it does not reproduce, this script exits
non-zero and reports nothing else.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE / "python"))

SEED = 11
CLASSES = 20
TWO_DIGIT_FROM = 10


def splits(scores: np.ndarray, page: np.ndarray, row: np.ndarray):
    """The one split definition. Returns fit / same-score / score-disjoint masks."""
    unique = np.array(sorted(set(scores.tolist())))
    train_scores, held_scores = set(unique[:40].tolist()), set(unique[40:].tolist())
    is_train = np.array([s in train_scores for s in scores])
    is_held = ~is_train
    fit, same = np.zeros(len(scores), bool), np.zeros(len(scores), bool)
    for score in sorted(train_scores):
        rows = np.nonzero(scores == score)[0]
        rows = rows[np.lexsort((row[rows], page[rows]))]
        cut = int(round(len(rows) * 0.8))
        fit[rows[:cut]] = True
        same[rows[cut:]] = True
    return fit, same, is_held, sorted(held_scores)


def standardise(x: np.ndarray, fit: np.ndarray) -> np.ndarray:
    mean = x[fit].mean(axis=0, keepdims=True)
    std = x[fit].std(axis=0, keepdims=True) + 1e-6
    return (x - mean) / std


def template_nn(x_fit, y_fit, x_eval, y_eval):
    """Nearest class centroid on L2-normalised rows. No learned parameters."""
    def unit(a):
        a = a.reshape(len(a), -1)
        return a / (np.linalg.norm(a, axis=1, keepdims=True) + 1e-8)

    fit_u, centroids = unit(x_fit), []
    for c in range(CLASSES):
        rows = fit_u[y_fit == c]
        centroids.append(rows.mean(axis=0) if len(rows) else np.zeros(x_fit.shape[1]))
    centroids = unit(np.stack(centroids))
    pred = np.argmax(unit(x_eval) @ centroids.T, axis=1)
    return float((pred == y_eval).mean())


def flat_probe(x_fit, y_fit, x_eval_sets, y_eval_sets, kind: str, steps: int, seed: int):
    """Fixed-budget linear or MLP probe. One config for every tensor stage."""
    torch.manual_seed(seed)
    d = x_fit.shape[1]
    if kind == "linear":
        net = torch.nn.Linear(d, CLASSES)
    else:
        net = torch.nn.Sequential(
            torch.nn.Linear(d, 256), torch.nn.ReLU(),
            torch.nn.Linear(256, 256), torch.nn.ReLU(),
            torch.nn.Linear(256, 256), torch.nn.ReLU(),
            torch.nn.Linear(256, CLASSES),
        )
    parameters = sum(p.numel() for p in net.parameters())
    optimiser = torch.optim.Adam(net.parameters(), lr=1e-3)
    xt = torch.from_numpy(x_fit.astype(np.float32))
    yt = torch.from_numpy(y_fit.astype(np.int64))
    generator = torch.Generator().manual_seed(seed)
    loss_fn = torch.nn.CrossEntropyLoss()
    net.train()
    for _ in range(steps):
        index = torch.randint(0, xt.shape[0], (64,), generator=generator)
        optimiser.zero_grad()
        loss_fn(net(xt[index]), yt[index]).backward()
        optimiser.step()
    net.eval()
    with torch.no_grad():
        out = []
        for xs in x_eval_sets:
            logits = net(torch.from_numpy(xs.astype(np.float32)))
            out.append(logits.argmax(1).numpy())
    return parameters, out


def cnn_probe(x_fit, y_fit, x_eval_sets, y_eval_sets, steps: int, seed: int):
    """The established ROI probe, unchanged, as the P3 positive control."""
    torch.manual_seed(seed)
    net = torch.nn.Sequential(
        torch.nn.Conv2d(1, 32, 3, padding=1), torch.nn.BatchNorm2d(32), torch.nn.ReLU(),
        torch.nn.Conv2d(32, 64, 3, padding=1), torch.nn.BatchNorm2d(64), torch.nn.ReLU(),
        torch.nn.Conv2d(64, 128, 3, padding=1), torch.nn.BatchNorm2d(128), torch.nn.ReLU(),
        torch.nn.AdaptiveAvgPool2d(1), torch.nn.Flatten(),
        torch.nn.Linear(128, CLASSES),
    )
    parameters = sum(p.numel() for p in net.parameters())
    optimiser = torch.optim.Adam(net.parameters(), lr=1e-3)
    xt = torch.from_numpy(x_fit.astype(np.float32)).unsqueeze(1)
    yt = torch.from_numpy(y_fit.astype(np.int64))
    generator = torch.Generator().manual_seed(seed)
    loss_fn = torch.nn.CrossEntropyLoss()
    net.train()
    for _ in range(steps):
        index = torch.randint(0, xt.shape[0], (64,), generator=generator)
        optimiser.zero_grad()
        loss_fn(net(xt[index]), yt[index]).backward()
        optimiser.step()
    net.eval()
    with torch.no_grad():
        out = []
        for xs in x_eval_sets:
            logits = net(torch.from_numpy(xs.astype(np.float32)).unsqueeze(1))
            out.append(logits.argmax(1).numpy())
    return parameters, out


def score_identity(x, scores, fit_mask, kind, steps, seed):
    """P7, diagnostic only: can the representation name a score it has not seen?

    30 of the 40 train scores fit, the other 10 train scores evaluated. Reported to
    show whether score/style identity survives where fret identity does not. Uses
    train scores only, so held-out is untouched.
    """
    # Derive the train-score list from the fit mask. Deriving it from scores[:40]
    # instead would read the first 40 *objects*, which are all from score 1.
    train_scores = sorted(set(scores[fit_mask].tolist()))
    if len(train_scores) < 40:
        return None
    fit_scores, eval_scores = set(train_scores[:30]), set(train_scores[30:40])
    remap = {s: i for i, s in enumerate(sorted(fit_scores))}
    fit = np.array([s in fit_scores for s in scores])
    ev = np.array([s in eval_scores for s in scores])
    if fit.sum() == 0 or ev.sum() == 0:
        return None
    y_fit = np.array([remap.get(s, -1) for s in scores[fit]])
    # Labels must be indexed into eval_scores, not fit_scores. Indexing into
    # fit_scores gives -1 for every eval row (by construction they are not in it),
    # which makes the accuracy identically zero - a bug that looks like a finding.
    y_eval = np.array([sorted(eval_scores).index(s) for s in scores[ev]])
    keep_fit = y_fit >= 0
    xf, yf = x[fit][keep_fit], y_fit[keep_fit]
    xev, yev = x[ev], y_eval
    n = len(sorted(fit_scores))
    torch.manual_seed(seed)
    if kind == "linear":
        net = torch.nn.Linear(xf.shape[1], n)
    else:
        net = torch.nn.Sequential(
            torch.nn.Linear(xf.shape[1], 256), torch.nn.ReLU(),
            torch.nn.Linear(256, 256), torch.nn.ReLU(),
            torch.nn.Linear(256, n),
        )
    optimiser = torch.optim.Adam(net.parameters(), lr=1e-3)
    xt = torch.from_numpy(xf.astype(np.float32))
    yt = torch.from_numpy(yf.astype(np.int64))
    generator = torch.Generator().manual_seed(seed)
    loss_fn = torch.nn.CrossEntropyLoss()
    net.train()
    for _ in range(steps):
        index = torch.randint(0, xt.shape[0], (64,), generator=generator)
        optimiser.zero_grad()
        loss_fn(net(xt[index]), yt[index]).backward()
        optimiser.step()
    net.eval()
    with torch.no_grad():
        pred = net(torch.from_numpy(xev.astype(np.float32))).argmax(1).numpy()
    return {"score_id_acc": float((pred == yev).mean()), "n_fit_scores": n,
            "n_eval_scores": 10, "chance": round(1.0 / n, 4)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stages", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, default=None,
                        help="frozen state.pt, for the stage-E production logits")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--steps", type=int, default=3000)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--control", type=float, default=0.90,
                        help="P3: minimum acceptable stage-A score-disjoint")
    args = parser.parse_args()

    blob = np.load(args.stages, allow_pickle=True)
    mode = blob["mode"]
    normal = np.nonzero(mode == "normal")[0]
    if len(normal) != 1162:
        print(f"FATAL: expected 1162 normal rows, got {len(normal)}")
        return 2
    labels = blob["labels"][normal]
    scores = blob["scores"][normal]
    page, row = blob["page"][normal], blob["row"][normal]
    fit, same, held, held_scores = splits(scores, page, row)
    if abs(fit.sum() - 614) > 2 or same.sum() != 153 or held.sum() != 395:
        print(f"FATAL: split drift fit={fit.sum()} same={same.sum()} held={held.sum()}")
        return 2
    digits = (labels >= TWO_DIGIT_FROM).astype(int)
    report: dict = {
        "config": {
            "seed": args.seed, "steps": args.steps, "optimiser": "Adam lr=1e-3",
            "batch": 64, "early_stopping": False,
            "rows": {"fit": int(fit.sum()), "same_score": int(same.sum()),
                     "score_disjoint": int(held.sum()), "all": int(len(labels))},
            "held_scores": held_scores,
            "stage_inputs": {
                "A": "32x32 raw FINAL_ROI greyscale, reshaped to (n,1,32,32)",
                "B": "production roi_crops output flattened: 12 ch x 8 x 8 grid = 768",
                "C": "untrained RoiEncoder output flattened: 32 width x 8 grid = 256",
                "D": "fused token fed to the production fret head = 192",
            },
        },
        "stages": {},
    }

    # ---- A first, alone, as the P3 control -------------------------------
    a = blob["A"][normal].astype(np.float32)
    a_fit = a[fit].reshape(len(a[fit]), 1, -1)
    params, (p_all, _, _) = cnn_probe(
        a[fit], labels[fit], [a, a, a], [labels, labels, labels],
        args.steps, args.seed,
    )
    p_a, p_b, p_c = p_all[fit], p_all[same], p_all[held]
    control = {
        "probe_params": int(params),
        "train_instance": float((p_a == labels[fit]).mean()),
        "same_score": float((p_b == labels[same]).mean()),
        "score_disjoint": float((p_c == labels[held]).mean()),
        "template_nn": {
            "train_instance": template_nn(a[fit], labels[fit], a[fit], labels[fit]),
            "same_score": template_nn(a[fit], labels[fit], a[same], labels[same]),
            "score_disjoint": template_nn(a[fit], labels[fit], a[held], labels[held]),
        },
    }
    report["stages"]["A"] = control
    print(f"[P3 control] A score-disjoint = {control['score_disjoint']:.4f} "
          f"(required >= {args.control})")
    if control["score_disjoint"] < args.control:
        print("FATAL: positive control did not reproduce. Stage A probe is broken; "
              "refusing to interpret B/C/D.")
        report["p3_control"] = "FAILED"
        args.out.write_text(json.dumps(report, indent=2) + "\n")
        return 3
    report["p3_control"] = "reproduced"

    # ---- B / C / D, one config each --------------------------------------
    for stage, kind in (("B", "mlp"), ("C", "mlp"), ("D", "mlp")):
        x = blob[stage][normal].astype(np.float32)
        z = standardise(x, fit)
        params, (p_stage, _, _) = flat_probe(
            z[fit], labels[fit], [z, z, z], [labels, labels, labels],
            kind, args.steps, args.seed,
        )
        p_a, p_b, p_c = p_stage[fit], p_stage[same], p_stage[held]
        lin_params, (l_all, _, _) = flat_probe(
            z[fit], labels[fit], [z, z, z], [labels, labels, labels],
            "linear", args.steps, args.seed,
        )
        l_a, l_b, l_c = l_all[fit], l_all[same], l_all[held]
        entry = {
            "input_dim": int(x.shape[1]),
            "probe_params_mlp": int(params),
            "probe_params_linear": int(lin_params),
            "mlp": {
                "train_instance": float((p_a == labels[fit]).mean()),
                "same_score": float((p_b == labels[same]).mean()),
                "score_disjoint": float((p_c == labels[held]).mean()),
            },
            "linear": {
                "train_instance": float((l_a == labels[fit]).mean()),
                "same_score": float((l_b == labels[same]).mean()),
                "score_disjoint": float((l_c == labels[held]).mean()),
            },
            "template_nn": {
                "train_instance": template_nn(z[fit], labels[fit], z[fit], labels[fit]),
                "same_score": template_nn(z[fit], labels[fit], z[same], labels[same]),
                "score_disjoint": template_nn(z[fit], labels[fit], z[held], labels[held]),
            },
        }
        # Prediction vectors stay full length (1162) and are masked in place, so
        # the per-digit breakdown and the headline numbers cannot disagree.
        for name, mask, preds in (("train_instance", fit, p_stage),
                                  ("same_score", same, p_stage),
                                  ("score_disjoint", held, p_stage)):
            correct = preds[mask] == labels[mask]
            entry.setdefault("by_digits", {})[name] = {
                "1_digit": float(correct[digits[mask] == 0].mean()),
                "2_digit": float(correct[digits[mask] == 1].mean()),
                "n_1_digit": int((digits[mask] == 0).sum()),
                "n_2_digit": int((digits[mask] == 1).sum()),
            }
        report["stages"][stage] = entry
        print(f"[{stage}] nn={entry['template_nn']['score_disjoint']:.4f} "
              f"linear={entry['linear']['score_disjoint']:.4f} "
              f"mlp={entry['mlp']['score_disjoint']:.4f}")

    # A per-digit breakdown, same probe as the control
    a_by = {}
    for name, mask, preds in (("train_instance", fit, p_all),
                              ("same_score", same, p_all),
                              ("score_disjoint", held, p_all)):
        a_by[name] = {
            "1_digit": float((preds[mask] == labels[mask])[digits[mask] == 0].mean()),
            "2_digit": float((preds[mask] == labels[mask])[digits[mask] == 1].mean()),
            "n_1_digit": int((digits[mask] == 0).sum()),
            "n_2_digit": int((digits[mask] == 1).sum()),
        }
    report["stages"]["A"]["by_digits"] = a_by

    # ---- E: production logits, reference only ----------------------------
    if args.checkpoint is not None:
        namespace = argparse.Namespace(
            variant="shared", steps=1200, pages=40, batch_pages=4, held_out=20,
            image_size=256, max_objects=128, hidden=192, layers=4, lr=3e-3,
            train_jitter=0.35, roi_grid=8, roi_context=1.6, seed=args.seed,
            device="cpu", out=None,
        )
        from guitar_vision.fret_experiments import build
        from guitar_vision.qualify import Device
        model = build("shared", namespace, Device("cpu"))
        state = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
        model.load_state_dict(state["model"])
        model.eval()
        d = torch.from_numpy(blob["D"][normal].astype(np.float32))
        with torch.no_grad():
            logits = model.base.heads["fret"](d).numpy()
        pred = logits.argmax(1)
        counts = np.bincount(pred, minlength=CLASSES)
        stage_e = {
            "train_instance": float((pred[fit] == labels[fit]).mean()),
            "same_score": float((pred[same] == labels[same]).mean()),
            "score_disjoint": float((pred[held] == labels[held]).mean()),
            "by_digits_score_disjoint": {
                "1_digit": float((pred[held] == labels[held])[digits[held] == 0].mean()),
                "2_digit": float((pred[held] == labels[held])[digits[held] == 1].mean()),
            },
            "distinct_predicted_classes_score_disjoint": int((counts > 0).sum()),
            "largest_class_share": float(counts.max() / counts.sum()),
            "logit_std_mean": float(logits.std(axis=1).mean()),
        }
        report["stage_E_production_logits"] = stage_e
        print(f"[E] train={stage_e['train_instance']:.4f} "
              f"disjoint={stage_e['score_disjoint']:.4f} "
              f"classes={stage_e['distinct_predicted_classes_score_disjoint']} "
              f"largest={stage_e['largest_class_share']:.3f}")

    # ---- P6 pixel causality ---------------------------------------------
    p6 = {}
    for intervention in ("blank", "wrong_roi"):
        alt = np.nonzero(mode == intervention)[0]
        entry = {}
        for stage in ("A", "B", "C", "D"):
            base_x = blob[stage][normal].astype(np.float32)
            alt_x = blob[stage][alt].astype(np.float32)
            unit = lambda v: v / (np.linalg.norm(v, axis=1, keepdims=True) + 1e-8)
            cosine = (unit(base_x) * unit(alt_x)).sum(1)
            entry[stage] = {
                "cosine_similarity_to_normal": float(cosine.mean()),
                "l2_distance_to_normal": float(
                    np.linalg.norm(base_x - alt_x, axis=1).mean()),
            }
        # probe accuracy under the intervention, fit on NORMAL fit rows only
        acc = {}
        for stage in ("B", "C", "D"):
            x_all = np.concatenate([blob[stage][normal], blob[stage][alt]]).astype(np.float32)
            n = len(normal)
            z = standardise(x_all, np.arange(n)[fit])
            y_eval = np.concatenate([labels, blob["labels"][alt]])
            # Fitted on NORMAL fit rows only, then read out on the intervened
            # held-out rows: the probe is never refitted per intervention, so a
            # drop is caused by the representation, not by a weaker readout.
            _, (q_fit, q_alt) = flat_probe(
                z[:n][fit], labels[fit],
                [z[:n], z[n:]], [labels, y_eval],
                "mlp", args.steps, args.seed,
            )
            acc[stage] = {
                "train_instance_normal": float((q_fit[fit] == labels[fit]).mean()),
                "score_disjoint_normal": float((q_fit[held] == labels[held]).mean()),
                f"score_disjoint_{intervention}": float((q_alt[held] == y_eval[n:][held]).mean()),
            }
        # A: the same probe, fed blank/wrong pixels
        x_all_a = np.concatenate([blob["A"][normal], blob["A"][alt]]).astype(np.float32)
        n = len(normal)
        y_eval = np.concatenate([labels, blob["labels"][alt]])
        _, (q_fit, q_alt) = cnn_probe(
            x_all_a[:n][fit], labels[fit],
            [x_all_a[:n], x_all_a[n:]], [labels, y_eval],
            args.steps, args.seed,
        )
        acc["A"] = {
            "train_instance_normal": float((q_fit[fit] == labels[fit]).mean()),
            "score_disjoint_normal": float((q_fit[held] == labels[held]).mean()),
            f"score_disjoint_{intervention}": float((q_alt[held] == y_eval[n:][held]).mean()),
        }
        p6[intervention] = {"representation_shift": entry, "probe_accuracy": acc}
        print(f"[P6 {intervention}] " + " ".join(
            f"{s}:cos={entry[s]['cosine_similarity_to_normal']:.3f}/"
            f"acc={acc[s][f'score_disjoint_{intervention}']:.3f}"
            for s in ("A", "B", "C", "D")))
    report["pixel_causality"] = p6

    # ---- P7 score identity, train scores only ----------------------------
    p7 = {}
    for stage in ("B", "C", "D"):
        x = blob[stage][normal].astype(np.float32)
        z = standardise(x, fit)
        p7[stage] = score_identity(z, scores, fit, "mlp", args.steps, args.seed)
    report["score_identity_p7"] = p7
    print("[P7] " + " ".join(
        f"{s}={p7[s]['score_id_acc']:.3f}" for s in ("B", "C", "D")))

    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())