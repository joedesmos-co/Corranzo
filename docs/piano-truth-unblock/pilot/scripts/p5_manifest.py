#!/usr/bin/env python3
"""P5 — content-addressed dataset manifest for the pilot.

Reads every render meta.json, merges split identity if manifests/splits.json
exists, and writes manifests/dataset_v0.manifest.json + sha256. The manifest is
written once per dataset version (append-only policy: new versions get new
files; existing version files are never edited).

Usage:
  python3 p5_manifest.py
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PILOT = HERE.parent
RENDER = PILOT / "data" / "render"


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    splits = {}
    split_file = PILOT / "manifests" / "splits.json"
    if split_file.is_file():
        s = json.loads(split_file.read_text())
        for name in ("train", "dev", "test"):
            for sid in s.get(name, []):
                splits[sid] = name

    records = []
    for meta in sorted(RENDER.glob("*/meta.json")):
        try:
            m = json.loads(meta.read_text())
        except Exception:
            continue
        sid = m.get("source_id")
        rec = {
            "source_id": sid,
            "title": m.get("title"),
            "composer": m.get("composer"),
            "license": m.get("license"),
            "status": m.get("status"),
            "split": splits.get(sid),
            "source_sha256": m.get("source_sha256"),
            "source_bytes": m.get("source_bytes"),
            "render": {
                "verovio_version": m.get("verovio_version"),
                "xml_id_seed": m.get("xml_id_seed"),
                "pages": m.get("pages"),
                "mei_sha256": m.get("mei_sha256"),
                "svg_sha256": m.get("svg_sha256"),
                "objects_sha256": m.get("objects_sha256"),
                "objects_bytes": m.get("objects_bytes"),
            },
            "counts": {
                "notes": m.get("note_count"),
                "objects": m.get("object_count"),
                "mei": m.get("mei_counts"),
            },
            "joins": {
                "id_join_ok_nonstate": m.get("id_join_ok_nonstate"),
                "id_join_missing_nonstate": m.get("id_join_missing_nonstate"),
                "state_rendered": m.get("state_rendered"),
                "state_resolved": m.get("state_resolved"),
                "state_mismatch": m.get("state_mismatch"),
                "identity_ok": (m.get("identity") or {}).get("ok"),
                "geometry_bad": m.get("geometry_bad"),
            },
            "coverage": {
                "dropped_features": m.get("dropped_features"),
                "mei_counts": m.get("mei_counts"),
            },
            "page_geometry": m.get("page_geometry"),
            "quarantine": None if m.get("status") == "PASS" else m.get("status"),
        }
        records.append(rec)

    dataset_version = "pilot-v0"
    manifest = {
        "schema": "corranzo.piano.pilot.dataset/1",
        "dataset_version": dataset_version,
        "selection_manifest_sha256": (PILOT / "manifests" / "selection.sha256").read_text().split()[0]
        if (PILOT / "manifests" / "selection.sha256").is_file() else None,
        "mxl_fetch_manifest_sha256": (PILOT / "manifests" / "mxl_fetch.sha256").read_text().split()[0]
        if (PILOT / "manifests" / "mxl_fetch.sha256").is_file() else None,
        "renderer": {"name": "verovio", "version_pin": "6.3.0", "xml_id_seed": 20261007},
        "pipeline_sha256": sha256_file(HERE / "pv_pipeline.py"),
        "runner_sha256": sha256_file(HERE / "p2_render.py"),
        "scores": records,
    }
    out = PILOT / "manifests" / f"dataset_{dataset_version}.manifest.json"
    text = json.dumps(manifest, indent=1, sort_keys=True)
    out.write_text(text)
    (out.with_suffix(".sha256")).write_text(
        hashlib.sha256(text.encode()).hexdigest() + "  " + out.name + "\n")
    n_pass = sum(1 for r in records if r["status"] == "PASS")
    print(f"[p5] {len(records)} records ({n_pass} PASS) -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
