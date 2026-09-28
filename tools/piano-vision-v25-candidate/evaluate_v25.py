#!/usr/bin/env python3
"""Parallel full-validation eval for the serious run (epoch boundaries).

Multiprocessing tensorize workers feed batched GPU forwards. Reports the
same core/notation aggregates as evaluate_capacity plus tie diagnostics.
Writes a JSON report. Train/validation only. Read-only on factory/revision.
"""
import argparse
import gzip
import hashlib
import json
import sys
import time
from collections import Counter, deque
from multiprocessing import get_context
from pathlib import Path

import torch

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from piano_vision.v25.config import config_from_dict
from piano_vision.v2.data import (tensorize, collate, attach_notation_sidecar,
                                  PageResolver)
from piano_vision.v2.loss import semantic_loss
from piano_vision.v25.model import PianoVisionV25
from piano_vision.v25.data import collate_v25 as collate
from piano_vision.v25.performance import prepare_batch
from campaign_runtime import writable_output, source_digest
from campaign_profile import manifest as checked_manifest
from piano_vision.v2.notation import NotationCodec
from validate_notation_sidecars_v1 import load_score_records

FACTORY_ROOT = REPO / "tmp/campaign/pdmx-piano-vision-full-v1"
INDEX_PATH = REPO / "tmp/campaign/piano-vision-phase214/notation-sidecars/../full-semantic-index.json"
REV_ROOT = REPO / "tmp/campaign/piano-vision-phase214/notation-sidecars/full-v1"
NATURAL_PITCH_CLASS = (0, 2, 4, 5, 7, 9, 11)
QUARTERS_BY_TYPE = {0: None, 1: 32.0, 2: 16.0, 3: 8.0, 4: 4.0, 5: 2.0,
                    6: 1.0, 7: 0.5, 8: 0.25, 9: 0.125, 10: 0.0625,
                    11: 0.03125, 12: 0.015625}


def derive_midi(step, octave, accidental):
    return (int(octave) + 1) * 12 + NATURAL_PITCH_CLASS[int(step)] + (int(accidental) - 3)


def dots_multiplier(dots):
    return 2.0 - 0.5 ** int(dots)


def f1_score(correct_pos, pred_pos, true_pos):
    if not pred_pos and not true_pos:
        return {"precision": None, "recall": None, "f1": None,
                "predicted": 0, "actual": 0, "correct": 0}
    precision = correct_pos / pred_pos if pred_pos else 0.0
    recall = correct_pos / true_pos if true_pos else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    return {"precision": precision, "recall": recall, "f1": f1,
            "predicted": pred_pos, "actual": true_pos,
            "correct": correct_pos}


def materialize_job(job):
    """Worker: tensorize + attach a list of manifest entries. Returns list."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import torch as _torch
    from piano_vision.v2.data import (tensorize as _tensorize, attach_notation_sidecar as _attach,
                                      PageResolver as _Resolver)
    from validate_notation_sidecars_v1 import load_score_records as _load
    entries, config_dict, split = job["entries"], job["config"], job["split"]
    from piano_vision.v25.config import config_from_dict as _from_dict
    from piano_vision.v25.data import tensorize_v25, attach_pointer_targets
    _torch.set_num_threads(1)
    config = _from_dict(config_dict)
    resolver = _Resolver(FACTORY_ROOT, index_path=str(INDEX_PATH))
    cache = {}
    out = []
    for entry in entries:
        if entry["score_id"] not in cache:
            cache[entry["score_id"]] = _load(entry["score_id"], split)
        records = cache[entry["score_id"]]
        record = next(r for r in records if r["exampleId"] == entry["example_id"])
        sidecar = json.loads((REV_ROOT / entry["sidecar"]).read_text())
        sample, selected, lookup = tensorize_v25(record, records, resolver, config)
        known = [r for r in sidecar["regions"] if r["state"] == "KNOWN"]
        if known:
            sample = _attach(sample, sidecar, record, resolver, config)
            sample = attach_pointer_targets(sample, sidecar, record, selected, lookup)
        out.append(sample)
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--run-identity", required=True)
    parser.add_argument("--val-manifest", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--chunk-size", type=int, default=48)
    parser.add_argument("--inflight", type=int, default=0,
                        help="max tensorized chunks buffered ahead (default: 2*workers)")
    parser.add_argument("--max-views", type=int, default=160,
                        help="max views per packed micro-batch during forwards")
    parser.add_argument("--device", default=None)
    parser.add_argument("--cand-k", type=int, default=None,
                        help="candidate-anchor width for D1-extended models "
                             "(None=all built; 0=legacy path, bit-identical to "
                             "pre-D1 code; use 0 to reproduce frozen-baseline numbers)")
    parser.add_argument("--dump-predictions", default=None,
                        help="optional JSONL path for per-example compact predictions "
                             "(stage-A compatible: example_id/score_id/objects with "
                             "object.* argmax heads + masked truth for 6 core heads). "
                             "Dump-only: aggregation logic is untouched.")
    parser.add_argument("--limit", type=int, default=0, help="Diagnostic prefix only; never full validation")
    parser.add_argument("--engine", choices=["reference", "optimized", "compact"], default="optimized")
    parser.add_argument("--lane-ablation", action="store_true")
    args = parser.parse_args()
    device = torch.device(args.device or ("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"))
    torch.manual_seed(21701)
    out_path = writable_output(args.out)
    if out_path.exists(): raise FileExistsError(out_path)
    if args.dump_predictions: writable_output(args.dump_predictions)

    run_identity = json.loads(Path(args.run_identity).read_text())
    config = config_from_dict(run_identity.get("model_config", run_identity.get("config")))
    manifest = checked_manifest(args.val_manifest, "validation")
    if len(manifest["examples"]) != 63086: raise ValueError("Expected official 63,086-example validation manifest")
    assert manifest["split"] == "validation"
    entries = sorted(manifest["examples"], key=lambda e: (e["score_id"], e["example_id"]))

    if args.limit: entries = entries[:args.limit]
    Model = PianoVisionV25
    if args.engine == "reference":
        from piano_vision.v25.reference_model import PianoVisionV25 as Model
    model = Model(config).to(device)
    if args.engine == "compact": model.compact_feedback = True
    payload = torch.load(args.checkpoint, map_location=device, weights_only=False)
    model.load_state_dict(payload["model"] if "model" in payload else payload)
    model.eval()

    def move(batch):
        if args.engine != "reference":
            from campaign_profile import tree_to
            return tree_to(prepare_batch(batch, consistency=False), device)
        return {k: (v.to(device) if torch.is_tensor(v) else v)
                for k, v in batch.items()}

    def move_nested(node, target):
        if torch.is_tensor(node):
            return node.to(target)
        if isinstance(node, dict):
            return {k: move_nested(v, target) for k, v in node.items()}
        return node

    ctx = get_context("spawn")
    pool = ctx.Pool(processes=args.workers)
    chunks = [entries[i:i + args.chunk_size]
              for i in range(0, len(entries), args.chunk_size)]
    jobs = [{"entries": chunk, "config": config.to_dict(), "split": "validation"}
            for chunk in chunks]

    # Bounded in-flight tensorization: keep at most `inflight_capacity` chunks
    # buffered in the parent to bound memory, while consuming chunks strictly
    # in submission order so float aggregations are bit-identical to a
    # single-stream run. Consumption order = submission order.
    inflight = deque()
    next_submit = 0
    inflight_capacity = args.inflight or (args.workers * 2)

    def submit_job():
        nonlocal next_submit
        if next_submit >= len(jobs):
            return
        inflight.append((next_submit,
                         pool.apply_async(materialize_job, (jobs[next_submit],))))
        next_submit += 1

    for _ in range(min(inflight_capacity, len(jobs))):
        submit_job()

    def consume_inorder():
        """Yield (original_index, result) in submission order, refilling the
        bounded inflight window as chunks are consumed."""
        for job_idx in range(len(jobs)):
            _idx, async_result = inflight.popleft()
            yield job_idx, async_result
            submit_job()

    pred_stream = open(args.dump_predictions, "w") if args.dump_predictions else None

    heads_correct, heads_total = Counter(), Counter()
    event = [0, 0, 0]; event_accuracy = [0, 0]; pointer_accuracy = [0, 0]; lane_candidate = [0, 0]
    written = [0, 0]
    midi = [0, 0]
    dur = [0, 0]
    dur_abs_err, dur_count = 0.0, 0
    rest = [0, 0, 0]
    tie = [0, 0, 0]
    tie_prob_sum, tie_prob_n, tie_pos_seen = 0.0, 0, 0
    tuplet = [0, 0, 0]
    lane = [0, 0, 0]
    token_correct = token_total = 0
    examples_done, timed_out = 0, []
    t_start = time.time()
    import torch.nn.functional as F
    with torch.no_grad():
        for job_idx, async_result in consume_inorder():
            try:
                chunk_samples = async_result.get(timeout=3600)
            except Exception as error:
                timed_out.append({"chunk": job_idx, "error": str(error)[:200]})
                continue
            # Batched forwards packed by views.
            order = sorted(range(len(chunk_samples)),
                           key=lambda i: int(chunk_samples[i]["images"].shape[0]))
            cursor = 0
            while cursor < len(order):
                micro, views = [], 0
                while cursor < len(order):
                    candidate = chunk_samples[order[cursor]]
                    candidate_views = int(candidate["images"].shape[0])
                    if micro and views + candidate_views > args.max_views:
                        break
                    micro.append(order[cursor])
                    views += candidate_views
                    cursor += 1
                batch = move(collate([chunk_samples[i] for i in micro]))
                output = model(batch, cand_k=args.cand_k)
                targets = batch["targets"]
                attachment = targets.get("attachment", {})
                for head in ("event", "pointer"):
                    pl = attachment.get(head)
                    logits = output.get("attachment", {}).get("event_affinity" if head == "event" else "pointer")
                    if pl is None or logits is None: continue
                    truth, mask = pl["target"].cpu(), pl["mask"].cpu()
                    pred = (logits.cpu().sigmoid() > .5) if head == "event" else logits.cpu().argmax(-1)
                    store = event_accuracy if head == "event" else pointer_accuracy
                    store[0] += int(((pred == truth) & mask).sum()); store[1] += int(mask.sum())
                    if head == "event":
                        event[0] += int(((pred == 1) & (truth == 1) & mask).sum())
                        event[1] += int(((pred == 1) & mask).sum()); event[2] += int(((truth == 1) & mask).sum())
                if args.lane_ablation:
                    from piano_vision.v25.generation import component_lane_decode
                    pred = component_lane_decode(output["object"]["lane"], output["relation"]["lane_continuation"].softmax(-1)[..., 1], batch["relation_index"], batch["relation_mask"], batch["object_mask"]).cpu()
                    pl = targets["object"]["lane"]; mask = pl["mask"].cpu()
                    lane_candidate[0] += int(((pred == pl["target"].cpu()) & mask).sum()); lane_candidate[1] += int(mask.sum())
                for group in ("object", "relation", "context"):
                    for head, logits in output[group].items():
                        pl = (targets.get(group) or {}).get(head)
                        if pl is None:
                            continue
                        cpu_logits = logits.cpu()
                        cpu_target = pl["target"].cpu()
                        cpu_mask = pl["mask"].cpu()
                        n = int(cpu_mask.sum())
                        if not n:
                            continue
                        pred = cpu_logits.argmax(-1)
                        key = f"{group}.{head}"
                        heads_correct[key] += int(
                            ((pred == cpu_target) & cpu_mask).sum())
                        heads_total[key] += n
                        if key == "relation.tie":
                            probs = cpu_logits.softmax(-1)[..., 1]
                            tie_prob_sum += float((probs * cpu_mask).sum())
                            tie_prob_n += n
                            tie_pos_seen += int(((cpu_target == 1) & cpu_mask).sum())
                obj = targets.get("object", {})
                rest_pl = obj.get("rest")
                pw = obj.get("pitch_written_step")
                if pw is not None and all(k in obj for k in
                                          ("pitch_octave", "pitch_accidental")):
                    step_p = output["object"]["pitch_written_step"].cpu().argmax(-1)
                    oct_p = output["object"]["pitch_octave"].cpu().argmax(-1)
                    acc_p = output["object"]["pitch_accidental"].cpu().argmax(-1)
                    step_t = obj["pitch_written_step"]["target"].cpu()
                    oct_t = obj["pitch_octave"]["target"].cpu()
                    acc_t = obj["pitch_accidental"]["target"].cpu()
                    valid = (obj["pitch_written_step"]["mask"].cpu() &
                             obj["pitch_octave"]["mask"].cpu() &
                             obj["pitch_accidental"]["mask"].cpu())
                    if rest_pl is not None:
                        valid = valid & (rest_pl["target"].cpu() == 0) & rest_pl["mask"].cpu()
                    for i in torch.nonzero(valid.reshape(-1), as_tuple=False).flatten().tolist():
                        written[1] += 1
                        if (int(step_p.reshape(-1)[i]) == int(step_t.reshape(-1)[i])
                                and int(oct_p.reshape(-1)[i]) == int(oct_t.reshape(-1)[i])
                                and int(acc_p.reshape(-1)[i]) == int(acc_t.reshape(-1)[i])):
                            written[0] += 1
                        midi[1] += 1
                        if derive_midi(int(step_p.reshape(-1)[i]),
                                       int(oct_p.reshape(-1)[i]),
                                       int(acc_p.reshape(-1)[i])) == derive_midi(
                                int(step_t.reshape(-1)[i]), int(oct_t.reshape(-1)[i]),
                                int(acc_t.reshape(-1)[i])):
                            midi[0] += 1
                if all(k in obj for k in ("duration_type", "duration_dots")):
                    type_p = output["object"]["duration_type"].cpu().argmax(-1)
                    dots_p = output["object"]["duration_dots"].cpu().argmax(-1)
                    type_t = obj["duration_type"]["target"].cpu()
                    dots_t = obj["duration_dots"]["target"].cpu()
                    valid = obj["duration_type"]["mask"].cpu() & obj["duration_dots"]["mask"].cpu()
                    dur[1] += int(valid.sum())
                    dur[0] += int((((type_p == type_t) & (dots_p == dots_t)) & valid).sum())
                    reg = (targets.get("regression") or {}).get("duration_quarters")
                    if reg is not None:
                        truth_q = reg["target"].cpu()
                        reg_mask = reg["mask"].cpu() & valid
                        for i in torch.nonzero(reg_mask.reshape(-1), as_tuple=False).flatten().tolist():
                            base = QUARTERS_BY_TYPE.get(int(type_p.reshape(-1)[i]))
                            if base is None:
                                continue
                            dur_abs_err += abs(base * dots_multiplier(int(dots_p.reshape(-1)[i]))
                                               - float(truth_q.reshape(-1)[i]))
                            dur_count += 1
                if rest_pl is not None:
                    pred = output["object"]["rest"].cpu().argmax(-1)
                    truth, mask = rest_pl["target"].cpu(), rest_pl["mask"].cpu()
                    rest[0] += int((((pred == 1) & (truth == 1)) & mask).sum())
                    rest[1] += int(((pred == 1) & mask).sum())
                    rest[2] += int(((truth == 1) & mask).sum())
                rel = targets.get("relation", {})
                for head, store in (("tie", tie), ("lane_continuation", lane)):
                    if head in rel and head in output["relation"]:
                        pred = output["relation"][head].cpu().argmax(-1)
                        truth, mask = rel[head]["target"].cpu(), rel[head]["mask"].cpu()
                        store[0] += int((((pred == 1) & (truth == 1)) & mask).sum())
                        store[1] += int(((pred == 1) & mask).sum())
                        store[2] += int(((truth == 1) & mask).sum())
                if "tuplet" in obj and "tuplet" in output["object"]:
                    pred = output["object"]["tuplet"].cpu().argmax(-1)
                    truth, mask = obj["tuplet"]["target"].cpu(), obj["tuplet"]["mask"].cpu()
                    tuplet[0] += int((((pred == 1) & (truth == 1)) & mask).sum())
                    tuplet[1] += int(((pred == 1) & mask).sum())
                    tuplet[2] += int(((truth == 1) & mask).sum())
                if "notation_tokens" in batch:
                    payload = move_nested(batch["targets"]["notation"], "cpu")
                    logits = move_nested(output["notation"], "cpu")
                    rows = payload["target"].shape[0] * payload["target"].shape[1]
                    width = payload["target"].shape[2]
                    argmax = logits.reshape(rows, width, -1).argmax(-1)
                    teacher = payload["target"].reshape(rows, width)
                    tmask = payload["mask"].reshape(rows, width)
                    token_correct += int(((argmax == teacher) & tmask).sum())
                    token_total += int(tmask.sum())
                examples_done += len(micro)
                if pred_stream is not None:
                    # Dump-only compact predictions (stage-A compatible).
                    # Reads output/batch; never mutates aggregation state.
                    _obj_masks = batch["object_mask"].cpu()
                    _cache = {}
                    for _group in ("object", "relation", "context"):
                        for _head, _logits in output[_group].items():
                            _cache[f"{_group}.{_head}"] = _logits.cpu().argmax(-1)
                    for _p in range(len(micro)):
                        _meta = batch["metadata"][_p]
                        _valid = _obj_masks[_p].reshape(-1).tolist()
                        _objects = []
                        for _i in range(len(_valid)):
                            if not _valid[_i]:
                                continue
                            _row = {"heads": {
                                _k: int(_v[_p].reshape(-1)[_i])
                                for _k, _v in _cache.items()
                                if _k.startswith("object.") and _i < _v[_p].numel()}}
                            _truth = {}
                            for _h in ("pitch_written_step", "pitch_octave",
                                       "pitch_accidental", "duration_type",
                                       "duration_dots", "rest"):
                                _pl = (targets.get("object") or {}).get(_h)
                                if _pl is None:
                                    continue
                                _m = _pl["mask"].cpu()[_p].reshape(-1).tolist()
                                if _i < len(_m) and _m[_i]:
                                    _truth[_h] = int(
                                        _pl["target"].cpu()[_p].reshape(-1)[_i])
                            _row["truth"] = _truth
                            _objects.append(_row)
                        pred_stream.write(json.dumps(
                            {"example_id": _meta["example_id"],
                             "score_id": _meta["score_id"],
                             "objects": _objects}) + "\n")
                if device == "mps":
                    torch.mps.empty_cache()
            if pred_stream is not None:
                pred_stream.flush()
            if (job_idx + 1) % 50 == 0:
                print(json.dumps({"chunks_done": job_idx + 1, "chunks_total": len(chunks),
                                  "examples": examples_done,
                                  "elapsed_s": round(time.time() - t_start)}), flush=True)
    if pred_stream is not None:
        pred_stream.close()
    pool.close()
    pool.join()
    core = {
        "event_accuracy": event_accuracy[0]/event_accuracy[1] if event_accuracy[1] else None,
        "event_counts": event_accuracy, "event_f1": f1_score(*event),
        "pointer_accuracy": pointer_accuracy[0]/pointer_accuracy[1] if pointer_accuracy[1] else None,
        "pointer_counts": pointer_accuracy,
        "component_lane_accuracy": lane_candidate[0]/lane_candidate[1] if lane_candidate[1] else None,
        "component_lane_counts": lane_candidate,
        "examples": examples_done, "timed_out_chunks": timed_out,
        "head_accuracy": {k: {"correct": heads_correct[k], "labels": heads_total[k],
                              "accuracy": heads_correct[k] / heads_total[k]}
                          for k in heads_correct},
        "written_pitch_accuracy": written[0] / written[1] if written[1] else None,
        "written_pitch_labels": written[1],
        "written_pitch_correct": written[0],
        "derived_midi_accuracy": midi[0] / midi[1] if midi[1] else None,
        "derived_midi_labels": midi[1],
        "derived_midi_correct": midi[0],
        "duration_accuracy": dur[0] / dur[1] if dur[1] else None,
        "duration_labels": dur[1],
        "duration_correct": dur[0],
        "duration_mae_quarters": dur_abs_err / dur_count if dur_count else None,
        "duration_mae_labels": dur_count,
        "duration_abs_err": dur_abs_err,
        "rest_f1": f1_score(*rest), "tie_f1": f1_score(*tie),
        "tuplet_f1": f1_score(*tuplet), "lane_continuation_f1": f1_score(*lane),
        "tie_pos_seen": tie_pos_seen,
        "tie_mean_prob": tie_prob_sum / tie_prob_n if tie_prob_n else None,
        "tie_prob_sum": tie_prob_sum,
        "tie_prob_n": tie_prob_n,
        "token_accuracy": token_correct / token_total if token_total else None,
        "token_labels": token_total,
        "token_correct": token_correct,
    }
    out_path.write_text(json.dumps(
        {"variant": "V2.5", "core": core,
         "full_validation_complete": examples_done == 63086 and not timed_out and not args.limit,
         "manifest_digest": manifest["digest"], "engine": args.engine,
         "checkpoint": str(Path(args.checkpoint)),
         "checkpoint_sha256": hashlib.file_digest(open(args.checkpoint, "rb"), "sha256").hexdigest(),
         "implementation_sha256": source_digest(),
         "metric_definition": "Inherited V2 aggregates unchanged; duration MAE uses type+dots only, skips unknown predicted type; extra event/pointer/component-lane fields added",
         "elapsed_s": round(time.time() - t_start)}, indent=2))
    if timed_out: raise RuntimeError("Incomplete validation: failed chunks; report preserved")
    print(json.dumps({"done": True, "examples": examples_done,
                      "written": core["written_pitch_accuracy"],
                      "token_accuracy": core["token_accuracy"],
                      "tie_f1": core["tie_f1"],
                      "timed_out_chunks": len(timed_out)}), flush=True)


if __name__ == "__main__":
    main()
