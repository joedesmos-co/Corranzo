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
    detector = _pig.TinyFCN4().to(device)
    saved_d = torch.load("datasets/guitar-vision/proof-detection/heatmap-ignore.pt",
                          map_location=device, weights_only=True)
    detector.load_state_dict(saved_d["state"] if "state" in saved_d else saved_d)
    detector.eval()

    sample = args.sample
    man = json.load(open(f"/tmp/proof/hires/{sample}-manifest.json"))
    joins = None
    for root in ws:
        for cand in (f"{root}/{sample}/joins.json",
                     f"{root}/joins.json" if Path(root).name == sample else None):
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
            preds, _ = dec.infer_page_merged(detector, u8, fx, fy, device)
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
            _rule = (u8 < 128).mean(axis=1) > 0.5  # full-width staff rules
            _full = (_garr < 128).mean(axis=1)
            _fthr = float(np.quantile(_full, 0.90))
            _fpeaks = [yy for yy in range(1, _garr.shape[0] - 1)
                       if _full[yy] >= _full[yy - 1] and _full[yy] >= _full[yy + 1] and _full[yy] > _fthr]
            _fdiffs = [_fpeaks[ii + 1] - _fpeaks[ii] for ii in range(len(_fpeaks) - 1)
                       if 8 <= _fpeaks[ii + 1] - _fpeaks[ii] <= 200]
            _page_sp = None
            if len(_fdiffs) >= 5:
                from collections import Counter as _C
                _bins = _C(int(dd) for dd in _fdiffs)
                _mode, _ = _bins.most_common(1)[0]
                _near = [dd for dd in _fdiffs if abs(dd - _mode) <= 2]
                _page_sp = sum(_near) / len(_near)
            events = []
            for det in digits:
                cx, cy = det["x"], det["y"]
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
                _xb = int(900 * fx)
                _peaks, _ = _psg.detect_peaks(_garr, int(cx - _xb), int(cx + _xb))
                _geo, _geoconf = _psg.assign_string(_peaks, cy, sp_hint=_page_sp)
                if args.string_mode in ("geometric", "hybrid") and _geo is not None:
                    s_pred, s_conf = _geo - 1, _geoconf
                if args.string_mode == "geometric" and _geo is None:
                    continue
                if min(s_conf, f_conf) < TAU:
                    continue
                events.append({"x": cx, "y": cy, "string": s_pred + 1, "fret": f_pred,
                               "midi": TUNING[s_pred] + f_pred})
            # Onset columns (<12px): dense 16ths sit 5-26px apart (GT
            # x-gap p90=17px); 30px merged whole systems into mega-columns.
            # Chord digits share x (gap ~0-8px incl. detection jitter).
            events.sort(key=lambda e: e["x"])
            columns, cur = [], []
            for e in events:
                if cur and e["x"] - cur[-1]["x"] > 12:
                    columns.append(cur)
                    cur = []
                cur.append(e)
            if cur:
                columns.append(cur)
            for col in columns:
                cx = sum(e["x"] for e in col) / len(col)
                # Column rhythm: shared rhythm stem anchored at the column's
                # topmost digit (low-string digits' own strips overshoot
                # into the system above). Per-digit x strips, median vote.
                _topcy = min(e["y"] for e in col)
                _gt, _gb = int(_topcy - 100), int(_topcy - 16)
                _colg, _colok = [], []
                if _gt >= 0:
                    for e in col:
                        _ex = e["x"]
                        _s = (u8[_gt:_gb, max(0, int(_ex - 8)):int(_ex + 8)] < 128)
                        _rr = np.nonzero(_s.mean(axis=1) > 0.5)[0]
                        _gl, _pv = [], -99
                        for _r in _rr:
                            if _r - _pv > 2:
                                _gl.append([_r])
                            else:
                                _gl[-1].append(_r)
                            _pv = _r
                        _colg.append(len(_gl))
                        if len(_gl) >= 2:
                            _lo, _hi = _gl[0][0], _gl[-1][-1]
                            _band = (u8[_gt + _lo:_gt + _hi + 1,
                                        max(0, int(_ex - 3)):int(_ex + 3)] < 128)
                            _rows = [r for r in range(_lo, _hi + 1)
                                     if not _rule[_gt + r]]
                            _colok.append((sum(_band[r - _lo, :].any() for r in _rows)
                                           / max(1, len(_rows)) > 0.4) if _rows else True)
                        else:
                            _colok.append(True)
                _gs = sorted(_colg) if _colg else [0]
                _beams = min(_gs[len(_gs) // 2], 2)
                if False and _beams >= 2 and not any(_colok):
                    _beams = 0
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
    out_xml = out_dir / f"{sample}-transcribed.musicxml"
    tree.write(out_xml, encoding="unicode", xml_declaration=True)
    summary = {"notes": len(notes_out), "defaultedDur": n_defaulted,
               "measures": len(by_measure),
               "xml": str(out_xml)}
    (out_dir / f"{sample}-summary.json").write_text(json.dumps(summary, indent=1))
    json.dump(notes_out, open(out_dir / f"{sample}-notes.json", "w"))
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
