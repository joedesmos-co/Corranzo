#!/usr/bin/env python3
"""P1 — deterministic PDMX piano selection for the verified dataset pilot.

Selects ~N scores that satisfy, from the official PDMX metadata:

  * instrument list contains piano
  * subset:no_license_conflict == True
  * subset:all_valid == True  (MXL + PDF + MID present)
  * mxl path present

Selection is deterministic from a recorded seed (hash-ranked source ids), so
it is reproducible and not cherry-picked. Every selected row records source id,
source path, mxl path, licence, instrumentation, metadata version and the
selection key/reason.

Usage:
  python3 p1_select.py --target 1000 --seed 20261007
  python3 p1_select.py --pdmx-csv <path> --metadata-tar <path>
"""

import argparse
import csv
import hashlib
import json
import re
import sys
import tarfile
from pathlib import Path

csv.field_size_limit(10 ** 9)

HERE = Path(__file__).resolve().parent
PILOT = HERE.parent
DEFAULT_DATA = PILOT / "data" / "pdmx"

INSTR_RE = re.compile(rb'"instruments"\s*:\s*\[(.{0,4000}?)\]', re.S)
NAME_RE = re.compile(rb'"name"\s*:\s*"([^"]{0,80})"')


def file_sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def piano_metadata_paths(metadata_tar: Path):
    """Return {metadata path -> [instrument names]} for piano-bearing scores.

    Cached next to the archive keyed by its sha256 so repeated runs are cheap.
    """
    tar_hash = file_sha256(metadata_tar)
    cache = metadata_tar.with_suffix(".piano_instruments.json")
    if cache.is_file():
        try:
            cached = json.loads(cache.read_text())
            if cached.get("tar_sha256") == tar_hash:
                print(f"[p1] metadata cache hit: {cache}", file=sys.stderr)
                return cached["paths"]
        except Exception:
            pass
    out = {}
    total = 0
    with tarfile.open(metadata_tar, "r|gz") as tar:
        for member in tar:
            if not member.name.endswith(".json"):
                continue
            total += 1
            raw = tar.extractfile(member).read()
            m = INSTR_RE.search(raw)
            if not m:
                continue
            names = [x.decode("utf8", "ignore") for x in NAME_RE.findall(m.group(1))]
            if any("piano" in n.lower() for n in names):
                out["./" + member.name] = names
    cache.write_text(json.dumps({"tar_sha256": tar_hash, "paths": out}))
    print(f"[p1] metadata files scanned: {total}; piano-bearing: {len(out)}", file=sys.stderr)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdmx-csv", default=str(DEFAULT_DATA / "PDMX.csv"))
    ap.add_argument("--metadata-tar", default=str(DEFAULT_DATA / "metadata.tar.gz"))
    ap.add_argument("--target", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=20261007)
    ap.add_argument("--allow-multi-instrument", action="store_true",
                    help="allow scores whose instrument set contains non-piano instruments")
    ap.add_argument("--out", default=str(PILOT / "manifests" / "selection.json"))
    args = ap.parse_args()

    csv_path = Path(args.pdmx_csv)
    meta_path = Path(args.metadata_tar)
    for p in (csv_path, meta_path):
        if not p.is_file():
            raise SystemExit(f"[p1] missing required input: {p}")

    piano_meta = piano_metadata_paths(meta_path)

    candidates = []
    rows = 0
    with open(csv_path, newline="") as f:
        for row in csv.DictReader(f):
            rows += 1
            if row.get("subset:no_license_conflict") != "True":
                continue
            if row.get("subset:all_valid") != "True":
                continue
            mxl = row.get("mxl") or "NA"
            if mxl in ("NA", ""):
                continue
            meta = row.get("metadata") or "NA"
            if meta not in piano_meta:
                continue
            instruments = piano_meta[meta]
            if not args.allow_multi_instrument and not all(
                    "piano" in i.lower() for i in instruments):
                continue
            sid = Path(row["path"]).stem
            key = hashlib.sha256(f"{args.seed}|{row['path']}".encode()).hexdigest()
            candidates.append({
                "source_id": sid,
                "source_path": row["path"],
                "mxl_path": mxl,
                "pdf_path": row.get("pdf"),
                "metadata_path": meta,
                "license": row.get("license"),
                "license_conflict": row.get("license_conflict") == "True",
                "instruments": instruments,
                "title": row.get("song_name") or row.get("title") or "",
                "composer": row.get("composer_name") or "",
                "n_tracks": row.get("n_tracks"),
                "n_notes": row.get("n_notes"),
                "complexity": row.get("complexity"),
                "selection_key": key,
                "selection_reason": f"piano+no_license_conflict+all_valid; hash-rank({args.seed})",
            })
    print(f"[p1] CSV rows: {rows}; eligible piano candidates: {len(candidates)}", file=sys.stderr)

    candidates.sort(key=lambda r: r["selection_key"])
    selected = candidates[: args.target]

    manifest = {
        "schema": "corranzo.piano.pilot.selection/1",
        "dataset": "PDMX",
        "dataset_version": "v9 (Zenodo 15571083)",
        "seed": args.seed,
        "target": args.target,
        "eligible_candidates": len(candidates),
        "selected_count": len(selected),
        "filters": {
            "instrument_contains": "piano",
            "piano_only_instrument_set": not args.allow_multi_instrument,
            "subset:no_license_conflict": True,
            "subset:all_valid": True,
            "mxl_present": True,
        },
        "selection_rule": "sha256(seed|source_path) ascending, first target rows",
        "scores": selected,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(manifest, indent=1)
    out.write_text(text)
    digest = hashlib.sha256(text.encode()).hexdigest()
    (out.with_suffix(".sha256")).write_text(digest + "  " + out.name + "\n")
    print(f"[p1] wrote {out} ({len(selected)} scores), sha256={digest}", file=sys.stderr)


if __name__ == "__main__":
    main()
