#!/usr/bin/env python3
"""Guitar context crops (G2/G4): staff-aware tall crops for string attribution,
beat-wide crops for rhythm context.

Staff lines are detected FROM THE IMAGE (horizontal projection), never read
from symbolic truth. Training/eval never see SVG geometry.

- string rows (tabdigit): tall crop spanning detected TAB lines -> 64x256.
- rhythm rows (note/rest): wide crop with beat neighbors -> 256x64.
- geometry control labels: nearest-detected-line string (no pixels).

Only frozen TRAIN/validation rows from proof labels. Sealed sets untouched.

Usage:
    python3 tools/guitar-vision/proof-context-crops.py --crops <dir> --hires <dir> --work <v2work+pdmxwork...> --out <dir>
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

TALL = (64, 256)
WIDE = (128, 64)
STRIP_HALF_Y = 130  # vertical half-window (hires px): staff + margin
STRIP_SIDE = (30, 130)  # sample left/right OF the digit, never under it


def find_best_six(profile: np.ndarray) -> list[float] | None:
    """Best regular 6-run among profile peaks (image evidence only).

    Collects all peaks above a low floor, then scores every run of 6
    consecutive peaks by gap regularity. Returns the winning run or None.
    """
    threshold = 0.12
    peaks = []
    above = False
    start = 0
    for i, value in enumerate(profile):
        if value >= threshold and not above:
            above, start = True, i
        elif value < threshold and above:
            above = False
            if i - start >= 1:
                peaks.append((start + i - 1) / 2)
    if above and len(profile) - start >= 1:
        peaks.append((start + len(profile) - 1) / 2)
    if len(peaks) < 6 or len(peaks) > 40:
        return None
    best = None
    for i in range(len(peaks) - 5):
        run = peaks[i:i + 6]
        gaps = [run[j + 1] - run[j] for j in range(5)]
        mean_gap = sum(gaps) / 5
        if mean_gap < 4:
            continue
        score = sum(abs(g - mean_gap) / mean_gap for g in gaps)
        if best is None or score < best[0]:
            best = (score, run, mean_gap)
    if best is None or best[0] > 0.9:
        return None
    return list(best[1])


def find_anchored_comb(profile: np.ndarray, digit_rel: float) -> list[float] | None:
    """Staff comb constrained through the digit (image evidence only).

    For each hypothesis (digit sits on line k with gap g), score the mean
    ink sampled AT the 6 line positions. The digit is printed on its TAB
    line, so the true comb maximizes sampled ink; foreign staves score
    lower because their lines miss the digit. Requires an ink margin over
    the half-gap-shifted runner-up and tight regularity.
    """
    height = len(profile)

    def sampled(lines):
        total, count = 0.0, 0
        for y in lines:
            if 0 <= y < height:
                total += float(np.mean(profile[max(int(y) - 1, 0):int(y) + 2]))
                count += 1
        return total / max(count, 1)

    best = None
    for k in range(1, 7):
        for g in range(8, 61, 2):
            lines = [digit_rel + (i - k) * g for i in range(1, 7)]
            if lines[0] < -g or lines[5] >= height + g:
                continue
            ink = sampled(lines)
            shifted = [y + g / 2 for y in lines]
            margin = ink - sampled(shifted)
            if best is None or ink > best[0]:
                best = (ink, margin, lines)
    if best is None:
        return None
    ink, margin, lines = best
    gaps = [lines[j + 1] - lines[j] for j in range(5)]
    mean_gap = sum(gaps) / 5
    regularity = sum(abs(x - mean_gap) / mean_gap for x in gaps) / 5
    if ink < 0.15 or margin < 0.05 or regularity > 0.20:
        return None
    return lines


def detect_tab_lines(pixels, cx, cy, img_w, img_h):
    """Returns (lines, tier) or (None, None).

    Tier 'exact': 6 observed peaks, digit-anchored (high precision).
    Tier 'anchored': digit-constrained comb search (calibrated on TRAIN).
    """
    x0 = int(max(cx - STRIP_SIDE[1], 0))
    x1 = int(min(cx - STRIP_SIDE[0], img_w))
    x2 = int(max(cx + STRIP_SIDE[0], 0))
    x3 = int(min(cx + STRIP_SIDE[1], img_w))
    y0 = int(max(cy - STRIP_HALF_Y, 0))
    y1 = int(min(cy + STRIP_HALF_Y, img_h))
    if x1 - x0 < 10 or x3 - x2 < 10 or y1 - y0 < 40:
        return None, None
    side = np.concatenate([pixels[y0:y1, x0:x1], pixels[y0:y1, x2:x3]], axis=1)
    profile = (side < 128).mean(axis=1)
    run = find_best_six(profile)
    if run is not None:
        lines = [y + y0 for y in run]
        mean_gap = (lines[-1] - lines[0]) / 5
        if min(abs(line - cy) for line in lines) <= 0.4 * mean_gap:
            return lines, "exact"
    anchored = find_anchored_comb(profile, cy - y0)
    if anchored is None:
        return None, None
    return [y + y0 for y in anchored], "anchored"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--crops", required=True)
    parser.add_argument("--hires", required=True)
    parser.add_argument("--work", required=True, action="append",
                        help="dataset work dir with canonical/joins (repeatable)")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    crops_dir, hires_dir, out_dir = Path(args.crops), Path(args.hires), Path(args.out)
    (out_dir / "tall").mkdir(parents=True, exist_ok=True)
    (out_dir / "wide").mkdir(parents=True, exist_ok=True)
    work_dirs = [Path(w) for w in args.work]

    rows = [json.loads(line) for line in (crops_dir / "labels.jsonl").read_text().splitlines()]
    hires_manifests: dict[str, dict] = {}
    for manifest_path in hires_dir.glob("*-manifest.json"):
        hires_manifests[manifest_path.name.replace("-manifest.json", "")] = json.loads(manifest_path.read_text())
    joins_cache: dict[str, dict] = {}

    def joins_for(sample: str) -> dict | None:
        if sample not in joins_cache:
            for root in work_dirs:
                path = root / sample / "joins.json"
                if path.exists():
                    joins_cache[sample] = json.loads(path.read_text())
                    break
            else:
                joins_cache[sample] = None
        return joins_cache[sample]

    page_cache: dict[str, dict] = {}

    def page_image(sample: str, page_no: int):
        key = f"{sample}-p{page_no}"
        if key not in page_cache:
            meta = hires_manifests[sample][f"page{page_no}"]
            image = Image.open(meta["file"]).convert("L")
            page_cache[key] = {
                "image": image, "pixels": np.asarray(image, dtype=np.float64),
                "fx": meta["cssWidth"] / meta["viewBox"][0],
                "fy": meta["height"] / meta["viewBox"][1],
            }
        return page_cache[key]

    tall_rows, wide_rows, quarantined = [], [], []
    detected_ok, detected_total = 0, 0
    for row in rows:
        sample = row["score"]
        joins = joins_for(sample)
        if joins is None:
            quarantined.append({"id": row["file"], "reason": "no-joins"})
            continue
        join = joins["joins"].get(row["stamped"])
        if join is None or not join.get("boxes"):
            quarantined.append({"id": row["file"], "reason": "no-box"})
            continue
        try:
            page = page_image(sample, join.get("page") or 1)
        except (KeyError, FileNotFoundError):
            quarantined.append({"id": row["file"], "reason": "no-hires"})
            continue
        boxes = join["boxes"]
        x0 = min(b[0] for b in boxes)
        y0 = min(b[1] for b in boxes)
        x1 = max(b[2] for b in boxes)
        y1 = max(b[3] for b in boxes)
        cx = (x0 + x1) / 2
        image, pixels = page["image"], page["pixels"]
        if row["family"] == "tabdigit":
            detected_total += 1
            cx_px, cy_px = cx * page["fx"], ((y0 + y1) / 2) * page["fy"]
            detected, tier = detect_tab_lines(pixels, cx_px, cy_px, image.width, image.height)
            geo_string, line_gap = None, None
            if detected is not None:
                # geoString recorded for exact (0.97) and anchored (0.79)
                # tiers alike; the decoder weighs agreement by tier. Only
                # exact warps framing (anchored lines would mis-slot digits).
                detected_ok += 1
                lines = detected
                digit_y = cy_px
                geo_string = min(range(6), key=lambda i: abs(lines[i] - digit_y)) + 1
                line_gap = round(lines[1] - lines[0], 2) if len(lines) == 6 else None
                if tier == "exact":
                    # Line-normalized framing: warp so detected lines land at
                    # canonical slots (image evidence only). The digit then sits
                    # in one of 6 fixed slots; the CNN refines, geometry guides.
                    top = max(int(lines[0] - 30), 0)
                    bottom = min(int(lines[5] + 30), image.height)
                    warped = True
                else:
                    # Anchored lines are not trusted for framing (0.79): fall
                    # back to the box-relative window, keep the geo label.
                    box_h = y1 - y0
                    half_h = max(160.0, box_h * 1.1) * page["fy"]
                    top = max(int(cy_px - half_h), 0)
                    bottom = min(int(cy_px + half_h), image.height)
                    warped = False
            else:
                tier = None
                # Fallback: box-relative window (digit plus staff at any size).
                box_h = y1 - y0
                half_h = max(160.0, box_h * 1.1) * page["fy"]
                top = max(int(cy_px - half_h), 0)
                bottom = min(int(cy_px + half_h), image.height)
            left = max(int(cx_px - max(45 * page["fx"], (x1 - x0) * page["fx"] * 0.7)), 0)
            right = min(int(cx_px + max(45 * page["fx"], (x1 - x0) * page["fx"] * 0.7)), image.width)
            crop = image.crop((left, top, right, bottom)).resize(TALL, Image.BILINEAR)
            name = f"{row['split']}-{sample}-{row['stamped'].split('-n')[-1]}.png"
            crop.save(out_dir / "tall" / name)
            warped = tier == 'exact'
            tall_rows.append({**row, "file": name,
                              "geoString": geo_string,
                              "lineGap": line_gap,
                              "warped": warped, "warpTier": tier})
        else:
            cy = (y0 + y1) / 2
            left = max(int((cx - 80) * page["fx"]), 0)
            right = min(int((cx + 80) * page["fx"]), image.width)
            top = max(int((cy - 28) * page["fy"]), 0)
            bottom = min(int((cy + 28) * page["fy"]), image.height)
            crop = image.crop((left, top, right, bottom)).resize(WIDE, Image.BILINEAR)
            name = f"{row['split']}-{sample}-{row['stamped'].split('-n')[-1]}.png"
            crop.save(out_dir / "wide" / name)
            wide_rows.append({**row, "file": name})

    with open(out_dir / "tall-labels.jsonl", "w") as handle:
        for row in tall_rows:
            handle.write(json.dumps(row) + "\n")
    with open(out_dir / "wide-labels.jsonl", "w") as handle:
        for row in wide_rows:
            handle.write(json.dumps(row) + "\n")
    summary = {"tall": len(tall_rows), "wide": len(wide_rows),
               "quarantined": len(quarantined),
               "lineDetectionRate": detected_ok / max(detected_total, 1)}
    reasons: dict[str, int] = {}
    for entry in quarantined:
        reasons[entry["reason"]] = reasons.get(entry["reason"], 0) + 1
    summary["quarantineReasons"] = reasons
    (out_dir / "context-summary.json").write_text(json.dumps(summary, indent=1))
    (out_dir / "context-quarantined.json").write_text(json.dumps(quarantined[:200], indent=1))
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
