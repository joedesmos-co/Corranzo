#!/usr/bin/env python3
"""Model-independent, archive-native PDMX dataset factory primitives."""

from __future__ import annotations

import csv
import gzip
import hashlib
import json
import os
import re
import resource
import shutil
import sqlite3
import tarfile
import time
import zipfile
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree as ET

from progress import aggregate_denominator_state, estimated_total, progress_record


SCHEMA_VERSION = 1
PIANO_TERMS = ("piano", "grand staff", "keyboard", "klavier", "pianoforte")
LICENSE_DENY = ("allrights", "copyright", "noncommercial", "no_license", "unknown")


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def boolish(value):
    return str(value or "").strip().lower() in {"1", "true", "yes", "y"}


def normalize_member(value):
    text = str(value or "").replace("\\", "/")
    while text.startswith("./"):
        text = text[2:]
    path = PurePosixPath(text)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"Unsafe archive member: {value}")
    return str(path)


def sha256_path(path, chunk_size=1024 * 1024):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        while chunk := stream.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def directory_size(path):
    total = 0
    path = Path(path)
    if not path.exists():
        return 0
    for entry in path.rglob("*"):
        if entry.is_file():
            total += entry.stat().st_size
    return total


def stable_split(score_id):
    bucket = int.from_bytes(hashlib.blake2b(score_id.encode(), digest_size=2).digest(), "big") % 100
    return "train" if bucket < 80 else "validation" if bucket < 90 else "test"


class Factory:
    def __init__(self, work_dir, csv_path, pdf_archive, mxl_archive, shard_size=16, free_floor_gib=4.0):
        self.work_dir = Path(work_dir).resolve()
        self.csv_path = Path(csv_path).resolve()
        self.pdf_archive = Path(pdf_archive).resolve()
        self.mxl_archive = Path(mxl_archive).resolve()
        self.cache_dir = self.work_dir / "cache"
        self.canonical_dir = self.work_dir / "canonical"
        self.shards_dir = self.work_dir / "shards"
        self.db_path = self.work_dir / "factory.sqlite3"
        self.shard_size = int(shard_size)
        self.free_floor_bytes = int(float(free_floor_gib) * 1024**3)
        for path in (self.work_dir, self.cache_dir, self.canonical_dir, self.shards_dir):
            path.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.db_path)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self._init_schema()

    def close(self):
        self.db.close()

    def _init_schema(self):
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS state (
              key TEXT PRIMARY KEY, value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS scores (
              score_id TEXT PRIMARY KEY,
              csv_row INTEGER NOT NULL,
              mxl_member TEXT,
              pdf_member TEXT,
              license TEXT,
              filter_state TEXT NOT NULL,
              pair_state TEXT,
              alignment_state TEXT,
              job_state TEXT NOT NULL DEFAULT 'PENDING',
              attempts INTEGER NOT NULL DEFAULT 0,
              metadata_json TEXT NOT NULL,
              error TEXT,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS scores_job_state ON scores(job_state, filter_state);
            CREATE TABLE IF NOT EXISTS canonical (
              score_id TEXT PRIMARY KEY,
              path TEXT NOT NULL,
              sha256 TEXT NOT NULL,
              split TEXT NOT NULL,
              pages INTEGER NOT NULL,
              measures INTEGER NOT NULL,
              notes INTEGER NOT NULL,
              objects INTEGER NOT NULL,
              scopes INTEGER NOT NULL,
              FOREIGN KEY(score_id) REFERENCES scores(score_id)
            );
            CREATE TABLE IF NOT EXISTS fragments (
              score_id TEXT PRIMARY KEY,
              shard_id INTEGER NOT NULL,
              path TEXT NOT NULL,
              sha256 TEXT NOT NULL,
              split TEXT NOT NULL,
              FOREIGN KEY(score_id) REFERENCES scores(score_id)
            );
            CREATE TABLE IF NOT EXISTS shards (
              shard_id INTEGER PRIMARY KEY,
              records INTEGER NOT NULL,
              aggregate_sha256 TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              created_at TEXT NOT NULL,
              level TEXT NOT NULL,
              score_id TEXT,
              stage TEXT NOT NULL,
              message TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS build_plan (
              score_id TEXT PRIMARY KEY,
              ordinal INTEGER NOT NULL UNIQUE,
              frozen_at TEXT NOT NULL,
              FOREIGN KEY(score_id) REFERENCES scores(score_id)
            );
            CREATE TABLE IF NOT EXISTS preflight_inventory (
              score_id TEXT PRIMARY KEY,
              pages INTEGER,
              pages_state TEXT NOT NULL DEFAULT 'CALCULATING',
              pages_method TEXT,
              measures INTEGER,
              notes INTEGER,
              mxl_state TEXT NOT NULL DEFAULT 'CALCULATING',
              error TEXT,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(score_id) REFERENCES build_plan(score_id)
            );
            """
        )
        self.db.commit()
        self.set_state("schema_version", str(SCHEMA_VERSION))
        self.set_state("created_at", self.get_state("created_at") or utc_now())
        self.set_state("paused", self.get_state("paused") or "false")

    def get_state(self, key, default=None):
        row = self.db.execute("SELECT value FROM state WHERE key = ?", (key,)).fetchone()
        return row[0] if row else default

    def set_state(self, key, value):
        self.db.execute(
            "INSERT INTO state(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, str(value)),
        )
        self.db.commit()

    def table_exists(self, name):
        return self.db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (str(name),)
        ).fetchone() is not None

    def log(self, level, stage, message, score_id=None):
        self.db.execute(
            "INSERT INTO events(created_at, level, score_id, stage, message) VALUES (?, ?, ?, ?, ?)",
            (utc_now(), level, score_id, stage, message),
        )
        self.db.commit()

    def check_disk(self):
        usage = shutil.disk_usage(self.work_dir)
        if usage.free < self.free_floor_bytes:
            raise RuntimeError(
                f"DISK_BLOCKER: {usage.free / 1024**3:.2f} GiB free is below "
                f"the configured {self.free_floor_bytes / 1024**3:.2f} GiB floor"
            )
        return usage.free

    def inspect_archive(self, archive, limit=100):
        archive = Path(archive)
        members = []
        started = time.monotonic()
        with tarfile.open(archive, mode="r|gz") as stream:
            for member in stream:
                if member.isfile():
                    members.append({"name": normalize_member(member.name), "size": member.size})
                    if len(members) >= limit:
                        break
        report = {
            "path": str(archive),
            "size": archive.stat().st_size,
            "sampledMembers": members,
            "sampleLimit": limit,
            "completeIndex": False,
            "elapsedSeconds": round(time.monotonic() - started, 3),
        }
        self.set_state(f"archive_probe:{archive.name}", json.dumps(report, sort_keys=True))
        self.log("INFO", "INSPECT", f"Probed {archive.name}: {len(members)} file members")
        return report

    def inspect(self, archive_scan_limit=20):
        missing = [str(path) for path in (self.csv_path, self.pdf_archive, self.mxl_archive) if not path.is_file()]
        if missing:
            raise FileNotFoundError(f"Missing factory inputs: {missing}")
        with open(self.csv_path, newline="", encoding="utf-8") as stream:
            header = next(csv.reader(stream))
        required = {"path", "mxl", "pdf", "license", "n_tracks"}
        absent = sorted(required - set(header))
        if absent:
            raise RuntimeError(f"CSV lacks required columns: {absent}")
        report = {
            "schemaVersion": SCHEMA_VERSION,
            "csv": {"path": str(self.csv_path), "bytes": self.csv_path.stat().st_size, "columns": len(header)},
            "pdfArchive": self.inspect_archive(self.pdf_archive, archive_scan_limit),
            "mxlArchive": self.inspect_archive(self.mxl_archive, archive_scan_limit),
            "diskFreeBytes": self.check_disk(),
            "manualExtractionRequired": False,
        }
        self.set_state("inspect_report", json.dumps(report, sort_keys=True))
        return report

    def _classify_metadata(self, row):
        if not row.get("mxl") or not row.get("pdf") or not boolish(row.get("subset:all_valid", True)):
            return "REJECT_INVALID", "missing pair path or invalid metadata"
        license_name = str(row.get("license") or "").lower().replace(" ", "")
        if not license_name or any(term in license_name for term in LICENSE_DENY):
            return "REJECT_LICENSE", f"ineligible license: {license_name or 'missing'}"
        if "subset:no_license_conflict" in row and not boolish(row.get("subset:no_license_conflict")):
            return "REJECT_LICENSE", "metadata license-conflict subset rejected"
        if "subset:deduplicated" in row and not boolish(row.get("subset:deduplicated")):
            return "REJECT_DUPLICATE", "metadata deduplication subset rejected"
        try:
            tracks = int(float(row.get("n_tracks") or 0))
        except ValueError:
            return "REJECT_INVALID", "invalid track count"
        if tracks > 2:
            return "REJECT_MULTI_INSTRUMENT", f"metadata reports {tracks} tracks"
        return "AMBIGUOUS_INSTRUMENTATION", "MusicXML structure verification required"

    def filter_metadata(self, limit=1000, reset=False):
        if reset and self.db.execute("SELECT COUNT(*) FROM build_plan").fetchone()[0]:
            raise RuntimeError("BUILD_PLAN_FROZEN: metadata reset would invalidate persisted denominators")
        if reset:
            self.set_state("metadata_cursor", "0")
        cursor = int(self.get_state("metadata_cursor", "0"))
        scanned = 0
        counts = Counter()
        started = time.monotonic()
        with open(self.csv_path, newline="", encoding="utf-8") as stream:
            reader = csv.DictReader(stream)
            for row_number, row in enumerate(reader, start=1):
                if row_number <= cursor:
                    continue
                state, reason = self._classify_metadata(row)
                try:
                    mxl_member = normalize_member(row.get("mxl")) if row.get("mxl") else None
                    pdf_member = normalize_member(row.get("pdf")) if row.get("pdf") else None
                except ValueError as error:
                    state, reason = "REJECT_INVALID", str(error)
                    mxl_member = pdf_member = None
                score_id = Path(mxl_member or row.get("path") or f"row-{row_number}").stem
                metadata = dict(row)
                metadata["filterReason"] = reason
                self.db.execute(
                    """
                    INSERT INTO scores(score_id, csv_row, mxl_member, pdf_member, license, filter_state,
                                       metadata_json, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(score_id) DO UPDATE SET
                      csv_row=excluded.csv_row, mxl_member=excluded.mxl_member, pdf_member=excluded.pdf_member,
                      license=excluded.license, filter_state=excluded.filter_state,
                      metadata_json=excluded.metadata_json, updated_at=excluded.updated_at
                    """,
                    (score_id, row_number, mxl_member, pdf_member, row.get("license"), state,
                     json.dumps(metadata, sort_keys=True), utc_now()),
                )
                scanned += 1
                counts[state] += 1
                cursor = row_number
                if scanned >= limit:
                    break
        self.db.commit()
        self.set_state("metadata_cursor", str(cursor))
        self.set_state("metadata_last_elapsed", str(time.monotonic() - started))
        self.log("INFO", "FILTER", f"Scanned {scanned} CSV rows through row {cursor}")
        return {"scanned": scanned, "cursor": cursor, "counts": dict(counts), "memoryBounded": True}

    def metadata_total_rows(self):
        persisted = self.get_state("metadata_total_rows")
        if persisted is not None:
            return int(persisted)
        with open(self.csv_path, newline="", encoding="utf-8") as stream:
            rows = max(0, sum(1 for _ in stream) - 1)
        self.set_state("metadata_total_rows", str(rows))
        return rows

    def freeze_build_plan(self):
        existing = self.db.execute("SELECT COUNT(*) FROM build_plan").fetchone()[0]
        if existing:
            return {
                "state": "FROZEN", "plannedScores": existing,
                "frozenAt": self.get_state("build_plan_frozen_at"),
                "formula": json.loads(self.get_state("overall_progress_formula")),
            }
        total_rows = self.metadata_total_rows()
        cursor = int(self.get_state("metadata_cursor", "0"))
        if cursor < total_rows:
            raise RuntimeError(f"METADATA_SCAN_INCOMPLETE: {cursor}/{total_rows}")
        frozen_at = utc_now()
        rows = self.db.execute(
            """SELECT score_id FROM scores
               WHERE filter_state NOT IN ('REJECT_INVALID','REJECT_LICENSE','REJECT_DUPLICATE','REJECT_MULTI_INSTRUMENT')
               ORDER BY csv_row"""
        ).fetchall()
        for ordinal, row in enumerate(rows, start=1):
            self.db.execute(
                "INSERT INTO build_plan(score_id,ordinal,frozen_at) VALUES(?,?,?)",
                (row["score_id"], ordinal, frozen_at),
            )
        formula = {
            "id": "FROZEN_SCORE_COMPLETION_V1",
            "numerator": "frozen plan scores in COMPLETE, REVIEW, REJECTED, or FAILED",
            "denominator": "scores in immutable build_plan",
            "completionGate": "dataset validation must pass before displaying 100.0000%",
            "weighting": "one transparent work unit per frozen planned score",
        }
        self.db.commit()
        self.set_state("build_plan_frozen_at", frozen_at)
        self.set_state("overall_progress_formula", json.dumps(formula, sort_keys=True))
        self.log("INFO", "PLAN", f"Frozen build plan: {len(rows)} scores")
        return {"state": "FROZEN", "plannedScores": len(rows), "frozenAt": frozen_at, "formula": formula}

    def _active_elapsed(self):
        elapsed = float(self.get_state("active_elapsed_seconds", "0") or 0)
        started = self.get_state("active_started_at")
        if started and self.get_state("paused", "false") != "true":
            elapsed += max(0.0, time.time() - datetime.fromisoformat(started.replace("Z", "+00:00")).timestamp())
        return elapsed

    def _start_active_clock(self):
        if self.get_state("paused", "false") == "true":
            return
        if not self.get_state("active_started_at"):
            self.set_state("active_started_at", utc_now())

    def _stop_active_clock(self):
        started = self.get_state("active_started_at")
        if not started:
            return
        elapsed = float(self.get_state("active_elapsed_seconds", "0") or 0)
        elapsed += max(0.0, time.time() - datetime.fromisoformat(started.replace("Z", "+00:00")).timestamp())
        self.set_state("active_elapsed_seconds", repr(elapsed))
        self.set_state("active_started_at", "")

    def record_progress_sample(self):
        processed = self.db.execute(
            """SELECT COUNT(*) FROM build_plan p JOIN scores s ON s.score_id=p.score_id
               WHERE s.job_state IN ('COMPLETE','REVIEW','REJECTED','FAILED')"""
        ).fetchone()[0]
        now = time.time()
        previous = json.loads(self.get_state("progress_smoothing", "{}") or "{}")
        samples = int(previous.get("samples", 0))
        ema = previous.get("emaScoresPerSecond")
        prior_time = previous.get("timestamp")
        prior_processed = previous.get("processed")
        if prior_time is not None and prior_processed is not None and now > prior_time and processed > prior_processed:
            rate = (processed - prior_processed) / (now - prior_time)
            ema = rate if ema is None else 0.2 * rate + 0.8 * ema
            samples += 1
        self.set_state("progress_smoothing", json.dumps({
            "schemaVersion": 1, "processed": processed, "timestamp": now,
            "emaScoresPerSecond": ema, "samples": samples,
        }, sort_keys=True))

    def _extract_batch(self, archive, targets, destination, byte_limit=1024**3):
        targets = {normalize_member(item) for item in targets}
        found = {}
        total = 0
        destination.mkdir(parents=True, exist_ok=True)
        with tarfile.open(archive, mode="r|gz") as stream:
            for member in stream:
                if not member.isfile():
                    continue
                name = normalize_member(member.name)
                if name not in targets:
                    continue
                total += member.size
                if total > byte_limit:
                    raise RuntimeError("Selective extraction byte limit exceeded")
                source = stream.extractfile(member)
                if source is None:
                    continue
                output = destination / name
                output.parent.mkdir(parents=True, exist_ok=True)
                partial = output.with_suffix(output.suffix + ".partial")
                with open(partial, "wb") as target:
                    shutil.copyfileobj(source, target, length=1024 * 1024)
                    target.flush()
                    os.fsync(target.fileno())
                os.replace(partial, output)
                found[name] = output
                if len(found) == len(targets):
                    break
        missing = sorted(targets - set(found))
        if missing:
            raise FileNotFoundError(f"Archive members not found: {missing[:5]}")
        return found

    def _musicxml_root(self, mxl_path):
        with zipfile.ZipFile(mxl_path) as archive:
            root_name = None
            if "META-INF/container.xml" in archive.namelist():
                container = ET.fromstring(archive.read("META-INF/container.xml"))
                rootfile = next((entry for entry in container.iter() if entry.tag.endswith("rootfile")), None)
                if rootfile is not None:
                    root_name = rootfile.attrib.get("full-path")
            if not root_name:
                root_name = next((name for name in archive.namelist() if name.lower().endswith((".musicxml", ".xml")) and not name.startswith("META-INF/")), None)
            if not root_name:
                raise ValueError("MXL contains no MusicXML root")
            return ET.fromstring(archive.read(root_name))

    def verify_mxl(self, path):
        root = self._musicxml_root(path)
        local = lambda element: element.tag.rsplit("}", 1)[-1]
        part_names = ["".join(element.itertext()).strip() for element in root.iter() if local(element) == "part-name"]
        parts = [element for element in root if local(element) == "part"]
        measures = sum(1 for element in root.iter() if local(element) == "measure")
        notes = [element for element in root.iter() if local(element) == "note"]
        rests = sum(1 for note in notes if any(local(child) == "rest" for child in note))
        pitched = len(notes) - rests
        staves = [int(element.text) for element in root.iter() if local(element) == "staves" and (element.text or "").isdigit()]
        max_staves = max(staves, default=1)
        name_text = " ".join(part_names).lower()
        piano_named = any(term in name_text for term in PIANO_TERMS)
        if len(parts) > 1:
            instrumentation = "REJECT_MULTI_INSTRUMENT"
        elif len(parts) != 1 or not notes or not measures:
            instrumentation = "REJECT_INVALID"
        elif max_staves >= 2 or piano_named:
            instrumentation = "ACCEPT_PIANO"
        else:
            instrumentation = "REJECT_NON_PIANO"
        fingerprint_payload = json.dumps(
            {"parts": len(parts), "measures": measures, "notes": pitched, "rests": rests, "staves": max_staves},
            sort_keys=True,
        ).encode()
        return {
            "valid": instrumentation not in {"REJECT_INVALID"},
            "instrumentation": instrumentation,
            "parts": len(parts),
            "partNames": part_names,
            "maxStaves": max_staves,
            "measures": measures,
            "notes": pitched,
            "rests": rests,
            "musicalFingerprint": hashlib.sha256(fingerprint_payload).hexdigest(),
        }

    def verify_pdf(self, path):
        data = Path(path).read_bytes()
        valid = data.startswith(b"%PDF-") and b"%%EOF" in data[-4096:]
        page_count = len(re.findall(rb"/Type\s*/Page(?!s)", data)) if valid else 0
        return {"valid": valid, "pages": max(1, page_count) if valid else 0}

    def _load_source_bundle(self, metadata):
        value = metadata.get("source_bundle") or metadata.get("sourceBundle")
        if not value:
            return None
        path = Path(value)
        if not path.is_absolute():
            path = (self.csv_path.parent / path).resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Source-coordinate bundle missing: {path}")
        opener = gzip.open if path.suffix == ".gz" else open
        records = []
        with opener(path, "rt", encoding="utf-8") as stream:
            for line in stream:
                if line.strip():
                    record = json.loads(line)
                    geometry = record.get("modelInput", {}).get("geometry", {})
                    if geometry.get("coordinateSpace") != "pdf-source-normalized":
                        raise ValueError("Source bundle violates normalized source-coordinate contract")
                    records.append({"metadata": record["metadata"], "modelInput": record["modelInput"]})
        if not records:
            raise ValueError("Source-coordinate bundle is empty")
        return records

    def _write_canonical(self, row, pdf_path, mxl_path, pdf_info, mxl_info, source_records):
        score_id = row["score_id"]
        pair_same_id = Path(row["pdf_member"]).stem == Path(row["mxl_member"]).stem == score_id
        if not pair_same_id or not pdf_info["valid"] or not mxl_info["valid"]:
            raise ValueError("PDF/MXL pair identity or file validity failed")
        metadata = json.loads(row["metadata_json"])
        source_state = "ACCEPTED_HIGH_CONFIDENCE" if source_records else "SOURCE_ALIGNMENT_REQUIRED"
        canonical = {
            "schemaVersion": SCHEMA_VERSION,
            "representation": "MODEL_INDEPENDENT_CANONICAL_SCORE",
            "instrumentProfile": "PIANO",
            "scoreId": score_id,
            "split": stable_split(score_id),
            "provenance": {
                "csvRow": row["csv_row"],
                "license": row["license"],
                "pdfMember": row["pdf_member"],
                "mxlMember": row["mxl_member"],
                "pdfSha256": sha256_path(pdf_path),
                "mxlSha256": sha256_path(mxl_path),
                "pairIdentity": "SAME_ARCHIVE_SCORE_ID",
            },
            "pairVerification": {
                "state": "ACCEPTED_HIGH_CONFIDENCE",
                "pdf": pdf_info,
                "mxl": mxl_info,
            },
            "sourceAlignment": {
                "state": source_state,
                "coordinateSpace": "pdf-source-normalized",
                "nominalMeasureIdentityUsed": False,
                "scopes": source_records or [],
            },
            "semanticTargets": {"state": "MODEL_CONTRACT_PENDING", "records": []},
        }
        output = self.canonical_dir / f"{score_id}.json.gz"
        partial = output.with_suffix(output.suffix + ".partial")
        with gzip.open(partial, "wt", encoding="utf-8") as stream:
            json.dump(canonical, stream, sort_keys=True, separators=(",", ":"))
        os.replace(partial, output)
        digest = sha256_path(output)
        objects = sum(len(record["modelInput"].get("physicalObjects", [])) for record in (source_records or []))
        self.db.execute(
            """INSERT OR REPLACE INTO canonical(score_id, path, sha256, split, pages, measures, notes, objects, scopes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (score_id, str(output), digest, stable_split(score_id), pdf_info["pages"], mxl_info["measures"],
             mxl_info["notes"], objects, len(source_records or [])),
        )
        return canonical, output, digest

    def _emit_fragment(self, score_id, canonical, canonical_path):
        existing = self.db.execute("SELECT * FROM fragments WHERE score_id = ?", (score_id,)).fetchone()
        if existing:
            return dict(existing)
        completed = self.db.execute("SELECT COUNT(*) FROM fragments").fetchone()[0]
        shard_id = completed // self.shard_size
        shard_dir = self.shards_dir / f"shard-{shard_id:05d}"
        shard_dir.mkdir(parents=True, exist_ok=True)
        fragment = shard_dir / f"{score_id}.json.gz"
        partial = fragment.with_suffix(fragment.suffix + ".partial")
        shutil.copyfile(canonical_path, partial)
        os.replace(partial, fragment)
        digest = sha256_path(fragment)
        split = canonical["split"]
        self.db.execute(
            "INSERT INTO fragments(score_id, shard_id, path, sha256, split) VALUES (?, ?, ?, ?, ?)",
            (score_id, shard_id, str(fragment), digest, split),
        )
        rows = self.db.execute("SELECT score_id, sha256 FROM fragments WHERE shard_id = ? ORDER BY score_id", (shard_id,)).fetchall()
        aggregate = hashlib.sha256("".join(row["sha256"] for row in rows).encode()).hexdigest()
        self.db.execute(
            """INSERT INTO shards(shard_id, records, aggregate_sha256, updated_at) VALUES (?, ?, ?, ?)
               ON CONFLICT(shard_id) DO UPDATE SET records=excluded.records,
               aggregate_sha256=excluded.aggregate_sha256, updated_at=excluded.updated_at""",
            (shard_id, len(rows), aggregate, utc_now()),
        )
        return {"score_id": score_id, "shard_id": shard_id, "path": str(fragment), "sha256": digest, "split": split}

    def build(self, max_scores=10, retry_failed=False, interrupt_after=None, retain_cache=False):
        self.check_disk()
        if self.get_state("paused", "false") == "true":
            return {"status": "PAUSED", "processed": 0}
        states = ["PENDING"]
        if retry_failed:
            states.append("FAILED")
        placeholders = ",".join("?" for _ in states)
        rows = self.db.execute(
            f"""SELECT * FROM scores WHERE filter_state = 'AMBIGUOUS_INSTRUMENTATION'
                AND job_state IN ({placeholders}) ORDER BY csv_row LIMIT ?""",
            (*states, int(max_scores)),
        ).fetchall()
        if not rows:
            return {"status": "NO_PENDING_CANDIDATES", "processed": 0}
        if not self.db.execute("SELECT COUNT(*) FROM build_plan").fetchone()[0]:
            self.freeze_build_plan()
        self._start_active_clock()
        self.set_state("validation_report", "{}")
        batch_tag = f"batch-{int(time.time() * 1000)}"
        batch_cache = self.cache_dir / batch_tag
        batch_cache.mkdir(parents=True, exist_ok=True)
        pdf_targets = [row["pdf_member"] for row in rows]
        mxl_targets = [row["mxl_member"] for row in rows]
        processed = accepted = review = rejected = failed = 0
        try:
            pdf_files = self._extract_batch(self.pdf_archive, pdf_targets, batch_cache / "pdf")
            mxl_files = self._extract_batch(self.mxl_archive, mxl_targets, batch_cache / "mxl")
            for row in rows:
                if self.get_state("paused", "false") == "true":
                    break
                score_id = row["score_id"]
                plan_row = self.db.execute("SELECT ordinal FROM build_plan WHERE score_id=?", (score_id,)).fetchone()
                inventory = self.db.execute("SELECT * FROM preflight_inventory WHERE score_id=?", (score_id,)).fetchone()
                score_started = utc_now()
                self.set_state("current_progress", json.dumps({
                    "scoreId": score_id, "scorePosition": plan_row["ordinal"] if plan_row else None,
                    "name": Path(row["mxl_member"]).name, "stage": "PAIR_VERIFICATION", "pageCurrent": 0,
                    "pageTotal": inventory["pages"] if inventory else None, "measureCurrent": 0,
                    "measureTotal": inventory["measures"] if inventory else None, "noteCurrent": 0,
                    "noteTotal": inventory["notes"] if inventory else None, "objects": 0, "examples": 0,
                    "startedAt": score_started, "warnings": [],
                }, sort_keys=True))
                self.db.execute(
                    "UPDATE scores SET job_state='RUNNING', attempts=attempts+1, error=NULL, updated_at=? WHERE score_id=?",
                    (utc_now(), score_id),
                )
                self.db.commit()
                try:
                    pdf_path = pdf_files[row["pdf_member"]]
                    mxl_path = mxl_files[row["mxl_member"]]
                    pdf_info = self.verify_pdf(pdf_path)
                    mxl_info = self.verify_mxl(mxl_path)
                    self.set_state("current_progress", json.dumps({
                        "scoreId": score_id, "scorePosition": plan_row["ordinal"] if plan_row else None,
                        "name": Path(row["mxl_member"]).name, "stage": "SOURCE_ALIGNMENT_AND_CANONICALIZATION",
                        "pageCurrent": pdf_info["pages"], "pageTotal": inventory["pages"] if inventory and inventory["pages"] is not None else pdf_info["pages"],
                        "measureCurrent": mxl_info["measures"], "measureTotal": inventory["measures"] if inventory and inventory["measures"] is not None else mxl_info["measures"],
                        "noteCurrent": inventory["notes"] if inventory and inventory["notes"] is not None else mxl_info["notes"],
                        "noteTotal": inventory["notes"] if inventory and inventory["notes"] is not None else mxl_info["notes"],
                        "objects": 0, "examples": 0, "startedAt": score_started, "warnings": [],
                    }, sort_keys=True))
                    instrumentation = mxl_info["instrumentation"]
                    if instrumentation != "ACCEPT_PIANO":
                        self.db.execute(
                            "UPDATE scores SET filter_state=?, pair_state='UNUSABLE', job_state='REJECTED', updated_at=? WHERE score_id=?",
                            (instrumentation, utc_now(), score_id),
                        )
                        rejected += 1
                    else:
                        metadata = json.loads(row["metadata_json"])
                        source_records = self._load_source_bundle(metadata)
                        canonical, canonical_path, _ = self._write_canonical(
                            row, pdf_path, mxl_path, pdf_info, mxl_info, source_records
                        )
                        if source_records:
                            self._emit_fragment(score_id, canonical, canonical_path)
                            job_state = "COMPLETE"
                            alignment_state = "ACCEPTED_HIGH_CONFIDENCE"
                            accepted += 1
                        else:
                            job_state = "REVIEW"
                            alignment_state = "SOURCE_ALIGNMENT_REQUIRED"
                            review += 1
                        self.db.execute(
                            """UPDATE scores SET filter_state='ACCEPT_PIANO', pair_state='ACCEPTED_HIGH_CONFIDENCE',
                               alignment_state=?, job_state=?, updated_at=? WHERE score_id=?""",
                            (alignment_state, job_state, utc_now(), score_id),
                        )
                    self.db.commit()
                    processed += 1
                    self.log("INFO", "BUILD", f"Score reached {job_state if instrumentation == 'ACCEPT_PIANO' else 'REJECTED'}", score_id)
                except Exception as error:
                    self.db.execute(
                        "UPDATE scores SET job_state='FAILED', error=?, updated_at=? WHERE score_id=?",
                        (str(error), utc_now(), score_id),
                    )
                    self.db.commit()
                    failed += 1
                    processed += 1
                    self.log("ERROR", "BUILD", str(error), score_id)
                self.record_progress_sample()
                if interrupt_after is not None and processed >= int(interrupt_after):
                    self.set_state("current_progress", "null")
                    self.log("WARN", "BUILD", f"Forced interruption after {processed} scores")
                    return {"status": "INTERRUPTED", "processed": processed, "accepted": accepted,
                            "review": review, "rejected": rejected, "failed": failed}
        finally:
            if self.get_state("paused", "false") != "true":
                self.set_state("current_progress", "null")
            if batch_cache.exists() and not retain_cache:
                shutil.rmtree(batch_cache)
        return {"status": "COMPLETE", "processed": processed, "accepted": accepted,
                "review": review, "rejected": rejected, "failed": failed}

    def retry_failed(self):
        count = self.db.execute("UPDATE scores SET job_state='PENDING', error=NULL WHERE job_state='FAILED'").rowcount
        self.db.commit()
        if count:
            self.set_state("validation_report", "{}")
        self.log("INFO", "RETRY", f"Reset {count} failed scores")
        return {"reset": count}

    def pause(self):
        self._stop_active_clock()
        self.set_state("paused", "true")
        self.log("INFO", "CONTROL", "Factory paused")
        return {"paused": True}

    def stop(self):
        self.set_state("paused", "true")
        self.set_state("stop_requested", "true")
        self.log("INFO", "CONTROL", "Factory stop requested at next score boundary")
        return {"paused": True, "stopRequested": True}

    def resume(self):
        self.set_state("paused", "false")
        self.set_state("stop_requested", "false")
        self._start_active_clock()
        self.log("INFO", "CONTROL", "Factory resumed")
        return {"paused": False}

    def status(self, event_limit=40):
        score_counts = {row["job_state"]: row["count"] for row in self.db.execute(
            "SELECT job_state, COUNT(*) AS count FROM scores GROUP BY job_state"
        )}
        filter_counts = {row["filter_state"]: row["count"] for row in self.db.execute(
            "SELECT filter_state, COUNT(*) AS count FROM scores GROUP BY filter_state"
        )}
        music = dict(self.db.execute(
            """SELECT COALESCE(SUM(pages),0), COALESCE(SUM(measures),0), COALESCE(SUM(notes),0),
                      COALESCE(SUM(objects),0), COALESCE(SUM(scopes),0), COUNT(*) FROM canonical"""
        ).fetchone())
        events = [dict(row) for row in self.db.execute(
            "SELECT * FROM events ORDER BY id DESC LIMIT ?", (int(event_limit),)
        ).fetchall()]
        disk = shutil.disk_usage(self.work_dir)
        cursor = int(self.get_state("metadata_cursor", "0"))
        wall_elapsed = max(0.001, time.time() - datetime.fromisoformat(self.get_state("created_at").replace("Z", "+00:00")).timestamp())
        active_elapsed = max(0.001, self._active_elapsed())
        final_states = ("COMPLETE", "REVIEW", "REJECTED", "FAILED")
        plan_total = self.db.execute("SELECT COUNT(*) FROM build_plan").fetchone()[0]
        if plan_total:
            processed = self.db.execute(
                """SELECT COUNT(*) FROM build_plan p JOIN scores s ON s.score_id=p.score_id
                   WHERE s.job_state IN ('COMPLETE','REVIEW','REJECTED','FAILED')"""
            ).fetchone()[0]
            planned_counts = {row["job_state"]: row["count"] for row in self.db.execute(
                """SELECT s.job_state,COUNT(*) AS count FROM build_plan p JOIN scores s ON s.score_id=p.score_id
                   GROUP BY s.job_state"""
            )}
        else:
            processed = sum(score_counts.get(state, 0) for state in final_states)
            planned_counts = score_counts
        remaining_scores = max(0, plan_total - processed) if plan_total else None
        if active_elapsed <= 0.001 and processed:
            active_elapsed = wall_elapsed
        current_row = self.db.execute(
            """SELECT score_id, job_state, attempts, error, updated_at FROM scores
               WHERE job_state='RUNNING' ORDER BY updated_at DESC LIMIT 1"""
        ).fetchone()
        persisted_progress = json.loads(self.get_state("current_progress", "null"))
        current = persisted_progress or (dict(current_row) if current_row else None)
        pages = music["COALESCE(SUM(pages),0)"]
        measures = music["COALESCE(SUM(measures),0)"]
        notes = music["COALESCE(SUM(notes),0)"]
        semantic_examples = semantic_labels = semantic_shards = 0
        semantic_splits = {}
        latest_training = None
        durable_totals = list(self.db.execute('SELECT split,examples,labels,shards FROM semantic_totals')) if self.table_exists('semantic_totals') else []
        if durable_totals:
            semantic_examples = sum(row['examples'] for row in durable_totals)
            semantic_labels = sum(row['labels'] for row in durable_totals)
            semantic_shards = sum(row['shards'] for row in durable_totals)
            semantic_splits = {row['split']: row['examples'] for row in durable_totals}
        elif self.table_exists("semantic_examples"):
            semantic_examples, semantic_labels = self.db.execute(
                "SELECT COUNT(*), COALESCE(SUM(labels),0) FROM semantic_examples"
            ).fetchone()
            semantic_splits = {row["split"]: row["count"] for row in self.db.execute(
                "SELECT split,COUNT(*) AS count FROM semantic_examples GROUP BY split"
            )}
        if not durable_totals and self.table_exists("semantic_shards"):
            semantic_shards = self.db.execute("SELECT COUNT(*) FROM semantic_shards").fetchone()[0]
        if self.table_exists("training_runs"):
            training = self.db.execute("SELECT * FROM training_runs ORDER BY created_at DESC LIMIT 1").fetchone()
            if training:
                latest_training = {"runId": training["run_id"], "modelId": training["model_id"], "state": training["state"], "metrics": json.loads(training["metrics_json"])}
        contract_valid = self.get_state("model_contract_valid", "false") == "true"
        preflight_state = self.get_state("preflight_state", "PENDING")
        inventory = self.db.execute(
            """SELECT i.*,s.job_state FROM preflight_inventory i
               JOIN build_plan p ON p.score_id=i.score_id JOIN scores s ON s.score_id=i.score_id
               ORDER BY p.ordinal"""
        ).fetchall()
        inventory_complete = preflight_state == "COMPLETE" and len(inventory) == plan_total
        page_state = aggregate_denominator_state((row["pages_state"] for row in inventory), inventory_complete)
        mxl_state = aggregate_denominator_state((row["mxl_state"] for row in inventory), inventory_complete)
        page_known_total = sum(row["pages"] or 0 for row in inventory)
        measure_known_total = sum(row["measures"] or 0 for row in inventory)
        note_known_total = sum(row["notes"] or 0 for row in inventory)
        finalized = set(final_states)
        page_processed = sum(row["pages"] or 0 for row in inventory if row["job_state"] in finalized)
        measure_processed = sum(row["measures"] or 0 for row in inventory if row["job_state"] in finalized)
        note_processed = sum(row["notes"] or 0 for row in inventory if row["job_state"] in finalized)
        validation = json.loads(self.get_state("validation_report", "{}") or "{}")
        semantic_state = self.get_state("semantic_build_state", "PENDING")
        semantic_complete = semantic_state == "COMPLETE"
        canonical_total = music['COUNT(*)']
        semantic_score_states = {}
        if self.table_exists('semantic_score_progress'):
            semantic_score_states = dict(self.db.execute('SELECT status,COUNT(*) FROM semantic_score_progress GROUP BY status'))
        semantic_processed = sum(semantic_score_states.get(k, 0) for k in ('COMPLETE', 'EMPTY', 'SKIPPED', 'REVIEW'))
        validation_complete = bool(validation.get("valid"))
        completion_gate = bool(plan_total and processed == plan_total and validation_complete and (semantic_complete or not contract_valid))
        score_state = "EXACT" if plan_total else "CALCULATING"
        score_work_complete = bool(plan_total and processed == plan_total)
        units = {
            "scores": progress_record(processed, plan_total or None, score_state,
                                      "Frozen planned scores in COMPLETE, REVIEW, REJECTED, or FAILED",
                                      completion_gate=score_work_complete),
            "pages": progress_record(page_processed, page_known_total, page_state,
                                     "PDF pages finalized across frozen planned scores; exact uses the PDF page tree",
                                     completion_gate=bool(page_state in {"EXACT", "ESTIMATED"} and page_processed >= page_known_total), known_subtotal=page_known_total),
            "measures": progress_record(measure_processed, measure_known_total, mxl_state,
                                        "Source MusicXML measure elements finalized across frozen planned scores",
                                        completion_gate=bool(mxl_state in {"EXACT", "ESTIMATED"} and measure_processed >= measure_known_total), known_subtotal=measure_known_total),
            "musicXmlNotes": progress_record(note_processed, note_known_total, mxl_state,
                                             "Source MusicXML note elements, including rests and chord members",
                                             completion_gate=bool(mxl_state in {"EXACT", "ESTIMATED"} and note_processed >= note_known_total), known_subtotal=note_known_total),
        }
        object_total, object_state = estimated_total(music["COALESCE(SUM(objects),0)"], processed, plan_total) if plan_total else (None, "CALCULATING")
        units["physicalObjects"] = progress_record(
            music["COALESCE(SUM(objects),0)"], object_total, object_state,
            "Source-aligned physical objects emitted by finalized scores",
            completion_gate=score_work_complete,
        )
        if semantic_complete:
            example_total, example_state = semantic_examples, "EXACT"
            label_total, label_state = semantic_labels, "EXACT"
        elif not contract_valid:
            example_total = label_total = None
            example_state = label_state = "UNAVAILABLE"
        else:
            # Mid-score output advances immediately, but is not a completed-score yield sample.
            example_total = label_total = None
            example_state = label_state = 'CALCULATING'
        units['semanticScores'] = progress_record(
            semantic_processed, canonical_total, 'EXACT', 'Canonical scores durably processed by semantic assembly',
            completion_gate=semantic_complete,
        )
        units["trainingExamples"] = progress_record(
            semantic_examples, example_total, example_state,
            "Sharded semantic training examples; estimates extrapolate observed whole-score yield",
            completion_gate=semantic_complete,
        )
        units["semanticLabels"] = progress_record(
            semantic_labels, label_total, label_state,
            "Known semantic supervision labels; estimates extrapolate observed whole-score yield",
            completion_gate=semantic_complete,
        )
        input_validation = json.loads(self.get_state("input_validation", "{}") or "{}")
        full_build_state = self.get_state("full_build_state", "PENDING")
        metadata_total = int(self.get_state("metadata_total_rows", "0") or 0)
        input_complete = bool(input_validation.get("state") == "READY" and input_validation.get("modelContract", {}).get("valid"))
        phases = [
            {"id": "validate-inputs", "label": "Validate Inputs", "status": "COMPLETE" if input_complete else "PENDING",
             **progress_record(1 if input_complete else 0, 1, "EXACT", "Four local inputs plus model contract")},
            {"id": "metadata-scan", "label": "Metadata Scan", "status": "COMPLETE" if metadata_total and cursor >= metadata_total else "RUNNING" if cursor else "PENDING",
             **progress_record(cursor, metadata_total or None, "EXACT" if metadata_total else "CALCULATING", "Rows scanned from PDMX.csv")},
            {"id": "corpus-preflight", "label": "Corpus Preflight", "status": preflight_state,
             **progress_record(int(self.get_state("preflight_processed", "0") or 0), plan_total or None, score_state,
                              "Frozen planned scores structurally inventoried")},
            {"id": "dataset-build", "label": "Dataset Build", "status": "FAILED" if full_build_state == "FAILED" else "COMPLETE" if score_work_complete and (semantic_complete or not contract_valid) else "PAUSED" if self.get_state("paused", "false") == "true" else "RUNNING" if processed else "PENDING",
             **units["scores"]},
            {"id": "dataset-validation", "label": "Dataset Validation", "status": "COMPLETE" if validation_complete else "PENDING",
             **progress_record(1 if validation_complete else 0, 1, "EXACT", "Generic and semantic dataset validation gate")},
            {"id": "training", "label": "Training", "status": "PENDING",
             **progress_record(0, None, "UNAVAILABLE", "Production model training is not part of the dataset build")},
        ]
        phases.insert(4, {'id': 'semantic-build', 'label': 'Semantic Assembly', 'status': semantic_state,
                          **units['semanticScores']})
        if current:
            current = dict(current)
            started_at = current.get("startedAt")
            current["elapsedSeconds"] = max(0.0, time.time() - datetime.fromisoformat(started_at.replace("Z", "+00:00")).timestamp()) if started_at else None
            current["scoreTotal"] = plan_total or None
            current["pageProgress"] = progress_record(current.get("pageCurrent", 0), current.get("pageTotal"), "EXACT" if current.get("pageTotal") is not None else "CALCULATING", "Current score PDF pages")
            current["measureProgress"] = progress_record(current.get("measureCurrent", 0), current.get("measureTotal"), "EXACT" if current.get("measureTotal") is not None else "CALCULATING", "Current score MusicXML measures")
            current["noteProgress"] = progress_record(current.get("noteCurrent", 0), current.get("noteTotal"), "EXACT" if current.get("noteTotal") is not None else "CALCULATING", "Current score MusicXML note elements")
        smoothing = json.loads(self.get_state("progress_smoothing", "{}") or "{}")
        ema = smoothing.get("emaScoresPerSecond")
        samples = int(smoothing.get("samples", 0))
        if completion_gate:
            eta_state, eta_seconds = "COMPLETE", 0.0
        elif ema and samples >= 3 and remaining_scores is not None:
            eta_state, eta_seconds = "READY", remaining_scores / ema
        else:
            eta_state, eta_seconds = "CALIBRATING", None
        estimated_finish = (datetime.now(timezone.utc) + timedelta(seconds=eta_seconds)).isoformat().replace("+00:00", "Z") if eta_seconds is not None else None
        scores_per_hour = (ema * 3600) if ema else (processed / active_elapsed * 3600 if active_elapsed > 0 else 0)
        dataset_bytes = directory_size(self.canonical_dir) + directory_size(self.shards_dir)
        estimated_bytes, estimated_bytes_state = estimated_total(dataset_bytes, processed, plan_total) if plan_total else (None, "UNAVAILABLE")
        disk_required = self.free_floor_bytes
        build_plan = {
            "state": "READY" if inventory_complete else "CALCULATING" if plan_total else "PENDING",
            "frozen": bool(plan_total), "frozenAt": self.get_state("build_plan_frozen_at"),
            "plannedScores": units["scores"], "plannedPages": units["pages"],
            "plannedMeasures": units["measures"], "plannedMusicXmlNotes": units["musicXmlNotes"],
            "estimatedDatasetBytes": {"value": estimated_bytes, "state": estimated_bytes_state},
            "disk": {"freeBytes": disk.free, "requiredMinimumBytes": disk_required,
                     "shortfallBytes": max(0, disk_required - disk.free), "safe": disk.free >= disk_required},
        }
        formula = json.loads(self.get_state("overall_progress_formula", "{}") or "{}")
        overall_progress = {**progress_record(processed, plan_total or None, score_state,
                                              "Frozen score work units gated by completed dataset validation",
                                              completion_gate=completion_gate), "formula": formula,
                            "status": "FAILED" if full_build_state == "FAILED" else "COMPLETE" if completion_gate else "PAUSED" if self.get_state("paused", "false") == "true" else "RUNNING" if processed else "PENDING"}
        return {
            "schemaVersion": 2,
            'semantic': {
                'state': semantic_state, 'canonicalScoresTotal': canonical_total,
                'scoresProcessed': semantic_processed, 'scoreStates': semantic_score_states,
                'examplesEmitted': semantic_examples, 'labelsEmitted': semantic_labels,
                'shardsEmitted': semantic_shards, 'currentScoreId': self.get_state('semantic_current_score'),
            },
            "authorization": "SEMANTIC_FACTORY_CONTRACT_VALIDATED" if contract_valid else "GENERIC_FACTORY_MODEL_CONTRACT_PENDING",
            "overall": {
                "metadataScanned": cursor,
                "scoresDiscovered": sum(score_counts.values()),
                "jobStates": planned_counts,
                "filterStates": filter_counts,
                "processed": processed,
                "accepted": planned_counts.get("COMPLETE", 0),
                "review": planned_counts.get("REVIEW", 0),
                "rejected": planned_counts.get("REJECTED", 0),
                "failed": planned_counts.get("FAILED", 0),
                "remaining": remaining_scores,
            },
            "music": {
                "pages": pages,
                "measures": measures,
                "notes": notes,
                "objects": music["COALESCE(SUM(objects),0)"],
                "sourceCoordinateScopes": music["COALESCE(SUM(scopes),0)"],
                "canonicalScores": music["COUNT(*)"],
                "semanticLabels": semantic_labels,
                "trainingExamples": semantic_examples,
                "semanticShards": semantic_shards,
                "semanticSplits": semantic_splits,
            },
            "progress": {"schemaVersion": 1, "overall": overall_progress, "units": units, "phases": phases,
                         "buildPlan": build_plan, "denominatorStates": ["EXACT", "ESTIMATED", "CALCULATING", "UNAVAILABLE"]},
            "currentScore": current,
            "throughput": {
                "scoresPerHour": scores_per_hour,
                "pagesPerMinute": page_processed / active_elapsed * 60,
                "measuresPerMinute": measure_processed / active_elapsed * 60,
                "notesPerMinute": note_processed / active_elapsed * 60,
                "objectsPerMinute": music["COALESCE(SUM(objects),0)"] / active_elapsed * 60,
                "examplesPerMinute": semantic_examples / active_elapsed * 60,
                "remainingScores": remaining_scores,
                "remainingPages": max(0, page_known_total - page_processed) if page_state in {"EXACT", "ESTIMATED"} else None,
                "remainingMeasures": max(0, measure_known_total - measure_processed) if mxl_state in {"EXACT", "ESTIMATED"} else None,
                "remainingNotes": max(0, note_known_total - note_processed) if mxl_state in {"EXACT", "ESTIMATED"} else None,
            },
            "time": {"elapsedSeconds": active_elapsed, "wallElapsedSeconds": wall_elapsed,
                     "etaState": eta_state, "etaSeconds": eta_seconds, "estimatedFinishAt": estimated_finish,
                     "smoothingSamples": samples},
            "system": {
                "diskFreeBytes": disk.free,
                "datasetBytes": dataset_bytes,
                "loadAverage1m": os.getloadavg()[0] if hasattr(os, "getloadavg") else None,
                "processRamBytes": int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss),
                "processCpuSeconds": round(os.times().user + os.times().system, 3),
            },
            "paused": self.get_state("paused", "false") == "true",
            "modelContract": {
                "valid": contract_valid,
                "digest": self.get_state("model_contract_digest"),
                "state": "VALIDATED" if contract_valid else "MODEL_CONTRACT_PENDING",
            },
            "training": latest_training,
            "liveLog": events,
        }

    def validate_dataset(self):
        errors = []
        seen = set()
        split_by_score = {}
        semantic_table = self.db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='semantic_examples'"
        ).fetchone()
        semantic_examples = self.db.execute("SELECT COUNT(*) FROM semantic_examples").fetchone()[0] if semantic_table else 0
        contract_valid = self.get_state("model_contract_valid", "false") == "true"
        for row in self.db.execute("SELECT * FROM canonical ORDER BY score_id"):
            path = Path(row["path"])
            if not path.is_file() or sha256_path(path) != row["sha256"]:
                errors.append(f"canonical hash mismatch: {row['score_id']}")
            if row["score_id"] in seen:
                errors.append(f"duplicate canonical score: {row['score_id']}")
            seen.add(row["score_id"])
            split_by_score[row["score_id"]] = row["split"]
        fragment_count = 0
        for row in self.db.execute("SELECT * FROM fragments ORDER BY score_id"):
            fragment_count += 1
            path = Path(row["path"])
            if not path.is_file() or sha256_path(path) != row["sha256"]:
                errors.append(f"fragment hash mismatch: {row['score_id']}")
            if split_by_score.get(row["score_id"]) != row["split"]:
                errors.append(f"split mismatch: {row['score_id']}")
        for shard in self.db.execute("SELECT * FROM shards ORDER BY shard_id"):
            rows = self.db.execute("SELECT sha256 FROM fragments WHERE shard_id=? ORDER BY score_id", (shard["shard_id"],)).fetchall()
            aggregate = hashlib.sha256("".join(row["sha256"] for row in rows).encode()).hexdigest()
            if len(rows) != shard["records"] or aggregate != shard["aggregate_sha256"]:
                errors.append(f"shard integrity mismatch: {shard['shard_id']}")
        report = {
            "schemaVersion": SCHEMA_VERSION,
            "valid": not errors,
            "canonicalScores": len(seen),
            "fragments": fragment_count,
            "scoreDuplicates": 0 if not any("duplicate" in error for error in errors) else None,
            "splitIntegrity": not any("split" in error for error in errors),
            "hashIntegrity": not any("hash" in error or "shard" in error for error in errors),
            "semanticEmitter": (
                "ENABLED_JOINT_CONTRACT_VALIDATED" if semantic_examples
                else "READY_MODEL_CONTRACT_VALIDATED" if contract_valid
                else "DISABLED_MODEL_CONTRACT_PENDING"
            ),
            "errors": errors,
        }
        self.set_state("validation_report", json.dumps(report, sort_keys=True))
        self.log("INFO" if report["valid"] else "ERROR", "VALIDATE", f"Dataset valid={report['valid']}")
        return report
