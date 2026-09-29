"""Phase E3 - adaptation-split evaluation with the FROZEN metric definition.

`evaluate_realpdf.py` deliberately refuses to gate on the adaptation split: it
is the only split an optimizer may ever see, so scoring it would invite
selection on training data. The Phase E report needs adaptation numbers, so
they are produced here with the SAME canonical definition, quoted from the
frozen report's `metric_definition` block, and clearly labelled as a diagnostic
rather than a gate:

    written pitch : predicted (step, octave, accidental) == MusicXML written pitch
    derived MIDI  : MIDI derived from (step, octave, accidental) == MusicXML MIDI
    duration      : predicted (writtenType, dots) == MusicXML (writtenType, dots),
                    scored on the duration heads only, never conditioned on pitch

This reads the frozen metric block and refuses to run if the version has moved.
"""
from __future__ import annotations

import copy
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

H.add_runtime_to_path()
from piano_vision.v2.data import build_inputs, attach_targets, collate  # noqa: E402
from piano_vision.v25.data import attach_object_page_geo  # noqa: E402
from piano_vision.v25.performance import prepare_batch  # noqa: E402

DUR_TYPES = ["unknown", "maxima", "long", "breve", "whole", "half", "quarter",
             "eighth", "16th", "32nd", "64th", "128th", "256th"]
EXPECTED_METRIC_VERSION = "real-pdf-metric-v1"


def step_letter(v):
    return str(v.get("step") or "").upper() or None


def midi_of(step, octave, alter):
    base = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    return 12 * (int(octave) + 1) + base[str(step).upper()] + int(alter or 0)


def wilson(k, n, z=1.96):
    if not n:
        return (None, None)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / d
    return (round(max(0.0, c - h), 4), round(min(1.0, c + h), 4))


def evaluate(runtime, split, max_records=0):
    groups = H.realpdf_scores(split)
    per = {}
    agg = defaultdict(int)
    for sid, ordered in groups:
        resolver = H.realpdf_resolver()
        k = n = km = nm = kd = nd = 0
        for rec in ordered[:max_records or None]:
            try:
                sample, selected, lookup, relations, nodes = build_inputs(
                    rec, ordered, resolver, runtime.config)
                sample = attach_targets(sample, rec, selected, lookup, relations, nodes)
                sample = attach_object_page_geo(sample, selected)
                batch = prepare_batch(collate([sample]), consistency=False)
                batch = runtime._to_device(batch)
                with torch.inference_mode():
                    out = runtime.model(batch, decode_notation=False, return_memory=False)
            except Exception:
                continue
            heads = out["object"]
            tg = batch["targets"]["object"]
            for i in range(int(batch["object_mask"].shape[1])):
                ms = bool(tg["pitch_written_step"]["mask"][0][i].item())
                if ms:
                    ps = step_letter({"step": "CDEFGAB"[int(heads["pitch_written_step"][0][i].argmax())]})
                    po = int(heads["pitch_octave"][0][i].argmax())
                    pa = int(heads["pitch_accidental"][0][i].argmax()) - 3
                    ts = step_letter({"step": "CDEFGAB"[int(tg["pitch_written_step"]["target"][0][i])]})
                    to = int(tg["pitch_octave"]["target"][0][i])
                    ta = int(tg["pitch_accidental"]["target"][0][i]) - 3
                    n += 1
                    if ps == ts and po == to and pa == ta:
                        k += 1
                    if midi_of(ps, po, pa) == midi_of(ts, to, ta):
                        km += 1
                mdd = bool(tg["duration_type"]["mask"][0][i].item())
                if mdd:
                    nd += 1
                    if (int(heads["duration_type"][0][i].argmax()) ==
                            int(tg["duration_type"]["target"][0][i]) and
                            int(heads["duration_dots"][0][i].argmax()) ==
                            int(tg["duration_dots"]["target"][0][i])):
                        kd += 1
        lo, hi = wilson(k, n)
        per[sid] = {"n_pitch": n, "written_pitch_accuracy": round(k / n, 4) if n else None,
                    "ci95_written_pitch": [lo, hi] if n else None,
                    "derived_midi_accuracy": round(km / n, 4) if n else None,
                    "duration_accuracy": round(kd / nd, 4) if nd else None,
                    "n_duration": nd}
        agg["k"] += k; agg["n"] += n; agg["km"] += km
        agg["kd"] += kd; agg["nd"] += nd
    lo, hi = wilson(agg["k"], agg["n"])
    return {
        "split": split, "records_scored": len(per),
        "written_pitch_accuracy": round(agg["k"] / agg["n"], 4) if agg["n"] else None,
        "written_pitch_labels": agg["n"], "written_pitch_correct": agg["k"],
        "ci95_written_pitch": [lo, hi],
        "derived_midi_accuracy": round(agg["km"] / agg["n"], 4) if agg["n"] else None,
        "duration_accuracy": round(agg["kd"] / agg["nd"], 4) if agg["nd"] else None,
        "duration_labels": agg["nd"],
        "per_score": per}


def main():
    ref = json.loads((H.V26_ROOT / "out/eval_champion_gates.json").read_text())
    mv = ref["metric_definition"].get("version")
    if mv != EXPECTED_METRIC_VERSION:
        raise SystemExit(f"frozen metric version moved: {mv} != {EXPECTED_METRIC_VERSION}")
    runtime = H.load_runtime("cpu")
    out = {"metric_definition_version": mv,
           "note": ("adaptation split is scored here for reporting only. The frozen "
                    "evaluator refuses to gate on it because it is the only split an "
                    "optimizer may see. Same canonical formulas, quoted from the "
                    "frozen report."),
           "splits": {}}
    for split in ("adaptation",):
        out["splits"][split] = evaluate(runtime, split)
    p = H.write_json("phase_e3_adaptation.json", out)
    print(json.dumps(out, indent=2, sort_keys=True))
    print("wrote", p)


if __name__ == "__main__":
    main()
