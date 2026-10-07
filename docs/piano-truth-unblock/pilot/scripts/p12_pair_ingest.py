#!/usr/bin/env python3
"""P12 — adaptation-dashboard pair ingestion contract.

Ingests user-provided matched pairs (PDF + MusicXML/MXL) in a directory,
verifies source identity, re-renders with the pinned pipeline, joins, checks
quality, and writes one record per pair plus a batch manifest. This is the
schema a future dashboard will use for ~10-pair uploads; no UI is built here.

Usage:
  python3 p12_pair_ingest.py --pairs <dir> [--out <dir>]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PILOT = HERE.parent
sys.path.insert(0, str(HERE))
import pv_pipeline as pv  # noqa: E402

SYMBOLIC_EXT = (".musicxml", ".mxl")
PDF_EXT = (".pdf",)


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def find_pairs(d: Path):
    stems = {}
    for p in sorted(d.iterdir()):
        if p.suffix.lower() in SYMBOLIC_EXT + PDF_EXT:
            stems.setdefault(p.stem, {})[p.suffix.lower()] = p
    pairs = []
    for stem, files in sorted(stems.items()):
        symbolic = files.get(".musicxml") or files.get(".mxl")
        pdf = files.get(".pdf")
        if symbolic and pdf:
            pairs.append((stem, symbolic, pdf))
        elif symbolic:
            pairs.append((stem, symbolic, None))
    return pairs


def pdf_probe(pdf: Path, outdir: Path):
    import fitz  # PyMuPDF
    doc = fitz.open(pdf)
    info = {"pages": doc.page_count, "sha256": sha256_file(pdf), "bytes": pdf.stat().st_size}
    if doc.page_count:
        page = doc.load_page(0)
        pix = page.get_pixmap(dpi=200)
        outdir.mkdir(parents=True, exist_ok=True)
        png = outdir / "pdf-page-01.png"
        pix.save(str(png))
        info["page1_png"] = str(png)
        info["page1_size"] = [pix.width, pix.height]
    return info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", required=True)
    ap.add_argument("--out", default=str(PILOT / "data" / "pairs"))
    args = ap.parse_args()
    src = Path(args.pairs)
    if not src.is_dir():
        raise SystemExit(f"not a directory: {src}")
    outroot = Path(args.out)
    records = []
    for stem, symbolic, pdf in find_pairs(src):
        rec = {"pair": stem, "symbolic_path": str(symbolic),
               "symbolic_sha256": sha256_file(symbolic),
               "pdf_path": str(pdf) if pdf else None,
               "pdf": None, "status": None, "checks": {}}
        try:
            tk, mei, svgs, pages = pv.render_score(symbolic)
            records_mei, counts, missing_ids, measure_order = pv.parse_mei(mei)
            all_bbox, all_ids = {}, set()
            for pg, svg in enumerate(svgs, 1):
                for eid, bb in pv.svg_bboxes(svg).items():
                    bb["page"] = pg
                    all_bbox[eid] = bb
                all_ids |= pv.svg_group_ids(svg)
            _, joined, missing = pv.id_join(records_mei, all_ids)
            state = pv.state_join(tk, svgs, records_mei, measure_order)
            identity = pv.source_identity_check(symbolic, records_mei, counts, measure_order)
            dropped = pv.dropped_features(pv.musicxml_text(symbolic), mei)
            missing_nonstate = {t: n for t, n in missing.items()
                                if t not in pv.STATE_TAGS and t != "mRest" and n}
            state_mismatch = sum(v["mismatch"] for v in state.values())
            rec["checks"] = {
                "pages": pages,
                "notes": counts.get("note", 0),
                "id_join_missing_nonstate": missing_nonstate,
                "state_mismatch": state_mismatch,
                "state_unresolved": sum(v.get("unresolved", 0) for v in state.values()),
                "identity": identity,
                "dropped_features": dropped,
                "mei_sha256": pv.sha256_bytes(pv.canonical_mei(mei).encode()),
                "svg_sha256": pv.sha256_bytes("".join(svgs).encode()),
                "renderer": tk.getVersion(),
                "xml_id_seed": pv.XML_ID_SEED,
            }
            if dropped or missing_nonstate or state_mismatch:
                rec["status"] = "QUARANTINED:join"
            elif identity.get("error"):
                rec["status"] = f"QUARANTINED:{pv.Q_IDENTITY_UNVERIFIABLE}"
            elif not identity.get("ok"):
                rec["status"] = f"QUARANTINED:{pv.Q_IDENTITY}"
            else:
                rec["status"] = "PASS"
            if pdf:
                rec["pdf"] = pdf_probe(pdf, outroot / stem)
        except Exception as e:
            rec["status"] = f"QUARANTINED:{pv.Q_SOURCE}"
            rec["checks"]["error"] = str(e)[:200]
        (outroot / stem).mkdir(parents=True, exist_ok=True)
        (outroot / stem / "pair.json").write_text(json.dumps(rec, indent=1))
        records.append(rec)

    batch = {
        "schema": "corranzo.piano.pilot.pairs/1",
        "source_dir": str(src),
        "renderer": {"name": "verovio", "version_pin": "6.3.0", "xml_id_seed": pv.XML_ID_SEED},
        "pairs": records,
        "counts": {"total": len(records),
                   "pass": sum(1 for r in records if r["status"] == "PASS"),
                   "quarantined": sum(1 for r in records if r["status"] != "PASS")},
    }
    out = outroot / "pairs_batch.json"
    text = json.dumps(batch, indent=1, sort_keys=True)
    out.write_text(text)
    (out.with_suffix(".sha256")).write_text(
        hashlib.sha256(text.encode()).hexdigest() + "  " + out.name + "\n")
    print(f"[p12] {batch['counts']} -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
