#!/usr/bin/env python3
"""Clean input interface for Corranzo OMR (research prototype).

Routes PDFs to the PDF.js vector extractor and images/scans to the separate
image path. Input quality is assessed independently from recognition
confidence: a readable image the recognizer cannot transcribe is reported
as such, never as a successful transcription.

Vector PDF path requires a Node environment with pdfjs-dist 5.4.x and the
scripts/pdfjs_vector_omr.mjs wrapper. No AGPL dependency is used.
"""
from __future__ import annotations
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
NODE_SCRIPT = HERE / "pdfjs_vector_omr.mjs"


def assess_image(path: Path) -> dict:
    """Image-quality metrics only; no musical recognition."""
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        return {"quality": "unreadable", "reason": "cannot decode image"}
    h, w = img.shape
    lap = float(cv2.Laplacian(img, cv2.CV_64F).var())
    contrast = float(img.std())
    # staff-line count by row projection (5-line groups)
    dark = (img < 160).astype(np.uint8)
    row = dark.sum(axis=1) / max(1, w)
    lines = int((row > 0.4).sum())
    reasons = []
    if w < 800 or h < 800:
        reasons.append(f"low resolution {w}x{h}")
    if lap < 25:
        reasons.append(f"blurry (laplacian {lap:.1f})")
    if contrast < 18:
        reasons.append(f"low contrast (std {contrast:.1f})")
    if lines < 5:
        reasons.append(f"staff lines not detected (rows {lines})")
    return {"quality": "unreadable" if reasons else "readable",
            "width": w, "height": h, "laplacian": round(lap, 1),
            "contrast": round(contrast, 1), "staff_rows": lines,
            "reasons": reasons}


def recognize_pdf(path: Path, node_script: Path | None = None) -> dict:
    """Run the PDF.js vector extractor; fall back to the image route."""
    script = node_script or NODE_SCRIPT
    try:
        out = subprocess.run(["node", str(script), str(path)],
                             capture_output=True, text=True, timeout=300)
        if out.returncode != 0:
            raise RuntimeError(out.stderr[-300:])
        ir = json.loads(out.stdout)
    except Exception as exc:  # noqa: BLE001
        return {"route": "image", "quality": "unknown",
                "recognition_confidence": None,
                "limitation": f"vector extractor unavailable: {exc}"}
    if ir.get("route") != "vector" or not ir.get("notes"):
        return {"route": "image", "quality": "readable",
                "recognition_confidence": None,
                "limitation": "no vector notation glyphs; image OMR required",
                "vector_error": ir.get("error")}
    return {"route": "vector", "quality": "readable",
            "recognition_confidence": 0.9,
            "notes": len(ir["notes"]), "rests": len(ir["rests"]),
            "meter": ir.get("meter"), "key": ir.get("key"),
            "unresolved": len(ir.get("unresolved", [])),
            "ir": ir}


def recognize(path: Path) -> dict:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return recognize_pdf(path)
    if suffix in (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"):
        q = assess_image(path)
        return {"route": "image", **q, "recognition_confidence": None,
                "limitation": "raster image OMR is a separate, weaker path; "
                              "no transcription is claimed for this input"}
    return {"route": "unknown", "quality": "unreadable",
            "limitation": f"unsupported input type {suffix}"}


if __name__ == "__main__":
    result = recognize(Path(sys.argv[1]))
    ir = result.pop("ir", None)
    print(json.dumps({k: v for k, v in result.items()}, indent=1))
    if ir:
        print(json.dumps({"ir_note_count": len(ir["notes"]),
                          "ir_measure_count": len({n["measure"] for n in ir["notes"]})}))
