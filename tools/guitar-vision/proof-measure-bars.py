#!/usr/bin/env python3
"""Measure bars + tuplet census (G4, TRAIN; image inference, truth for measure only).

1. Barlines: full-system-height verticals via long-kernel opening on raw
   ink (previously a stem-detector FP source; now signal). Validated
   against canonical measure counts per sample.
2. Tuplet census: prevalence of tuplet events (canonical) + digit-channel
   response on tuplet pages. Tuplets have no SVG objects (verified
   absence); recognition is NOT claimed — separability measured only.

Usage:
    python3 tools/guitar-vision/proof-measure-bars.py --out <dir>
"""
from __future__ import annotations

import importlib.util
import json
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


tr4 = _load("proof_ignore_train_mod", "proof-ignore-train.py")
dec = _load("proof_heatmap_decode_mod", "proof-heatmap-decode.py")

import os as _os

COVER = float(_os.environ.get("BAR_COVER", "0.9"))  # TRAIN-selected: median bars/measures 1.06
REJECT = float(_os.environ.get("BAR_REJECT", "0"))  # note-rejection destroys recall (dense scores); off


def detect_barline_cols(u8: np.ndarray, note_xs: list[float] | None = None) -> list[int]:
    """Flat wrapper over per-system detection (legacy callers)."""
    xs = set()
    for s in detect_barline_systems(u8):
        xs.update(s["xs"])
    out, prev = [], -99
    for x in sorted(xs):
        if x - prev <= 12:
            continue
        prev = x
        out.append(x)
    return out
def _is_tab(group) -> bool:
    """True TAB staff vs rhythm-row impostors (G1 measure work).

    Both present 6 line-like bands, but TAB lines are thin (<=4px) and
    regularly spaced (gap range <= 0.3 * median gap); rhythm rows start
    with a thick beam band and irregular gaps. Verified: true TAB
    th<=3/range~0.03, impostor th5/range~0.95 (Qmek p1).
    """
    if len(group) != 6:
        # Faint-line TAB: 5 bands where exactly one gap is ~2x (the faint
        # line's neighbors), rest regular and thin. Notation staves show
        # 4 regular gaps (no double). Verified Txo p2 bottom staff.
        if len(group) != 5:
            return False
        if max(b - a + 1 for a, b in group) > 4:
            return False
        mids = [(a + b) / 2 for a, b in group]
        gaps = [mids[i + 1] - mids[i] for i in range(4)]
        med = sorted(gaps)[1]
        if med <= 0:
            return False
        norm = sum(1 for g in gaps if abs(g - med) <= 0.3 * med)
        dbl = sum(1 for g in gaps if 1.7 * med <= g <= 2.3 * med)
        return norm == 3 and dbl == 1
    if max(b - a + 1 for a, b in group) > 4:
        return False
    mids = [(a + b) / 2 for a, b in group]
    gaps = [mids[i + 1] - mids[i] for i in range(5)]
    med = sorted(gaps)[2]
    if med <= 0:
        return False
    return (max(gaps) - min(gaps)) <= 0.3 * med


def _systems_and_bands(u8):
    """Returns (systems, bands, staff_rows, ink, x0, x1).

    systems: list of (top, bot, extended) with extended TAB spans pushed
    upward 2.5x staff height to cover a paired notation staff.
    """
    import os as _os2
    ink = u8 < 128
    h, w = ink.shape
    x0, x1 = int(w * 0.1), int(w * 0.9)
    row_frac = ink[:, x0:x1].mean(axis=1)
    line_rows = np.nonzero(row_frac > 0.25)[0]
    if len(line_rows) < 5:
        return [], [], set(), ink, x0, x1
    bands = []
    start, prev = line_rows[0], line_rows[0]
    for r in line_rows[1:]:
        if r - prev > 3:
            bands.append((start, prev))
            start = r
        prev = r
    bands.append((start, prev))
    mids = [(a + b) / 2 for a, b in bands]
    systems = []
    prev_tab_bot = 0
    cur = [bands[0]]
    raw = []
    for i in range(1, len(bands)):
        # Gap 60px: staves in this corpus sit >=100px apart.
        if mids[i] - mids[i - 1] < 60:
            cur.append(bands[i])
        else:
            raw.append(cur)
            cur = [bands[i]]
    raw.append(cur)
    # Fragment post-merge: a faint staff line splits one staff into two
    # small groups (Txo p2 bottom: 3+2 bands across a 63px gap). Merge
    # adjacent groups when the union has 5-6 bands, spans <100px of gap,
    # and matches the TAB signature (regular or one-double-gap). Larger
    # unions (e.g. notation+TAB) never merge: counts exceed 6.
    merged = []
    i = 0
    while i < len(raw):
        if (i + 1 < len(raw) and len(raw[i]) < 5 and len(raw[i + 1]) < 5
                and len(raw[i]) + len(raw[i + 1]) == 5):
            u = raw[i] + raw[i + 1]
            umids = [(a + b) / 2 for a, b in u]
            gap = umids[len(raw[i])] - umids[len(raw[i]) - 1]
            if gap < 100 and _is_tab(u):
                merged.append(u)
                i += 2
                continue
        merged.append(raw[i])
        i += 1
    groups = []
    for cur in merged:
        if len(cur) >= 5:
            groups.append((cur[0][0], cur[-1][1], _is_tab(cur)))
    for top, bot, ext in groups:
        # Own-span detection per staff: paired engraving here does NOT
        # join barlines across staves (verified visually), so extended
        # spans dilute cover and break continuity runs. Notation (5) and
        # TAB (6) staves are tested separately and unioned per system.
        systems.append((top, bot, ext))
    staff_rows = set()
    for a, b in bands:
        for r in range(max(0, a - 2), min(h, b + 3)):
            staff_rows.add(r)
    return systems, bands, staff_rows, ink, x0, x1


def detect_barline_systems(u8: np.ndarray) -> list[dict]:
    """Per-system barline lists: [{top, bot, xs}] sorted top-to-bottom.

    Ownership must be per-system (2D): global-x bisect mixes systems.
    Each system gets its cover+continuity-tested columns within its own
    span plus its injected system-start edge.
    """
    import os as _os2
    COVER_EXT = float(_os2.environ.get("BAR_COVER_EXT", "0.7"))
    systems, bands, staff_rows, ink, x0, x1 = _systems_and_bands(u8)
    h, w = ink.shape
    out = []
    for top, bot, ext in systems:
        span = bot - top + 1
        if span < 30:
            continue
        col = ink[top:bot + 1, x0:x1]
        keep = np.array([r for r in range(top, bot + 1) if r not in staff_rows]) - top
        thr = COVER
        found = set()
        if len(keep) >= 10:
            sub = col[keep, :]
            for x in range(sub.shape[1]):
                v = sub[:, x]
                if v.mean() < thr:
                    continue
                best, run = 0, 0
                for val in v:
                    run = run + 1 if val else 0
                    best = max(best, run)
                if best >= 0.6 * len(keep):
                    found.add(int(x + x0))
        if ext:
            rows = [r for r in staff_rows if top <= r <= bot]
            for x in range(0, w):
                if any(ink[r, x] for r in rows):
                    found.add(x)
                    break
        xs = sorted(found)
        cols, prev = [], -99
        for x in xs:
            if x - prev <= 12:
                continue
            prev = x
            cols.append(x)
        out.append({"top": top, "bot": bot, "xs": cols, "tab": bool(ext)})
    return out


def tab_systems(u8: np.ndarray) -> list[tuple]:
    """(top, bot) spans of TAB (6-band) staves only, top-to-bottom."""
    return [(s["top"], s["bot"]) for s in detect_barline_systems(u8) if s.get("tab")]
    for top, bot, ext in systems:
        span = bot - top + 1
        if span < 30:
            continue
        col = ink[top:bot + 1, x0:x1]
        keep = np.array([r for r in range(top, bot + 1) if r not in staff_rows]) - top
        thr = COVER
        if len(keep) < 10:
            continue
        sub = col[keep, :]
        # Continuity: longest ink run over non-staff rows (barlines are
        # one continuous stroke; chord-digit stacks have inter-digit gaps).
        for x in range(sub.shape[1]):
            v = sub[:, x]
            if v.mean() < thr:
                continue
            best, run = 0, 0
            for val in v:
                run = run + 1 if val else 0
                best = max(best, run)
            if best >= 0.6 * len(keep):
                found.add(int(x + x0))
    # Merge adjacent columns; reject note-adjacent (stems, REJECT=0 off).
    xs = sorted(found)
    cols, prev = [], -99
    for x in xs:
        # Merge duplicates within 12px (thick/double/repeat barlines are
        # one boundary; true distinct barlines are 100s of px apart).
        if x - prev <= 12:
            continue
        prev = x
        if REJECT > 0 and note_xs and min([abs(x - nx) for nx in note_xs] or [1e9]) < REJECT:
            continue
        cols.append(x)
    return cols


def detect_barlines(u8: np.ndarray, note_xs: list[float] | None = None) -> int:
    """Count wrapper."""
    return len(detect_barline_cols(u8, note_xs))


def detect_barline_xs(u8: np.ndarray) -> list[int]:
    """Barline x positions without note peaks (for measure ownership)."""
    return detect_barline_cols(u8, None)


SEED = 20261009


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True)
    parser.add_argument("--split", default="train", choices=["train", "validation"])
    args = parser.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    train = set()
    want = args.split
    for mp in ["datasets/guitar-vision/pdmx/dataset-manifest.json",
               "datasets/guitar-vision/v2/dataset-manifest.json"]:
        for s in json.load(open(mp))["splits"]["assignments"]:
            if (want == "train") == (s["split"] == "train"):
                train.add(s["sample"])
    ws = json.load(open("/tmp/proof/workdirs.json"))
    model = tr4.TinyFCN4().to(device)
    sd = torch.load("datasets/guitar-vision/proof-detection/heatmap-ignore.pt",
                     map_location=device, weights_only=True)
    model.load_state_dict(sd.get("state", sd))
    model.eval()

    bar_rows = []
    tuplet_samples = 0
    tuplet_events = 0
    tuplet_digit_med = []
    n_pages = 0
    with torch.no_grad():
        for mp in sorted(Path("/tmp/proof/hires").glob("*-manifest.json")):
            sample = mp.name.replace("-manifest.json", "")
            if sample not in train:
                continue
            man = json.load(open(mp))
            canon = None
            for root in ws:
                for cand in (f"{root}/{sample}/canonical.json",
                             f"{root}/canonical.json" if Path(root).name == sample else None):
                    if cand and Path(cand).exists():
                        canon = json.load(open(cand))
                        break
                if canon:
                    break
            measures = 0
            ntup = 0
            if canon:
                for e in canon.get("events", []):
                    m = (e.get("source") or {}).get("measure") or 0
                    measures = max(measures, m)
                    if (e.get("time") or {}).get("tuplet") is not None:
                        ntup += 1
            if ntup:
                tuplet_samples += 1
                tuplet_events += ntup
            for tag, meta in man.items():
                if not isinstance(meta, dict) or "file" not in meta:
                    continue
                img = Image.open(meta["file"]).convert("L")
                u8 = np.asarray(img)
                u8n, _ns = dec.normalize_scale(u8)
                px = u8n.astype(np.float32) / 255.0
                heat = model(torch.from_numpy(px).unsqueeze(0).unsqueeze(0).to(device))[0].cpu()
                chan = heat[0]
                pooled = torch.nn.functional.max_pool2d(chan.unsqueeze(0), 3, stride=1, padding=1)[0]
                ys, xs = torch.nonzero((chan == pooled) & (chan >= 0.4), as_tuple=True)
                note_xs = [((int(x) + 0.5) * 8) / _ns for x in xs.tolist()]
                count = detect_barlines(u8, note_xs)
                bar_rows.append({"sample": sample, "page": tag, "bars": count,
                                 "measures": measures})
                # Digit-channel response on tuplet pages: median of top-20
                # digit peaks (separability probe, not recognition).
                if ntup:
                    top = sorted(heat[2].flatten().tolist(), reverse=True)[:20]
                    tuplet_digit_med.append(float(np.median(top)))
                n_pages += 1
    with_meas = [r for r in bar_rows if r["measures"] > 0]
    # Barlines should be >= measures - systems... approximate: bars/page vs
    # measures/pages-per-sample. Report per-sample totals instead.
    per_sample: dict = {}
    for r in bar_rows:
        d = per_sample.setdefault(r["sample"], {"bars": 0, "measures": r["measures"], "pages": 0})
        d["bars"] += r["sample"] and r["bars"]
        d["pages"] += 1
    ratios = [d["bars"] / max(d["measures"], 1) for d in per_sample.values() if d["measures"]]
    report = {"pages": n_pages,
              "barlineMeasureRatioMed": round(float(np.median(ratios)), 3) if ratios else 0.0,
              "barlineMeasureRatioP10": round(float(np.percentile(ratios, 10)), 3) if ratios else 0.0,
              "tupletSamples": tuplet_samples, "tupletEvents": tuplet_events,
              "tupletDigitTop20Med": round(float(np.median(tuplet_digit_med)), 3) if tuplet_digit_med else 0.0,
              "perSample": per_sample}
    (out_dir / "measure-bars.json").write_text(json.dumps(report, indent=1))
    print(json.dumps({k: v for k, v in report.items() if k != "perSample"}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
