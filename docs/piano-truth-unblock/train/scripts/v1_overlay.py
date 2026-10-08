#!/usr/bin/env python3
"""P9 — expanded visual QA: overlays for tuplets, ties/slurs, beams, dynamics,
pedal, octave shifts, grace/cue, fingerings, ornaments, arpeggios, glissandi,
text/tempo, multi-voice and cross-staff, verifying visual position AND
semantic ownership (endpoints resolve to the truth note ids).

Deterministic TRAIN/DEV page sample covering every class. No predictions.
"""
from __future__ import annotations
import gzip
import hashlib
import json
import re
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
EVENTS = TRAIN / "data" / "events"
QA = TRAIN / "qa" / "v1"


def load_split(name):
    raw = json.loads((PILOT / "manifests" / "splits.json").read_text())
    out = list(raw[name])
    del raw
    return out


def page_xy(bbox, tx, ty, sx):
    x0 = int((bbox["x"] + tx) / 10 * sx)
    y0 = int((bbox["y"] + ty) / 10 * sx)
    x1 = int((bbox["x"] + bbox["w"] + tx) / 10 * sx)
    y1 = int((bbox["y"] + bbox["h"] + ty) / 10 * sx)
    return x0, y0, x1, y1


def main():
    train_ids = set(load_split("train"))
    dev_ids = set(load_split("dev"))
    # find pages containing each target class (deterministic order)
    want = ["tuplet", "tie", "slur", "beam", "dynam", "hairpin", "pedal",
            "octave", "grace", "cue", "fingering", "ornament", "arpeg",
            "gliss", "tempo_text", "multivoice", "crossstaff"]
    pages = []
    seen_classes = set()
    for sid in sorted(train_ids | dev_ids,
                      key=lambda s: hashlib.sha256(f"piano-v1qa|{s}".encode()).hexdigest()):
        p = EVENTS / f"{sid}.events.json.gz"
        if not p.is_file():
            continue
        r = json.load(gzip.open(p, "rt"))
        evs = r["events"]
        by_page = {}
        for e in evs:
            if e["kind"] == "note" and e.get("bbox"):
                by_page.setdefault(int(e["bbox"]["page"]), []).append(e)
        for pg, notes in by_page.items():
            classes = set()
            if any(e.get("tuplet_id") for e in notes):
                classes.add("tuplet")
            if any(e.get("ties") for e in notes):
                classes.add("tie")
            if any("slur" in {l["rel"] for l in e.get("links_out", [])} for e in notes):
                classes.add("slur")
            if any(e.get("beam_id") for e in notes):
                classes.add("beam")
            if any(e.get("pedal_active") for e in notes):
                classes.add("pedal")
            if any(e.get("octave_id") for e in notes):
                classes.add("octave")
            if any(e.get("grace") for e in notes):
                classes.add("grace")
            if any(e.get("cue") for e in notes):
                classes.add("cue")
            if any(e.get("fingering") for e in notes):
                classes.add("fingering")
            if any(e.get("ornament") for e in notes):
                classes.add("ornament")
            if any(e.get("fingering") for e in notes):
                classes.add("fingering")
            if any(e.get("arpeg_id") for e in notes):
                classes.add("arpeg")
            if any("gliss" in {l["rel"] for l in e.get("links_out", [])} for e in notes):
                classes.add("gliss")
            if any(e.get("hairpin_id") for e in notes):
                classes.add("hairpin")
            if any(e.get("tuplet_id") is None and False for e in notes):
                pass
            if len({e.get("voice") for e in notes}) > 1:
                classes.add("multivoice")
            if any(e.get("staff") == "2" and str(e.get("voice")) in ("1", "2") for e in notes):
                classes.add("crossstaff")
            new = classes - seen_classes
            if new and len(pages) < 14:
                pages.append((sid, pg, sorted(classes)))
                seen_classes |= classes
            if len(seen_classes) >= 13:
                break
        if len(seen_classes) >= 13:
            break
    # force-cover tempo text + fingering + cue pages (deterministic search,
    # on the page where the feature actually occurs)
    def page_with(r, kind):
        best = None
        for e in r["events"]:
            if e["kind"] != "note" or not e.get("bbox"):
                continue
            hit = (kind == "fingering" and e.get("fingering")) or \
                  (kind == "cue" and e.get("cue"))
            if hit:
                pg = int(e["bbox"]["page"])
                best = pg if best is None else min(best, pg)
        for t in r["texts"]:
            if kind == "tempo_text" and t.get("subtype") == "tempo" and t.get("bbox") and t.get("page"):
                pg = int(t["page"])
                best = pg if best is None else min(best, pg)
        return best

    for cls in ("tempo_text", "fingering", "cue"):
        if cls in seen_classes:
            continue
        for sid in sorted(train_ids | dev_ids,
                          key=lambda s: hashlib.sha256(f"piano-v1qa|{s}".encode()).hexdigest()):
            p = EVENTS / f"{sid}.events.json.gz"
            if not p.is_file():
                continue
            r = json.load(gzip.open(p, "rt"))
            pg = page_with(r, cls)
            if pg is not None:
                pages.append((sid, pg, [cls]))
                seen_classes.add(cls)
                break
    # texts/tempo/dynam coverage from canonical texts
    QA.mkdir(parents=True, exist_ok=True)
    OBJECTS = PILOT / "data" / "objects"
    report = {"pages": [], "class_drawn": {}, "ownership_ok": 0, "ownership_fail": 0,
              "objects_drawn": 0, "objects_inky": 0}
    COLORS = {"note": (0, 160, 0), "rest": (180, 0, 0), "beam": (0, 120, 200),
              "tuplet": (150, 0, 150), "tie": (0, 0, 200), "slur": (200, 0, 200),
              "artic": (0, 150, 150), "dynam": (150, 150, 0), "hairpin": (150, 150, 0),
              "tempo": (150, 150, 0), "trill": (0, 100, 100), "mordent": (0, 100, 100),
              "turn": (0, 100, 100), "pedal": (100, 60, 0), "octave": (100, 60, 0),
              "fing": (60, 100, 60), "arpeg": (60, 60, 150), "gliss": (0, 200, 200),
              "fermata": (150, 0, 0), "reh": (150, 150, 0), "ending": (100, 100, 100),
              "barline": (100, 100, 100), "repeatMark": (150, 0, 150)}
    for sid, pg, classes in pages:
        meta = json.loads((RENDER / sid / "meta.json").read_text())
        r = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))
        pobjs = json.load(gzip.open(OBJECTS / f"{sid}.objects.json.gz", "rt"))
        img = cv2.imread(str(RENDER / sid / f"page-{pg:02d}.png"))
        H, W = img.shape[:2]
        pw = next(p["width"] for p in meta["page_geometry"] if p["page"] == pg)
        sx = W / pw
        svg_t = (RENDER / sid / f"page-{pg:02d}.svg").read_text()
        tm = re.search(r'<g class="page-margin" transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)', svg_t)
        tx, ty = (float(tm.group(1)), float(tm.group(2))) if tm else (0.0, 0.0)
        vis = img.copy()
        by_id = {e["id"]: e for e in r["events"] if e.get("id")}
        drawn = set()

        def box(e, col, label):
            if not e.get("bbox"):
                return False
            x0, y0, x1, y1 = page_xy(e["bbox"], tx, ty, sx)
            if not (0 <= x0 < x1 <= W and 0 <= y0 < y1 <= H):
                return False
            cv2.rectangle(vis, (x0, y0), (x1, y1), col, 1)
            if label:
                cv2.putText(vis, label[:28], (x0, max(0, y0 - 3)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.35, col, 1)
            patch = img[max(0, y0):y1, max(0, x0):x1]
            return bool(patch.size and (patch < 200).mean() > 0.003)

        for o in pobjs:
            if o["tag"] not in COLORS or not o.get("bbox") or int(o["bbox"]["page"]) != pg:
                continue
            lab = o["tag"]
            if o["tag"] == "note":
                lab = f"{o['pname']}{o['oct']} s{o['staff']}v{o.get('voice')}"
                if o.get("grace"):
                    lab += " grace"
                    drawn.add("grace")
                if o.get("cue"):
                    lab += " cue"
                    drawn.add("cue")
            elif o["tag"] == "rest":
                lab = f"rest {o.get('dur','')}"
            if box(o, COLORS[o["tag"]], lab):
                report["objects_drawn"] += 1
                report["objects_inky"] += 1
                drawn.add(o["tag"])
            else:
                report["objects_drawn"] += 1
        # tuplet member regions (tuplet objects carry no bbox; members do)
        tups = {}
        for e in r["events"]:
            if e["kind"] == "note" and e.get("tuplet_id") and e.get("bbox") and int(e["bbox"]["page"]) == pg:
                tups.setdefault(e["tuplet_id"], []).append(e)
        for tid, members in tups.items():
            xs0 = min(m["bbox"]["x"] for m in members)
            ys0 = min(m["bbox"]["y"] for m in members)
            xs1 = max(m["bbox"]["x"] + m["bbox"]["w"] for m in members)
            ys1 = max(m["bbox"]["y"] + m["bbox"]["h"] for m in members)
            x0, y0, x1, y1 = page_xy({"x": xs0, "y": ys0 - 400, "w": xs1 - xs0, "h": 400}, tx, ty, sx)
            if 0 <= x0 < x1 <= W and 0 <= y0 < y1 <= H:
                cv2.rectangle(vis, (x0, y0), (x1, y1), (150, 0, 150), 1)
                drawn.add("tuplet")
        # note-level flags from canonical events (ownership shown on the note)
        ev_by_mei = {e["id"]: e for e in r["events"] if e.get("id")}
        for o in pobjs:
            if o["tag"] != "note" or not o.get("bbox") or int(o["bbox"]["page"]) != pg:
                continue
            e = ev_by_mei.get(o.get("svg_id"))
            flags = []
            if e:
                if e.get("fingering"):
                    flags.append(f"fing:{e['fingering']}")
                    drawn.add("fingering")
                if e.get("trill_id") or e.get("mordent_id") or e.get("turn_id"):
                    flags.append("orn")
                    drawn.add("ornament")
                if e.get("arpeg_id"):
                    flags.append("arpeg")
                    drawn.add("arpeg")
                if e.get("pedal_active"):
                    flags.append("ped")
                    drawn.add("pedal")
                if e.get("octave_id"):
                    flags.append("8va")
                    drawn.add("octave")
                if e.get("hairpin_id"):
                    flags.append("hairpin")
                    drawn.add("hairpin")
            if flags:
                b = o["bbox"]
                x0, y0 = int((b["x"] + tx) / 10 * sx), int((b["y"] + ty) / 10 * sx)
                cv2.putText(vis, "+".join(flags), (x0, max(0, y0 - 12)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.3, (60, 60, 60), 1)
        # relationships with endpoint ownership checks
        for e in r["events"]:
            if e["kind"] != "note" or not e.get("bbox") or int(e["bbox"]["page"]) != pg:
                continue
            x0, y0, x1, y1 = page_xy(e["bbox"], tx, ty, sx)
            cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
            for t in e.get("ties", []):
                for pid in t.get("partners", []):
                    q = by_id.get(pid.lstrip("#") if isinstance(pid, str) else pid)
                    if q and q.get("bbox") and int(q["bbox"]["page"]) == pg:
                        qx0, qy0, qx1, qy1 = page_xy(q["bbox"], tx, ty, sx)
                        cv2.line(vis, (cx, cy), ((qx0 + qx1) // 2, (qy0 + qy1) // 2), (0, 0, 200), 1)
                        report["ownership_ok"] += 1
                        drawn.add("tie")
                    else:
                        report["ownership_fail"] += 1
            for l in e.get("links_out", []):
                if l["rel"] not in ("slur", "gliss"):
                    continue
                for pid in l.get("to", []):
                    q = by_id.get(pid.lstrip("#") if isinstance(pid, str) else pid)
                    if q and q.get("bbox") and int(q["bbox"]["page"]) == pg:
                        qx0, qy0, qx1, qy1 = page_xy(q["bbox"], tx, ty, sx)
                        cv2.line(vis, (cx, cy), ((qx0 + qx1) // 2, (qy0 + qy1) // 2),
                                 (200, 0, 200) if l["rel"] == "slur" else (0, 200, 200), 1)
                        report["ownership_ok"] += 1
                        drawn.add(l["rel"])
                    else:
                        report["ownership_fail"] += 1
        for t in r["texts"]:
            if t.get("bbox") and t.get("page") == pg and t.get("text"):
                x0, y0, x1, y1 = page_xy(t["bbox"], tx, ty, sx)
                if 0 <= x0 < x1 <= W and 0 <= y0 < y1 <= H:
                    cv2.rectangle(vis, (x0, y0), (x1, y1), (150, 150, 0), 1)
                    cv2.putText(vis, f"{t['subtype']}:{t['text'][:16]}", (x0, max(0, y0 - 3)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.35, (150, 150, 0), 1)
                    drawn.add(f"text:{t['subtype']}")
        for b in r["barlines"]:
            if b.get("page") != pg:
                continue
            svg = (RENDER / sid / f"page-{pg:02d}.svg").read_text()
            m = re.search(r'<g id="bbox-%s"[^>]*>\s*<rect([^/]*)/>' % re.escape(b["svg_id"]), svg)
            if m:
                a = dict(re.findall(r'([\w.-]+)="([^"]*)"', m.group(1)))
                try:
                    bb = {"x": float(a["x"]), "y": float(a["y"]),
                          "w": float(a["width"]), "h": float(a["height"])}
                    x0, y0, x1, y1 = page_xy(bb, tx, ty, sx)
                    if 0 <= x0 < x1 <= W and 0 <= y0 < y1 <= H:
                        cv2.rectangle(vis, (x0, y0), (x1, y1), (100, 100, 100), 1)
                        drawn.add(f"barline:{b.get('form')}")
                except KeyError:
                    pass
        out = QA / f"{sid}_p{pg:02d}.png"
        cv2.imwrite(str(out), vis)
        for c in drawn:
            report["class_drawn"][c] = report["class_drawn"].get(c, 0) + 1
        report["pages"].append({"sid": sid, "page": pg, "file": out.name,
                                "classes": classes, "drawn": sorted(drawn)})
    (QA / "qa.json").write_text(json.dumps(report, indent=1))
    print(json.dumps({"pages": len(report["pages"]), "drawn": report["class_drawn"],
                      "ownership_ok": report["ownership_ok"],
                      "ownership_fail": report["ownership_fail"]}, indent=1))


if __name__ == "__main__":
    main()
