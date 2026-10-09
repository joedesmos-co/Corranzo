#!/usr/bin/env python3
"""Rhythm object-graph from images (Phase D, no training).

Image-only inference per page:
  1. Staff-line removal (horizontal opening, subtracted from ink).
  2. Stem detection (vertical opening + component filters).
  3. Beam detection (thick-horizontal opening + components).
  4. Association: stems -> detected note boxes; beams -> stems.
  5. Onset graph: x-ordered onsets with stem/beam-count/dot evidence and
     a rule-based duration label. Technique abstinent (no technique
     output — real supervision insufficient).

Truth (joins rhythm segments, canonical durations) is used ONLY for
measurement, never as inference input.

Usage:
    python3 tools/guitar-vision/proof-rhythm-graph.py --hires <dir> --work ... --out <dir> --split train
    (--split validation runs DEV once.)
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from scipy import ndimage as ndi

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, TOOLS / path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


TinyFCN = _load("proof_heatmap_train_mod", "proof-heatmap-train.py").TinyFCN
dec = _load("proof_heatmap_decode_mod", "proof-heatmap-decode.py")
evlink = _load("proof_event_link_mod", "proof-event-link.py")
mbars = _load("proof_measure_bars_mod", "proof-measure-bars.py")

SEED = 20261009
# Note-anchored stem search (hires px). Stems attach at the notehead's
# left/right edge and run vertically; staff lines crossing the stem are
# bridged (gaps <= STAFF_BRIDGE). Global morphological stems were tried
# and failed (barline/beam merging); anchoring wins. Documented.
STEM_STRIP_W = 5
STEM_SIDE_TOL = 16
STEM_DENSITY = 0.25  # pdmx stems render ~2px wide (2/5=0.4); 7px/0.35 blinds them. TRAIN-verified variant.
MIN_STEM_RUN = 35
STAFF_BRIDGE = 6
BEAM_TOUCH = 15
FLAG_RADIUS = 30
DOT_RADIUS = 45


def chord_clusters(notes, tol: float = 45.0) -> list:
    """Group detected note boxes into chords by x-center proximity.

    Chordmates share nearly identical x centers AND overlapping y spans;
    melodic neighbors share neither. (Pure x-overlap over-merges dense
    melodic lines into measure-wide clusters; documented. tol 45 covers
    wide-chord spans like shared stems 50px out; melodic spacing is wider.)
    """
    parent = list(range(len(notes)))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    cx = [(n["box"][0] + n["box"][2]) / 2 for n in notes]
    for i in range(len(notes)):
        for j in range(i + 1, len(notes)):
            a, b = notes[i]["box"], notes[j]["box"]
            y_overlap = not (a[3] < b[1] - 60 or b[3] < a[1] - 60)
            if abs(cx[i] - cx[j]) < tol and y_overlap:
                parent[find(i)] = find(j)
    groups: dict[int, list] = {}
    for i in range(len(notes)):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def anchored_stem(ink: np.ndarray, beam_mask: np.ndarray, box, img_h: int) -> dict:
    """Search stems anchored at a detected notehead box (image only).

    Tries right edge (up-stems) and left edge (down-stems); keeps the side
    with the longer bridged vertical run. Returns stem presence, tip, beam
    count at the tip, and flag/dot evidence.
    """
    x0, y0, x1, y1 = (int(box[0]), int(box[1]), int(box[2]), int(box[3]))
    ny0, ny1 = max(y0, 0), min(y1, img_h - 1)
    EXT = 260  # stems extend well beyond the notehead; search outward
    sy0, sy1 = max(ny0 - EXT, 0), min(ny1 + EXT, img_h - 1)
    top_idx = ny0 - sy0  # notehead top edge in strip coords
    bot_idx = ny1 - sy0  # notehead bottom edge
    best = None
    for side, edge in (("right", x1), ("left", x0)):
        # allow a few px tolerance around the edge
        strip = None
        for dx in range(-STEM_SIDE_TOL, STEM_SIDE_TOL + 1):
            xx = min(max(edge + dx, 0), ink.shape[1] - STEM_STRIP_W)
            col = ink[sy0:sy1 + 1, xx:xx + STEM_STRIP_W].mean(axis=1) > STEM_DENSITY
            strip = col if strip is None else (strip | col)
        # Runs outward from the notehead edges (bridged across staff).
        up = _bridged_run(strip, top_idx, -1)
        down = _bridged_run(strip, bot_idx, 1)
        if up >= down:
            run, tip_y, direction = up, sy0 + top_idx - up, -1
            run_span = (sy0 + top_idx - up, ny0)
        else:
            run, tip_y, direction = down, sy0 + bot_idx + down, 1
            run_span = (ny1, sy0 + bot_idx + down)
        if best is None or run > best["run"]:
            best = {"side": side, "run": run, "tip": (edge, tip_y),
                    "dir": direction, "edge": edge, "span": run_span,
                    "strip_x": edge}
    out = {"stem": best["run"] >= MIN_STEM_RUN, "run": best["run"], "tip": best["tip"],
           "beams": 0, "flag": False, "dots": 0, "dot_xy": []}
    if not out["stem"]:
        return out
    tx, ty = best["tip"]
    # Beam count: distinct beam-mask row-groups intersecting the FULL stem
    # run column (robust to tip overshoot/undershoot; tip windows miss).
    y_lo, y_hi = max(min(best["span"]) - 4, 0), min(max(best["span"]) + 4, ink.shape[0] - 1)
    col = beam_mask[y_lo:y_hi + 1, max(tx - 6, 0):tx + 7].any(axis=1)
    rows = np.nonzero(col)[0]
    groups, prev = 0, -99
    for r in rows:
        if r - prev > 3:
            groups += 1
        prev = r
    out["beams"] = groups
    # Flags: touch-constrained retry measured (TRAIN: tp 177 / fp 7825 /
    # fn 233 -> P 0.022 / R 0.43). Unusable precision (tip error admits all
    # nearby ink); stays ABSTINENT. Flagged durations err to quarter.
    out["flag"] = False
    # Dots: candidates in global coords (caller dedups + attaches).
    mid = (ny0 + ny1) // 2
    dx0 = min(x1 + 4, ink.shape[1] - 1)
    region = ink[max(mid - DOT_RADIUS, 0):min(mid + DOT_RADIUS + 1, ink.shape[0]),
                 dx0:min(dx0 + DOT_RADIUS * 2, ink.shape[1])]
    lab, n = ndi.label(region)
    for i in range(1, n + 1):
        ys, xs = np.nonzero(lab == i)
        h, w = ys.max() - ys.min() + 1, xs.max() - xs.min() + 1
        if len(ys) >= 6 and max(h, w) <= 16:
            out["dots"] += 1
            out["dot_xy"].append((float(xs.mean() + dx0), float(ys.mean() + max(mid - DOT_RADIUS, 0))))
    return out


def _bridged_run(col: np.ndarray, start: int, step: int) -> int:
    """Length of a vertical ink run from `start`, bridging gaps <= STAFF_BRIDGE."""
    run, gap, i = 0, 0, start
    while 0 <= i < len(col):
        if col[i]:
            run += gap + 1
            gap = 0
        else:
            gap += 1
            if gap > STAFF_BRIDGE:
                break
        i += step
    return run


def detect_stems_beams(u8: np.ndarray):
    # Legacy global detector kept for the beam mask only (thick-horizontal
    # opening on raw ink; see note above on staffless failure). Kernel
    # (5,60): beams (~10px) survive, staff lines (~3px) die, notehead rows
    # are killed by the thickness<=25 filter (chords would pass (5,60)).
    ink = u8 < 128
    raw = ndi.binary_opening(ink, structure=np.ones((5, 60)))
    lab, n = ndi.label(raw)
    beam_mask = np.zeros_like(raw)
    for i in range(1, n + 1):
        ys, xs = np.nonzero(lab == i)
        h = ys.max() - ys.min() + 1
        if len(ys) >= 60 and h <= 25:
            beam_mask[lab == i] = True
    return [], beam_mask


def seg_dist_point(seg, x, y) -> float:
    x0, y0, x1, y1 = seg
    cx = min(max(x, x0), x1)
    cy = min(max(y, y0), y1)
    return abs(x - cx) + abs(y - cy)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hires", required=True)
    parser.add_argument("--work", required=True, action="append")
    parser.add_argument("--out", required=True)
    parser.add_argument("--split", default="train", choices=["train", "validation"])
    parser.add_argument("--max-pages", type=int, default=0, help="smoke-test cap (0 = all)")
    args = parser.parse_args()
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    hires_dir, out_dir = Path(args.hires), Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    work_dirs = [Path(w) for w in args.work]
    want = args.split
    ids = set()
    for mp in ["datasets/guitar-vision/pdmx/dataset-manifest.json",
               "datasets/guitar-vision/v2/dataset-manifest.json"]:
        for s in json.load(open(mp))["splits"]["assignments"]:
            if (want == "train") == (s["split"] == "train"):
                ids.add(s["sample"])
    ws = json.load(open("/tmp/proof/workdirs.json"))
    model = TinyFCN().to(device)
    sd = torch.load("datasets/guitar-vision/proof-detection/heatmap16ep.pt",
                     map_location=device, weights_only=True)
    model.load_state_dict(sd.get("state", sd))
    model.eval()

    stem_tp = stem_fp = stem_fn = 0
    beam_pair_tp = beam_pair_fp = beam_pair_fn = 0
    flag_tp = flag_fp = flag_fn = 0
    meas_pair_tp = meas_pair_fp = meas_pair_fn = 0
    dur_ok = dur_n = 0
    dur_conf: dict[str, dict[str, int]] = {}
    dot_ok = dot_n = 0
    det_miss = 0
    assoc_ok = assoc_n = 0
    link_totals: dict[str, int] = {}
    n_pages = 0
    with torch.no_grad():
        for mp in sorted(Path(hires_dir).glob("*-manifest.json")):
            sample = mp.name.replace("-manifest.json", "")
            if sample not in ids:
                continue
            if args.max_pages and n_pages >= args.max_pages:
                break
            man = json.load(open(mp))
            joins = canon = None
            for root in work_dirs:
                for cand in (root / sample / "joins.json",
                             root / "joins.json" if root.name == sample else None):
                    if cand is not None and cand.exists():
                        joins = json.load(open(cand))
                        break
                if joins is not None:
                    break
            for root in work_dirs:
                for cand in (root / sample / "canonical.json",
                             root / "canonical.json" if root.name == sample else None):
                    if cand is not None and cand.exists():
                        canon = json.load(open(cand))
                        break
                if canon is not None:
                    break
            if joins is None:
                continue
            # Exact event links (document-order counters; verified 99.8%
            # self-consistent corpus-wide). Supervision construction may
            # use truth; image inference never does.
            prefix = sample
            first_sid = next(iter((joins.get("joins") or {})), "")
            if "-n" in first_sid:
                prefix = first_sid.rsplit("-n", 1)[0]
            links, link_stats = evlink.build_links(joins, canon, prefix)
            for key, value in link_stats.items():
                link_totals[key] = link_totals.get(key, 0) + value
            for tag, meta in man.items():
                if not isinstance(meta, dict) or "file" not in meta:
                    continue
                pno = int(tag.replace("page", ""))
                img = Image.open(meta["file"]).convert("L")
                px = np.asarray(img, dtype=np.float32) / 255.0
                u8 = (px * 255).astype(np.uint8)
                fx, fy = meta["cssWidth"] / meta["viewBox"][0], meta["height"] / meta["viewBox"][1]
                # Native scale (frozen): rhythm primitives were TRAIN-tuned at
                # native geometry; normed note boxes degrade anchored search
                # (TRAIN stem R 0.52 native vs 0.35 normed). Detection uses
                # norm; rhythm primitives stay native. Documented split.
                heat = model(torch.from_numpy(px).unsqueeze(0).unsqueeze(0).to(device))[0].cpu()
                preds = dec.decode_page(heat, u8, fx, fy)
                notes = [p for p in preds if p["cls"] == "note"]
                ink = u8 < 128
                _, beam_mask = detect_stems_beams(u8)
                beam_lab, _ = ndi.label(beam_mask)
                # Chord clusters share stems: analyze the cluster's outer
                # edges once, share attributes with members.
                clusters = chord_clusters(notes)
                member_attr: dict[int, dict] = {}
                for cl in clusters:
                    x0 = min(notes[i]["box"][0] for i in cl)
                    x1 = max(notes[i]["box"][2] for i in cl)
                    y0 = min(notes[i]["box"][1] for i in cl)
                    y1 = max(notes[i]["box"][3] for i in cl)
                    attr = anchored_stem(ink, beam_mask, [x0, y0, x1, y1], u8.shape[0])
                    for i in cl:
                        member_attr[i] = attr
                # Global dot dedup: cluster all dot candidates (<10px),
                # attach each to the nearest note box (dot right of box,
                # within 80px). Per-box regions double-count chord dots.
                all_dots = []
                for i, p in enumerate(notes):
                    for xy in member_attr.get(i, {}).get("dot_xy", []):
                        all_dots.append(xy)
                dot_clusters: list[list] = []
                for xy in all_dots:
                    placed = False
                    for dc in dot_clusters:
                        if abs(dc[0][0] - xy[0]) + abs(dc[0][1] - xy[1]) < 10:
                            dc.append(xy)
                            placed = True
                            break
                    if not placed:
                        dot_clusters.append([xy])
                member_dots = {i: 0 for i in range(len(notes))}
                for dc in dot_clusters:
                    mx, my = sum(p[0] for p in dc) / len(dc), sum(p[1] for p in dc) / len(dc)
                    best_i, best_d = -1, 1e9
                    for i, p in enumerate(notes):
                        dx = mx - p["box"][2]
                        dy = abs(my - (p["box"][1] + p["box"][3]) / 2)
                        if -10 <= dx <= 80 and dy < 50:
                            d = abs(dx) + dy
                            if d < best_d:
                                best_i, best_d = i, d
                    if best_i >= 0:
                        member_dots[best_i] += 1
                # GT notes on this page with truth rhythm.
                gt_notes = []
                for sid, join in joins["joins"].items():
                    if (join.get("page") or 1) != pno or not join.get("boxes"):
                        continue
                    if "notehead" not in (join.get("children") or []):
                        continue
                    m = re.search(r"-n(\d+)$", sid)
                    if not m:
                        continue
                    boxes = join["boxes"]
                    r = (join.get("rhythm") or {})
                    gt_notes.append({"n": int(m.group(1)), "sid": sid,
                                     "cx": (min(b[0] for b in boxes) + max(b[2] for b in boxes)) / 2 * fx,
                                     "cy": (min(b[1] for b in boxes) + max(b[3] for b in boxes)) / 2 * fy,
                                     "stem": r.get("stem") is not None,
                                     "beam": r.get("beam"),
                                     "flag": bool(r.get("flag")),
                                     "dots": r.get("dots") or 0})
                # Anchored analysis per GT note (nearest detected box with
                # IoU>=0.3 vs the GT core box; 40px-Manhattan over-matches
                # on dense pages and fakes recall. Documented.)
                gt_core = {g["n"]: g for g in
                           [{"n": gg["n"], "box": None} for gg in gt_notes]}
                core_boxes = dec.build_gt(joins, pno, fx, fy, core=True)
                # core_boxes order matches joins order, not gt_notes; map by center proximity
                pred_beam_label: dict[int, int] = {}
                for g in gt_notes:
                    cb = min(core_boxes, key=lambda c: abs((c["box"][0] + c["box"][2]) / 2 - g["cx"]) + abs((c["box"][1] + c["box"][3]) / 2 - g["cy"]))
                    g["core"] = cb["box"]
                    det_idx, det = None, None
                    bd = 1e9
                    for i, p in enumerate(notes):
                        if p["cls"] != "note":
                            continue
                        if dec.iou(p["box"], g["core"]) < 0.3:
                            continue
                        d = abs(g["cx"] - p["x"]) + abs(g["cy"] - p["y"])
                        if d < bd:
                            det_idx, det, bd = i, p, d
                    g["detMiss"] = det is None
                    if g["detMiss"]:
                        det_miss += 1
                        stem_fn += 1
                        continue
                    a = dict(member_attr[det_idx])
                    # Globally-deduped attached dots override per-box counts.
                    a["dots"] = member_dots.get(det_idx, 0)
                    g["a"] = a
                    if a["flag"]:
                        if g["flag"]:
                            flag_tp += 1
                        else:
                            flag_fp += 1
                    elif g["flag"]:
                        flag_fn += 1
                    if a["stem"]:
                        if g["stem"]:
                            stem_tp += 1
                        else:
                            stem_fp += 1
                    elif g["stem"]:
                        stem_fn += 1
                    # Beam-group label: beam-mask component at the tip.
                    tx, ty = a["tip"]
                    if a["stem"]:
                        y_lo, y_hi = max(ty - BEAM_TOUCH, 0), min(ty + BEAM_TOUCH, u8.shape[0] - 1)
                        comp = beam_lab[y_lo:y_hi + 1, max(tx - 6, 0):tx + 7]
                        nz = comp[comp > 0]
                        pred_beam_label[g["n"]] = int(nz[0]) if len(nz) else -1
                    else:
                        pred_beam_label[g["n"]] = -1
                # Pairwise beam-group agreement (truth beam ids vs tip components).
                ids_n = [g["n"] for g in gt_notes if not g["detMiss"]]
                for i in range(len(ids_n)):
                    for j in range(i + 1, len(ids_n)):
                        a, b = ids_n[i], ids_n[j]
                        ga = next(g["beam"] for g in gt_notes if g["n"] == a)
                        gb = next(g["beam"] for g in gt_notes if g["n"] == b)
                        same_truth = ga is not None and ga == gb
                        same_pred = (pred_beam_label[a] > 0 and
                                     pred_beam_label[a] == pred_beam_label[b])
                        if same_truth and same_pred:
                            beam_pair_tp += 1
                        elif same_pred and not same_truth:
                            beam_pair_fp += 1
                        elif same_truth and not same_pred:
                            beam_pair_fn += 1
                # Measure ownership: barline intervals vs event measures.
                # (detect_barlines imported from the measure module.)
                import bisect as _bisect
                bar_xs = sorted(mbars.detect_barline_xs(u8))
                for g in gt_notes:
                    g["interval"] = _bisect.bisect_left(bar_xs, g["cx"])
                    link = links.get(g["sid"], {})
                    ev = link.get("event")
                    g["measure"] = (ev.get("source") or {}).get("measure") if ev else None
                owned = [g for g in gt_notes if not g["detMiss"] and g["measure"] is not None]
                for i in range(len(owned)):
                    for j in range(i + 1, len(owned)):
                        same_int = owned[i]["interval"] == owned[j]["interval"]
                        same_meas = owned[i]["measure"] == owned[j]["measure"]
                        if same_int and same_meas:
                            meas_pair_tp += 1
                        elif same_int and not same_meas:
                            meas_pair_fp += 1
                        elif same_meas and not same_int:
                            meas_pair_fn += 1
                # Exact duration validation via event links (joins sid <->
                # canonical event, document-order counters). Rule: beamed ->
                # 0.5/2^(n-1); flagged -> 0.5; else quarter; dots x1.5 each.
                for g in gt_notes:
                    if g["detMiss"]:
                        continue
                    a = g["a"]
                    assoc_n += 1
                    if a["stem"] == g["stem"]:
                        assoc_ok += 1
                    dot_n += 1
                    if min(a["dots"], 2) == min(g["dots"], 2):
                        dot_ok += 1
                    link = links.get(g["sid"], {})
                    event = link.get("event")
                    if event is None:
                        continue
                    if a["beams"]:
                        pred_dur = 0.5 / (2 ** (a["beams"] - 1))
                    elif a["flag"]:
                        pred_dur = 0.5
                    else:
                        pred_dur = 1.0
                    if a["dots"]:
                        pred_dur *= 1.5 ** min(a["dots"], 2)
                    truth_dur = (event.get("time") or {}).get("durationQuarters")
                    dur_n += 1
                    if truth_dur is not None and abs(pred_dur - truth_dur) < 1e-9:
                        dur_ok += 1
                    tk, pk = str(truth_dur), str(round(pred_dur, 4))
                    dur_conf.setdefault(tk, {}).setdefault(pk, 0)
                    dur_conf[tk][pk] += 1
                n_pages += 1
                if args.max_pages and n_pages >= args.max_pages:
                    break
    stem_p = stem_tp / max(stem_tp + stem_fp, 1)
    stem_r = stem_tp / max(stem_tp + stem_fn, 1)
    report = {"pages": n_pages,
              "stem": {"tp": stem_tp, "fp": stem_fp, "fn": stem_fn,
                       "precision": stem_p, "recall": stem_r},
              "detMiss": det_miss,
              "beamPairs": {"tp": beam_pair_tp, "fp": beam_pair_fp, "fn": beam_pair_fn},
              "flag": {"tp": flag_tp, "fp": flag_fp, "fn": flag_fn,
                       "precision": flag_tp / max(flag_tp + flag_fp, 1),
                       "recall": flag_tp / max(flag_tp + flag_fn, 1)},
              "measurePairs": {"tp": meas_pair_tp, "fp": meas_pair_fp, "fn": meas_pair_fn},
              "stemAgree": assoc_ok / max(assoc_n, 1), "stemAgreeN": assoc_n,
              "dotAgree": dot_ok / max(dot_n, 1), "dotN": dot_n,
              "durationAcc": dur_ok / max(dur_n, 1), "durationN": dur_n,
              "durationConfusion": dur_conf,
              "linkStats": link_totals}
    (out_dir / "rhythm-graph.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
