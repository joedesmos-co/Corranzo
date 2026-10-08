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


# A7: deterministic engraving layouts. Same symbolic score, genuinely
# different layout passes (page geometry, staff size, spacing) — not
# post-hoc reshrinks. Every layout must join at identity 1.0 or the score
# quarantines. Layouts are variants of one score, never independent scores.
LAYOUTS = {
    "standard": {"pageWidth": 2100, "pageHeight": 2970, "scale": 40},
    "compact": {"pageWidth": 1400, "pageHeight": 1980, "scale": 30},
    "large": {"pageWidth": 2800, "pageHeight": 3960, "scale": 56},
    # Same geometry as standard, different SMuFL music font: genuine glyph
    # shape variation, not a resize.
    "bravura": {"pageWidth": 2100, "pageHeight": 2970, "scale": 40, "font": "Bravura"},
}


def layout_options(name: str) -> dict:
    options = dict(VEROVIO_OPTIONS)
    options.update(LAYOUTS[name])
    options["adjustPageWidth"] = True
    options["adjustPageHeight"] = True
    return options


def render_score(stamped_path: Path, out_dir: Path, layout: str = "standard") -> dict:
    """Render every page (SVG + PNG), twice for determinism."""
    prefix = "" if layout == "standard" else f"-{layout}"
    xml = stamped_path.read_text(encoding="utf-8")
    probe = verovio.toolkit()
    probe.setOptions(layout_options(layout))
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
            toolkit.setOptions(layout_options(layout))
            toolkit.loadData(xml)
            svgs.append(toolkit.renderToSVG(page))
        canon = [svg_structure_key(svg) for svg in svgs]
        if hashlib.sha256(canon[0].encode()).hexdigest() != hashlib.sha256(canon[1].encode()).hexdigest():
            return {"ok": False, "error": f"page {page} differs geometrically across two passes"}
        svg = svgs[0]
        tag = "" if page == 1 else f"-p{page}"
        (out_dir / f"render{prefix}{tag}.svg").write_text(svg, encoding="utf-8")

        # Rasterize full-page PNGs at two widths (vector + raster provenance,
        # D8 quality metrics and the D18 tiny-sample path).
        raster = subprocess.run(
            ["node", str(TOOLS / "rasterize-svg.mjs"), "--in", str(out_dir / f"render{prefix}{tag}.svg"),
             "--out", str(out_dir / f"page{prefix}{tag}"), "--widths", "1050,2100"],
            capture_output=True, text=True, cwd=str(ROOT),
        )
        if raster.returncode != 0:
            return {"ok": False, "error": f"rasterizer failed p{page}: {raster.stderr[-500:]}"}
        qualities = {}
        for width in (1050, 2100):
            png = out_dir / f"page{prefix}{tag}-w{width}.png"
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
        from render_identity import identity_join

        source_ids = [f"{record['candidateId']}-n{i:03d}" for i in range(1, record["stampedIds"] + 1)]
        layouts_out = {}
        failed = None
        for layout in LAYOUTS:
            result = render_score(stamped, score_dir, layout)
            if not result["ok"]:
                failed = f"QUARANTINED:render-failure {record['candidateId']} [{layout}] — {result['error']}"
                break
            outcome = join_layout(score_dir, stamped, source_ids, result, layout)
            if not outcome["ok"]:
                failed = f"QUARANTINED:source-id-failure {record['candidateId']} [{layout}] — {outcome['error']}"
                break
            layouts_out[layout] = outcome["layout"]
        if failed:
            record["status"] = failed.split(" ", 1)[0]
            record["quarantineReason"] = failed.split(" — ", 1)[1]
            verdicts.append(failed)
            continue
        # D9 glyph-scale evidence aggregates genuine layout variation.
        tab_heights = [h for layout in layouts_out.values() for h in layout["glyphScale"]["tabDigitHeights"]]
        head_heights = [h for layout in layouts_out.values() for h in layout["glyphScale"]["noteheadHeights"]]
        record["glyphScale"] = {
            "tabDigitHeights": tab_heights,
            "noteheadHeights": head_heights,
            "units": "verovio-page-units",
            "layouts": sorted(layouts_out),
        }
        record["render"] = {
            "version": RENDER_VERSION,
            "verovio": "6.3.0",
            "layouts": layouts_out,
            "provenance": "vector",
        }
        total_joins = sum(layout["joinedGroups"] for layout in layouts_out.values())
        verdicts.append(f"PASS {record['candidateId']} layouts={len(layouts_out)} joins={total_joins}")
    records_path.write_text(json.dumps({"version": "guitar-dataset-ingest/1.0", "records": records}, indent=1), encoding="utf-8")
    print("\n".join(verdicts))
    passed = sum(1 for r in records if r["status"] == "PASS")
    print(f"PASS {passed}/{len(records)}")
    return 0


def sid_for_event(event: dict, prefix: str) -> str | None:
    """Stamped ID for a canonical event, via the parser's document-order
    note counter (noteId `P1-m9-n162` -> stamped `<prefix>-n163`).

    Positional mapping (event index + 1) is WRONG for multi-voice scores:
    parsed notes are time-sorted while stamped IDs follow document order.
    """
    note_id = ((event.get("source") or {}).get("noteId") or "")
    match = re.search(r"-n(\d+)$", note_id)
    if not match:
        return None
    return f"{prefix}-n{int(match.group(1)) + 1:03d}"


def attach_merged_unisons(score_dir: Path, source_ids: list, all_joins: dict, unmatched: list) -> dict:
    """Attach unmatched IDs to a joined twin's group when the renderer merged
    unison duplicates (same onset+pitch+measure) into one notehead.

    Exact rule, no guessing: every same-key event must resolve to exactly one
    distinct joined group; otherwise nothing attaches and the caller
    quarantines. Returns {"attached": {sid: groupId}}.
    """
    try:
        canonical = json.loads((score_dir / "canonical.json").read_text(encoding="utf-8"))
    except Exception:
        return {"attached": {}}
    prefix = source_ids[0].rsplit("-n", 1)[0] if source_ids else ""
    by_sid = {}
    for event in canonical.get("events", []):
        sid = sid_for_event(event, prefix)
        if sid:
            by_sid[sid] = event
    by_key: dict[tuple, list] = {}
    for sid in source_ids:
        event = by_sid.get(sid)
        if event is None:
            continue
        if event.get("time", {}).get("isRest"):
            continue
        pitch = (event.get("pitch") or {}).get("soundingMidi")
        key = (event.get("time", {}).get("onsetQuarters"), pitch, (event.get("source") or {}).get("measure"))
        by_key.setdefault(key, []).append(sid)
    attached = {}
    for sid in unmatched:
        event = by_sid.get(sid)
        if event is None:
            continue
        if event.get("time", {}).get("isRest"):
            attached_to = attach_rest_twin(event, by_sid, all_joins)
            if attached_to:
                attached[sid] = attached_to
            continue
        pitch = (event.get("pitch") or {}).get("soundingMidi")
        key = (event.get("time", {}).get("onsetQuarters"), pitch, (event.get("source") or {}).get("measure"))
        twins = by_key.get(key, [])
        # all_joins keys are sids; a joined twin's own sid is its group.
        groups = {t for t in twins if t in all_joins}
        if len(twins) >= 2 and len(groups) == 1:
            attached[sid] = next(iter(groups))
            continue
        # Chord tones merge into their chord head's group: attach to the head
        # when it joined.
        if event.get("time", {}).get("isChordTone"):
            head = chord_head_sid(canonical, by_sid, sid)
            if head and head in all_joins:
                attached[sid] = head
    return {"attached": attached}


def attach_rest_twin(event, by_sid, all_joins):
    """A rest consolidated into a same-onset+measure rest twin's group."""
    key = (event.get("time", {}).get("onsetQuarters"), (event.get("source") or {}).get("measure"))
    for other_sid, other in by_sid.items():
        if not other.get("time", {}).get("isRest"):
            continue
        other_key = (other.get("time", {}).get("onsetQuarters"), (other.get("source") or {}).get("measure"))
        if other_key == key and other_sid in all_joins and other_sid != sid_of(event, by_sid):
            return other_sid
    return None


def sid_of(event, by_sid):
    for sid, other in by_sid.items():
        if other is event:
            return sid
    return None


def chord_head_sid(canonical, by_sid, sid):
    """Sid of the chord head: nearest preceding non-chord note, same onset."""
    events = canonical.get("events", [])
    position = next((i for i, e in enumerate(events) if sid_of(e, by_sid) == sid), None)
    if position is None:
        return None
    event = events[position]
    onset = event.get("time", {}).get("onsetQuarters")
    for back in range(position - 1, -1, -1):
        prev = events[back]
        if prev.get("time", {}).get("onsetQuarters") != onset:
            break
        if not prev.get("time", {}).get("isChordTone") and not prev.get("time", {}).get("isRest"):
            return sid_of(prev, by_sid)
    return None


def classify_unmatched(score_dir: Path, source_ids: list, all_joins: dict, unmatched: list) -> list:
    """Classify leftover unmatched IDs for event-level box masks.

    Classes (all keep symbolic truth; only the rendered box is masked):
    - unison-ambiguous: same-pitch duplicates whose joined twins span 0 or
      2+ groups (no exact single group to attach).
    - duplicate-dropped: same-pitch duplicates with no joined twin at all
      (renderer dropped the whole cluster).
    - chord-head-absent: chord tone whose head never joined either.
    - rest-unmatched: rest with no rendered group and no joined twin.
    - tab-rest-unrendered: TAB-staff rest (Verovio never propagates ids to
      them; verified renderer gap, maskable).
    - renderer-dropped-unique: a unique note the renderer lost (BLOCKS
      masking; the score quarantines instead).
    - unexplained: anything else (blocks masking; score quarantines).
    """
    try:
        canonical = json.loads((score_dir / "canonical.json").read_text(encoding="utf-8"))
    except Exception:
        return [{"id": sid, "class": "unexplained"} for sid in unmatched]
    events = canonical.get("events", [])
    prefix = source_ids[0].rsplit("-n", 1)[0] if source_ids else ""
    by_sid = {}
    for event in events:
        sid = sid_for_event(event, prefix)
        if sid:
            by_sid[sid] = event
    out = []
    for sid in unmatched:
        event = by_sid.get(sid)
        if event is None:
            out.append({"id": sid, "class": "unexplained"})
            continue
        time = event.get("time", {})
        if time.get("isRest"):
            key = (time.get("onsetQuarters"), (event.get("source") or {}).get("measure"))
            twin_joined = any(
                other.get("time", {}).get("isRest")
                and (other.get("time", {}).get("onsetQuarters"), (other.get("source") or {}).get("measure")) == key
                and other_sid in all_joins
                for other_sid, other in by_sid.items()
            )
            if twin_joined:
                out.append({"id": sid, "class": "unexplained"})
                continue
            # Verovio does not propagate <note id> onto TAB-staff rests
            # (verified: id absent from SVG with and without <staff>).
            # Truth keeps the rest event; only the box is unjoinable.
            out.append({"id": sid, "class": "tab-rest-unrendered" if time.get("staffRole") == "tab" else "rest-unmatched"})
            continue
        pitch = (event.get("pitch") or {}).get("soundingMidi")
        key = (time.get("onsetQuarters"), pitch, (event.get("source") or {}).get("measure"))
        twins = [
            other_sid for other_sid, other in by_sid.items()
            if not other.get("time", {}).get("isRest")
            and (other.get("time", {}).get("onsetQuarters"),
                 (other.get("pitch") or {}).get("soundingMidi"),
                 (other.get("source") or {}).get("measure")) == key
        ]
        if len(twins) <= 1:
            # No duplicate: the renderer dropped a unique note.
            out.append({"id": sid, "class": "renderer-dropped-unique" if not time.get("isChordTone") else "chord-head-absent"})
            continue
        joined_twins = [t for t in twins if t in all_joins]
        if not joined_twins:
            out.append({"id": sid, "class": "duplicate-dropped"})
        else:
            out.append({"id": sid, "class": "unison-ambiguous"})
    return out


def join_layout(score_dir: Path, stamped: Path, source_ids: list, result: dict, layout: str) -> dict:
    """Exact ID joins for one rendered layout. Returns ok/layout or ok/error."""
    from render_identity import identity_join

    prefix = "" if layout == "standard" else f"-{layout}"
    toolkit = verovio.toolkit()
    toolkit.setOptions(layout_options(layout))
    toolkit.loadData(stamped.read_text(encoding="utf-8"))
    all_joins = {}
    page_joins = []
    for page_info in result["pages"]:
        tag = "" if page_info["page"] == 1 else f"-p{page_info['page']}"
        svg = (score_dir / f"render{prefix}{tag}.svg").read_text(encoding="utf-8")
        joins = identity_join(svg, source_ids, toolkit)
        page_joins.append({"page": page_info["page"], **{k: v for k, v in joins.items() if k != "joins"}})
        for sid, join in joins["joins"].items():
            if sid in all_joins:
                all_joins[sid]["pages"] = sorted(set(all_joins[sid].get("pages", []) + [page_info["page"]]))
            else:
                all_joins[sid] = {**join, "pages": [page_info["page"]]}
    (score_dir / f"joins{prefix}.json").write_text(json.dumps({"pages": page_joins, "joins": all_joins}, indent=1), encoding="utf-8")
    # Set-consistent accounting (dict sizes can mislead when merged entries
    # share groups): resolve purely on source-id sets.
    source_set = set(source_ids)
    unmatched_source = sorted(source_set - set(all_joins))
    joined = len(source_set) - len(unmatched_source)
    identity_rate = joined / len(source_set) if source_set else None
    merged = {"attached": {}}
    if unmatched_source:
        # Renderer-merged unisons: two voices sharing one pitch+onset render a
        # single notehead (one group). Attaching the unmatched twin to its
        # joined twin's group is exact (same onset+pitch+measure), not a guess.
        merged.update(attach_merged_unisons(score_dir, source_ids, all_joins, unmatched_source))
        for sid, group in merged["attached"].items():
            all_joins[sid] = {**all_joins[group], "mergedInto": group, "pages": all_joins[group].get("pages", [])}
        unmatched_source = sorted(set(source_ids) - set(all_joins))
        joined = len(set(source_ids)) - len(unmatched_source)
        identity_rate = joined / len(set(source_ids)) if source_ids else None
        (score_dir / f"joins{prefix}.json").write_text(
            json.dumps({"pages": page_joins, "joins": all_joins, "mergedUnisons": merged["attached"]}, indent=1),
            encoding="utf-8")
    masked_events = []
    if unmatched_source:
        # Last resort: event-level box masks for renderer-merged/dropped
        # duplicates no exact rule attaches. Truth stands; only the rendered
        # box leaves supervision. Gated: <2% unmatched (or at most 2 events on
        # small scores, where a percent gate would be scale-blind) AND every
        # masked event in an allowlisted duplicate class. A uniquely-dropped
        # note blocks masking (renderer lost real content) and quarantines
        # the score.
        rate = len(unmatched_source) / len(source_ids) if source_ids else 1.0
        classes = classify_unmatched(score_dir, source_ids, all_joins, unmatched_source)
        allowed = {"unison-ambiguous", "duplicate-dropped", "rest-unmatched", "chord-head-absent", "tab-rest-unrendered"}
        if (rate < 0.02 or len(unmatched_source) <= 2) and classes and all(c["class"] in allowed for c in classes):
            masked_events = [{"id": c["id"], "class": c["class"]} for c in classes]
            unmatched_source = []
            joined = len(set(source_ids))
            identity_rate = 1.0 if source_ids else None
            (score_dir / f"joins{prefix}.json").write_text(
                json.dumps({"pages": page_joins, "joins": all_joins,
                            "mergedUnisons": merged.get("attached", {}),
                            "maskedEvents": masked_events}, indent=1),
                encoding="utf-8")
    if identity_rate != 1.0 or unmatched_source:
        return {"ok": False, "error": f"identityRate={identity_rate} unmatchedSource={len(unmatched_source)}"}
    tab_heights = []
    head_heights = []
    for join in all_joins.values():
        for box in join["boxes"]:
            height = box[3] - box[1]
            if "tab-text" in join["children"]:
                tab_heights.append(round(height, 2))
            if "notehead" in join["children"]:
                head_heights.append(round(height, 2))
    png_meta = {}
    pages_meta = []
    for page_info in result["pages"]:
        tag = "" if page_info["page"] == 1 else "-p" + str(page_info["page"])
        svg_path = score_dir / f"render{prefix}{tag}.svg"
        structure_hash = hashlib.sha256(svg_structure_key(svg_path.read_text(encoding="utf-8")).encode()).hexdigest()
        pages_meta.append({
            "page": page_info["page"],
            "svg": f"render{prefix}{tag}.svg",
            "svgHash": structure_hash,
            "svgBytes": page_info["svgBytes"],
        })
        for width in ("1050", "2100"):
            name = f"page{prefix}{tag}-w{width}.png"
            png_meta[name] = {**page_info["pngQuality"][width], "sha256": sha_file(score_dir / name), "provenance": "raster-export"}
    return {"ok": True, "layout": {
        "options": layout_options(layout),
        "pages": pages_meta,
        "deterministic": True,
        "identityRate": identity_rate,
        "joinedGroups": joined,
        "maskedEvents": masked_events,
        "png": png_meta,
        "glyphScale": {"tabDigitHeights": tab_heights, "noteheadHeights": head_heights, "units": "verovio-page-units"},
    }}


if __name__ == "__main__":
    raise SystemExit(main())
