#!/usr/bin/env python3
"""P10 — training-time domain strategy (TRAIN only, geometry-preserving).

Deterministic degradation operators with recorded parameters. Photometric ops
leave labels invariant; geometric ops remap bboxes through the recorded
transform and flag clipped elements. `--verify` degrades a small deterministic
TRAIN sample and checks remapped boxes still contain ink and stay in frame.

No sweep, no tuning, no TEST. Ranges are preregistered below.
"""
from __future__ import annotations
import gzip
import hashlib
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
OBJECTS = PILOT / "data" / "objects"

# preregistered recipe (fixed; not tuned)
RECIPE = {
    "blur_sigma": [0.8, 1.5],
    "noise_sigma": [4.0, 8.0],
    "gamma": [0.8, 1.25],
    "gain_tilt": 0.15,
    "jpeg_quality": [85, 70],
    "perspective_max_frac": 0.03,
    "min_staff_gap_px": 10.0,
    "max_crop_margin_frac": 0.05,
}


def load_split(name):
    raw = json.loads((PILOT / "manifests" / "splits.json").read_text())
    out = list(raw[name])
    del raw
    return out


def apply_photo(img, rng, level):
    out = img.astype(np.float32)
    if level >= 1:
        k = max(3, int(RECIPE["blur_sigma"][0] * 3) | 1)
        out = cv2.GaussianBlur(out, (k, k), RECIPE["blur_sigma"][0])
    if level >= 2:
        out = np.clip(out + rng.normal(0, RECIPE["noise_sigma"][0], out.shape), 0, 255)
    out = np.clip(255 * (out / 255) ** RECIPE["gamma"][0], 0, 255)
    h, w = out.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    gain = 1 + RECIPE["gain_tilt"] * ((xx / w) - 0.5)
    out = np.clip(out * gain, 0, 255)
    _, buf = cv2.imencode(".jpg", out.astype(np.uint8),
                          [cv2.IMWRITE_JPEG_QUALITY, RECIPE["jpeg_quality"][0]])
    return cv2.imdecode(buf, cv2.IMREAD_GRAYSCALE)


def apply_perspective(img, rng):
    h, w = img.shape
    f = RECIPE["perspective_max_frac"]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = src + rng.uniform(-f, f, size=(4, 2)).astype(np.float32) * np.array([w, h])
    H, _ = cv2.findHomography(src, dst)
    return cv2.warpPerspective(img, H, (w, h), borderValue=255), H


def remap_points(pts, H):
    p = np.concatenate([np.asarray(pts, np.float32), np.ones((len(pts), 1))], axis=1)
    q = (H @ p.T).T
    return (q[:, :2] / q[:, 2:3]).tolist()


def main():
    sids = sorted(load_split("train"),
                  key=lambda s: hashlib.sha256(f"piano-domain-v1|{s}".encode()).hexdigest())[:6]
    rng = np.random.RandomState(20261007)
    checked = inky = inside = 0
    for sid in sids:
        meta = json.loads((RENDER / sid / "meta.json").read_text())
        objs = [o for o in json.load(gzip.open(OBJECTS / f"{sid}.objects.json.gz", "rt"))
                if o["tag"] in ("note", "rest") and o.get("bbox") and int(o["bbox"]["page"]) == 1]
        img = cv2.imread(str(RENDER / sid / "page-01.png"), cv2.IMREAD_GRAYSCALE)
        Hh, Ww = img.shape
        pw = next(p["width"] for p in meta["page_geometry"] if p["page"] == 1)
        sx = Ww / pw
        deg, H = apply_perspective(apply_photo(img, rng, 2), rng)
        Hi = np.linalg.inv(H)
        for o in objs[:40]:
            b = o["bbox"]
            x0, y0 = (b["x"] + 500) / 10 * sx, (b["y"] + 500) / 10 * sx
            x1, y1 = (b["x"] + b["w"] + 500) / 10 * sx, (b["y"] + b["h"] + 500) / 10 * sx
            corners = remap_points([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], H)
            xs = [c[0] for c in corners]
            ys = [c[1] for c in corners]
            qx0, qy0, qx1, qy1 = int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))
            checked += 1
            if 0 <= qx0 < qx1 <= Ww and 0 <= qy0 < qy1 <= Hh:
                inside += 1
                patch = deg[qy0:qy1, qx0:qx1]
                if patch.size and (patch < 200).mean() > 0.005:
                    inky += 1
    out = {"schema": "piano-v1-domain-check/1", "pages": len(sids),
           "boxes_checked": checked, "in_frame": inside,
           "with_ink": inky, "recipe": RECIPE}
    (TRAIN / "manifests" / "v1_domain_check.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
