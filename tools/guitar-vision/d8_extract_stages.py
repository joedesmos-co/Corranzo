"""Extract every production representation stage for every fret object.

## What is frozen

The 1200-step `shared` checkpoint. Nothing is retrained and nothing is
backpropagated. This measures how much fret information survives at each stage of
the production visual path, so the collapse can be located rather than guessed.

## The stages

    A  raw FINAL_ROI pixels          32x32, the production ROI sampler on the plane
    B  stride-1 feature ROI          production `roi_crops`, before any encoder
    C  RoiEncoder output             immediately after `RoiEncoder`
    D  fused token                   immediately before the production fret head

## An honesty note on stage C

`FretVariantModel` only builds a `RoiEncoder` when `kind != "shared"`. The frozen
checkpoint is `shared`, so **it has no trained RoiEncoder**. C is therefore computed
by applying an *untrained*, fixed-seed `RoiEncoder` to B.

That is a weaker test than a trained C and is reported as such, with the asymmetry
stated: if random-C still supports the classification, a trained C certainly could,
so high-C exonerates the encoder architecture. Low-C does **not** convict it, because
a trained encoder might recover what a random one scrambles. C is used to rule the
encoder out, never to rule it in.

## Intermediates

D is captured by wrapping the production fret head's own `forward`, so the recorded
tensor is literally that head's input rather than a reconstruction of it. B and C
are produced by the production `roi_crops` and `RoiEncoder` modules.
"""
from __future__ import annotations

import argparse
import json
import sys
import types
from pathlib import Path
from typing import Any

import numpy as np
import torch

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
sys.path.insert(0, str(_HERE / "python"))

from guitar_vision.dataset import collate, load_dataset  # noqa: E402
from guitar_vision.fret_experiments import (  # noqa: E402
    RoiEncoder,
    build,
    roi_crops,
    _blank_images,
)
from h1_direct_roi_probe import sample_roi  # noqa: E402
from guitar_vision.qualify import Device  # noqa: E402

SEED = 11


def wrong_roi_boxes(batch: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    out = dict(batch)
    boxes = batch["boxes"].clone()
    is_fret = batch["object_mask"] & (batch["object_type"] == 1)
    for i in range(boxes.shape[0]):
        rows = is_fret[i].nonzero(as_tuple=True)[0]
        if rows.numel() < 2:
            continue
        boxes[i, rows] = boxes[i, rows][torch.roll(torch.arange(rows.numel()), 1)]
    out["boxes"] = boxes
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--records", type=Path, required=True)
    parser.add_argument("--views", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--plane", type=int, default=256)
    parser.add_argument("--crop", type=int, default=32)
    parser.add_argument("--grid", type=int, default=8)
    parser.add_argument("--context", type=float, default=1.6)
    parser.add_argument("--chunk", type=int, default=3)
    parser.add_argument("--split-at", type=int, default=40)
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()

    device = Device(args.device)
    namespace = argparse.Namespace(
        variant="shared", steps=1200, pages=args.split_at, batch_pages=4,
        held_out=20, image_size=args.plane, max_objects=128, hidden=192, layers=4,
        lr=3e-3, train_jitter=0.35, roi_grid=args.grid, roi_context=args.context,
        seed=SEED, device=args.device, out=None,
    )
    model = build("shared", namespace, device)
    state = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    model.load_state_dict(state["model"])
    model.eval()
    for parameter in model.parameters():
        parameter.requires_grad_(False)

    channels0 = model.base.backbone.output_channels[0]
    torch.manual_seed(SEED)
    encoder = RoiEncoder(channels0, width=32, depth=3).to(device.torch).eval()
    for parameter in encoder.parameters():
        parameter.requires_grad_(False)

    # Capture the fret head's own input: that IS the fused representation D.
    captured: dict[str, torch.Tensor] = {}
    original_head = model.base.heads["fret"].forward

    def spy(_module, tokens):
        captured["D"] = tokens.detach().clone()
        return original_head(tokens)

    model.base.heads["fret"].forward = types.MethodType(spy, model.base.heads["fret"])

    everything = load_dataset(
        args.records, args.views, size=(args.plane, args.plane), limit=0
    )

    store: dict[str, list[np.ndarray]] = {k: [] for k in ("A", "B", "C", "D")}
    labels: list[int] = []
    strings: list[int] = []
    scores: list[str] = []
    page_index: list[int] = []
    row_index: list[int] = []
    intervention: list[str] = []

    def run(mode: str) -> None:
        for page, sample in enumerate(everything):
            for start in range(0, 1, args.chunk):
                chunk = [sample]
                batch = collate(chunk, 128)
                if mode == "blank":
                    batch = _blank_images(batch)
                elif mode == "wrong_roi":
                    batch = wrong_roi_boxes(batch)
                batch = {
                    k: (v.to(device.torch) if torch.is_tensor(v) else v)
                    for k, v in batch.items()
                }
                with torch.no_grad():
                    model.forward(batch)
                    b_crops = roi_crops(
                        model.features[0], batch["boxes"], batch["object_mask"],
                        args.grid, args.context,
                    )
                    c_out = encoder(
                        b_crops, batch["object_mask"], args.grid, channels0
                    )
                    # sample_roi is already batched: images (B, planes, 1, H, W),
                    # boxes (B, N, 4), mask and view (B, N).
                    mask = torch.ones(
                        batch["object_type"].shape[-1], dtype=torch.bool,
                        device=batch["object_type"].device,
                    ).unsqueeze(0)
                    a_roi = sample_roi(
                        batch["images"], batch["boxes"], mask,
                        batch["view"], args.crop,
                    )
                d_token = captured["D"]
                # collate keeps the batch axis: these are (1, N) / (1, N, 4).
                keep = [
                    i for i in range(batch["object_type"].shape[-1])
                    if int(batch["object_type"][0, i].item()) == 1
                ]
                store["A"].append(a_roi.reshape(-1, args.crop, args.crop)[keep].numpy())
                store["B"].append(b_crops[0, keep].numpy())
                store["C"].append(c_out[0, keep].reshape(len(keep), -1).numpy())
                store["D"].append(d_token[0, keep].numpy())
                for i in keep:
                    labels.append(int(batch["fret"][0, i].item()))
                    strings.append(int(batch["string"][0, i].item()))
                    scores.append(sample["score_id"])
                    page_index.append(page)
                    row_index.append(i)
                    intervention.append(mode)
                del batch, b_crops, c_out, a_roi, d_token

    # All three interventions land in one store, tagged by the `mode` column.
    # Resetting between passes would discard the normal run - which is the only one
    # the representation curve is reported from.
    run("normal")
    print(f"normal pass done; B width per object = {store['B'][0].shape[-1]}")
    run("blank")
    run("wrong_roi")

    payload = {k: np.concatenate(v).astype(np.float32) for k, v in store.items()}
    payload["labels"] = np.asarray(labels, dtype=np.int64)
    payload["strings"] = np.asarray(strings, dtype=np.int64)
    payload["scores"] = np.asarray(scores)
    payload["page"] = np.asarray(page_index, dtype=np.int64)
    payload["row"] = np.asarray(row_index, dtype=np.int64)
    payload["mode"] = np.asarray(intervention)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.out, **payload)
    meta = {
        "stage_shapes": {k: list(v.shape) for k, v in payload.items() if k[:1] in "ABCD"},
        "stride1_channels": int(channels0),
        "encoder_note": "C uses an UNTRAINED fixed-seed RoiEncoder; shared has none",
        "grid": args.grid, "context": args.context, "crop": args.crop,
        "checkpoint": str(args.checkpoint), "seed": SEED,
    }
    args.out.with_suffix(".json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"wrote {args.out}")
    print(json.dumps(meta, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())