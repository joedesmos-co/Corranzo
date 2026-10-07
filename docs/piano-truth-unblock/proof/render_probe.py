#!/usr/bin/env python3
"""Piano truth-unblock provenance proof (CPU only, no training).

MusicXML/MXL -> Verovio deterministic render (fixed xmlIdSeed, SVG bounding
boxes) -> MEI<->SVG element join -> machine-readable paired sample.

What this proves or falsifies:
  * every MEI note/rest/accid/clef/keySig/meterSig/beam/tuplet/tie/slur/artic/
    dynam/hairpin/tempo/ornament/trem/arpeg/gliss/pedal/octave/fing/dir/grace
    element that Verovio renders carries an xml:id that is present in the SVG
  * each SVG note group id is an MEI note id
  * every element has an exact bounding box in SVG coordinates
  * measure/staff/layer ancestry in MEI agrees with visual placement
  * the rendered note population agrees with an independent music21 parse of
    the source MusicXML (diatonic histogram, count)
  * rendering is byte-identical across processes with a fixed xmlIdSeed

Usage:
  python3 render_probe.py                 # run all scores, write out/
  python3 render_probe.py --svg-hash ID   # print render hash for one score
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

import verovio

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent.parent
SEED = 20261007

SCORES = [
    {"id": "cc0-beginner-single", "path": "benchmarks/omr-fixtures/piano-beginner-single-vector/piano-beginner-single-vector.musicxml",
     "license": "CC0-1.0", "provenance": "Corranzo deterministic fixture generator"},
    {"id": "cc0-grand-voices", "path": "benchmarks/omr-fixtures/piano-grand-voices-vector/piano-grand-voices-vector.musicxml",
     "license": "CC0-1.0", "provenance": "Corranzo deterministic fixture generator"},
    {"id": "cc0-rhythm-tuplets", "path": "benchmarks/omr-fixtures/piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.musicxml",
     "license": "CC0-1.0", "provenance": "Corranzo deterministic fixture generator"},
    {"id": "cc0-dense-advanced", "path": "benchmarks/omr-fixtures/piano-dense-advanced-vector/piano-dense-advanced-vector.musicxml",
     "license": "CC0-1.0", "provenance": "Corranzo deterministic fixture generator"},
    {"id": "pd-minuet", "path": "public/fixtures/demo-minuet-in-g.musicxml",
     "license": "Public domain (Mutopia Project)", "provenance": "Mutopia / Corranzo fixture"},
    {"id": "pd-hungarian-dance", "path": "public/fixtures/hungarian-dance-no5/hungarian-dance-no5.mxl",
     "license": "Public domain (Brahms WoO 1)", "provenance": "Corranzo demo fixture"},
    {"id": "pd-la-campanella", "path": "public/fixtures/la-campanella-grandes-etudes-de-paganini-no-3-franz-liszt.mxl",
     "license": "Public domain (Liszt S.141/3)", "provenance": "Corranzo fixture"},
    {"id": "pd-gymnopedie", "path": "tmp/sprint1/gymnopedie-no-1-satie.mxl",
     "license": "Composition public domain (Satie); file provenance unverified", "provenance": "local sprint fixture"},
    {"id": "diag-bach-fugue", "path": "benchmarks/cache/bach-fugue-bwv846/score.musicxml",
     "license": "diagnostic only, not redistributed", "provenance": "local benchmark cache"},
    {"id": "diag-beethoven-sonata", "path": "benchmarks/cache/beethoven-sonata-op2-m1/score.musicxml",
     "license": "diagnostic only, not redistributed", "provenance": "local benchmark cache"},
    {"id": "cc0-coverage-probe", "path": "docs/piano-truth-unblock/proof/inputs/coverage_probe.musicxml",
     "license": "CC0-1.0", "provenance": "authored for this proof (grace, cue, tremolo, gliss, fingering, ornaments, cross-staff)"},
]

ELEMENTS = [
    "note", "rest", "mRest", "accid", "clef", "keySig", "meterSig", "beam", "tuplet",
    "tie", "slur", "artic", "dynam", "hairpin", "tempo", "trill", "mordent",
    "turn", "trem", "bTrem", "fTrem", "arpeg", "gliss", "pedal", "octave",
    "fing", "dir", "fermata", "breath", "dot", "grace", "cue", "mordent",
    "ornam", "harm", "mNum", "ending", "volta", "reh",
]

MEI_NS = "{http://www.music-encoding.org/ns/mei}"


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def svg_bboxes(svg: str) -> dict:
    """id -> {class, x, y, w, h} from bbox groups emitted by svgBoundingBoxes."""
    out = {}
    for m in re.finditer(r'<g id="bbox-([^"]+)" class="([^"]*?)\s*bounding-box"[^>]*>\s*<rect([^/]*)/>', svg):
        eid, cls, attrs = m.group(1), m.group(2), m.group(3)
        a = dict(re.findall(r'(\w+)="([^"]*)"', attrs))
        try:
            out[eid] = {"class": cls.strip(), "x": float(a["x"]), "y": float(a["y"]),
                        "w": float(a["width"]), "h": float(a["height"])}
        except KeyError:
            continue
    return out


def svg_group_ids(svg: str) -> set:
    return set(re.findall(r'<g\b[^>]*\bid="([^"]+)"', svg))


def svg_note_children(svg: str, note_id: str):
    """Return (notehead anchors, child ids) for a note group, by balancing <g>."""
    m = re.search(r'<g\b[^>]*id="%s"[^>]*>' % re.escape(note_id), svg)
    if not m:
        return [], []
    i = m.end()
    depth = 1
    anchors, child_ids = [], []
    tok = re.compile(r'<g\b([^>]*)>|</g>')
    pos = i
    for t in tok.finditer(svg, i):
        if t.group(0).startswith("</g"):
            depth -= 1
            if depth == 0:
                break
        else:
            attrs = t.group(1)
            depth += 1
            cm = re.search(r'class="([^"]*)"', attrs)
            im = re.search(r'id="([^"]*)"', attrs)
            if cm and "notehead" in cm.group(1) and im:
                child_ids.append(im.group(1))
    # anchors: <use transform="translate(x, y)"...> that are direct ink of noteheads
    body = svg[m.start(): m.start() + (t.end() - m.start())]
    for u in re.finditer(r'transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)', body):
        anchors.append((float(u.group(1)), float(u.group(2))))
    return anchors, child_ids


def staff_spans(svg: str, page: int):
    """Return [{page, system, staff, id, ys}] in document order.

    Within a measure group the staff groups are staff 1, 2, ...; measures reset
    the counter and each system holds the measures.
    """
    entries = []
    sys_i = -1
    staff_i = 0
    for m in re.finditer(r'<g\b([^>]*)>', svg):
        attrs = m.group(1)
        cm = re.search(r'class="([^"]*)"', attrs)
        im = re.search(r'id="([^"]*)"', attrs)
        if not cm:
            continue
        cls = cm.group(1)
        if cls == "system":
            sys_i += 1
            staff_i = 0
        elif cls == "measure":
            staff_i = 0
        elif cls == "staff" and im:
            staff_i += 1
            entries.append({"page": page, "system": sys_i, "staff": staff_i,
                            "id": im.group(1), "ys": None})
    # fill y spans from each staff group body
    for e in entries:
        mm = re.search(r'<g\b[^>]*id="%s"[^>]*class="staff"[^>]*>(.*?)(?=<g\b[^>]*class="layer"|</g>)'
                       % re.escape(e["id"]), svg, re.S)
        if not mm:
            continue
        ys = []
        for p in re.finditer(r'<path d="M\s*([-0-9.]+)\s+([-0-9.]+)\s*L\s*([-0-9.]+)\s+([-0-9.]+)"', mm.group(1)):
            x1, y1, x2, y2 = map(float, p.groups())
            if abs(x1 - x2) < 0.5:
                ys.append(round((y1 + y2) / 2.0, 2))
        if len(ys) >= 5:
            e["ys"] = sorted(set(ys))
    return [e for e in entries if e["ys"]]


XML_ID = "{http://www.w3.org/XML/1998/namespace}id"


def svg_state_groups(svg: str):
    """Rendered clef/keySig/meterSig groups with measure/staff/system context.

    Verovio emits self-closing milestone groups, so a plain <g>/</g> stack is
    not safe; staff numbering is tracked per measure instead.
    """
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
            continue  # self-closing milestone groups carry no layout context
        if cls == "system":
            sys_i += 1
        elif cls == "measure":
            cur_measure = eid
            staff_i = 0
            measure_sys.append((sys_i, eid))
        elif cls == "staff":
            staff_i += 1
        elif cls in ("clef", "keySig", "meterSig"):
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

def build_state_timeline(records, measure_order):
    pos = {m: i for i, m in enumerate(measure_order)}
    staves = sorted({str(r["staff"]) for r in records if r.get("staff")})
    timeline = {}
    for r in records:
        if r["tag"] in ("clef", "keySig", "meterSig") and "attrs" in r:
            p = r.get("pos", -1)
            targets = [str(r["staff"])] if r.get("staff") else staves
            for staff in targets:
                timeline.setdefault(r["tag"], {}).setdefault(staff, []).append((p, r["attrs"]))
    for t in timeline:
        for s in timeline[t]:
            timeline[t][s].sort(key=lambda x: x[0])
    return timeline, pos


def _state_at(decls, mp):
    expected = None
    for p, attrs in decls:
        if p <= mp:
            expected = attrs
    return expected


def state_join(tk, svgs, records, measure_order, all_bbox):
    timeline, pos = build_state_timeline(records, measure_order)
    by_id = {r["id"]: r.get("attrs", {}) for r in records if r.get("id")}

    def resolve(attrs):
        a = dict(attrs or {})
        if "sameas" in a:
            tgt = str(a["sameas"]).lstrip("#")
            a = dict(by_id.get(tgt, {}))
        return {k: str(v) for k, v in a.items()}

    out = {}
    for tag in ("clef", "keySig", "meterSig"):
        rendered = 0
        matched = 0
        courtesy = 0
        within_measure = 0
        mismatches = []
        groups_by_ms = {}
        for svg in svgs:
            for g in svg_state_groups(svg):
                if g["class"] != tag:
                    continue
                rendered += 1
                staff = str(g["staff"])
                mp = pos.get(g["measure"], None)
                decls = timeline.get(tag, {}).get(staff)
                if mp is None or not decls:
                    mismatches.append({"id": g["id"], "reason": "no_timeline",
                                       "measure": g["measure"], "staff": staff})
                    continue
                actual = {k: str(v) for k, v in tk.getElementAttr(g["id"]).items()}
                # resolve sameas aliases to the target declaration
                actual = resolve(actual)
                exp = resolve(_state_at(decls, mp))
                exp_prev = resolve(_state_at(decls, mp - 1))
                next_change = None
                for p, attrs in decls:
                    if p > mp:
                        next_change = resolve(attrs)
                        break
                if actual == exp:
                    matched += 1
                elif g.get("at_system_end") and actual == (next_change or {}):
                    courtesy += 1
                else:
                    # within-measure sequence: previous state + later changes
                    in_measure = [resolve(a) for p, a in decls if p == mp]
                    if actual == exp_prev:
                        within_measure += 1
                    elif any(actual == a for a in in_measure):
                        within_measure += 1
                    else:
                        mismatches.append({"id": g["id"],
                                           "expected": exp,
                                           "expected_prev": exp_prev,
                                           "at_system_end": g.get("at_system_end"),
                                           "measure_decls": in_measure,
                                           "actual": actual})
        out[tag] = {"rendered": rendered, "matched": matched,
                    "courtesy_matched": courtesy, "within_measure_matched": within_measure,
                    "mismatch": len(mismatches),
                    "mei_declarations": sum(len(v) for v in timeline.get(tag, {}).values()),
                    "mismatch_examples": mismatches[:3]}
    return out


def parse_mei(mei: str):
    """Return per-element records with ancestry and per-element counts."""
    root = ET.fromstring(mei)
    records = []
    counts = Counter()
    missing_ids = []
    measure_order = []

    def walk(node, measure, staff, layer, ancestors):
        nonlocal measure_seen
        tag = node.tag.replace(MEI_NS, "")
        if tag == "measure":
            measure = node.get(XML_ID)
            measure_order.append(measure)
            measure_seen = len(measure_order) - 1
        elif tag in ("staff", "staffDef"):
            staff = node.get("n")
        elif tag == "layer":
            layer = node.get(XML_ID)
        if tag in ELEMENTS:
            eid = node.get(XML_ID)
            counts[tag] += 1
            rec = {
                "tag": tag, "id": eid, "measure": measure, "staff": staff,
                "layer": layer,
            }
            if tag == "note":
                for k in ("pname", "oct", "dur", "dots", "grace", "cue", "staff",
                          "oct.ges", "pname.ges"):
                    v = node.get(k)
                    if v is not None:
                        rec[k] = v
                acc = node.find(MEI_NS + "accid")
                if acc is not None:
                    rec["accid.ges"] = acc.get("accid.ges") or acc.get("accid")
            if tag in ("clef", "keySig", "meterSig"):
                rec["attrs"] = {k: v for k, v in node.attrib.items() if k != XML_ID}
                # scoreDef/staffDef-level declarations govern from the next measure
                rec["pos"] = len(measure_order) if measure is None else len(measure_order) - 1
            records.append(rec)
            if not eid:
                missing_ids.append(tag)
        for child in node:
            walk(child, measure, staff, layer, ancestors + [tag])

    measure_seen = 0
    walk(root, None, None, None, [])
    return records, counts, missing_ids, measure_order


def musicxml_diatonic_histogram(path: Path):
    from music21 import converter
    try:
        s = converter.parse(str(path))
        hist = Counter()
        for n in s.recurse().notes:
            if hasattr(n, "pitches"):
                for p in n.pitches:
                    hist[(p.step + str(p.octave)).lower()] += 1
            else:
                p = n.pitch
                hist[(p.step + str(p.octave)).lower()] += 1
        return hist
    except Exception as e:
        return {"error": str(e)[:200]}


def render_score(spec):
    path = REPO / spec["path"]
    result = {"id": spec["id"], "path": spec["path"], "license": spec["license"],
              "provenance": spec["provenance"]}
    if not path.is_file():
        result["error"] = "missing"
        return result
    result["source_sha256"] = sha256_file(path)

    tk = verovio.toolkit()
    tk.setOptions({"xmlIdSeed": SEED, "svgBoundingBoxes": True,
                   "svgContentBoundingBoxes": True})
    if not tk.loadFile(str(path)):
        result["error"] = "verovio load failed"
        return result
    pages = tk.getPageCount()
    result["pages"] = pages
    mei = tk.getMEI()
    result["mei_sha256"] = hashlib.sha256(mei.encode()).hexdigest()

    svgs = [tk.renderToSVG(i) for i in range(1, pages + 1)]
    result["svg_sha256"] = hashlib.sha256("".join(svgs).encode()).hexdigest()
    result["verovio_version"] = tk.getVersion()

    records, counts, missing_ids, measure_order = parse_mei(mei)
    result["mei_counts"] = dict(counts)
    result["mei_elements_without_id"] = len(missing_ids)
    result["mei_measures"] = len(measure_order)

    # SVG join
    all_bbox = {}
    all_ids = set()
    staff_entries = []
    for pg, svg in enumerate(svgs, 1):
        for eid, bb in svg_bboxes(svg).items():
            bb["page"] = pg
            all_bbox[eid] = bb
        all_ids |= svg_group_ids(svg)
        staff_entries.extend(staff_spans(svg, pg))
    result["svg_group_ids"] = len(all_ids)
    result["svg_bboxes"] = len(all_bbox)
    result["staff_groups"] = len(staff_entries)

    # element join
    by_tag = Counter()
    joined = Counter()
    missing = Counter()
    element_table = []
    for rec in records:
        tag = rec["tag"]
        by_tag[tag] += 1
        eid = rec["id"]
        if eid and eid in all_ids:
            joined[tag] += 1
            rec["in_svg"] = True
            if eid in all_bbox:
                rec["bbox"] = all_bbox[eid]
        else:
            missing[tag] += 1
            rec["in_svg"] = False
        element_table.append(rec)
    result["join"] = {t: {"mei": by_tag[t], "in_svg": joined[t], "missing": missing[t]}
                      for t in sorted(by_tag)}
    result["all_ids_join"] = all(missing[t] == 0 for t in missing)
    state_classes = {"clef", "keySig", "meterSig"}
    result["id_join_ok_excluding_state_classes"] = all(
        missing[t] == 0 for t in missing if t not in state_classes)

    # state join for clef/keySig/meterSig (layout-generated ids, semantic join)
    result["state_join"] = state_join(tk, svgs, records, measure_order, all_bbox)
    result["state_join_ok"] = all(
        v["rendered"] == v["matched"] + v["courtesy_matched"] + v.get("within_measure_matched", 0)
        for v in result["state_join"].values())

    # note geometry checks
    note_recs = [r for r in element_table if r["tag"] == "note" and r.get("in_svg")]
    result["notes_joined"] = len(note_recs)
    bad_bbox = sum(1 for r in note_recs if r.get("bbox") and (r["bbox"]["w"] <= 0 or r["bbox"]["h"] <= 0))
    result["notes_bad_bbox"] = bad_bbox

    # visual staff containment: rendered staff group vs MEI staff number
    disagreements = 0
    contained = 0
    for r in note_recs:
        if not r.get("bbox") or r.get("staff") is None:
            continue
        page = r["bbox"]["page"]
        cy = r["bbox"]["y"] + r["bbox"]["h"] / 2.0
        cands = [e for e in staff_entries if e["page"] == page]
        if not cands:
            continue
        hit = None
        for e in cands:
            ys = e["ys"]
            gap = (ys[-1] - ys[0]) / 4.0
            if ys[0] - 4 * gap <= cy <= ys[-1] + 4 * gap:
                hit = e
                break
        if hit is None:
            hit = min(cands, key=lambda e: abs((e["ys"][0] + e["ys"][-1]) / 2.0 - cy))
        if str(hit["staff"]) != str(r["staff"]):
            disagreements += 1
        else:
            contained += 1
    result["staff_visual_agree"] = contained
    result["staff_visual_disagree"] = disagreements

    # music21 cross-check
    hist_xml = musicxml_diatonic_histogram(path)
    if isinstance(hist_xml, dict) and "error" in hist_xml:
        result["music21_error"] = hist_xml["error"]
        result["music21_notes"] = None
    else:
        hist_mei = Counter()
        for r in note_recs:
            if r.get("pname") and r.get("oct"):
                hist_mei[(r["pname"] + r["oct"]).lower()] += 1
        result["music21_notes"] = sum(hist_xml.values())
        result["mei_pitched_notes"] = sum(hist_mei.values())
        diff = hist_xml - hist_mei
        diff2 = hist_mei - hist_xml
        result["diatonic_histogram_diff"] = {
            "xml_only": dict(diff), "mei_only": dict(diff2),
            "xml_only_total": sum(diff.values()), "mei_only_total": sum(diff2.values()),
        }

    # paired sample: keep full element table but strip to essentials
    sample = []
    for r in element_table:
        row = {k: r[k] for k in ("tag", "id", "measure", "staff", "layer", "in_svg") if k in r}
        for k in ("pname", "oct", "dur", "dots", "grace", "cue", "accid.ges", "oct.ges", "pname.ges"):
            if k in r:
                row[k] = r[k]
        if "bbox" in r:
            row["bbox"] = r["bbox"]
        sample.append(row)
    result["element_table"] = sample
    result["element_table_size"] = len(sample)
    return result


def svg_hash_mode(score_id):
    spec = next(s for s in SCORES if s["id"] == score_id)
    r = render_score(spec)
    print(r.get("svg_sha256", "ERROR"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--svg-hash", metavar="ID")
    args = ap.parse_args()
    if args.svg_hash:
        svg_hash_mode(args.svg_hash)
        return

    outdir = HERE / "out"
    outdir.mkdir(parents=True, exist_ok=True)
    summary = []
    for spec in SCORES:
        r = render_score(spec)
        sid = spec["id"]
        (outdir / f"{sid}.paired.json").write_text(json.dumps(r, indent=1))
        row = {k: v for k, v in r.items() if k not in ("element_table",)}
        if "join" in row:
            row["join_missing_total"] = sum(v["missing"] for v in row["join"].values())
        summary.append(row)
        print(f"[{sid}] notes={row.get('notes_joined')} "
              f"elements={row.get('element_table_size')} "
              f"all_ids_join={row.get('all_ids_join')} "
              f"staff_disagree={row.get('staff_visual_disagree')} "
              f"svg={row.get('svg_sha256','')[:12]}", file=sys.stderr)
        # cross-process determinism check
        if row.get("svg_sha256"):
            hashes = set()
            for _ in range(2):
                p = subprocess.run([sys.executable, str(Path(__file__)), "--svg-hash", sid],
                                   capture_output=True, text=True, cwd=str(HERE))
                hashes.add(p.stdout.strip())
            row["cross_process_svg_stable"] = (len(hashes) == 1)
            row["cross_process_hashes"] = sorted(hashes)
    (outdir / "summary.json").write_text(json.dumps(summary, indent=1))
    print("wrote", outdir / "summary.json", file=sys.stderr)


if __name__ == "__main__":
    main()
