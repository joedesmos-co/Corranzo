"""Bounded, transactional semantic assembly; no physical factory operations."""

import fcntl
import gzip
import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
from contextlib import contextmanager, nullcontext
from pathlib import Path

from factory import sha256_path, utc_now
from streaming_json import canonical_scopes


TERMINAL = ("COMPLETE", "EMPTY", "SKIPPED", "REVIEW")


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


@contextmanager
def disk_index(directory):
    # Temporary indexes are rebuildable, never source-of-truth outputs.
    with tempfile.TemporaryDirectory(prefix="index-", dir=directory) as temp:
        db = sqlite3.connect(Path(temp) / "index.sqlite3")
        db.execute("PRAGMA cache_size=-2048")
        db.execute("PRAGMA temp_store=FILE")
        db.execute("PRAGMA journal_mode=OFF")
        try:
            yield db
        finally:
            db.close()


class SemanticStreaming:
    def _streaming_schema(self):
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS semantic_score_progress (
          score_id TEXT PRIMARY KEY, input_digest TEXT NOT NULL,
          status TEXT NOT NULL, scope_cursor INTEGER NOT NULL DEFAULT 0,
          examples INTEGER NOT NULL DEFAULT 0, labels INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS semantic_assembly_errors (
          score_id TEXT NOT NULL, scope_cursor INTEGER NOT NULL,
          reason TEXT NOT NULL, details TEXT NOT NULL,
          PRIMARY KEY(score_id,scope_cursor,reason)
        );
        CREATE TABLE IF NOT EXISTS semantic_identities (
          kind TEXT NOT NULL, identity TEXT NOT NULL, split TEXT NOT NULL,
          PRIMARY KEY(kind,identity)
        );
        CREATE TABLE IF NOT EXISTS semantic_totals (
          split TEXT PRIMARY KEY, examples INTEGER NOT NULL,
          labels INTEGER NOT NULL, shards INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS semantic_examples_score ON semantic_examples(score_id);
        """)
        self.db.commit()

    def _disk_check(self, reserve=0):
        free = shutil.disk_usage(self.work_dir).free
        if free < self.free_floor_bytes + reserve:
            raise RuntimeError("DISK_BLOCKER: semantic writes require safety floor plus write reserve")

    def _event(self, stage):
        """Fault-injection/progress hook used only by bounded regression tests."""
        if self.event_hook:
            self.event_hook(stage, self)

    def _stop_requested(self):
        return any(row[0] == "true" for row in self.db.execute(
            "SELECT value FROM state WHERE key IN ('paused','stop_requested')"
        ))

    def _identity(self, kind, identity, split):
        existing = self.db.execute(
            "SELECT split FROM semantic_identities WHERE kind=? AND identity=?", (kind, identity)
        ).fetchone()
        if existing and existing[0] != split:
            raise RuntimeError(f"SEMANTIC_SPLIT_OVERLAP:{kind}:{identity}")
        self.db.execute("INSERT OR IGNORE INTO semantic_identities VALUES(?,?,?)", (kind, identity, split))

    def _split_for_score(self, score_id):
        from semantic_factory import semantic_split
        return semantic_split(score_id)

    def _input_fingerprint(self, row, target_path, target_exists):
        return digest({
            "canonical": sha256_path(row["path"]),
            "target": sha256_path(target_path) if target_exists else None,
            "contract": self.contract, "shardSize": self.shard_size,
            "bufferBytes": self.buffer_bytes, "layout": "SCORE_CHUNKS_V1",
        })

    def _transform_scope(self, source, target):
        return source, target

    def _shard_path(self, shard_id, split):
        return self.shard_dir / f"semantic-{split}-{shard_id:05d}.jsonl.gz"

    def _next_shard_id(self):
        return self.db.execute("SELECT COALESCE(MAX(shard_id),-1)+1 FROM semantic_shards").fetchone()[0]

    def _flush(self, score_id, split, cursor, chunk, errors):
        """File first, then one DB transaction for shard/examples/resume cursor.

        A crash before commit leaves an unregistered but complete file. Replay
        must produce its exact hash before adopting it; no final is overwritten.
        Staging partials are outside the consumer's semantic-shards glob.
        """
        self._disk_check(sum(len(item[1]) for item in chunk) + 65536)
        shard_id = self._next_shard_id()
        path = self._shard_path(shard_id, split)
        if chunk:
            partial = self.staging_dir / (path.name + ".partial")
            with partial.open("wb") as raw:
                with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as stream:
                    for item in chunk:
                        stream.write(item[1])
                raw.flush()
                os.fsync(raw.fileno())
            self._event("partial_fsynced")
            shard_hash = sha256_path(partial)
            if path.exists():
                if sha256_path(path) != shard_hash:
                    raise RuntimeError(f"ORPHAN_SHARD_CONFLICT:{path}")
                partial.unlink()
            else:
                os.replace(partial, path)
            sync_directory(self.shard_dir)
            self._event("shard_published")
        with self.db:
            if chunk:
                self.db.execute("INSERT INTO semantic_shards VALUES(?,?,?,?,?,?)",
                                (shard_id, str(path), len(chunk), shard_hash, split, utc_now()))
                for example, payload, source_hash, target_hash, labels in chunk:
                    self._identity("score", example["scoreId"], split)
                    self._identity("source", example["semanticSourceId"], split)
                    self.db.execute("INSERT INTO semantic_examples VALUES(?,?,?,?,?,?,?,?,?)", (
                        example["exampleId"], score_id, split, shard_id, str(path),
                        source_hash, target_hash, labels, utc_now(),
                    ))
                self.db.execute("""INSERT INTO semantic_totals VALUES(?,?,?,1)
                    ON CONFLICT(split) DO UPDATE SET examples=examples+excluded.examples,
                    labels=labels+excluded.labels,shards=shards+1""",
                    (split, len(chunk), sum(item[4] for item in chunk)))
            for error in errors:
                self.db.execute("INSERT OR IGNORE INTO semantic_assembly_errors VALUES(?,?,?,?)", (
                    score_id, error["scopeCursor"], error["reason"], json.dumps(error, sort_keys=True),
                ))
            self.db.execute("""UPDATE semantic_score_progress SET scope_cursor=?,
                examples=examples+?,labels=labels+?,updated_at=? WHERE score_id=?""",
                (cursor, len(chunk), sum(item[4] for item in chunk), utc_now(), score_id))
            self._event("before_commit")
        self._event("committed")

    def _process_score(self, row):
        from semantic_factory import FAMILIES, iter_jsonl, firewall_violations, query_contract, semantic_split, source_tensor

        score_id = row["score_id"]
        target_path = self._target_bundle(score_id)
        target_exists = bool(target_path and target_path.is_file())
        # Bind every score (including zero-output scores) to its immutable inputs.
        fingerprint = self._input_fingerprint(row, target_path, target_exists)
        progress = self.db.execute("SELECT * FROM semantic_score_progress WHERE score_id=?", (score_id,)).fetchone()
        if progress:
            if progress["input_digest"] != fingerprint:
                raise RuntimeError(f"EXISTING_EXAMPLE_DIGEST_MISMATCH:INPUT_CHANGED:{score_id}")
            if progress["status"] in TERMINAL:
                return False
        else:
            with self.db:
                self.db.execute("INSERT INTO semantic_score_progress VALUES(?,?,?,0,0,0,?)",
                                (score_id, fingerprint, "RUNNING", utc_now()))
            progress = {"scope_cursor": 0}
        self._set_state("semantic_current_score", score_id)
        if not target_exists:
            self._flush(score_id, self._split_for_score(score_id), 0, [], [
                {"scoreId": score_id, "scopeCursor": 0, "reason": "TARGET_BUNDLE_MISSING"}
            ])
            with self.db:
                self.db.execute("UPDATE semantic_score_progress SET status='SKIPPED',updated_at=? WHERE score_id=?",
                                (utc_now(), score_id))
            return True

        self._disk_check()
        with disk_index(self.staging_dir) as targets:
            targets.execute("CREATE TABLE targets(id TEXT PRIMARY KEY,payload TEXT NOT NULL)")
            # Preserve the old dictionary's last-occurrence-wins semantics.
            for number, target in enumerate(iter_jsonl(target_path), 1):
                serialized = json.dumps(target)
                self._disk_check(len(serialized.encode()) * 2 + 2 * 1024 * 1024)
                targets.execute("INSERT OR REPLACE INTO targets VALUES(?,?)",
                                (target["metadata"]["exampleId"], serialized))
                if number % self.shard_size == 0:
                    targets.commit()
                    self._disk_check()
                    if self._stop_requested():
                        raise InterruptedError("semantic stop requested")
            targets.commit()
            split = self._split_for_score(score_id)
            chunk, errors = [], []
            byte_count = 0
            cursor = progress["scope_cursor"]
            checkpoint_cursor = cursor
            for ordinal, source in enumerate(canonical_scopes(row["path"]), 1):
                if ordinal <= progress["scope_cursor"]:
                    continue
                if self._stop_requested():
                    # Discard only uncommitted work; never create stop-dependent shards.
                    raise InterruptedError("semantic stop requested")
                example_id = source["metadata"]["exampleId"]
                target_row = targets.execute("SELECT payload FROM targets WHERE id=?", (example_id,)).fetchone()
                target = json.loads(target_row[0]) if target_row else None
                if target:
                    source, target = self._transform_scope(source, target)
                violations = firewall_violations(source["modelInput"]) if target else []
                if not target or violations:
                    errors.append({"scoreId": score_id, "exampleId": example_id, "scopeCursor": ordinal,
                                   "reason": "FIREWALL" if violations else "TARGET_SCOPE_MISSING",
                                   **({"violations": violations} if violations else {})})
                else:
                    # Deliberately identical to the pre-streaming emitter contract.
                    known_labels = sum(label.get("state") == "KNOWN" for values in target["families"].values() for label in values)
                    example = {
                        "schemaVersion": 1, "exampleId": example_id, "scoreId": score_id,
                        "semanticSourceId": target["metadata"].get("groupId", score_id), "split": split,
                        "input": {"modelInput": source["modelInput"], "sourceTensor": source_tensor(source["modelInput"])},
                        "queries": query_contract(source["modelInput"]),
                        "target": {"families": target["families"], "availability": {family: any(label.get("state") == "KNOWN" for label in target["families"].get(family, [])) for family in FAMILIES}},
                        "decoderContract": {"id": "corranzo-joint-musical-consistency-v1", "allowAbstain": True, "configurationDigest": self.contract["configurationDigest"]},
                        "provenance": {"sourceCoordinateIdentity": True, "sourceTargetFirewall": "PASS", "runtimeTruthInputs": []},
                    }
                    source_hash, target_hash = digest(example["input"]), digest(example["target"])
                    existing = self.db.execute("SELECT source_digest,target_digest,split FROM semantic_examples WHERE example_id=?", (example_id,)).fetchone()
                    if existing:
                        if tuple(existing) != (source_hash, target_hash, split):
                            raise RuntimeError(f"EXISTING_EXAMPLE_DIGEST_MISMATCH:{example_id}")
                    else:
                        payload = (json.dumps(example, sort_keys=True, separators=(",", ":")) + "\n").encode()
                        chunk.append((example, payload, source_hash, target_hash, known_labels))
                        byte_count += len(payload)
                cursor = ordinal
                self.buffer_peak_examples = max(self.buffer_peak_examples, len(chunk))
                self.buffer_peak_bytes = max(self.buffer_peak_bytes, byte_count)
                if len(chunk) >= self.shard_size or byte_count >= self.buffer_bytes or cursor - checkpoint_cursor >= self.shard_size:
                    self._flush(score_id, split, cursor, chunk, errors)
                    chunk, errors, byte_count = [], [], 0
                    checkpoint_cursor = cursor
            if chunk or errors or cursor != checkpoint_cursor:
                self._flush(score_id, split, cursor, chunk, errors)
        count = self.db.execute("SELECT COUNT(*) FROM semantic_examples WHERE score_id=?", (score_id,)).fetchone()[0]
        error_count = self.db.execute("SELECT COUNT(*) FROM semantic_assembly_errors WHERE score_id=?", (score_id,)).fetchone()[0]
        with self.db:
            self.db.execute("UPDATE semantic_score_progress SET status=?,updated_at=? WHERE score_id=?",
                            ("REVIEW" if error_count else "COMPLETE" if count else "EMPTY", utc_now(), score_id))
        self._event("score_complete")
        return True

    def assemble(self, max_scores=30, interrupt_after=None):
        # Lock all new semantic entry points. full_pipeline also guards legacy workers.
        with nullcontext(self._worker_lock) as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                self._disk_check()
                if self.db.execute("SELECT COUNT(*) FROM semantic_shards").fetchone()[0]:
                    existing = self.validate()
                    if not existing['valid']:
                        raise RuntimeError('EXISTING_SEMANTIC_VALIDATION_FAILED: ' + str(existing['errors']))
                self._set_state("validation_report", "{}")
                self._set_state("semantic_build_state", "RUNNING")
                before = self.db.execute("SELECT COUNT(*),COALESCE(SUM(labels),0) FROM semantic_examples").fetchone()
                # Repair/initialize lightweight dashboard counters from authoritative rows.
                with self.db:
                    self.db.execute('DELETE FROM semantic_totals')
                    for split, count, labels in self.db.execute('SELECT split,COUNT(*),SUM(labels) FROM semantic_examples GROUP BY split'):
                        shards = self.db.execute('SELECT COUNT(*) FROM semantic_shards WHERE split=?', (split,)).fetchone()[0]
                        self.db.execute('INSERT INTO semantic_totals VALUES(?,?,?,?)', (split,count,labels,shards))
                processed = 0
                # Keyset iteration avoids both fetchall and a long SQLite read snapshot.
                last = ""
                for _ in range(max(0, int(max_scores))):
                    if self._stop_requested():
                        raise InterruptedError("semantic stop requested")
                    row = self.db.execute("SELECT * FROM canonical WHERE score_id>? ORDER BY score_id LIMIT 1", (last,)).fetchone()
                    if row is None:
                        break
                    last = row["score_id"]
                    if self._process_score(row):
                        processed += 1
                        if interrupt_after is not None and processed >= int(interrupt_after):
                            raise InterruptedError("bounded semantic interruption")
                report = self.validate()
                after = self.db.execute("SELECT COUNT(*),COALESCE(SUM(labels),0) FROM semantic_examples").fetchone()
                pending = self.db.execute("""SELECT COUNT(*) FROM canonical c LEFT JOIN semantic_score_progress p
                    USING(score_id) WHERE p.status IS NULL OR p.status='RUNNING'""").fetchone()[0]
                state = "FAILED" if not report["valid"] else "COMPLETE" if not pending else "PARTIAL"
                self._set_state("semantic_build_state", state)
                report.update(state=state, scoresConsidered=processed, examplesEmitted=after[0]-before[0],
                              labelsEmitted=after[1]-before[1], bufferPeakExamples=self.buffer_peak_examples,
                              bufferPeakBytes=self.buffer_peak_bytes)
                return report
            except (KeyboardInterrupt, InterruptedError):
                self.db.rollback()
                self._set_state("semantic_build_state", "PAUSED")
                return {"state": "PAUSED", "valid": False, "resumable": True}
            except BaseException as error:
                self.db.rollback()
                self._set_state("semantic_build_state", "FAILED")
                self._set_state("semantic_last_error", str(error)[:4096])
                raise

    def validate(self):
        from semantic_factory import iter_jsonl, firewall_violations
        errors = []
        records = 0
        split_isolation = True
        self._disk_check()
        with disk_index(self.staging_dir) as seen:
            seen.executescript("""
                CREATE TABLE ids(id TEXT PRIMARY KEY);
                CREATE TABLE identities(kind TEXT,id TEXT,split TEXT,PRIMARY KEY(kind,id));
            """)
            for shard in self.db.execute("SELECT * FROM semantic_shards ORDER BY shard_id"):
                if len(errors) >= 100:
                    break
                path = Path(shard["path"])
                if not path.is_file() or sha256_path(path) != shard["sha256"]:
                    errors.append(f"semantic shard hash mismatch: {shard['shard_id']}")
                    continue
                count = 0
                for example in iter_jsonl(path):
                    count += 1
                    records += 1
                    try:
                        seen.execute("INSERT INTO ids VALUES(?)", (example["exampleId"],))
                    except sqlite3.IntegrityError:
                        errors.append(f"duplicate example: {example['exampleId']}")
                    for kind, identity in (("score", example["scoreId"]), ("source", example["semanticSourceId"])):
                        prior = seen.execute("SELECT split FROM identities WHERE kind=? AND id=?", (kind, identity)).fetchone()
                        if prior and prior[0] != example["split"]:
                            split_isolation = False
                        seen.execute("INSERT OR IGNORE INTO identities VALUES(?,?,?)", (kind, identity, example["split"]))
                    if firewall_violations(example["input"]["modelInput"]):
                        errors.append(f"firewall: {example['exampleId']}")
                    row = self.db.execute("SELECT source_digest,target_digest,split,shard_id,labels FROM semantic_examples WHERE example_id=?", (example["exampleId"],)).fetchone()
                    labels = sum(label.get("state") == "KNOWN" for family in example["target"]["families"].values() for label in family)
                    if not row or tuple(row) != (digest(example["input"]), digest(example["target"]), example["split"], shard["shard_id"], labels):
                        errors.append(f"semantic example digest/index mismatch: {example['exampleId']}")
                    if len(errors) >= 100:
                        break
                if count != shard["records"]:
                    errors.append(f"semantic shard record mismatch: {shard['shard_id']}")
                seen.commit()
                self._disk_check()
                if len(errors) >= 100:
                    break
            future_scores = [row[0] for row in seen.execute("SELECT id FROM identities WHERE kind='score' AND split='future-test' ORDER BY id")]
            # Import legacy identities only after successful validation.
            if not errors and split_isolation:
                with self.db:
                    for kind, identity, split in seen.execute("SELECT kind,id,split FROM identities"):
                        self._identity(kind, identity, split)
        if not split_isolation:
            errors.append("whole-score or semantic-source split overlap")
        if records != self.db.execute("SELECT COUNT(*) FROM semantic_examples").fetchone()[0]:
            errors.append("semantic example database count mismatch")
        assembly_errors = [json.loads(row[0]) for row in self.db.execute("SELECT details FROM semantic_assembly_errors ORDER BY score_id,scope_cursor,reason LIMIT 100")]
        return {
            "schemaVersion": 1, "valid": not errors, "examples": records,
            "semanticLabels": self.db.execute("SELECT COALESCE(SUM(labels),0) FROM semantic_examples").fetchone()[0],
            "shards": self.db.execute("SELECT COUNT(*) FROM semantic_shards").fetchone()[0],
            "wholeScoreSplitIsolation": split_isolation, "semanticSourceSplitIsolation": split_isolation,
            "futureHeldoutScores": future_scores, "futureHeldoutReserved": bool(future_scores),
            "hashIntegrity": not any("hash" in error for error in errors), "errors": errors,
            "assemblyErrors": assembly_errors,
            "assemblyErrorCount": self.db.execute("SELECT COUNT(*) FROM semantic_assembly_errors").fetchone()[0],
            "skippedScores": self.db.execute("SELECT COUNT(*) FROM semantic_score_progress WHERE status='SKIPPED'").fetchone()[0],
        }
