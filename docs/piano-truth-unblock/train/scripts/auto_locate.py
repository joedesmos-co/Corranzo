#!/usr/bin/env python3
"""P2 stage-C feasibility: deterministic oracle-free localization.

Classical CV only (no training, no oracle boxes at inference):
  page PNG -> binarize -> row projection staff lines -> staff grouping
  -> connected components -> glyph candidates -> heuristic notehead/rest
  classification by size/aspect vs staff gap.
Compares detected boxes against the render's oracle object boxes
(note/rest) by IoU>=0.3 matching -> detection P/R + type confusion.
This is the FIRST measured number for fully automatic transcription in
this branch. DEV renders only; TEST sealed.
Writes reports/auto_locate.json.
"""
from __future__ import annotations
import gzip
import json
import sys
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
RENDER = PILOT / "data" / "render"
EVENTS = TRAIN / "data" / "events"


def binarize(gray):
    """Adaptive binarization (Otsu). A fixed gray<128 threshold assumed
    high-contrast renders: at 0.5x downscale thin staff lines anti-alias
    above 128 and 7/30 lines vanish (measured); scans are lower-contrast
    still. Otsu is deterministic and scale/contrast-adaptive."""
    if gray.dtype != np.uint8:
        gray = gray.astype(np.uint8)
    t, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    dark = (gray < t).astype(np.uint8)
    if t <= 1 or dark.mean() < 5e-4:
        # Otsu is degenerate when the image is already binary (histogram has
        # nothing between the two modes -> threshold 0). Fall back to the
        # midpoint of the observed range.
        lo, hi = int(gray.min()), int(gray.max())
        mid = max(1, (lo + hi) // 2)
        dark = (gray < mid).astype(np.uint8)
    return dark


def staff_lines(gray, min_frac=0.10):
    """Row-projection staff lines via LONGEST contiguous dark run per row
    (a staff line is one long run; glyph rows are many short runs)."""
    dark = binarize(gray)
    # longest run per row via diff trick
    best = np.zeros(gray.shape[0], np.int32)
    for y in range(gray.shape[0]):
        row = dark[y]
        if not row.any():
            continue
        d = np.diff(np.concatenate(([0], row, [0])))
        starts = np.where(d == 1)[0]
        ends = np.where(d == -1)[0]
        if len(starts):
            best[y] = int((ends - starts).max())
    thr = max(60, min_frac * gray.shape[1])
    cand = np.where(best > thr)[0]
    lines = []
    if len(cand):
        start = prev = cand[0]
        for y in cand[1:]:
            if y == prev + 1:
                prev = y
                continue
            lines.append((start + prev) // 2)
            start = prev = y
        lines.append((start + prev) // 2)
    # merge duplicate line detections: a thick scan line can produce dark
    # runs on two adjacent rows, both above the run threshold, which breaks
    # the 5-line staff grouping (measured: OLiMPiC scans had 3-7px duplicate
    # pairs -> 16 detected lines -> 0 frames). Merge centers closer than
    # 0.4x the median spacing.
    if len(lines) >= 3:
        sp = [lines[i + 1] - lines[i] for i in range(len(lines) - 1)]
        sp.sort()
        med = sp[len(sp) // 2]
        thr = max(2, int(round(0.40 * med)))
        merged = [lines[0]]
        for y in lines[1:]:
            if y - merged[-1] <= thr:
                merged[-1] = (merged[-1] + y) // 2
            else:
                merged.append(y)
        lines = merged
    return lines, dark


def group_staves(lines, dark=None):
    """Cluster line centers into groups of 5 (staves). Inside a staff the
    line spacing is regular (~gap); between staves it is 2.5-4x gap.
    The same-staff tolerance is GAP-RELATIVE (a fixed +4 pixel tolerance
    broke at half scale: measured 23 lines -> 0 frames at 0.5x)."""
    groups = []
    cur = [lines[0]] if lines else []
    for y in lines[1:]:
        d = y - cur[-1]
        if len(cur) > 1:
            spacing = cur[-1] - cur[-2]
            same = d <= spacing * 1.5 + 1
        else:
            same = True
        if same and len(cur) < 5:
            cur.append(y)
        elif same and len(cur) >= 5:
            cur.append(y)
        else:
            groups.append(cur)
            cur = [y]
    if cur:
        groups.append(cur)
    out = []
    for g in groups:
        if len(g) == 5:
            out.append(_validate_frame(list(g), dark))
            continue
        if len(g) == 4:
            # a missed staff line: the doubled spacing marks where it goes
            sp = [g[i + 1] - g[i] for i in range(3)]
            med = sorted(sp)[1]
            for i, d in enumerate(sp):
                if d > med * 1.6:
                    g = list(g[:i + 1]) + [g[i] + round(d / 2)] + list(g[i + 1:])
                    break
        if len(g) == 5:
            out.append(_validate_frame(list(g)))
    return out


def _line_strength(dark, y, W):
    """Longest dark run on row y (0 if the row is empty)."""
    if not (0 <= y < dark.shape[0]):
        return 0
    row = dark[y]
    if not row.any():
        return 0
    d = np.diff(np.concatenate(([0], row, [0])))
    st = np.where(d == 1)[0]
    en = np.where(d == -1)[0]
    return int((en - st).max()) if len(st) else 0


def _validate_frame(g, dark=None):
    """A staff's 5 lines are (near-)evenly spaced by the staff gap. If one
    line is spurious (e.g. text above the staff) the frame is off by a full
    gap = 2 diatonic steps for every note (measured on scans). Drop the
    outlier line and interpolate its position from the remaining four."""
    if len(g) != 5:
        return g
    # ink-strength check: a real staff line spans the system; a spurious
    # detection (text, thick-line artifact, an adjacent staff's line) has a
    # materially shorter run. Drop the weakest line and interpolate.
    if False and dark is not None:
        strengths = [_line_strength(dark, int(y), 0) for y in g]
        order = sorted(range(5), key=lambda i: strengths[i])
        weakest = order[0]
        others = [strengths[i] for i in order[1:]]
        if others and strengths[weakest] < 0.6 * (sum(others) / 4.0):
            gg = [v for i, v in enumerate(g) if i != weakest]
            med = sorted([gg[i + 1] - gg[i] for i in range(3)])[1]
            if med > 0:
                if weakest == 0:
                    g = [gg[0] - med] + gg
                elif weakest == 4:
                    g = gg + [gg[-1] + med]
                else:
                    g = gg[:weakest] + [(gg[weakest - 1] + gg[weakest]) // 2] + gg[weakest:]
                return g
    gaps = [g[i + 1] - g[i] for i in range(4)]
    med = sorted(gaps)[2]
    if med <= 0 or max(gaps) > 1.4 * med or min(gaps) < 0.65 * med:
        for drop in range(5):
            gg = [v for i, v in enumerate(g) if i != drop]
            gp = [gg[i + 1] - gg[i] for i in range(3)]
            m2 = sorted(gp)[1]
            if m2 > 0 and max(gp) <= 1.15 * m2 and min(gp) >= 0.9 * m2:
                # interpolate the missing line (position of the drop index)
                if drop == 0:
                    g = [gg[0] - m2] + gg
                elif drop == 4:
                    g = gg + [gg[-1] + m2]
                else:
                    g = gg[:drop] + [(gg[drop - 1] + gg[drop]) // 2] + gg[drop:]
                return g
    return g


def components(dark, lines_y, gap):
    """Candidate glyph blobs: staff rows removed, stems/beams killed by
    horizontal opening (kernels wider than a stem but narrower than a
    notehead/rest body survive), then connected components."""
    band = np.zeros_like(dark)
    for y in lines_y:
        band[max(0, y - 1):y + 2, :] = 1
    m = dark.copy()
    m[band.astype(bool)] = 0
    kw = max(2, int(round(0.55 * gap)))
    ker = cv2.getStructuringElement(cv2.MORPH_RECT, (kw, 1))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, ker)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    out = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < 12 or w < 2 or h < 2:
            continue
        fill = area / max(1, w * h)
        out.append({"x": int(x), "y": int(y), "w": int(w), "h": int(h),
                    "area": int(area), "fill": float(fill)})
    return out


def classify(comps, raw, staves, gap, heads=None):
    """notehead/rest candidates by geometry vs staff gap. Beams are long
    thin bars; stems removed by opening; clefs/barlines/text are large or
    wide and rejected. Rests come from a second pass on the raw mask
    (minus staff rows and confirmed noteheads) since opening kills their
    thin strokes."""
    heads, rests = [], []
    for c in comps:
        w, h = c["w"], c["h"]
        ar = w / max(1, h)
        if w > 3.0 * gap:
            continue  # beam / long horizontal
        # notehead: near-square, ~0.8-1.6 gaps, high fill
        if 0.55 * gap <= w <= 2.0 * gap and 0.55 * gap <= h <= 2.0 * gap \
                and ar > 0.5 and c["fill"] > 0.45:
            heads.append(c)
    m = raw.copy()
    for hd in heads:
        m[max(0, hd["y"] - 1):hd["y"] + hd["h"] + 1,
          max(0, hd["x"] - 1):hd["x"] + hd["w"] + 1] = 0
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        w, h = int(w), int(h)
        if area < 10 or w < 2 or h < 2:
            continue
        fill = area / max(1, w * h)
        ar = w / max(1, h)
        if w > 3.0 * gap or h > 3.4 * gap:
            continue
        if 0.3 * gap <= w <= 1.6 * gap and 0.7 * gap <= h <= 3.2 * gap \
                and fill > 0.2 and ar < 1.5:
            rests.append({"x": x, "y": y, "w": w, "h": h,
                          "area": int(area), "fill": float(fill)})
    return heads, rests, []


def iou(a, b):
    ax2, ay2 = a["x"] + a["w"], a["y"] + a["h"]
    bx2, by2 = b["x"] + b["w"], b["y"] + b["h"]
    ix = max(0, min(ax2, bx2) - max(a["x"], b["x"]))
    iy = max(0, min(ay2, by2) - max(a["y"], b["y"]))
    inter = ix * iy
    union = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / max(1, union)


def scale_meta(meta, page, gray):
    pw = next(p["width"] for p in meta["page_geometry"] if p["page"] == page)
    sx = gray.shape[1] / pw
    gap = next(p["median_staff_gap_px"] for p in meta["page_geometry"]
               if p["page"] == page) * sx
    return sx, gap


def probe_detected(hbp, obp, meta_by_sid, models):
    """Run the frozen probes on AUTO-DETECTED whole-note boxes (stem-union,
    no oracle boxes at inference) and score object-level pitch/dur against
    the truth note each detection matched."""
    import torch  # noqa: F401
    C = Counter()
    for (sid, pg), heads in hbp.items():
        gray = cv2.imread(str(RENDER / sid / f"page-{pg:02d}.png"),
                          cv2.IMREAD_GRAYSCALE)
        if gray is None:
            continue
        meta = meta_by_sid[sid]
        sx, gap = scale_meta(meta, pg, gray)
        truth_notes = [o for o in obp[(sid, pg)] if o["kind"] == "note"]
        used = set()
        pairs = []
        for d in heads:
            best, bi = 0.3, -1
            for j, o in enumerate(truth_notes):
                if j in used:
                    continue
                v = iou(d, o)
                if v > best:
                    best, bi = v, j
            if bi >= 0:
                used.add(bi)
                pairs.append((d, truth_notes[bi]))
        C["matched"] += len(pairs)
        if not pairs:
            continue
        half = int(round(3.0 * gap))
        crops = []
        for d, _o in pairs:
            cx, cy = d["x"] + d["w"] / 2, d["y"] + d["h"] / 2
            x0, y0 = int(round(cx - half)), int(round(cy - half))
            crop = np.zeros((2 * half, 2 * half), np.uint8)
            ix0, iy0 = max(0, x0), max(0, y0)
            ix1, iy1 = min(gray.shape[1], x0 + 2 * half), min(gray.shape[0], y0 + 2 * half)
            if ix1 > ix0 and iy1 > iy0:
                crop[iy0 - y0:iy0 - y0 + (iy1 - iy0),
                     ix0 - x0:ix0 - x0 + (ix1 - ix0)] = gray[iy0:iy1, ix0:ix1]
            crops.append(cv2.resize(crop, (64, 64), interpolation=cv2.INTER_AREA))
        X = torch.from_numpy(np.stack(crops)[:, None]).float() / 255
        g5 = torch.zeros((len(X), 5))
        with torch.no_grad():
            lg = models["common"][0](X, X.clone(), g5)
        pitch = lg["pitch"].argmax(-1).numpy()
        dur = lg["dur"].argmax(-1).numpy()
        voc = json.loads((TRAIN / "manifests" / "v1_items.json").read_text())["vocab"]
        for k, (_d, o) in enumerate(pairs):
            dsym = voc["dur"][int(dur[k])] if 0 <= int(dur[k]) < len(voc["dur"]) else None
            C["pitch_ok"] += (21 + int(pitch[k]) == o.get("midi_printed"))
            C["dur_ok"] += (bool(dsym) and dsym.split("d")[0] == str(o.get("dur")))
    return C


def detect_stems(dark, lines_y, gap):
    """Thin tall vertical runs = stems (before horizontal opening)."""
    band = np.zeros_like(dark)
    for y in lines_y:
        band[max(0, y - 1):y + 2, :] = 1
    m = dark.copy()
    m[band.astype(bool)] = 0
    kw = max(2, int(round(0.35 * gap)))
    ker = cv2.getStructuringElement(cv2.MORPH_RECT, (kw, 1))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, ker)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    out = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if w <= 0.5 * gap and h >= 2.0 * gap and area > 4 * w:
            out.append({"x": int(x), "y": int(y), "w": int(w), "h": int(h)})
    return out


def with_stem_boxes(heads, stems, gap):
    """Whole-note boxes = notehead union its stem (matches the ORACLE box
    convention the frozen probes were trained on: bbox spans notehead+stem).
    Detected heads alone anchor crops at the notehead, which breaks the
    trained pitch convention (measured: pitch 0.02)."""
    out = []
    for h in heads:
        bx = {"x": h["x"], "y": h["y"], "w": h["w"], "h": h["h"]}
        cx = h["x"] + h["w"] / 2
        cy = h["y"] + h["h"] / 2
        best = None
        for s in stems:
            scx = s["x"] + s["w"] / 2
            if abs(scx - cx) > 0.8 * gap:
                continue
            scy = s["y"] + s["h"] / 2
            if abs(scy - cy) > 6 * gap:
                continue
            if best is None or s["h"] > best["h"]:
                best = s
        if best is not None:
            x0 = min(bx["x"], best["x"])
            y0 = min(bx["y"], best["y"])
            x1 = max(bx["x"] + bx["w"], best["x"] + best["w"])
            y1 = max(bx["y"] + bx["h"], best["y"] + best["h"])
            bx = {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}
        out.append(bx)
    return out
    """Run the frozen probes on AUTO-DETECTED notehead boxes (no oracle
    boxes at inference) and score object-level pitch/dur against the truth
    note each detection matched. Returns counters."""
    import torch  # noqa: F401
    C = Counter()
    for (sid, pg), heads in hbp.items():
        gray = cv2.imread(str(RENDER / sid / f"page-{pg:02d}.png"),
                          cv2.IMREAD_GRAYSCALE)
        if gray is None:
            continue
        meta = meta_by_sid[sid]
        sx, gap = scale_meta(meta, pg, gray)
        truth_notes = [o for o in obp[(sid, pg)] if o["kind"] == "note"]
        used = set()
        pairs = []
        for d in heads:
            best, bi = 0.3, -1
            for j, o in enumerate(truth_notes):
                if j in used:
                    continue
                v = iou(d, o)
                if v > best:
                    best, bi = v, j
            if bi >= 0:
                used.add(bi)
                pairs.append((d, truth_notes[bi]))
        C["matched"] += len(pairs)
        if not pairs:
            continue
        # crops centered on detected boxes (production build_inputs recipe)
        half = int(round(3.0 * gap))
        crops = []
        for d, _o in pairs:
            cx, cy = d["x"] + d["w"] / 2, d["y"] + d["h"] / 2
            x0, y0 = int(round(cx - half)), int(round(cy - half))
            crop = np.zeros((2 * half, 2 * half), np.uint8)
            ix0, iy0 = max(0, x0), max(0, y0)
            ix1, iy1 = min(gray.shape[1], x0 + 2 * half), min(gray.shape[0], y0 + 2 * half)
            if ix1 > ix0 and iy1 > iy0:
                crop[iy0 - y0:iy0 - y0 + (iy1 - iy0),
                     ix0 - x0:ix0 - x0 + (ix1 - ix0)] = gray[iy0:iy1, ix0:ix1]
            crops.append(cv2.resize(crop, (64, 64), interpolation=cv2.INTER_AREA))
        X = torch.from_numpy(np.stack(crops)[:, None]).float() / 255
        g5 = torch.zeros((len(X), 5))
        with torch.no_grad():
            lg = models["common"][0](X, X.clone(), g5)
        pitch = lg["pitch"].argmax(-1).numpy()
        dur = lg["dur"].argmax(-1).numpy()
        voc = json.loads((TRAIN / "manifests" / "v1_items.json").read_text())["vocab"]
        for k, (_d, o) in enumerate(pairs):
            dsym = voc["dur"][int(dur[k])] if 0 <= int(dur[k]) < len(voc["dur"]) else None
            C["pitch_ok"] += (21 + int(pitch[k]) == o.get("midi_printed"))
            C["dur_ok"] += (bool(dsym) and dsym.split("d")[0] == str(o.get("dur")))
            C[f"tdur_{o.get('dur')}_pred_{str(dsym).split('d')[0]}"] += 0
    return C


def main():
    splits = json.loads((PILOT / "manifests" / "splits.json").read_text())
    sids = splits["dev"][:5]
    import re as _re
    agg = Counter()
    heads_by_page, oracle_by_page, meta_by_sid = {}, {}, {}
    for sid in sids:
        meta = json.loads((RENDER / sid / "meta.json").read_text())
        meta_by_sid[sid] = meta
        evs = json.load(gzip.open(EVENTS / f"{sid}.events.json.gz", "rt"))["events"]
        oracle = [e for e in evs if e["kind"] in ("note", "rest", "mRest")
                  and e.get("bbox")]
        by_page = {}
        for e in oracle:
            by_page.setdefault(int(e["bbox"]["page"]), []).append(e)
        for pg in sorted(by_page):
            gray = cv2.imread(str(RENDER / sid / f"page-{pg:02d}.svg".replace(".svg", ".png")),
                              cv2.IMREAD_GRAYSCALE)
            if gray is None:
                agg["img_missing"] += 1
                continue
            sx, gap = scale_meta(meta, pg, gray)
            lines, dark = staff_lines(gray)
            staves = group_staves(lines)
            comps = components(dark, lines, gap)
            heads, rests, stems = classify(comps, dark, staves, gap)
            agg["lines"] += len(lines)
            # oracle boxes in pixels (same transform as infer.build_inputs)
            svg = (RENDER / sid / f"page-{pg:02d}.svg").read_text()
            m = _re.search(r'<g class="page-margin" transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)', svg)
            tx, ty = (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)
            ob = []
            for e in by_page[pg]:
                b = e["bbox"]
                ob.append({"kind": "note" if e["kind"] == "note" else "rest",
                           "x": (b["x"] + tx) / 10 * sx,
                           "y": (b["y"] + ty) / 10 * sx,
                           "w": b["w"] / 10 * sx, "h": b["h"] / 10 * sx,
                           "mei_id": e["id"], "midi_printed": e.get("midi_printed"),
                           "dur": e.get("dur")})
            heads_by_page[(sid, pg)] = with_stem_boxes(
                heads, detect_stems(dark, lines, gap), gap)
            oracle_by_page[(sid, pg)] = ob
            for c in heads + rests:
                c["kind"] = "note" if c in heads else "rest"
            det = heads + rests
            # greedy IoU match per kind
            tp = Counter()
            fp = Counter()
            used = set()
            for kind in ("note", "rest"):
                ds = [d for d in det if d["kind"] == kind]
                os_ = [o for o in ob if o["kind"] == kind]
                for d in ds:
                    best, bi = 0.3, -1
                    for j, o in enumerate(os_):
                        if j in used:
                            continue
                        v = iou(d, o)
                        if v > best:
                            best, bi = v, j
                    if bi >= 0:
                        used.add(bi)
                        tp[kind] += 1
                    else:
                        fp[kind] += 1
            fn = Counter({"note": len([o for o in ob if o["kind"] == "note"]) - tp["note"],
                          "rest": len([o for o in ob if o["kind"] == "rest"]) - tp["rest"]})
            agg[f"tp_{kind}" if kind else "x"] += 0
            agg["tp_note"] += tp["note"]
            agg["tp_rest"] += tp["rest"]
            agg["fp_note"] += fp["note"]
            agg["fp_rest"] += fp["rest"]
            agg["fn_note"] += fn["note"]
            agg["fn_rest"] += fn["rest"]
            agg["pages"] += 1
            agg["staves_detected"] += len(staves)
    out = {"pages": agg["pages"], "staves": agg["staves_detected"],
           "note": {"tp": agg["tp_note"], "fp": agg["fp_note"],
                    "fn": agg["fn_note"],
                    "p": round(agg["tp_note"] / max(1, agg["tp_note"] + agg["fp_note"]), 4),
                    "r": round(agg["tp_note"] / max(1, agg["tp_note"] + agg["fn_note"]), 4)},
           "rest": {"tp": agg["tp_rest"], "fp": agg["fp_rest"],
                    "fn": agg["fn_rest"],
                    "p": round(agg["tp_rest"] / max(1, agg["tp_rest"] + agg["fp_rest"]), 4),
                    "r": round(agg["tp_rest"] / max(1, agg["tp_rest"] + agg["fn_rest"]), 4)},
           "scope": "5 DEV scores, clean vector renders, IoU>=0.3 match"}
    # object-level probes on auto-detected noteheads (no oracle boxes)
    try:
        sys.path.insert(0, str(HERE))
        from infer import load_models
        models = load_models(device="cpu")
        C = probe_detected(heads_by_page, oracle_by_page, meta_by_sid, models)
        out["auto_probe"] = {
            "matched_noteheads": C["matched"],
            "pitch_ok": C["pitch_ok"],
            "pitch_acc_on_detected": round(C["pitch_ok"] / max(1, C["matched"]), 4),
            "dur_ok": C["dur_ok"],
            "dur_acc_on_detected": round(C["dur_ok"] / max(1, C["matched"]), 4)}
    except Exception as e:  # pragma: no cover - diagnostic script
        out["auto_probe"] = {"error": f"{type(e).__name__}: {e}"}
    (TRAIN / "reports" / "auto_locate.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
