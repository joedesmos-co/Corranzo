"""Phase A / P2+P3: geometry repair and the PIXEL-ONLY swap.

P2  PRODUCTION GEOMETRY REPAIR
    Hold production pixels. Move ONE input channel at a time toward the source
    convention. Whatever recovers the most written pitch is the bottleneck.

P3  PIXEL-ONLY SWAP  <-- the arm the prior DIAGNOSIS never ran
    Hold geometry, objects and labels byte-identical. Swap ONLY the raster:
      production_raster  = PyMuPDF 150 DPI            (what the model sees now)
      factory_raster     = pdfjs-dist 1000px ~72 DPI  (what it was trained on)
    Same music, same detector, same labels. Any difference is pure pixel domain.
"""
from __future__ import annotations

import copy
import json
import sys
from collections import OrderedDict
from pathlib import Path

import numpy as np
import torch
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

H.add_runtime_to_path()
from piano_vision.v2.data import build_inputs, attach_targets, collate  # noqa: E402
from piano_vision.v25.data import attach_object_page_geo  # noqa: E402
from piano_vision.v25.performance import prepare_batch  # noqa: E402

FACTORY_RASTER = H.V26_ROOT / "out/factory_raster"
SPLIT_DOC = json.loads((H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())


class FactoryRasterResolver:
    """RealPdfPageResolver with ONLY the page source swapped.

    Records, objects, geometry and labels are untouched. Page coordinates are
    normalized, so a differently sized page raster maps through crop_view with
    no change to any target.
    """

    def __init__(self, index_path, max_pages=3):
        sys.path.insert(0, str(H.V26_ROOT / "tools/real-pdf-adaptation"))
        from realpdf_data import RealPdfPageResolver
        self._inner = RealPdfPageResolver(index_path, max_pages=max_pages)
        self.pages = OrderedDict()
        self.max_pages = max_pages

    def page(self, record):
        from piano_vision.v2.data import source_order
        sid = record["scoreId"]
        n = source_order(record)[0]
        path = FACTORY_RASTER / sid / f"page-{n}.png"
        if not path.is_file():
            return self._inner.page(record)
        if path not in self.pages:
            with Image.open(path) as im:
                self.pages[path] = im.convert("L").copy()
        self.pages.move_to_end(path)
        while len(self.pages) > self.max_pages:
            self.pages.popitem(last=False)
        return self.pages[path]


def _restaff_boxes(rec, w_spaces, h_spaces):
    """Rewrite notehead boxes to a fixed staff-space size, centred in place."""
    m = rec["input"]["modelInput"]
    bands = m.get("geometry", {}).get("staffBands", {}).get("staffBands", [])
    spaces = [(float(b["y1"]) - float(b["y0"])) / 4.0 for b in bands]
    spaces = [s for s in spaces if s > 0]
    if not spaces:
        return
    s = float(np.median(spaces))
    hw, hh = w_spaces * s / 2, h_spaces * s / 2
    for obj in m.get("physicalObjects", []):
        if obj.get("kind") != "notehead":
            continue
        b = obj["bounds"]
        cx = (float(b["x0"]) + float(b["x1"])) / 2
        cy = (float(b["y0"]) + float(b["y1"])) / 2
        b["x0"], b["x1"] = cx - hw, cx + hw
        b["y0"], b["y1"] = cy - hh, cy + hh


def _retype_geometry_source(rec):
    """object_features[18] is 1.0 iff geometrySource == 'glyph-font-bbox'."""
    for obj in rec["input"]["modelInput"].get("physicalObjects", []):
        obj["geometrySource"] = "raster-detected"
        obj["geometryConfidence"] = 0.70


ARMS = {
    "P0_production_as_is": (None, "production"),
    "P1_prod_raster_box_1.18x1.84": (lambda r: _restaff_boxes(r, 1.18, 1.84), "production"),
    "P2_prod_raster_box_1.3x2.0": (lambda r: _restaff_boxes(r, 1.30, 2.00), "production"),
    "P3_prod_raster_retype_source": (_retype_geometry_source, "production"),
    "P4_FACTORY_RASTER_same_geometry": (None, "factory"),
    "P5_FACTORY_RASTER_plus_box_1.18x1.84": (lambda r: _restaff_boxes(r, 1.18, 1.84), "factory"),
}


def run_arm(runtime, groups, resolver_factory, mutate, max_records):
    acc = H.Accumulator()
    per_score = {}
    for sid, ordered in groups:
        resolver = resolver_factory()
        s = H.Accumulator()
        for rec in ordered[:max_records]:
            try:
                r2 = copy.deepcopy(rec)
                if mutate:
                    mutate(r2)
                sample, selected, lookup, relations, nodes = build_inputs(
                    r2, ordered, resolver, runtime.config)
                sample = attach_targets(sample, r2, selected, lookup, relations, nodes)
                sample = attach_object_page_geo(sample, selected)
                batch = prepare_batch(collate([sample]), consistency=False)
                batch = runtime._to_device(batch)
                out = H.forward(runtime, batch)
                s.add(out, batch)
            except Exception:
                continue
        per_score[sid] = s.report()
        acc.pitch_hit += s.pitch_hit; acc.pitch_tot += s.pitch_tot
        acc.step_hit += s.step_hit; acc.step_tot += s.step_tot
        acc.dur_hit += s.dur_hit; acc.dur_tot += s.dur_tot
        acc.records += s.records
    return acc.report(), per_score


def main():
    split = sys.argv[1] if len(sys.argv) > 1 else "validation"
    max_records = int(sys.argv[2]) if len(sys.argv) > 2 else 25
    runtime = H.load_runtime("cpu")
    groups = H.realpdf_scores(split)
    print(f"split={split} scores={len(groups)} max_records/score={max_records}\n", flush=True)

    out = {"split": split, "max_records_per_score": max_records, "arms": {}}
    base = None
    for name, (mutate, raster) in ARMS.items():
        factory = (raster == "factory")
        rf = (lambda: FactoryRasterResolver(H.REALPDF_INDEX)) if factory else H.realpdf_resolver
        rep, per = run_arm(runtime, groups, rf, mutate, max_records)
        if base is None:
            base = rep
        rep["delta_written_pitch_vs_P0"] = round(
            (rep["written_pitch_accuracy"] or 0) - (base["written_pitch_accuracy"] or 0), 6)
        out["arms"][name] = {"summary": rep, "per_score": per}
        print(f"{name:<40} pitch={rep['written_pitch_accuracy']} "
              f"step={rep['pitch_staff_step_accuracy']} dur={rep['duration_accuracy']} "
              f"n={rep['written_pitch_labels']} d={rep['delta_written_pitch_vs_P0']:+}", flush=True)

    path = H.write_json(f"phase_a_pixels_{split}.json", out)
    print("wrote", path)


if __name__ == "__main__":
    main()
