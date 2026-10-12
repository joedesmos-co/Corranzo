#!/usr/bin/env python3
"""Frozen-model-assisted notehead completion (DEV, measured).

For each CC rejected by the frozen detector's size window (fused blobs:
beams, chords, rest+stem), slide a notehead-sized window every 0.5 gap
inside it and run the FROZEN common probe's kind head (trained on oracle
notehead boxes, corner-anchored crops exactly as infer.build_inputs).
Windows with kind==note above threshold become candidates; NMS vs the
existing detections. No training; uses validated components only.
Writes reports/det_kindassist.json.
"""
from __future__ import annotations
import gzip
import json
import sys
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
sys.path.insert(0, str(HERE))
from detector import build_mask, detect_noteheads, W_MIN, W_MAX  # noqa: E402
from auto_locate import staff_lines  # noqa: E402
from auto_rest import page_ctx  # noqa: E402
from staff_geometry import notehead_map  # noqa: E402


def match(heads, truth, gap):
    used = set()
    tp = 0
    for (px, py) in truth:
        hit = None
        for j, d in enumerate(heads):
            if j in used:
                continue
            if d["x"] <= px <= d["x"] + d["w"] and d["y"] <= py <= d["y"] + d["h"]:
                hit = j
                break
        if hit is None:
            best, bj = (1.2 * gap) ** 2, -1
            for j, d in enumerate(heads):
                if j in used:
                    continue
                v = (d["x"] + d["w"] / 2 - px) ** 2 + (d["y"] + d["h"] / 2 - py) ** 2
                if v < best:
                    best, bj = v, j
            if bj >= 0 and best <= (1.2 * gap) ** 2:
                hit = bj
        if hit is None:
            continue
        used.add(hit)
        tp += 1
    return {"tp": tp, "fp": len(heads) - len(used), "fn": len(truth) - tp}


def main():
    import torch
    from infer import load_models
    models = load_models(device="cpu")
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    for THR in (0.5, 0.7, 0.9):
        R = Counter()
        for sid in splits["dev"][:5]:
            evs = json.load(gzip.open(TRAIN / "data" / "events" /
                                      f"{sid}.events.json.gz", "rt"))["events"]
            for pg in sorted({int(e["bbox"]["page"]) for e in evs if e.get("bbox")}):
                meta, gray, sx, gap, svg, tx, ty = page_ctx(sid, pg)
                lines, dark = staff_lines(gray)
                heads = detect_noteheads(gray, lines, gap)
                nh = notehead_map(svg)
                truth = []
                for e in evs:
                    if e["kind"] == "note" and (e.get("bbox") or {}).get("page") == pg:
                        pos = nh.get(e.get("id") or "") or nh.get(e.get("svg_id") or "")
                        if pos:
                            truth.append(((pos[0] + tx) / 10 * sx,
                                          (pos[1] + ty) / 10 * sx))
                base = match(heads, truth, gap)
                # rejected CCs on the same mask
                m = build_mask(dark, gap)
                kw = max(2, int(round(0.55 * gap)))
                m = cv2.morphologyEx(m, cv2.MORPH_OPEN,
                                     cv2.getStructuringElement(cv2.MORPH_RECT, (kw, 1)))
                m = cv2.dilate(m, np.ones((3, 3), np.uint8))
                n, _l, stats, _c = cv2.connectedComponentsWithStats(m, 8)
                rej = []
                for i in range(1, n):
                    x, y, w, h, area = stats[i]
                    w, h = int(w), int(h)
                    if (w > W_MAX * gap or h > W_MAX * gap
                            or w < W_MIN * gap or h < W_MIN * gap):
                        rej.append((x, y, w, h))
                win_w, win_h = int(round(1.1 * gap)), int(round(1.0 * gap))
                step = max(2, int(round(0.5 * gap)))
                wins = []
                for (x, y, w, h) in rej:
                    for dy in range(0, max(1, h - win_h + 1), step):
                        for dx in range(0, max(1, w - win_w + 1), step):
                            wins.append((x + dx, y + dy))
                if not wins:
                    R["tp"] += base["tp"]; R["fp"] += base["fp"]; R["fn"] += base["fn"]
                    continue
                crops = []
                for (wx, wy) in wins:
                    half = int(round(3.0 * gap))
                    x0c, y0c = int(wx - half), int(wy - half)
                    c = np.full((2 * half, 2 * half), 255, np.uint8)
                    ix0, iy0 = max(0, x0c), max(0, y0c)
                    ix1, iy1 = min(gray.shape[1], x0c + 2 * half), min(gray.shape[0], y0c + 2 * half)
                    if ix1 > ix0 and iy1 > iy0:
                        c[iy0 - y0c:iy0 - y0c + (iy1 - iy0),
                          ix0 - x0c:ix0 - x0c + (ix1 - ix0)] = gray[iy0:iy1, ix0:ix1]
                    crops.append(cv2.resize(c, (64, 64), interpolation=cv2.INTER_AREA))
                X = torch.from_numpy(np.stack(crops)[:, None]).float() / 255
                with torch.no_grad():
                    lg = models["common"][0](X, X.clone(), torch.zeros((len(X), 5)))
                kind = torch.softmax(lg["kind"], -1).numpy()
                new = []
                for k, (wx, wy) in enumerate(wins):
                    if kind[k, 1] >= THR:
                        new.append({"x": int(wx), "y": int(wy),
                                    "w": win_w, "h": win_h})
                # NMS vs heads
                have = [(h["x"], h["y"]) for h in heads]
                for d in new:
                    if all(((d["x"] - hx) ** 2 + (d["y"] - hy) ** 2)
                           > (0.8 * gap) ** 2 for hx, hy in have):
                        heads.append(d)
                        have.append((d["x"], d["y"]))
                r = match(heads, truth, gap)
                R["tp"] += r["tp"]; R["fp"] += r["fp"]; R["fn"] += r["fn"]
                R["added"] += len(new)
            print(f"[thr {THR}] {sid[:8]} base tp={base['tp']} fp={base['fp']} "
                  f"-> tp={r['tp']} fp={r['fp']} (added {len(new)})", flush=True)
        print(f"[thr {THR}] TOTAL P {R['tp']/max(1,R['tp']+R['fp']):.4f} "
              f"R {R['tp']/max(1,R['tp']+R['fn']):.4f}", flush=True)
        (TRAIN / "reports" / "det_kindassist.json").write_text(json.dumps(
            {"thr": THR, "tp": R["tp"], "fp": R["fp"], "fn": R["fn"]}, indent=1))


if __name__ == "__main__":
    main()
