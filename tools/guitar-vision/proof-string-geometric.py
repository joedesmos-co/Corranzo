"""G2 geometric string assigner (prereg GUITAR_GEOMETRIC_PREREG.md).

Deterministic, no weights: per digit box, local x-band row projection
-> peak-pick -> regular-6-group select -> nearest-line string index.
Abstains (-> StringNet fallback) when no regular 6-group brackets the
digit or confidence < 0.5.

Usage:
  proof-string-geometric.py --hires DIR --work W --samples-csv S
      --layout standard --boxes gt|det --out JSON
Stage A (boxes=gt): GT tab-text boxes. Stage B (boxes=det): detected
digit boxes from merged-regime decode peaks (requires decode peaks
cache; falls back to gt with --boxes gt).
"""
import argparse, json, os, re, sys
from collections import defaultdict
from pathlib import Path
from PIL import Image
import numpy as np

W = Path(os.path.expanduser('~/Documents/scoreflow-guitar'))
TOOLS = Path(__file__).parent

def _load(name, filename):
    import importlib.util as _ilu
    spec = _ilu.spec_from_file_location(name, str(TOOLS / filename))
    module = _ilu.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

def iou(a, b):
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0

def load_sample(work_roots, sample, layout):
    jname = 'joins.json' if layout == 'standard' else f'joins-{layout}.json'
    for w in work_roots:
        if os.path.basename(w) != sample:
            continue
        jp = W / w / jname
        if not jp.exists():
            return None, None
        joins = json.loads(jp.read_text())
        cp = W / w / 'canonical.json'
        canon = json.loads(cp.read_text()) if cp.exists() else None
        return joins, canon
    return None, None

def build_links(sample, canon):
    table = {}
    for e in (canon or {}).get('events', []):
        m = re.search(r"-n(\d+)$", (e.get('source') or {}).get('noteId') or '')
        if m:
            table[f"{sample}-n{int(m.group(1)) + 1:03d}"] = (e.get('tab') or {}).get('string')
    return table

def detect_peaks(arr, x0, x1, q=0.90):
    h, w = arr.shape
    x0, x1 = max(0, x0), min(w, x1)
    if x1 - x0 < 10:
        return [], 1.0
    band = arr[:, x0:x1]
    dark = (band < 128).mean(axis=1)
    thr = float(np.quantile(dark, q))
    peaks = []
    for y in range(1, h - 1):
        if dark[y] >= dark[y - 1] and dark[y] >= dark[y + 1] and dark[y] > thr:
            if not peaks or y - peaks[-1] >= 4:
                peaks.append(y)
            elif dark[y] > dark[peaks[-1]]:
                peaks[-1] = y
    return peaks, thr

def estimate_spacing(peaks):
    """Robust staff spacing from peak-gap histogram (8..100px)."""
    P = sorted(peaks)
    diffs = [P[i + 1] - P[i] for i in range(len(P) - 1) if 8 <= P[i + 1] - P[i] <= 100]
    if len(diffs) < 3:
        return None
    from collections import Counter
    bins = Counter(int(d) for d in diffs)
    mode, _ = bins.most_common(1)[0]
    near = [d for d in diffs if abs(d - mode) <= 2]
    return sum(near) / len(near)

def assign_string(peaks, y_digit, conf_min=0.5, sp_hint=None):
    """Fit (top, sp) 6-line comb to peaks; digit -> nearest line index.

    Allows up to 2 unexplained (occluded) lines. Penalizes combs that
    extend to a 7th explained line (wrong staff/phase). sp_hint (e.g.
    page-global spacing) overrides the local estimate when it agrees
    within 15% of a locally-supported spacing."""
    if len(peaks) < 4:
        return None, 0.0
    sp = sp_hint or estimate_spacing(peaks)
    if not sp:
        return None, 0.0
    tol = max(2.0, 0.15 * sp)
    P = sorted(peaks)
    best = None
    for top in P:
        lines = [top + k * sp for k in range(6)]
        if not (lines[0] - 0.6 * sp <= y_digit <= lines[5] + 0.6 * sp):
            continue
        explained = sum(1 for ln in lines if min(abs(ln - p) for p in P) <= tol)
        if explained < 4:
            continue
        extra = (1 if min(abs(top - sp - p) for p in P) <= tol else 0) + \
                (1 if min(abs(top + 6 * sp - p) for p in P) <= tol else 0)
        resid = min(abs(y_digit - ln) for ln in lines) / sp
        score = explained - extra - resid
        if best is None or score > best[0]:
            best = (score, lines, explained, resid)
    if best is None:
        return None, 0.0
    _, lines, explained, resid = best
    conf = max(0.0, 1.0 - resid - 0.1 * (6 - explained))
    if conf < conf_min:
        return None, conf
    string = min(range(1, 7), key=lambda s: abs(y_digit - lines[s - 1]))
    return string, conf

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hires', required=True)
    ap.add_argument('--work', required=False, action='append', default=[])
    ap.add_argument('--worklist', default='',
                    help='JSON list of sample workdirs (registry).')
    ap.add_argument('--samples-csv', required=True)
    ap.add_argument('--layout', default='standard')
    ap.add_argument('--boxes', default='gt', choices=['gt', 'det'])
    ap.add_argument('--detector', default='datasets/guitar-vision/proof-detection/heatmap-ignore.pt',
                    help='detector weights for --boxes det (merged regime: digits from native pass)')
    ap.add_argument('--out', required=True)
    ap.add_argument('--suffix', default='')
    args = ap.parse_args()
    samples = [t for t in re.split(r'[\s,]+', open(args.samples_csv).read()) if t.strip()]
    work = list(args.work)
    if args.worklist:
        work += json.load(open(args.worklist))
    hires = Path(args.hires)
    gt_total = 0
    det = None
    if args.boxes == 'det':
        import torch
        _pig = _load('proof_ignore_train_mod', 'proof-ignore-train.py')
        _dec = _load('proof_heatmap_decode_mod', 'proof-heatmap-decode.py')
        device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
        det = _pig.TinyFCN4().to(device)
        saved = torch.load(str(W / args.detector), map_location=device, weights_only=True)
        det.load_state_dict(saved['state'] if 'state' in saved else saved)
        det.eval()
        det_ctx = (torch, _dec, device)
    else:
        det_ctx = None
    n, ok, abst = 0, 0, 0
    per = defaultdict(lambda: [0, 0])
    detail = []
    for sample in samples:
        man_name = f'{sample}{args.suffix}-manifest.json'
        mp = hires / man_name
        if not mp.exists():
            continue
        man = json.loads(mp.read_text())
        joins, canon = load_sample(work, sample, args.layout)
        if not joins:
            continue
        links = build_links(sample, canon)
        for pgkey, m in man.items():
            if not isinstance(m, dict) or 'file' not in m:
                continue
            page_no = int(pgkey.replace('page', ''))
            arr = np.asarray(Image.open(m['file']).convert('L'), dtype=np.float32)
            sx = arr.shape[1] / m['viewBox'][0]
            sy = arr.shape[0] / m['viewBox'][1]
            gt_boxes = []  # (box_img, sid, string)
            for sid, v in joins.get('joins', {}).items():
                if 'tab-text' not in (v.get('children') or []):
                    continue
                if (v.get('page') or 1) != page_no:
                    continue
                st = links.get(sid)
                if not st:
                    continue
                for b in v.get('boxes', []):
                    gt_boxes.append(([b[0] * sx, b[1] * sy, b[2] * sx, b[3] * sy], sid, st))
            gt_total += len(gt_boxes)
            items = []  # (sid, st, cx, cy)
            if det_ctx is None:
                for box, sid, st in gt_boxes:
                    items.append((sid, st, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2))
            else:
                torch, _dec, device = det_ctx
                u8 = (np.asarray(Image.open(m['file']).convert('L'))).astype(np.uint8)
                fx, fy = m['cssWidth'] / m['viewBox'][0], m['height'] / m['viewBox'][1]
                with torch.no_grad():
                    heat = det(torch.from_numpy(u8.astype(np.float32) / 255.0).unsqueeze(0).unsqueeze(0).to(device))[0].cpu()
                preds = _dec.decode_page(heat, u8, fx, fy)
                for p in preds:
                    if p['cls'] != 'tabdigit':
                        continue
                    best, best_iou = None, 0.0
                    for box, sid, st in gt_boxes:
                        v = iou(p['box'], box)
                        if v > best_iou:
                            best, best_iou = (sid, st), v
                    if best is None or best_iou < 0.5:
                        continue
                    sid, st = best
                    items.append((sid, st, p['x'], p['y']))
            banded = []  # (sid, st, cy, peaks)
            for sid, st, cx, cy in items:
                xb = int(900 * sx)
                peaks, _ = detect_peaks(arr, int(cx - xb), int(cx + xb))
                banded.append((sid, st, cy, peaks))
            # pass 1: page-global spacing from FULL-WIDTH projection
            # (staff lines span the page; local digit artifacts do not)
            from collections import Counter as _C
            full = (arr < 128).mean(axis=1)
            fthr = float(np.quantile(full, 0.90))
            fpeaks = [y for y in range(1, arr.shape[0] - 1)
                      if full[y] >= full[y - 1] and full[y] >= full[y + 1] and full[y] > fthr]
            fdiffs = [fpeaks[i + 1] - fpeaks[i] for i in range(len(fpeaks) - 1)
                      if 8 <= fpeaks[i + 1] - fpeaks[i] <= 200]
            page_sp = None
            if len(fdiffs) >= 5:
                bins = _C(int(d) for d in fdiffs)
                mode, _ = bins.most_common(1)[0]
                near = [d for d in fdiffs if abs(d - mode) <= 2]
                page_sp = sum(near) / len(near)
            print(f'  page {sample} p{page_no}: page_sp={page_sp and round(page_sp,2)} nitems={len(items)}',
                  file=sys.stderr)
            for sid, st, cy, peaks in banded:
                    pred, conf = assign_string(peaks, cy, sp_hint=page_sp)
                    n += 1
                    if pred is None:
                        abst += 1
                    elif pred == st:
                        ok += 1
                    per[st][1] += 1
                    per[st][0] += 1 if pred == st else 0
                    detail.append({'sample': sample, 'sid': sid, 'truth': st,
                                   'pred': pred, 'conf': round(conf, 3)})
    acc = ok / max(1, n - abst)
    cov = (n - abst) / max(1, n)
    print(f'layout={args.layout} boxes={args.boxes}: n={n} abst={abst} '
          f'acc(non-abst)={acc:.3f} coverage={cov:.3f} acc-all={ok/max(1,n):.3f} '
          f'matchRecall={n/max(1,gt_total):.3f} acc-of-all-GT={ok/max(1,gt_total):.3f}')
    for st in sorted(per):
        a, c = per[st]
        print(f'  s{st}: {a/max(1,c):.3f} (n={c})')
    json.dump({'n': n, 'abstained': abst, 'correct': ok, 'acc': acc,
               'coverage': cov, 'perString': {str(k): v[0] / max(1, v[1]) for k, v in per.items()},
               'detail': detail}, open(args.out, 'w'), indent=1)

if __name__ == '__main__':
    main()
