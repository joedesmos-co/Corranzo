#!/usr/bin/env python3
"""P2 determinism check — re-render a deterministic sample in separate processes
and compare canonical MEI, SVG and object-table hashes against the manifest.

Usage:
  python3 p2_determinism.py --sample 25
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PILOT = HERE.parent
RENDER = PILOT / "data" / "render"
MXL = PILOT / "data" / "mxl"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=25)
    ap.add_argument("--seed", type=int, default=20261007)
    args = ap.parse_args()

    passed = []
    for meta in sorted(RENDER.glob("*/meta.json")):
        m = json.loads(meta.read_text())
        if m.get("status") == "PASS":
            passed.append(m)
    ranked = sorted(passed, key=lambda m: hashlib.sha256(
        f"{args.seed}|determinism|{m['source_id']}".encode()).hexdigest())
    sample = ranked[: args.sample]

    results = []
    ok = 0
    for m in sample:
        sid = m["source_id"]
        mxl = MXL / f"{sid}.mxl"
        p = subprocess.run([sys.executable, str(HERE / "determinism_worker.py"), str(mxl)],
                           capture_output=True, text=True)
        try:
            got = json.loads(p.stdout.strip().splitlines()[-1])
        except Exception:
            results.append({"source_id": sid, "ok": False, "error": (p.stderr or p.stdout)[-200:]})
            continue
        match = (got["mei_sha256"] == m["mei_sha256"]
                 and got["svg_sha256"] == m["svg_sha256"]
                 and got["objects_sha256"] == m["objects_sha256"])
        ok += 1 if match else 0
        results.append({"source_id": sid, "ok": match,
                        "mei": got["mei_sha256"] == m["mei_sha256"],
                        "svg": got["svg_sha256"] == m["svg_sha256"],
                        "objects": got["objects_sha256"] == m["objects_sha256"]})
        if len(results) % 5 == 0:
            print(f"[p2d] {len(results)}/{len(sample)}", file=sys.stderr)

    out = PILOT / "manifests" / "determinism.json"
    out.write_text(json.dumps({
        "schema": "corranzo.piano.pilot.determinism/1",
        "sample": len(sample), "ok": ok,
        "all_ok": ok == len(sample), "results": results}, indent=1))
    print(f"[p2d] determinism {ok}/{len(sample)} -> {out}", file=sys.stderr)
    return 0 if ok == len(sample) else 1


if __name__ == "__main__":
    raise SystemExit(main())
