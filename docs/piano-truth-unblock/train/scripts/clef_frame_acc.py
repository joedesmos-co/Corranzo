#!/usr/bin/env python3
"""Auto-clef accuracy per detected frame (DEV, read-only).

Truth clef per frame = majority truth clef of the notes nearest that frame
(robust to clefs appearing only in the first measure). Reports accuracy and
the failing cases. Writes reports/clef_frame_acc.json.
"""
from __future__ import annotations
import gzip
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
sys.path.insert(0, str(HERE))
from auto_locate import group_staves, staff_lines  # noqa: E402
from auto_pitch2 import clef_crop  # noqa: E402
from auto_rest import page_ctx  # noqa: E402
from clef_map import load_templates  # noqa: E402
from clef_vision import classify as clef_classify  # noqa: E402


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    templates = load_templates()
    C = Counter()
    bad = []
    for sid in splits["dev"][:5]:
        evs = json.load(gzip.open(TRAIN / "data" / "events" /
                                  f"{sid}.events.json.gz", "rt"))["events"]
        for pg in sorted({int(e["bbox"]["page"]) for e in evs if e.get("bbox")}):
            meta, gray, sx, gap, svg, tx, ty = page_ctx(sid, pg)
            lines, dark = staff_lines(gray)
            frames = group_staves(lines)
            darkm = (gray < 128).astype(np.uint8)
            col_on = (darkm > 0)[lines[0]:lines[-1] + 1, :].any(axis=0)
            xs = np.where(col_on)[0]
            x0 = int(xs[0]) if len(xs) else 0
            votes = defaultdict(Counter)
            for e in evs:
                if e["kind"] != "note" or (e.get("bbox") or {}).get("page") != pg:
                    continue
                b = e["bbox"]
                cy = (b["y"] + b["h"] / 2 + ty) / 10 * sx
                cl = e.get("clef") or {}
                if not cl.get("shape"):
                    continue
                fi = min(range(len(frames)),
                         key=lambda i: min(abs(cy - l) for l in frames[i]))
                votes[fi][cl["shape"]] += 1
            for fi, fr in enumerate(frames):
                cr = clef_crop(gray, x0, fr, gap, sx)
                sh, _ = (clef_classify(cr, templates) if cr is not None
                         else (None, None))
                tv = votes[fi].most_common(1)[0][0] if votes[fi] else None
                if tv is None:
                    C["no_truth"] += 1
                    continue
                C["n"] += 1
                if sh == tv:
                    C["ok"] += 1
                else:
                    C["wrong"] += 1
                    if len(bad) < 10:
                        bad.append([sid[:6], pg, fi, sh, tv])
    out = {"frames": C["n"], "ok": C["ok"], "wrong": C["wrong"],
           "acc": round(C["ok"] / max(1, C["n"]), 4), "bad": bad}
    (TRAIN / "reports" / "clef_frame_acc.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
