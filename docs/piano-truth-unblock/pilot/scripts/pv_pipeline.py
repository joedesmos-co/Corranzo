#!/usr/bin/env python3
"""Shared Verovio render/join pipeline for the Piano Vision verified dataset.

This is the production module used by the pilot (and later by pair ingestion).
It is a cleaned-up, instrumented version of the provenance proof pipeline.

Guarantees:
  * pinned renderer options, pinned xmlIdSeed
  * canonical MEI hashing (Verovio embeds an isodate that breaks byte hashes)
  * exact id join for all non-state elements
  * semantic state join for clef/keySig/meterSig
  * per-score source-identity check against a music21 parse (pitch histogram
    using oct.ges when present, note/rest/measure counts)
  * unsupported-notation detection from the MusicXML source text
  * quarantine reasons, never silent drops
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

import verovio

VEROVIO_VERSION_PIN = "6.3.0"
XML_ID_SEED = 20261007
# Verovio emits content coordinates in internal units (100/mm) while the SVG
# root width/height are in page px (10/mm): page_px = units / 10.
SVG_UNITS_PER_PAGE_PX = 10.0
MEI_NS = "{http://www.music-encoding.org/ns/mei}"
XML_ID = "{http://www.w3.org/XML/1998/namespace}id"

ELEMENT_TAGS = [
    "note", "rest", "mRest", "accid", "clef", "keySig", "meterSig", "beam",
    "tuplet", "tie", "slur", "artic", "dynam", "hairpin", "tempo", "trill",
    "mordent", "turn", "trem", "bTrem", "fTrem", "arpeg", "gliss", "pedal",
    "octave", "fing", "dir", "fermata", "breath", "dot", "grace", "cue",
    "ornam", "harm", "mNum", "ending", "volta", "reh",
]
STATE_TAGS = ("clef", "keySig", "meterSig")

# MusicXML feature token -> MEI presence regex. A source feature present while
# its MEI presence regex finds nothing is a verified dropped feature.
FEATURE_MAP = {
    "tremolo": (r"<tremolo[\s>]", r"<trem[\s>]|<bTrem[\s>]|<fTrem[\s>]"),
    "glissando": (r"<glissando[\s>]", r"<gliss[\s>]"),
    "arpeggiate": (r"<arpeggiate[\s>]", r"<arpeg[\s>]"),
    "trill": (r"<trill-mark[\s>]", r"<trill[\s>]"),
    "mordent": (r"<mordent[\s>]", r"<mordent[\s>]"),
    "turn": (r"<turn[\s>]", r"<turn[\s>]"),
    "fingering": (r"<fingering[\s>]", r"<fing[\s>]"),
    "pedal": (r"<pedal[\s>]", r"<pedal[\s>]"),
    "octave_shift": (r"<octave-shift[\s>]", r"<octave[\s>]"),
    "wedge": (r"<wedge[\s>]", r"<hairpin[\s>]"),
    "dynamics": (r"<dynamics[\s>]", r"<dynam[\s>]"),
    "grace": (r"<grace[\s>]", r'grace="'),
    "cue": (r"<cue[\s>]", r'cue="'),
    "tuplet": (r"<tuplet[\s>]", r"<tuplet[\s>]"),
    "tie": (r"<tied[\s>]", r"<tie[\s>]"),
    "slur": (r"<slur[\s>]", r"<slur[\s>]"),
    "ending": (r"<ending[\s>]", r"<ending[\s>]"),
    "fermata": (r"<fermata[\s>]", r"<fermata[\s>]"),
    "breath": (r"<breath-mark[\s>]|<caesura[\s>]", r"<breath[\s>]|<caesura[\s>]"),
    "articulation": (r"<articulations[\s>]", r"<artic[\s>]"),
    "rehearsal": (r"<rehearsal[\s>]", r"<reh[\s>]"),
}

# Quarantine reasons produced by this module
Q_IMPORT = "import_failure"
Q_ID_JOIN = "broken_id_join"
Q_STATE = "ambiguous_state_join"
Q_IDENTITY = "source_identity_mismatch"
Q_IDENTITY_UNVERIFIABLE = "source_identity_unverifiable"
Q_GEOMETRY = "invalid_geometry"
Q_UNSUPPORTED = "unsupported_notation_transformation"
Q_SOURCE = "malformed_source"
Q_PROVENANCE = "missing_required_provenance"

# Articulations Verovio imports into MEI but does not render as SVG groups
UNRENDERED_ARTIC = {"scoop", "plop", "doit", "falloff", "fall", "rip"}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def canonical_mei(mei: str) -> str:
    """Strip the run timestamp Verovio embeds in <application isodate=...>."""
    return re.sub(r'\s+isodate="[^"]*"', "", mei)


def musicxml_text(mxl_path: Path) -> str:
    """Return the MusicXML text from an .mxl zip or a plain .musicxml file."""
    if zipfile.is_zipfile(mxl_path):
        with zipfile.ZipFile(mxl_path) as z:
            names = [n for n in z.namelist()
                     if n.lower().endswith((".xml", ".musicxml")) and not n.startswith("META-INF")]
            if not names:
                raise ValueError("no MusicXML member in archive")
            names.sort(key=lambda n: (0 if "score" in n.lower() else 1, len(n)))
            return z.read(names[0]).decode("utf-8", "replace")
    return mxl_path.read_text(encoding="utf-8", errors="replace")


# --------------------------------------------------------------------- render

def render_score(mxl_path: Path, seed: int = XML_ID_SEED):
    """Load with Verovio and return (toolkit, mei, svgs, pages)."""
    tk = verovio.toolkit()
    tk.setOptions({
        "xmlIdSeed": seed,
        "svgBoundingBoxes": True,
        "svgContentBoundingBoxes": True,
    })
    if not tk.loadFile(str(mxl_path)):
        raise RuntimeError("verovio loadFile returned false")
    pages = tk.getPageCount()
    if pages < 1:
        raise RuntimeError("no pages rendered")
    mei = tk.getMEI()
    svgs = [tk.renderToSVG(i) for i in range(1, pages + 1)]
    return tk, mei, svgs, pages


# ------------------------------------------------------------------- MEI side

def parse_mei(mei: str):
    """Walk MEI in document order and return element records + counts."""
    root = ET.fromstring(mei)
    records = []
    counts = Counter()
    missing_ids = []
    measure_order = []

    def walk(node, measure, staff, layer, voice):
        tag = node.tag.replace(MEI_NS, "")
        if tag == "measure":
            measure = node.get(XML_ID)
            measure_order.append(measure)
        elif tag in ("staff", "staffDef"):
            staff = node.get("n")
        elif tag == "layer":
            layer = node.get(XML_ID)
            voice = node.get("n")
        if tag in ELEMENT_TAGS:
            eid = node.get(XML_ID)
            counts[tag] += 1
            rec = {"tag": tag, "id": eid, "measure": measure, "staff": staff,
                   "layer": layer, "voice": voice}
            if tag == "note":
                for k in ("pname", "oct", "dur", "dur.ppq", "dots", "grace",
                          "cue", "staff", "oct.ges", "pname.ges"):
                    v = node.get(k)
                    if v is not None:
                        rec[k.replace(".", "_")] = v
                acc = node.find(MEI_NS + "accid")
                if acc is not None:
                    rec["accid_ges"] = acc.get("accid.ges") or acc.get("accid")
            if tag == "artic":
                rec["artic"] = node.get("artic")
            if tag in STATE_TAGS:
                rec["attrs"] = {k: v for k, v in node.attrib.items() if k != XML_ID}
                rec["pos"] = len(measure_order) if measure is None else len(measure_order) - 1
            records.append(rec)
            if not eid:
                missing_ids.append(tag)
        for child in node:
            walk(child, measure, staff, layer, voice)

    walk(root, None, None, None, None)
    return records, counts, missing_ids, measure_order


# ------------------------------------------------------------------- SVG side

def svg_bboxes(svg: str):
    out = {}
    for m in re.finditer(
            r'<g id="bbox-([^"]+)" class="([^"]*?)\s*bounding-box"[^>]*>\s*<rect([^/]*)/>', svg):
        eid, cls, attrs = m.group(1), m.group(2), m.group(3)
        a = dict(re.findall(r'([\w.-]+)="([^"]*)"', attrs))
        try:
            out[eid] = {"class": cls.strip(), "x": float(a["x"]), "y": float(a["y"]),
                        "w": float(a["width"]), "h": float(a["height"])}
        except KeyError:
            continue
    return out


def svg_group_ids(svg: str):
    return set(re.findall(r'<g\b[^>]*\bid="([^"]+)"', svg))


def svg_note_anchor(svg: str, note_id: str):
    m = re.search(r'<g\b[^>]*id="%s"[^>]*>' % re.escape(note_id), svg)
    if not m:
        return None
    end = svg.find("</g>", m.end())
    body = svg[m.start(): end if end > 0 else len(svg)]
    u = re.search(r'transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)', body)
    return [float(u.group(1)), float(u.group(2))] if u else None


def staff_spans(svg: str, page: int):
    entries = []
    sys_i = -1
    staff_i = 0
    for m in re.finditer(r'<g\b([^>]*?)/>|<g\b([^>]*)>|</g>', svg):
        tok = m.group(0)
        if tok == "</g>":
            continue
        attrs = m.group(1) if m.group(1) is not None else m.group(2)
        cm = re.search(r'class="([^"]*)"', attrs)
        im = re.search(r'id="([^"]*)"', attrs)
        cls = cm.group(1) if cm else None
        eid = im.group(1) if im else None
        if tok.endswith("/>"):
            continue
        if cls == "system":
            sys_i += 1
        elif cls == "measure":
            staff_i = 0
        elif cls == "staff" and eid:
            staff_i += 1
            entries.append({"page": page, "system": sys_i, "staff": staff_i,
                            "id": eid, "ys": None})
    for e in entries:
        start = re.search(r'<g\b[^>]*id="%s"[^>]*class="staff"[^>]*>' % re.escape(e["id"]), svg)
        if not start:
            continue
        layer = re.search(r'<g\b[^>]*class="layer"', svg[start.end():])
        body = svg[start.end(): start.end() + layer.start()] if layer else svg[start.end(): start.end() + 20000]
        ys = []
        horiz = []
        for p in re.finditer(r'<path d="M\s*([-0-9.]+)\s+([-0-9.]+)\s*L\s*([-0-9.]+)\s+([-0-9.]+)"', body):
            x1, y1, x2, y2 = map(float, p.groups())
            if abs(y1 - y2) < 0.5:
                horiz.append((abs(x2 - x1), (y1 + y2) / 2.0))
        # the five longest horizontal paths are the staff lines; shorter ones
        # are ledger lines and must not widen the staff span
        horiz.sort(reverse=True)
        ys = sorted({round(y, 2) for _, y in horiz[:5]})
        if len(ys) >= 5:
            e["ys"] = ys
    return [e for e in entries if e["ys"]]


def svg_state_groups(svg: str):
    out = []
    cur_measure = None
    staff_i = 0
    sys_i = -1
    measure_sys = []
    for m in re.finditer(r'<g\b([^>]*?)/>|<g\b([^>]*)>|</g>', svg):
        tok = m.group(0)
        if tok == "</g>":
            continue
        attrs = m.group(1) if m.group(1) is not None else m.group(2)
        cm = re.search(r'class="([^"]*)"', attrs)
        im = re.search(r'id="([^"]*)"', attrs)
        cls = cm.group(1) if cm else None
        eid = im.group(1) if im else None
        if tok.endswith("/>"):
            continue
        if cls == "system":
            sys_i += 1
        elif cls == "measure":
            cur_measure = eid
            staff_i = 0
            measure_sys.append((sys_i, eid))
        elif cls == "staff":
            staff_i += 1
        elif cls in STATE_TAGS:
            out.append({"class": cls, "id": eid, "measure": cur_measure,
                        "staff": staff_i or None, "system": sys_i})
    idx = {eid: i for i, (s, eid) in enumerate(measure_sys)}
    for g in out:
        i = idx.get(g["measure"])
        if i is None:
            g["at_system_end"] = False
        elif i == len(measure_sys) - 1:
            g["at_system_end"] = True
        else:
            g["at_system_end"] = measure_sys[i + 1][0] != g["system"]
    return out


# -------------------------------------------------------------------- joins

def _state_at(decls, mp):
    expected = None
    for p, attrs in decls:
        if p <= mp:
            expected = attrs
    return expected


def build_state_timeline(records, measure_order):
    pos = {m: i for i, m in enumerate(measure_order)}
    staves = sorted({str(r["staff"]) for r in records if r.get("staff")})
    timeline = {}
    for r in records:
        if r["tag"] in STATE_TAGS and "attrs" in r:
            p = r.get("pos", -1)
            targets = [str(r["staff"])] if r.get("staff") else staves
            for staff in targets:
                timeline.setdefault(r["tag"], {}).setdefault(staff, []).append((p, r["attrs"]))
    for t in timeline:
        for s in timeline[t]:
            timeline[t][s].sort(key=lambda x: x[0])
    return timeline, pos


def state_join(tk, svgs, records, measure_order):
    timeline, pos = build_state_timeline(records, measure_order)
    by_id = {r["id"]: r.get("attrs", {}) for r in records if r.get("id")}

    def resolve(attrs):
        a = dict(attrs or {})
        if "sameas" in a:
            a = dict(by_id.get(str(a["sameas"]).lstrip("#"), {}))
        return {k: str(v) for k, v in a.items()}

    out = {}
    for tag in STATE_TAGS:
        rendered = matched = courtesy = within = unresolved = 0
        mismatches = []
        for svg in svgs:
            for g in svg_state_groups(svg):
                if g["class"] != tag:
                    continue
                rendered += 1
                staff = str(g["staff"])
                mp = pos.get(g["measure"])
                decls = timeline.get(tag, {}).get(staff)
                if mp is None or not decls:
                    mismatches.append({"id": g["id"], "reason": "no_timeline"})
                    continue
                actual = resolve(tk.getElementAttr(g["id"]))
                if not actual:
                    # layout-generated group with no queryable MEI element
                    # (e.g. a redrawn state at a section/system boundary)
                    unresolved += 1
                    continue
                exp = resolve(_state_at(decls, mp))
                prev = resolve(_state_at(decls, mp - 1))
                next_change = None
                for p, attrs in decls:
                    if p > mp:
                        next_change = resolve(attrs)
                        break
                if actual == exp:
                    matched += 1
                elif g.get("at_system_end") and actual == (next_change or {}):
                    courtesy += 1
                elif actual == prev or any(actual == resolve(a) for p, a in decls if p == mp):
                    within += 1
                else:
                    mismatches.append({"id": g["id"], "expected": exp, "actual": actual})
        out[tag] = {"rendered": rendered, "matched": matched,
                    "courtesy_matched": courtesy, "within_measure_matched": within,
                    "unresolved": unresolved,
                    "mismatch": len(mismatches), "mismatch_examples": mismatches[:2]}
    return out


def id_join(records, all_ids):
    by_tag = Counter()
    joined = Counter()
    missing = Counter()
    for r in records:
        tag = r["tag"]
        by_tag[tag] += 1
        if r["id"] and r["id"] in all_ids:
            joined[tag] += 1
        else:
            missing[tag] += 1
    return by_tag, joined, missing


# ------------------------------------------------------------ source identity

def source_identity_check(mxl_path: Path, records, counts, measure_order):
    """Compare MEI note/rest/measure population against an independent music21
    parse of the same source. Uses oct.ges when present (octave shifts).
    Returns dict with exact equality flags and counts."""
    from music21 import converter
    from music21.harmony import ChordSymbol
    try:
        score = converter.parse(str(mxl_path))
    except Exception as e:  # music21 may fail on malformed exports
        return {"ok": False, "error": f"music21_parse: {str(e)[:160]}"}
    hist_xml = Counter()
    n_xml_notes = 0
    n_xml_rests = 0
    for n in score.recurse().notes:
        if isinstance(n, ChordSymbol):
            continue  # harmony/chord symbols are not notated notes
        if n.isRest:
            n_xml_rests += 1
            continue
        if hasattr(n, "pitches"):
            for p in n.pitches:
                hist_xml[(p.step + str(p.octave)).lower()] += 1
                n_xml_notes += 1
        else:
            p = n.pitch
            hist_xml[(p.step + str(p.octave)).lower()] += 1
            n_xml_notes += 1
    hist_mei = Counter()
    for r in records:
        if r["tag"] == "note" and r.get("pname"):
            octv = r.get("oct_ges") or r.get("oct")
            hist_mei[(r["pname"] + octv).lower()] += 1
    n_mei_notes = sum(hist_mei.values())
    n_mei_rests = counts.get("rest", 0) + counts.get("mRest", 0)
    # music21 models measures per staff/part and .notes excludes rests, so use
    # the raw MusicXML measure token count for the informational comparison.
    try:
        n_xml_measures = len(re.findall(r"<measure[\s>]", musicxml_text(mxl_path)))
    except Exception:
        n_xml_measures = None
    n_measures_mei = len(measure_order)
    return {
        "ok": (hist_xml == hist_mei and n_xml_notes == n_mei_notes),
        "xml_notes": n_xml_notes, "mei_notes": n_mei_notes,
        "xml_rests": n_xml_rests, "mei_rests": n_mei_rests,
        "xml_measures": n_xml_measures, "mei_measures": n_measures_mei,
        "measures_match": n_xml_measures == n_measures_mei,
        "pitch_histogram_equal": hist_xml == hist_mei,
        "pitch_diff_xml_only": sum((hist_xml - hist_mei).values()),
        "pitch_diff_mei_only": sum((hist_mei - hist_xml).values()),
    }


def dropped_features(xml_text: str, mei: str):
    """Return {feature: source_count} for features present in the source whose
    MEI presence regex finds nothing."""
    dropped = {}
    for feat, (src_re, mei_re) in FEATURE_MAP.items():
        src_n = len(re.findall(src_re, xml_text))
        if src_n and not re.search(mei_re, mei):
            dropped[feat] = src_n
    return dropped


# ------------------------------------------------------------------ objects

def build_objects(tk, records, svgs, all_bbox, all_ids, state_report):
    """Machine-readable object correspondence list.

    Every non-state element: mei_id == svg_id, bbox if available.
    State elements: mei declaration id plus the layout svg_id it resolved to.
    """
    objects = []
    note_index = 0
    for r in records:
        tag = r["tag"]
        obj = {"tag": tag, "mei_id": r["id"], "measure": r["measure"],
               "staff": r["staff"], "layer": r["layer"], "voice": r["voice"]}
        if tag == "note":
            obj["source_order"] = note_index
            note_index += 1
            for k in ("pname", "oct", "oct_ges", "dur", "dur_ppq", "dots",
                      "grace", "cue", "staff", "accid_ges"):
                if k in r:
                    obj[k] = r[k]
        if tag in STATE_TAGS:
            obj["source_attrs"] = r.get("attrs", {})
            obj["in_svg_id_join"] = bool(r["id"] and r["id"] in all_ids)
            obj["state_join"] = "semantic"
        else:
            obj["svg_id"] = r["id"] if r["id"] in all_ids else None
            obj["in_svg_id_join"] = bool(r["id"] in all_ids)
            if r["id"] in all_bbox:
                obj["bbox"] = all_bbox[r["id"]]
        objects.append(obj)
    return objects


# --------------------------------------------------------------- quality

def svg_page_geometry(svgs, all_bbox):
    """Page geometry summary from SVG.

    Returns page width/height in page px and in content units, plus staff
    gaps in both. All absolute geometry checks must use the unit space.
    """
    pages = []
    for i, svg in enumerate(svgs, 1):
        m = re.search(r'<svg[^>]*width="([0-9.]+)px"[^>]*height="([0-9.]+)px"', svg)
        w = float(m.group(1)) if m else None
        h = float(m.group(2)) if m else None
        entries = staff_spans(svg, i)
        gaps = [round((e["ys"][-1] - e["ys"][0]) / 4.0, 3) for e in entries if e.get("ys")]
        pages.append({
            "page": i, "width": w, "height": h,
            "width_units": w * SVG_UNITS_PER_PAGE_PX if w else None,
            "height_units": h * SVG_UNITS_PER_PAGE_PX if h else None,
            "units_per_px": SVG_UNITS_PER_PAGE_PX,
            "staff_groups": len(entries),
            "staff_gaps": gaps,
            "median_staff_gap": sorted(gaps)[len(gaps) // 2] if gaps else None,
            "median_staff_gap_px": (sorted(gaps)[len(gaps) // 2] / SVG_UNITS_PER_PAGE_PX) if gaps else None,
        })
    return pages
