"""CASE C localisation for the trained `ROI_ONLY_NO_TOKEN` checkpoint.

## What the run showed

Deleting `+ tokens` did not rescue transfer. Score-disjoint 0.0582 (23/395) against a
0.0734 chance baseline and a frozen-`shared` 0.0684 -- a lift of -0.0152 versus chance,
with a Wilson 95% interval of [0.0391, 0.0859] that *contains* chance.

More telling than the held-out number: the model did not learn the fret task at all.
Train fret accuracy 0.0678, the single-batch fret loss bottomed at 2.9241 at step 145
and then rose to 3.0189, while `object_type` and `string` fell to ~0.10. On held-out it
emitted exactly two distinct classes across 395 objects: 13 for 371 of them and 1 for
24. Pixel ablation scored 0.0582, identical to normal, so the fret glyphs contribute
nothing at all. This is a constant predictor, not a mis-trained one.

## The question this answers

The frozen-checkpoint probes at 38d6fa7111 measured the *untrained* representation
feeding this head at 0.6354 score-disjoint, and the stride-1 crop at 0.7899. So the
information was demonstrably present in what the encoder receives. Training therefore
had to destroy it somewhere, or never expose it. Those are very different conclusions
and they call for different next experiments.

So the same fixed probe is re-run, unchanged, on the *trained* model's stages:

    B   stride-1 feature ROI   (frozen shared measured 0.7899 linear)
    C   trained RoiEncoder out (frozen shared measured 0.6354, untrained encoder)
    P   roi_projection output   (the 192-d vector the fret head actually reads)

If P probes high while the head reads 6.78%, the representation is fine and the head's
optimisation is at fault. If P probes at chance too, the trained ROI path collapsed
and the encoder is the thing to fix. Nothing here trains anything; the checkpoint is
frozen and read-only.

## Also measured here

- The same-score unseen-instance split. The first pass computed it per *page*, which
  flagged 767 of 1162 objects instead of the intended ~20%, because a page straddling
  the 80% cut is taken whole. Recomputed per object below.
- The frozen `shared` checkpoint's unrelated-head metrics, so the G7 comparison has a
  real reference instead of an assertion that nothing moved.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE / "python"))

import d8_stage_probes as d8  # noqa: E402
import h74_roi_only_no_token as h74  # noqa: E402
from guitar_vision.dataset import collate, load_dataset  # noqa: E402
from guitar_vision.fret_experiments import build, decode, roi_crops  # noqa: E402
from guitar_vision.qualify import Device  # noqa: E402

CLASSES = 20
SEED = 11


def args_for(variant: str, image_size: int, max_objects: int) -> argparse.Namespace:
    return argparse.Namespace(
        variant=variant, steps=1200, pages=40, batch_pages=4, held_out=20,
        image_size=image_size, max_objects=max_objects, hidden=192, layers=4,
        lr=3e-3, train_jitter=0.35, roi_grid=8, roi_context=1.6, seed=SEED,
        device="cpu", out=None,
    )


def same_score_object_mask(everything, train_pages: int, max_objects: int):
    """Per-object same-score split: last 20% of each score's objects, ordered.

    Page-level flagging was the bug this replaces. A page that straddles the 80% cut
    was taken whole, so 66% of objects were selected instead of 20% and the number
    was not comparable to the frozen-checkpoint 0.1765.
    """
    order: dict[str, list[tuple[int, int]]] = {}
    for page in range(train_pages):
        sample = everything[page]
        rows = (sample["object_type"] == 1).nonzero(as_tuple=True)[0].tolist()
        for row in rows:
            order.setdefault(sample["score_id"], []).append((page, row))
    flags: dict[tuple[int, int], bool] = {}
    for entries in order.values():
        entries.sort()
        cut = int(round(len(entries) * 0.8))
        for index, key in enumerate(entries):
            flags[key] = index >= cut
    return flags


def measure_on_keys(model, everything, pages, device, max_objects, key_flags, chunk=3):
    """Fret accuracy restricted to a specific set of (page, row) objects."""
    model.eval()
    correct = total = 0
    # `pages` is a contiguous slice of `everything` starting at page 0, so the
    # page index of a chunk is its own start offset. Indexing `pages[start]`
    # returns a sample dict, not a page number.
    for start in range(0, len(pages), chunk):
        batch = collate(pages[start : start + chunk], max_objects)
        batch = {k: (v.to(device.torch) if torch.is_tensor(v) else v)
                 for k, v in batch.items()}
        with torch.no_grad():
            out = model(batch)
            numbers = decode(out)
        for index in range(batch["boxes"].shape[0]):
            page = start + index
            rows = (batch["object_type"][index] == 1).nonzero(as_tuple=True)[0].tolist()
            for row in rows:
                if not key_flags.get((page, row), False):
                    continue
                if int(numbers[index, row]) == int(batch["fret"][index, row]):
                    correct += 1
                total += 1
        del batch, out
    return {"accuracy": round(correct / max(total, 1), 6), "correct": correct, "total": total}


def extract_stages(model, everything, device, args, grid=8):
    """B, C and the projection output P for every fret object. No gradients."""
    captured: dict[str, torch.Tensor] = {}
    hook = model.fret_classifier.register_forward_pre_hook(
        lambda _module, inputs: captured.__setitem__("P", inputs[0].detach().clone())
    )
    store: dict[str, list[np.ndarray]] = {"B": [], "C": [], "P": []}
    labels: list[int] = []
    scores: list[str] = []
    pages: list[int] = []
    rows: list[int] = []
    model.eval()
    with torch.no_grad():
        for page, sample in enumerate(everything):
            batch = collate([sample], args.max_objects)
            batch = {k: (v.to(device.torch) if torch.is_tensor(v) else v)
                     for k, v in batch.items()}
            out = model(batch)
            finest = model.features[0]
            crops = roi_crops(finest, batch["boxes"], batch["object_mask"], grid, args.roi_context)
            encoded = model.encoder(
                crops, batch["object_mask"], grid, model.base.backbone.output_channels[0]
            )
            keep = (batch["object_type"][0] == 1).nonzero(as_tuple=True)[0].tolist()
            store["B"].append(crops[0, keep].numpy())
            store["C"].append(encoded[0, keep].reshape(len(keep), -1).numpy())
            store["P"].append(captured["P"][0, keep].numpy())
            for row in keep:
                labels.append(int(batch["fret"][0, row]))
                scores.append(sample["score_id"])
                pages.append(page)
                rows.append(row)
            del batch, out, crops, encoded
    hook.remove()
    return (
        {k: np.concatenate(v).astype(np.float32) for k, v in store.items()},
        np.asarray(labels), np.asarray(scores), np.asarray(pages), np.asarray(rows),
    )


def probe_stages(store, labels, scores, page, row, steps: int) -> dict:
    """The d8 protocol, unchanged: same split, seed, optimiser, budget, readouts."""
    fit, same, held, _ = d8.splits(scores, page, row)
    digits = (labels >= 10).astype(int)
    result: dict = {"rows": {"fit": int(fit.sum()), "same": int(same.sum()),
                             "held": int(held.sum())}}
    for stage, x in store.items():
        z = d8.standardise(x, fit)
        params, (p_all, _, _) = d8.flat_probe(
            z[fit], labels[fit], [z, z, z], [labels, labels, labels],
            "mlp", steps, SEED,
        )
        l_params, (l_all, _, _) = d8.flat_probe(
            z[fit], labels[fit], [z, z, z], [labels, labels, labels],
            "linear", steps, SEED,
        )
        entry = {
            "input_dim": int(x.shape[1]),
            "mlp": {
                "train_instance": float((p_all[fit] == labels[fit]).mean()),
                "same_score": float((p_all[same] == labels[same]).mean()),
                "score_disjoint": float((p_all[held] == labels[held]).mean()),
            },
            "linear": {
                "train_instance": float((l_all[fit] == labels[fit]).mean()),
                "same_score": float((l_all[same] == labels[same]).mean()),
                "score_disjoint": float((l_all[held] == labels[held]).mean()),
            },
            "template_nn": {
                "train_instance": d8.template_nn(z[fit], labels[fit], z[fit], labels[fit]),
                "same_score": d8.template_nn(z[fit], labels[fit], z[same], labels[same]),
                "score_disjoint": d8.template_nn(z[fit], labels[fit], z[held], labels[held]),
            },
            "mlp_params": int(params), "linear_params": int(l_params),
        }
        correct = p_all[held] == labels[held]
        entry["by_digits_score_disjoint"] = {
            "1_digit": float(correct[digits[held] == 0].mean()),
            "2_digit": float(correct[digits[held] == 1].mean()),
        }
        result[stage] = entry
        print(f"  [{stage}] linear {entry['linear']['score_disjoint']:.4f} "
              f"mlp {entry['mlp']['score_disjoint']:.4f} "
              f"nn {entry['template_nn']['score_disjoint']:.4f} "
              f"(train-inst mlp {entry['mlp']['train_instance']:.4f})", flush=True)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--notoken-ckpt", type=Path,
                        default=Path("tmp/gvprobe/roi-only-ckpt/step1200"))
    parser.add_argument("--shared-ckpt", type=Path,
                        default=Path("tmp/gvprobe/lc-run/step1200"))
    parser.add_argument("--out", type=Path,
                        default=Path("tmp/gvprobe/roi-only-localize.json"))
    parser.add_argument("--steps", type=int, default=3000)
    parser.add_argument("--image-size", type=int, default=256)
    parser.add_argument("--max-objects", type=int, default=128)
    args = parser.parse_args()

    device = Device("cpu")
    everything = load_dataset(
        _REPO / "datasets/guitar-vision/synthetic/train/records",
        _REPO / "datasets/guitar-vision/synthetic/train/views",
        size=(args.image_size, args.image_size), limit=0,
    )
    train_pages, held_pages = 40, 20
    report: dict = {}

    # ---- G7: the frozen shared reference for every head -------------------
    print("=== frozen shared checkpoint: unrelated-head reference ===", flush=True)
    shared_args = args_for("shared", args.image_size, args.max_objects)
    shared = build("shared", shared_args, device)
    shared.load_state_dict(torch.load(args.shared_ckpt / "state.pt", map_location="cpu",
                                      weights_only=False)["model"])
    report["shared_reference_heads"] = {
        "train": h74.measure_other_heads(shared, everything[:train_pages], device,
                                         args.max_objects),
        "held_out": h74.measure_other_heads(shared, everything[train_pages:train_pages + held_pages],
                                            device, args.max_objects),
    }
    for split, values in report["shared_reference_heads"].items():
        print(f"  {split}: " + " ".join(
            f"{k} {v['accuracy']:.4f}" for k, v in values.items()), flush=True)

    # ---- the trained no-token checkpoint ---------------------------------
    print("\n=== ROI_ONLY_NO_TOKEN terminal checkpoint ===", flush=True)
    na = args_for("ROI_ONLY_NO_TOKEN", args.image_size, args.max_objects)
    model = build("ROI_ONLY_NO_TOKEN", na, device)
    model.load_state_dict(torch.load(args.notoken_ckpt / "state.pt", map_location="cpu",
                                     weights_only=False)["model"])
    model.eval()
    for parameter in model.parameters():
        parameter.requires_grad_(False)

    flags = same_score_object_mask(everything, train_pages, args.max_objects)
    print(f"  same-score unseen objects: {sum(flags.values())}", flush=True)
    same = measure_on_keys(model, everything, everything[:train_pages], device,
                           args.max_objects, flags)
    same["comparison_frozen_stage_D"] = 0.1765
    report["same_score_unseen_fixed"] = same
    print(f"  same-score unseen-instance fret: {same['accuracy']:.4f} "
          f"({same['correct']}/{same['total']})  [frozen stage D was 0.1765]", flush=True)

    print("\n=== probing the trained ROI path (same protocol as 38d6fa7111) ===", flush=True)
    store, labels, scores, page, row = extract_stages(model, everything, device, na)
    report["trained_probe"] = probe_stages(store, labels, scores, page, row, args.steps)
    report["frozen_shared_probe_reference"] = {
        "B_linear": 0.7899, "C_linear_untrained_encoder": 0.6354, "D_linear": 0.0684,
        "A_cnn": 0.9342,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())