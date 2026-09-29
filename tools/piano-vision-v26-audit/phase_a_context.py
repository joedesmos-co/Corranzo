"""Phase A / P7: the clef path.

written pitch = f(staff position, clef, accidental). staff_step is
clef-INDEPENDENT. On production staff_step reaches 0.36 but written pitch only
0.105, so something beyond staff position is failing. The written step and
octave are defined relative to the clef, which the model predicts on the
CONTEXT heads, from the system-header view built by `_detect_staff_systems`.

This measures every context head in both domains, and the confusion of
`pitch_written_step` conditional on the clef being right vs wrong, which
separates "cannot find the note on the staff" from "knows where it is but
misreads the clef".
"""
from __future__ import annotations

import copy
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

H.add_runtime_to_path()
from piano_vision.v2.data import build_inputs, attach_targets, collate  # noqa: E402
from piano_vision.v25.data import attach_object_page_geo  # noqa: E402
from piano_vision.v25.performance import prepare_batch  # noqa: E402

CONTEXT_HEADS = ("key_fifths", "clef", "clef_line", "clef_octave",
                 "meter_numerator", "meter_denominator")


def sweep(runtime, groups, resolver_factory, max_records, label):
    hit = {h: 0 for h in CONTEXT_HEADS}
    tot = {h: 0 for h in CONTEXT_HEADS}
    majority = {}
    # written step split by whether the clef head was right
    ws_hit = ws_tot = 0
    ws_hit_clefok = ws_tot_clefok = 0
    ws_hit_clefbad = ws_tot_clefbad = 0
    n = 0
    for sid, ordered in groups:
        resolver = resolver_factory()
        for rec in ordered[:max_records]:
            try:
                sample, selected, lookup, relations, nodes = build_inputs(
                    rec, ordered, resolver, runtime.config)
                sample = attach_targets(sample, rec, selected, lookup, relations, nodes)
                sample = attach_object_page_geo(sample, selected)
                batch = prepare_batch(collate([sample]), consistency=False)
                batch = runtime._to_device(batch)
                out = H.forward(runtime, batch)
            except Exception:
                continue
            n += 1
            for h in CONTEXT_HEADS:
                if h in out["context"]:
                    hh, tt = H.head_accuracy(out, batch, h, group="context")
                    hit[h] += hh
                    tot[h] += tt
                    if h == "clef" and tt:
                        tgt = batch["targets"]["context"][h]["target"][0].cpu()
                        msk = batch["targets"]["context"][h]["mask"][0].cpu()
                        vals = tgt[msk].tolist()
                        if vals:
                            majority[h] = Counter(vals).most_common(1)[0]
            # clef correctness, broadcast to objects
            cp = out["context"]["clef"][0].argmax(-1).cpu()
            ct = batch["targets"]["context"]["clef"]["target"][0].cpu()
            cm = batch["targets"]["context"]["clef"]["mask"][0].cpu()
            ok = ((cp == ct) & cm)
            if ok.numel() == 0:
                clef_ok = torch_zeros = None
            import torch as _t
            clef_ok = ok
            sp = out["object"]["pitch_written_step"][0].argmax(-1).cpu()
            st = batch["targets"]["object"]["pitch_written_step"]["target"][0].cpu()
            sm = batch["targets"]["object"]["pitch_written_step"]["mask"][0].cpu()
            good = (sp == st) & sm
            if clef_ok is not None and clef_ok.numel() >= sm.numel():
                m = sm.bool()
                c = clef_ok[:sm.numel()].bool()
                a = (good & m & c).sum().item(); b = (m & c).sum().item()
                d = (good & m & ~c).sum().item(); e = (m & ~c).sum().item()
                ws_hit += a + d; ws_tot += b + e
                ws_hit_clefok += a; ws_tot_clefok += b
                ws_hit_clefbad += d; ws_tot_clefbad += e
    print(f"\n--- {label} ({n} records) ---", flush=True)
    rows = {}
    for h in CONTEXT_HEADS:
        if tot[h] == 0:
            rows[h] = {"accuracy": None, "labels": 0}
            continue
        rows[h] = {"accuracy": round(hit[h] / tot[h], 6), "labels": tot[h],
                   "majority_class_baseline": (round(majority[h][1] / tot[h], 6)
                                               if h in majority else None)}
        print(f"  {h:<20} {hit[h]/tot[h]:.4f}  n={tot[h]}"
              f"{'  (majority ' + str(round(majority[h][1]/tot[h],4)) + ')' if h in majority else ''}",
              flush=True)
    if ws_tot:
        print(f"  written_step overall   {ws_hit/ws_tot:.4f}  n={ws_tot}", flush=True)
        if ws_tot_clefok:
            print(f"    | clef CORRECT       {ws_hit_clefok/ws_tot_clefok:.4f}  n={ws_tot_clefok}", flush=True)
        if ws_tot_clefbad:
            print(f"    | clef WRONG         {ws_hit_clefbad/ws_tot_clefbad:.4f}  n={ws_tot_clefbad}", flush=True)
    rows["_written_step_by_clef"] = {
        "overall": [ws_hit, ws_tot],
        "clef_correct": [ws_hit_clefok, ws_tot_clefok],
        "clef_wrong": [ws_hit_clefbad, ws_tot_clefbad]}
    return rows


def main():
    runtime = H.load_runtime("cpu")
    out = {}
    out["production"] = sweep(runtime, H.realpdf_scores("validation"),
                              H.realpdf_resolver, 25,
                              "PRODUCTION context heads")
    src = [(e[0]["scoreId"], e) for e in H.source_scores(3, split="validation")]
    out["source"] = sweep(runtime, src, H.source_resolver, 40,
                          "SOURCE context heads")
    path = H.write_json("phase_a_context.json", out)
    print("\nwrote", path)


if __name__ == "__main__":
    import torch  # noqa: E402  (used inside sweep)
    globals()["torch"] = torch
    main()
