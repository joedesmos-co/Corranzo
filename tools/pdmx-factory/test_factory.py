#!/usr/bin/env python3
"""End-to-end tests for archive-native factory safety and persistence."""

from __future__ import annotations

import csv
import io
import json
import sys
import tarfile
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dashboard import make_handler
from factory import Factory
from preflight import run_preflight


def pdf_bytes():
    return b"%PDF-1.4\n1 0 obj<</Type /Page>>endobj\ntrailer<<>>\n%%EOF\n"


def mxl_bytes(name="Piano", staves=2, valid=True):
    if not valid:
        return b"not-a-zip"
    container = b'''<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>'''
    score = f'''<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>{name}</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><staves>{staves}</staves></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><staff>1</staff></note><note><rest/><duration>1</duration><staff>2</staff></note></measure></part></score-partwise>'''.encode()
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("META-INF/container.xml", container)
        archive.writestr("score.musicxml", score)
    return payload.getvalue()


def write_tar(path, members):
    with tarfile.open(path, "w:gz") as archive:
        for name, payload in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            archive.addfile(info, io.BytesIO(payload))


class FactoryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pdmx-factory-test-")
        self.root = Path(self.temp.name)
        self.csv_path = self.root / "PDMX.csv"
        self.pdf_archive = self.root / "pdf.tar.gz"
        self.mxl_archive = self.root / "mxl.tar.gz"
        self.work = self.root / "work"
        self.rows = []
        pdf_members = {}
        self.mxl_members = {}
        fields = ["path", "mxl", "pdf", "license", "n_tracks", "subset:all_valid",
                  "subset:no_license_conflict", "subset:deduplicated", "source_bundle"]
        for index in range(13):
            score_id = f"score{index:02d}"
            pdf_member = f"pdf/0/0/{score_id}.pdf"
            mxl_member = f"mxl/0/0/{score_id}.mxl"
            source_bundle = ""
            if index < 10 or index == 12:
                source_path = self.root / f"{score_id}-source.jsonl"
                source_record = {
                    "metadata": {"exampleId": f"{score_id}:scope-1", "scopeId": f"{score_id}:scope-1",
                                 "groupId": score_id, "page": 1},
                    "modelInput": {
                        "geometry": {"coordinateSpace": "pdf-source-normalized", "scopeBounds": {"x0": .1, "x1": .9, "y0": .1, "y1": .4}},
                        "physicalObjects": [{"objectIndex": 0, "kind": "notehead", "center": {"x": .4, "y": .2}}],
                        "sourceGraph": {"state": "KNOWN", "nodes": [], "edges": []},
                    },
                }
                source_path.write_text(json.dumps(source_record) + "\n")
                source_bundle = str(source_path)
            self.rows.append({
                "path": f"data/{score_id}.json", "mxl": "./" + mxl_member, "pdf": "./" + pdf_member,
                "license": "cc-by", "n_tracks": "1", "subset:all_valid": "True",
                "subset:no_license_conflict": "True", "subset:deduplicated": "True",
                "source_bundle": source_bundle,
            })
            pdf_members[pdf_member] = pdf_bytes()
            if index == 11:
                self.mxl_members[mxl_member] = mxl_bytes("Violin", 1)
            elif index == 12:
                self.mxl_members[mxl_member] = mxl_bytes(valid=False)
            else:
                self.mxl_members[mxl_member] = mxl_bytes()
        with open(self.csv_path, "w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            writer.writerows(self.rows)
        write_tar(self.pdf_archive, pdf_members)
        write_tar(self.mxl_archive, self.mxl_members)

    def tearDown(self):
        self.temp.cleanup()

    def factory(self):
        return Factory(self.work, self.csv_path, self.pdf_archive, self.mxl_archive,
                       shard_size=4, free_floor_gib=0)

    def test_end_to_end_interrupt_resume_retry_and_dashboard_truth(self):
        factory = self.factory()
        try:
            inspected = factory.inspect(3)
            self.assertFalse(inspected["manualExtractionRequired"])
            filtered = factory.filter_metadata(13)
            self.assertEqual(filtered["counts"], {"AMBIGUOUS_INSTRUMENTATION": 13})
            plan = factory.freeze_build_plan()
            self.assertEqual(plan["plannedScores"], 13)
            preflight = run_preflight(factory)
            self.assertEqual(preflight["state"], "COMPLETE")
            self.assertEqual(preflight["plannedScores"], 13)
            self.assertFalse(preflight["archivesUnpacked"])

            interrupted = factory.build(max_scores=13, interrupt_after=4)
            self.assertEqual(interrupted["status"], "INTERRUPTED")
            self.assertEqual(interrupted["accepted"], 4)
            first_status = factory.status()
            self.assertEqual(first_status["overall"]["accepted"], 4)
            self.assertEqual(first_status["progress"]["units"]["scores"]["denominator"], 13)
            self.assertAlmostEqual(first_status["progress"]["units"]["scores"]["percentage"], 4 / 13 * 100)
            frozen_percentage = first_status["progress"]["units"]["scores"]["percentage"]
            factory.pause()
            self.assertTrue(factory.status()["paused"])
            self.assertEqual(factory.status()["progress"]["units"]["scores"]["percentage"], frozen_percentage)
            factory.resume()

            resumed = factory.build(max_scores=20)
            self.assertEqual(resumed["accepted"], 6)
            self.assertEqual(resumed["review"], 1)
            self.assertEqual(resumed["rejected"], 1)
            self.assertEqual(resumed["failed"], 1)

            failed_member = "mxl/0/0/score12.mxl"
            self.mxl_members[failed_member] = mxl_bytes()
            write_tar(self.mxl_archive, self.mxl_members)
            self.assertEqual(factory.retry_failed()["reset"], 1)
            retried = factory.build(max_scores=5)
            self.assertEqual(retried["accepted"], 1)

            final_status = factory.status()
            self.assertEqual(final_status["overall"]["accepted"], 11)
            self.assertEqual(final_status["overall"]["review"], 1)
            self.assertEqual(final_status["overall"]["rejected"], 1)
            self.assertEqual(final_status["overall"]["failed"], 0)
            self.assertEqual(final_status["music"]["semanticLabels"], 0)
            self.assertEqual(final_status["music"]["trainingExamples"], 0)

            validation = factory.validate_dataset()
            self.assertTrue(validation["valid"])
            self.assertEqual(validation["canonicalScores"], 12)
            self.assertEqual(validation["fragments"], 11)
            self.assertTrue(validation["splitIntegrity"])
            self.assertTrue(validation["hashIntegrity"])
            self.assertEqual(factory.status()["progress"]["overall"]["percentage"], 100.0)
            factory.set_state("full_build_state", "FAILED")
            self.assertEqual(factory.status()["progress"]["overall"]["status"], "FAILED")
            factory.set_state("full_build_state", "PENDING")
            self.assertEqual(factory.status()["progress"]["overall"]["status"], "COMPLETE")

            self.assertEqual(factory.build(max_scores=20)["processed"], 0)
            self.assertFalse(any(self.work.joinpath("cache").iterdir()))
        finally:
            factory.close()

        args = type("Args", (), {
            "work_dir": self.work, "csv": self.csv_path, "pdf_archive": self.pdf_archive,
            "mxl_archive": self.mxl_archive,
        })()
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(args))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{server.server_port}/api/status", timeout=5) as response:
                dashboard_status = json.load(response)
            self.assertEqual(dashboard_status["overall"]["accepted"], 11)
            self.assertEqual(dashboard_status["music"]["semanticLabels"], 0)
            self.assertEqual(dashboard_status["progress"]["units"]["scores"]["denominator"], 13)
            self.assertEqual(dashboard_status["progress"]["overall"]["percentage"], 100.0)
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/build", method="POST"
            )
            with self.assertRaises(urllib.error.HTTPError) as blocked:
                urllib.request.urlopen(request, timeout=5)
            self.assertEqual(blocked.exception.code, 409)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
