#!/usr/bin/env python3
"""Validate a notation-sidecars revision against every consumer contract.

Checks, all on train/validation data only:
  1. Every sidecar validates against notation-supervision.schema.json.
  2. attach_notation_sidecar() accepts real loader records for sidecars
     with KNOWN regions (identity, pixel digest, exact region equality).
  3. NotationCodec roundtrip preserves KNOWN target semantics.
  4. A tiny collated batch trains the shared notation decoder (finite loss,
     nonzero decoder gradient, notation mask semantics, non-KNOWN rows never
     become targets).
  5. Rejections: pixel-digest mismatch, split mismatch, region tampering.
  6. Manifest integrity: per-file SHA256 + aggregate digest recompute.

Writes audits/validation.json under the revision directory. Never trains a
model beyond the bounded sanity batch, never touches test/future-test.
"""
import argparse
import gzip
import hashlib
import json
import sys
from copy import deepcopy
from pathlib import Path

import jsonschema
import numpy as np
import torch

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from piano_vision.v2.config import V2Config
from piano_vision.v2.data import (tensorize, collate, attach_notation_sidecar,
                                  PageResolver, source_order,
                                  development_scores)
from piano_vision.v2.loss import semantic_loss
from piano_vision.v2.model import PianoVisionV2
from piano_vision.v2.notation import NotationCodec, NotationNode
from piano_vision.data import load_dataset_index, iter_jsonl

CFG = V2Config(channels=(8, 12, 16, 24), depths=(1, 1, 1, 1), hidden=32,
               heads=4, layers=1, image_height=48, image_width=96,
               dropout=0, source_dropout=0, max_objects=16)
FACTORY_ROOT = REPO / "tmp" / "campaign" / "pdmx-piano-vision-full-v1"
INDEX_PATH = REPO / "tmp" / "campaign" / "piano-vision-phase214" / "full-semantic-index.json"


def load_score_records(score_id, split):
    """Mirror development_scores guards for one specific score."""
    if split not in {"train", "validation"}:
        raise PermissionError("Validation opens only train and validation")
    index = load_dataset_index(str(INDEX_PATH))
    shards = {s["path"]: s for s in index["shards"]}
    score = next(s for s in index["scores"]
                 if s["score_id"] == score_id and s["split"] == split)
    records = {}
    for name in score["shards"]:
        if set(shards[name]["splits"]) != {split}:
            raise PermissionError("Mixed-split shards are not opened")
        for record in iter_jsonl(Path(index["dataset_root"]) / name):
            if record["split"] != split:
                raise PermissionError("Shard contents contradict split manifest")
            if record["scoreId"] == score_id:
                if record["provenance"].get("runtimeTruthInputs") != []:
                    raise ValueError("Runtime truth firewall violation")
                records[record["exampleId"]] = record
    if len(records) != score["examples"]:
        raise ValueError("Score manifest count mismatch")
    return sorted(records.values(), key=source_order)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rev", required=True)
    parser.add_argument("--max-attach", type=int, default=10)
    args = parser.parse_args()
    torch.set_num_threads(2)

    rev = Path(args.rev)
    manifest = json.loads((rev / "manifests" / "revision.json").read_text())
    schema = json.loads((REPO / "tools" / "piano-vision" / "schemas" /
                         "notation-supervision.schema.json").read_text())
    validator = jsonschema.Draft202012Validator(schema)

    results = {"schema_validated": 0, "schema_errors": [], "attached": [],
               "codec_roundtrips": 0, "rejections": {}, "batch": {},
               "manifest_ok": False}
    # 1 + 6. Schema + manifest integrity.
    digests = []
    for entry in manifest["files"]:
        data = (rev / entry["path"]).read_bytes()
        actual = hashlib.sha256(data).hexdigest()
        if actual != entry["sha256"]:
            raise ValueError(f"Digest mismatch for {entry['path']}")
        digests.append(actual)
        sidecar = json.loads(data)
        errors = list(validator.iter_errors(sidecar))
        if errors:
            results["schema_errors"].append(
                {"path": entry["path"], "errors": [e.message for e in errors][:3]})
        else:
            results["schema_validated"] += 1
    if hashlib.sha256(json.dumps(digests).encode()
                       ).hexdigest() != manifest["aggregate_digest"]:
        raise ValueError("Aggregate digest mismatch")
    results["manifest_ok"] = True
    if results["schema_errors"]:
        raise ValueError(f"Schema failures: {results['schema_errors'][:2]}")

    # 2. Attach real records (sidecars carrying KNOWN regions first).
    with_known, without_known = [], []
    for entry in manifest["files"]:
        sidecar = json.loads((rev / entry["path"]).read_text())
        known = sum(1 for r in sidecar["regions"] if r["state"] == "KNOWN")
        (with_known if known else without_known).append((entry["path"], sidecar, known))
    resolver = PageResolver(FACTORY_ROOT, index_path=str(INDEX_PATH))
    record_cache = {}
    attached_samples = []

    def records_for(score_id, split):
        key = (score_id, split)
        if key not in record_cache:
            record_cache[key] = load_score_records(score_id, split)
        return record_cache[key]

    for path, sidecar, known in with_known[:args.max_attach]:
        records = records_for(sidecar["score_id"], sidecar["split"])
        record = next(r for r in records if r["exampleId"] == sidecar["example_id"])
        sample = tensorize(record, records, resolver, CFG)
        attached = attach_notation_sidecar(sample, sidecar, record, resolver, CFG)
        # Token mask is per-region × token positions; rows are regions.
        n_targets = int(attached["targets"]["notation"]["mask"].shape[0])
        assert n_targets == known, f"{path}: {n_targets} targets != {known} KNOWN"
        assert bool(attached["targets"]["notation"]["mask"].any()), f"{path}: empty supervision"
        for row, region in zip(attached["targets"]["notation"]["target"],
                               [r for r in sidecar["regions"] if r["state"] == "KNOWN"]):
            assert region["source_region"] == region["target"]["region"]
        attached_samples.append(attached)
        results["attached"].append({"path": path, "known": known, "targets": n_targets})

    # 3. Codec roundtrip semantic equality on KNOWN targets.
    checked = 0
    for _, sidecar, _ in with_known[:args.max_attach]:
        for region in sidecar["regions"]:
            if region["state"] != "KNOWN":
                continue
            decoded = NotationCodec.decode(NotationCodec.encode(region["target"]))
            for key in ("category", "type", "attributes", "anchors", "status"):
                assert decoded[key] == region["target"][key], key
            assert decoded["region"] == region["target"]["region"]
            checked += 1
            if checked >= 12:
                break
        if checked >= 12:
            break
    results["codec_roundtrips"] = checked

    # 4. Tiny loader batch: shared decoder gradients, mask semantics.
    plain_sidecars = without_known[:2]
    plain_attached = []
    for path, sidecar, _ in plain_sidecars:
        records = records_for(sidecar["score_id"], sidecar["split"])
        record = next(r for r in records if r["exampleId"] == sidecar["example_id"])
        sample = tensorize(record, records, resolver, CFG)
        out = attach_notation_sidecar(sample, sidecar, record, resolver, CFG)
        assert "notation_tokens" not in out, f"{path} should attach no targets"
        plain_attached.append(out)
    batch_samples = ([attached_samples[0]] if attached_samples else []) + plain_attached[:1]
    if not batch_samples:
        raise ValueError("No attachable sidecars; cannot run loader batch")
    batch = collate(batch_samples)
    assert "notation_tokens" in batch and bool(batch["notation_mask"].any())
    model = PianoVisionV2(CFG)
    output = model(batch)
    loss, _ = semantic_loss(output, batch["targets"])
    loss.backward()
    gradient = model.notation_decoder.output.weight.grad
    assert torch.isfinite(loss) and torch.isfinite(gradient).all()
    assert float(gradient.abs().sum()) > 0
    # Non-KNOWN rows never become targets: mask rows equal KNOWN count.
    first_known = next(n for _, s, n in
                       [(p, s, k) for p, s, k in with_known[:args.max_attach]][:1])
    assert int(batch["notation_mask"][0].sum()) == first_known
    results["batch"] = {"loss": float(loss.detach()),
                        "decoder_grad_sum": float(gradient.abs().sum()),
                        "mask_rows_first_sample": int(batch["notation_mask"][0].sum())}

    # 5. Rejections on copies (never mutate validated sidecars).
    probe = None
    for entry in manifest["files"]:
        candidate = json.loads((rev / entry["path"]).read_text())
        if any(r["state"] == "KNOWN" for r in candidate["regions"]):
            probe = candidate
            break
    assert probe is not None, "revision contains no KNOWN region for tamper probe"
    records = records_for(probe["score_id"], probe["split"])
    record = next(r for r in records if r["exampleId"] == probe["example_id"])
    bad = deepcopy(probe)
    bad["source_pixel_digest"] = "0" * 64
    try:
        attach_notation_sidecar(tensorize(record, records, resolver, CFG), bad,
                                record, resolver, CFG)
        raise AssertionError("digest mismatch accepted")
    except ValueError:
        results["rejections"]["pixel_digest"] = "rejected"
    bad = deepcopy(probe)
    bad["split"] = "future-test"
    try:
        attach_notation_sidecar(tensorize(record, records, resolver, CFG), bad,
                                record, resolver, CFG)
        raise AssertionError("split mismatch accepted")
    except PermissionError:
        results["rejections"]["split"] = "rejected"
    bad = deepcopy(probe)
    for region in bad["regions"]:
        if region["state"] == "KNOWN":
            region["source_region"]["box"][0] += 0.01
            break
    try:
        attach_notation_sidecar(tensorize(record, records, resolver, CFG), bad,
                                record, resolver, CFG)
        raise AssertionError("region tampering accepted")
    except ValueError:
        results["rejections"]["region_tamper"] = "rejected"

    (rev / "audits" / "validation.json").write_text(json.dumps(results, indent=2))
    print(json.dumps({k: (v if not isinstance(v, list) else f"{len(v)} entries")
                      for k, v in results.items()}, indent=2))


if __name__ == "__main__":
    main()
