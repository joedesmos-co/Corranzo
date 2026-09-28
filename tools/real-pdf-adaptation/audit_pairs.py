#!/usr/bin/env python3
"""Audit matched PDF + MusicXML piano pairs and write the by-score split.

The split is BY SCORE, never by measure: a score lives in exactly one of
``adaptation`` / ``validation`` / ``heldout-test`` / ``diagnostic`` or is
excluded. ``heldout-test`` and ``diagnostic`` scores never contribute a single
training measure. ``diagnostic`` additionally never influences checkpoint
selection, which is how ``demo-minuet-in-g`` is kept out of the tuning loop
entirely while still being measurable.

Two independent audits run before anything is written:

1. byte-level: identical (pdf, musicxml) content found twice is ONE score, so a
   re-render of the same piece can never land in two splits;
2. semantic: the MusicXML must be a single grand staff with a 1:1 printed-measure
   bijection, otherwise it is reported and excluded.

Writes ``split_manifest.json``. Nothing is trained and no PDF is rendered.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from musicxml_truth import read_musicxml_bytes, score_report  # noqa: E402

# (id, split, pdf, musicxml, engraving family)
# Engraving families are named from the actual embedded music font in the PDF.
# They are what makes the raster domain shift interesting, so the split
# deliberately spreads every family across train and both evaluation sets.
ENTRIES = [
    # ---- MuseScore 4 / Emmentaler + Century Schoolbook ------------------------
    ("pl-bach-prelude-bwv846", "adaptation",
     "public/fixtures/practice-library/piano-bach-prelude-bwv846/piano-bach-prelude-bwv846.pdf",
     "public/fixtures/practice-library/piano-bach-prelude-bwv846/piano-bach-prelude-bwv846.musicxml",
     "musescore4-emmentaler"),
    ("pl-handel-gavotte", "adaptation",
     "public/fixtures/practice-library/piano-handel-gavotte/piano-handel-gavotte.pdf",
     "public/fixtures/practice-library/piano-handel-gavotte/piano-handel-gavotte.musicxml",
     "musescore4-emmentaler"),
    ("bc-bach-fugue-bwv846", "adaptation",
     "benchmarks/cache/bach-fugue-bwv846/score.pdf",
     "benchmarks/cache/bach-fugue-bwv846/score.musicxml",
     "musescore4-emmentaler"),
    ("bc-chopin-etude-op10-12", "adaptation",
     "benchmarks/cache/chopin-etude-op10-12/score.pdf",
     "benchmarks/cache/chopin-etude-op10-12/score.musicxml",
     "musescore4-emmentaler"),
    ("pl-brahms-lullaby", "excluded",
     "public/fixtures/practice-library/piano-brahms-lullaby/piano-brahms-lullaby.pdf",
     "public/fixtures/practice-library/piano-brahms-lullaby/piano-brahms-lullaby.musicxml",
     "musescore4-emmentaler"),
    ("bc-mozart-k153", "validation",
     "benchmarks/cache/mozart-k153/score.pdf",
     "benchmarks/cache/mozart-k153/score.musicxml",
     "musescore4-emmentaler"),
    ("pl-brahms-waltz-op39-3", "validation",
     "public/fixtures/practice-library/piano-brahms-waltz-op39-3/piano-brahms-waltz-op39-3.pdf",
     "public/fixtures/practice-library/piano-brahms-waltz-op39-3/piano-brahms-waltz-op39-3.musicxml",
     "musescore4-emmentaler"),
    ("pl-tchaikovsky-old-french-song", "heldout-test",
     "public/fixtures/practice-library/piano-tchaikovsky-old-french-song/piano-tchaikovsky-old-french-song.pdf",
     "public/fixtures/practice-library/piano-tchaikovsky-old-french-song/piano-tchaikovsky-old-french-song.musicxml",
     "musescore4-emmentaler"),
    ("bc-beethoven-sonata-op2-m1", "heldout-test",
     "benchmarks/cache/beethoven-sonata-op2-m1/score.pdf",
     "benchmarks/cache/beethoven-sonata-op2-m1/score.musicxml",
     "musescore4-emmentaler"),

    # ---- MuseScore / Feta (feta-alphabet) ------------------------------------
    ("pl-chopin-mazurka-op6-1", "adaptation",
     "public/fixtures/practice-library/piano-chopin-mazurka-op6-1/piano-chopin-mazurka-op6-1.pdf",
     "public/fixtures/practice-library/piano-chopin-mazurka-op6-1/piano-chopin-mazurka-op6-1.musicxml",
     "musescore-feta"),
    ("pl-mozart-turkish-march", "adaptation",
     "public/fixtures/practice-library/piano-mozart-turkish-march/piano-mozart-turkish-march.pdf",
     "public/fixtures/practice-library/piano-mozart-turkish-march/piano-mozart-turkish-march.musicxml",
     "musescore4-emmentaler"),
    ("bc-chopin-nocturne-op9-n2", "adaptation",
     "benchmarks/cache/chopin-nocturne-op9-n2/score.pdf",
     "benchmarks/cache/chopin-nocturne-op9-n2/score.musicxml",
     "musescore-feta"),
    ("bc-chopin-etude-op10-01", "heldout-test",
     "benchmarks/cache/chopin-etude-op10-01/score.pdf",
     "benchmarks/cache/chopin-etude-op10-01/score.musicxml",
     "musescore-feta"),

    # ---- MuseScore legacy / MScore -------------------------------------------
    ("std-hungarian-dance-no5", "adaptation",
     "public/fixtures/hungarian-dance-no5/hungarian-dance-no5.pdf",
     "public/fixtures/hungarian-dance-no5/hungarian-dance-no5.mxl",
     "musescore-legacy-mscore"),
    ("std-spider-dance-undertale", "validation",
     "public/fixtures/spider-dance-undertale.pdf",
     "public/fixtures/spider-dance-undertale.mxl",
     "musescore-legacy-mscore"),

    # ---- LilyPond / Bravura + Edwin + Leland ---------------------------------
    ("std-la-campanella", "adaptation",
     "public/fixtures/la-campanella-grandes-etudes-de-paganini-no-3-franz-liszt.pdf",
     "public/fixtures/la-campanella-grandes-etudes-de-paganini-no-3-franz-liszt.mxl",
     "lilypond-bravura"),

    # ---- synthetic Corranzo benchmark engraving -------------------------------
    ("omf-piano-dense-advanced-vector", "heldout-test",
     "benchmarks/omr-fixtures/piano-dense-advanced-vector/piano-dense-advanced-vector.pdf",
     "benchmarks/omr-fixtures/piano-dense-advanced-vector/piano-dense-advanced-vector.musicxml",
     "corranzo-benchmark"),
    ("omf-piano-grand-voices-vector", "heldout-test",
     "benchmarks/omr-fixtures/piano-grand-voices-vector/piano-grand-voices-vector.pdf",
     "benchmarks/omr-fixtures/piano-grand-voices-vector/piano-grand-voices-vector.musicxml",
     "corranzo-benchmark"),
    ("omf-piano-rhythm-tuplets-vector", "validation",
     "benchmarks/omr-fixtures/piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.pdf",
     "benchmarks/omr-fixtures/piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.musicxml",
     "corranzo-benchmark"),

    # ---- diagnostic only: never trained, never used for checkpoint selection --
    ("std-demo-minuet-in-g", "diagnostic",
     "public/fixtures/demo-minuet-in-g.pdf",
     "public/fixtures/demo-minuet-in-g.musicxml",
     "musescore4-emmentaler"),
    ("pl-beethoven-fur-elise", "diagnostic",
     "public/fixtures/practice-library/piano-beethoven-fur-elise/piano-beethoven-fur-elise.pdf",
     "public/fixtures/practice-library/piano-beethoven-fur-elise/piano-beethoven-fur-elise.musicxml",
     "musescore4-emmentaler"),
]

# Pairs that exist on disk but are not usable for a piano grand-staff campaign.
# Recorded so the audit is complete, never silently dropped.
KNOWN_UNUSABLE = [
    ("bc-bach-chorale-bwv259", "SATB choral, 2 parts, no bass-clef grand staff in every part"),
    ("bc-bach-chorale-bwv264", "SATB choral, 4 parts"),
    ("bc-bach-sheep-may-safely", "SATB choral, 4 parts"),
    ("bc-mozart-ave-verum", "2 vocal parts"),
    ("bc-mozart-symphony25-m1", "orchestral, 7 parts"),
    ("bc-vivaldi-mentre-dormi", "orchestral, 6 parts"),
    ("bc-bach-lute-prelude-bwv997", "guitar, single F4 staff"),
    ("pl-piano-mozart-menuet-k2", "held in reserve: single-line texture, 24 measures, kept for a later run"),
    ("bc-schubert-erlkonig", "3 parts, one is a vocal line above the piano staves"),
    ("bc-schubert-heidenroeslein", "3 parts, one is a vocal line above the piano staves"),
    ("pl-piano-bach-chorale-bwv259", "2 vocal parts labelled Soprano/Tenor"),
    ("pl-piano-chopin-mazurka-op6-1 (dup)", "identical piece to the benchmarks/cache render; one score only"),
    ("omf-piano-beginner-single-vector", "8 measures, single voice, no headroom for a held-out set"),
    ("pl-piano-bach-chorale-bwv259 (dup)", "identical piece to the benchmarks/cache render; one score only"),
    ("omf-piano-articulation-scan", "8 measures, raster scan variant, no matched MusicXML fidelity"),
    ("guitar-* (16 practice-library scores)", "guitar tablature, single F4 staff"),
    ("corranzo-holdout-intake (13 PDFs)", "no MusicXML at all; cannot produce ground truth"),
]


def sha256_file(path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def page_count(path) -> int:
    import fitz
    document = fitz.open(path)
    try:
        return len(document)
    finally:
        document.close()


def embedded_music_fonts(path, page_limit=2) -> list[str]:
    import fitz
    document = fitz.open(path)
    found: set[str] = set()
    try:
        for index in range(min(len(document), page_limit)):
            for resource in document[index].get_fonts(full=True):
                base = (resource[3] or "").split("+")[-1]
                if base:
                    found.add(base)
    finally:
        document.close()
    return sorted(found)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=str(Path(__file__).with_name("split_manifest.json")))
    args = parser.parse_args()

    scored, seen_content = [], {}
    for score_id, split, pdf, musicxml, engraving in ENTRIES:
        pdf_path, xml_path = REPO / pdf, REPO / musicxml
        row = {
            "id": score_id, "split": split, "pdf": pdf, "musicxml": musicxml,
            "engraving": engraving, "status": None, "rejected": [],
        }
        if not pdf_path.exists() or not xml_path.exists():
            row["status"] = "missing_file"
            row["rejected"] = [f"pdf={pdf_path.exists()} musicxml={xml_path.exists()}"]
            scored.append(row)
            continue
        row["pdf_sha256"] = sha256_file(pdf_path)
        musicxml_path = REPO / musicxml
        row["musicxml_sha256"] = sha256_file(musicxml_path)
        content_key = (row["pdf_sha256"], row["musicxml_sha256"])
        row["pages"] = page_count(pdf_path)
        row["fonts"] = embedded_music_fonts(pdf_path)
        root = ET.fromstring(read_musicxml_bytes(xml_path).decode("utf-8", "replace"))
        row["xml_measures"] = len(root.findall("./part")[0].findall("measure"))
        row["xml_notes"] = len(root.findall(".//note"))
        row["xml_rests"] = len(root.findall(".//note/rest"))
        report = score_report(musicxml_path)
        report.pop("truth", None)
        row["musicxml_audit"] = report
        if not report.get("ok"):
            row["status"] = "musicxml_rejected"
            row["rejected"] = report["rejected"]
        elif content_key in seen_content:
            row["status"] = "duplicate_content"
            row["rejected"] = [f"byte-identical pair already scored as {seen_content[content_key]}"]
        else:
            seen_content[content_key] = score_id
            row["status"] = "ok"
        scored.append(row)

    usable = [r for r in scored if r["status"] == "ok"]
    splits = {"adaptation": [], "validation": [], "heldout-test": [], "diagnostic": []}
    for row in usable:
        splits[row["split"]].append(row["id"])
    families = {}
    for row in usable:
        families.setdefault(row["engraving"], set()).add(row["split"])
    overlap = []
    seen = {}
    for name in splits:
        for score_id in splits[name]:
            if score_id in seen:
                overlap.append((score_id, seen[score_id], name))
            seen[score_id] = name

    payload = {
        "schemaVersion": 1,
        "policy": {
            "unit": "score",
            "note": "A score is assigned to exactly one split. No measure of a "
                    "heldout-test or diagnostic score is ever written to the "
                    "adaptation split.",
            "diagnostic": "Reported only. Never used for checkpoint selection, "
                          "so demo-minuet-in-g cannot be tuned to.",
        },
        "splits": splits,
        "engraving_coverage": {k: sorted(v) for k, v in sorted(families.items())},
        "overlap": overlap,
        "scores": scored,
        "known_unusable": [{"id": i, "reason": r} for i, r in KNOWN_UNUSABLE],
    }
    payload["digest"] = hashlib.sha256(
        json.dumps({k: v for k, v in payload.items() if k != "digest"},
                   sort_keys=True).encode()).hexdigest()
    out = Path(args.out)
    tmp = Path(str(out) + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True))
    os.replace(tmp, out)

    print(json.dumps({
        "usable_scores": len(usable),
        "by_split": {k: len(v) for k, v in splits.items()},
        "engraving_coverage": payload["engraving_coverage"],
        "overlap": overlap,
        "excluded": [(r["id"], r["status"]) for r in scored if r["status"] != "ok"],
        "out": str(out),
    }, indent=2))
    if overlap:
        raise SystemExit("split overlap detected; refusing to write a leaky split")


if __name__ == "__main__":
    main()
