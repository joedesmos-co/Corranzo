#!/usr/bin/env python3
"""Selective-archive integration for the validated source-coordinate producer."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from factory import utc_now


def produce_source_coordinates(factory, repo_root, max_scores=10, max_pages=999):
    """Populate small source/target bundles for pending accepted metadata rows.

    PDF/MXL members are streamed into a bounded temporary batch.  Only the
    resulting compact coordinate/target bundles persist; raw members are
    removed.  The generic factory remains responsible for pair verification
    and canonicalization after this producer step.
    """
    repo_root = Path(repo_root).resolve()
    rows = factory.db.execute(
        """SELECT * FROM scores WHERE filter_state='AMBIGUOUS_INSTRUMENTATION'
           AND job_state='PENDING' ORDER BY csv_row LIMIT ?""", (int(max_scores),)
    ).fetchall()
    if not rows:
        return {"status": "NO_PENDING_CANDIDATES", "processed": 0, "accepted": 0}
    factory.check_disk()
    persistent = factory.work_dir / "source-producer"
    persistent.mkdir(parents=True, exist_ok=True)
    accepted = review = failed = 0
    with tempfile.TemporaryDirectory(prefix="corranzo-source-producer-", dir=factory.cache_dir) as temp:
        temp = Path(temp)
        pdfs = factory._extract_batch(factory.pdf_archive, [row["pdf_member"] for row in rows], temp / "pdf")
        mxls = factory._extract_batch(factory.mxl_archive, [row["mxl_member"] for row in rows], temp / "mxl")
        for row in rows:
            score_id = row["score_id"]
            plan_row = factory.db.execute("SELECT ordinal FROM build_plan WHERE score_id=?", (score_id,)).fetchone()
            inventory = factory.db.execute("SELECT * FROM preflight_inventory WHERE score_id=?", (score_id,)).fetchone()
            started_at = utc_now()
            factory.set_state("current_progress", json.dumps({
                "scoreId": score_id,
                "scorePosition": plan_row["ordinal"] if plan_row else None,
                "name": Path(row["mxl_member"]).name,
                "stage": "SEMANTIC_SOURCE_COORDINATES",
                "pageCurrent": 0,
                "pageTotal": inventory["pages"] if inventory else None,
                "measureCurrent": 0,
                "measureTotal": inventory["measures"] if inventory else None,
                "noteCurrent": 0,
                "noteTotal": inventory["notes"] if inventory else None,
                "objects": 0,
                "examples": 0,
                "startedAt": started_at,
                "warnings": [],
            }, sort_keys=True))
            score_root = persistent / score_id
            selection = score_root / "selection.json"
            score_root.mkdir(parents=True, exist_ok=True)
            selection.write_text(json.dumps({"selected": [{
                "scoreId": score_id,
                "pdfPath": str(pdfs[row["pdf_member"]]),
                "mxlPath": str(mxls[row["mxl_member"]]),
            }]}, indent=2) + "\n")
            try:
                subprocess.run([
                    "node", str(repo_root / "tools/pdmx-factory/source-coordinate-producer.mjs"),
                    "--selection", str(selection), "--output", str(score_root),
                    "--score-limit", "1", "--max-pages", str(int(max_pages)),
                    "--structured-source", "true", "--stop-cross", "999999", "--stop-shared", "999999",
                ], cwd=repo_root, check=True, capture_output=True, text=True, timeout=1800)
                aligned = score_root / "aligned" / score_id
                report = json.loads((aligned / "alignment-report.json").read_text())
                if report.get("state") == "ACCEPTED_HIGH_CONFIDENCE":
                    metadata = json.loads(row["metadata_json"])
                    metadata["source_bundle"] = str(aligned / "source-input.jsonl.gz")
                    metadata["target_bundle"] = str(aligned / "target-supervision.jsonl.gz")
                    metadata["sourceProducerReport"] = str(aligned / "alignment-report.json")
                    factory.db.execute("UPDATE scores SET metadata_json=? WHERE score_id=?", (json.dumps(metadata, sort_keys=True), score_id))
                    accepted += 1
                    factory.set_state("current_progress", json.dumps({
                        "scoreId": score_id,
                        "scorePosition": plan_row["ordinal"] if plan_row else None,
                        "name": Path(row["mxl_member"]).name,
                        "stage": "SEMANTIC_GOLD_READY",
                        "pageCurrent": inventory["pages"] if inventory else 0,
                        "pageTotal": inventory["pages"] if inventory else None,
                        "measureCurrent": inventory["measures"] if inventory else 0,
                        "measureTotal": inventory["measures"] if inventory else None,
                        "noteCurrent": inventory["notes"] if inventory else 0,
                        "noteTotal": inventory["notes"] if inventory else None,
                        "objects": report.get("objects", 0),
                        "examples": report.get("scopes", 0),
                        "startedAt": started_at,
                        "warnings": [],
                    }, sort_keys=True))
                else:
                    review += 1
                    factory.log("WARN", "SOURCE_PRODUCER", report.get("state", "REVIEW"), score_id)
            except Exception as error:
                failed += 1
                factory.log("ERROR", "SOURCE_PRODUCER", str(error), score_id)
    factory.db.commit()
    return {
        "status": "COMPLETE", "processed": len(rows), "accepted": accepted,
        "review": review, "failed": failed, "selectiveExtraction": True,
        "rawCacheReleased": True, "structuredSource": True,
    }
