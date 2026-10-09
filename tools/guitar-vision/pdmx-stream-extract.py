#!/usr/bin/env python3
"""Stream selected members out of the PDMX mxl.tar.gz without downloading it.

gzip+tar is sequential: this reads from byte 0, parses tar headers on the
fly, writes only wanted members to staging, and aborts the connection when
all are found or the byte cap is hit. Nothing else touches the disk.

Usage:
    python3 tools/guitar-vision/pdmx-stream-extract.py --want want.json --out <dir> --cap-mb 600
want.json: {"members": ["mxl/1/30/....mxl", ...]} (leading ./ optional)
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import tarfile
import urllib.request
from pathlib import Path

URL = "https://zenodo.org/api/records/15571083/files/mxl.tar.gz/content"
CHUNK = 1 << 20


class CappedStream(io.RawIOBase):
    """File-like reader that stops after cap_bytes (for tarfile streaming)."""

    def __init__(self, response, cap_bytes: int):
        self.response = response
        self.cap = cap_bytes
        self.transferred = 0
        self.hit_cap = False

    def readable(self):
        return True

    def readinto(self, buf):
        if self.transferred >= self.cap:
            self.hit_cap = True
            return 0
        data = self.response.read(min(len(buf), self.cap - self.transferred))
        self.transferred += len(data)
        if not data:
            return 0
        buf[: len(data)] = data
        return len(data)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--want", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--cap-mb", type=int, default=600)
    parser.add_argument("--stdin", action="store_true",
                        help="read the tar.gz byte stream from stdin (e.g. piped from curl)")
    args = parser.parse_args()
    wanted = {m.lstrip("./") for m in json.loads(Path(args.want).read_text())["members"]}
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    request = urllib.request.Request(URL, headers={"User-Agent": "corranzo-dataset-pilot/1.0"})
    if args.stdin:
        # Piped bytes (e.g. from curl, which owns TLS here); aborting early
        # just stops reading — curl gets SIGPIPE and exits.
        stream = CappedStream(sys.stdin.buffer, args.cap_mb * (1 << 20))
        response = None
    else:
        response = urllib.request.urlopen(request, timeout=120)
        stream = CappedStream(response, args.cap_mb * (1 << 20))
    found: dict[str, int] = {}
    scanned = 0
    try:
        with tarfile.open(fileobj=stream, mode="r|gz") as tar:
            for member in tar:
                scanned += 1
                name = member.name.lstrip("./")
                if name in wanted and member.isfile():
                    payload = tar.extractfile(member)
                    if payload is None:
                        continue
                    target = out_dir / Path(name).name
                    target.write_bytes(payload.read())
                    found[name] = member.size
                    if len(found) >= len(wanted):
                        break
                if stream.hit_cap:
                    break
    except Exception as error:  # noqa: BLE001 - truncated stream on abort is expected
        print(f"stream ended: {error}", file=sys.stderr)
    finally:
        if response is not None:
            response.close()
    report = {
        "wanted": len(wanted),
        "found": len(found),
        "scannedMembers": scanned,
        "bytesTransferred": stream.transferred,
        "hitCap": stream.hit_cap,
        "complete": len(found) >= len(wanted),
        "files": sorted(found),
    }
    (out_dir / "extraction-report.json").write_text(json.dumps(report, indent=1))
    print(json.dumps({k: v for k, v in report.items() if k != "files"}, indent=1))
    return 0 if report["complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
