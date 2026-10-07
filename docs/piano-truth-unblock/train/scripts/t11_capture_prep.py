#!/usr/bin/env python3
"""T11 — prepare a tiny controlled-capture batch (5-10 pages).

Selects CC0/PD pages from TRAIN renders, builds a print packet (PDF) plus a
registration manifest and a verification procedure. Physical print/scan/photo
capture is NOT performed here; the batch is staged for it.

No TEST material is used.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
CAP = TRAIN / "captures"


def load_split(name):
    raw = json.loads((PILOT / "manifests" / "splits.json").read_text())
    out = list(raw[name])
    del raw
    return out


def main():
    import fitz  # PyMuPDF
    sel = json.loads((PILOT / "manifests" / "selection.json").read_text())
    lic = {s["source_id"]: (s.get("license"), s.get("title")) for s in sel["scores"]}
    cands = [s for s in load_split("train")
             if str(lic.get(s, ("", ""))[0]).lower() in ("publicdomain", "cc-zero", "cc0", "cc0-1.0")]
    ranked = sorted(cands, key=lambda s: hashlib.sha256(f"piano-capture-v1|{s}".encode()).hexdigest())[:8]
    CAP.mkdir(exist_ok=True)
    doc = fitz.open()
    pages = []
    for sid in ranked:
        meta = json.loads((RENDER / sid / "meta.json").read_text())
        png = RENDER / sid / "page-01.png"
        pix = fitz.Pixmap(str(png))
        page = doc.new_page(width=pix.width * 72 / 200, height=pix.height * 72 / 200)
        page.insert_image(page.rect, stream=pix.tobytes("jpg", jpg_quality=85))
        pages.append({"source_id": sid, "title": lic.get(sid, ("", ""))[1],
                      "license": lic.get(sid, ("", ""))[0],
                      "source_sha256": meta["source_sha256"],
                      "render_svg_sha256": meta["svg_sha256"],
                      "page": 1, "print_png": png.name, "print_dpi": 200})
    packet = CAP / "print_packet.pdf"
    doc.save(str(packet))
    (CAP / "capture_manifest.json").write_text(json.dumps({
        "schema": "piano-capture-batch/1", "n_pages": len(pages),
        "packet_pdf": packet.name,
        "packet_sha256": hashlib.sha256(packet.read_bytes()).hexdigest(),
        "status": "STAGED — physical print/scan/photo capture pending; not validation data yet",
        "registration_procedure": "re-render source at capture aspect; estimate homography/warp; "
            "map element table; require >=99% notehead centres within tolerance of ink; "
            "human spot-check >=50 notes over >=10 pages; freeze only then",
        "pages": pages}, indent=1))
    print(f"[t11] staged {len(pages)} pages -> {packet}")


if __name__ == "__main__":
    main()
