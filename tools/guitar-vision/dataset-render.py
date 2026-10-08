#!/usr/bin/env python3
"""Guitar Dataset v2 — Stage 2: render + identity joins + quality (D6/D8).

For every PASS ingest record: Verovio SVG + PNG render of the stamped
MusicXML, exact ID joins (no order fallback), per-page/per-object quality
metadata, and render determinism (render twice, hashes must match).

Writes into the score work dir: render.svg, page-*.png, joins.json,
quality.json. A score whose identity or render fails is flipped to
QUARANTINED here (never silently dropped).

Usage:
    python3 tools/guitar-vision/dataset-render.py --work <dir>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import verovio
from PIL import Image

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parents[1]
sys.path.insert(0, str(TOOLS))
from render_corpus import (  # noqa: E402
    _has_tab_text,
    _iter_group_elements,
    _tab_digit_boxes,
    _use_boxes,
    apply_transform,
    content_transform,
    glyph_outline_bounds,
)
from render_identity import VEROVIO_OPTIONS  # noqa: E402

RENDER_VERSION = "guitar-dataset-render/1.0"


def sha_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


STABLE_ID_PATTERN = re.compile(r"^.+-n\d+$")

def svg_structure_key(svg: str) -> str:
    """Determinism key: the render with every identifier blanked.

    Verovio mints random ids per render (root prefix, structural group ids,
    milestone class tokens, tie classes). Geometry, glyphs, transforms and
    text are untouched, so two renders with equal keys are geometrically
    identical. Stable source IDs are verified separately by exact joins —
    this key only answers "did layout change", never "is identity intact".
    """
    key = re.sub(r'\sid="[^"]*"', ' id="#"', svg)
    key = re.sub(r'class="[^"]*"', 'class=""', key)
    key = re.sub(r"url\(#[^)]*\)", "url(#)", key)
    key = re.sub(r'href="#[^\"]*"', 'href="#"', key)
    key = re.sub(r"#[A-Za-z0-9_-]+(?=[\s,{:;.])", "#", key)
    return key


def render_score(stamped_path: Path, out_dir: Path) -> dict:
    """Render every page (SVG + PNG), twice for determinism."""
    xml = stamped_path.read_text(encoding="utf-8")
    probe = verovio.toolkit()
    probe.setOptions(dict(VEROVIO_OPTIONS))
    if not probe.loadData(xml):
        return {"ok": False, "error": "verovio refused stamped musicxml"}
    try:
        page_count = probe.getPageCount()
    except Exception as error:  # noqa: BLE001
        return {"ok": False, "error": f"page count failed: {error}"}
    pages = []
    for page in range(1, page_count + 1):
        svgs = []
        for _ in range(2):
            toolkit = verovio.toolkit()
            toolkit.setOptions(dict(VEROVIO_OPTIONS))
            toolkit.loadData(xml)
            svgs.append(toolkit.renderToSVG(page))
        canon = [svg_structure_key(svg) for svg in svgs]
        if hashlib.sha256(canon[0].encode()).hexdigest() != hashlib.sha256(canon[1].encode()).hexdigest():
            return {"ok": False, "error": f"page {page} differs geometrically across two passes"}
        svg = svgs[0]
        tag = "" if page == 1 else f"-p{page}"
        (out_dir / f"render{tag}.svg").write_text(svg, encoding="utf-8")

        # Rasterize full-page PNGs at two widths (vector + raster provenance,
        # D8 quality metrics and the D18 tiny-sample path).
        raster = subprocess.run(
            ["node", str(TOOLS / "rasterize-svg.mjs"), "--in", str(out_dir / f"render{tag}.svg"),
             "--out", str(out_dir / f"page{tag}"), "--widths", "1050,2100"],
            capture_output=True, text=True, cwd=str(ROOT),
        )
        if raster.returncode != 0:
            return {"ok": False, "error": f"rasterizer failed p{page}: {raster.stderr[-500:]}"}
        qualities = {}
        for width in (1050, 2100):
            png = out_dir / f"page{tag}-w{width}.png"
            if not png.exists():
                return {"ok": False, "error": f"rasterizer produced no {png.name}"}
            qualities[str(width)] = png_quality(png)
        pages.append({"page": page, "svgBytes": len(svg), "pngQuality": qualities})
    return {"ok": True, "pages": pages}


def png_quality(png_path: Path) -> dict:
    """Quality metadata from a raster page (D8)."""
    image = Image.open(png_path).convert("L")
    pixels = np.asarray(image, dtype=np.float64)
    contrast = float(pixels.max() - pixels.min())
    mean = float(pixels.mean())
    # Laplacian variance (blur estimate), normalized by contrast scale.
    laplacian = (
        pixels[:-2, 1:-1] + pixels[2:, 1:-1] + pixels[1:-1, :-2] + pixels[1:-1, 2:] - 4 * pixels[1:-1, 1:-1]
    )
    blur = float(laplacian.var())
    # Ink coverage as a crop-completeness proxy (blank page ~ 0 ink).
    ink = float((pixels < 128).mean())
    return {
        "width": image.width,
        "height": image.height,
        "contrast": round(contrast, 2),
        "meanLuma": round(mean, 2),
        "blurVariance": round(blur, 2),
        "inkCoverage": round(ink, 5),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", required=True)
    args = parser.parse_args()
    work = Path(args.work)
    records_path = work / "ingest-records.json"
    records = json.loads(records_path.read_text(encoding="utf-8"))["records"]
    verdicts = []
    for record in records:
        if record["status"] != "PASS":
            continue
        score_dir = work / record["candidateId"]
        stamped = score_dir / "stamped.musicxml"
        result = render_score(stamped, score_dir)
        if not result["ok"]:
            record["status"] = "QUARANTINED:render-failure"
            record["quarantineReason"] = result["error"]
            verdicts.append(f"{record['status']} {record['candidateId']} — {result['error']}")
            continue
        # Exact ID joins by string equality across ALL pages.
        from render_identity import identity_join

        source_ids = [f"{record['candidateId']}-n{i:03d}" for i in range(1, record["stampedIds"] + 1)]
        toolkit = verovio.toolkit()
        toolkit.setOptions(dict(VEROVIO_OPTIONS))
        toolkit.loadData(stamped.read_text(encoding="utf-8"))
        all_joins = {}
        page_joins = []
        for page_info in result["pages"]:
            tag = "" if page_info["page"] == 1 else f"-p{page_info['page']}"
            svg = (score_dir / f"render{tag}.svg").read_text(encoding="utf-8")
            joins = identity_join(svg, source_ids, toolkit)
            page_joins.append({"page": page_info["page"], **{k: v for k, v in joins.items() if k != "joins"}})
            for sid, join in joins["joins"].items():
                if sid in all_joins:
                    all_joins[sid]["pages"] = sorted(set(all_joins[sid].get("pages", []) + [page_info["page"]]))
                else:
                    all_joins[sid] = {**join, "pages": [page_info["page"]]}
        (score_dir / "joins.json").write_text(json.dumps({"pages": page_joins, "joins": all_joins}, indent=1), encoding="utf-8")
        joined = len(all_joins)
        unmatched_source = sorted(set(source_ids) - set(all_joins))
        identity_rate = joined / len(source_ids) if source_ids else None
        # D9 glyph-scale evidence: joined box heights by kind (page units).
        tab_heights = []
        head_heights = []
        for join in all_joins.values():
            for box in join["boxes"]:
                height = box[3] - box[1]
                if "tab-text" in join["children"]:
                    tab_heights.append(round(height, 2))
                if "notehead" in join["children"]:
                    head_heights.append(round(height, 2))
        record["glyphScale"] = {
            "tabDigitHeights": tab_heights,
            "noteheadHeights": head_heights,
            "units": "verovio-page-units",
        }
        if identity_rate != 1.0 or unmatched_source:
            record["status"] = "QUARANTINED:source-id-failure"
            record["quarantineReason"] = (
                f"identityRate={identity_rate} unmatchedSource={len(unmatched_source)}"
            )
            verdicts.append(f"{record['status']} {record['candidateId']} — {record['quarantineReason']}")
            continue
        png_meta = {}
        pages_meta = []
        for page_info in result["pages"]:
            tag = "" if page_info["page"] == 1 else "-p" + str(page_info["page"])
            svg_path = score_dir / ("render" + tag + ".svg")
            # Stable hash covers the structure key (geometry), not the random
            # per-render ids: regenerating the dataset reproduces this hash.
            # The raw SVG keeps full fidelity for rasterization and joins.
            structure_hash = hashlib.sha256(svg_structure_key(svg_path.read_text(encoding="utf-8")).encode()).hexdigest()
            pages_meta.append({
                "page": page_info["page"],
                "svg": "render" + tag + ".svg",
                "svgHash": structure_hash,
                "svgBytes": page_info["svgBytes"],
            })
            for width in ("1050", "2100"):
                name = "page" + tag + "-w" + width + ".png"
                png_meta[name] = {**page_info["pngQuality"][width], "sha256": sha_file(score_dir / name), "provenance": "raster-export"}
        record["render"] = {
            "version": RENDER_VERSION,
            "verovio": "6.3.0",
            "options": VEROVIO_OPTIONS,
            "pages": pages_meta,
            "deterministic": True,
            "identityRate": identity_rate,
            "joinedGroups": joined,
            "provenance": "vector",
            "png": png_meta,
        }
        verdicts.append(f"PASS {record['candidateId']} pages={len(result['pages'])} joins={joined}/{len(source_ids)}")
    records_path.write_text(json.dumps({"version": "guitar-dataset-ingest/1.0", "records": records}, indent=1), encoding="utf-8")
    print("\n".join(verdicts))
    passed = sum(1 for r in records if r["status"] == "PASS")
    print(f"PASS {passed}/{len(records)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
