#!/usr/bin/env python3
"""P1b — extract the selected MXL files from the PDMX mxl.tar.gz archive.

Streams the archive once, extracts only members in the selection manifest,
writes data/mxl/<source_id>.mxl, and records sha256/size for every file in
manifests/mxl_fetch.json.

Usage:
  python3 p1_fetch_mxl.py
"""

from __future__ import annotations

import hashlib
import json
import sys
import tarfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PILOT = HERE.parent
DATA = PILOT / "data"
ARCHIVE = DATA / "pdmx" / "mxl.tar.gz"
OUTDIR = DATA / "mxl"


def norm(p: str) -> str:
    while p.startswith("./"):
        p = p[2:]
    return p


def main():
    selection = json.loads((PILOT / "manifests" / "selection.json").read_text())
    want = {norm(s["mxl_path"]): s["source_id"] for s in selection["scores"]}
    if not ARCHIVE.is_file():
        raise SystemExit(f"missing archive {ARCHIVE}")
    OUTDIR.mkdir(parents=True, exist_ok=True)

    extracted = {}
    seen = 0
    with tarfile.open(ARCHIVE, "r|gz") as tar:
        for member in tar:
            if not member.isfile():
                continue
            seen += 1
            name = norm(member.name)
            sid = want.get(name)
            if sid is None:
                continue
            data = tar.extractfile(member).read()
            dest = OUTDIR / f"{sid}.mxl"
            dest.write_bytes(data)
            extracted[sid] = {"mxl_tar_path": name, "bytes": len(data),
                              "sha256": hashlib.sha256(data).hexdigest()}
            if len(extracted) % 100 == 0:
                print(f"[p1b] extracted {len(extracted)}/{len(want)}", file=sys.stderr)
            if len(extracted) == len(want):
                break
    missing = sorted(set(want.values()) - set(extracted))
    manifest = {
        "schema": "corranzo.piano.pilot.mxl_fetch/1",
        "archive": str(ARCHIVE.name),
        "members_seen": seen,
        "requested": len(want),
        "extracted": len(extracted),
        "missing": missing,
        "files": extracted,
    }
    out = PILOT / "manifests" / "mxl_fetch.json"
    text = json.dumps(manifest, indent=1, sort_keys=True)
    out.write_text(text)
    (out.with_suffix(".sha256")).write_text(
        hashlib.sha256(text.encode()).hexdigest() + "  " + out.name + "\n")
    print(f"[p1b] extracted {len(extracted)}/{len(want)}; missing {len(missing)}; wrote {out}",
          file=sys.stderr)


if __name__ == "__main__":
    main()
