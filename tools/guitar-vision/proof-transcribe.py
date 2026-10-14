#!/usr/bin/env python3
"""Transcriber v1 (Part 4, bounded): detected TAB -> MusicXML.

Pipeline (image only): merged detection -> fret/string heads (TAU) ->
onset columns (x-clustering) -> staff-side duration rule per column
(quarter default flagged) -> barline measures -> voice 1 + chord tags ->
single-part MusicXML with pitch + technical string/fret.

No truth at inference. Defaults counted separately (not hidden).

Usage:
    python3 tools/guitar-vision/proof-transcribe.py --sample <id> --out <dir>
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
import xml.etree.ElementTree as ET

import numpy as np
import torch
from scipy import ndimage as ndi
import torch.nn.functional as F
from PIL import Image

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, TOOLS / path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_pt = _load("proof_train_mod", "proof_train.py")
_pct = _load("proof_context_train_mod", "proof_context_train.py")
_pig = _load("proof_ignore_train_mod", "proof-ignore-train.py")
_phm = _load("proof_heatmap_train_mod", "proof-heatmap-train.py")
dec = _load("proof_heatmap_decode_mod", "proof-heatmap-decode.py")
rhy = _load("proof_rhythm_graph_mod", "proof-rhythm-graph.py")
mbars = _load("proof_measure_bars_mod", "proof-measure-bars.py")
_psg = _load("proof_string_geometric_mod", "proof-string-geometric.py")

SEED = 20261009
STRING_TEMP = 0.7  # calibrated; see proof-calibrate.py
TAU = 0.6
TUNING = [64, 59, 55, 50, 45, 40]
DIVISIONS = 4  # per quarter
STEPS = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"]
ALTERS = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0]


def midi_to_pitch(midi: int):
    pc, octv = midi % 12, midi // 12 - 1
    return STEPS[pc], ALTERS[pc], octv


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--string-mode", default="hybrid",
                        choices=["net", "geometric", "hybrid"])
    parser.add_argument("--layout", default="standard",
                        choices=["standard", "compact", "large", "bravura"])
    parser.add_argument("--hires", default=None)
    parser.add_argument("--detector", default=None)
    parser.add_argument("--upscale", type=float, default=None,
                        help="input upscale (default 1.3 for large, else 1.0)")
    parser.add_argument("--ledger", default=None,
                        help="write a JSON filter-attrition ledger")
    args = parser.parse_args()
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    ws = json.load(open("/tmp/proof/workdirs.json"))

    recognizer = _pt.ProofNet().to(device)
    saved = torch.load(Path("/tmp/proof/chain-models") / "proof-model.pt",
                        map_location=device, weights_only=True)
    recognizer.load_state_dict(saved["state"] if "state" in saved else saved)
    recognizer.eval()
    string_net = _pct.StringNet().to(device)
    saved_s = torch.load(Path("/tmp/proof/chain-models") / "stringnet.pt",
                          map_location=device, weights_only=True)
    string_net.load_state_dict(saved_s["state"] if "state" in saved_s else saved_s)
    string_net.eval()
    _det_path = args.detector or ("datasets/guitar-vision/proof-detection/heatmap-v4.pt"
                 if args.layout == "compact"
                 else "datasets/guitar-vision/proof-detection/heatmap-ignore.pt")
    detector = _pig.TinyFCN4().to(device)
    saved_d = torch.load(_det_path, map_location=device, weights_only=True)
    detector.load_state_dict(saved_d["state"] if "state" in saved_d else saved_d)
    detector.eval()

    sample = args.sample
    _hires = Path(args.hires or ("/tmp/proof/hires" if args.layout == "standard"
                                 else f"/tmp/proof/hires-{args.layout}"))
    _suf = "" if args.layout == "standard" else f"-{args.layout}"
    _jname = "joins.json" if args.layout == "standard" else f"joins-{args.layout}.json"
    man = json.load(open(_hires / f"{sample}{_suf}-manifest.json"))
    ledger = []
    joins = None
    for root in ws:
        for cand in (f"{root}/{sample}/{_jname}",
                     f"{root}/{_jname}" if Path(root).name == sample else None):
            if cand and Path(cand).exists():
                joins = json.load(open(cand))
                break
        if joins:
            break
    assert joins is not None, "joins missing"

    notes_out = []  # (page, x, string, fret, midi, dur_quarters, defaulted)
    n_defaulted = 0
    with torch.no_grad():
        for tag, meta in sorted(man.items()):
            if not isinstance(meta, dict) or "file" not in meta:
                continue
            pno = int(tag.replace("page", ""))
            image = Image.open(meta["file"]).convert("L")
            pixels = np.asarray(image, dtype=np.float32) / 255.0
            u8 = (pixels * 255).astype(np.uint8)
            fx, fy = meta["cssWidth"] / meta["viewBox"][0], meta["height"] / meta["viewBox"][1]
            _us = args.upscale if args.upscale is not None else (1.3 if args.layout == "large" else 1.0)
            preds, _ = dec.infer_page_merged(detector, u8, fx, fy, device, upscale=_us)
            digits = [p for p in preds if p["cls"] == "tabdigit"]
            note_boxes = [p for p in preds if p["cls"] == "note"]
            ink = u8 < 128
            _, beam_mask = rhy.detect_stems_beams(u8)
            # Per-system barlines (2D ownership): global-x bisect mixes
            # stacked systems. Each note is owned by its system (by y),
            # then bisected in that system's barline list.
            sys_bars = mbars.detect_barline_systems(u8)
            import bisect as _bisect
            _garr = np.asarray(image, dtype=np.float32)
            _rule = (u8 < 128).mean(axis=1) > 0.5  # full-width staff rows
            _page_sp = _psg.page_spacing(_garr)
            if not any(s.get("tab") for s in sys_bars) and digits:
                # Digit-cluster fallback: band detection found no TAB
                # staff (fragmented small-scale pages). Cluster digit
                # rows into systems, detect barlines per cluster span.
                # Band path untouched when TAB exists (zero regression).
                _cys = sorted(d["y"] for d in digits)
                _ggap = max(100.0, 3 * (_page_sp or 0))
                _cl, _cur = [], [_cys[0]]
                for _a, _b in zip(_cys, _cys[1:]):
                    if _b - _a > _ggap:
                        _cl.append(_cur)
                        _cur = [_b]
                    else:
                        _cur.append(_b)
                _cl.append(_cur)
                _fb = []
                for _cc in _cl:
                    # Ownership/filter span: wide (all digits inside).
                    # Bar detection span: tight around digit rows (a true
                    # barline always spans MORE than the digit range, so
                    # cover stays ~1.0; wide spans dilute cover).
                    _sp = (_page_sp or 32)
                    _t, _bo = int(min(_cc) - 3 * _sp), int(max(_cc) + 3 * _sp)
                    _bt, _bb = int(min(_cc) - 0.5 * _sp), int(max(_cc) + 0.5 * _sp)
                    _xs = mbars.bars_in_span(u8, _bt, _bb, min_cover=0.5)
                    _dx = [d["x"] for d in digits if _t <= d["y"] <= _bo]
                    _xs = sorted(set(_xs + ([min(_dx) - 30] if _dx else [])))
                    _fb.append({"top": _t, "bot": _bo, "xs": _xs, "tab": True})
                if _fb:
                    sys_bars = _fb
            # TAB-span filter: drop digit detections far from every TAB
            # staff (fingering/rehearsal FPs live between/above staves and
            # otherwise mint phantom measures). Margin scales with page_sp.
            _tabspans = [(s["top"], s["bot"]) for s in sys_bars if s.get("tab")]
            events = []
            _led = {"digits": len(digits), "tabspan": 0, "tau": 0, "tau_gt": 0, "emitted": 0,
                    "sys_src": "", "n_sys": 0,
                    "tau_detail": [], "page": pno}
            # Validate the band-detected TAB spans against the ACTUAL digit
            # positions. A spurious 6-line group in the notation (page 2 of
            # Txo yields one span at y 1699-1830 while the real TAB staves
            # sit at 283/729/1192/1656) marks tab=True and both blocks the
            # digit-cluster fallback and drops ~94% of the page's digits.
            # When the band spans do not cover the digits, rebuild one span
            # per digit cluster - i.e. per visible TAB system.
            if digits and _page_sp:
                _cov = sum(1 for d in digits
                           if any(0 if t <= d["y"] <= b else
                                  min(abs(d["y"] - t), abs(d["y"] - b))
                                  <= 0.75 * _page_sp for t, b in _tabspans))
                if _tabspans and _cov < 0.5 * len(digits):
                    _led["respan_from"] = len(_tabspans)
                    _cys = sorted(d["y"] for d in digits)
                    # a TAB staff is 5 gaps tall; systems are further apart
                    _ggap = max(6 * _page_sp, 120.0)
                    _cl, _cur = [], [_cys[0]]
                    for _a, _b in zip(_cys, _cys[1:]):
                        if _b - _a > _ggap:
                            _cl.append(_cur)
                            _cur = [_b]
                        else:
                            _cur.append(_b)
                    _cl.append(_cur)
                    # TAB SYSTEM detection from detected STAFF LINES.
                    # Digit y-clusters are a poor proxy: detections spread
                    # unevenly, so clusters merge/split real staves (Txo
                    # bars_per_sys [1,4,4,4,6] vs a true [4,4,4,4,4]) and the
                    # monotonic numbering then shifts every later measure. A
                    # TAB staff IS a 6-line group with a consistent gap, so
                    # detect those directly; digits remain the fallback.
                    _sp = (_page_sp or 32)
                    _lineb = []
                    _ink2 = u8 < 128
                    _hh, _ww = _ink2.shape
                    _rf = _ink2[:, int(_ww * 0.2):int(_ww * 0.8)].mean(axis=1)
                    _lrows = np.nonzero(_rf > 0.3)[0]
                    if len(_lrows) >= 6:
                        _lb, _st, _pv = [], _lrows[0], _lrows[0]
                        for _r in _lrows[1:]:
                            if _r - _pv > 3:
                                _lb.append((_st, _pv))
                                _st = _r
                            _pv = _r
                        _lb.append((_st, _pv))
                        _lineb = [((a + b) / 2, b - a + 1) for a, b in _lb]
                    _staff_runs = []
                    _i = 0
                    while _i + 6 <= len(_lineb):
                        _mids = [m for m, _ in _lineb[_i:_i + 6]]
                        _gaps = [b - a for a, b in zip(_mids, _mids[1:])]
                        _mg = sum(_gaps) / 5.0
                        _thick = max(w for _, w in _lineb[_i:_i + 6])
                        _cv = (sum((x - _mg) ** 2 for x in _gaps) / 5.0) ** 0.5 / _mg
                        if _mg > 0 and _thick <= 0.35 * _mg and _cv <= 0.18:
                            _staff_runs.append((_mids[0], _mids[-1]))
                            _i += 6
                        else:
                            _i += 1
                    _groups = [(_a, _b) for _a, _b in _staff_runs] or                               [(min(_cc), max(_cc)) for _cc in _cl]
                    _fb = []
                    for _a, _b in _groups:
                        _t = int(_a - 3 * _sp)
                        _bo = int(_b + 3 * _sp)
                        _bt, _bb = int(_a - 0.5 * _sp), int(_b + 0.5 * _sp)
                        _xs = mbars.bars_in_span(u8, _bt, _bb, min_cover=0.5)
                        _dx = [d["x"] for d in digits if _t <= d["y"] <= _bo]
                        _xs = sorted(set(_xs + ([min(_dx) - 30] if _dx else [])))
                        _fb.append({"top": _t, "bot": _bo, "xs": _xs, "tab": True})
                    # Barline completion: a measure boundary missed inside a
                    # system merges two measures into one interval, and the
                    # monotonic numbering then shifts EVERY later measure by
                    # one (Txo system 5 dropped one barline -> all of page 2
                    # wrong). Measures within a system are separated by the
                    # page's modal inter-barline distance, so a missing
                    # boundary is recoverable from the neighbours' spacing.
                    if _fb:
                        _xs = [s["xs"] for s in _fb]
                        _counts = [len(x) for x in _xs]
                        _modal = max(set(_counts), key=_counts.count) if _counts else 0
                        for _si, _x in enumerate(_xs):
                            if len(_x) >= _modal or len(_x) < 2:
                                continue
                            _gaps = [b - a for a, b in zip(_x, _x[1:])]
                            _med = sorted(_gaps)[len(_gaps) // 2] if _gaps else 0
                            if _med <= 0:
                                continue
                            _newx = list(_x)
                            while len(_newx) < _modal:
                                _g2 = [b - a for a, b in zip(_newx, _newx[1:])]
                                if not _g2:
                                    break
                                _w = max(range(len(_g2)), key=lambda i: _g2[i])
                                if _g2[_w] < 1.6 * _med:
                                    break  # no suspiciously wide gap
                                _newx.insert(_w + 1, _newx[_w] + _med)
                            _xs[_si] = sorted(_newx)
                        _fb = [dict(s, xs=_xs[i]) for i, s in enumerate(_fb)]
                        _tabspans = [(s["top"], s["bot"]) for s in _fb]
                        _led["respan_to"] = len(_fb)
                        _led["modal_bars"] = _modal
                        _led["bars_per_sys"] = [len(s["xs"]) for s in _fb]
                        _led["sys_src"] = "staff" if _staff_runs else "digits"
            for det in digits:
                cx, cy = det["x"], det["y"]
                if _tabspans and _page_sp:
                    _dtab = min([0 if top <= cy <= bot else min(abs(cy - top), abs(cy - bot))
                                 for top, bot in _tabspans])
                    if _dtab > 0.75 * _page_sp:
                        _led["tabspan"] += 1
                        if len(_led.setdefault("tabspan_detail", [])) < 200:
                            _led["tabspan_detail"].append({
                                "x": round(cx, 1), "y": round(cy, 1),
                                "dtab": round(float(_dtab), 1),
                                "margin": round(float(0.75 * _page_sp), 1),
                                "spans": [[int(a), int(b)] for a, b in _tabspans],
                                "nsys": len(sys_bars)})
                        continue
                w, h = det["box"][2] - det["box"][0], det["box"][3] - det["box"][1]
                side = max(w, h) * 0.8
                crop = image.crop((max(int(cx - side), 0), max(int(cy - side), 0),
                                   min(int(cx + side), image.width), min(int(cy + side), image.height)))
                crop = crop.resize((64, 64), Image.BILINEAR)
                tensor = torch.from_numpy(np.asarray(crop, dtype=np.float32) / 255.0).unsqueeze(0).unsqueeze(0).to(device)
                rec_out = recognizer(tensor)
                half_h = max(h * 1.1, 160 * (h / 253))
                tall = image.crop((max(int(cx - w), 0), max(int(cy - half_h), 0),
                                   min(int(cx + w), image.width), min(int(cy + half_h), image.height)))
                tall = tall.resize((64, 256), Image.BILINEAR)
                tall_t = torch.from_numpy(np.asarray(tall, dtype=np.float32) / 255.0).unsqueeze(0).unsqueeze(0).to(device)
                sp = F.softmax(string_net(tall_t)["string"] / STRING_TEMP, dim=1)[0]
                fp = F.softmax(rec_out["fret"], dim=1)[0]
                s_pred, s_conf = int(sp.argmax()), float(sp.max())
                f_pred, f_conf = int(fp.argmax()), float(fp.max())
                if f_pred in (0, 1, 3, 4) and _page_sp:
                    # Glyph geometry overrides (staff rows excluded; sizes
                    # in spacing units). Width = center-connected ink
                    # component (flood fill from crop center): immune to
                    # neighbor glyphs (disconnected) and box offsets,
                    # unlike minmax-column width. Window +-20px.
                    _wx0, _wx1 = max(0, int(cx - 20)), int(cx + 20)
                    _wy0, _wy1 = max(0, int(cy - 20)), int(cy + 20)
                    _keep = [r for r in range(_wy0, _wy1) if not _rule[r]]
                    _wsp = None
                    if _keep:
                        _gw = (u8[_keep, :][:, _wx0:_wx1] < 128)
                        _lab0, _nn0 = ndi.label(_gw)
                        _mr, _mc = _gw.shape[0] // 2, _gw.shape[1] // 2
                        _cid = _lab0[_mr, _mc]
                        if _cid == 0:
                            # center is background (e.g. '0' hole): nearest ink
                            _ys0, _xs0 = np.nonzero(_gw)
                            if len(_ys0):
                                _d2 = (_ys0 - _mr) ** 2 + (_xs0 - _mc) ** 2
                                _cid = _lab0[_ys0[_d2.argmin()], _xs0[_d2.argmin()]]
                        if _cid:
                            _ys, _xs = np.nonzero(_lab0 == _cid)
                            _wsp = (_xs.max() - _xs.min() + 1) / _page_sp
                    if _wsp is not None:
                        if f_pred in (1, 4):
                            _wf = 1 if _wsp < dec.FRET_WIDTH_SPLIT else 4
                            if _wf != f_pred:
                                f_pred = _wf
                        elif f_pred == 0 and _wsp < dec.FRET_NARROW_ONE:
                            f_pred = 1
                        elif f_pred == 3:
                            _hx0, _hx1 = max(0, int(cx - 20)), int(cx + 20)
                            _hy0, _hy1 = max(0, int(cy - 20)), int(cy + 20)
                            _hk = [r for r in range(_hy0, _hy1) if not _rule[r]]
                            _bg = None
                            if _hk:
                                _gw = (u8[_hk, :][:, _hx0:_hx1] < 128)
                                _bg = ~_gw
                            _ok = False
                            if _bg is not None:
                                _lab, _nn = ndi.label(_bg)
                                _bd = (set(_lab[0, :]) | set(_lab[-1, :]) | set(_lab[:, 0]) | set(_lab[:, -1]))
                                for _i in range(1, _nn + 1):
                                    if _i in _bd:
                                        continue
                                    _ys, _xs = np.nonzero(_lab == _i)
                                    # hole centroid near crop center (offset-
                                    # tolerant but rejects neighbor glyphs)
                                    if abs(_xs.mean() - _gw.shape[1] / 2) > 12:
                                        continue
                                    if abs(_ys.mean() - _gw.shape[0] / 2) > 12:
                                        continue
                                    _ok = True
                                if _ok:
                                    f_pred = 0
                _xb = int(900 * fx)
                _peaks, _ = _psg.detect_peaks(_garr, int(cx - _xb), int(cx + _xb))
                _geo, _geoconf = _psg.assign_string(_peaks, cy, sp_hint=_page_sp)
                if args.string_mode in ("geometric", "hybrid") and _geo is not None:
                    s_pred, s_conf = _geo - 1, _geoconf
                if args.string_mode == "geometric" and _geo is None:
                    continue
                if min(s_conf, f_conf) < TAU:
                    _led["tau"] += 1
                    if len(_led["tau_detail"]) < 400:
                        _led["tau_detail"].append({
                            "x": round(cx, 1), "y": round(cy, 1), "v": round(det.get("v", 0), 3),
                            "s": s_pred, "sconf": round(s_conf, 3),
                            "f": f_pred, "fconf": round(f_conf, 3),
                            "geo": _geo, "geoconf": round(_geoconf or 0, 3)})
                    continue
                _led["emitted"] += 1
                events.append({"x": cx, "y": cy, "string": s_pred + 1, "fret": f_pred,
                               "midi": TUNING[s_pred] + f_pred})
            # Onset columns (<12px) PER SYSTEM: x-only clustering merges
            # same-x digits from different systems (different measures!)
            # into phantom columns (wrong shared durations/chords).
            # Onsets live within a system; cluster x inside y-systems.
            columns = []
            _sysidx = {}
            for _si, _s in enumerate(sys_bars):
                for _e in events:
                    if _s["top"] <= _e["y"] <= _s["bot"]:
                        _sysidx.setdefault(_si, []).append(_e)
            _assigned = set(id(_e) for _v in _sysidx.values() for _e in _v)
            _rest = [_e for _e in events if id(_e) not in _assigned]
            if _rest:
                _sysidx.setdefault(len(sys_bars), []).extend(_rest)
            for _si in sorted(_sysidx):
                _se = sorted(_sysidx[_si], key=lambda e: e["x"])
                cur = []
                for e in _se:
                    if cur and e["x"] - cur[-1]["x"] > 12:
                        columns.append((_si, cur))
                        cur = []
                    cur.append(e)
                if cur:
                    columns.append((_si, cur))
            # Column rhythm: pair-bridge over adjacent same-system onsets
            # (peak-anchored fixes made pairs work live: Txo 95%, and
            # audit shows 248+49/321 correct). Bridges = rows of continuous
            # ink between the two column xs (staff rows excluded). Slur
            # false positives (Qmek: thin arcs) rejected by requiring
            # >=2 bridge rows with >=4-row runs each, and by the dot-rule
            # below (dots are near-horizontal strokes).
            for _si, col in columns:
                cx = sum(e["x"] for e in col) / len(col)
                _topcy = min(e["y"] for e in col)
                # Pair-bridge count: max over adjacent same-system onsets.
                # Zone matches the audit exactly: [system-mindy-140, -40]
                # where mindy = topmost digit in the system (col computed
                # from full system rows, not per column).
                _sibs = [c for s, c in columns if s == _si]
                _sysdy = min(e2["y"] for c2 in _sibs for e2 in c2)
                _ttop = _sysdy - 100
                _sx = [sum(e["x"] for e in c) / len(c) for c in _sibs]
                _me = _sx.index(cx) if cx in _sx else -1
                _pb = 0
                if _ttop is not None and _me >= 0 and _page_sp:
                    _zt, _zb = int(_ttop - 40), int(_ttop + 60)
                    _zt = max(0, _zt)
                    for _nb in (_me - 1, _me + 1):
                        if not (0 <= _nb < len(_sx)):
                            continue
                        _nx = _sx[_nb]
                        if not (8 <= abs(_nx - cx) <= 100) or _zt < 0:
                            continue
                        _xa, _xb = sorted([int(cx), int(_nx)])
                        _n = 0
                        _pv = -99
                        for _r in range(_zt, _zb + 1):
                            _row = u8[_r, max(0, _xa + 3):min(u8.shape[1], _xb - 2)] < 128
                            if len(_row) and _row.all():
                                if _r - _pv > 3:
                                    _n += 1
                                _pv = _r
                        _pb = max(_pb, _n)
                _beams = min(_pb, 2)
                # Nearest detected note box -> anchored duration (fallback
                # for dots + unbeamed columns).
                best_box, best_d = None, 1e9
                for nb in note_boxes:
                    ncx = (nb["box"][0] + nb["box"][2]) / 2
                    d = abs(ncx - cx)
                    if d < best_d:
                        best_box, best_d = nb["box"], d
                dur, defaulted = 1.0, True
                _ab = None
                if best_box is not None and best_d < 80:
                    _ab = rhy.anchored_stem(ink, beam_mask, best_box, u8.shape[0])
                if _beams >= 2:
                    # 2+ beam rows = 16th (groups=3 is 2 beams + 1
                    # contamination row; 32nds don't occur in TAB rhythm).
                    dur = 0.25
                    defaulted = False
                elif _beams == 1:
                    # Ambiguous: flagged-16th vs 8th vs quarter+neighbor
                    # contamination. Disambiguate via anchored notation
                    # stem beam count.
                    _nb = (_ab or {}).get("beams") or 0
                    if _nb >= 2:
                        dur = 0.25
                    elif _nb == 1:
                        dur = 0.5
                    else:
                        dur = 1.0
                    defaulted = False
                if _ab and _ab.get("stem"):
                    if not _beams:
                        if _ab.get("beams"):
                            dur = 0.5 / (2 ** (_ab["beams"] - 1))
                        else:
                            dur = 1.0
                    # Dots only on anchored-owned (unbeamed) durations:
                    # dot evidence on beamed columns is ~100% spurious
                    # (wrong-notehead association in dense texture).
                    if _ab.get("dots") and not _beams:
                        dur *= 1.5 ** min(_ab["dots"], 2)
                    defaulted = False
                if defaulted:
                    n_defaulted += 1
                for e in col:
                    # Per-system 2D ownership: system by y, interval by x.
                    own = None
                    for si, s in enumerate(sys_bars):
                        if s["top"] <= e["y"] <= s["bot"]:
                            own = si
                            break
                    if own is None and sys_bars:
                        own = min(range(len(sys_bars)),
                                  key=lambda si: abs(e["y"] - (sys_bars[si]["top"] + sys_bars[si]["bot"]) / 2))
                    interval = _bisect.bisect_left(sys_bars[own]["xs"], e["x"]) if own is not None else 0
                    notes_out.append({"page": pno, "sys": own, "x": e["x"], "y": e["y"], "interval": interval,
                                      "string": e["string"], "fret": e["fret"],
                                      "midi": e["midi"], "dur": dur, "defaulted": defaulted})
            if args.ledger:
                ledger.append(_led)
    # Measures: per (page, system, interval) -> running measure numbers.
    keys = sorted(set((n["page"], n["sys"], n["interval"]) for n in notes_out))
    mapping = {k: i + 1 for i, k in enumerate(keys)}
    for n in notes_out:
        n["measure"] = mapping[(n["page"], n["sys"], n["interval"])]
    # MusicXML (single part, voice 1, chord tags).
    score = ET.Element("score-partwise", version="4.0")
    part_list = ET.SubElement(score, "part-list")
    sp = ET.SubElement(part_list, "score-part", id="P1")
    ET.SubElement(sp, "part-name").text = "Guitar"
    part = ET.SubElement(score, "part", id="P1")
    by_measure: dict[int, list] = {}
    for n in sorted(notes_out, key=lambda z: (z["measure"], z["x"])):
        by_measure.setdefault(n["measure"], []).append(n)
    for meas_no in sorted(by_measure):
        meas = ET.SubElement(part, "measure", number=str(meas_no))
        attr = ET.SubElement(meas, "attributes")
        ET.SubElement(attr, "divisions").text = str(DIVISIONS)
        prev_x = None
        for n in sorted(by_measure[meas_no], key=lambda z: z["x"]):
            note = ET.SubElement(meas, "note")
            if prev_x is not None and abs(n["x"] - prev_x) < 12:
                ET.SubElement(note, "chord")
            prev_x = n["x"]
            pitch = ET.SubElement(note, "pitch")
            step, alter, octv = midi_to_pitch(n["midi"])
            ET.SubElement(pitch, "step").text = step
            if alter:
                ET.SubElement(pitch, "alter").text = str(alter)
            ET.SubElement(pitch, "octave").text = str(octv)
            ET.SubElement(note, "duration").text = str(max(int(round(n["dur"] * DIVISIONS)), 1))
            ET.SubElement(note, "voice").text = "1"
            # Type/dot consistent with duration (no invented type names).
            dur_q = n["dur"]
            dots = 0
            while dur_q not in (4.0, 2.0, 1.0, 0.5, 0.25, 0.125) and dots < 2:
                dur_q /= 1.5
                dots += 1
            ET.SubElement(note, "type").text = {4.0: "whole", 2.0: "half", 1.0: "quarter",
                                                 0.5: "eighth", 0.25: "16th",
                                                 0.125: "32nd"}.get(dur_q, "quarter")
            for _ in range(dots):
                ET.SubElement(note, "dot")
            notations = ET.SubElement(note, "notations")
            tech = ET.SubElement(notations, "technical")
            ET.SubElement(tech, "string").text = str(n["string"])
            ET.SubElement(tech, "fret").text = str(n["fret"])
    tree = ET.ElementTree(score)
    ET.indent(tree)
    out_xml = out_dir / f"{sample}{_suf}-transcribed.musicxml"
    tree.write(out_xml, encoding="unicode", xml_declaration=True)
    summary = {"notes": len(notes_out), "defaultedDur": n_defaulted,
               "measures": len(by_measure),
               "xml": str(out_xml)}
    (out_dir / f"{sample}{_suf}-summary.json").write_text(json.dumps(summary, indent=1))
    if args.ledger:
        (out_dir / f"{sample}{_suf}-ledger.json").write_text(json.dumps(ledger, indent=1))
    json.dump(notes_out, open(out_dir / f"{sample}{_suf}-notes.json", "w"))
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
