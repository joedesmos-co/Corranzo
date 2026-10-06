#!/usr/bin/env python3
"""A10-A11. Run the frozen solver on the 20 frozen SAME_STRUCTURE items.

Reads ONLY: raster pixels, the frozen proposal list, and the pitch-blind rhythm
skeleton. Never reads residual, delta_space, r_corpus, r_render, d0, true_d,
written pitch, MIDI, corpus pitch labels or decoder output.

Writes auto_structural_correspondence_manifest.json and hashes it. The hash is the
pre-science artifact: after this, membership may not change.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import harness as H  # noqa: E402
import a_align as AL  # noqa: E402
import a_pdf_onsets as AP  # noqa: E402
import a_source_struct as AS  # noqa: E402
from a_freeze import ACCEPT_MARGIN, MIN_MATCH_FRACTION, stability  # noqa: E402
from h3_skeleton import onset_x, xml_rhythm_v3  # noqa: E402
from m_measure_map import pdf_intervals  # noqa: E402

OUT = ROOT / "out/h_auto_struct"
POP_SHA = "6abeebd9a717a03d0d40f2e09460c910e9b727b7517b198fc4fad97e1d65534d"
DISP, GAP = 780.0, 17.0
_X0 = 1.6 * GAP + 0.8 * GAP
_X1 = (DISP - 1.1 * GAP) - 0.8 * GAP
_NHW = 0.60 * GAP

def p_marker_x(sheet_rel, n_expected):
    """Exact x of each printed P overlay line, read off the packet sheet.

    The overlay is red, so a strict colour test isolates it. The count MUST match the
    manifest; otherwise we refuse rather than guess a correspondence.
    """
    a = np.asarray(Image.open(sheet_rel).convert("RGB")).astype(int)
    rr, gg, bb = a[..., 0], a[..., 1], a[..., 2]
    red = (rr > 120) & (rr - gg > 50) & (rr - bb > 50)
    cols = np.nonzero(red.sum(0) > 20)[0]
    if not len(cols):
        return None
    groups, cur = [], [int(cols[0])]
    for v in cols[1:]:
        v = int(v)
        if v - cur[-1] <= 3:
            cur.append(v)
        else:
            groups.append(cur)
            cur = [v]
    groups.append(cur)
    if len(groups) != n_expected:
        return None
    w = float(a.shape[1])
    return [{"pid": "P%d" % (i + 1), "x": float(np.mean(g)) / w}
            for i, g in enumerate(groups)]


AUTO_HIGH = "AUTO_HIGH_CONFIDENCE"
AUTO_UNRES = "AUTO_UNRESOLVED"


def main():
    frozen = json.loads((OUT / "solver_frozen.json").read_text())
    assert frozen["accept_margin"] == ACCEPT_MARGIN
    man = json.loads((ROOT / "out/h_review_manifest.json").read_text())
    items = {i["item_id"]: i for i in man["items"]}
    neutral = {i["item_id"]: i for i in json.loads(
        (ROOT / "out/h_review_ai_v3/items_neutral.json").read_text())["items"]}
    consensus = json.loads(
        (ROOT / "out/h_review_ai_v3/ai_blind_consensus_v3_manifest.json").read_text())
    same = sorted(i["item_id"] for i in consensus["items"]
                  if i["A_votes"] == ["SAME_STRUCTURE"] * 3)
    pop_hash = hashlib.sha256("".join(same).encode()).hexdigest()
    assert pop_hash == POP_SHA, "population drifted: %s" % pop_hash

    systems = json.load(open(ROOT / "out/F_systems.json"))
    iv = {(r["score"], r["ord"]): r for r in pdf_intervals(systems)}
    # Staff y comes from the system map (h3_packet does the same), not from the
    # interval row: pdf_intervals exposes x_left/x_right/gap but no y0/y1.
    bypage = {}
    for sy in systems:
        bypage.setdefault((sy["score"], sy["page"]), []).append(sy)
    for v in bypage.values():
        v.sort(key=lambda z: z["y0"])
    sm = {s["id"]: s for s in json.loads(
        (H.V26_ROOT / "tools/real-pdf-adaptation/split_manifest.json").read_text())["scores"]}

    imgs, seqs = {}, {}

    def page_img(sid, pno):
        k = (sid, pno)
        if k not in imgs:
            p = H.REALPDF_ROOT / "pages" / sid / ("page-%d.png" % pno)
            imgs[k] = np.array(Image.open(p)) if p.is_file() else None
        return imgs[k]

    def rhythm(sid):
        if sid not in seqs:
            mp = H.V26_ROOT / sm[sid]["musicxml"]
            seqs[sid] = xml_rhythm_v3(mp) if mp.is_file() else []
        return seqs[sid]

    results = []
    for iid in same:
        it = items[iid]
        im = page_img(it["score"], it["page"])
        if im is None:
            results.append({"item_id": iid, "status": AUTO_UNRES, "reason": "no raster"})
            continue
        Hh = im.shape[0]
        r = iv.get((it["score"], it["pdf_ord"]))
        if r is None:
            results.append({"item_id": iid, "status": AUTO_UNRES, "reason": "no interval"})
            continue
        srow = bypage[(it["score"], it["page"])][it["system"]]
        y0, y1 = srow[it["staff"]][0] * Hh, srow[it["staff"]][1] * Hh
        gap = (y1 - y0) / 4.0
        x_lo = r["x_left"] - 3.0 * gap
        x_hi = r["x_right"] + 3.0 * gap
        rows = [min(max(0, int(round(y0 + k * (y1 - y0) / 4.0)) - int(round(y0))),
                    max(1, int(round(y1 - y0)))) for k in range(5)]

        # ---- A2: PDF side, raster ONLY ----
        # A1: the frozen P proposals are the candidate set, and each gets a structural
        # likelihood from raster evidence. Their x is read off the red overlay lines
        # already printed on the packet sheet (exact, and independent of any reviewer
        # or human answer). Morphology of the raster component under each line decides
        # the verdict. Building a fresh detector instead starved the candidate list
        # (1-6 groups for 8-15 source onsets) and collapsed every margin to zero.
        # P x must live in the SAME coordinate system as r["x_left"], i.e. page raster
        # pixels. Reading the red lines off the composed sheet mixes two coordinate
        # systems and produced nonsense like p_x = -0.53. Re-derive the proposals with
        # the very detector the packet used, which is also what defines pid order.
        import h_review_packet as HP
        import stage_a2_consensus as A2
        sr_rows = A2.staff_rows(im, y0, y1)
        props_raw = HP.pdf_onsets(im, y0, y1, r["x_left"], r["x_right"],
                                  min(q[1] for q in sr_rows) if sr_rows else y0, gap)
        if len(props_raw) != len(it["pdf_onsets"]):
            results.append({"item_id": iid, "status": AUTO_UNRES,
                            "reason": "proposal count mismatch %d vs %d"
                                      % (len(props_raw), len(it["pdf_onsets"]))})
            continue
        px = [{"pid": q["pid"], "x": float(q["x"])} for q in props_raw]
        feats = AP.pdf_onset_features(im, y0, y1, x_lo, x_hi, rows, gap)
        span = float(r["x_right"] - r["x_left"]) or 1.0
        props = AP.classify_proposals(feats, it["pdf_onsets"], tol_px=1.6 * gap,
                                      prop_x={p["pid"]: p["x"] for p in px})
        pdf_list = []
        for pr in props:
            # x as a fraction of the printed interval, from the printed overlay line
            xx = (pr["x"] - r["x_left"]) / span
            pdf_list.append({
                "x": min(1.4, max(-0.4, xx)),
                "card": pr["card"], "verdict": pr["verdict"],
                "pid": pr["pid"], "beamed": None, "dots": None, "dur_class": None,
            })
        pdf_list.sort(key=lambda z: z["x"])
        unlisted = []
        dropped = []

        # ---- A3: source side, pitch-blind ----
        rs = rhythm(it["score"])
        pix = 0 if (it["staff"] == "upper" or len(rs) < 2) else 1
        if it["xml_ord"] >= len(rs[pix]):
            results.append({"item_id": iid, "status": AUTO_UNRES, "reason": "no measure"})
            continue
        meas = rs[pix][it["xml_ord"]]
        xs = onset_x(meas["onsets"], _X0, _X1)
        src_list = AS.source_sequence(meas, [(x + _NHW / 2.0) / DISP for x in xs])
        gid = AS.beam_group_ids(src_list)

        if not pdf_list or not src_list:
            results.append({"item_id": iid, "status": AUTO_UNRES,
                            "reason": "empty side", "n_pdf": len(pdf_list),
                            "n_src": len(src_list)})
            continue

        # ---- A4/A5: global joint alignment over the shared printed span ----
        lo = min(min(p["x"] for p in pdf_list), min(o["x"] for o in src_list))
        hi = max(max(p["x"] for p in pdf_list), max(o["x"] for o in src_list))
        lo, hi = max(0.0, lo - 0.02), min(1.0, hi + 0.02)
        p, s = AL.shared_normalise(pdf_list, src_list, lo, hi)
        best, path = AL.align(p, s, gid)
        alt, _ = AL.second_best(p, s, gid, best, path)
        margin = best - (alt if alt > float("-inf") else best)

        matched = [(i, j) for op, i, j in path if op == "M"]
        skipped_p = [i for op, i, j in path if op == "S_P"]
        skipped_x = [j for op, i, j in path if op == "S_X"]
        noteheads = 0
        for i, j in matched:
            noteheads += int(s[j]["card"])
        cheap_skips = sum(1 for j in skipped_x
                          if s[j]["is_rest"] or s[j]["dots"] or s[j]["grace"]
                          or s[j]["tuplet"])
        frac = (len(matched) + cheap_skips) / float(len(s))

        flips, nper = stability(p, s, gid, lo, hi)

        # A6 internal consistency: a pair whose own raster verdict is NON_NOTE_LIKELY
        # cannot be a confirmed notehead mapping. Accepting one means counting
        # noteheads from an onset the raster says is not a note. This is a structural
        # consistency rule, applied before any scientific field is read.
        # A pair whose raster verdict is NON_NOTE or AMBIGUOUS cannot be a confirmed
        # notehead mapping: the raster does not affirm it is a note. Counting noteheads
        # from an onset we ourselves called "maybe not a note" is not a correspondence
        # claim. Structural consistency rule, applied before any scientific read.
        # A confirmed notehead mapping requires the raster to affirm the proposal is a
        # NOTE. A proposal classified AMBIGUOUS may be a clef fragment or a rest, so a
        # mapping built on it is not a correspondence claim. This rule only ever
        # excludes; it never promotes anything.
        not_note_matched = [p[i]["pid"] for i, j in matched
                            if p[i].get("verdict") != AP.NOTE_LIKELY]

        blocking = []
        if margin < ACCEPT_MARGIN:
            blocking.append("margin %.4f < %.2f" % (margin, ACCEPT_MARGIN))
        if frac < MIN_MATCH_FRACTION:
            blocking.append("match fraction %.3f < %.2f" % (frac, MIN_MATCH_FRACTION))
        if flips:
            blocking.append("perturbation flipped %d/%d" % (flips, nper))
        if not_note_matched:
            blocking.append("matched a proposal the raster does not affirm as a note: %s"
                            % ",".join(not_note_matched[:4]))
        amb = [pr["pid"] for pr in props if pr["verdict"] == AP.AMBIGUOUS]

        status = AUTO_UNRES if blocking else AUTO_HIGH
        results.append({
            "item_id": iid,
            "status": status,
            "margin": round(margin, 4),
            "match_fraction": round(frac, 4),
            "perturbation_flips": flips,
            "perturbation_n": nper,
            "n_pdf": len(pdf_list), "n_src": len(src_list),
            "n_matched": len(matched),
            "matched_noteheads": noteheads,
            "skipped_p_ids": [p[i]["pid"] for i in skipped_p],
            "n_skipped_p": len(skipped_p),
            "n_unlisted": len([u for u in unlisted]),
            "n_raster_groups": len(pdf_list),
            "n_raster_dropped": len(dropped),
            "packet_p_n": len(it["pdf_onsets"]),
            "skipped_x_ids": [s[j]["sid"] for j in skipped_x],
            "ambiguous_proposals": amb,
            "not_note_matched": not_note_matched,
            "blocking": blocking,
            "pairs": [{"pid": p[i]["pid"], "sid": s[j]["sid"], "p_x": round(p[i]["x"], 4),
                       "s_x": round(s[j]["x"], 4),
                       "p_card": p[i]["card"], "x_card": s[j]["card"],
                       "verdict": p[i]["verdict"],
                       "beam_group": gid[j]} for i, j in matched],
        })
        print("  %-6s %-22s margin %7.3f  frac %.3f  flips %2d/%d  P=%2d X=%2d "
              "matched %2d noteheads %3d" % (
                  iid, status, margin, frac, flips, nper, len(pdf_list), len(src_list),
                  len(matched), noteheads))

    acc = [r for r in results if r.get("status") == AUTO_HIGH]
    unres = [r for r in results if r.get("status") == AUTO_UNRES]
    N = sum(r.get("matched_noteheads", 0) for r in acc)
    doc = {
        "label": "AUTOMATIC_STRUCTURAL_CORRESPONDENCE",
        "provenance": "AUTOMATIC STRUCTURAL CORRESPONDENCE - not human-certified",
        "population_sha256": POP_SHA,
        "population_n": len(same),
        "solver_sha256": hashlib.sha256(
            (OUT / "solver_frozen.json").read_bytes()).hexdigest(),
        "accept_margin": ACCEPT_MARGIN,
        "min_match_fraction": MIN_MATCH_FRACTION,
        "reads_scientific_fields": False,
        "attempted": len(results),
        "accepted_measures": len(acc),
        "unresolved_measures": len(unres),
        "accepted_onset_mappings": sum(r["n_matched"] for r in acc),
        "matched_notehead_n": N,
        "skipped_false_p": sum(r["n_skipped_p"] for r in acc),
        "unlisted_pdf_onsets": sum(r["n_unlisted"] for r in acc),
        "clean_gate_required_n": 50,
        "clean_gate_state": "NOT_EVALUATED",
        "items": results,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    mf = OUT / "auto_structural_correspondence_manifest.json"
    mf.write_text(json.dumps(doc, indent=1) + "\n")
    sh = hashlib.sha256(mf.read_bytes()).hexdigest()
    (OUT / "auto_structural_correspondence_manifest.sha256").write_text(sh + "\n")
    margins = sorted(r["margin"] for r in results if "margin" in r)
    med = margins[len(margins) // 2] if margins else 0.0
    stable = sum(1 for r in results if r.get("perturbation_flips") == 0)
    print("\nA11 coverage BEFORE any scientific field is read")
    print("  attempted measures            : %d" % len(results))
    print("  AUTO_HIGH_CONFIDENCE          : %d" % len(acc))
    print("  AUTO_UNRESOLVED               : %d" % len(unres))
    print("  accepted onset mappings       : %d" % doc["accepted_onset_mappings"])
    print("  accepted matched noteheads N  : %d" % N)
    print("  skipped false P proposals     : %d" % doc["skipped_false_p"])
    print("  unlisted PDF onsets inferred  : %d" % doc["unlisted_pdf_onsets"])
    print("  median margin                 : %.4f" % med)
    print("  perturbation-stable fraction  : %d/%d" % (stable, len(results)))
    print("  manifest sha256               : %s" % sh)
    print("\nclean gate: NOT_EVALUATED (no scientific field read)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
