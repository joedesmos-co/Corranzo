#!/usr/bin/env python3
"""Model-specific Corranzo semantic emitter, loader, trainer, and evaluator.

This module is layered over the generic archive factory.  It never extracts
archives and never changes generic pair admission; it consumes only accepted
canonical source-coordinate records and separately supplied semantic targets.
"""

from __future__ import annotations

import gzip
import fcntl
import hashlib
import json
import math
import os
import sqlite3
from itertools import islice
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

from factory import sha256_path, utc_now
from semantic_streaming import SemanticStreaming, disk_index
from worker_guard import assert_no_legacy_worker


FAMILIES = ["PITCH_STAFF", "DURATION", "ATTACK", "CHORD", "LANE", "LANE_CONTINUATION", "REST", "TUPLET", "TIE_SUSTAIN", "CROSS_STAFF", "SHARED_HEAD"]
FORBIDDEN_INPUT_KEYS = {"writtenPitch", "durationQuarters", "durationDivisions", "voice", "lane", "onset", "offsetQuarters", "semanticMeasureNumber", "graphMeasureNumber"}


def semantic_split(score_id):
    bucket = int.from_bytes(hashlib.blake2b(("semantic:" + score_id).encode(), digest_size=2).digest(), "big") % 100
    if bucket < 70:
        return "train"
    if bucket < 85:
        return "validation"
    if bucket < 90:
        return "test"
    return "future-test"


def iter_jsonl(path):
    opener = gzip.open if str(path).endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as stream:
        for line in stream:
            if line.strip():
                yield json.loads(line)


def read_jsonl(path):
    return list(iter_jsonl(path))


def firewall_violations(value, path="modelInput"):
    violations = []
    if isinstance(value, dict):
        for key, child in value.items():
            if key in FORBIDDEN_INPUT_KEYS:
                violations.append(f"{path}.{key}")
            violations.extend(firewall_violations(child, f"{path}.{key}"))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            violations.extend(firewall_violations(child, f"{path}[{index}]"))
    return violations


def query_contract(model_input):
    objects = model_input.get("physicalObjects", [])
    graph = model_input.get("sourceGraph", {})
    object_queries = [{"queryId": f"object:{row['objectIndex']}", "objectIndex": row["objectIndex"], "kind": row.get("kind")} for row in objects]
    relation_queries = []
    object_ids = set(range(len(objects)))
    for edge_index, edge in enumerate(graph.get("edges", [])):
        left = edge.get("fromObjectIndex", edge.get("from"))
        right = edge.get("toObjectIndex", edge.get("to"))
        if isinstance(left, int) and isinstance(right, int) and left in object_ids and right in object_ids:
            relation_queries.append({"queryId": f"relation:{edge_index}", "leftObjectIndex": left, "rightObjectIndex": right, "sourceType": edge.get("type"), "sourceScore": edge.get("score")})
    if not relation_queries and len(objects) <= 48:
        relation_queries = [
            {"queryId": f"pair:{left}:{right}", "leftObjectIndex": left, "rightObjectIndex": right, "sourceType": "PAIR_CANDIDATE"}
            for left in range(len(objects)) for right in range(left + 1, len(objects))
        ]
    return {"objectQueries": object_queries, "relationQueries": relation_queries, "scopeQuery": {"decoder": "JOINT_MUSICAL_CONSISTENCY_V1", "allowAbstain": True}}


def source_tensor(model_input):
    objects = model_input.get("physicalObjects", [])
    graph = model_input.get("sourceGraph", {})
    noteheads = [row for row in objects if row.get("kind") == "notehead"]
    rests = [row for row in objects if row.get("kind") == "rest"]
    centers = [row.get("center", {}) for row in objects]
    edges = graph.get("edges", [])
    values = [
        len(objects), len(noteheads), len(rests), len(edges),
        np.mean([float(row.get("x", 0)) for row in centers]) if centers else 0,
        np.mean([float(row.get("y", 0)) for row in centers]) if centers else 0,
        np.std([float(row.get("x", 0)) for row in centers]) if centers else 0,
        np.std([float(row.get("y", 0)) for row in centers]) if centers else 0,
        sum("attack" in str(edge.get("type", "")) for edge in edges),
        sum("chord" in str(edge.get("type", "")) for edge in edges),
        sum("beam" in str(edge.get("type", "")) for edge in edges),
        sum("tuplet" in str(edge.get("type", "")) for edge in edges),
        sum("tie" in str(edge.get("type", "")) for edge in edges),
        sum("cross-staff" in str(edge.get("type", "")) for edge in edges),
        sum("shared-head" in str(edge.get("type", "")) for edge in edges),
        float(bool(graph.get("edges"))),
    ]
    scale = np.asarray([64, 64, 32, 512, 1, 1, 1, 1, 128, 128, 128, 64, 64, 64, 64, 1], dtype=np.float32)
    return (np.asarray(values, dtype=np.float32) / scale).clip(-4, 4).tolist()


class SemanticFactory(SemanticStreaming):
    def __init__(self, work_dir, model_contract, shard_size=256, free_floor_gib=20.0,
                 buffer_bytes=8 * 1024 * 1024, event_hook=None):
        self.work_dir = Path(work_dir).resolve()
        assert_no_legacy_worker(self.work_dir)
        self._worker_lock = (self.work_dir / 'semantic-worker.lock').open('a+')
        fcntl.flock(self._worker_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.model_contract_path = Path(model_contract).resolve()
        self.shard_dir = self.work_dir / "semantic-shards"
        self.shard_dir.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.work_dir / "factory.sqlite3")
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("PRAGMA fullfsync=ON")
        self.db.execute("PRAGMA cache_size=-4096")
        self.db.execute("PRAGMA temp_store=FILE")
        self.shard_size = int(shard_size)
        if self.shard_size < 1 or buffer_bytes < 1 or free_floor_gib < 0:
            raise ValueError("Invalid semantic buffer/disk settings")
        self.free_floor_bytes = int(float(free_floor_gib) * 1024**3)
        self.buffer_bytes = int(buffer_bytes)
        self.event_hook = event_hook
        self.buffer_peak_examples = self.buffer_peak_bytes = 0
        self.staging_dir = self.work_dir / 'semantic-staging'
        self.staging_dir.mkdir(exist_ok=True)
        self.contract = json.loads(self.model_contract_path.read_text())
        if not self.contract.get("scaleAuthorized") or self.contract.get("runtimeTruthInputs") != []:
            raise ValueError("Validated SCALE model contract required")
        self._init_schema()
        self._streaming_schema()

    def close(self):
        self.db.close()
        self._worker_lock.close()

    def _set_state(self, key, value):
        self.db.execute(
            "INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, str(value)),
        )
        self.db.commit()

    def _init_schema(self):
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS semantic_examples (
          example_id TEXT PRIMARY KEY, score_id TEXT NOT NULL, split TEXT NOT NULL,
          shard_id INTEGER NOT NULL, shard_path TEXT NOT NULL, source_digest TEXT NOT NULL,
          target_digest TEXT NOT NULL, labels INTEGER NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS semantic_shards (
          shard_id INTEGER PRIMARY KEY, path TEXT NOT NULL, records INTEGER NOT NULL,
          sha256 TEXT NOT NULL, split TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS training_runs (
          run_id TEXT PRIMARY KEY, model_id TEXT NOT NULL, state TEXT NOT NULL,
          metrics_json TEXT NOT NULL, created_at TEXT NOT NULL
        );
        """)
        self.db.commit()

    def _target_bundle(self, score_id):
        row = self.db.execute("SELECT metadata_json FROM scores WHERE score_id=?", (score_id,)).fetchone()
        if not row:
            return None
        metadata = json.loads(row["metadata_json"])
        raw = metadata.get("target_bundle") or metadata.get("targetBundle")
        if not raw:
            return None
        path = Path(raw)
        if not path.is_absolute():
            csv_path = self.db.execute("SELECT value FROM state WHERE key='input_csv_path'").fetchone()
            base = Path(csv_path[0]).parent if csv_path else self.work_dir
            path = (base / path).resolve()
        return path

    # Assembly and validation are supplied by SemanticStreaming.

class SemanticExampleLoader:
    def __init__(self, work_dir, split):
        self.work_dir = Path(work_dir)
        self.split = split

    def __iter__(self):
        db = sqlite3.connect((self.work_dir.resolve() / "factory.sqlite3").as_uri() + "?mode=ro", uri=True)
        try:
            for (path,) in db.execute("SELECT path FROM semantic_shards WHERE split=? ORDER BY shard_id", (self.split,)):
                yield from iter_jsonl(path)
        finally:
            db.close()


def train_smoke(work_dir, epochs=3, max_examples=256):
    work_dir = Path(work_dir)
    rows = list(islice(SemanticExampleLoader(work_dir, "train"), max_examples))
    if not rows:
        # A bounded sample may hash wholly outside train; validation is allowed
        # for loader smoke only and is never used to update production weights.
        rows = list(islice(SemanticExampleLoader(work_dir, "validation"), max_examples))
    if not rows:
        raise ValueError("No semantic examples available for trainer smoke")
    x = np.asarray([row["input"]["sourceTensor"] for row in rows], dtype=np.float32)
    y = np.asarray([[float(row["target"]["availability"].get(family, False)) for family in FAMILIES] for row in rows], dtype=np.float32)
    weights = np.zeros((x.shape[1], y.shape[1]), dtype=np.float32)
    bias = np.zeros(y.shape[1], dtype=np.float32)
    history = []
    for epoch in range(int(epochs)):
        logits = x @ weights + bias
        probabilities = 1 / (1 + np.exp(-logits))
        loss = -np.mean(y * np.log(probabilities + 1e-8) + (1-y) * np.log(1-probabilities + 1e-8))
        gradient = (probabilities - y) / len(x)
        weights -= 0.05 * (x.T @ gradient)
        bias -= 0.05 * gradient.sum(axis=0)
        history.append({"epoch": epoch + 1, "loss": float(loss)})
    predicted = (1 / (1 + np.exp(-(x @ weights + bias))) >= 0.5).astype(np.float32)
    metrics = {
        "examples": len(rows), "epochs": int(epochs), "inputDim": x.shape[1], "outputs": y.shape[1],
        "parameters": int(weights.size + bias.size), "availabilityAccuracy": float((predicted == y).mean()),
        "initialLoss": history[0]["loss"], "finalLoss": history[-1]["loss"], "finite": bool(np.isfinite(weights).all()),
        "history": history, "purpose": "loader/trainer execution smoke; not the production joint decoder",
    }
    db = sqlite3.connect(work_dir / "factory.sqlite3")
    run_id = "smoke-" + hashlib.sha256(json.dumps(metrics, sort_keys=True).encode()).hexdigest()[:12]
    db.execute("INSERT OR REPLACE INTO training_runs(run_id,model_id,state,metrics_json,created_at) VALUES(?,?,?,?,?)", (run_id, "scope-availability-smoke-v1", "COMPLETE", json.dumps(metrics, sort_keys=True), utc_now()))
    db.commit(); db.close()
    return {"runId": run_id, **metrics}


def evaluate_loader(work_dir):
    result = {}
    (Path(work_dir) / 'semantic-staging').mkdir(exist_ok=True)
    with disk_index(Path(work_dir) / "semantic-staging") as seen:
        seen.execute("CREATE TABLE ids(kind TEXT,id TEXT,PRIMARY KEY(kind,id))")
        for split in ("train", "validation", "test", "future-test"):
            seen.execute("DELETE FROM ids")
            count = 0
            for row in SemanticExampleLoader(work_dir, split):
                count += 1
                seen.execute("INSERT OR IGNORE INTO ids VALUES('score',?)", (row["scoreId"],))
                seen.execute("INSERT OR IGNORE INTO ids VALUES('source',?)", (row["semanticSourceId"],))
                if count % 256 == 0:
                    seen.commit()
            result[split] = {"examples": count,
                "scores": seen.execute("SELECT COUNT(*) FROM ids WHERE kind='score'").fetchone()[0],
                "semanticSources": seen.execute("SELECT COUNT(*) FROM ids WHERE kind='source'").fetchone()[0]}
    return {"schemaVersion": 1, "splits": result, "futureTestReadByTrainer": False}
