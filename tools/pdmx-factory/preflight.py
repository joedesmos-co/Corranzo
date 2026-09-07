#!/usr/bin/env python3
"""Persisted, archive-streaming corpus inventory for the frozen build plan."""

from __future__ import annotations

import io
import json
import re
import tarfile
import time
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from factory import normalize_member, utc_now
from progress import aggregate_denominator_state

try:
    from pypdf import PdfReader
except ImportError:  # Optional: regex fallback is explicitly ESTIMATED.
    PdfReader = None


FINAL_STATES = {"EXACT", "ESTIMATED", "UNAVAILABLE"}


def _musicxml_root(payload):
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
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


def mxl_counts(payload):
    root = _musicxml_root(payload)
    local = lambda element: element.tag.rsplit("}", 1)[-1]
    return {
        "measures": sum(1 for element in root.iter() if local(element) == "measure"),
        "notes": sum(1 for element in root.iter() if local(element) == "note"),
    }


def pdf_pages(payload):
    if PdfReader is not None:
        try:
            return len(PdfReader(io.BytesIO(payload), strict=False).pages), "EXACT", "pypdf-page-tree"
        except Exception:
            pass
    count = len(re.findall(rb"/Type\s*/Page(?!s)", payload))
    if count:
        return count, "ESTIMATED", "pdf-page-object-regex"
    raise ValueError("PDF page count unavailable without rendering")


def _stream_inventory(factory, archive_path, member_column, handler, update):
    targets = {}
    for row in factory.db.execute(
        f"SELECT p.score_id,s.{member_column} AS member FROM build_plan p JOIN scores s ON s.score_id=p.score_id"
    ):
        if row["member"]:
            targets.setdefault(normalize_member(row["member"]), []).append(row["score_id"])
    found = set()
    with tarfile.open(archive_path, mode="r|gz") as archive:
        for member in archive:
            if not member.isfile():
                continue
            name = normalize_member(member.name)
            if name not in targets:
                continue
            score_ids = targets[name]
            found.update(score_ids)
            if member.size > 256 * 1024 * 1024:
                for score_id in score_ids:
                    update(score_id, None, "UNAVAILABLE", "MEMBER_EXCEEDS_256_MIB_PREFLIGHT_BOUND")
                continue
            try:
                stream = archive.extractfile(member)
                if stream is None:
                    raise ValueError("archive member unreadable")
                value = handler(stream.read())
                for score_id in score_ids:
                    update(score_id, value, None, None)
            except Exception as error:
                for score_id in score_ids:
                    update(score_id, None, "UNAVAILABLE", str(error))
            factory.set_state("preflight_processed", str(len(found)))
    for name, score_ids in targets.items():
        for score_id in score_ids:
            if score_id not in found:
                update(score_id, None, "UNAVAILABLE", f"ARCHIVE_MEMBER_NOT_FOUND:{name}")


def run_preflight(factory):
    plan = factory.freeze_build_plan()
    started = time.monotonic()
    factory.set_state("preflight_state", "RUNNING")
    factory.set_state("preflight_processed", "0")
    factory.log("INFO", "PREFLIGHT", f"Inventory started for {plan['plannedScores']} frozen scores")
    for row in factory.db.execute("SELECT score_id FROM build_plan ORDER BY ordinal"):
        factory.db.execute(
            """INSERT OR IGNORE INTO preflight_inventory(
                 score_id,pages,pages_state,pages_method,measures,notes,mxl_state,error,updated_at
               ) VALUES(?,NULL,'CALCULATING',NULL,NULL,NULL,'CALCULATING',NULL,?)""",
            (row["score_id"], utc_now()),
        )
    factory.db.commit()

    def update_mxl(score_id, value, forced_state, error):
        if value is not None:
            factory.db.execute(
                "UPDATE preflight_inventory SET measures=?,notes=?,mxl_state='EXACT',error=NULL,updated_at=? WHERE score_id=?",
                (value["measures"], value["notes"], utc_now(), score_id),
            )
        else:
            factory.db.execute(
                "UPDATE preflight_inventory SET mxl_state=?,error=?,updated_at=? WHERE score_id=?",
                (forced_state, error, utc_now(), score_id),
            )
        factory.db.commit()

    def update_pdf(score_id, value, forced_state, error):
        if value is not None:
            pages, state, method = value
            factory.db.execute(
                "UPDATE preflight_inventory SET pages=?,pages_state=?,pages_method=?,updated_at=? WHERE score_id=?",
                (pages, state, method, utc_now(), score_id),
            )
        else:
            factory.db.execute(
                "UPDATE preflight_inventory SET pages_state=?,pages_method=?,updated_at=? WHERE score_id=?",
                (forced_state, error, utc_now(), score_id),
            )
        factory.db.commit()

    try:
        _stream_inventory(factory, factory.mxl_archive, "mxl_member", mxl_counts, update_mxl)
        _stream_inventory(factory, factory.pdf_archive, "pdf_member", pdf_pages, update_pdf)
        rows = factory.db.execute("SELECT * FROM preflight_inventory ORDER BY score_id").fetchall()
        complete = len(rows) == plan["plannedScores"] and all(row["pages_state"] in FINAL_STATES and row["mxl_state"] in FINAL_STATES for row in rows)
        page_state = aggregate_denominator_state((row["pages_state"] for row in rows), complete)
        mxl_state = aggregate_denominator_state((row["mxl_state"] for row in rows), complete)
        report = {
            "schemaVersion": 1,
            "state": "COMPLETE" if complete else "FAILED",
            "planFrozen": True,
            "plannedScores": plan["plannedScores"],
            "inventoriedScores": len(rows),
            "pages": {"knownTotal": sum(row["pages"] or 0 for row in rows), "denominatorState": page_state},
            "measures": {"knownTotal": sum(row["measures"] or 0 for row in rows), "denominatorState": mxl_state},
            "musicXmlNotes": {"knownTotal": sum(row["notes"] or 0 for row in rows), "denominatorState": mxl_state,
                              "definition": "MusicXML note elements, including rests and chord members"},
            "unavailablePages": sum(row["pages_state"] == "UNAVAILABLE" for row in rows),
            "unavailableMxl": sum(row["mxl_state"] == "UNAVAILABLE" for row in rows),
            "renderedPages": 0,
            "archivesUnpacked": False,
            "elapsedSeconds": time.monotonic() - started,
        }
        factory.set_state("preflight_report", json.dumps(report, sort_keys=True))
        factory.set_state("preflight_state", report["state"])
        factory.set_state("preflight_processed", str(len(rows)))
        factory.log("INFO" if complete else "ERROR", "PREFLIGHT", f"Inventory {report['state']}: {len(rows)}/{plan['plannedScores']} scores")
        return report
    except Exception as error:
        factory.set_state("preflight_state", "FAILED")
        factory.log("ERROR", "PREFLIGHT", str(error))
        raise
