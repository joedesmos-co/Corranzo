"""Complete PDF -> guitar TAB -> MusicXML pipeline (pdfjs-dist).

Stages (each replaceable):
  1. EXTRACT   proof_pdfjs_extract: text items + raster (Node, pdfjs-dist)
  2. GEOMETRY  isolated 6-line TAB staves + barlines from pixels
  3. EVENTS    digit -> (staff, string, fret), measure by barline interval
  4. SERIALISE MusicXML (string/fret + honest duration abstention)

No SVG metadata, viewBox, fixture manifests, reference MusicXML or GT
coordinates at inference. Only the uploaded PDF's own text layer + pixels.

Usage:
  python3 tools/guitar-vision/proof-pdf-tab.py --pdf PATH --out DIR
"""
import argparse, json, os, subprocess, sys
import xml.etree.ElementTree as ET
from pathlib import Path
import numpy as np
from PIL import Image

W = Path('/Users/ryland/Documents/scoreflow-guitar')
EXTRACT = Path('/tmp/proof/pdfjs-extract.cjs')

# General MIDI tuning of standard guitar, string 1 (high E) .. 6 (low E)
TUNING = [64, 59, 55, 50, 45, 40]


def binarize(u8):
    """Ink mask with an ADAPTIVE threshold.

    Vector PDFs render staff lines in full black, but rasterised or
    lightly-stroked PDFs render them in mid-grey (measured 128-160 on a
    real score), so a fixed <128 threshold erases the entire staff.
    Otsu's method finds the ink/paper split from the page's own
    histogram; the result is clamped to a sane range and only used when
    it separates the page (otherwise falls back to 128).
    """
    hist, _ = np.histogram(u8, bins=256, range=(0, 256))
    total = u8.size
    if total == 0:
        return u8 < 128
    sum_all = float(np.dot(np.arange(256), hist))
    w_b = 0.0
    sum_b = 0.0
    best_thr, best_var = 128, -1.0
    for t in range(256):
        w_b += float(hist[t])
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += t * float(hist[t])
        m_b = sum_b / w_b
        m_f = (sum_all - sum_b) / w_f
        var = w_b * w_f * (m_b - m_f) ** 2
        if var > best_var:
            best_var, best_thr = var, t
    # Otsu on a mostly-white page returns ~0; clamp to a useful ink range
    if best_thr < 80:
        best_thr = 128
    return u8 <= best_thr


def otsu_threshold(u8):
    """Threshold only (no full mask) so callers can pick a fallback."""
    hist, _ = np.histogram(u8, bins=256, range=(0, 256))
    total = u8.size
    if total == 0:
        return 128
    sum_all = float(np.dot(np.arange(256), hist))
    w_b = 0.0
    sum_b = 0.0
    best_thr, best_var = 128, -1.0
    for t in range(256):
        w_b += float(hist[t])
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += t * float(hist[t])
        m_b = sum_b / w_b
        m_f = (sum_all - sum_b) / w_f
        var = w_b * w_f * (m_b - m_f) ** 2
        if var > best_var:
            best_var, best_thr = var, t
    return 128 if best_thr < 80 else best_thr


def find_staves(u8):
    """Staves with a STRICT threshold first, Otsu only as a fallback.

    Crisp vector PDFs have true-black strokes; raising the threshold
    thickens those strokes by 2-3px, which shifts line centres and breaks
    string alignment. Lightly-stroked/grey PDFs have no ink at 128 at all
    and need Otsu. So: strict first, fall back only when strict finds no
    TAB staff.
    """
    for thr in (128, otsu_threshold(u8)):
        bands = line_bands(u8, thr=thr)
        staves = tab_staves(bands)
        if staves:
            return staves, thr
    return [], 128


# ---------------------------------------------------------------- extract
def extract(pdf, png, dpi=150, page=0):
    """pdfjs-dist text items + page raster. Returns dict or None."""
    script = Path('/tmp/proof/pdfjs-extract-page.cjs')
    if not script.exists():
        src = EXTRACT.read_text()
        # generalise page index
        src = src.replace("const page = await doc.getPage(1);",
                          "const page = await doc.getPage(Number(process.argv[5] || 1));")
        script.write_text(src)
    r = subprocess.run(['node', str(script), str(pdf), str(png), str(dpi), str(page + 1)],
                       capture_output=True, text=True, cwd=str(W),
                       env={**os.environ, 'NODE_PATH': str(W / 'node_modules')})
    if r.returncode != 0:
        return {'error': r.stderr[-400:]}
    side = json.loads(Path(str(png) + '.json').read_text())
    side['items'] = [it for it in side['items'] if it.get('text')]
    return side


# --------------------------------------------------------------- geometry
def line_bands(u8, minrun_frac=0.06, thr=128):
    """Horizontal line bands by contiguous run, width-relative threshold."""
    ink = u8 <= thr
    h, w = ink.shape
    minrun = max(int(w * minrun_frac), 40)
    runs = np.zeros(h, dtype=np.int32)
    for y in range(h):
        ch = np.flatnonzero(ink[y])
        if not len(ch):
            continue
        brk = np.flatnonzero(np.diff(ch) > 1)
        st = np.concatenate(([0], brk + 1))
        en = np.concatenate((brk, [len(ch) - 1]))
        runs[y] = int((ch[en] - ch[st] + 1).max())
    rows = np.nonzero(runs >= minrun)[0]
    if not len(rows):
        return []
    bands, st, pv = [], rows[0], rows[0]
    for r in rows[1:]:
        if r - pv > 3:
            bands.append((st + pv) / 2)
            st = r
        pv = r
    bands.append((st + pv) / 2)
    return bands


def tab_staves(bands):
    """Isolated 6-line groups with consistent gap (notation staves are 5)."""
    out = []
    n = len(bands)
    for i in range(n - 5):
        m = bands[i:i + 6]
        gaps = [b - a for a, b in zip(m, m[1:])]
        mg = sum(gaps) / 5.0
        if not (4 <= mg <= 80):
            continue
        cv = (sum((g - mg) ** 2 for g in gaps) / 5.0) ** 0.5 / mg
        if cv > 0.18:
            continue
        # isolated: a real 6-line staff has no line within 1.5 gaps above
        # or below the group (a 5-line notation staff + spill would).
        # No isolation veto here: overlapping 6-groups are legitimate
        # candidates and the correct one is chosen later by digit-line
        # residual (a 5-line notation staff + spill and a TAB staff one
        # band lower are both 6-line groups; only alignment separates them).
        out.append({'top': float(m[0]), 'bot': float(m[-1]), 'gap': float(mg)})
    return out


def digit_shape_items(items):
    """Digit text items whose glyph shape is consistent with a fret."""
    out = []
    for s in items:
        txt = (s.get('text') or '').strip()
        if not txt.isdigit():
            continue
        v = int(txt)
        if not (0 <= v <= 24):
            continue
        x0, y0, x1, y1 = s['bbox']
        w_, h_ = x1 - x0, y1 - y0
        if h_ <= 0:
            continue
        if w_ > 3.2 * h_ or h_ > 40:
            continue
        out.append({'text': txt, 'fret': v, 'bbox': s['bbox'],
                    'cx': (x0 + x1) / 2, 'cy': (y0 + y1) / 2,
                    'font': s.get('font', '')})
    return out


def dominant_digit_group(digits):
    """Keep the dominant (font, rounded size) group among digit items.

    Measure numbers / fingering marks are engraved in a different face
    or size from the TAB fret digits. Clustering by (font, size) and
    keeping the largest group is data-driven (no fixture constants).
    """
    from collections import Counter
    key = lambda d: (d.get('font', ''), round(d.get('size', 0) / 2.0))
    if not digits:
        return digits
    groups = Counter(key(d) for d in digits)
    best = groups.most_common(1)[0][0]
    return [d for d in digits if key(d) == best]


def filter_staves_by_digits(staves, digits, min_support=3):
    """Keep staves that carry fret digits, ranked by line ALIGNMENT.

    A fret digit is printed ON a staff line, so the correct 6-line group
    is the one whose lines best coincide with digit centres. This also
    rejects a group that is offset by one line (which would shift every
    string assignment).
    """
    keep = []
    for s in staves:
        m = 0.6 * s['gap']
        inside = [d for d in digits if s['top'] - m <= d['cy'] <= s['bot'] + m]
        if len(inside) < min_support:
            continue
        lines = [s['top'] + k * s['gap'] for k in range(6)]
        tol = 0.30 * s['gap']
        res = [min(abs(d['cy'] - ln) for ln in lines) for d in inside]
        aligned = sum(1 for r in res if r <= tol)
        # The correct staff has the LOWEST total residual: a group shifted
        # by one line still "aligns" many digits, but each sits further
        # from its nearest line.
        keep.append(dict(s, digit_support=len(inside), aligned=aligned,
                         resid=float(sum(res))))
    keep = [s for s in keep if s['aligned'] >= 0.5 * s['digit_support']]
    # Greedy non-overlapping selection by lowest residual. Overlapping
    # candidates differ by one line; the one whose lines best match the
    # digit baselines is the real staff.
    keep.sort(key=lambda s: s['resid'])
    chosen = []
    for s in keep:
        if any(not (s['bot'] < c['top'] - 2 or s['top'] > c['bot'] + 2) for c in chosen):
            continue
        chosen.append(s)
    chosen.sort(key=lambda s: s['top'])
    return chosen


def staff_barlines(u8, staff):
    """Vertical ink columns spanning the staff's full inter-line height."""
    ink = binarize(u8)
    top = int(round(staff['top']))
    bot = int(round(staff['bot']))
    span = bot - top + 1
    if span < 10:
        return []
    band = ink[top:bot + 1, :]
    cover = band.mean(axis=0)
    # 0.75: a true barline spans the staff but antialiasing/line weight
    # varies between systems (measured 0.81 on one staff, 1.0 on another);
    # text and noteheads stay well below.
    cols = np.nonzero(cover >= 0.75)[0]
    out, prev = [], -99
    for c in cols:
        if c - prev <= 3:
            prev = c
            continue
        out.append(int(c))
        prev = c
    # merge double/repeat barlines (two verticals ~12px apart are one
    # boundary; real measure boundaries are staff-widths apart)
    merged, prev = [], -999
    for c in out:
        if c - prev < 15:
            prev = c
            continue
        merged.append(c)
        prev = c
    return merged


# ----------------------------------------------------------------- events
def assign_events(items, staves, barlines_by_staff, img_w, img_h):
    """Digit items -> (staff, string, fret, measure).

    Measures are numbered per staff from its own visible barlines, then
    offset by the number of measures already spent on earlier staves -
    the reading order of a multi-system page.
    """
    digits = digit_shape_items(items)
    import bisect as _bisect
    # measures per staff = number of barlines (each starts a measure) and
    # at least one trailing interval after the last barline
    per_staff = {}
    for si in range(len(staves)):
        bars = barlines_by_staff.get(si, [])
        # the LAST barline closes the final measure; measures = bars - 1
        per_staff[si] = max(1, len(bars) - 1)
    offset = {}
    acc = 0
    for si in sorted(per_staff):
        offset[si] = acc
        acc += per_staff[si]
    events = []
    for d in digits:
        best = None
        for si, st in enumerate(staves):
            margin = 0.6 * st['gap']
            if st['top'] - margin <= d['cy'] <= st['bot'] + margin:
                best = si
                break
        if best is None:
            continue
        st = staves[best]
        string = int(round((d['cy'] - st['top']) / st['gap'])) + 1
        if not (1 <= string <= 6):
            continue
        bars = barlines_by_staff.get(best, [])
        local = _bisect.bisect_left(bars, d['cx'])
        measure = offset[best] + max(1, local)
        events.append({'staff': best, 'string': string, 'fret': d['fret'],
                       'measure': measure, 'x': d['cx'], 'y': d['cy'],
                       'font': d['font']})
    events.sort(key=lambda e: (e['staff'], e['measure'], e['x'], e['string']))
    return events


# -------------------------------------------------------------- musicxml
def to_musicxml(events, divisions=480, duration=480):
    """Emit TAB MusicXML. duration is explicit but flagged: the text layer
    carries no rhythm, so every note is written as a flagged default and
    the summary records that rhythm is NOT recovered."""
    score = ET.Element('score-partwise', version='4.0')
    pl = ET.SubElement(score, 'part-list')
    sp = ET.SubElement(pl, 'score-part', id='P1')
    ET.SubElement(sp, 'part-name').text = 'Guitar'
    part = ET.SubElement(score, 'part', id='P1')
    by_measure = {}
    for e in events:
        by_measure.setdefault(e['measure'], []).append(e)
    for m in sorted(by_measure):
        meas = ET.SubElement(part, 'measure', number=str(m))
        attrs = ET.SubElement(meas, 'attributes')
        ET.SubElement(attrs, 'divisions').text = str(divisions)
        if m == sorted(by_measure)[0]:
            # explicit six-line TAB staff (renders as TAB, not notation)
            key = ET.SubElement(attrs, 'key')
            ET.SubElement(key, 'fifths').text = '0'
            time = ET.SubElement(attrs, 'time')
            ET.SubElement(time, 'beats').text = '4'
            ET.SubElement(time, 'beat-type').text = '4'
            clef = ET.SubElement(attrs, 'clef')
            ET.SubElement(clef, 'sign').text = 'TAB'
            ET.SubElement(clef, 'line').text = '5'
            sd = ET.SubElement(attrs, 'staff-details')
            ET.SubElement(sd, 'staff-lines').text = '6'
            for sn in range(1, 7):
                st_ = ET.SubElement(sd, 'staff-tuning', number=str(sn))
                ET.SubElement(st_, 'tuning-step').text = 'E'
                ET.SubElement(st_, 'tuning-octave').text = '2'
        # group simultaneous notes (same x within a glyph width)
        notes = sorted(by_measure[m], key=lambda e: (e['x'], e['string']))
        prev_x = None
        for e in notes:
            note = ET.SubElement(meas, 'note')
            if prev_x is not None and abs(e['x'] - prev_x) <= 1.5:
                ET.SubElement(note, 'chord')
            prev_x = e['x']
            pitch = ET.SubElement(note, 'pitch')
            midi = TUNING[e['string'] - 1] + e['fret']
            names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
            ET.SubElement(pitch, 'step').text = names[midi % 12][0]
            if '#' in names[midi % 12]:
                ET.SubElement(pitch, 'alter').text = '1'
            ET.SubElement(pitch, 'octave').text = str(midi // 12 - 1)
            ET.SubElement(note, 'duration').text = str(duration)
            ET.SubElement(note, 'voice').text = '1'
            ET.SubElement(note, 'type').text = 'quarter'
            tech = ET.SubElement(note, 'notations')
            te = ET.SubElement(tech, 'technical')
            ET.SubElement(te, 'string').text = str(e['string'])
            ET.SubElement(te, 'fret').text = str(e['fret'])
    return score


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', required=True)
    ap.add_argument('--page', type=int, default=0)
    ap.add_argument('--dpi', type=int, default=150)
    ap.add_argument('--out', default=None)
    args = ap.parse_args()
    out = Path(args.out or '/tmp/proof/pdftab')
    out.mkdir(parents=True, exist_ok=True)
    png = out / f'p{args.page}.png'
    ex = extract(args.pdf, png, args.dpi, args.page)
    if 'error' in ex:
        print('extract failed:', ex['error'])
        return 2
    u8 = np.asarray(Image.open(png).convert('L')).astype(np.uint8)
    staves, thr_used = find_staves(u8)
    bands = line_bands(u8, thr=thr_used)
    digits = dominant_digit_group(digit_shape_items(ex['items']))
    staves = filter_staves_by_digits(staves, digits)
    barlines = {i: staff_barlines(u8, s) for i, s in enumerate(staves)}
    events = assign_events(ex['items'], staves, barlines, u8.shape[1], u8.shape[0])
    summary = {
        'pdf': args.pdf, 'page': args.page, 'dpi': args.dpi,
        'text_items': len(ex['items']),
        'staff_bands': len(bands),
        'tab_staves': staves,
        'barlines_per_staff': {str(k): v for k, v in barlines.items()},
        'events': len(events),
        'events_by_measure': {str(m): sum(1 for e in events if e['measure'] == m)
                              for m in sorted({e['measure'] for e in events})},
        'rhythm_recovered': False,
        'rhythm_note': 'PDF text layer carries fret digits, not durations; '
                       'all notes are emitted with an explicit default duration.',
    }
    (out / f'p{args.page}-summary.json').write_text(json.dumps(summary, indent=1))
    (out / f'p{args.page}-events.json').write_text(json.dumps(events, indent=1))
    xml = to_musicxml(events)
    ET.ElementTree(xml).write(out / f'p{args.page}-tab.musicxml', encoding='utf-8', xml_declaration=True)
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
