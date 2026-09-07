"""Read-only factory preparation and explicit human-review workflow.

The only files written by this module live in the Piano Vision campaign
directory.  It never writes to the factory directory or starts training.
"""

from __future__ import annotations

import hashlib
import gzip
import json
import math
import os
import shutil
import sqlite3
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

from .config import config_digest, load_config
from .data import SPLITS, build_dataset_index, load_dataset_index, verify_index_shards


REVIEW_CONFIRMATION = "HUMAN_REVIEW_COMPLETE"
DEFAULT_QUIESCENCE_SECONDS = 300
FACTORY_PROCESS_MARKERS = (
    "tools/pdmx-factory/full_pipeline.py",
    "pdmx-factory/full_pipeline.py",
    "source-coordinate-producer",
)


def _utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _atomic_json(path: Path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".partial")
    partial.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(partial, path)


def _json_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _process_snapshot():
    try:
        result = subprocess.run(
            ["ps", "-axo", "pid=,command="], check=False, capture_output=True, text=True, timeout=5,
        )
        return result.stdout.splitlines() if result.returncode == 0 else []
    except (OSError, subprocess.SubprocessError):
        return []


def _open_file_pids(paths):
    pids = set()
    available = True
    for path in paths:
        if not Path(path).exists():
            continue
        try:
            result = subprocess.run(
                ["lsof", "-t", str(path)], check=False, capture_output=True, text=True, timeout=5,
            )
        except (OSError, subprocess.SubprocessError):
            available = False
            continue
        if result.returncode not in (0, 1):
            available = False
        for value in result.stdout.split():
            if value.isdigit() and int(value) != os.getpid():
                pids.add(int(value))
    return sorted(pids), available


def detect_factory_liveness(
    factory_dir: Path,
    quiescence_seconds=DEFAULT_QUIESCENCE_SECONDS,
    process_lines=None,
    open_file_pids=None,
):
    """Use process, open-file, and WAL evidence before permitting DB access."""
    requested_factory_dir = Path(factory_dir)
    factory_dir = requested_factory_dir.resolve()
    database = factory_dir / "factory.sqlite3"
    wal = factory_dir / "factory.sqlite3-wal"
    shm = factory_dir / "factory.sqlite3-shm"
    now = time.time()
    lines = list(process_lines) if process_lines is not None else _process_snapshot()
    directory_tokens = {str(requested_factory_dir), str(factory_dir), factory_dir.name}
    process_matches = [
        line.strip() for line in lines
        if any(token and token in line for token in directory_tokens)
        and any(marker in line for marker in FACTORY_PROCESS_MARKERS)
    ]
    if open_file_pids is None:
        file_pids, lsof_available = _open_file_pids((database, wal, shm))
    else:
        file_pids, lsof_available = sorted(int(value) for value in open_file_pids), True
    wal_exists = wal.exists()
    wal_size = wal.stat().st_size if wal_exists else 0
    wal_age = max(0.0, now - wal.stat().st_mtime) if wal_exists else None
    active_process = bool(process_matches or file_pids)
    recent_wal_without_process = bool(
        wal_exists and wal_age is not None and wal_age < float(quiescence_seconds) and not active_process
    )
    safe_to_open = bool(database.is_file() and not active_process and not recent_wal_without_process)
    if active_process:
        state = "ACTIVE"
        reason = "factory process or open database handle detected"
    elif recent_wal_without_process:
        state = "QUIESCENCE_HOLD"
        reason = f"WAL has not been quiescent for {int(quiescence_seconds)} seconds"
    elif wal_exists:
        state = "STALE_WAL_SAFE_TO_INSPECT_READ_ONLY"
        reason = "no live process or open handle and WAL is quiescent"
    elif database.is_file():
        state = "QUIESCENT_SAFE_TO_INSPECT_READ_ONLY"
        reason = "no live process, open handle, or WAL activity detected"
    else:
        state = "MISSING"
        reason = "factory database is missing"
    completion_markers = [
        name for name in ("FACTORY_COMPLETE", "factory-complete.json", "build-complete.json")
        if (factory_dir / name).is_file()
    ]
    return {
        "state": state,
        "active": active_process or recent_wal_without_process,
        "reason": reason,
        "factory_directory": str(factory_dir),
        "database_exists": database.is_file(),
        "database_opened": False,
        "safe_to_open_database": safe_to_open,
        "process_matches": process_matches,
        "open_file_pids": file_pids,
        "open_file_probe_available": lsof_available,
        "wal_exists": wal_exists,
        "wal_bytes": wal_size,
        "wal_age_seconds": round(wal_age, 3) if wal_age is not None else None,
        "quiescence_seconds": int(quiescence_seconds),
        "completion_markers": completion_markers,
    }


def _table_exists(connection, name):
    return connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,),
    ).fetchone() is not None


def _scalar(connection, statement, default=0):
    row = connection.execute(statement).fetchone()
    return row[0] if row and row[0] is not None else default


def read_factory_metadata(factory_dir: Path, liveness=None):
    """Read the final SQLite state only after conservative liveness clearance."""
    factory_dir = Path(factory_dir).resolve()
    liveness = liveness or detect_factory_liveness(factory_dir)
    if not liveness.get("safe_to_open_database"):
        raise PermissionError("Factory database access blocked: " + liveness.get("reason", "unsafe state"))
    database = factory_dir / "factory.sqlite3"
    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True, timeout=2)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only=ON")
        if not _table_exists(connection, "state"):
            raise ValueError("Factory database has no state table")
        state = {row["key"]: row["value"] for row in connection.execute("SELECT key,value FROM state")}
        try:
            validation = json.loads(state.get("validation_report", "{}") or "{}")
        except json.JSONDecodeError:
            validation = {"valid": False, "errors": ["invalid validation_report JSON"]}

        has_plan = _table_exists(connection, "build_plan")
        has_scores = _table_exists(connection, "scores")
        has_canonical = _table_exists(connection, "canonical")
        planned = _scalar(connection, "SELECT COUNT(*) FROM build_plan") if has_plan else (
            _scalar(connection, "SELECT COUNT(*) FROM scores") if has_scores else 0
        )
        if has_plan and has_scores:
            state_counts = {
                row["job_state"]: row["count"]
                for row in connection.execute(
                    """SELECT s.job_state,COUNT(*) AS count FROM build_plan p
                       JOIN scores s ON s.score_id=p.score_id GROUP BY s.job_state"""
                )
            }
        elif has_scores:
            state_counts = {
                row["job_state"]: row["count"]
                for row in connection.execute("SELECT job_state,COUNT(*) AS count FROM scores GROUP BY job_state")
            }
        else:
            state_counts = {}
        processed = sum(state_counts.get(name, 0) for name in ("COMPLETE", "REVIEW", "REJECTED", "FAILED"))

        if has_canonical:
            music_row = connection.execute(
                """SELECT COALESCE(SUM(pages),0) AS pages,
                          COALESCE(SUM(measures),0) AS measures,
                          COALESCE(SUM(notes),0) AS notes,
                          COALESCE(SUM(objects),0) AS objects,
                          COALESCE(SUM(scopes),0) AS scopes,
                          COUNT(*) AS canonical_scores FROM canonical"""
            ).fetchone()
            music = dict(music_row)
        else:
            music = {"pages": 0, "measures": 0, "notes": 0, "objects": 0, "scopes": 0, "canonical_scores": 0}

        semantic_examples = semantic_labels = 0
        semantic_splits = {split: 0 for split in SPLITS}
        if _table_exists(connection, "semantic_examples"):
            semantic_examples, semantic_labels = connection.execute(
                "SELECT COUNT(*),COALESCE(SUM(labels),0) FROM semantic_examples"
            ).fetchone()
            for row in connection.execute("SELECT split,COUNT(*) AS count FROM semantic_examples GROUP BY split"):
                semantic_splits[row["split"]] = row["count"]
        semantic_shards = []
        if _table_exists(connection, "semantic_shards"):
            for row in connection.execute("SELECT shard_id,path,records,sha256,split FROM semantic_shards ORDER BY shard_id"):
                semantic_shards.append(dict(row))
        return {
            "schema_version": 1,
            "factory_directory": str(factory_dir),
            "database_opened": True,
            "full_build_state": state.get("full_build_state", "PENDING"),
            "semantic_build_state": state.get("semantic_build_state", "PENDING"),
            "dataset_validation": validation,
            "dataset_validation_pass": bool(validation.get("valid")),
            "planned_scores": int(planned),
            "processed_scores": int(processed),
            "accepted_scores": int(state_counts.get("COMPLETE", 0)),
            "review_scores": int(state_counts.get("REVIEW", 0)),
            "rejected_scores": int(state_counts.get("REJECTED", 0)),
            "failed_scores": int(state_counts.get("FAILED", 0)),
            "job_states": state_counts,
            "pages": int(music["pages"]),
            "measures": int(music["measures"]),
            "notes": int(music["notes"]),
            "physical_objects": int(music["objects"]),
            "source_coordinate_scopes": int(music["scopes"]),
            "canonical_scores": int(music["canonical_scores"]),
            "semantic_labels": int(semantic_labels),
            "training_examples": int(semantic_examples),
            "split_examples": semantic_splits,
            "semantic_shards": semantic_shards,
        }
    finally:
        connection.close()


def _factory_shard_path(factory_dir, path):
    path = Path(path)
    return path.resolve() if path.is_absolute() else (Path(factory_dir) / path).resolve()


def compare_factory_shard_inventory(factory_dir: Path, metadata, index):
    factory_dir = Path(factory_dir).resolve()
    indexed = {row["path"]: row for row in index["shards"]}
    expected = {}
    errors = []
    for row in metadata.get("semantic_shards", []):
        absolute = _factory_shard_path(factory_dir, row["path"])
        try:
            relative = str(absolute.relative_to(factory_dir))
        except ValueError:
            errors.append(f"shard-outside-factory:{row['path']}")
            continue
        expected[relative] = row
        actual = indexed.get(relative)
        if actual is None:
            errors.append(f"missing-indexed-shard:{relative}")
            continue
        if int(actual["records"]) != int(row["records"]):
            errors.append(f"record-count-mismatch:{relative}")
        if row.get("sha256") and actual.get("sha256") != row["sha256"]:
            errors.append(f"factory-hash-mismatch:{relative}")
    for relative in sorted(set(indexed) - set(expected)):
        errors.append(f"undeclared-semantic-shard:{relative}")
    return {
        "valid": not errors,
        "factory_shards": len(expected),
        "indexed_shards": len(indexed),
        "errors": errors,
    }


def inspect_training_assets(factory_dir: Path, index, error_limit=100):
    """Validate canonical-to-pixel availability and estimate train-time bytes."""
    factory_dir = Path(factory_dir).resolve()
    errors = []
    missing_count = 0
    canonical_bytes = 0
    scopes = 0
    scopes_with_pixel_paths = 0
    pixel_paths = set()
    pixel_owners = {}

    def add_error(message):
        nonlocal missing_count
        missing_count += 1
        if len(errors) < int(error_limit):
            errors.append(message)

    for score in index["scores"]:
        canonical_path = factory_dir / "canonical" / f"{score['score_id']}.json.gz"
        if not canonical_path.is_file():
            add_error(f"missing-canonical:{score['score_id']}")
            continue
        canonical_bytes += canonical_path.stat().st_size
        try:
            with gzip.open(canonical_path, "rt", encoding="utf-8") as stream:
                canonical = json.load(stream)
        except Exception as error:
            add_error(f"invalid-canonical:{score['score_id']}:{error}")
            continue
        score_scopes = canonical.get("sourceAlignment", {}).get("scopes", [])
        scopes += len(score_scopes)
        score_pixel_scopes = 0
        for scope in score_scopes:
            rendered = scope.get("metadata", {}).get("renderedPagePath")
            if not rendered:
                continue
            path = Path(rendered)
            if not path.is_absolute():
                path = factory_dir / path
            path = path.resolve()
            score_pixel_scopes += 1
            scopes_with_pixel_paths += 1
            pixel_paths.add(str(path))
            pixel_owners.setdefault(str(path), set()).add((score["split"], score["score_id"]))
        if score_pixel_scopes < int(score["examples"]):
            add_error(
                f"insufficient-pixel-scopes:{score['score_id']}:{score_pixel_scopes}<{score['examples']}"
            )
    pixel_rows = []
    visual_bytes = 0
    content_owners = {}
    pixel_leaks = []
    pixel_leak_count = 0
    decoded_assets = 0
    for value in sorted(pixel_paths):
        path = Path(value)
        if not path.is_file():
            add_error(f"missing-pixel:{value}")
            continue
        size = path.stat().st_size
        visual_bytes += size
        try:
            # Compare the actual grayscale input, including dimensions. PNG
            # metadata/compression and different archive IDs can conceal duplicates.
            with Image.open(path) as source:
                pixels = source.convert("L")
                content_hash = hashlib.sha256()
                content_hash.update(f"{pixels.width}x{pixels.height}:L:".encode())
                content_hash.update(pixels.tobytes())
            content_digest = content_hash.hexdigest()
            decoded_assets += 1
        except Exception as error:
            add_error(f"invalid-pixel:{value}:{error}")
            continue
        for split, score_id in sorted(pixel_owners[value]):
            previous = content_owners.setdefault(content_digest, (split, score_id, value))
            if previous[0] != split:
                pixel_leak_count += 1
                add_error(f"pixel-content-split-overlap:{previous[1]}:{score_id}")
                if len(pixel_leaks) < int(error_limit):
                    pixel_leaks.append({
                        "pixel_digest": content_digest,
                        "first": {"split": previous[0], "score_id": previous[1], "path": previous[2]},
                        "second": {"split": split, "score_id": score_id, "path": value},
                    })
        pixel_rows.append((value, size, content_digest))
    semantic_bytes = int(index.get("dataset_bytes", 0))
    return {
        "valid": missing_count == 0,
        "canonical_scores": len(index["scores"]),
        "canonical_bytes": canonical_bytes,
        "canonical_scopes": scopes,
        "scopes_with_pixel_paths": scopes_with_pixel_paths,
        "unique_visual_assets": len(pixel_paths),
        "decoded_visual_assets": decoded_assets,
        "pixel_content_split_isolation": pixel_leak_count == 0,
        "pixel_content_split_overlap_count": pixel_leak_count,
        "pixel_content_split_overlaps": pixel_leaks,
        "visual_asset_bytes": visual_bytes,
        "semantic_shard_bytes": semantic_bytes,
        "estimated_training_dataset_bytes": canonical_bytes + visual_bytes + semantic_bytes,
        "visual_asset_manifest_digest": _json_digest(pixel_rows),
        "missing_or_invalid_count": missing_count,
        "errors": errors,
        "errors_truncated": missing_count > len(errors),
    }


def estimate_tiny_workload(index, config):
    training = config["training"]
    examples = int(index["splits"]["train"]["examples"])
    batch = int(training["batch_size"])
    accumulation = int(training["gradient_accumulation"])
    epochs = int(training["epochs"])
    microbatches = math.ceil(examples / max(1, batch))
    optimizer_steps = math.ceil(microbatches / max(1, accumulation))
    # Planning range only; a post-build MPS benchmark should narrow it.
    slow_examples_per_second = 6.0
    fast_examples_per_second = 20.0
    total_examples = examples * epochs
    return {
        "model_variant": config["model"]["variant"],
        "train_examples": examples,
        "epochs_configured": epochs,
        "micro_batch_size": batch,
        "gradient_accumulation": accumulation,
        "effective_batch_size": batch * accumulation,
        "microbatches_per_epoch": microbatches,
        "optimizer_steps_per_epoch": optimizer_steps,
        "maximum_optimizer_steps": optimizer_steps * epochs,
        "planning_throughput_examples_per_second": {
            "conservative": slow_examples_per_second,
            "optimistic": fast_examples_per_second,
        },
        "estimated_wall_seconds": {
            "optimistic": round(total_examples / fast_examples_per_second),
            "conservative": round(total_examples / slow_examples_per_second),
        },
        "estimate_kind": "PLANNING_RANGE_REQUIRES_POST_BUILD_BENCHMARK",
    }


def _blocked_preparation(factory_dir, campaign_dir, liveness, blockers, metadata=None, errors=None):
    return {
        "schema_version": 1,
        "prepared": False,
        "full_training": "BLOCKED — " + blockers[0].replace("_", " ").upper(),
        "factory_directory": str(Path(factory_dir).resolve()),
        "campaign_directory": str(Path(campaign_dir).resolve()),
        "liveness": liveness,
        "database_opened": bool(metadata and metadata.get("database_opened")),
        "factory_metadata": metadata,
        "checks": {name: False for name in blockers},
        "blockers": blockers,
        "errors": errors or [],
        "missing_or_corrupt_shards": errors or [],
        "training_started": False,
    }


def prepare_full(
    factory_dir: Path,
    campaign_dir: Path,
    config_path: Path | None = None,
    disk_floor_gib=20.0,
    quiescence_seconds=DEFAULT_QUIESCENCE_SECONDS,
    process_lines=None,
    open_file_pids=None,
):
    """Freeze a hash-verified semantic index after, and only after, completion."""
    factory_dir = Path(factory_dir).resolve()
    campaign_dir = Path(campaign_dir).resolve()
    campaign_dir.mkdir(parents=True, exist_ok=True)
    report_path = campaign_dir / "full-readiness-report.json"
    index_path = campaign_dir / "full-semantic-index.json"
    config_path = Path(config_path or campaign_dir / "piano-vision-v1-mac.frozen.json").resolve()
    liveness = detect_factory_liveness(
        factory_dir, quiescence_seconds, process_lines=process_lines, open_file_pids=open_file_pids,
    )
    if not liveness["safe_to_open_database"]:
        blockers = ["factory_active" if liveness["active"] else "factory_database_missing"]
        report = _blocked_preparation(factory_dir, campaign_dir, liveness, blockers)
        if liveness["active"]:
            report["full_training"] = "BLOCKED — DATASET BUILD IN PROGRESS"
        _atomic_json(report_path, report)
        return report

    try:
        metadata = read_factory_metadata(factory_dir, liveness)
    except Exception as error:
        report = _blocked_preparation(
            factory_dir, campaign_dir, liveness, ["factory_metadata_unreadable"], errors=[str(error)],
        )
        _atomic_json(report_path, report)
        return report
    liveness = {**liveness, "database_opened": True}
    completion_checks = {
        "factory_build_complete": metadata["full_build_state"] == "COMPLETE",
        "dataset_validation_pass": metadata["dataset_validation_pass"],
        "semantic_build_complete": metadata["semantic_build_state"] == "COMPLETE",
    }
    completion_blockers = [name for name, passed in completion_checks.items() if not passed]
    if completion_blockers:
        report = _blocked_preparation(factory_dir, campaign_dir, liveness, completion_blockers, metadata)
        report["checks"] = completion_checks
        _atomic_json(report_path, report)
        return report

    candidate_path = campaign_dir / ".full-semantic-index.preparing.json"
    try:
        index = build_dataset_index(factory_dir, candidate_path, verify_hashes=True)
        shard_verification = verify_index_shards(index, require_hashes=True)
        factory_inventory = compare_factory_shard_inventory(factory_dir, metadata, index)
        training_assets = inspect_training_assets(factory_dir, index)
        if not shard_verification["valid"] or not factory_inventory["valid"] or not training_assets["valid"]:
            integrity_checks = {
                **completion_checks,
                "index_hashes_pass": shard_verification["valid"],
                "factory_shard_inventory_pass": factory_inventory["valid"],
                "training_assets_available": training_assets["valid"],
                "pixel_content_split_isolation": training_assets["pixel_content_split_isolation"],
            }
            report = _blocked_preparation(
                factory_dir, campaign_dir, liveness,
                [key for key, passed in integrity_checks.items() if not passed], metadata,
                shard_verification["errors"] + factory_inventory["errors"] + training_assets["errors"],
            )
            report.update(
                checks=integrity_checks,
                shard_verification=shard_verification,
                factory_shard_inventory=factory_inventory,
                training_asset_inventory=training_assets,
                missing_or_corrupt_shards=shard_verification["errors"] + factory_inventory["errors"],
            )
            candidate_path.unlink(missing_ok=True)
            _atomic_json(report_path, report)
            return report
        os.replace(candidate_path, index_path)
        index = load_dataset_index(index_path, expected_root=factory_dir)
        config = load_config(config_path)
        expected_config_digest = config.get("config_digest")
        actual_config_digest = config_digest({key: value for key, value in config.items() if key != "config_digest"})
        workload = estimate_tiny_workload(index, config)
        free = shutil.disk_usage(factory_dir).free
        checks = {
            **completion_checks,
            "full_semantic_index_exists": index_path.is_file(),
            "index_hashes_pass": shard_verification["valid"],
            "factory_shard_inventory_pass": factory_inventory["valid"],
            "training_assets_available": training_assets["valid"],
            "manifest_digest_frozen": bool(index.get("manifest_frozen") and index.get("manifest_digest") and index.get("dataset_digest")),
            "whole_score_split_isolation": bool(index.get("whole_score_split_isolation")),
            "semantic_source_isolation": bool(index.get("semantic_source_split_isolation")),
            "future_test_locked": bool(
                index.get("future_test_reserved")
                and index.get("future_test_lock") == "RESERVED_NOT_TRAINER_ACCESSIBLE"
            ),
            "model_config_frozen": bool(config.get("frozen") and expected_config_digest == actual_config_digest),
            "disk_safety": free >= int(float(disk_floor_gib) * 1024**3),
            "human_review_complete": False,
        }
        blockers = [name for name, passed in checks.items() if not passed]
        report = {
            "schema_version": 1,
            "prepared": all(value for key, value in checks.items() if key != "human_review_complete"),
            "full_training": "BLOCKED — HUMAN REVIEW INCOMPLETE" if blockers == ["human_review_complete"] else "BLOCKED — " + blockers[0].replace("_", " ").upper() if blockers else "READY",
            "factory_directory": str(factory_dir),
            "campaign_directory": str(campaign_dir),
            "liveness": liveness,
            "database_opened": True,
            "factory_metadata": metadata,
            "index_path": str(index_path),
            "dataset_digest": index["dataset_digest"],
            "manifest_digest": index["manifest_digest"],
            "index_summary": {
                "shards": len(index["shards"]),
                "scores": len(index["scores"]),
                "examples": sum(row["examples"] for row in index["splits"].values()),
                "dataset_bytes": index["dataset_bytes"],
                "estimated_training_dataset_bytes": training_assets["estimated_training_dataset_bytes"],
                "splits": index["splits"],
                "family_availability": index["family_availability"],
            },
            "shard_verification": shard_verification,
            "factory_shard_inventory": factory_inventory,
            "training_asset_inventory": training_assets,
            "tiny_workload_estimate": workload,
            "checks": checks,
            "blockers": blockers,
            "disk_free_bytes": free,
            "disk_floor_bytes": int(float(disk_floor_gib) * 1024**3),
            "missing_or_corrupt_shards": shard_verification["errors"] + factory_inventory["errors"],
            "training_started": False,
        }
    except Exception as error:
        candidate_path.unlink(missing_ok=True)
        report = _blocked_preparation(
            factory_dir, campaign_dir, liveness, ["full_semantic_index_failed"], metadata, [str(error)],
        )
    _atomic_json(report_path, report)
    return report


def _review_summary(metadata, index, shard_report, factory_inventory, training_assets):
    return {
        "planned_scores": metadata["planned_scores"],
        "processed_scores": metadata["processed_scores"],
        "accepted": metadata["accepted_scores"],
        "review": metadata["review_scores"],
        "rejected": metadata["rejected_scores"],
        "failed": metadata["failed_scores"],
        "pages": metadata["pages"],
        "measures": metadata["measures"],
        "notes": metadata["notes"],
        "physical_objects": metadata["physical_objects"],
        "semantic_labels": metadata["semantic_labels"],
        "training_examples": sum(row["examples"] for row in index["splits"].values()),
        "shards": len(index["shards"]),
        "dataset_bytes": training_assets["estimated_training_dataset_bytes"],
        "semantic_shard_bytes": index["dataset_bytes"],
        "split_counts": index["splits"],
        "integrity_status": "PASS" if shard_report["valid"] and factory_inventory["valid"] and training_assets["valid"] else "FAIL",
        "split_status": "PASS" if index["whole_score_split_isolation"] and index["semantic_source_split_isolation"] else "FAIL",
        "future_test_locked": bool(
            index["future_test_reserved"]
            and index.get("future_test_lock") == "RESERVED_NOT_TRAINER_ACCESSIBLE"
        ),
    }


def review_full(
    factory_dir: Path,
    campaign_dir: Path,
    confirmation=None,
    quiescence_seconds=DEFAULT_QUIESCENCE_SECONDS,
    process_lines=None,
    open_file_pids=None,
):
    """Show the immutable review summary and optionally record explicit approval."""
    factory_dir = Path(factory_dir).resolve()
    campaign_dir = Path(campaign_dir).resolve()
    liveness = detect_factory_liveness(
        factory_dir, quiescence_seconds, process_lines=process_lines, open_file_pids=open_file_pids,
    )
    if not liveness["safe_to_open_database"]:
        return {
            "schema_version": 1,
            "review_state": "BLOCKED",
            "reason": liveness["reason"],
            "database_opened": False,
            "liveness": liveness,
            "training_started": False,
        }
    metadata = read_factory_metadata(factory_dir, liveness)
    index_path = campaign_dir / "full-semantic-index.json"
    if not index_path.is_file():
        if confirmation is not None:
            raise RuntimeError("Review cannot be confirmed without a prepared full semantic index")
        return {
            "schema_version": 1,
            "review_state": "BLOCKED",
            "eligible_for_confirmation": False,
            "reason": "No prepared full semantic index; resolve prepare-full blockers first",
            "readiness_report": str(campaign_dir / "full-readiness-report.json"),
            "database_opened": True,
            "recorded": False,
            "training_started": False,
        }
    index = load_dataset_index(index_path, expected_root=factory_dir)
    shard_report = verify_index_shards(index, require_hashes=True)
    factory_inventory = compare_factory_shard_inventory(factory_dir, metadata, index)
    training_assets = inspect_training_assets(factory_dir, index)
    summary = _review_summary(metadata, index, shard_report, factory_inventory, training_assets)
    eligible = bool(
        metadata["full_build_state"] == "COMPLETE"
        and metadata["semantic_build_state"] == "COMPLETE"
        and metadata["dataset_validation_pass"]
        and shard_report["valid"]
        and factory_inventory["valid"]
        and training_assets["valid"]
        and summary["split_status"] == "PASS"
        and summary["future_test_locked"]
    )
    report = {
        "schema_version": 1,
        "review_state": "AWAITING_EXPLICIT_CONFIRMATION" if eligible else "BLOCKED",
        "eligible_for_confirmation": eligible,
        "required_confirmation": REVIEW_CONFIRMATION,
        "summary": summary,
        "dataset_digest": index["dataset_digest"],
        "manifest_digest": index["manifest_digest"],
        "factory_shard_inventory": factory_inventory,
        "training_asset_inventory": training_assets,
        "database_opened": True,
        "recorded": False,
        "training_started": False,
    }
    if confirmation is not None and confirmation != REVIEW_CONFIRMATION:
        raise PermissionError(f"Exact confirmation {REVIEW_CONFIRMATION} is required")
    if confirmation == REVIEW_CONFIRMATION:
        if not eligible:
            raise RuntimeError("Human review cannot be recorded while readiness checks fail")
        record = {
            "schema_version": 1,
            "status": REVIEW_CONFIRMATION,
            "factory_directory": str(factory_dir),
            "dataset_digest": index["dataset_digest"],
            "manifest_digest": index["manifest_digest"],
            "review_summary_digest": _json_digest(summary),
            "confirmed_at": _utc_now(),
            "training_started": False,
        }
        _atomic_json(campaign_dir / "human-review.json", record)
        report.update(review_state=REVIEW_CONFIRMATION, recorded=True, review_record=record)
    return report


def validate_review_record(review_path: Path, factory_dir: Path, index):
    try:
        record = json.loads(Path(review_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"valid": False, "reason": "human review record missing or unreadable"}
    expected_root = str(Path(factory_dir).resolve())
    valid = bool(
        record.get("status") == REVIEW_CONFIRMATION
        and record.get("factory_directory") == expected_root
        and record.get("dataset_digest") == index.get("dataset_digest")
        and record.get("manifest_digest") == index.get("manifest_digest")
    )
    return {
        "valid": valid,
        "reason": None if valid else "human review record does not match the frozen dataset",
        "record": record,
    }
