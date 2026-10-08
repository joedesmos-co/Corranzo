#!/usr/bin/env python3
"""P3/P5 — canonical PianoEvent builder.

Enriches pilot objects with onset, chord membership, relationship links,
governing state, barlines, text and navigation, producing one canonical event
record per object plus page/measure state. Every object is either joined or
counted in an explicit residual; the builder fails a score otherwise.

Outputs: train/data/events/<sid>.events.json.gz + manifests/v1_events.json
"""
from __future__ import annotations
import gzip
import hashlib
import html
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
OBJECTS = PILOT / "data" / "objects"
OUTDIR = TRAIN / "data" / "events"

MEI_NS = "{http://www.music-encoding.org/ns/mei}"
XML_ID = "{http://www.w3.org/XML/1998/namespace}id"
STEP_NUM = {"c": 0, "d": 1, "e": 2, "f": 3, "g": 4, "a": 5, "b": 6}
ACCID_ALTER = {"s": 1, "f": -1, "n": 0, "ss": 2, "x": 2, "ff": -2}


def midi_of(pname, octv, acc):
    return 12 * (int(octv) + 1) + {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}[pname.lower()] \
        + ACCID_ALTER.get((acc or "n").lower(), 0)


def step_index(pname, octv):
    return int(octv) * 7 + STEP_NUM[pname.lower()]


def notehead_x_map(svgs):
    """note mei id -> notehead translate x (SVG units)."""
    out = {}
    for svg in svgs:
        for m in re.finditer(r'<g\b[^>]*id="([^"]+)"[^>]*class="note"[^>]*>(.{0,800}?)<use[^>]*translate\(([-0-9.]+),',
                             svg, re.S):
            nid, body, x = m.group(1), m.group(2), m.group(3)
            if "notehead" in body and nid not in out:
                out[nid] = float(x)
    return out


def svg_groups_by_class(svgs, cls):
    """layout id -> (page, bbox) for groups of a class with bbox rects."""
    out = {}
    for pg, svg in enumerate(svgs, 1):
        for m in re.finditer(r'<g id="([^"]+)" class="%s"[^>]*>' % cls, svg):
            gid = m.group(1)
            b = re.search(r'<g id="bbox-%s"[^>]*>\s*<rect([^/]*)/>' % re.escape(gid), svg)
            bb = None
            if b:
                a = dict(re.findall(r'([\w.-]+)="([^"]*)"', b.group(1)))
                try:
                    bb = {"page": pg, "x": float(a["x"]), "y": float(a["y"]),
                          "w": float(a["width"]), "h": float(a["height"])}
                except KeyError:
                    pass
            out[gid] = {"page": pg, "bbox": bb}
    return out


def svg_text_groups(svgs):
    out = []
    for pg, svg in enumerate(svgs, 1):
        for m in re.finditer(r'<g id="([^"]+)" class="(?:text|dir|tempo|reh|harm)\b[^"]*"[^>]*>', svg):
            gid = m.group(1)
            # balanced scan to the group's real end (self-closing milestones!)
            depth, pos = 1, m.end()
            body_end = None
            for t in re.finditer(r'<g\b([^>]*?)/>|<g\b([^>]*)>|</g>', svg[m.end():]):
                tok = t.group(0)
                if tok == "</g>":
                    depth -= 1
                    if depth == 0:
                        body_end = m.end() + t.start()
                        break
                elif not tok.endswith("/>"):
                    depth += 1
            body = svg[m.end():body_end] if body_end else ""
            txt = " ".join(re.findall(r"<tspan[^>]*>([^<]*)</tspan>", body)).strip()
            b = re.search(r'<g id="bbox-%s"[^>]*>\s*<rect([^/]*)/>' % re.escape(gid), svg)
            bb = None
            if b:
                a = dict(re.findall(r'([\w.-]+)="([^"]*)"', b.group(1)))
                try:
                    bb = {"page": pg, "x": float(a["x"]), "y": float(a["y"]),
                          "w": float(a["width"]), "h": float(a["height"])}
                except KeyError:
                    pass
            if bb is None:
                # text groups often carry no rect of their own; the geometry
                # lives in descendant rects (tspan/cbbox children)
                u = union_bbox(body)
                if u:
                    u["page"] = pg
                    bb = u
            out.append({"svg_id": gid, "page": pg, "text": txt, "bbox": bb})
    return out


def union_bbox(body):
    xs0, ys0, xs1, ys1 = [], [], [], []
    for m in re.finditer(r"<rect([^/]*)/>", body):
        a = dict(re.findall(r'([\w.-]+)="([^"]*)"', m.group(1)))
        try:
            x, y, w, h = float(a["x"]), float(a["y"]), float(a["width"]), float(a["height"])
        except (KeyError, ValueError):
            continue
        if w <= 0 or h <= 0:
            continue
        xs0.append(x)
        ys0.append(y)
        xs1.append(x + w)
        ys1.append(y + h)
    if not xs0:
        return None
    return {"x": min(xs0), "y": min(ys0), "w": max(xs1) - min(xs0), "h": max(ys1) - min(ys0)}


def svg_barlines(svgs):
    """barLine layout id -> measure id via SVG structure."""
    out = []
    for pg, svg in enumerate(svgs, 1):
        cur = None
        for m in re.finditer(r'<g\b([^>]*?)/>|<g\b([^>]*)>|</g>', svg):
            tok = m.group(0)
            if tok == "</g>" or tok.endswith("/>"):
                continue
            attrs = m.group(1) if m.group(1) is not None else m.group(2)
            cm = re.search(r'class="([^"]*)"', attrs)
            im = re.search(r'id="([^"]*)"', attrs)
            cls = cm.group(1) if cm else None
            eid = im.group(1) if im else None
            if cls == "measure":
                cur = eid
            elif cls == "barLine" and eid:
                out.append({"svg_id": eid, "page": pg, "measure": cur})
    return out


def parse_tstamp2(ts):
    """'0m+3.75' -> (measure_offset, beats); '3' -> (0, 3.0)."""
    m = re.match(r"(?:(\d+)m\+)?([0-9.]+)", str(ts))
    if not m:
        return 0, 0.0
    return int(m.group(1) or 0), float(m.group(2))


# SMuFL/private-use accidentals Verovio substitutes when rendering text
PUA_ACCIDENTALS = {"\uea64": "♭", "\uea66": "♯"}


def norm_text(t):
    t = html.unescape(t or "")
    for k, v in PUA_ACCIDENTALS.items():
        t = t.replace(k, v)
    return re.sub(r"\s+", "", t).lower()


def build_score(sid):
    meta = json.loads((RENDER / sid / "meta.json").read_text())
    objs = json.load(gzip.open(OBJECTS / f"{sid}.objects.json.gz", "rt"))
    mei_text = (RENDER / sid / "score.mei").read_text()
    root = ET.fromstring(mei_text)
    svgs = [(RENDER / sid / f"page-{i:02d}.svg").read_text() for i in range(1, meta["pages"] + 1)]

    parent = {c: p for p in root.iter() for c in p}
    by_id = {}
    for el in root.iter():
        eid = el.get(XML_ID)
        if eid:
            by_id[eid] = el

    # staff ppq + measure index/order
    ppq = {}
    measures = []
    for el in root.iter(MEI_NS + "staffDef"):
        if el.get("n") and el.get("ppq"):
            ppq.setdefault(el.get("n"), int(el.get("ppq")))
    for el in root.iter(MEI_NS + "measure"):
        measures.append(el.get(XML_ID))
    mpos = {m: i for i, m in enumerate(measures)}

    # measure forms (barlines) + governing state via ancestry records
    measure_form = {}
    for el in root.iter(MEI_NS + "measure"):
        mid = el.get(XML_ID)
        measure_form[mid] = {"left": el.get("left", "single"), "right": el.get("right", "single")}
    state_decls = defaultdict(list)  # (tag, staff) -> [(pos, attrs)]
    order_counter = [0]
    for el in root.iter():
        tag = el.tag.replace(MEI_NS, "")
        if tag == "measure":
            order_counter[0] += 1
        if tag in ("clef", "keySig", "meterSig"):
            staff = None
            p = parent.get(el)
            while p is not None:
                if p.tag in (MEI_NS + "staff", MEI_NS + "staffDef") and p.get("n"):
                    staff = p.get("n")
                    break
                p = parent.get(p)
            attrs = {k: v for k, v in el.attrib.items() if k != XML_ID}
            state_decls[(tag, staff or "*")].append((order_counter[0], attrs))

    def governing(tag, staff, mid):
        mp = mpos.get(mid, 10 ** 9)
        best = None
        for key in ((tag, str(staff)), (tag, "*")):
            for p, attrs in state_decls.get(key, []):
                if p <= mp + 1:
                    best = attrs
        return best or {}

    # notehead x + beam/tuplet ancestry
    nhx = notehead_x_map(svgs)
    container_of = {}
    for el in root.iter():
        tag = el.tag.replace(MEI_NS, "")
        if tag in ("beam", "tuplet"):
            eid = el.get(XML_ID)
            members = [n.get(XML_ID) for n in el.iter(MEI_NS + "note") if n.get(XML_ID)]
            container_of[eid] = {"tag": tag,
                                 "attrs": {k: v for k, v in el.attrib.items() if k != XML_ID},
                                 "members": members}

    # chord wrappers (present in some scores) -> member note ids
    chord_members = {}
    for el in root.iter(MEI_NS + "chord"):
        cid = el.get(XML_ID)
        if cid:
            chord_members[cid] = [n.get(XML_ID) for n in el.iter(MEI_NS + "note") if n.get(XML_ID)]

    def resolve_ref(ref):
        """A control reference may name a note or a chord; return note ids."""
        nid = ref.lstrip("#") if isinstance(ref, str) else ref
        if nid in chord_members:
            return list(chord_members[nid]), nid
        return [nid], None

    # onset accumulation per (measure, staff, layer)
    acc = defaultdict(int)
    events = []
    by_mei = {}
    residual = []
    for idx, o in enumerate(objs):
        tag = o["tag"]
        ev = {"kind": tag, "id": o.get("mei_id"), "svg_id": o.get("svg_id"),
              "page": (o.get("bbox") or {}).get("page"),
              "measure": o.get("measure"),
              "measure_index": mpos.get(o.get("measure")),
              "staff": o.get("staff"), "voice": o.get("voice"), "layer": o.get("layer"),
              "bbox": o.get("bbox")}
        if tag == "note":
            key = (o.get("measure"), o.get("staff"), o.get("layer"))
            dur_ppq = int(o["dur_ppq"]) if o.get("dur_ppq") not in (None, "") else None
            is_grace = bool(o.get("grace"))
            onset = acc[key]
            ev.update({
                "source_order": o.get("source_order"),
                "onset_ppq": onset,
                "dur_ppq": dur_ppq,
                "dur": o.get("dur"), "dots": int(o.get("dots") or 0),
                "pname": o.get("pname"), "oct": o.get("oct"),
                "oct_ges": o.get("oct_ges"), "accid_ges": o.get("accid_ges"), "accid_ges": o.get("accid_ges"),
                "midi_printed": midi_of(o["pname"], o["oct"], o.get("accid_ges")),
                "midi_source": midi_of(o["pname"], o.get("oct_ges") or o["oct"], o.get("accid_ges")),
                "grace": o.get("grace"), "cue": bool(o.get("cue")),
                "notehead_x": nhx.get(o.get("mei_id")),
                "clef": governing("clef", o.get("staff"), o.get("measure")),
                "key": governing("keySig", o.get("staff"), o.get("measure")),
                "meter": governing("meterSig", o.get("staff"), o.get("measure")),
            })
            clef = ev["clef"] or {}
            ref = {"G": ("e", 4), "F": ("c", 3), "C": ("c", 4)}.get(clef.get("shape", "G"), ("e", 4))
            base = step_index(ref[0], ref[1]) - (int(clef.get("line", 2)) - 1) * 2
            ev["staff_pos_steps"] = step_index(o["pname"], o["oct"]) - base
            if not is_grace and dur_ppq is not None:
                acc[key] += dur_ppq
            # container membership via ancestry
            el = by_id.get(o.get("mei_id"))
            beam = tuplet = None
            p = parent.get(el) if el is not None else None
            seen = 0
            while p is not None and seen < 6:
                t = p.tag.replace(MEI_NS, "")
                if t == "beam" and beam is None:
                    beam = p.get(XML_ID)
                if t == "tuplet" and tuplet is None:
                    tuplet = p.get(XML_ID)
                p = parent.get(p)
                seen += 1
            ev["beam_id"] = beam
            ev["tuplet_id"] = tuplet
            # full container chains (Verovio nests beams for sub/broken beams)
            chains = {"beam": [], "tuplet": []}
            p2 = parent.get(el) if el is not None else None
            seen2 = 0
            while p2 is not None and seen2 < 10:
                t2 = p2.tag.replace(MEI_NS, "")
                if t2 in ("beam", "tuplet") and p2.get(XML_ID):
                    chains[t2].append(p2.get(XML_ID))
                p2 = parent.get(p2)
                seen2 += 1
            ev["beam_chain"] = chains["beam"]
            ev["tuplet_chain"] = chains["tuplet"]
            if el is not None:
                arts = [a.get("artic") for a in el.findall(MEI_NS + "artic") if a.get("artic")]
                if arts:
                    ev["artic"] = arts
                for t, key in (("trill-mark", "trill"), ("mordent", "mordent"), ("turn", "turn")):
                    for c in el.findall(MEI_NS + t):
                        if c.get(XML_ID):
                            ev[key + "_id"] = c.get(XML_ID)
            if ev.get("trill_id") or ev.get("mordent_id") or ev.get("turn_id"):
                ev["ornament"] = True
            if tuplet and tuplet in container_of:
                ev["tuplet_ratio"] = {k: container_of[tuplet]["attrs"].get(k)
                                     for k in ("num", "numbase") if k in container_of[tuplet]["attrs"]}
        elif tag in ("rest", "mRest"):
            key = (o.get("measure"), o.get("staff"), o.get("layer"))
            dur_ppq = None
            try:
                dur_ppq = int(o["dur_ppq"]) if o.get("dur_ppq") not in (None, "") else None
            except (TypeError, ValueError):
                dur_ppq = None
            ev.update({"source_order": o.get("source_order"), "onset_ppq": acc[key],
                       "dur_ppq": dur_ppq, "dur": o.get("dur"),
                       "dots": int(o.get("dots") or 0),
                       "measure_span": dur_ppq is None,
                       "clef": governing("clef", o.get("staff"), o.get("measure")),
                       "key": governing("keySig", o.get("staff"), o.get("measure")),
                       "meter": governing("meterSig", o.get("staff"), o.get("measure"))})
            if dur_ppq is not None:
                acc[key] += dur_ppq
        events.append(ev)
        if ev["id"]:
            by_mei[ev["id"]] = len(events) - 1

    # chord grouping
    chords = defaultdict(list)
    for i, ev in enumerate(events):
        if ev["kind"] == "note" and ev.get("onset_ppq") is not None:
            chords[(ev["measure"], ev["staff"], ev["voice"], ev["onset_ppq"],
                    round(ev["notehead_x"] or -1, 1))].append(i)
    for key, members in chords.items():
        cid = "ch:%s:%s:%s:%s" % key[:4] if len(members) > 1 else None
        for i in members:
            events[i]["chord_id"] = cid
            events[i]["chord_size"] = len(members)

    # relationship links
    def link(ids):
        return [i.lstrip("#") for i in (ids if isinstance(ids, list) else [ids]) if i]

    rel_count = Counter()
    for el in root.iter():
        tag = el.tag.replace(MEI_NS, "")
        eid = el.get(XML_ID)
        if tag in ("tie", "slur", "octave", "gliss"):
            s, e = link(el.get("startid")), link(el.get("endid"))
            sm, sm_via = [], []
            for ref in s:
                notes, via = resolve_ref(ref)
                for x in notes:
                    if x in by_mei:
                        sm.append(by_mei[x])
                        sm_via.append(via)
            em = []
            for ref in e:
                notes, _ = resolve_ref(ref)
                for x in notes:
                    if x in by_mei:
                        em.append(by_mei[x])
            for i in sm:
                events[i].setdefault("links_out", []).append({"rel": tag, "id": eid, "to": e})
            for i in em:
                events[i].setdefault("links_in", []).append({"rel": tag, "id": eid, "from": s})
            if tag == "tie":
                for i in sm:
                    prev = [t for t in events[i].get("ties", []) if t["role"] == "end"]
                    events[i].setdefault("ties", []).append(
                        {"role": "middle" if prev else "start", "tie_id": eid, "partners": e})
                for i in em:
                    prev = [t for t in events[i].get("ties", []) if t["role"] == "start"]
                    events[i].setdefault("ties", []).append(
                        {"role": "middle" if prev else "end", "tie_id": eid, "partners": s})
            if tag == "octave":
                rng = sm + em
                if rng:
                    lo, hi = min(rng), max(rng)
                    stf = events[lo].get("staff")
                    for i in range(lo, hi + 1):
                        if events[i].get("staff") == stf and events[i]["kind"] == "note":
                            events[i]["octave_id"] = eid
            rel_count[tag] += 1
        elif tag == "arpeg":
            members = []
            for ref in (el.get("plist") or "").split():
                notes, _ = resolve_ref(ref)
                members.extend(by_mei[x] for x in notes if x in by_mei)
            for i in members:
                events[i]["arpeg_id"] = eid
            rel_count[tag] += 1
        elif tag in ("trill", "mordent", "turn", "fing"):
            s = []
            for ref in link(el.get("startid")):
                notes, via = resolve_ref(ref)
                for x in notes:
                    if x in by_mei:
                        s.append(by_mei[x])
            for i in s:
                events[i][{"trill": "trill_id", "mordent": "mordent_id",
                           "turn": "turn_id", "fing": "fingering"}[tag]] = eid
                if tag == "fing":
                    events[i]["fingering_form"] = el.get("form", "")
            rel_count[tag] += 1
        elif tag == "pedal":
            rel_count[tag] += 1
        elif tag == "hairpin":
            rel_count[tag] += 1

    # pedal down/up pairing + members via onset ranges
    pedals = []
    for el in root.iter(MEI_NS + "pedal"):
        anc = el
        meas = None
        p = parent.get(el)
        while p is not None:
            if p.tag == MEI_NS + "measure":
                meas = p.get(XML_ID)
                break
            p = parent.get(p)
        pedals.append({"id": el.get(XML_ID), "staff": el.get("staff"),
                       "dir": el.get("dir"), "measure": meas,
                       "tstamp": el.get("tstamp"), "staff_ppq": ppq.get(el.get("staff"), 12)})
    for i in range(0, len(pedals) - 1, 1):
        a, b = pedals[i], pedals[i + 1]
        if a["dir"] == "down" and b["dir"] == "up" and a["staff"] == b["staff"]:
            try:
                o0 = float(a["tstamp"]) * a["staff_ppq"]
                o1 = float(b["tstamp"]) * b["staff_ppq"]
            except (TypeError, ValueError):
                continue
            for j, ev in enumerate(events):
                if (ev["kind"] == "note" and ev.get("staff") == a["staff"]
                        and ev.get("measure") in (a["measure"], b["measure"])
                        and ev.get("onset_ppq") is not None and o0 <= ev["onset_ppq"] <= o1 + 1e-9):
                    ev["pedal_active"] = True

    # hairpin members via tstamp ranges
    for el in root.iter(MEI_NS + "hairpin"):
        anc_meas = None
        p = parent.get(el)
        while p is not None:
            if p.tag == MEI_NS + "measure":
                anc_meas = p.get(XML_ID)
                break
            p = parent.get(p)
        staff = el.get("staff")
        q = ppq.get(staff, 12)
        try:
            mo0, b0 = parse_tstamp2(el.get("tstamp", "1"))
            mo1, b1 = parse_tstamp2(el.get("tstamp2", "4"))
        except (TypeError, ValueError):
            continue
        base = mpos.get(anc_meas, 0)
        lo_key, hi_key = (base + mo0, b0 * q), (base + mo1, b1 * q)
        for ev in events:
            if ev["kind"] != "note" or ev.get("staff") != staff:
                continue
            k = (ev.get("measure_index"), (ev.get("onset_ppq") or 0))
            if lo_key <= k <= hi_key:
                ev["hairpin_id"] = el.get(XML_ID)

    # text events (tempo/dir/reh/harm) + SVG text join via rend ids and
    # content match; repeatMark symbols join by id directly
    texts = []
    svg_ids_all = set()
    for svg in svgs:
        svg_ids_all |= set(re.findall(r'\bid="([^"]+)"', svg))
    stripped_ids = {re.sub(r"^(bbox|cbbox)-", "", i) for i in svg_ids_all}
    rendered_texts = svg_text_groups(svgs)
    for el in root.iter():
        tag = el.tag.replace(MEI_NS, "")
        if tag == "repeatMark":
            eid = el.get(XML_ID)
            texts.append({"kind": "repeatMark", "subtype": tag, "id": eid,
                          "svg_id": eid if eid in svg_ids_all else None,
                          "func": el.get("func"), "staff": el.get("staff"),
                          "text": None, "measure": None, "page": None, "bbox": None,
                          "attrs": {k: v for k, v in el.attrib.items() if k != XML_ID}})
            continue
        if tag in ("tempo", "dir", "reh", "harm"):
            s = "".join(el.itertext()).strip()
            meas = None
            staff = el.get("staff")
            p = parent.get(el)
            while p is not None:
                if p.tag == MEI_NS + "measure":
                    meas = p.get(XML_ID)
                    break
                if staff is None and p.tag in (MEI_NS + "staff", MEI_NS + "staffDef") and p.get("n"):
                    staff = p.get("n")
                p = parent.get(p)
            rend_ids = [c.get(XML_ID) for c in el.iter()
                        if c.tag.replace(MEI_NS, "") in ("rend",) and c.get(XML_ID)]
            hit = None
            if el.get(XML_ID) in stripped_ids:
                hit = el.get(XML_ID)
            else:
                for rid in rend_ids:
                    if rid in stripped_ids:
                        hit = rid
                        break
            rec = {"kind": "text", "subtype": tag, "id": el.get(XML_ID),
                   "text": s, "measure": meas,
                   "measure_index": mpos.get(meas), "staff": staff,
                   "attrs": {k: v for k, v in el.attrib.items() if k != XML_ID}}
            if hit:
                g = next((r for r in rendered_texts if r["svg_id"] == hit
                          or r["svg_id"] in (f"bbox-{hit}", f"cbbox-{hit}")), None)
                if g is None and s:
                    cands = [r for r in rendered_texts if norm_text(r["text"]) == norm_text(s)]
                    g = cands[0] if cands else None
                if g:
                    rec["svg_id"] = g["svg_id"]
                    rec["page"] = g["page"]
                    rec["bbox"] = g["bbox"]
                    rec["svg_text"] = g["text"]
            if not s:
                rec["empty_text"] = True
            texts.append(rec)

    # endings + barlines + measure numbers
    endings = []
    for el in root.iter(MEI_NS + "ending"):
        ms = [m.get(XML_ID) for m in el.iter(MEI_NS + "measure")]
        endings.append({"kind": "ending", "id": el.get(XML_ID), "n": el.get("n"),
                        "measures": ms})
    barlines = []
    for b in svg_barlines(svgs):
        form = None
        if b["measure"] in measure_form:
            form = measure_form[b["measure"]]["right"]
        barlines.append({"kind": "barline", "svg_id": b["svg_id"], "page": b["page"],
                         "measure": b["measure"],
                         "measure_index": mpos.get(b["measure"]),
                         "form": form})

    # residuals: objects without svg identity (excluding state/text handled)
    residual = []
    for o in objs:
        if o["tag"] in ("note", "rest", "mRest", "multiRest") and not o.get("svg_id"):
            residual.append(o.get("mei_id"))
    return {"score_id": sid, "events": events, "texts": texts, "endings": endings,
            "barlines": barlines, "rel_count": dict(rel_count),
            "residual_unjoined": residual, "n_measures": len(measures)}


def main():
    only = sys.argv[1:] or None
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from v1_inventory import load_split
    sids = []
    for split in ("train", "dev"):
        sids.extend(load_split(split))
    if only:
        sids = [s for s in sids if s in set(only)]
    OUTDIR.mkdir(parents=True, exist_ok=True)
    status = {}
    for k, sid in enumerate(sids):
        try:
            rec = build_score(sid)
            blob = json.dumps(rec, separators=(",", ":")).encode()
            (OUTDIR / f"{sid}.events.json.gz").write_bytes(
                __import__("gzip").compress(blob))
            status[sid] = {"ok": True, "events": len(rec["events"]),
                           "residual": len(rec["residual_unjoined"])}
            if rec["residual_unjoined"]:
                status[sid] = {"ok": False, "reason": "residual_unjoined",
                               "ids": rec["residual_unjoined"][:5]}
        except Exception as e:
            status[sid] = {"ok": False, "reason": f"exception:{str(e)[:160]}"}
        if (k + 1) % 100 == 0:
            print(f"[events] {k+1}/{len(sids)}", file=sys.stderr, flush=True)
    out = TRAIN / "manifests" / "v1_events.json"
    out.write_text(json.dumps({"schema": "piano-v1-events/1", "scores": status}, indent=1))
    ok = sum(1 for v in status.values() if v.get("ok"))
    print(f"[events] ok {ok}/{len(status)} -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
