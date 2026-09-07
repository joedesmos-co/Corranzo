"""Frozen pre-fix emitter used ONLY by bounded content-equivalence tests.

Never use this class on the full factory. Its all-corpus buffering is intentional
so regression tests compare against the actual previous assembly implementation.
"""

import gzip
import hashlib
import json
import os
from collections import defaultdict
from pathlib import Path
from factory import sha256_path, utc_now
from semantic_factory import (SemanticFactory, FAMILIES, firewall_violations,
                              read_jsonl, source_tensor, query_contract, semantic_split)


class LegacySemanticFactory(SemanticFactory):
    def assemble(self, max_scores=30):
        self._set_state("validation_report", "{}")
        self._set_state("semantic_build_state", "RUNNING")
        rows = self.db.execute("SELECT * FROM canonical ORDER BY score_id LIMIT ?", (int(max_scores),)).fetchall()
        emitted = skipped = labels = 0
        examples_by_split = defaultdict(list)
        errors = []
        for row in rows:
            score_id = row["score_id"]
            target_path = self._target_bundle(score_id)
            if not target_path or not target_path.is_file():
                skipped += 1
                errors.append({"scoreId": score_id, "reason": "TARGET_BUNDLE_MISSING"})
                continue
            with gzip.open(row["path"], "rt", encoding="utf-8") as stream:
                canonical = json.load(stream)
            targets = {record["metadata"]["exampleId"]: record for record in read_jsonl(target_path)}
            split = semantic_split(score_id)
            for source in canonical["sourceAlignment"]["scopes"]:
                example_id = source["metadata"]["exampleId"]
                target = targets.get(example_id)
                if not target:
                    errors.append({"scoreId": score_id, "exampleId": example_id, "reason": "TARGET_SCOPE_MISSING"})
                    continue
                violations = firewall_violations(source["modelInput"])
                if violations:
                    errors.append({"scoreId": score_id, "exampleId": example_id, "reason": "FIREWALL", "violations": violations})
                    continue
                known_labels = sum(label.get("state") == "KNOWN" for values in target["families"].values() for label in values)
                example = {
                    "schemaVersion": 1,
                    "exampleId": example_id,
                    "scoreId": score_id,
                    "semanticSourceId": target["metadata"].get("groupId", score_id),
                    "split": split,
                    "input": {"modelInput": source["modelInput"], "sourceTensor": source_tensor(source["modelInput"])},
                    "queries": query_contract(source["modelInput"]),
                    "target": {"families": target["families"], "availability": {family: any(label.get("state") == "KNOWN" for label in target["families"].get(family, [])) for family in FAMILIES}},
                    "decoderContract": {"id": "corranzo-joint-musical-consistency-v1", "allowAbstain": True, "configurationDigest": self.contract["configurationDigest"]},
                    "provenance": {"sourceCoordinateIdentity": True, "sourceTargetFirewall": "PASS", "runtimeTruthInputs": []},
                }
                source_digest = hashlib.sha256(json.dumps(example["input"], sort_keys=True).encode()).hexdigest()
                target_digest = hashlib.sha256(json.dumps(example["target"], sort_keys=True).encode()).hexdigest()
                existing = self.db.execute(
                    "SELECT source_digest,target_digest,split FROM semantic_examples WHERE example_id=?",
                    (example_id,),
                ).fetchone()
                if existing:
                    if (existing["source_digest"], existing["target_digest"], existing["split"]) != (source_digest, target_digest, split):
                        errors.append({"scoreId": score_id, "exampleId": example_id, "reason": "EXISTING_EXAMPLE_DIGEST_MISMATCH"})
                    continue
                examples_by_split[split].append(example)
                labels += known_labels
        for split, examples in examples_by_split.items():
            for start in range(0, len(examples), self.shard_size):
                chunk = examples[start:start + self.shard_size]
                existing = self.db.execute("SELECT COALESCE(MAX(shard_id),-1)+1 FROM semantic_shards").fetchone()[0]
                shard_id = int(existing)
                path = self.shard_dir / f"semantic-{split}-{shard_id:05d}.jsonl.gz"
                partial = path.with_suffix(path.suffix + ".partial")
                with gzip.open(partial, "wt", encoding="utf-8") as stream:
                    for example in chunk:
                        stream.write(json.dumps(example, sort_keys=True, separators=(",", ":")) + "\n")
                os.replace(partial, path)
                digest = sha256_path(path)
                self.db.execute("INSERT INTO semantic_shards(shard_id,path,records,sha256,split,created_at) VALUES(?,?,?,?,?,?)", (shard_id, str(path), len(chunk), digest, split, utc_now()))
                for example in chunk:
                    label_count = sum(label.get("state") == "KNOWN" for values in example["target"]["families"].values() for label in values)
                    source_digest = hashlib.sha256(json.dumps(example["input"], sort_keys=True).encode()).hexdigest()
                    target_digest = hashlib.sha256(json.dumps(example["target"], sort_keys=True).encode()).hexdigest()
                    cursor = self.db.execute("INSERT INTO semantic_examples(example_id,score_id,split,shard_id,shard_path,source_digest,target_digest,labels,created_at) VALUES(?,?,?,?,?,?,?,?,?)", (example["exampleId"], example["scoreId"], split, shard_id, str(path), source_digest, target_digest, label_count, utc_now()))
                    emitted += int(cursor.rowcount == 1)
        self.db.commit()
        report = self.validate()
        report.update(scoresConsidered=len(rows), examplesEmitted=emitted, labelsEmitted=labels, skippedScores=skipped, assemblyErrors=errors)
        self._set_state("semantic_build_state", "COMPLETE" if report["valid"] else "FAILED")
        return report

    def validate(self):
        errors = []
        score_splits = defaultdict(set)
        semantic_source_splits = defaultdict(set)
        example_ids = set()
        records = 0
        for shard in self.db.execute("SELECT * FROM semantic_shards ORDER BY shard_id"):
            path = Path(shard["path"])
            if not path.is_file() or sha256_path(path) != shard["sha256"]:
                errors.append(f"semantic shard hash mismatch: {shard['shard_id']}")
                continue
            chunk = read_jsonl(path)
            if len(chunk) != shard["records"]:
                errors.append(f"semantic shard record mismatch: {shard['shard_id']}")
            for example in chunk:
                records += 1
                if example["exampleId"] in example_ids:
                    errors.append(f"duplicate example: {example['exampleId']}")
                example_ids.add(example["exampleId"])
                score_splits[example["scoreId"]].add(example["split"])
                semantic_source_splits[example["semanticSourceId"]].add(example["split"])
                if firewall_violations(example["input"]["modelInput"]):
                    errors.append(f"firewall: {example['exampleId']}")
        split_isolation = all(len(values) == 1 for values in score_splits.values()) and all(len(values) == 1 for values in semantic_source_splits.values())
        if not split_isolation:
            errors.append("whole-score or semantic-source split overlap")
        future_scores = sorted(score for score, splits in score_splits.items() if splits == {"future-test"})
        return {
            "schemaVersion": 1, "valid": not errors, "examples": records,
            "semanticLabels": self.db.execute("SELECT COALESCE(SUM(labels),0) FROM semantic_examples").fetchone()[0],
            "shards": self.db.execute("SELECT COUNT(*) FROM semantic_shards").fetchone()[0],
            "wholeScoreSplitIsolation": split_isolation, "semanticSourceSplitIsolation": split_isolation,
            "futureHeldoutScores": future_scores, "futureHeldoutReserved": bool(future_scores),
            "hashIntegrity": not any("hash" in error for error in errors), "errors": errors,
        }
