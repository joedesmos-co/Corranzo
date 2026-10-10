"""G1 Part B: image-based TAB staff-line detection feasibility.

For one representative TRAIN-fit page per layout (standard/compact/
large): detect horizontal staff lines from pixels only (dark-pixel row
projection inside an x-band derived from DETECTED digit peaks — here
approximated by the GT digit x-band as ROI; the peak-picking itself is
image-only), and compare to supervision GT line rows (median
digit-center y per string per system cluster).

Reports: GT lines found within tolerance, peak precision, offset.
"""
import json, os, re, sys
from collections import defaultdict
from PIL import Image
import numpy as np

W = os.path.expanduser('~/Documents/scoreflow-guitar')
HIRES = {'standard': '/tmp/proof/hires', 'compact': '/tmp/proof/hires-compact',
         'large': '/tmp/proof/hires-large'}
WORK = {b: w for w in json.load(open('/tmp/proof/workdirs.json')) for b in [os.path.basename(w)]}

def gt_lines(sample, layout, page_no):
    jname = 'joins.json' if layout == 'standard' else f'joins-{layout}.json'
    w = WORK[sample]
    joins = json.load(open(os.path.join(W, w, jname)))
    canon = json.load(open(os.path.join(W, w, 'canonical.json')))
    links = {}
    for e in canon.get('events', []):
        m = re.search(r"-n(\d+)$", (e.get('source') or {}).get('noteId') or '')
        if m:
            links[f"{sample}-n{int(m.group(1)) + 1:03d}"] = (e.get('tab') or {}).get('string')
    boxes = []
    by_str = defaultdict(list)
    for sid, v in joins.get('joins', {}).items():
        if 'tab-text' not in (v.get('children') or []):
            continue
        if (v.get('page') or 1) != page_no:
            continue
        st = links.get(sid)
        for b in v.get('boxes', []):
            boxes.append(b)
            if st:
                by_str[st].append((b[1] + b[3]) / 2)
    if not boxes or len(by_str) < 4:
        return None, None
    return boxes, sorted([sorted(v)[len(v) // 2] for v in by_str.values()])

def detect_lines(png_path, viewbox, boxes_render, tol_render=30):
    png = Image.open(png_path).convert('L')
    arr = np.asarray(png, dtype=np.float32)
    h, w = arr.shape
    sx = w / viewbox[0]
    sy = h / viewbox[1]
    x0 = max(0, int(min(b[0] for b in boxes_render) * sx) - 30)
    x1 = min(w, int(max(b[2] for b in boxes_render) * sx) + 30)
    band = arr[:, x0:x1]
    dark = (band < 128).mean(axis=1)
    thr = np.quantile(dark, 0.97)
    peaks = []
    for y in range(1, h - 1):
        if dark[y] >= dark[y - 1] and dark[y] >= dark[y + 1] and dark[y] > thr:
            if not peaks or y - peaks[-1] >= 4:
                peaks.append(y)
            elif dark[y] > dark[peaks[-1]]:
                peaks[-1] = y
    return peaks, sx, sy, thr

def main():
    reps = [('pdmx2-QmekQbhC1yAP', 'standard'), ('pdmx2-QmekQbhC1yAP', 'compact'),
            ('pdmx2-QmekQbhC1yAP', 'large')]
    out = {}
    for sample, layout in reps:
        man = json.load(open(os.path.join(HIRES[layout], f'{sample}-{layout}-manifest.json'
                                           if layout != 'standard' else f'{sample}-manifest.json')))
        pgkey = [k for k in man if isinstance(man[k], dict)][0]
        m = man[pgkey]
        page_no = int(pgkey.replace('page', ''))
        gt = gt_lines(sample, layout, page_no)
        if gt[0] is None:
            print(f'{layout}: no supervision lines'); continue
        boxes, glines = gt
        peaks, sx, sy, thr = detect_lines(m['file'], m['viewBox'], boxes)
        glines_px = [g * sy for g in glines]
        tol = 3
        hits, offs = 0, []
        for gl in glines_px:
            best = min(peaks, key=lambda p: abs(p - gl)) if peaks else None
            if best is not None and abs(best - gl) <= tol:
                hits += 1
                offs.append(abs(best - gl))
        # peak precision: peaks near any gt line
        prec = sum(1 for p in peaks if min(abs(p - gl) for gl in glines_px) <= tol) / max(1, len(peaks))
        print(f'{layout}/{sample} p{page_no}: gtLines={len(glines)} peaks={len(peaks)} '
              f'recall={hits}/{len(glines)} meanOff={sum(offs)/len(offs) if offs else -1:.2f}px prec={prec:.2f}')
        out[layout] = {'gt': len(glines), 'peaks': len(peaks), 'hits': hits, 'prec': round(prec, 3)}
    json.dump(out, open('/tmp/proof/staff-detect-fit.json', 'w'), indent=1)

main()
