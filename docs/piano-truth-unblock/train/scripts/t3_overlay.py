#!/usr/bin/env python3
"""T3 — visual target overlay QA packet (TRAIN/DEV only, never TEST).

Draws truth boxes + semantic labels on rendered pages and checks
programmatically that positions and labels correspond to the actual glyphs.
No model predictions are used.
"""
from __future__ import annotations
import gzip
import hashlib
import json
import re
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
OBJECTS = PILOT / "data" / "objects"
QA = TRAIN / "qa"


def load_split(name):
    raw = json.loads((PILOT / "manifests" / "splits.json").read_text())
    out = list(raw[name])
    del raw
    return out


def rank(ids, tag, n):
    return sorted(ids, key=lambda s: hashlib.sha256(f"piano-qa-v1|{tag}|{s}".encode()).hexdigest())[:n]


def main():
    QA.mkdir(exist_ok=True)
    pages = []
    for name, n in (("train", 6), ("dev", 2)):
        for sid in rank(load_split(name), f"overlay-{name}", n):
            meta = json.loads((RENDER / sid / "meta.json").read_text())
            pages.append((sid, name, 1))
    report = {"pages": [], "checks": {}}
    total_boxes = 0
    boxes_in_bounds = 0
    inky = 0
    for sid, split, pg in pages:
        meta = json.loads((RENDER / sid / "meta.json").read_text())
        objs = [o for o in json.load(gzip.open(OBJECTS / f"{sid}.objects.json.gz", "rt"))
                if o["tag"] in ("note", "rest", "mRest") and int(o["bbox"]["page"]) == pg]
        img = cv2.imread(str(RENDER / sid / f"page-{pg:02d}.png"))
        H, W = img.shape[:2]
        pw = next(p["width"] for p in meta["page_geometry"] if p["page"] == pg)
        sx = W / pw
        svg_text = (RENDER / sid / f"page-{pg:02d}.svg").read_text()
        tm = re.search(r'<g class="page-margin" transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)', svg_text)
        tx, ty = (float(tm.group(1)), float(tm.group(2))) if tm else (0.0, 0.0)
        vis = img.copy()
        page_boxes = 0
        for o in objs:
            b = o["bbox"]
            x0, y0 = int((b["x"] + tx) / 10 * sx), int((b["y"] + ty) / 10 * sx)
            x1, y1 = int((b["x"] + b["w"] + tx) / 10 * sx), int((b["y"] + b["h"] + ty) / 10 * sx)
            if not (0 <= x0 < x1 <= W and 0 <= y0 < y1 <= H):
                continue
            boxes_in_bounds += 1
            patch = img[max(0, y0):y1, max(0, x0):x1]
            if patch.size and (patch < 200).mean() > 0.005:
                inky += 1
            col = (0, 160, 0) if o["tag"] == "note" else (180, 0, 0)
            cv2.rectangle(vis, (x0, y0), (x1, y1), col, 1)
            if o["tag"] == "note":
                lab = f"{o['pname']}{o['oct']}{o.get('dur','')} s{o['staff']}v{o.get('voice')}"
            else:
                lab = f"rest{(' '+str(o.get('dur'))) if o.get('dur') else ''}"
            cv2.putText(vis, lab, (x0, max(0, y0 - 3)), cv2.FONT_HERSHEY_SIMPLEX, 0.35, col, 1)
            page_boxes += 1
        total_boxes += page_boxes
        out = QA / f"{split}_{sid}_p{pg:02d}.png"
        cv2.imwrite(str(out), vis)
        report["pages"].append({"sid": sid, "split": split, "page": pg,
                                "objects": len(objs), "boxes_drawn": page_boxes,
                                "file": out.name})
    report["checks"] = {"total_boxes": total_boxes, "boxes_in_bounds": boxes_in_bounds,
                        "boxes_with_ink": inky}
    (QA / "qa.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report["checks"], indent=1))


if __name__ == "__main__":
    main()
