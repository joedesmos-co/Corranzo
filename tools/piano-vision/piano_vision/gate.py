"""Fail-closed, read-only full-dataset launch gate. Never starts training."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from .config import config_digest, load_config
from .data import load_dataset_index, verify_index_shards
from .readiness import (
    DEFAULT_QUIESCENCE_SECONDS,
    compare_factory_shard_inventory,
    detect_factory_liveness,
    inspect_training_assets,
    read_factory_metadata,
    validate_review_record,
)


def evaluate_launch_gate(
    factory_dir: Path,
    config_path: Path,
    index_path: Path,
    disk_floor_gib=20.0,
    human_review=False,
    review_path: Path | None = None,
    quiescence_seconds=DEFAULT_QUIESCENCE_SECONDS,
    process_lines=None,
    open_file_pids=None,
):
    factory_dir = Path(factory_dir).resolve()
    config_path = Path(config_path).resolve()
    index_path = Path(index_path).resolve()
    review_path = Path(review_path or index_path.parent / "human-review.json").resolve()
    checks = {}
    details = {}
    liveness = detect_factory_liveness(
        factory_dir,
        quiescence_seconds,
        process_lines=process_lines,
        open_file_pids=open_file_pids,
    )
    metadata = None
    database_opened = False
    if not liveness["safe_to_open_database"]:
        checks.update({
            "factory_build_complete": False,
            "dataset_validation_pass": False,
            "semantic_build_complete": False,
        })
        factory_state = "RUNNING" if liveness["active"] else "MISSING"
    else:
        try:
            metadata = read_factory_metadata(factory_dir, liveness)
            database_opened = True
            checks["factory_build_complete"] = metadata["full_build_state"] == "COMPLETE"
            checks["dataset_validation_pass"] = metadata["dataset_validation_pass"]
            checks["semantic_build_complete"] = metadata["semantic_build_state"] == "COMPLETE"
            factory_state = metadata["full_build_state"]
        except Exception as error:
            checks.update({
                "factory_build_complete": False,
                "dataset_validation_pass": False,
                "semantic_build_complete": False,
            })
            details["factory_metadata_error"] = str(error)
            factory_state = "UNREADABLE"

    try:
        config = load_config(config_path)
        expected_digest = config.get("config_digest")
        actual_digest = config_digest({key: value for key, value in config.items() if key != "config_digest"})
        checks["model_config_frozen"] = bool(config.get("frozen") and expected_digest == actual_digest)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        checks["model_config_frozen"] = False
        details["config_error"] = str(error)

    index = None
    checks["full_semantic_index_exists"] = index_path.is_file()
    try:
        index = load_dataset_index(index_path, expected_root=factory_dir)
        shard_report = verify_index_shards(index, require_hashes=True)
        checks["index_hashes_pass"] = bool(shard_report["valid"] and index.get("hashes_verified"))
        checks["manifest_digest_frozen"] = bool(
            index.get("manifest_frozen") and index.get("manifest_digest") and index.get("dataset_digest")
        )
        checks["whole_score_split_isolation"] = bool(index.get("whole_score_split_isolation"))
        checks["semantic_source_isolation"] = bool(index.get("semantic_source_split_isolation"))
        checks["future_test_locked"] = bool(
            index.get("future_test_reserved")
            and index.get("future_test_lock") == "RESERVED_NOT_TRAINER_ACCESSIBLE"
        )
        checks["semantic_shard_validation"] = bool(
            shard_report["valid"] and index.get("splits", {}).get("train", {}).get("examples", 0)
        )
        details["shard_verification"] = shard_report
        if metadata is not None:
            inventory = compare_factory_shard_inventory(factory_dir, metadata, index)
            checks["factory_shard_inventory_pass"] = inventory["valid"]
            details["factory_shard_inventory"] = inventory
            training_assets = inspect_training_assets(factory_dir, index)
            checks["training_assets_available"] = training_assets["valid"]
            details["training_asset_inventory"] = training_assets
        else:
            checks["factory_shard_inventory_pass"] = False
            checks["training_assets_available"] = False
        review = validate_review_record(review_path, factory_dir, index)
        checks["human_review_complete"] = review["valid"]
        details["human_review"] = review
    except Exception as error:
        for name in (
            "index_hashes_pass",
            "manifest_digest_frozen",
            "whole_score_split_isolation",
            "semantic_source_isolation",
            "future_test_locked",
            "semantic_shard_validation",
            "factory_shard_inventory_pass",
            "training_assets_available",
            "human_review_complete",
        ):
            checks[name] = False
        details["index_error"] = str(error)

    free = shutil.disk_usage(factory_dir if factory_dir.exists() else factory_dir.parent).free
    checks["disk_safety"] = free >= int(float(disk_floor_gib) * 1024**3)
    blockers = [name for name, passed in checks.items() if not passed]
    if not checks["factory_build_complete"] and liveness["active"]:
        display = "BLOCKED — DATASET BUILD IN PROGRESS"
    elif blockers:
        display = "BLOCKED — " + blockers[0].replace("_", " ").upper()
    else:
        display = "READY"
    return {
        "schema_version": 2,
        "full_training": display,
        "ready": not blockers,
        "factory_state": factory_state,
        "factory_directory": str(factory_dir),
        "checks": checks,
        "blockers": blockers,
        "details": details,
        "liveness": liveness,
        "disk_free_bytes": free,
        "disk_floor_bytes": int(float(disk_floor_gib) * 1024**3),
        "database_opened": database_opened,
        "review_path": str(review_path),
        "training_started": False,
    }
