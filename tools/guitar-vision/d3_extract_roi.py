"""Extract the production FINAL_ROI for every fret object, once, for the probes.

The crops come from **production**: the loader builds the planes, the production
ROI sampler grids them, and the result is exactly the tensor the fret head would
see. Nothing here re-derives the crop.

What is kept alongside each crop is deliberately thin: the label, and enough
provenance (score, string, object index) to build the splits. No coordinates are
carried into the probe - the probe receives pixels and an integer label, nothing
else.
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
sys.path.insert(0, str(_HERE / "python"))

from guitar_vision.dataset import (  # noqa: E402
    OBJECT_TYPE_INDEX,
    load_dataset,
    string_for_object,
)
from h1_direct_roi_probe import sample_roi  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--records", type=Path, required=True)
    parser.add_argument("--views", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--plane", type=int, default=256)
    parser.add_argument("--crop", type=int, default=32)
    parser.add_argument("--split-at", type=int, default=40)
    args = parser.parse_args()

    samples = load_dataset(args.records, args.views, size=(args.plane, args.plane), limit=0)
    scores: list[str] = []
    rois: list[np.ndarray] = []
    labels: list[int] = []
    strings: list[int] = []
    instances: list[int] = []
    split: list[int] = []

    for page_index, sample in enumerate(samples):
        record = json.loads(
            (args.records / f"{sample['score_id']}.record.json").read_text()
        )
        by_index = {o["index"]: o for o in record["objects"]}
        mask = torch.ones(sample["object_type"].shape[0], dtype=torch.bool)
        roi = sample_roi(
            sample["images"].unsqueeze(0),
            sample["boxes"].unsqueeze(0),
            mask.unsqueeze(0),
            sample["view"].unsqueeze(0),
            args.crop,
        )
        roi = roi.reshape(-1, args.crop, args.crop).numpy().astype(np.float32)
        for row in range(sample["object_type"].shape[0]):
            if int(sample["object_type"][row]) != 1:
                continue
            # The record object matching this row, by fret and plane box. The
            # loader emits objects in record order, so index alignment is exact.
            obj = by_index.get(row)
            scores.append(sample["score_id"])
            rois.append(roi[row])
            labels.append(int(sample["fret"][row]))
            strings.append(int(sample["string"][row]))
            instances.append(int(sample["boxes"].shape[0] * 0 + row))
            split.append(0 if page_index < args.split_at else 1)

    data = np.stack(rois)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.out,
        rois=data,
        labels=np.asarray(labels, dtype=np.int64),
        strings=np.asarray(strings, dtype=np.int64),
        instances=np.asarray(instances, dtype=np.int64),
        split=np.asarray(split, dtype=np.int64),
        scores=np.asarray(scores),
    )
    print(f"wrote {args.out}")
    print(f"  crops {data.shape} | train {int((np.asarray(split)==0).sum())} | held {int((np.asarray(split)==1).sum())}")
    print(f"  distinct scores {len(set(scores))} | classes {len(set(labels))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
