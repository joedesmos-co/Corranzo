#!/usr/bin/env python3
"""P10 — zero-parameter sanity baseline for the pilot dataset.

Non-learning coherence checks before any model work:
  1. split integrity (disjoint, counts, manifest membership)
  2. manifest completeness (hashes present for PASS; quarantine reasons present)
  3. exact join totals (id join, state join) across PASS
  4. source-identity pass rate across PASS
  5. geometry validity across PASS
  6. object-table sample: hash match vs manifest + schema + note counts
  7. page geometry plausibility (staff groups, staff-gap range)
  8. raster sample: PNG dimensions and non-blankness
  9. manifest/selection/determinism hashes exist and are consistent

Usage:
  python3 p10_baseline.py
"""

from __future__ import annotations

import gzip
import hashlib
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PILOT = HERE.parent
RENDER = PILOT / "data" / "render"
OBJECTS = PILOT / "data" / "objects"
MANIFESTS = PILOT / "manifests"


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    man_path = MANIFESTS / "dataset_pilot-v0.manifest.json"
    man = json.loads(man_path.read_text())
    splits = json.loads((MANIFESTS / "splits.json").read_text())
    determinism = json.loads((MANIFESTS / "determinism.json").read_text())
    records = man["scores"]
    passed = [r for r in records if r["status"] == "PASS"]
    quarantined = [r for r in records if r["status"] != "PASS"]

    checks = {}

    # 1 split integrity
    train, dev, test = set(splits["train"]), set(splits["dev"]), set(splits["test"])
    pass_ids = {r["source_id"] for r in passed}
    checks["split_disjoint"] = not (train & dev or train & test or dev & test)
    checks["split_covers_pass"] = (train | dev | test) == pass_ids
    checks["split_counts"] = splits["counts"]

    # 2 manifest completeness
    missing_hash = [r["source_id"] for r in passed
                    if not (r["source_sha256"] and r["render"]["mei_sha256"]
                            and r["render"]["svg_sha256"] and r["render"]["objects_sha256"])]
    checks["pass_with_missing_hashes"] = len(missing_hash)
    checks["quarantined_with_reason"] = all(r["quarantine"] for r in quarantined)

    # 3 join totals
    checks["id_join_missing_total"] = sum(
        sum((r["joins"].get("id_join_missing_nonstate") or {}).values()) for r in passed)
    checks["state_rendered_total"] = sum(r["joins"].get("state_rendered") or 0 for r in passed)
    checks["state_resolved_total"] = sum(r["joins"].get("state_resolved") or 0 for r in passed)
    unresolved = 0
    for meta in RENDER.glob("*/meta.json"):
        m = json.loads(meta.read_text())
        if m.get("status") == "PASS":
            unresolved += m.get("state_unresolved", 0)
    checks["state_unresolved_total"] = unresolved

    # 4 identity
    checks["identity_ok"] = sum(1 for r in passed if r["joins"].get("identity_ok"))
    checks["identity_fail"] = len(passed) - checks["identity_ok"]

    # 5 geometry
    checks["geometry_bad_total"] = sum(r["joins"].get("geometry_bad") or 0 for r in passed)

    # 6 object-table sample
    rng = random.Random(20261007)
    sample = rng.sample(sorted(passed, key=lambda r: r["source_id"]), min(30, len(passed)))
    obj_ok = 0
    obj_errors = []
    for r in sample:
        sid = r["source_id"]
        p = OBJECTS / f"{sid}.objects.json.gz"
        if not p.is_file():
            obj_errors.append(f"{sid}: missing")
            continue
        h = hashlib.sha256(gzip.open(p, "rb").read()).hexdigest()
        if h != r["render"]["objects_sha256"]:
            obj_errors.append(f"{sid}: hash mismatch")
            continue
        with gzip.open(p, "rt") as f:
            objs = json.load(f)
        notes = [o for o in objs if o["tag"] == "note"]
        if len(notes) != r["counts"]["notes"]:
            obj_errors.append(f"{sid}: note count {len(notes)} != {r['counts']['notes']}")
            continue
        if not all("mei_id" in o and "measure" in o for o in objs[:5]):
            obj_errors.append(f"{sid}: schema")
            continue
        obj_ok += 1
    checks["object_sample_ok"] = obj_ok
    checks["object_sample_errors"] = obj_errors[:5]

    # 7 page geometry
    bad_pages = 0
    gaps = []
    for r in passed:
        for pg in (r.get("page_geometry") or []):
            if not pg.get("staff_groups"):
                bad_pages += 1
            if pg.get("median_staff_gap_px"):
                gaps.append(pg["median_staff_gap_px"])
    checks["pages_without_staff_groups"] = bad_pages
    checks["staff_gap_px_min"] = min(gaps) if gaps else None
    checks["staff_gap_px_max"] = max(gaps) if gaps else None

    # 8 raster sample
    pngs = sorted(RENDER.glob("*/page-01.png"))
    raster_ok = 0
    raster_checked = 0
    if pngs:
        try:
            import cv2
            for p in rng.sample(pngs, min(20, len(pngs))):
                img = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
                raster_checked += 1
                if img is not None and img.shape[1] == 2480 and (img < 200).mean() > 0.0005:
                    raster_ok += 1
        except Exception as e:
            checks["raster_error"] = str(e)[:120]
    checks["raster_checked"] = raster_checked
    checks["raster_ok"] = raster_ok

    # 9 hashes
    checks["selection_sha256_present"] = (MANIFESTS / "selection.sha256").is_file()
    checks["dataset_manifest_sha256_present"] = man_path.with_suffix(".sha256").is_file()
    checks["determinism_all_ok"] = determinism.get("all_ok")
    checks["determinism_sample"] = determinism.get("sample")

    verdict = (
        checks["split_disjoint"] and checks["split_covers_pass"]
        and checks["pass_with_missing_hashes"] == 0
        and checks["quarantined_with_reason"]
        and checks["id_join_missing_total"] == 0
        and checks["state_resolved_total"] + checks["state_unresolved_total"] == checks["state_rendered_total"]
        and checks["identity_fail"] == 0
        and checks["geometry_bad_total"] == 0
        and checks["object_sample_ok"] == len(sample)
        and checks["pages_without_staff_groups"] == 0
        and checks["raster_ok"] == checks["raster_checked"]
        and checks["determinism_all_ok"] is True
    )
    out = {
        "schema": "corranzo.piano.pilot.baseline/1",
        "checks": checks,
        "verdict": "PASS" if verdict else "FAIL",
    }
    (MANIFESTS / "baseline.json").write_text(json.dumps(out, indent=1, sort_keys=True))
    print(json.dumps(out, indent=1)[:2000])
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
