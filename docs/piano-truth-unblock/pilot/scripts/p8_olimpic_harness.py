#!/usr/bin/env python3
"""P8 — real-world evaluation harness for OLiMPiC 1.0 Scanned (CC BY-SA 4.0).

Ingests the scanned dev/test system crops with their MusicXML/LMX truth,
builds a frozen benchmark manifest with provenance hashes, and provides the
evaluation plumbing (normalised edit distance over LMX token sequences) with
no training and no model:

  * self-check: truth used as prediction -> distance 0 on every sample
  * empty baseline: empty prediction -> distance 1.0 on every sample

Future predictions are evaluated by placing `<sample_id>.lmx` files in a
directory and running `--predictions <dir>`.

Usage:
  python3 p8_olimpic_harness.py --ingest
  python3 p8_olimpic_harness.py --evaluate --predictions <dir>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PILOT = HERE.parent
OLIMPIC = PILOT / "data" / "olimpic" / "olimpic-1.0-scanned"


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_list(p: Path):
    return [line.strip() for line in p.read_text().splitlines() if line.strip()]


def ingest():
    if not OLIMPIC.is_dir():
        raise SystemExit(f"missing {OLIMPIC}; extract olimpic-1.0-scanned.tar.gz first")
    records = []
    for split, listfile in (("test", "samples.test.txt"), ("dev", "samples.dev.txt")):
        for rel in read_list(OLIMPIC / listfile):
            base = OLIMPIC / rel
            png, mxml, lmx = base.with_suffix(".png"), base.with_suffix(".musicxml"), base.with_suffix(".lmx")
            if not (png.is_file() and mxml.is_file() and lmx.is_file()):
                continue
            records.append({
                "sample_id": rel.replace("samples/", ""),
                "split": split,
                "png": str(png.relative_to(OLIMPIC)),
                "png_sha256": sha256_file(png),
                "png_bytes": png.stat().st_size,
                "musicxml": str(mxml.relative_to(OLIMPIC)),
                "musicxml_sha256": sha256_file(mxml),
                "lmx": str(lmx.relative_to(OLIMPIC)),
                "lmx_sha256": sha256_file(lmx),
                "lmx_tokens": len(lmx.read_text().split()),
            })
    manifest = {
        "schema": "corranzo.piano.pilot.olimpic/1",
        "dataset": "OLiMPiC 1.0 Scanned",
        "license": "CC BY-SA 4.0",
        "source": "https://hdl.handle.net/11234/1-5419",
        "archive_sha256": sha256_file(PILOT / "data" / "olimpic-scanned.tar.gz"),
        "level": "system crop (scanned page image + MusicXML/LMX truth)",
        "splits": {"test": sum(1 for r in records if r["split"] == "test"),
                   "dev": sum(1 for r in records if r["split"] == "dev")},
        "samples": records,
    }
    out = PILOT / "manifests" / "olimpic_benchmark.json"
    text = json.dumps(manifest, indent=1, sort_keys=True)
    out.write_text(text)
    (out.with_suffix(".sha256")).write_text(hashlib.sha256(text.encode()).hexdigest() + "  " + out.name + "\n")
    print(f"[p8] ingested {len(records)} samples ({manifest['splits']}) -> {out}", file=sys.stderr)


def levenshtein(a, b):
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
        prev = cur
    return prev[-1]


def normalised_distance(pred_tokens, truth_tokens):
    d = levenshtein(pred_tokens, truth_tokens)
    return d / max(1, len(truth_tokens))


def evaluate(predictions_dir=None):
    man_path = PILOT / "manifests" / "olimpic_benchmark.json"
    man = json.loads(man_path.read_text())
    results = []
    self_ok = 0
    for rec in man["samples"]:
        truth = (OLIMPIC / rec["lmx"]).read_text().split()
        if predictions_dir:
            pf = Path(predictions_dir) / f"{rec['sample_id'].replace('/', '_')}.lmx"
            pred = pf.read_text().split() if pf.is_file() else []
        else:
            pred = truth  # self-check
        nd = normalised_distance(pred, truth)
        if pred is truth or nd == 0.0:
            self_ok += 1
        results.append({"sample_id": rec["sample_id"], "split": rec["split"],
                        "truth_tokens": len(truth), "pred_tokens": len(pred),
                        "normalised_edit_distance": round(nd, 6)})
    out = PILOT / "manifests" / "olimpic_selfcheck.json"
    out.write_text(json.dumps({
        "schema": "corranzo.piano.pilot.olimpic_eval/1",
        "mode": "predictions" if predictions_dir else "self_check",
        "samples": len(results),
        "zero_distance": self_ok,
        "mean_normalised_edit_distance": round(
            sum(r["normalised_edit_distance"] for r in results) / max(1, len(results)), 6),
        "results": results,
    }, indent=1))
    print(f"[p8] evaluated {len(results)} samples; zero-distance {self_ok} -> {out}", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ingest", action="store_true")
    ap.add_argument("--evaluate", action="store_true")
    ap.add_argument("--predictions", default=None)
    args = ap.parse_args()
    if args.ingest:
        ingest()
    if args.evaluate:
        evaluate(args.predictions)


if __name__ == "__main__":
    main()
