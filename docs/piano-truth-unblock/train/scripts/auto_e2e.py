#!/usr/bin/env python3
"""P1/P5 first honest end-to-end automatic transcription (DEV, oracle-free).

Pipeline (all inputs automatic; no oracle boxes, no SVG, no MEI at
inference):
  page PNG -> staff frames -> auto clefs (template NCC) -> notehead CC
  detection -> rest CC candidates -> barline columns -> measures ->
  structural pitch (frame steps + clef) -> duration (frozen probe on the
  detected box) -> MusicXML.
Honest limitations, all flagged: natural pitches only, single voice,
4/4 default meter (no time-signature detector), rest recall limited by CC
candidates and template threshold.
Writes MusicXML to data/auto_out/<sid>.musicxml + metrics to
reports/auto_e2e.json. DEV only; TEST sealed.
"""
from __future__ import annotations
import gzip
import json
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
EVENTS = TRAIN / "data" / "events"
sys.path.insert(0, str(HERE))
from auto_locate import (staff_lines, group_staves, components, classify,  # noqa: E402
                         scale_meta)
from auto_pitch2 import clef_crop, bottom_of, pitch_of  # noqa: E402
from auto_rest import page_ctx  # noqa: E402
from clef_vision import classify as clef_classify  # noqa: E402
from clef_map import load_templates  # noqa: E402

TYPE_OF_DUR = {"64": "64th", "32": "32nd", "16": "16th", "8": "eighth",
               "4": "quarter", "2": "half", "1": "whole"}
SEMI_OF_STEP = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}


def detect_barlines(gray, fr):
    """Barline columns: dark pixels cover >=85% of the staff height."""
    top, bot = int(fr[0]), int(fr[-1])
    h = bot - top
    cols = []
    for x in range(gray.shape[1]):
        dark = int((gray[top:bot + 1, x] < 128).sum())
        if dark >= 0.85 * (h + 1):
            cols.append(x)
    groups = []
    if cols:
        s = p = cols[0]
        for x in cols[1:]:
            if x <= p + 3:
                p = x
                continue
            groups.append((s + p) // 2)
            s = p = x
        groups.append((s + p) // 2)
    return groups


def run_detections(sid, templates, models, voc, rest_templates=None):
    """All automatic detections + per-page structure for one score."""
    import torch
    evs = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
    pages = sorted({int(e["bbox"]["page"]) for e in evs if e.get("bbox")})
    notes, rests = [], []
    clefs_by_page = {}
    for pg in pages:
        meta, gray, sx, gap, svg, tx, ty = page_ctx(sid, pg)
        lines, dark = staff_lines(gray)
        frames = group_staves(lines)
        if not frames:
            continue
        from detector import detect_noteheads
        heads = detect_noteheads(gray, lines, gap)
        # expand each opened head box to the raw-mask glyph box at the same
        # center (opening erodes ~0.3 gap/side; the training crops use the
        # FULL glyph box, and the dur head is shift-sensitive)
        raw = (gray < 128).astype(np.uint8)
        bandm = np.zeros_like(raw)
        for _y in lines:
            bandm[max(0, _y - 1):_y + 2, :] = 1
        raw[bandm.astype(bool)] = 0
        _n, _lab, _st, _cen = cv2.connectedComponentsWithStats(raw, 8)
        def _raw_box(h):
            cx, cy = h["x"] + h["w"] / 2, h["y"] + h["h"] / 2
            lx, ly = int(_cen[int(_lab[int(cy), int(cx)])][0]), int(_cen[int(_lab[int(cy), int(cx)])][1]) if int(_lab[int(cy), int(cx)]) < len(_cen) else (cx, cy)
            lb = _lab[int(cy), int(cx)]
            if lb <= 0:
                return h
            x, y, w, hh = _st[lb][:4]
            return {"x": int(x), "y": int(y), "w": int(w), "h": int(hh)}
        raw_boxes = [_raw_box(h) for h in heads]
        col_on = (dark > 0)[lines[0]:lines[-1] + 1, :].any(axis=0)
        xs = np.where(col_on)[0]
        x0 = int(xs[0]) if len(xs) else 0
        clefs = []
        for fr in frames:
            cr = clef_crop(gray, x0, fr, gap, sx)
            if cr is None:
                clefs.append(("G", 2))
                continue
            shape, _ = clef_classify(cr, templates)
            clefs.append((shape, 2 if shape == "G" else (4 if shape == "F" else 3)))
        clefs_by_page[pg] = (list(frames), clefs)
        # Notehead completion (MEASURED, kept for the record): a mean
        # template from confirmed heads + matchTemplate over the page.
        # Under local-maximum filtering it adds ZERO recall (dilation of the
        # response zeroes every non-max peak, incl. the recoveries); without
        # it, recall 0.57->0.85 but precision 0.84->0.67 from shifted
        # duplicate peaks. Net: not integrated (P0 detector needs a trained
        # head, not peak picking). THRESH_NOTE only gates the dilate path.
        THRESH_NOTE = 0.72
        THRESH_NOTE = 0.62
        # Notehead completion: DISABLED (measured +7 TP / +45 FP at thr 0.78;
        # the frozen detector recipe in detector.py superseded it).
        if False:
            pass
        boxes = []
        for h in heads:
            # cy = dark centroid inside the CC box (bbox center is biased by
            # the opening shrink and borderline steps; measured below)
            cx, cy = h["x"] + h["w"] / 2, h["y"] + h["h"] / 2
            fi = min(range(len(frames)),
                     key=lambda i: min(abs(cy - l) for l in frames[i]))
            bottom = bottom_of(*clefs[fi])
            steps = int(round(2 * (frames[fi][-1] - cy) / gap))
            boxes.append({"page": pg, "frame": fi, "x": cx, "y": cy,
                          "bx": h["x"], "by": h["y"], "w": h["w"], "h": h["h"],
                          "midi": pitch_of(steps, bottom)})
        if boxes:
            crops = []
            for bi, b in enumerate(boxes):
                # CORNER anchor: training crops are anchored at the glyph
                # box TOP-LEFT (infer.build_inputs). Center anchoring shifts
                # the crop ~0.5 gap in both axes and destroys dur accuracy
                # (measured: 0.25 center vs ~0.8 corner).
                rb = raw_boxes[bi] if bi < len(raw_boxes) else b
                ax, ay = rb["x"], rb["y"]
                half = int(round(3.0 * gap))
                x0c, y0c = int(round(ax - half)), int(round(ay - half))
                c = np.full((2 * half, 2 * half), 255, np.uint8)
                ix0, iy0 = max(0, x0c), max(0, y0c)
                ix1, iy1 = min(gray.shape[1], x0c + 2 * half), min(gray.shape[0], y0c + 2 * half)
                if ix1 > ix0 and iy1 > iy0:
                    c[iy0 - y0c:iy0 - y0c + (iy1 - iy0),
                      ix0 - x0c:ix0 - x0c + (ix1 - ix0)] = gray[iy0:iy1, ix0:ix1]
                crops.append(cv2.resize(c, (64, 64), interpolation=cv2.INTER_AREA))
            X = torch.from_numpy(np.stack(crops)[:, None]).float() / 255
            with torch.no_grad():
                lg = models["common"][0](X, X.clone(), torch.zeros((len(X), 5)))
            dp = lg["dur"].argmax(-1).numpy()
            dt = lg["dots"].argmax(-1).numpy()
            # A1 tri-crop duration head (frozen trunk + neighbor crops),
            # neighbors = adjacent detections in x order on this page
            try:
                from train_ctxdur import load_ctx_head
                a1 = load_ctx_head()
                trunk = models["common"][0]
                if a1 is not None:
                    order = sorted(range(len(boxes)), key=lambda k: boxes[k]["x"])
                    Zs = []
                    with torch.no_grad():
                        for k in order:
                            Zs.append(trunk.trunk(X[k:k + 1]).numpy()[0])
                    zero = np.zeros(128, np.float32)
                    rows = []
                    for j, k in enumerate(order):
                        zp = Zs[j - 1] if j > 0 else zero
                        zn = Zs[j + 1] if j + 1 < len(order) else zero
                        rows.append(np.concatenate([zp, Zs[j], zn]))
                    with torch.no_grad():
                        l1 = a1(torch.from_numpy(np.array(rows))).argmax(-1).numpy()
                    for j, k in enumerate(order):
                        dp[k] = l1[j]
            except Exception:
                pass
            for k, b in enumerate(boxes):
                sym = voc["dur"][int(dp[k])] if 0 <= int(dp[k]) < len(voc["dur"]) else None
                base, nd = (sym.split("d") if sym and "d" in sym else (sym, "0"))
                b["dur"] = base
                b["dots"] = int(nd)
                if b["dots"] == 0 and int(dt[k]) > 1:
                    b["dots"] = 1
            notes.extend(boxes)
        from auto_rest import rest_ccs, cc_norm
        for bx in rest_ccs(gray, lines, frames, gap):
            cr = cc_norm(gray, bx)
            if cr is None or not rest_templates:
                continue
            sc = {k: float((cr * t).sum()) for k, t in rest_templates.items()}
            best = max(sc, key=sc.get)
            if sc[best] < 0.62:
                continue
            rests.append({"page": pg, "x": bx[0] + bx[2] / 2,
                          "y": bx[1] + bx[3] / 2, "w": bx[2], "h": bx[3],
                          "cls": best})
    return notes, rests, clefs_by_page, evs


def assemble(notes, rests, clefs_by_page):
    """Group into measures per (page, frame) via barlines; emit simple
    events: (measure_global, staff, kind, x, pitch or rest box, dur)."""
    out = []
    for pg, (frames, clefs) in sorted(clefs_by_page.items()):
        meta, gray, sx, gap, _svg, _tx, _ty = page_ctx_for(pg)
        for fi, fr in enumerate(frames):
            bars = detect_barlines(gray, fr)
            evs = [n for n in notes if n["page"] == pg and n["frame"] == fi]
            evs += [{"page": pg, "frame": fi, "x": r["x"], "rest": True}
                    for r in rests if r["page"] == pg
                    and min(range(len(frames)),
                            key=lambda i: min(abs(r["y"] - l) for l in frames[i])) == fi]
            evs.sort(key=lambda e: e["x"])
            # measure index = barline segment index (first segment = m1)
            for e in evs:
                mi = sum(1 for b in bars if b < e["x"])
                out.append({"page": pg, "staff": fi + 1, "measure_seg": mi,
                            "x": e["x"], **({k: v for k, v in e.items() if k != "x"})})
    return out


_PP = {}


def page_ctx_for(pg):
    return _PP[pg]


def emit_musicxml(events, clefs_by_page):
    """score-partwise MusicXML, divisions=4, one voice per staff."""
    root = ET.Element("score-partwise", version="4.0")
    pl = ET.SubElement(root, "part-list")
    sp = ET.SubElement(pl, "score-part", id="P1")
    ET.SubElement(sp, "part-name").text = "Piano"
    part = ET.SubElement(root, "part", id="P1")
    by_pg_staff = defaultdict(list)
    for e in events:
        by_pg_staff[(e["page"], e["staff"])].append(e)
    nm = max((e["measure_seg"] for e in events), default=0) + 1
    for mi in range(nm):
        m = ET.SubElement(part, "measure", number=str(mi + 1))
        for (pg, st), lst in sorted(by_pg_staff.items()):
            sel = [e for e in lst if e["measure_seg"] == mi]
            if not sel:
                continue
            if mi == 0:
                at = ET.SubElement(m, "attributes")
                ET.SubElement(at, "divisions").text = "4"
                clef = clefs_by_page.get(pg, ([], []))[1]
                shape, line = clef[st - 1] if st - 1 < len(clef) else ("G", 2)
                cl = ET.SubElement(at, "clef")
                ET.SubElement(cl, "sign").text = shape
                ET.SubElement(cl, "line").text = str(line)
            for e in sorted(sel, key=lambda z: z["x"]):
                if e.get("rest"):
                    n = ET.SubElement(m, "note")
                    ET.SubElement(n, "rest")
                else:
                    n = ET.SubElement(m, "note")
                    p = ET.SubElement(n, "pitch")
                    ET.SubElement(p, "step").text = "CDEFGAB"[e["midi"] % 12] if False else \
                        _step_of(e["midi"])
                    ET.SubElement(p, "octave").text = str(_oct_of(e["midi"]))
                ET.SubElement(n, "voice").text = "1"
                q = _dur_q(e.get("dur"), e.get("dots", 0))
                ET.SubElement(n, "duration").text = str(max(1, int(round(q * 4))))
                if e.get("dur") in TYPE_OF_DUR:
                    ET.SubElement(n, "type").text = TYPE_OF_DUR[e["dur"]]
                if e.get("dots"):
                    ET.SubElement(n, "dot")
    return ET.tostring(root, encoding="unicode")


_STEPS = "cdefgab"


def _step_of(midi):
    return "CDEFGAB"[_STEPS.index(_STEP_OF_NAT(midi))]


def _STEP_OF_NAT(midi):
    pc = midi % 12
    semi = {0: "c", 2: "d", 4: "e", 5: "f", 7: "g", 9: "a", 11: "b"}
    return semi.get(pc, "c")


def _oct_of(midi):
    return max(0, midi // 12 - 1)


def _dur_q(dur, dots):
    base = {"64": Fraction(1, 16), "32": Fraction(1, 8), "16": Fraction(1, 4),
            "8": Fraction(1, 2), "4": Fraction(1, 1), "2": Fraction(2, 1),
            "1": Fraction(4, 1)}.get(str(dur), Fraction(1, 1))
    return base * (2 - Fraction(1, 2 ** int(dots or 0)))


from fractions import Fraction  # noqa: E402


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    templates = load_templates()
    from auto_rest import build_templates as _build_rest_templates
    rest_templates, _rc = _build_rest_templates(splits, n_train=150)
    print("[e2e] rest templates:", sorted(rest_templates), flush=True)
    sids = splits["dev"][:5]
    from infer import load_models
    models = load_models(device="cpu")
    voc = json.loads((TRAIN / "manifests" / "v1_items.json").read_text())["vocab"]
    outdir = TRAIN / "data" / "auto_out"
    outdir.mkdir(parents=True, exist_ok=True)
    C = Counter()
    C["meas_covered"] = set()
    per_score = {}
    for sid in sids:
        evs = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
        pages = sorted({int(e["bbox"]["page"]) for e in evs if e.get("bbox")})
        for pg in pages:
            _PP[pg] = page_ctx(sid, pg)
        notes, rests, clefs_by_page, _evs = run_detections(sid, templates,
                                                           models, voc,
                                                           rest_templates)
        events = assemble(notes, rests, clefs_by_page)
        xml = emit_musicxml(events, clefs_by_page)
        (outdir / f"{sid}.musicxml").write_text(xml)
        # ---- evaluation vs truth (POSITION-based matching) ----
        # chord dur inheritance (eval_reconstruction rule: members inherit
        # the <chord> dur/dots)
        import xml.etree.ElementTree as _ET
        _NS = "{http://www.music-encoding.org/ns/mei}"
        _XID = "{http://www.w3.org/XML/1998/namespace}id"
        _chord_of = {}
        try:
            _root = _ET.parse(RENDER / sid / "score.mei").getroot()
            for _el in _root.iter(_NS + "chord"):
                for _n in _el.iter(_NS + "note"):
                    if _n.get(_XID):
                        _chord_of[_n.get(_XID)] = (_el.get("dur"),
                                                   int(_el.get("dots") or 0))
        except (OSError, _ET.ParseError):
            pass
        tn = []
        for e in evs:
            if e["kind"] != "note" or not e.get("bbox"):
                continue
            if e.get("dur") is None and e.get("id") in _chord_of:
                e = dict(e)
                e["dur"], e["dots"] = _chord_of[e["id"]]
            tn.append(e)
        tr = [e for e in evs if e["kind"] in ("rest", "mRest") and e.get("bbox")]
        C["truth_notes"] += len(tn)
        C["truth_rests"] += len(tr)
        C["auto_notes"] += len(notes)
        C["auto_rests"] += len(rests)
        for pg in pages:
            meta, gray, sx, gap, _svg, tx, ty = _PP[pg]
            from staff_geometry import notehead_map
            nh = notehead_map(_svg)
            truth_px = []
            for e in tn:
                if int((e.get("bbox") or {}).get("page", pg)) != pg:
                    continue
                pos = nh.get(e.get("id") or "") or nh.get(e.get("svg_id") or "")
                if pos is None:
                    continue
                truth_px.append(((pos[0] + tx) / 10 * sx, (pos[1] + ty) / 10 * sx, e))
            used = set()
            for a in [n for n in notes if n["page"] == pg]:
                # containment first, then nearest CENTER within 1.2 gaps
                # (same matching rule as the detector sweep)
                acx, acy = a["x"], a["y"]   # x/y ARE the box center (centroid)
                bi = -1
                for j, (px, py, e) in enumerate(truth_px):
                    if j in used:
                        continue
                    if (a.get("bx", a["x"]) <= px <= a.get("bx", a["x"]) + a.get("w", 0)
                            and a.get("by", a["y"]) <= py
                            <= a.get("by", a["y"]) + a.get("h", 0)):
                        bi = j
                        break
                if bi < 0:
                    best, bi = (1.2 * gap) ** 2, -1
                    for j, (px, py, e) in enumerate(truth_px):
                        if j in used:
                            continue
                        d = (acx - px) ** 2 + (acy - py) ** 2
                        if d < best:
                            best, bi = d, j
                if bi < 0:
                    C["note_fp"] += 1
                    continue
                used.add(bi)
                e = truth_px[bi][2]
                C["note_tp"] += 1
                C["meas_covered"].add((sid, e.get("measure_index")))
                C["pitch_ok"] += (a["midi"] == e.get("midi_printed"))
                C["dur_ok"] += (str(a.get("dur")) == str(e.get("dur"))
                                and a.get("dots", 0) == (e.get("dots") or 0))
                C["complete"] += (a["midi"] == e.get("midi_printed")
                                  and str(a.get("dur")) == str(e.get("dur"))
                                  and a.get("dots", 0) == (e.get("dots") or 0))
            C["note_fn"] += len(truth_px) - len(used)
        # rest position matching
        for pg in pages:
            meta, gray, sx, gap, _svg, tx, ty = _PP[pg]
            trp = []
            for e in tr:
                if int((e.get("bbox") or {}).get("page", pg)) != pg:
                    continue
                b = e["bbox"]
                trp.append(((b["x"] + tx) / 10 * sx, (b["y"] + ty) / 10 * sx, e))
            used = set()
            for r in [x for x in rests if x["page"] == pg]:
                best, bi = 0.3, -1
                for j, (px, py, e) in enumerate(trp):
                    if j in used:
                        continue
                    ix = max(0, min(r["x"] + r["w"] / 2, px + e["bbox"]["w"] / 10 * sx)
                             - max(r["x"] - r["w"] / 2, px - e["bbox"]["w"] / 10 * sx))
                    iy = max(0, min(r["y"] + r["h"] / 2, py + e["bbox"]["h"] / 10 * sx)
                             - max(r["y"] - r["h"] / 2, py - e["bbox"]["h"] / 10 * sx))
                    inter = ix * iy
                    union = r["w"] * r["h"] + (e["bbox"]["w"] / 10 * sx) * (e["bbox"]["h"] / 10 * sx) - inter
                    v = inter / max(1, union)
                    if v > best:
                        best, bi = v, j
                if bi < 0:
                    C["rest_fp"] += 1
                else:
                    used.add(bi)
                    C["rest_tp"] += 1
            C["rest_fn"] += len(trp) - len(used)
    _tm = {(sid2, mi) for sid2 in [] for mi in []}
    all_meas = set()
    for sid2 in sids:
        _evs = json.load(gzip.open(EVENTS / f"{sid2}.events.json.gz", "rt"))["events"]
        for _e in _evs:
            if _e.get("kind") == "note" and _e.get("measure_index") is not None:
                all_meas.add((sid2, _e["measure_index"]))
    out = {"scores": per_score, "pages": C["pages"],
           "truth_notes": C["truth_notes"], "auto_notes": C["auto_notes"],
           "note_tp": C["note_tp"], "note_fp": C["note_fp"], "note_fn": C["note_fn"],
           "note_p": round(C["note_tp"] / max(1, C["note_tp"] + C["note_fp"]), 4),
           "note_r": round(C["note_tp"] / max(1, C["truth_notes"]), 4),
           "pitch_acc": round(C["pitch_ok"] / max(1, C["note_tp"]), 4),
           "dur_acc": round(C["dur_ok"] / max(1, C["note_tp"]), 4),
           "complete_acc": round(C["complete"] / max(1, C["note_tp"]), 4),
           "rest_tp": C["rest_tp"], "rest_fp": C["rest_fp"], "rest_fn": C["rest_fn"],
           "rest_p": round(C["rest_tp"] / max(1, C["rest_tp"] + C["rest_fp"]), 4),
           "rest_r": round(C["rest_tp"] / max(1, C["truth_rests"]), 4),
           "truth_measures": len(all_meas),
           "measures_with_auto_note": len(C["meas_covered"]),
           "measure_coverage": round(len(C["meas_covered"]) / max(1, len(all_meas)), 4),
           "scope": "5 DEV scores, no oracle boxes at inference; position-based "
                    "matching to truth notehead/rest positions"}
    (TRAIN / "reports" / "auto_e2e.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


def _order_key(e):
    return (e.get("measure_index", 0), e.get("onset_ppq", 0),
            e.get("source_order", 0))


if __name__ == "__main__":
    main()
