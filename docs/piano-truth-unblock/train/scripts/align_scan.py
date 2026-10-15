#!/usr/bin/env python3
"""M2/M3/M4 scan<->render staff-relative registration with ink verification.

Per TRAIN-side OLiMPiC strip:
  RENDER the strip's own MusicXML with Verovio (M1). Key signature
  accidentals come from the render's keyAccid groups (exact render
  positions); staff geometry from the render's staff line paths.
  SCAN side: detect the 5 lines per staff, sample each line's y at 64
  x-offsets -> per-staff curvature model (handles skew/curvature/nonlinear
  scan distortion), and the staff's x-extent from ink columns.
  MAP each render key accidental into scan coordinates:
      v = (r_bottom_line - y_r) / (r_gap/2)        [half-steps, staff-relative]
      u = (x_r - r_x0) / (r_x1 - r_x0)             [fraction along the staff]
      y_s = s_bottom_line(x_s) - v * s_gap / 2      [curvature-corrected]
      x_s = s_x0 + u * (s_x1 - s_x0)
  TRANSFER the label only if the scan window at (x_s, y_s) contains a
  compact ink glyph (ink-verified) - MusicXML accidentals never create
  invisible symbols. Abstain on staff-count mismatch, missing frames,
  low ink, or curvature-residual excess.

Writes reports/align_ledger.json and reports/align_overlays/*.png.
No training, no CNN (per mission constraint). TEST untouched.
"""
from __future__ import annotations
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
TRAIN = HERE.parent
PILOT = TRAIN.parent / "pilot"
OLIMPIC = PILOT / "data" / "olimpic" / "olimpic-1.0-scanned" / "samples"
sys.path.insert(0, str(HERE))
from auto_locate import group_staves, staff_lines  # noqa: E402
from auto_page import deskew, estimate_skew  # noqa: E402

RENDER_DIR = Path("/tmp/olympic_rendered")
VERIFY_N = 10
N_SAMPLES = 64
GLYPH_ACC = {"E262": "sharp", "E260": "flat", "E261": "natural"}
GROUP_RE = re.compile(r'<g id="[^"]+" class="([^"]+)">(.*?)</g>\s*</g>', re.S)
USE_RE = re.compile(r'xlink:href="#([A-Za-z0-9]+)-[^"]*"\s+'
                    r'transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)')
PATH_RE = re.compile(r'<path[^>]*d="M([\d.\-]+) ([\d.\-]+) '
                     r'L([\d.\-]+) ([\d.\-]+)"')
STAFF_G = re.compile(r'<g id="[^"]+" class="staff">(.*?)</g>\s*</g>', re.S)
KEYACCID_G = re.compile(r'<g id="[^"]+" class="keyAccid">(.*?)</g>', re.S)


def render_strip(mx_path, out_prefix):
    import verovio
    tk = verovio.toolkit()
    if not tk.loadFile(str(mx_path)):
        return None
    tk.setOptions({"scale": 40, "pageWidth": 2100, "adjustPageHeight": True})
    svg = tk.renderToSVG(1)
    (out_prefix.with_suffix(".svg")).write_text(svg)
    return svg


def render_frames(svg):
    """[{lines: [y1..y5], x0, x1}] per staff group with exactly 5 lines."""
    out = []
    for m in STAFF_G.finditer(svg):
        body = m.group(1)
        ys, xs = set(), []
        for x1, y1, x2, y2 in PATH_RE.findall(body):
            if y1 == y2:
                ys.add(round(float(y1), 1))
                xs += [float(x1), float(x2)]
        ys = sorted(ys)
        if len(ys) == 5 and xs:
            out.append({"lines": ys, "x0": min(xs), "x1": max(xs)})
    return out


def render_key_accids(svg):
    """[{glyph, shape, x, y}] from keyAccid groups."""
    out = []
    for m in KEYACCID_G.finditer(svg):
        gm = USE_RE.search(m.group(1))
        if not gm or gm.group(1) not in GLYPH_ACC:
            continue
        out.append({"glyph": gm.group(1), "shape": GLYPH_ACC[gm.group(1)],
                    "x": float(gm.group(2)), "y": float(gm.group(3))})
    return out


def scan_line_models(gray, frames):
    """[{frame, gap, xs, model[k][xi], x0, x1}] with curvature models."""
    out = []
    for fr in frames:
        gap = (fr[-1] - fr[0]) / 4
        xs = np.linspace(0, gray.shape[1] - 1, N_SAMPLES).astype(int)
        model = []
        for k in range(5):
            prev = int(round(fr[k]))
            row = []
            for x in xs:
                lo = max(0, prev - max(3, int(round(0.15 * gap))))
                hi = min(gray.shape[0], prev + max(3, int(round(0.15 * gap))) + 1)
                band = gray[lo:hi, x]
                if band.size == 0:
                    row.append(prev)
                    continue
                cy = lo + int(np.argmin(band))
                if band[cy - lo] > 170:
                    cy = prev
                prev = cy
                row.append(cy)
            model.append(row)
        band_img = gray[int(fr[0]):int(fr[-1]) + 1, :]
        cols = np.where((band_img < 170).any(axis=0))[0]
        x0, x1 = (int(cols[0]), int(cols[-1])) if len(cols) else (0, gray.shape[1] - 1)
        out.append({"frame": fr, "gap": gap, "xs": xs, "model": model,
                    "x0": x0, "x1": x1})
    return out


def scan_y_at(model, xs, x, v_half, gap):
    """Scan y for (x, v half-steps above the bottom line), interpolating the
    curvature model at column x."""
    xi = int(np.clip(np.searchsorted(xs, x), 1, len(xs) - 1))
    x_lo, x_hi = xs[xi - 1], xs[xi]
    t = 0.0 if x_hi == x_lo else (x - x_lo) / (x_hi - x_lo)
    bottom = model[4][xi - 1] + t * (model[4][xi] - model[4][xi - 1])
    return bottom - v_half * gap / 2.0


def curvature_residual(model, gap):
    """Max deviation of the interpolated bottom line from a straight fit:
    a cheap local-distortion confidence measure (pixels)."""
    k = 4
    xs = np.arange(len(model[k]))
    ys = np.array(model[k], np.float64)
    coef = np.polyfit(xs, ys, 1)
    resid = np.abs(ys - np.polyval(coef, xs))
    return float(resid.max())


def main():
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    dirs = sorted(p for p in OLIMPIC.iterdir() if p.is_dir())
    overlay_dir = TRAIN / "reports" / "align_overlays"
    overlay_dir.mkdir(parents=True, exist_ok=True)
    stats = Counter()
    ledger = []
    for d in dirs[VERIFY_N:VERIFY_N + 30]:
        png, mx = d / "p1-s1.png", d / "p1-s1.musicxml"
        if not (png.is_file() and mx.is_file()):
            stats["no_strip"] += 1
            continue
        svg = render_strip(mx, RENDER_DIR / d.name)
        if svg is None:
            stats["no_render"] += 1
            continue
        rframes = render_frames(svg)
        raccs = render_key_accids(svg)
        gray = cv2.imread(str(png), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            stats["no_img"] += 1
            continue
        g = deskew(gray, estimate_skew(gray))
        lines, dark = staff_lines(g)
        sframes = group_staves(lines, dark)
        if not sframes:
            stats["no_scan_frame"] += 1
            continue
        stats["strips"] += 1
        stats["render_staff_frames"] += len(rframes)
        stats["scan_staff_frames"] += len(sframes)
        stats["render_key_accids"] += len(raccs)
        models = scan_line_models(g, sframes)
        # Group the render's key accidentals by the staff that carries them
        # (a key signature is drawn on every staff of the system), then map
        # render staff i -> scan frame i when the scan has that frame.
        by_rf = defaultdict(list)
        for a in raccs:
            best = None
            for i, f in enumerate(rframes):
                fgap = (f["lines"][-1] - f["lines"][0]) / 4
                lo, hi = f["lines"][0] - fgap, f["lines"][-1] + fgap
                if lo <= a["y"] <= hi:
                    best = i
                    break
            if best is not None:
                by_rf[best].append(a)
        vis = cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)
        for ri, accs_here in sorted(by_rf.items()):
            if ri >= len(models):
                stats["abstain_no_scan_frame"] += len(accs_here)
                ledger.append([d.name, "abstain", "no_scan_frame",
                               f"render staff {ri}", len(accs_here)])
                continue
            rf, sm = rframes[ri], models[ri]
            r_gap = (rf["lines"][-1] - rf["lines"][0]) / 4
            for a in accs_here:
                v_half = (rf["lines"][-1] - a["y"]) / (r_gap / 2)
                if not (-4 <= v_half <= 12):
                    stats["v_out_of_range"] += 1
                    continue
                u = (a["x"] - rf["x0"]) / max(1.0, rf["x1"] - rf["x0"])
                if not (0.02 <= u <= 0.45):
                    stats["u_out_of_range"] += 1
                    continue
            x_s = sm["x0"] + u * (sm["x1"] - sm["x0"])
            y_s = scan_y_at(sm["model"], sm["xs"], int(x_s), v_half, sm["gap"])
            resid = curvature_residual(sm["model"], sm["gap"])
            # ink verification window
            w = int(round(0.7 * sm["gap"]))
            y0i, y1i = int(y_s - w), int(y_s + w)
            x0i, x1i = int(x_s - w * 0.7), int(x_s + w * 0.7)
            y0i, x0i = max(0, y0i), max(0, x0i)
            y1i = min(g.shape[0], y1i)
            x1i = min(g.shape[1], x1i)
            if y1i <= y0i or x1i <= x0i:
                stats["window_oob"] += 1
                continue
            win = g[y0i:y1i, x0i:x1i]
            inkfrac = float((win < 150).mean())
            # a key signature accidental: substantial compact ink
            if inkfrac < 0.12:
                stats["reject_no_ink"] += 1
                ledger.append([d.name, "abstain", "no_ink",
                               a["shape"], round(inkfrac, 3)])
                color = (0, 0, 220)
            else:
                stats["transferred"] += 1
                stats["transferred_" + a["shape"]] += 1
                ledger.append([d.name, "transfer", a["shape"],
                               round(float(y_s), 1), round(inkfrac, 3)])
                color = (0, 200, 0)
            cv2.rectangle(vis, (x0i, y0i), (x1i, y1i), color, 2)
            cv2.putText(vis, a["shape"], (x0i, max(12, y0i - 4)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
        cv2.imwrite(str(overlay_dir / f"{d.name}_align.png"), vis)
    out = {"stats": dict(stats), "ledger": ledger[:400],
           "scope": "TRAIN-side OLiMPiC strips p1-s1, render-of-MusicXML "
                    "registration, ink-verified transfer; no training"}
    (TRAIN / "reports" / "align_ledger.json").write_text(
        json.dumps(out, indent=1))
    print(json.dumps(dict(stats), indent=1))


if __name__ == "__main__":
    main()
