#!/usr/bin/env python3
"""Guitar Vision — render/source identity pilot (G1).

Closes the loop the foundation report left open:

    symbolic source event
    -> stable source ID (injected into MusicXML, deterministic across processes)
    -> Verovio SVG
    -> exact join on the ID (no document-order fallback)

Verovio propagates ``<note id="...">`` into ``<g id="..." class="note">``,
so identity survives rendering when the source carries it. Every join below
is by ID string equality; anything unmatched is reported, never paired by
position.

Usage:
    python3 tools/guitar-vision/render_identity.py --in <score.musicxml> --out <joins.json>
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import verovio

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "guitar-vision"))
from render_corpus import (  # noqa: E402
    _has_tab_text,
    _iter_group_elements,
    _tab_digit_boxes,
    _use_boxes,
    apply_transform,
    content_transform,
    glyph_outline_bounds,
)

VEROVIO_OPTIONS = {
    "pageWidth": 2100,
    "pageHeight": 2970,
    "scale": 40,
    "adjustPageWidth": True,
    "adjustPageHeight": True,
    "footer": "none",
    "header": "none",
    # Fixed seed: auto-generated SVG ids are byte-stable across renders and
    # processes. Joins never rely on them (stable source IDs only), but
    # determinism no longer depends on canonicalization alone.
    "xmlIdSeed": 20261007,
}

ID_PATTERN = re.compile(r"<note(?=[\s>/])")


def inject_stable_ids(xml: str, prefix: str) -> tuple[str, list[str]]:
    """Stamp every ``<note>`` with a deterministic ID.

    Pure function of the input: ``{prefix}-n{index:03d}`` in document order,
    so two processes stamping the same file produce byte-identical IDs.
    Existing IDs are left untouched (a source that already carries identity
    keeps it).
    """
    ids: list[str] = []
    counter = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal counter
        counter += 1
        source_id = f"{prefix}-n{counter:03d}"
        ids.append(source_id)
        return f'<note id="{source_id}"'

    stamped, count = ID_PATTERN.subn(replace, xml)
    assert count == len(ids)
    return stamped, ids


def render_svg(xml: str, page: int = 1) -> tuple[str, verovio.toolkit]:
    toolkit = verovio.toolkit()
    toolkit.setOptions(VEROVIO_OPTIONS)
    if not toolkit.loadData(xml):
        raise ValueError("Verovio refused the stamped MusicXML")
    return toolkit.renderToSVG(page), toolkit


def _group_id(attrs: str) -> str | None:
    match = re.search(r'id="([^"]+)"', attrs)
    return match.group(1) if match else None




def _stem_box(stem_inner: str) -> list[float] | None:
    """Bounding box of a <g class="stem"> path (explicit coordinates)."""
    path = re.search(r'<path[^>]*d="M([\d.\-]+)[\s,]+([\d.\-]+)[\s,]+L([\d.\-]+)[\s,]+([\d.\-]+)"', stem_inner)
    if not path:
        return None
    x1, y1, x2, y2 = (float(path.group(i)) for i in range(1, 5))
    width_match = re.search(r'stroke-width="([\d.]+)"', stem_inner)
    half = float(width_match.group(1)) / 2 if width_match else 9.0
    return [min(x1, x2) - half, min(y1, y2), max(x1, x2) + half, max(y1, y2)]


def _rhythm_primitives(inner: str, ancestors: list) -> dict:
    """Stems, beams, dots, flags for one note group (G5 truth readiness).

    - stem: child g.stem path box (None when stemless).
    - beam: nearest ancestor g.beam id (shared by the beamed group).
    - dots: count of child g.dots ellipses.
    - flag: child g.flag present (unbeamed flagged note).
    Tuplets have no SVG object in this renderer (verified): bracket/number
    groups are absent, so tuplet truth stays symbolic (time-modification).
    """
    stem_box, beam_id, dots, flag = None, None, 0, False
    stem_match = re.search(r'<g[^>]*class="stem"[^>]*>(.*?)</g>', inner, re.S)
    if stem_match:
        stem_box = _stem_box(stem_match.group(0))
        flag = 'class="flag"' in stem_match.group(1)
    dots_match = re.search(r'<g[^>]*class="dots"[^>]*>(.*?)</g>', inner, re.S)
    if dots_match:
        dots = len(re.findall(r"<ellipse", dots_match.group(1)))
    for ancestor_id, classes in reversed(ancestors):
        if "beam" in classes:
            beam_id = ancestor_id
            break
    return {"stem": stem_box, "beam": beam_id, "dots": dots, "flag": flag}


def _iter_groups_with_ancestors(svg: str):
    """Yield (attrs, inner, ancestors) for every <g> group.

    ancestors: list of (id, class-list) from outermost to parent. Pre-order:
    the stack stays live while descendants yield, so beam ancestry resolves.
    """
    pattern = re.compile(r"<g\b([^>]*)>")
    position = 0
    stack: list = []  # each: [attrs, inner_start, id, classes]
    while True:
        open_match = pattern.search(svg, position)
        close_index = svg.find("</g>", position)
        if open_match is None and close_index == -1:
            return
        if open_match is not None and (close_index == -1 or open_match.start() < close_index):
            attrs = open_match.group(1)
            if attrs.rstrip().endswith("/"):
                position = open_match.end()
                continue
            group_id = _group_id(attrs)
            class_match = re.search(r'class="([^"]*)"', attrs)
            classes = class_match.group(1).split() if class_match else []
            stack.append([attrs, open_match.end(), group_id, classes])
            ancestors = [(entry[2], entry[3]) for entry in stack[:-1]]
            # Inner span via depth walk from here.
            depth = 1
            index = open_match.end()
            close_start = -1
            while depth > 0:
                inner_open = pattern.search(svg, index)
                inner_close = svg.find("</g>", index)
                if inner_close == -1:
                    break
                if inner_open is not None and inner_open.start() < inner_close:
                    if inner_open.group(1).rstrip().endswith("/"):
                        index = inner_open.end()
                    else:
                        depth += 1
                        index = inner_open.end()
                else:
                    depth -= 1
                    if depth == 0:
                        close_start = inner_close
                    index = inner_close + 4
            inner = svg[open_match.end():close_start] if close_start >= 0 else ""
            yield attrs, inner, ancestors
            position = open_match.end()
        else:
            if stack:
                stack.pop()
            position = close_index + 4


def identity_join(svg: str, source_ids: list[str], toolkit) -> dict:
    """Join rendered note groups to source IDs by exact string equality.

    Returns per-ID records plus the unmatched sets on both sides. No
    document-order fallback: an ID present twice, or a source ID with no
    rendered group, is a join failure, not a pairing heuristic.
    """
    outlines = glyph_outline_bounds(svg)
    page_matrix = content_transform(svg)

    rendered: dict[str, dict] = {}
    duplicates: list[str] = []
    # Notes AND rests carry source IDs: Verovio propagates <note id> onto
    # <g class="note"> for pitched notes and <g class="rest"> for rest notes.
    # Scanning only one class would silently drop the other.
    wanted = {"note", "rest"}
    for attrs, inner, ancestors in _iter_groups_with_ancestors(svg):
        class_match = re.search(r'class="([^"]*)"', attrs)
        classes = set(class_match.group(1).split()) if class_match else set()
        if not (classes & wanted):
            continue
        group_id = _group_id(attrs)
        if group_id is None:
            continue
        if group_id in rendered:
            duplicates.append(group_id)
            continue
        record = _join_record(attrs, inner, outlines, page_matrix, toolkit, group_id,
                              "rest" if "rest" in classes else "note")
        if record is not None:
            record["rhythm"] = _rhythm_primitives(inner, ancestors)
            rendered[group_id] = record

    source_set = set(source_ids)
    rendered_set = set(rendered)
    joins = {sid: rendered[sid] for sid in source_ids if sid in rendered}
    return {
        "sourceCount": len(source_ids),
        "renderedNoteGroups": len(rendered),
        "joined": len(joins),
        "joins": joins,
        "duplicates": duplicates,
        "unmatchedSource": sorted(source_set - rendered_set),
        "unmatchedRendered": sorted(rendered_set - source_set),
        "identityRate": (len(joins) / len(source_ids)) if source_ids else None,
    }


def _join_record(attrs: str, inner: str, outlines: dict, page_matrix, toolkit, group_id: str, wanted: str, ancestors: list | None = None) -> dict:
    tx_match = re.search(r'transform="translate\(([^)]+)\)', attrs)
    tx = ty = 0.0
    if tx_match:
        parts = [float(v) for v in re.split(r"[,\s]+", tx_match.group(1).strip()) if v]
        tx = parts[0] if parts else 0.0
        ty = parts[1] if len(parts) > 1 else 0.0
    children = []
    boxes: list[list[float]] = []
    if wanted == "rest":
        children.append("rest")
        for box in _use_boxes(inner, outlines):
            x0, y0 = apply_transform(page_matrix, box.x0 + tx, box.y0 + ty)
            x1, y1 = apply_transform(page_matrix, box.x1 + tx, box.y1 + ty)
            boxes.append([x0, y0, x1, y1])
    else:
        if "notehead" in inner or "<use " in inner:
            children.append("notehead")
            for box in _use_boxes(inner, outlines):
                x0, y0 = apply_transform(page_matrix, box.x0 + tx, box.y0 + ty)
                x1, y1 = apply_transform(page_matrix, box.x1 + tx, box.y1 + ty)
                boxes.append([x0, y0, x1, y1])
        if "tabGrp" in inner or _has_tab_text(inner):
            children.append("tab-text")
            digit_boxes, _digits = _tab_digit_boxes(inner)
            for box in digit_boxes:
                x0, y0 = apply_transform(page_matrix, box.x0 + tx, box.y0 + ty)
                x1, y1 = apply_transform(page_matrix, box.x1 + tx, box.y1 + ty)
                boxes.append([x0, y0, x1, y1])
    try:
        page = toolkit.getPageWithElement(group_id)
    except Exception:
        page = None
    record = {"page": page, "children": children, "boxes": boxes}
    rhythm = _rhythm_primitives(inner, ancestors or [])
    if rhythm["stem"] is not None:
        x0, y0 = apply_transform(page_matrix, rhythm["stem"][0] + tx, rhythm["stem"][1] + ty)
        x1, y1 = apply_transform(page_matrix, rhythm["stem"][2] + tx, rhythm["stem"][3] + ty)
        rhythm["stem"] = [x0, y0, x1, y1]
    record["rhythm"] = rhythm
    return record


def pilot_for_file(path: Path, prefix: str) -> dict:
    xml = path.read_text(encoding="utf-8")
    stamped, ids = inject_stable_ids(xml, prefix)
    svg, toolkit = render_svg(stamped)
    result = identity_join(svg, ids, toolkit)
    result["file"] = str(path)
    result["prefix"] = prefix
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in", dest="input", required=True)
    parser.add_argument("--out", dest="output", default=None)
    parser.add_argument("--prefix", default="gv-pilot")
    args = parser.parse_args()
    result = pilot_for_file(Path(args.input), args.prefix)
    text = json.dumps(result, indent=2)
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
    else:
        print(text)
    exact = (
        result["identityRate"] == 1.0
        and not result["duplicates"]
        and not result["unmatchedSource"]
    )
    print(f"identity exact: {exact} ({result['joined']}/{result['sourceCount']})", file=sys.stderr)
    return 0 if exact else 1


if __name__ == "__main__":
    raise SystemExit(main())
