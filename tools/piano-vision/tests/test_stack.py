from __future__ import annotations

import gzip
import hashlib
import json
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

import torch
from PIL import Image

from piano_vision.checkpoint import CheckpointManager
from piano_vision.config import freeze_config, load_config, model_config
from piano_vision.dashboard import DashboardStore
from piano_vision.data import PRIMARY_FAMILIES, SemanticShardDataset, build_dataset_index, make_loader, verify_index_shards
from piano_vision.evaluator import CorranzoStrictEvaluator
from piano_vision.gate import evaluate_launch_gate
from piano_vision.losses import MaskedMultiTaskLoss
from piano_vision.model import PianoVisionV1, count_parameters
from piano_vision.readiness import REVIEW_CONFIRMATION, prepare_full, review_full
from piano_vision.trainer import Trainer, conservative_resource_guard, select_device
from piano_vision.verifier import verify_scope


def label(family, indexes, value, positive=True, external=None):
    row = {
        "labelId": f"{family}:{indexes}", "family": family, "state": "KNOWN",
        "confidence": 1.0, "objectIndexes": indexes, "semanticEventIds": [],
        "value": value, "isPositive": positive, "reason": None, "provenance": {},
    }
    if external is not None:
        row["externalObjectRefs"] = external
    return row


def record(score, split):
    example = f"{score}:semantic-m1"
    objects = [
        {"objectIndex": 0, "kind": "notehead", "center": {"x": .3, "y": .4}, "bounds": {"x0": .28, "x1": .32, "y0": .38, "y1": .42}, "geometryConfidence": 1.0},
        {"objectIndex": 1, "kind": "notehead", "center": {"x": .6, "y": .4}, "bounds": {"x0": .58, "x1": .62, "y0": .38, "y1": .42}, "geometryConfidence": 1.0},
    ]
    pitch = {
        "writtenPitch": {"step": "C", "octave": 4, "alter": 0}, "staff": 1,
        "staffPosition": {"stepsFromBandCenter": 0},
        "accidentalState": {"writtenAlter": 0, "keyContext": {"fifths": 0}},
        "clefContext": {"value": {"sign": "G"}},
    }
    duration = {"writtenType": "quarter", "dots": 0, "divisionsNormalizedQuarters": 1.0, "grace": False, "timeModification": None}
    families = {family: [] for family in PRIMARY_FAMILIES}
    families["PITCH_STAFF"] = [label("PITCH_STAFF", [0], pitch), label("PITCH_STAFF", [1], pitch)]
    families["DURATION"] = [label("DURATION", [0], duration), label("DURATION", [1], duration)]
    families["ATTACK"] = [label("ATTACK", [0, 1], {"memberHeads": 2})]
    families["CHORD"] = [label("CHORD", [0, 1], {"memberHeads": 2})]
    families["LANE"] = [label("LANE", [0], {"laneRole": "P1:lane-1"}), label("LANE", [1], {"laneRole": "P1:lane-1"})]
    families["LANE_CONTINUATION"] = [label("LANE_CONTINUATION", [0], {"laneRole": "P1:lane-1"}, external=[{"scopeId": example, "objectIndex": 1}])]
    families["TIE_SUSTAIN"] = [label("TIE_SUSTAIN", [0], {"tieStart": True, "tieStop": True}, external=[{"scopeId": example, "objectIndex": 1}])]
    availability = {family: bool(families[family]) for family in PRIMARY_FAMILIES}
    return {
        "schemaVersion": 1, "exampleId": example, "scoreId": score,
        "semanticSourceId": score, "split": split,
        "input": {"modelInput": {
            "pixels": {"required": True, "cropBounds": {"x0": .1, "x1": .9, "y0": .2, "y1": .8}},
            "geometry": {"scopeBounds": {"x0": .1, "x1": .9, "y0": .2, "y1": .8}, "staffBands": {"staffBands": []}},
            "physicalObjects": objects, "sourceGraph": {"state": "UNAVAILABLE", "nodes": [], "edges": []},
            "availabilityMasks": {},
        }, "sourceTensor": [0.0] * 16},
        "queries": {"objectQueries": [], "relationQueries": [{"leftObjectIndex": 0, "rightObjectIndex": 1, "sourceType": "PAIR_CANDIDATE"}], "scopeQuery": {"allowAbstain": True}},
        "target": {"families": families, "availability": availability},
        "decoderContract": {"id": "test", "allowAbstain": True, "configurationDigest": "test"},
        "provenance": {"sourceCoordinateIdentity": True, "sourceTargetFirewall": "PASS", "runtimeTruthInputs": []},
    }


def fixture(root: Path):
    shard_dir = root / "semantic-shards"
    shard_dir.mkdir(parents=True)
    for index, (score, split) in enumerate((("train-score", "train"), ("validation-score", "validation"))):
        path = shard_dir / f"semantic-{split}-{index:05d}.jsonl.gz"
        with gzip.open(path, "wt", encoding="utf-8") as stream:
            stream.write(json.dumps(record(score, split)) + "\n")
    return build_dataset_index(root, root / "index.json", verify_hashes=True)


def completed_factory_fixture(root: Path, stale_wal=False):
    shard_dir = root / "semantic-shards"
    shard_dir.mkdir(parents=True)
    canonical_dir = root / "canonical"
    visual_dir = root / "visual"
    canonical_dir.mkdir()
    visual_dir.mkdir()
    rows = []
    for index, split in enumerate(("train", "validation", "test", "future-test")):
        score = f"{split}-score"
        path = shard_dir / f"semantic-{split}-{index:05d}.jsonl.gz"
        example = record(score, split)
        with gzip.open(path, "wt", encoding="utf-8") as stream:
            stream.write(json.dumps(example, sort_keys=True) + "\n")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        labels = sum(
            label.get("state") == "KNOWN"
            for family in example["target"]["families"].values()
            for label in family
        )
        rows.append((index, score, split, path, digest, labels, example["exampleId"]))
    connection = sqlite3.connect(root / "factory.sqlite3")
    connection.executescript("""
        CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE scores(score_id TEXT PRIMARY KEY,job_state TEXT NOT NULL);
        CREATE TABLE build_plan(score_id TEXT PRIMARY KEY,ordinal INTEGER NOT NULL);
        CREATE TABLE canonical(
          score_id TEXT PRIMARY KEY,path TEXT,sha256 TEXT,split TEXT,
          pages INTEGER,measures INTEGER,notes INTEGER,objects INTEGER,scopes INTEGER
        );
        CREATE TABLE semantic_examples(
          example_id TEXT PRIMARY KEY,score_id TEXT,split TEXT,shard_id INTEGER,
          shard_path TEXT,source_digest TEXT,target_digest TEXT,labels INTEGER,created_at TEXT
        );
        CREATE TABLE semantic_shards(
          shard_id INTEGER PRIMARY KEY,path TEXT,records INTEGER,sha256 TEXT,split TEXT,created_at TEXT
        );
    """)
    connection.executemany("INSERT INTO state(key,value) VALUES(?,?)", (
        ("full_build_state", "COMPLETE"),
        ("semantic_build_state", "COMPLETE"),
        ("validation_report", json.dumps({"valid": True, "hashIntegrity": True, "splitIntegrity": True})),
    ))
    for index, score, split, path, digest, labels, example_id in rows:
        visual_path = visual_dir / f"{score}.png"
        Image.new("L", (16, 16), 255).save(visual_path)
        canonical_path = canonical_dir / f"{score}.json.gz"
        with gzip.open(canonical_path, "wt", encoding="utf-8") as stream:
            json.dump({
                "sourceAlignment": {"scopes": [{
                    "metadata": {"exampleId": example_id, "renderedPagePath": str(visual_path)},
                }]},
            }, stream)
        connection.execute("INSERT INTO scores VALUES(?,?)", (score, "COMPLETE"))
        connection.execute("INSERT INTO build_plan VALUES(?,?)", (score, index + 1))
        connection.execute(
            "INSERT INTO canonical VALUES(?,?,?,?,?,?,?,?,?)",
            (score, str(canonical_path), hashlib.sha256(canonical_path.read_bytes()).hexdigest(), split, 1, 1, 2, 2, 1),
        )
        connection.execute(
            "INSERT INTO semantic_examples VALUES(?,?,?,?,?,?,?,?,?)",
            (example_id, score, split, index, str(path), "source", "target", labels, "now"),
        )
        connection.execute(
            "INSERT INTO semantic_shards VALUES(?,?,?,?,?,?)",
            (index, str(path), 1, digest, split, "now"),
        )
    connection.commit()
    wal_bytes = None
    if stale_wal:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA wal_autocheckpoint=0")
        connection.execute("INSERT INTO state(key,value) VALUES('stale_wal_fixture','true')")
        connection.commit()
        wal_bytes = (root / "factory.sqlite3-wal").read_bytes()
    connection.close()
    if stale_wal:
        wal = root / "factory.sqlite3-wal"
        wal.write_bytes(wal_bytes)
        old = time.time() - 60
        os.utime(wal, (old, old))
    return rows


class PianoVisionStackTests(unittest.TestCase):
    def test_model_sizes_and_forward_backward(self):
        self.assertLess(count_parameters(PianoVisionV1(model_config("tiny"))), count_parameters(PianoVisionV1(model_config("small"))))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); fixture(root)
            config = load_config(overrides={"data": {"image_height": 64, "image_width": 128, "max_objects": 8, "max_relations": 8, "allow_synthetic_pixels": True}})
            batch = next(iter(make_loader(SemanticShardDataset(root / "index.json", "train", config["data"]), 1)))
            model = PianoVisionV1(config["model"])
            output = model(batch)
            loss, details = MaskedMultiTaskLoss(config["loss"])(output, batch["targets"])
            loss.backward()
            self.assertTrue(torch.isfinite(loss))
            self.assertGreater(details["supervised"], 0)

    def test_loader_masks_unavailable_truth(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); fixture(root)
            config = load_config(overrides={"data": {"image_height": 64, "image_width": 128, "max_objects": 8, "max_relations": 8, "allow_synthetic_pixels": True}})
            batch = next(iter(make_loader(SemanticShardDataset(root / "index.json", "train", config["data"]), 1)))
            self.assertEqual(int(batch["targets"]["object"]["rest"]["mask"].sum()), 0)
            self.assertEqual(int(batch["targets"]["object"]["tuplet"]["mask"].sum()), 0)
            with self.assertRaises(PermissionError):
                SemanticShardDataset(root / "index.json", "future-test", config["data"])

    def test_split_leakage_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); shard = root / "semantic-shards"; shard.mkdir(parents=True)
            for index, split in enumerate(("train", "validation")):
                row = record("same-score", split)
                with gzip.open(shard / f"semantic-{split}-{index}.jsonl.gz", "wt", encoding="utf-8") as stream:
                    stream.write(json.dumps(row) + "\n")
            with self.assertRaises(RuntimeError):
                build_dataset_index(root, root / "index.json")

    def test_checkpoint_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            model = torch.nn.Linear(3, 2); optimizer = torch.optim.AdamW(model.parameters())
            scheduler = torch.optim.lr_scheduler.StepLR(optimizer, 1)
            model(torch.ones(1, 3)).sum().backward(); optimizer.step(); scheduler.step()
            manager = CheckpointManager(Path(directory))
            manager.save(model, optimizer, scheduler, None, {"epoch": 1, "global_step": 4}, {}, "config", "dataset", is_best=True)
            resumed = torch.nn.Linear(3, 2); resumed_optimizer = torch.optim.AdamW(resumed.parameters()); resumed_scheduler = torch.optim.lr_scheduler.StepLR(resumed_optimizer, 1)
            _path, state, _payload = manager.load(resumed, resumed_optimizer, resumed_scheduler, expected_config_digest="config", expected_dataset_hash="dataset")
            self.assertEqual(state["global_step"], 4)
            self.assertTrue(all(torch.equal(value, resumed.state_dict()[key]) for key, value in model.state_dict().items()))

    def test_evaluator_wrong_complete_and_abstain(self):
        families = {name: {"applicable": True, "offered": True, "correct": True} for name in CorranzoStrictEvaluator.FAMILIES}
        families["tie"] = {"applicable": True, "offered": True, "correct": False}
        report = CorranzoStrictEvaluator.evaluate([{"families": families}, {"families": {"pitch": {"applicable": True, "offered": False, "correct": False}}}])
        self.assertEqual(report["wrong_complete"], 1)
        self.assertEqual(report["abstentions"], 1)

    def test_verifier_rejects_incomplete_relations(self):
        families = {
            name: {"available": True, "offered": True, "confidence": .99, "candidate_complete": True}
            for name in ("pitch", "duration", "attack", "chord", "lane", "lane_continuation", "rest", "tuplet", "tie", "cross_staff", "shared_head")
        }
        families["tie"]["candidate_complete"] = False
        report = verify_scope({"families": families, "events": [], "irregular_measure": True})
        self.assertEqual(report["status"], "REJECTED")
        self.assertIn("RELATION_CANDIDATE_INCOMPLETE:tie", report["reasons"])

    def test_dashboard_persists(self):
        with tempfile.TemporaryDirectory() as directory:
            store = DashboardStore(Path(directory), "run")
            store.update(epoch=5, train_loss=0.25)
            self.assertEqual(DashboardStore(Path(directory)).read()["epoch"], 5)

    def test_trainer_helpers_are_conservative(self):
        config = load_config(overrides={"training": {"num_workers": 8, "batch_size": 16}})
        guarded, report = conservative_resource_guard(config, {"active": True, "detected": True, "directory": "x", "database_opened": False})
        self.assertEqual(guarded["training"]["num_workers"], 0)
        self.assertEqual(guarded["training"]["batch_size"], 2)
        device, device_report = select_device("cpu")
        self.assertEqual(device.type, "cpu")
        self.assertEqual(device_report["selected"], "cpu")

    def test_bounded_trainer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "dataset"; root.mkdir(); fixture(root)
            run_dir = Path(directory) / "run"
            config = load_config(overrides={
                "model": {"hidden_dim": 32, "attention_heads": 4, "visual_channels": [8, 12, 16], "visual_blocks": [1, 1, 1], "graph_layers": 1, "dropout": 0.0},
                "data": {"image_height": 64, "image_width": 128, "max_objects": 8, "max_relations": 8, "allow_synthetic_pixels": True},
                "training": {"epochs": 1, "batch_size": 1, "validation_batch_size": 1, "gradient_accumulation": 1, "checkpoint_every_steps": 1, "warmup_steps": 0, "max_steps": 1, "max_validation_batches": 1, "device": "cpu"},
            })
            result = Trainer(config, root / "index.json", run_dir).run()
            self.assertEqual(result["state"]["global_step"], 1)
            self.assertTrue((run_dir / "checkpoints/latest.json").is_file())
            self.assertFalse(json.loads((run_dir / "experiment-manifest.json").read_text())["test_opened"])


class FullReadinessTests(unittest.TestCase):
    def _paths(self, directory, stale_wal=False):
        root = Path(directory) / "factory"
        campaign = Path(directory) / "campaign"
        root.mkdir()
        campaign.mkdir()
        rows = completed_factory_fixture(root, stale_wal=stale_wal)
        config_path = campaign / "piano-vision-v1-mac.frozen.json"
        freeze_config(load_config(), config_path)
        return root, campaign, config_path, rows

    def test_prepare_full_blocks_live_without_database_open(self):
        with tempfile.TemporaryDirectory() as directory:
            root, campaign, _config, _rows = self._paths(directory)
            report = prepare_full(
                root,
                campaign,
                disk_floor_gib=0,
                quiescence_seconds=1,
                process_lines=[f"123 python tools/pdmx-factory/full_pipeline.py --work-dir {root}"],
                open_file_pids=[],
            )
            self.assertFalse(report["prepared"])
            self.assertEqual(report["full_training"], "BLOCKED — DATASET BUILD IN PROGRESS")
            self.assertFalse(report["database_opened"])
            self.assertFalse((campaign / "full-semantic-index.json").exists())

    def test_completed_stale_wal_prepare_is_deterministic(self):
        with tempfile.TemporaryDirectory() as directory:
            root, campaign, _config, _rows = self._paths(directory, stale_wal=True)
            first = prepare_full(
                root, campaign, disk_floor_gib=0, quiescence_seconds=1,
                process_lines=[], open_file_pids=[],
            )
            first_bytes = (campaign / "full-semantic-index.json").read_bytes()
            second = prepare_full(
                root, campaign, disk_floor_gib=0, quiescence_seconds=1,
                process_lines=[], open_file_pids=[],
            )
            self.assertTrue(first["prepared"])
            self.assertTrue(first["database_opened"])
            self.assertTrue(first["checks"]["training_assets_available"])
            self.assertGreater(
                first["training_asset_inventory"]["estimated_training_dataset_bytes"],
                first["index_summary"]["dataset_bytes"],
            )
            self.assertEqual(first["liveness"]["state"], "STALE_WAL_SAFE_TO_INSPECT_READ_ONLY")
            self.assertEqual(first["dataset_digest"], second["dataset_digest"])
            self.assertEqual(first["manifest_digest"], second["manifest_digest"])
            self.assertEqual(first_bytes, (campaign / "full-semantic-index.json").read_bytes())

    def test_frozen_index_detects_hash_corruption(self):
        with tempfile.TemporaryDirectory() as directory:
            root, campaign, config_path, rows = self._paths(directory)
            report = prepare_full(
                root, campaign, disk_floor_gib=0, process_lines=[], open_file_pids=[],
            )
            self.assertTrue(report["prepared"])
            with rows[0][3].open("ab") as stream:
                stream.write(b"corruption")
            index = json.loads((campaign / "full-semantic-index.json").read_text())
            verification = verify_index_shards(index, require_hashes=True)
            self.assertFalse(verification["valid"])
            self.assertTrue(any(error.startswith("hash-mismatch:") for error in verification["errors"]))
            reparsed = prepare_full(
                root, campaign, disk_floor_gib=0, process_lines=[], open_file_pids=[],
            )
            self.assertFalse(reparsed["prepared"])
            self.assertTrue(reparsed["missing_or_corrupt_shards"])
            gate = evaluate_launch_gate(
                root, config_path, campaign / "full-semantic-index.json", disk_floor_gib=0,
                process_lines=[], open_file_pids=[],
            )
            self.assertFalse(gate["checks"]["index_hashes_pass"])
            self.assertFalse(gate["ready"])

    def test_review_is_explicit_and_gate_requires_record(self):
        with tempfile.TemporaryDirectory() as directory:
            root, campaign, config_path, _rows = self._paths(directory)
            prepared = prepare_full(
                root, campaign, disk_floor_gib=0, process_lines=[], open_file_pids=[],
            )
            self.assertTrue(prepared["prepared"])
            shown = review_full(root, campaign, process_lines=[], open_file_pids=[])
            self.assertEqual(shown["review_state"], "AWAITING_EXPLICIT_CONFIRMATION")
            self.assertFalse((campaign / "human-review.json").exists())
            blocked = evaluate_launch_gate(
                root, config_path, campaign / "full-semantic-index.json", disk_floor_gib=0,
                process_lines=[], open_file_pids=[],
            )
            self.assertFalse(blocked["ready"])
            self.assertIn("human_review_complete", blocked["blockers"])
            reviewed = review_full(
                root, campaign, confirmation=REVIEW_CONFIRMATION,
                process_lines=[], open_file_pids=[],
            )
            self.assertTrue(reviewed["recorded"])
            ready = evaluate_launch_gate(
                root, config_path, campaign / "full-semantic-index.json", disk_floor_gib=0,
                process_lines=[], open_file_pids=[],
            )
            self.assertTrue(ready["ready"])
            self.assertEqual(ready["full_training"], "READY")
            self.assertFalse(ready["training_started"])
            self.assertFalse((campaign / "runs").exists())


if __name__ == "__main__":
    unittest.main()
