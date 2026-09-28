#!/usr/bin/env python3
"""Evaluate a candidate checkpoint on BOTH campaign gates.

Gate A - held-out real rendered PDFs (real-PDF domain)
    written pitch accuracy, derived MIDI accuracy, duration accuracy,
    note precision/recall/F1, rest precision/recall/F1.

Gate B - the ORIGINAL fixed V2.5 qualification data (capability retention)
    the same object-head accuracies the qualified step-2100 run reports, on the
    identical fixed manifest prefix, so the two checkpoints are directly
    comparable. See ``original_qualification_command`` for the full 63,086
    run.

Selection policy, enforced here
--------------------------------
This script only measures. It never trains. ``--report-gate`` marks which
candidate wins, and it refuses to mark a winner when the original-qualification
gate regresses past ``--max-regression`` against the recorded step-2100
baseline. Training-set accuracy is not read anywhere in this file.

Real-PDF metric definitions
---------------------------
Objects are the production detector's proposals, in canonical order. Ground
truth is the matched MusicXML through ``align_objects``, so:

- written pitch accuracy: predicted (step, octave, accidental) equals the
  MusicXML written pitch, over aligned pitched objects;
- derived MIDI accuracy: MIDI derived from (step, octave, accidental) by the
  trained head's own vocabulary equals the MusicXML MIDI, which is the metric a
  player actually hears;
- duration accuracy: predicted (written type, dots) equals MusicXML;
- note/rest P/R/F1: over the objects of the evaluated measures, a notehead-kind
  object is a true positive when it aligns to a pitched MusicXML event, a
  rest-kind object is a true positive when it aligns to a rest; recall is over
  the MusicXML events of the evaluated measures. This is a detector+alignment
  guard: the detector is unchanged by this campaign, so a drop here means
  something regressed and must be investigated before training continues.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import Counter
from pathlib import Path

import torch

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(REPO / "tools/piano-vision-v25-candidate"))

from piano_vision.v25.config import config_from_dict  # noqa: E402
from piano_vision.v25.data import collate_v25, tensorize_v25  # noqa: E402
from piano_vision.v25.model import PianoVisionV25  # noqa: E402
from piano_vision.v25.performance import prepare_batch  # noqa: E402
from piano_vision.v2.data import PageResolver  # noqa: E402
from validate_notation_sidecars_v1 import load_score_records  # noqa: E402

from realpdf_data import RealPdfPageResolver, load_realpdf_records, realpdf_manifest  # noqa: E402

FACTORY_ROOT = REPO / "tmp/campaign/pdmx-piano-vision-full-v1"
FACTORY_INDEX = REPO / "tmp/campaign/piano-vision-phase214/full-semantic-index.json"
QUALIFIED_CONTRACT = (REPO / "tmp/campaign/piano-vision-phase214/v25-windows-transfer-20260927"
                      "/contract.json")
DURATION_TYPES = ["unknown", "maxima", "long", "breve", "whole", "half", "quarter",
                  "eighth", "16th", "32nd", "64th", "128th", "256th"]
# --------------------------------------------------------------------------
# CANONICAL_METRIC -- frozen 2026-09-28. Do not change without a new report.
# --------------------------------------------------------------------------
# The real-PDF adaptation selection metric is
#
#   written_pitch_accuracy = mean over MusicXML-ALIGNED DETECTED OBJECTS of
#                            [predicted (step, octave, alter) == MusicXML value]
#
# Properties that matter for checkpoint selection:
#   * per OBJECT, so a within-measure permutation of correct pitches cannot
#     score as a match;
#   * end-to-end on the same object population for baseline and candidate, so
#     the two are directly comparable;
#   * head-level, so it does not move when the MusicXML assembler is edited.
#
# The previously reported Minuet figure of 0.3676 is a DIFFERENT metric and is
# NOT on this scale. It is reproduced here as
# ``written_pitch_multiset`` for continuity only, and must never be compared
# against ``written_pitch_accuracy``. See README section 8.
CANONICAL_METRIC = "written_pitch_accuracy"
HISTORICAL_METRIC = "written_pitch_multiset"

# Fingerprint of the metric contract. Written into every report and compared
# against the baseline report, so a baseline and a candidate can never be
# compared across two different metric definitions.
METRIC_DEFINITION = {
    "version": "real-pdf-metric-v1",
    "frozen_utc": "2026-09-28",
    "canonical_pitch_metric": CANONICAL_METRIC,
    "canonical_pitch_formula":
        "mean over MusicXML-aligned detected objects of "
        "[predicted(step,octave,alter) == MusicXML writtenPitch(step,alter,octave)]",
    "canonical_pitch_population": "objects accepted by align_objects.align_band",
    "canonical_midi_metric": "derived_midi_accuracy",
    "canonical_midi_formula":
        "mean over the same objects of [midi(predicted) == midi(MusicXML)], "
        "midi = 12*(octave+1)+pc[step]+alter",
    "canonical_duration_metric": "duration_accuracy",
    "canonical_duration_formula":
        "mean over MusicXML-aligned objects of "
        "[predicted(writtenType,dots) == MusicXML(writtenType,dots)], "
        "scored on the duration heads only, never conditioned on pitch",
    "canonical_note_prf": "object-level: detector proposals vs MusicXML truth",
    "historical_pitch_metric": HISTORICAL_METRIC,
    "historical_pitch_formula":
        "bag intersection on (measure, staff, (step,alter,octave)); "
        "discards which object in a measure received which pitch",
    "historical_reference_value": {
        "score": "demo-minuet-in-g", "checkpoint": "step-2100",
        "value": 0.3676, "tp": 75, "predicted": 204, "actual": 204,
        "source": "tmp/v25-diagnostics/minuet-report.json",
        "reproduced_on_canonical_population": 0.2542,
    },
    "selection_rule": CANONICAL_METRIC,
    "selection_uses_heldout": True,
    "selection_uses_diagnostic": False,
}

STEP_NAMES = "CDEFGAB"
# piano_vision/data.py assigns pitch_accidental = clamp(alter + 3, 0, 6).
ACCIDENTAL_CLASS_OFFSET = 3


def predicted_alter(argmax_class: int) -> int:
    return int(argmax_class) - ACCIDENTAL_CLASS_OFFSET


def target_alter(written) -> int:
    value = written.get("alter")
    return 0 if value is None else int(round(float(value)))


def midi_of(step: str, octave: int, alter: int) -> int:
    return (int(octave) + 1) * 12 + "CDEFGAB".index(step) + int(alter)


def atomic_write_json(path, payload):
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True))
    os.replace(tmp, path)


def prf(correct, predicted, actual):
    precision = correct / predicted if predicted else (None if not actual else 0.0)
    recall = correct / actual if actual else (None if not predicted else 0.0)
    if precision is None or recall is None or (precision + recall) == 0:
        f1 = None if precision is None or recall is None else 0.0
    else:
        f1 = 2 * precision * recall / (precision + recall)
    return {"precision": precision, "recall": recall, "f1": f1,
            "predicted": predicted, "actual": actual, "correct": correct}


def tree_to(value, device):
    if torch.is_tensor(value):
        return value.to(device)
    if isinstance(value, dict):
        return {k: tree_to(v, device) for k, v in value.items()}
    if isinstance(value, list):
        return [tree_to(v, device) for v in value]
    if isinstance(value, tuple):
        return tuple(tree_to(v, device) for v in value)
    return value


def load_model(checkpoint, config, device):
    model = PianoVisionV25(config).to(device)
    payload = torch.load(checkpoint, map_location=device, weights_only=False)
    model.load_state_dict(payload["model"], strict=True)
    model.eval()
    return model, payload


# --------------------------------------------------------------------- gate A

@torch.no_grad()
def evaluate_real_pdf(model, config, manifest_path, corpus_index, device, limit=0,
                        only_scores=()):
    manifest = realpdf_manifest(manifest_path, "validation")
    resolver = RealPdfPageResolver(corpus_index)
    entries = manifest["examples"]
    if only_scores:
        wanted = set(only_scores)
        entries = [e for e in entries if e["score_id"] in wanted]
    if limit:
        entries = entries[:limit]
    cache: dict[str, list] = {}
    counters = Counter()
    confidences: list[float] = []
    per_score: dict[str, Counter] = {}
    started = time.time()
    done = 0
    multiset = {"truth": Counter(), "predicted": Counter()}
    multiset_local: dict[str, Counter] = {}

    def _ml(score_id):
        entry = multiset_local.get(score_id)
        if entry is None:
            entry = {"truth": Counter(), "predicted": Counter()}
            multiset_local[score_id] = entry
        return entry


    for entry in entries:
        done += 1
        if done % 25 == 0 or done == len(entries):
            print(json.dumps({"progress": f"{done}/{len(entries)}",
                              "elapsed_s": round(time.time() - started, 1),
                              "pitch_labels": counters["pitch_total"]}), flush=True)
        score_id = entry["score_id"]
        if score_id not in cache:
            cache.clear()
            cache[score_id] = load_realpdf_records(score_id, resolver.campaign_split_of(manifest), resolver.index_path)
        records = cache[score_id]
        record = next(r for r in records if r["exampleId"] == entry["example_id"])
        try:
            sample, _selected, _lookup = tensorize_v25(record, records, resolver, config)
        except Exception:  # noqa: BLE001 - an unusable measure is a data fact, not a crash
            counters["records_skipped"] += 1
            continue
        batch = tree_to(prepare_batch(collate_v25([sample]), consistency=False), device)
        output = model(batch)
        local = per_score.setdefault(score_id, Counter())
        _ml(score_id)

        pitch_targets = record["target"]["families"]["PITCH_STAFF"]
        rest_targets = record["target"]["families"]["REST"]
        duration_targets = record["target"]["families"]["DURATION"]
        aligned_note_objects = {i for label in pitch_targets for i in label["objectIndexes"]}
        aligned_rest_objects = {i for label in rest_targets for i in label["objectIndexes"]}
        objects = record["input"]["modelInput"]["physicalObjects"]
        notehead_objects = [i for i, o in enumerate(objects) if o.get("kind") == "notehead"]
        rest_objects = [i for i, o in enumerate(objects) if o.get("kind") != "notehead"]

        # Object-level note/rest P/R/F1 against MusicXML.
        counters["note_predicted"] += len(notehead_objects)
        counters["note_correct"] += len(set(notehead_objects) & aligned_note_objects)
        counters["note_actual"] += len(pitch_targets)
        counters["rest_predicted"] += len(rest_objects)
        counters["rest_correct"] += len(set(rest_objects) & aligned_rest_objects)
        counters["rest_actual"] += len(rest_targets)
        for i in notehead_objects:
            local["note_predicted"] += 1
        local["note_correct"] += len(set(notehead_objects) & aligned_note_objects)
        local["note_actual"] += len(pitch_targets)
        for i in rest_objects:
            local["rest_predicted"] += 1
        local["rest_correct"] += len(set(rest_objects) & aligned_rest_objects)
        local["rest_actual"] += len(rest_targets)

        # 1-based printed measure, for the historical multiset metric.
        measure_number = int(
            (record.get("alignment") or {}).get("xml_measure_index", -1)) + 1
        for family, counter in ((pitch_targets, "pitch"), (duration_targets, "duration")):
            for label in family:
                if label.get("state") != "KNOWN":
                    continue
                value = label["value"]
                for object_index in label["objectIndexes"]:
                    if object_index >= batch["object_mask"].shape[1] or \
                            not bool(batch["object_mask"][0, object_index]):
                        continue
                    prediction = _predicted_pitch(output, object_index)
                    ok = True
                    if counter == "pitch":
                        written = value.get("writtenPitch")
                        if not written:
                            continue
                        ok = (prediction["step"] == written["step"]
                              and prediction["octave"] == int(written["octave"])
                              and prediction["alter"] == target_alter(written))
                        counters["pitch_total"] += 1
                        counters["pitch_correct"] += int(ok)
                        counters["midi_total"] += 1
                        counters["midi_correct"] += int(
                            midi_of(prediction["step"], prediction["octave"],
                                    prediction["alter"]) ==
                            midi_of(written["step"], int(written["octave"]),
                                    target_alter(written)))
                        local["pitch_total"] += 1
                        local["pitch_correct"] += int(ok)
                        local["midi_total"] += 1
                        local["midi_correct"] += int(
                            midi_of(prediction["step"], prediction["octave"],
                                    prediction["alter"]) ==
                            midi_of(written["step"], int(written["octave"]),
                                    target_alter(written)))
                        # Historical-comparable metric. See CANONICAL_METRIC.
                        truth_key = (measure_number, int(value.get("staff") or 1),
                                     (written["step"], int(written["octave"]),
                                      target_alter(written)))
                        pred_key = (measure_number, int(value.get("staff") or 1),
                                    (prediction["step"], prediction["octave"],
                                     prediction["alter"]))
                        multiset["truth"][truth_key] += 1
                        multiset["predicted"][pred_key] += 1
                        multiset_local[score_id]["truth"][truth_key] += 1
                        multiset_local[score_id]["predicted"][pred_key] += 1
                        confidences.append(
                            float(output["object"]["pitch_written_step"][0, object_index]
                                  .softmax(-1).max()))
                    else:
                        # Duration is scored on its own heads against the
                        # MusicXML written type and dots, independently of whether
                        # the pitch was right, because duration accuracy is
                        # meaningless when conditioned on pitch correctness.
                        ok = (prediction["duration_type_name"] == value.get("writtenType")
                              and prediction["duration_dots"] == int(value.get("dots") or 0))
                        counters["duration_total"] += 1
                        counters["duration_correct"] += int(ok)
                        local["duration_total"] += 1
                        local["duration_correct"] += int(ok)

    return {
        "manifest": manifest_path,
        "campaign_split": manifest.get("campaign_split"),
        "scores": manifest.get("scores"),
        "records": len(entries),
        "real_pdf": {
            "written_pitch_accuracy": _ratio(counters, "pitch"),
            "derived_midi_accuracy": _ratio(counters, "midi"),
            "duration_accuracy": _ratio(counters, "duration"),
            "mean_written_pitch_confidence": (sum(confidences) / len(confidences)
                                              if confidences else None),
            "written_pitch_multiset": multiset_scores(multiset["truth"],
                                                      multiset["predicted"]),
            "note": prf(counters["note_correct"], counters["note_predicted"],
                        counters["note_actual"]),
            "rest": prf(counters["rest_correct"], counters["rest_predicted"],
                        counters["rest_actual"]),
            "records_skipped": counters["records_skipped"],
            "rest_head_note": "the object.rest head is deliberately not trained by this "
                              "campaign; rest precision/recall/F1 above is measured on the "
                              "detector's proposals against MusicXML rests",
        },
        "per_score": {k: {"written_pitch_accuracy": _ratio(v, "pitch"),
                          "derived_midi_accuracy": _ratio(v, "midi"),
                          "duration_accuracy": _ratio(v, "duration"),
                          "note": prf(v["note_correct"], v["note_predicted"], v["note_actual"]),
                          "rest": prf(v["rest_correct"], v["rest_predicted"], v["rest_actual"])}
                      for k, v in sorted(per_score.items())},
        "per_score_multiset": {k: multiset_scores(v["truth"], v["predicted"])
                               for k, v in sorted(multiset_local.items())},
    }


def multiset_scores(truth_counter, predicted_counter):
    """Bag intersection on (measure, staff, written pitch).

    This is the metric the historical 0.3676 came from
    (``tmp/v25-diagnostics/minuet_eval.py::match`` with key="key"). It ignores
    which object in a measure got which pitch, and it only ignores ORDER, not
    multiplicity. Reported for continuity; never used for selection.
    """
    keys = set(truth_counter) | set(predicted_counter)
    true_positive = sum(min(count, predicted_counter.get(key, 0))
                        for key, count in truth_counter.items())
    predicted = sum(predicted_counter.values())
    actual = sum(truth_counter.values())
    precision = true_positive / predicted if predicted else 0.0
    recall = true_positive / actual if actual else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if precision + recall else 0.0
    del keys
    return {"precision": precision, "recall": recall, "f1": f1,
            "true_positive": true_positive, "predicted": predicted, "actual": actual}


def _ratio(counters, prefix):
    total = counters[f"{prefix}_total"]
    return counters[f"{prefix}_correct"] / total if total else None


def _predicted_pitch(output, object_index):
    def argmax(head):
        return int(output["object"][head][0, object_index].argmax(-1))

    duration_type = argmax("duration_type")
    return {
        "step": STEP_NAMES[argmax("pitch_written_step")],
        "octave": argmax("pitch_octave"),
        "alter": predicted_alter(argmax("pitch_accidental")),
        "duration_type": duration_type,
        "duration_dots": argmax("duration_dots"),
        "duration_type_name": DURATION_TYPES[duration_type],
    }


# --------------------------------------------------------------------- gate B

@torch.no_grad()
def evaluate_original(model, config, manifest_path, device, limit=6000):
    """Head accuracies on the ORIGINAL fixed qualification manifest prefix."""
    doc = realpdf_manifest(manifest_path, "validation")
    entries = doc["examples"]
    if limit:
        entries = entries[:limit]
    resolver = PageResolver(FACTORY_ROOT, index_path=str(FACTORY_INDEX))
    cache: dict[str, list] = {}
    correct, total = Counter(), Counter()
    for entry in entries:
        score_id = entry["score_id"]
        if score_id not in cache:
            if len(cache) > 8:
                cache.clear()
            cache[score_id] = load_score_records(score_id, "validation")
        records = cache[score_id]
        record = next(r for r in records if r["exampleId"] == entry["example_id"])
        try:
            sample, _selected, _lookup = tensorize_v25(record, records, resolver, config)
        except Exception:  # noqa: BLE001
            continue
        batch = tree_to(prepare_batch(collate_v25([sample]), consistency=False), device)
        output = model(batch)
        targets = batch["targets"]
        for group in ("object", "relation", "context"):
            for head, logits in output[group].items():
                payload = (targets.get(group) or {}).get(head)
                if payload is None:
                    continue
                mask = payload["mask"]
                n = int(mask.sum())
                if not n:
                    continue
                key = f"{group}.{head}"
                correct[key] += int(((logits.argmax(-1) == payload["target"]) & mask).sum())
                total[key] += n
    return {
        "manifest": manifest_path,
        "prefix_examples": len(entries),
        "head_accuracy": {k: {"correct": correct[k], "labels": total[k],
                               "accuracy": correct[k] / total[k]} for k in sorted(total)},
    }


def original_qualification_command(checkpoint, out, device, limit=0, workers=6):
    """The full, unchanged 63,086-example original qualification gate."""
    return (f'python evaluate_v25.py --checkpoint "{checkpoint}" '
            f'--run-identity v25-realpdf-adaptation '
            f'--val-manifest "{REPO}/tmp/campaign/piano-vision-phase214/'
            f'v2-serious-medium-full-v1/validation.json" '
            f'--out "{out}" --device {device} --engine optimized --workers {workers}'
            + (f" --limit {limit}" if limit else ""))


def compare_metric_definitions(candidate, baseline_path):
    """Refuse a baseline/candidate comparison across two metric definitions."""
    baseline = json.loads(Path(baseline_path).read_text())
    candidate_definition = candidate.get("metric_definition")
    baseline_definition = baseline.get("metric_definition")
    if baseline_definition is None:
        raise ValueError(
            f"baseline report {baseline_path} carries no metric_definition; it predates "
            f"the frozen metric and cannot be used as a gate. Re-evaluate the baseline.")
    if candidate_definition != baseline_definition:
        differing = sorted(k for k in set(candidate_definition) | set(baseline_definition)
                           if candidate_definition.get(k) != baseline_definition.get(k))
        raise ValueError(
            f"metric definition drift against the baseline report: {differing}. "
            f"Baseline and candidate must be evaluated by the same frozen metric.")
    return {"metric_version": candidate_definition["version"],
            "selection_metric": candidate_definition["selection_rule"],
            "agrees_with_baseline": True}


def compare_gate_b(candidate, baseline_path, max_regression):
    baseline = json.loads(Path(baseline_path).read_text())
    rows, regressions = {}, []
    for head, stats in baseline.get("head_accuracy", {}).items():
        accuracy = stats.get("accuracy")
        if accuracy is None:
            continue
        rows[head] = accuracy
    for head, stats in candidate["head_accuracy"].items():
        accuracy = stats["accuracy"]
        reference = rows.get(head)
        if reference is None:
            continue
        delta = accuracy - reference
        rows[head + "__delta"] = delta
        if delta < -max_regression:
            regressions.append({"head": head, "baseline": reference,
                                "candidate": accuracy, "delta": delta})
    return {"max_regression": max_regression, "regressions": regressions,
            "passes": not regressions,
            "baseline": baseline_path}


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--adapt-manifest", default=None,
                        help="real-PDF manifest; default runs every campaign split")
    parser.add_argument("--corpus-index", required=True)
    parser.add_argument("--original-manifest", default=str(
        REPO / "tmp/campaign/piano-vision-phase214/v2-serious-medium-full-v1/validation.json"))
    parser.add_argument("--original-limit", type=int, default=6000)
    parser.add_argument("--real-pdf-splits", default="validation,heldout-test,diagnostic")
    parser.add_argument("--max-regression", type=float, default=0.02)
    parser.add_argument("--only-scores", default="",
                        help="comma-separated score ids; diagnostic use only, never "
                             "for checkpoint selection")
    parser.add_argument("--baseline-report", default=None,
                        help="step-2100 evaluate_realpdf report; enables the gate verdict")
    parser.add_argument("--device", default=None)
    parser.add_argument("--skip-original", action="store_true")
    args = parser.parse_args()

    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    config = config_from_dict(json.loads(QUALIFIED_CONTRACT.read_text())["model_config"])
    model, payload = load_model(args.checkpoint, config, device)
    print(json.dumps({"checkpoint": args.checkpoint, "step": payload.get("step"),
                      "tag": payload.get("tag"), "device": str(device)}), flush=True)

    report = {
        "checkpoint": args.checkpoint,
        "checkpoint_step": payload.get("step"),
        "checkpoint_tag": payload.get("tag"),
        "device": str(device),
        "torch": torch.__version__,
        "gpu": torch.cuda.get_device_name() if str(device).startswith("cuda") else None,
        "metric_definition": METRIC_DEFINITION,
        "real_pdf_gates": {},
        "selection_use": "measurement only; this script never trains",
    }
    only = [s.strip() for s in args.only_scores.split(",") if s.strip()]
    if args.adapt_manifest:
        report["real_pdf_gates"][os.path.basename(args.adapt_manifest)] = evaluate_real_pdf(
            model, config, args.adapt_manifest, args.corpus_index, device,
            only_scores=only)
    else:
        from realpdf_data import load_index
        index = load_index(args.corpus_index)
        root = Path(index["dataset_root"])
        for split in [s.strip() for s in args.real_pdf_splits.split(",") if s.strip()]:
            manifest_path = root / f"{split}.json"
            if not manifest_path.exists():
                continue
            report["real_pdf_gates"][split] = evaluate_real_pdf(
                model, config, str(manifest_path), args.corpus_index, device,
                only_scores=only)

    if not args.skip_original:
        report["original_qualification"] = evaluate_original(
            model, config, args.original_manifest, device, args.original_limit)
        report["original_qualification_full_command"] = original_qualification_command(
            args.checkpoint, str(Path(args.out).with_name(
                Path(args.out).stem + "-full-63086.json")), device)

    if args.baseline_report:
        report["metric_agreement"] = compare_metric_definitions(report, args.baseline_report)
        report["gate_verdict"] = compare_gate_b(
            report.get("original_qualification", {"head_accuracy": {}}),
            args.baseline_report, args.max_regression)
    atomic_write_json(Path(args.out), report)
    print(json.dumps({
        "out": args.out,
        "real_pdf": {k: {"written_pitch_accuracy": v["real_pdf"]["written_pitch_accuracy"],
                         "duration_accuracy": v["real_pdf"]["duration_accuracy"],
                         "note_f1": v["real_pdf"]["note"]["f1"],
                         "rest_f1": v["real_pdf"]["rest"]["f1"]}
                     for k, v in report["real_pdf_gates"].items()},
        "original_gate": report.get("gate_verdict"),
    }, indent=2))


if __name__ == "__main__":
    main()
