"""Phase I - exact render-side note identity, then the clean-control gate.

I0/I1 RESULT: Verovio does NOT preserve MusicXML note identity. Injecting
xml:id="corranzo-..." into <note> leaves 0 occurrences in both getMEI() and
renderToSVG(). So no stable source id is available and the I3 fallback is
required.

I3 - and the fallback is STRUCTURAL, not pitch-based. Verovio's MEI and SVG
share element ids: the SVG <g id="X" class="note"> is the MEI <note xml:id="X">,
and the SVG <g id="L" class="layer"> is the MEI <layer xml:id="L" n="V">. MEI
therefore exposes, for every rendered notehead:

    (measure n, staff n, layer n, index within that layer)

which is exactly the (measure, staff, voice, document rank) tuple the corpus
event ids denote. Matching on THAT is order-exact inside each voice. The earlier
tail existed because the previous matcher flattened every voice of a band into a
single list, destroying the layer structure.

No pitch is used anywhere in the correspondence.
"""
from __future__ import annotations

import gzip
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import verovio

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "real-pdf-adaptation"))
import harness as H  # noqa: E402
import musicxml_truth as MT  # noqa: E402
import phase_f_cache as CACHE  # noqa: E402

DIATONIC = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}
MIDDLE = {"upper": 34, "lower": 22}
SVGNS = "{http://www.w3.org/2000/svg}"


def render_identity(mpath):
    """(measure n, staff n, layer n, rank) -> notehead y_staff, via MEI+SVG ids."""
    tk = verovio.toolkit()
    if not tk.loadFile(str(mpath)):
        return {}
    mei = tk.getMEI()
    root = ET.fromstring(mei.encode("utf-8"))
    MNS = "{http://www.music-encoding.org/ns/mei}"

    # SVG: element id -> notehead y in that staff's staff-space units
    out = {}
    svg_y = {}
    for pg in range(1, tk.getPageCount() + 1):
        sroot = ET.fromstring(tk.renderToSVG(pg))
        for meas in sroot.iter(SVGNS + "g"):
            if meas.get("class") != "measure":
                continue
            for st in meas.iter(SVGNS + "g"):
                if st.get("class") != "staff":
                    continue
                lines = []
                for p in st.findall(SVGNS + "path"):
                    mm = re.match(r"M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)$",
                                  (p.get("d") or "").strip())
                    if mm and abs(float(mm.group(2)) - float(mm.group(4))) < 1e-6:
                        lines.append(float(mm.group(2)))
                if len(lines) >= 5:
                    lines = sorted(lines)[:5]
                    gap = float(np.median(np.diff(lines)))
                    mid = lines[2]
                    for nt in st.iter(SVGNS + "g"):
                        if nt.get("class") != "note":
                            continue
                        for nh in nt.iter(SVGNS + "g"):
                            if nh.get("class") != "notehead":
                                continue
                            for use in nh.findall(SVGNS + "use"):
                                mm = re.search(
                                    r"translate\(([-\d.]+),\s*([-\d.]+)\)",
                                    use.get("transform") or "")
                                if mm:
                                    svg_y[nt.get("id")] = (mid - float(mm.group(2))) / gap
    for meas in root.iter(MNS + "measure"):
        n_attr = meas.get("n")
        for st in meas.iter(MNS + "staff"):
            sn = int(st.get("n") or 1)
            for lay in st.iter(MNS + "layer"):
                ln = int(lay.get("n") or 1)
                rank = 0
                for child in lay:
                    tag = child.tag
                    if tag == MNS + "note":
                        y = svg_y.get(child.get("{http://www.w3.org/XML/1998/namespace}id")
                                      or child.get("id"))
                        if y is not None:
                            out[(int(n_attr), sn, ln, rank)] = y
                        rank += 1
                    elif tag in (MNS + "chord",):
                        for sub in child:
                            if sub.tag == MNS + "note":
                                y = svg_y.get(sub.get("{http://www.w3.org/XML/1998/namespace}id")
                                              or sub.get("id"))
                                if y is not None:
                                    out[(int(n_attr), sn, ln, rank)] = y
                                rank += 1
    return out




def main():
    rendered = {}
    index = json.loads((H.REALPDF_ROOT / "index.json").read_text())
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}

    print("I0/I1 - stable note IDs in Verovio output: NONE (xml:id is discarded)")
    print("I3 - building the layer-aware MEI<->SVG identity map")
    truth = {}
    for sc in index["scores"]:
        sid = sc["score_id"]
        mp = H.V26_ROOT / sm[sid]["musicxml"]
        if not mp.is_file():
            continue
        rep = MT.score_report(str(mp))
        if "truth" not in rep:
            continue
        truth[sid] = rep["truth"]
        rendered[sid] = render_identity(mp)
    tot = sum(len(v) for v in rendered.values())
    print("  scores: %d   identified rendered noteheads: %d" % (len(rendered), tot))

    cache = CACHE.load()
    ex_index = {str(e): i for i, e in enumerate(cache["example"])}

    rows, rej = [], Counter()
    for sc in index["scores"]:
        sid = sc["score_id"]
        if sid not in rendered:
            continue
        for sh in sc.get("shards", []):
            p = H.REALPDF_ROOT / "shards" / sh
            if not p.is_file():
                continue
            with gzip.open(p, "rt") as f:
                for line in f:
                    rec = json.loads(line)
                    ex = rec["exampleId"]
                    geom = rec["input"]["modelInput"]["geometry"]
                    bands = {b.get("staffRole"): b
                             for b in geom.get("staffBands", {}).get("staffBands", [])}
                    fams = rec.get("target", {}).get("families", {}) or {}
                    ps = fams.get("PITCH_STAFF") or []
                    if isinstance(ps, dict):
                        ps = [ps]
                    for fam in ps:
                        oi = (fam.get("objectIndexes") or [None])[0]
                        if oi is None:
                            continue
                        v = fam.get("value") or {}
                        pos = v.get("staffPosition") or {}
                        wp = v.get("writtenPitch") or {}
                        role = v.get("staffRole")
                        ev = (fam.get("semanticEventIds") or [""])[0]
                        if (role not in MIDDLE or wp.get("step") not in DIATONIC
                                or wp.get("octave") is None
                                or pos.get("sourceY") is None or "-n" not in ev):
                            rej["malformed"] += 1
                            continue
                        mnum = int(ev.split("-n")[0][1:])
                        note_id = int(ev.split("-n")[1])
                        staff_n = int(v.get("staff") or (1 if role == "upper" else 2))
                        tm = truth[sid].measures[mnum - 1]
                        # document rank of this event WITHIN ITS OWN VOICE
                        evs = [e for e in tm.events if e.printed and e.band == role
                               and not e.is_rest]
                        tgt = next((e for e in evs if e.xml_note_index == note_id), None)
                        if tgt is None:
                            rej["event_not_found"] += 1
                            continue
                        voice = tgt.voice
                        same_voice = [e for e in evs if str(e.voice) == str(voice)]
                        try:
                            rank = [e.xml_note_index for e in same_voice].index(note_id)
                        except ValueError:
                            rej["rank_not_found"] += 1
                            continue
                        layer = int(re.sub(r"\D", "", str(voice)) or 1)
                        xml_y = rendered[sid].get((mnum, staff_n, layer, rank))
                        if xml_y is None:
                            rej["no_rendered_notehead"] += 1
                            continue
                        b = bands.get(role)
                        if not b:
                            rej["no_band"] += 1
                            continue
                        gap = float(pos["staffGapNormalized"])
                        mid = (b["y0"] + b["y1"]) / 2
                        pdf_y = (mid - float(pos["sourceY"])) / gap
                        true_d = int(wp["octave"]) * 7 + DIATONIC[wp["step"]]
                        d0 = MIDDLE[role] + int(np.round(2 * pdf_y))
                        ci = ex_index.get(ex)
                        ck = (float(cache["staff"][ci][int(oi)][0])
                              if ci is not None and int(oi) < cache["emb"].shape[1]
                              and bool(cache["object_mask"][ci][int(oi)])
                              and bool(cache["mask"][ci][int(oi)][1]) else None)
                        rows.append({"score": sid, "example": ex, "band": role,
                                     "object_index": int(oi), "event": ev,
                                     "voice": str(voice), "rank": rank,
                                     "pdf_y": pdf_y, "xml_y": xml_y,
                                     "r_corpus": int(true_d - d0), "d0": d0,
                                     "true_d": true_d, "cached_k": ck,
                                     "d_pdf": MIDDLE[role] + int(np.round(2 * pdf_y))})
    print("I2/I4 - exactly identified notes: %d   rejected: %s" % (len(rows), dict(rej)))

    ck = [r for r in rows if r["cached_k"] is not None]
    if ck:
        d = np.array([r["pdf_y"] - r["cached_k"] for r in ck])
        print("     cached-k cross-check: mean %+.6f std %.6f max %.6f"
              % (d.mean(), d.std(), np.abs(d).max()))
    bad_d0 = sum(1 for r in rows if r["d_pdf"] != r["d0"])
    print("     d_pdf == d0: %d / %d" % (len(rows) - bad_d0, len(rows)))

    for r in rows:
        r["delta_space"] = r["xml_y"] - r["pdf_y"]
        r["delta_diatonic"] = 2 * r["delta_space"]
        r["r_render"] = int(np.round(2 * (r["xml_y"] - r["pdf_y"])))

    conf = defaultdict(Counter)
    for r in rows:
        conf[r["r_corpus"]][r["r_render"]] += 1
    print("\nI4 - confusion matrix: rows r_corpus, cols r_render")
    cols = sorted({c for v in conf.values() for c in v})
    print("        " + "".join("%8s" % ("r=%+d" % c) for c in cols) + "     total   agree")
    for rc in sorted(conf):
        t = sum(conf[rc].values())
        print("  r=%+d" % rc + "".join("%8d" % conf[rc].get(c, 0) for c in cols)
              + "   %6d   %.4f" % (t, conf[rc].get(rc, 0) / t))
    allt = sum(sum(v.values()) for v in conf.values())
    ag = sum(conf[rc].get(rc, 0) for rc in conf)
    print("  TOTAL n=%d  agreement %d = %.4f" % (allt, ag, ag / allt))

    print("\nI5 - CLEAN CONTROL GATE (r_corpus = 0)")
    v = np.array([r["delta_space"] for r in rows if r["r_corpus"] == 0])
    if len(v):
        print("  n=%d  median %+.5f  p10 %+.4f  p25 %+.4f  p75 %+.4f  p90 %+.4f"
              % (len(v), np.median(v), np.percentile(v, 10), np.percentile(v, 25),
                 np.percentile(v, 75), np.percentile(v, 90)))
        print("  |delta| >= 0.25 : %.4f      r_render == 0 : %.4f"
              % ((np.abs(v) >= 0.25).mean(),
                 np.mean([r["r_render"] == 0 for r in rows if r["r_corpus"] == 0])))
        gate = (np.abs(v) < 0.25).mean() > 0.98
        print("  GATE (>98%% of clean within 0.25 space): %s" % ("PASS" if gate else "FAIL"))
    for lab, tgt in (("I9  r_corpus=+1", 1), ("I10 r_corpus=-1", -1)):
        w = np.array([r["delta_space"] for r in rows if r["r_corpus"] == tgt])
        if len(w):
            print("  %-14s n=%5d  median %+.4f  p10 %+.4f  p90 %+.4f  |d|>=0.25 %.4f"
                  % (lab, len(w), np.median(w), np.percentile(w, 10),
                     np.percentile(w, 90), (np.abs(w) >= 0.25).mean()))

    H.write_json("phase_i_rows.json", rows)
    print("\nwrote", H.write_json("phase_i_summary.json", {
        "identified": len(rows), "rejected": dict(rej),
        "confusion": {str(k): dict(v) for k, v in conf.items()},
        "agreement": ag / allt}))


if __name__ == "__main__":
    main()
