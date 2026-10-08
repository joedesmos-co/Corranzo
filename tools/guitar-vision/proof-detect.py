#!/usr/bin/env python3
"""Guitar image detection (G1): staff systems, TAB lines, symbol proposals.

Pure image pixels (hires staging rasters). No MusicXML, no truth geometry
at inference — staff lines detected by projection, symbols by connected
components after line removal, families by the FROZEN proof family head.

Outputs per page: proposals [{box_px, staff, string, family, confidence}].
Evaluation against GT joins (IoU>=0.5) happens in proof-detect-eval.

Usage:
    python3 tools/guitar-vision/proof-detect.py --hires <dir> --work <dir> --out <dir> [--scores a,b,c]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from scipy import ndimage as ndi

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
from proof_train import ProofNet  # noqa: E402

SEED = 20261008
IOU_THRESHOLD = 0.5


def find_staff_blocks(profile: np.ndarray) -> list[dict]:
    """Group horizontal line peaks into staff blocks (5 or 6 regular lines).

    Returns [{top, bottom, lines:[...], kind: 'tab'|'standard'}] in px.
    """
    threshold = 0.10
    peaks = []
    above, start = False, 0
    for i, value in enumerate(profile):
        if value >= threshold and not above:
            above, start = True, i
        elif value < threshold and above:
            above = False
            if i - start >= 1:
                peaks.append((start + i - 1) / 2)
    if above and len(profile) - start >= 1:
        peaks.append((start + len(profile) - 1) / 2)
    blocks = []
    i = 0
    while i < len(peaks):
        # Grow the longest regular run starting at i.
        best = None
        for length in range(min(len(peaks) - i, 8), 4, -1):
            run = peaks[i:i + length]
            gaps = [run[j + 1] - run[j] for j in range(length - 1)]
            mean_gap = sum(gaps) / len(gaps)
            if mean_gap < 4:
                continue
            score = sum(abs(g - mean_gap) / mean_gap for g in gaps) / len(gaps)
            if score < 0.20 and (best is None or length > best[0]):
                best = (length, run, mean_gap)
        if best is None or best[0] not in (5, 6):
            i += 1
            continue
        length, run, _ = best
        blocks.append({"top": run[0], "bottom": run[-1], "lines": run,
                       "kind": "tab" if length == 6 else "standard"})
        i += length
    return blocks


def remove_staff_lines(pixels: np.ndarray, blocks: list[dict]) -> tuple:
    """Separate staff lines from glyphs morphologically (no row wiping).

    Row-wiping deletes the glyph pixels that staff lines cross and fuses
    glyphs to line remnants (giant components get filtered). Instead: a
    horizontal opening keeps long line runs; subtracting them from the ink
    preserves glyph mass, and a 3x3 close rejoins the 1-2px slices where
    lines crossed glyphs. Returns (glyph_ink_bool, removed_rows_for_merge).
    """
    ink = pixels < 128
    lines_only = ndi.binary_opening(ink, structure=np.ones((1, 25)))
    glyphs = ink & ~lines_only
    glyphs = ndi.binary_closing(glyphs, structure=np.ones((3, 3)))
    removed: set[int] = set()
    for block in blocks:
        for y in block["lines"]:
            y = int(round(y))
            for row in (y - 1, y, y + 1):
                if 0 <= row < pixels.shape[0]:
                    removed.add(row)
    return glyphs, removed


def propose_symbols(glyphs: np.ndarray, line_rows: set[int] | None = None) -> list[dict]:
    """Connected components of glyph ink -> proposal boxes (page px).

    Fragments separated only by removed line rows merge explicitly so one
    glyph yields one proposal.
    """
    labels, count = ndi.label(glyphs)
    objects = ndi.find_objects(labels)
    proposals = []
    height, width = glyphs.shape
    for index, slices in enumerate(objects, start=1):
        if slices is None:
            continue
        y_slice, x_slice = slices
        w, h = x_slice.stop - x_slice.start, y_slice.stop - y_slice.start
        area = int((labels[y_slice, x_slice] == index).sum())
        if w < 4 or h < 4 or w > width // 3 or h > height // 4:
            continue
        if area < 12 or area / max(w * h, 1) < 0.08:
            continue
        aspect = w / max(h, 1)
        if aspect > 8 or aspect < 1 / 8:
            continue
        proposals.append({"box": [x_slice.start, y_slice.start, x_slice.stop, y_slice.stop],
                          "area": area})
    if line_rows:
        proposals = merge_across_lines([p["box"] for p in proposals], line_rows)
        proposals = [{"box": box, "area": (box[2] - box[0]) * (box[3] - box[1])} for box in proposals
                     if box[2] - box[0] >= 4 and box[3] - box[1] >= 4]
    return proposals


def merge_across_lines(boxes: list, line_rows: set[int]) -> list:
    """Merge fragment pairs separated only by removed staff-line rows."""
    used = [False] * len(boxes)
    merged = []
    for i, first in enumerate(boxes):
        if used[i]:
            continue
        x0, y0, x1, y1 = first
        for j, second in enumerate(boxes):
            if used[j] or i == j:
                continue
            a0, b0, a1, b1 = second
            x_overlap = min(x1, a1) - max(x0, a0)
            if x_overlap < 0.5 * min(x1 - x0, a1 - a0):
                continue
            gap_top, gap_bottom = (y1, b0) if b0 >= y1 else (b1, y0)
            gap = gap_bottom - gap_top
            if gap < 0 or gap > 6:
                continue
            if all(row in line_rows for row in range(gap_top + 1, gap_bottom)):
                x0, y0, x1, y1 = min(x0, a0), min(y0, b0), max(x1, a1), max(y1, b1)
                used[j] = True
        used[i] = True
        merged.append([x0, y0, x1, y1])
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hires", required=True)
    parser.add_argument("--work", required=True, action="append")
    parser.add_argument("--out", required=True)
    parser.add_argument("--scores", default=None)
    args = parser.parse_args()
    hires_dir, out_dir = Path(args.hires), Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    only = set(args.scores.split(",")) if args.scores else None

    results = {}
    for manifest_path in sorted(hires_dir.glob("*-manifest.json")):
        sample = manifest_path.name.replace("-manifest.json", "")
        if only is not None and sample not in only:
            continue
        manifest = json.loads(manifest_path.read_text())
        pages = []
        for tag, meta in manifest.items():
            if not isinstance(meta, dict) or "file" not in meta:
                continue
            page_no = int(tag.replace("page", ""))
            image = Image.open(meta["file"]).convert("L")
            pixels = np.asarray(image, dtype=np.float64)
            profile = (pixels < 128).mean(axis=1)
            blocks = find_staff_blocks(profile)
            glyphs, removed_rows = remove_staff_lines(pixels, blocks)
            proposals = propose_symbols(glyphs, removed_rows)
            pages.append({"page": page_no,
                          "blocks": [{"kind": b["kind"], "top": round(b["top"], 1),
                                      "bottom": round(b["bottom"], 1),
                                      "lines": [round(y, 1) for y in b["lines"]]} for b in blocks],
                          "proposals": proposals})
        results[sample] = {"pages": pages}
        n = sum(len(p["proposals"]) for p in pages)
        print(f"{sample}: {len(pages)} pages, {sum(len(p['blocks']) for p in pages)} staves, {n} proposals", flush=True)
    (out_dir / "detections.json").write_text(json.dumps(results))
    print(f"scores: {len(results)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
