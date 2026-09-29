"""Phase A / A3: the full input-channel gap between the two domains.

The model's object token is

    visual(9x grid of a 3x-expanded box) + object_projection([object_features(24),
    graph_features(16)]) + source_projection(source_features(16))

Production does not merely change pixels. build_corpus.py deliberately leaves
`sourceTensor` at production's [0.0]*16 and `sourceGraph` UNAVAILABLE, and the
raster detector emits sparser `frozenGraphObservation` than the factory. So the
"visual representation" gap the adaptation campaign attacked includes three
scalar/feature channels that have nothing to do with pixels.

This script measures, per channel, the distribution in each domain on the
records the model actually consumes, and the DIAGNOSIS-style "swap this channel
toward production" effect on the SOURCE corpus so the channels can be ranked
by how much pitch accuracy each one costs.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

H.add_runtime_to_path()
from piano_vision.v2.data import build_inputs, attach_targets, collate, _bounds, _center  # noqa: E402
from piano_vision.v25.data import attach_object_page_geo  # noqa: E402
from piano_vision.v25.performance import prepare_batch  # noqa: E402


def collect_domain(name, ordered_by_score, resolver, max_records=60):
    rows = []
    n = 0
    for entry in ordered_by_score:
        records = entry[1] if isinstance(entry, tuple) else entry
        for rec in records:
            if n >= max_records:
                break
            sample, selected, lookup, relations, nodes = build_inputs(
                rec, records, resolver, CURRENT_CONFIG)
            rows.append(sample)
            n += 1
    return rows


def channel_stats(samples):
    def stack(key, sub=None):
        vals = []
        for s in samples:
            t = s[key] if sub is None else s[key][sub]
            vals.append(t.reshape(-1).float().numpy())
        return np.concatenate(vals) if vals else np.zeros(0)
    out = {}
    for key, sub in (("object_features", None), ("graph_features", None),
                     ("source_features", None)):
        rows = []
        for s in samples:
            t = s[key] if sub is None else s[key][sub]
            if t.dim() == 1:
                t = t[None]
            rows.append(t.float().numpy())
        if not rows:
            continue
        m = np.concatenate(rows, 0)          # (total_objects, width)
        out[key] = {
            "rows": int(m.shape[0]),
            "width": int(m.shape[1]),
            "mean_abs": float(np.abs(m).mean()),
            "frac_zero": float((m == 0).mean()),
            "per_dim_mean": [round(float(x), 4) for x in m.mean(0)[:24]],
        }
    # object_boxes are view-normalized after map_box
    b = np.concatenate([s["object_boxes"].reshape(-1, 4).float().numpy() for s in samples])
    out["object_boxes_xyxy_viewnorm"] = {
        "w": {"mean": float((b[:, 2] - b[:, 0]).mean()),
              "p50": float(np.median(b[:, 2] - b[:, 0]))},
        "h": {"mean": float((b[:, 3] - b[:, 1]).mean()),
              "p50": float(np.median(b[:, 3] - b[:, 1]))},
    }
    return out


def main():
    global CURRENT_CONFIG
    runtime = H.load_runtime("cpu")
    CURRENT_CONFIG = runtime.config

    src_scores = H.source_scores(3, split="validation")
    src_resolver = H.source_resolver()
    src = collect_domain("source", src_scores, src_resolver, max_records=60)

    prod = H.realpdf_scores("validation")
    prod_resolver = H.realpdf_resolver()
    pr = collect_domain("production", prod, prod_resolver, max_records=60)

    report = {
        "source": channel_stats(src),
        "production": channel_stats(pr),
        "n_source_records": len(src),
        "n_production_records": len(pr),
    }

    # The single scalar the DIAGNOSIS called harmless: object_features index 18
    # is 1.0 iff geometrySource == "glyph-font-bbox". Print it explicitly.
    def gf18(samples):
        vals = []
        for s in samples:
            v = s["object_features"][:, 18].numpy()
            vals.append(v)
        v = np.concatenate(vals)
        return {"mean": float(v.mean()), "frac_one": float((v == 1).mean()),
                "frac_zero": float((v == 0).mean())}
    report["object_features_dim18_geometrySource_glyphbbox"] = {
        "source": gf18(src), "production": gf18(pr)}

    path = H.write_json("phase_a_channels.json", report)
    print(json.dumps(report, indent=2, sort_keys=True))
    print("wrote", path)


if __name__ == "__main__":
    main()
