#!/usr/bin/env python3
"""Persistent, path-only setup for the four local PDMX factory inputs."""

from __future__ import annotations

import csv
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path


INPUT_NAMES = {
    "metadata": "PDMX.csv",
    "pdfArchive": "pdf.tar.gz",
    "mxlArchive": "mxl.tar.gz",
    "subsetPaths": "subset_paths.tar.gz",
}


def sha256_prefix(path, byte_limit=8 * 1024 * 1024):
    digest = hashlib.sha256()
    read = 0
    with open(path, "rb") as stream:
        while read < byte_limit:
            chunk = stream.read(min(1024 * 1024, byte_limit - read))
            if not chunk:
                break
            digest.update(chunk)
            read += len(chunk)
    return {"algorithm": "sha256", "bytesHashed": read, "prefixDigest": digest.hexdigest()}


def probe_archive(path, member_limit=4):
    members = []
    with tarfile.open(path, mode="r|gz") as archive:
        for member in archive:
            if member.isfile():
                members.append({"name": member.name, "bytes": member.size})
                if len(members) >= member_limit:
                    break
    return {"valid": bool(members), "sampledMembers": members, "streamingProbe": True}


class InputSetup:
    def __init__(self, work_dir, model_contract=None, disk_floor_gib=20.0):
        self.work_dir = Path(work_dir).resolve()
        self.work_dir.mkdir(parents=True, exist_ok=True)
        self.config_path = self.work_dir / "input-paths.json"
        self.model_contract = Path(model_contract).resolve() if model_contract else None
        self.disk_floor_bytes = int(float(disk_floor_gib) * 1024**3)

    def load(self):
        if not self.config_path.is_file():
            return {"schemaVersion": 1, "paths": {key: "" for key in INPUT_NAMES}}
        return json.loads(self.config_path.read_text())

    def save(self, paths):
        normalized = {}
        for key in INPUT_NAMES:
            value = str(paths.get(key) or "").strip()
            normalized[key] = str(Path(value).expanduser().resolve()) if value else ""
        payload = {"schemaVersion": 1, "mode": "LOCAL_PATH_REFERENCES_ONLY", "copiesCreated": 0, "archivesUnpacked": False, "paths": normalized}
        partial = self.config_path.with_suffix(".json.partial")
        partial.write_text(json.dumps(payload, indent=2) + "\n")
        os.replace(partial, self.config_path)
        return payload

    def model_status(self):
        if not self.model_contract or not self.model_contract.is_file():
            return {"valid": False, "state": "MODEL_CONTRACT_PENDING", "path": str(self.model_contract) if self.model_contract else None}
        try:
            contract = json.loads(self.model_contract.read_text())
            valid = bool(contract.get("scaleAuthorized") and contract.get("configurationDigest") and contract.get("runtimeTruthInputs") == [])
            return {"valid": valid, "state": "VALIDATED" if valid else "MODEL_CONTRACT_PENDING", "path": str(self.model_contract), "digest": contract.get("configurationDigest")}
        except Exception as error:
            return {"valid": False, "state": "MODEL_CONTRACT_INVALID", "path": str(self.model_contract), "error": str(error)}

    def validate(self, include_fingerprint=True):
        config = self.load()
        results = {}
        metadata_rows = None
        for key, expected_name in INPUT_NAMES.items():
            raw = config.get("paths", {}).get(key, "")
            path = Path(raw) if raw else None
            row = {"expected": expected_name, "path": raw, "filename": path.name if path else None}
            if not path or not path.is_file():
                row.update(exists=False, readable=False, valid=False, error="FILE_NOT_FOUND")
                results[key] = row
                continue
            row.update(exists=True, readable=os.access(path, os.R_OK), bytes=path.stat().st_size)
            try:
                if key == "metadata":
                    with open(path, newline="", encoding="utf-8") as stream:
                        reader = csv.reader(stream)
                        header = next(reader)
                        required = {"path", "mxl", "pdf"}
                        missing = sorted(required - set(header))
                        metadata_rows = sum(1 for _ in reader)
                    row.update(valid=not missing, columns=len(header), rows=metadata_rows, missingColumns=missing)
                else:
                    row.update(probe_archive(path))
                if include_fingerprint:
                    row["fingerprint"] = sha256_prefix(path)
            except Exception as error:
                row.update(valid=False, error=str(error))
            results[key] = row
        disk = shutil.disk_usage(self.work_dir)
        model = self.model_status()
        inputs_valid = all(row.get("valid") and row.get("readable") for row in results.values())
        disk_safe = disk.free >= self.disk_floor_bytes
        return {
            "schemaVersion": 1,
            "state": "READY" if inputs_valid else "INPUTS_INVALID",
            "summary": "PDMX INPUTS READY" if inputs_valid else "PDMX INPUTS NEED ATTENTION",
            "metadataRows": metadata_rows,
            "inputs": results,
            "modelContract": model,
            "disk": {"freeBytes": disk.free, "requiredFloorBytes": self.disk_floor_bytes, "safe": disk_safe},
            "buildAuthorized": bool(inputs_valid and model["valid"] and disk_safe),
            "buildDisabledReasons": [
                reason for condition, reason in (
                    (not inputs_valid, "INPUT_VALIDATION_FAILED"),
                    (not model["valid"], "MODEL_CONTRACT_PENDING"),
                    (not disk_safe, "DISK_SAFETY_FAILED"),
                ) if condition
            ],
            "copiesCreated": 0,
            "archivesUnpacked": False,
        }


def native_choose_file(title):
    """Use the host-native chooser; return None when unavailable/cancelled."""
    if sys.platform != "darwin":
        return None
    script = f'POSIX path of (choose file with prompt "{title.replace(chr(34), chr(39))}")'
    try:
        result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=120, check=True)
        return result.stdout.strip() or None
    except Exception:
        return None
