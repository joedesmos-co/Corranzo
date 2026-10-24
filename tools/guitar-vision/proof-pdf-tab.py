"""Complete PDF -> guitar TAB -> MusicXML pipeline (pdfjs-dist).

Stages (each replaceable):
  1. EXTRACT   pdfjs-dist: text items + raster (Node, Apache-2.0)
  2. GEOMETRY  six-line TAB staves + barlines from pixels
  3. EVENTS    digit -> (staff, string, fret), measure by barline interval
  4. RHYTHM    SMuFL notehead glyph + stem/beam evidence + measure check
  5. SERIALISE MusicXML (string/fret + recovered duration, or explicit
               placeholder when rhythm evidence is insufficient)

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

W = Path(__file__).resolve().parents[2]
EXTRACT = Path(__file__).resolve().parent / 'pdfjs-extract-page.cjs'

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
def _load_mod(name, filename):
    import importlib.util as _ilu
    spec = _ilu.spec_from_file_location(name, str(W / 'tools/guitar-vision' / filename))
    m = _ilu.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
    return m


def node_modules_dir():
    """Locate a node_modules that contains pdfjs-dist.

    The research worktree may not have its own node_modules (the main
    worktree holds the installed tree), so search in a stable order
    instead of assuming one path. Returns None when nothing usable is
    found, so callers can fail honestly with a clear message.
    """
    def ok(p):
        return (p / 'pdfjs-dist' / 'legacy' / 'build' / 'pdf.mjs').exists()

    cands = []
    for part in os.environ.get('NODE_PATH', '').split(os.pathsep):
        if part:
            cands.append(Path(part))
    cands.append(W / 'node_modules')
    # git worktrees share one object store; the main worktree usually
    # carries the installed modules.
    for parent in [W, *W.parents]:
        cands.append(parent / 'node_modules')
    # common-dir parent: <main-worktree>/.git -> <main-worktree>
    try:
        common = subprocess.run(['git', 'rev-parse', '--git-common-dir'],
                                cwd=str(W), capture_output=True, text=True, timeout=10)
        if common.returncode == 0:
            p = Path(common.stdout.strip())
            p = p if p.is_absolute() else (W / p)
            cands.append(p.resolve().parent / 'node_modules')
    except Exception:
        pass
    seen = set()
    for c in cands:
        c = c.resolve()
        if c in seen:
            continue
        seen.add(c)
        if ok(c):
            return c
    return None


def extract(pdf, png, dpi=150, page=0):
    """pdfjs-dist text items + page raster. Returns dict or None."""
    mods = node_modules_dir()
    if mods is None:
        return {'error': 'pdfjs-dist not found: no node_modules containing '
                         'pdfjs-dist/legacy/build/pdf.mjs (set NODE_PATH)'}
    if not EXTRACT.exists():
        return {'error': f'extractor missing: {EXTRACT}'}
    r = subprocess.run(['node', str(EXTRACT), str(pdf), str(png), str(dpi),
                        str(page + 1), str(mods)],
                       capture_output=True, text=True, cwd=str(W),
                       env={**os.environ, 'NODE_PATH': str(mods)})
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


# ------------------------------------------------------------------ rhythm
# SMuFL (Standard Music Font Layout) codepoints used as rhythm evidence.
# These are text glyphs in the PDF, so their positions are exact - no
# raster notehead detection is needed when the score embeds a music font.
SMUFL_NOTEHEADS = {
    '\ue0a0': ('whole', 4.0),
    '\ue0a2': ('half', 2.0),
    '\ue0a3': ('half', 2.0),
    '\ue0a4': ('quarter', 1.0),   # filled head; beams decide shorter
}
SMUFL_RESTS = {
    '\ue4e2': ('breve', 8.0),
    '\ue4e3': ('whole', 4.0),
    '\ue4e4': ('half', 2.0),
    '\ue4e5': ('quarter', 1.0),
    '\ue4e6': ('eighth', 0.5),
    '\ue4e7': ('16th', 0.25),
    '\ue4e8': ('32nd', 0.125),
}


def _glyph_box(it):
    x0, y0, x1, y1 = it['bbox']
    return {'kind_text': it['text'].strip(), 'box': [x0, y0, x1, y1],
            'cx': (x0 + x1) / 2.0, 'cy': (y0 + y1) / 2.0,
            'w': max(x1 - x0, 0.1), 'h': max(y1 - y0, 0.1)}


def notation_noteheads(items):
    """Noteheads from the standard-notation staff (SMuFL text items)."""
    out = []
    for it in items:
        ch = (it.get('text') or '').strip()[:1]
        if not ch or ch not in SMUFL_NOTEHEADS:
            continue
        kind, base = SMUFL_NOTEHEADS[ch]
        g = _glyph_box(it)
        g.pop('kind_text')
        g.update({'kind': kind, 'base': base})
        out.append(g)
    out.sort(key=lambda n: n['cx'])
    return out


def notation_rests(items):
    """Rest glyphs (also SMuFL text, so exact). Reported, not assumed."""
    out = []
    for it in items:
        ch = (it.get('text') or '').strip()[:1]
        if not ch or ch not in SMUFL_RESTS:
            continue
        kind, base = SMUFL_RESTS[ch]
        g = _glyph_box(it)
        g.pop('kind_text')
        g.update({'kind': kind, 'base': base})
        out.append(g)
    out.sort(key=lambda n: n['cx'])
    return out


def time_signature(items, default=(4, 4)):
    """Read the time signature from SMuFL timeSig0-9 glyphs.

    Returns ((beats, beat_type), source). Rows of adjacent digits form a
    number, and vertically adjacent numbers form numerator/denominator.
    Nothing is assumed when no glyph is present: the caller records that
    the default was used.
    """
    glyphs = []
    for it in items:
        ch = (it.get('text') or '').strip()[:1]
        if not ch:
            continue
        cp = ord(ch)
        if 0xE080 <= cp <= 0xE089:
            g = _glyph_box(it)
            g['digit'] = cp - 0xE080
            glyphs.append(g)
    if not glyphs:
        return tuple(default), 'default'
    h = float(np.median([g['h'] for g in glyphs]))
    rows = []
    for g in sorted(glyphs, key=lambda g: (g['cy'], g['cx'])):
        for r in rows:
            if abs(g['cy'] - r['cy']) <= 0.5 * h:
                r['digits'].append(g)
                r['cy'] = float(np.mean([d['cy'] for d in r['digits']]))
                break
        else:
            rows.append({'cy': g['cy'], 'digits': [g]})
    for r in rows:
        r['digits'].sort(key=lambda g: g['cx'])
        r['text'] = ''.join(str(d['digit']) for d in r['digits'])
        r['x0'] = r['digits'][0]['box'][0]
    rows.sort(key=lambda r: r['cy'])
    pairs = []
    for a, b in zip(rows, rows[1:]):
        gap = b['cy'] - a['cy']
        same_column = abs(a['x0'] - b['x0']) <= 0.8 * h
        if same_column and 0.2 * h <= gap <= 1.8 * h:
            pairs.append((a['text'], b['text']))
    for num_s, den_s in pairs:
        try:
            num, den = int(num_s), int(den_s)
        except ValueError:
            continue
        if 1 <= num <= 32 and 1 <= den <= 32:
            return (num, den), 'smufl-glyphs'
    return tuple(default), 'default'


def _dist_to_span(y, top, bot):
    if y < top:
        return top - y
    if y > bot:
        return y - bot
    return 0.0


def assign_notation_to_staves(glyphs, staves):
    """Attach notation glyphs to the TAB staff they belong to.

    A notation system normally sits above its TAB staff, but the rule is
    geometric rather than directional: each glyph goes to the nearest
    staff by vertical distance to the staff span, with ties broken toward
    the staff top below the glyph. This also copes with TAB-above-
    notation layouts, unlike a fixed "always above" assumption.
    """
    per = {}
    for g in glyphs:
        hint = g.get('staff_hint')
        if hint is not None and 0 <= hint < len(staves):
            per.setdefault(hint, []).append(g)
            continue
        best, best_key = None, None
        for si, st in enumerate(staves):
            d = _dist_to_span(g['cy'], st['top'], st['bot'])
            # prefer above-system when distances are close
            key = (round(d, 1), 0 if g['cy'] <= st['top'] else 1)
            if best_key is None or key < best_key:
                best, best_key = si, key
        if best is not None:
            per.setdefault(best, []).append(g)
    return per


def notehead_columns(noteheads):
    """Group simultaneously sounding noteheads into chord columns.

    The tolerance is derived from the notehead glyph width: chord tones
    displaced to avoid a collision sit within ~0.6 glyph widths of each
    other, while successive onsets are further apart. No page constants.
    """
    if not noteheads:
        return []
    width = float(np.median([n['w'] for n in noteheads]))
    tol = max(2.0, 0.6 * width)
    cols = []
    for n in sorted(noteheads, key=lambda n: n['cx']):
        if cols and (n['cx'] - cols[-1]['cx']) <= tol:
            c = cols[-1]
            c['members'].append(n)
            c['x0'] = min(c['x0'], n['box'][0])
            c['x1'] = max(c['x1'], n['box'][2])
            c['y0'] = min(c['y0'], n['box'][1])
            c['y1'] = max(c['y1'], n['box'][3])
        else:
            cols.append({'cx': n['cx'], 'x0': n['box'][0], 'x1': n['box'][2],
                         'y0': n['box'][1], 'y1': n['box'][3],
                         'members': [n]})
    for c in cols:
        c['width'] = c['x1'] - c['x0']
    return cols


def tab_onsets(events, digit_width):
    """Group TAB digits that start together into onsets (chords)."""
    tol = max(1.0, 0.15 * digit_width)
    groups = {}
    for e in events:
        key = (e['staff'], e['measure'])
        groups.setdefault(key, []).append(e)
    onsets = []
    for key in sorted(groups):
        evs = sorted(groups[key], key=lambda e: e['x'])
        cur = [evs[0]]
        for e in evs[1:]:
            if e['x'] - cur[-1]['x'] <= tol:
                cur.append(e)
            else:
                onsets.append({'staff': key[0], 'measure': key[1],
                               'x': float(np.mean([v['x'] for v in cur])),
                               'events': cur})
                cur = [e]
        onsets.append({'staff': key[0], 'measure': key[1],
                       'x': float(np.mean([v['x'] for v in cur])),
                       'events': cur})
    onsets.sort(key=lambda o: (o['staff'], o['measure'], o['x']))
    return onsets


def _stem_probe(ink, beam_mask, box, rhy, min_run=None, side_tol=None,
                staff_rows=None, flag_min_ink=5):
    """Stem evidence using a SINGLE-PIXEL column.

    anchored_stem() requires 25% ink in a 5px window, which assumes a
    2px stem. A real 150dpi engraving can draw a 1px stem (1/5 = 20%),
    so thin-stemmed scores lose every stem. A vertical run of ink in one
    column that is >= MIN_STEM_RUN long, adjacent to the notehead edge,
    is a stem regardless of stroke width. Beams are then read from the
    beam mask along that exact column.
    """
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    if min_run is None:
        min_run = rhy.MIN_STEM_RUN
    tol = rhy.STEM_SIDE_TOL if side_tol is None else int(round(side_tol))
    best = None
    # Engraving convention: a stem on the RIGHT edge points up, a stem on
    # the LEFT edge points down. Searching both directions on both edges
    # lets a dense chord borrow the neighbouring note's stem (measured:
    # a left-edge up-run 3px away on eighth-note chords), which then
    # carries the neighbour's flag/beam evidence.
    for edge, upward in ((x1, True), (x0, False)):
        for xx in range(max(edge - tol, 0), min(edge + tol + 1, ink.shape[1])):
            col = ink[:, xx]
            if upward:
                run = rhy._bridged_run(col, y0, -1)
                tip, span = y0 - run, (y0 - run, y0)
            else:
                run = rhy._bridged_run(col, y1, 1)
                tip, span = y1 + run, (y1, y1 + run)
            if best is None or run > best['run']:
                best = {'run': run, 'x': xx, 'tip': tip, 'span': span,
                        'up': upward}
    if best is None:
        return {'stem': False, 'run': 0, 'beams': 0, 'flags': 0, 'dots': 0}
    if best['run'] < min_run:
        return {'stem': False, 'run': best['run'], 'beams': 0, 'flags': 0, 'dots': 0}
    y_lo = max(min(best['span']) - 4, 0)
    y_hi = min(max(best['span']) + 4, ink.shape[0] - 1)
    xx = best['x']
    col = beam_mask[y_lo:y_hi + 1, max(xx - 6, 0):xx + 7].any(axis=1)
    rows = np.nonzero(col)[0]
    groups, prev = 0, -99
    for r in rows:
        if r - prev > 3:
            groups += 1
        prev = r
    # Flags: a flag is ink immediately beside the stem tip (right side for
    # both stem directions in SMuFL). A quarter note has an empty strip
    # there; reading the whole nearby component fails because a tight
    # engraving lets the flag touch the next stem, so use near-tip ink.
    tip = best['tip']
    up = best.get('up', True)
    gap_est = (float(min_run) / 1.6) if min_run else 17.0
    fw = max(12, int(round(0.40 * gap_est)))
    fh = max(12, int(round(0.30 * gap_est)))
    # Measure the stem's own thickness on a clean section NEAR THE
    # NOTEHEAD end (a flag attaches at the tip, so sampling there would
    # measure the flag). At 150dpi the stem is 1px and the old +2px start
    # worked; at 300dpi it is 2-3px and +2px reads the stem as a flag.
    run_len = max(int(best['run']), 1)
    base = (max(best['span']) - max(2, run_len // 5)) if up \
        else (min(best['span']) + max(2, run_len // 5))
    # Several nearby rows: a staff line crossing one sample would measure
    # the page-wide line instead of the stem. The stem is the narrowest
    # non-zero horizontal run among the samples.
    widths = []
    for dy in (-6, -3, 0, 3, 6):
        py = base + dy
        if not (0 <= py < ink.shape[0]):
            continue
        w = 1
        if up:
            while xx + w < ink.shape[1] and ink[py, xx + w]:
                w += 1
        else:
            while xx - w >= 0 and ink[py, xx - w]:
                w += 1
        if ink[py, xx]:
            widths.append(w)
    wstem = min(widths) if widths else 1
    wstem = min(wstem, max(2, int(0.20 * gap_est)))
    fx0 = xx + wstem + 1
    fx1 = fx0 + fw
    if up:
        # A real flag hangs BELOW an up-stem's tip. Ink exactly at the
        # tip row is usually an annotation/bracket crossing the stem.
        fy0, fy1 = tip + 2, tip + 2 + fh
    else:
        fy0, fy1 = tip - 2 - fh, tip - 2
    fy0 = max(fy0, 0); fy1 = min(fy1, ink.shape[0])
    fx1 = min(fx1, ink.shape[1])
    near = ink[fy0:fy1, fx0:fx1].copy() if fx1 > fx0 else np.zeros((0, 0), bool)
    if staff_rows is not None and near.size:
        for yy in range(fy0, fy1):
            if staff_rows[yy]:
                near[yy - fy0, :] = False
    if near.size:
        # A staff line crosses the whole strip (nearly every column), while
        # a flag is a sparse diagonal stroke. Scanned staff lines are often
        # too broken for a page-wide row mask, so reject near-full rows
        # locally instead of relying on global line detection.
        width = near.shape[1]
        rowsum = near.sum(axis=1)
        keep = (rowsum > 0) & (rowsum < max(2, int(0.8 * width)))
        near = near[keep, :]
    flags = 1 if int(near.sum()) >= flag_min_ink else 0
    return {'stem': True, 'run': int(best['run']), 'beams': int(groups),
            'flags': flags, 'flag_ink': int(near.sum()),
            'dots': 0, 'x': xx, 'span': best['span'],
            'tip': tip, 'up': up}


def _column_evidence(col, ink, beam_mask, rhy, min_run=None, side_tol=None,
                     staff_rows=None, flag_min_ink=5):
    """Strongest stem/beam evidence among the chord's noteheads.

    A chord shares one stem, but chord tones displaced to avoid a
    collision sit a few pixels to the side, so the stem is not always on
    the union box edge. Probe every tone and keep the longest run.
    """
    best = None
    for m in col['members']:
        ev = _stem_probe(ink, beam_mask, m['box'], rhy, min_run, side_tol,
                         staff_rows, flag_min_ink)
        if best is None or ev['run'] > best['run']:
            best = ev
    return {'beams': best['beams'], 'flags': best.get('flags', 0),
            'dots': 0, 'stem': best['stem'],
            'stem_run': best['run'], 'stem_box': best.get('x')}


def _duration_from_evidence(col, ev, confident_enabled=True):
    bases = sorted({m['base'] for m in col['members']}, reverse=True)
    ambiguous = len(bases) > 1
    base = bases[0]
    beams = ev['beams']
    flags = ev.get('flags', 0)
    dots = ev['dots']
    if base >= 4.0:            # whole: hollow head, no stem required
        dur, conf = 4.0, True
    elif base >= 2.0:          # half: hollow head is itself evidence
        dur, conf = 2.0, True
    else:
        # Beams and flags are mutually exclusive on one note. If both are
        # seen, one is spurious: use the stronger (either yields the same
        # subdivision count) but refuse to call the duration confident.
        contradiction = beams > 0 and flags > 0
        steps = min(max(beams, flags), 3)
        dur = 1.0 / (2 ** steps)
        conf = ev['stem'] and not contradiction
    return {'duration': dur, 'duration_plain': dur,
            'beams': beams, 'flags': flags, 'dots': dots, 'stem': ev['stem'],
            'confident': bool(conf) and not ambiguous,
            'ambiguous': ambiguous, 'beam_flag_conflict': beams > 0 and flags > 0}


def band_clusters(bands, min_lines=4):
    """Consecutive bands with near-equal spacing -> staff candidates.

    Bands closer than 0.4 of the typical line gap are the same physical
    line (thick or broken strokes produce two runs); they are merged
    first, otherwise a single spurious band hides a real staff line.
    """
    if len(bands) >= 3:
        gaps = [b - a for a, b in zip(bands, bands[1:]) if b - a > 3]
        med = float(np.median(gaps)) if gaps else 0.0
        if med > 0:
            merged = [bands[0]]
            for b in bands[1:]:
                if b - merged[-1] < 0.4 * med:
                    merged[-1] = (merged[-1] + b) / 2.0
                else:
                    merged.append(b)
            bands = merged
    out = []
    n = len(bands)
    i = 0
    while i < n:
        best = None
        for k in range(min_lines, 8):
            if i + k > n:
                break
            m = bands[i:i + k]
            gaps = [b - a for a, b in zip(m, m[1:])]
            mg = sum(gaps) / len(gaps)
            if not (5 <= mg <= 60):
                continue
            cv = (sum((g - mg) ** 2 for g in gaps) / len(gaps)) ** 0.5 / mg
            if cv <= 0.18:
                best = {'top': float(m[0]), 'bot': float(m[-1]),
                        'gap': float(mg), 'lines': k}
        if best:
            out.append(best)
            i += best['lines']
        else:
            i += 1
    return out


def notation_regions(bands, staves):
    """Vertical region of the notation staff above each TAB staff.

    A notation system is engraved immediately above its TAB staff. The
    region is the tallest evenly-spaced line group between the previous
    TAB staff and this one, padded for ledger lines and flags. TAB-only
    scores (no line group there) get no region, so no rhythm is guessed.
    """
    order = sorted(range(len(staves)), key=lambda i: staves[i]['top'])
    regions = {}
    prev_bot = -1.0
    for si in order:
        st = staves[si]
        above = [b for b in bands if prev_bot + 3 < b < st['top'] - 3]
        groups = band_clusters(above, min_lines=4)
        groups = [g for g in groups if g['bot'] < st['top'] - 3]
        if groups:
            g = max(groups, key=lambda g: (g['lines'], -abs(st['top'] - g['bot'])))
            pad = g['gap']
            # Generous above (ledger notes) and below (low chord tones),
            # but never into the TAB staff where fret digits live.
            regions[si] = (max(g['top'] - 4.0 * pad, prev_bot + pad),
                           min(g['bot'] + 8.0 * pad, st['top'] - 1.5 * pad))
        prev_bot = st['bot']
    return regions


def raster_noteheads(ink, y0, y1, gap, min_area_frac=0.10, staff_hint=None):
    """Font-independent filled-notehead detection from the rendered page.

    Staff lines and stems are 1-3px strokes and vanish under a 3x3
    erosion, while filled noteheads survive as solid cores. Two chord
    tones a second apart can touch: an oversized blob is split at the
    valley of its row profile, which separates the two heads without
    relying on font metrics. All size limits are relative to the staff
    gap, so the same code works at other DPIs.
    """
    from scipy import ndimage as ndi
    y0 = max(int(y0), 0)
    y1 = min(int(y1), ink.shape[0])
    sub = ink[y0:y1]
    if sub.size == 0:
        return []
    # Stroke widths scale with the staff: a 3x3 erosion removes 1px
    # stems at 150dpi but leaves 2-3px stems at 300dpi, which then merge
    # noteheads with stems. Scale the kernel with the staff gap.
    k = max(3, int(round(gap / 17.0)) * 2 + 1)
    er = ndi.binary_erosion(sub, structure=np.ones((k, k), bool))
    lab, n = ndi.label(er)
    objs = ndi.find_objects(lab)
    w_lo, w_hi = 0.35 * gap, 1.45 * gap
    h_lo, h_hi = 0.30 * gap, 1.30 * gap
    a_lo, a_hi = min_area_frac * gap * gap, 3.0 * gap * gap
    raw = []
    for i, sl in enumerate(objs, 1):
        if sl is None:
            continue
        ys, xs = sl
        h = ys.stop - ys.start
        w = xs.stop - xs.start
        area = int((lab[sl] == i).sum())
        if not (w_lo <= w <= w_hi and h_lo <= h <= h_hi and a_lo <= area <= a_hi):
            continue
        if not (0.9 <= w / max(h, 1) <= 2.4):
            continue
        if area / max(w * h, 1) < 0.45:
            continue
        raw.append({'i': i, 'x0': xs.start, 'y0': ys.start,
                    'w': w, 'h': h, 'a': area})
    if not raw:
        return []
    med_h = float(np.median([b['h'] for b in raw]))
    med_a = float(np.median([b['a'] for b in raw]))
    out = []
    for b in raw:
        if b['h'] >= 1.35 * med_h and b['a'] >= 1.5 * med_a:
            sub_b = (lab[b['y0']:b['y0'] + b['h'],
                         b['x0']:b['x0'] + b['w']] == b['i'])
            prof = sub_b.sum(axis=1)
            mx = int(prof.max()) if prof.size else 0
            cuts = []
            for k in range(1, len(prof) - 1):
                if (prof[k] <= 0.45 * mx and prof[k] <= prof[k - 1]
                        and prof[k] <= prof[k + 1]):
                    if cuts and k - cuts[-1] <= 2:
                        continue
                    cuts.append(k)
            segs, prev = [], 0
            for c in cuts:
                if prof[prev:c].sum() >= 0.35 * mx and prof[c:].sum() >= 0.35 * mx:
                    segs.append((prev, c))
                    prev = c
            segs.append((prev, len(prof)))
            for (r0, r1) in segs:
                part = sub_b[r0:r1, :]
                if part.sum() < 0.45 * med_a:
                    continue
                ys2, xs2 = np.nonzero(part)
                bx0 = b['x0'] + int(xs2.min())
                bx1 = b['x0'] + int(xs2.max()) + 1
                by0 = y0 + b['y0'] + r0 + int(ys2.min())
                by1 = y0 + b['y0'] + r0 + int(ys2.max()) + 1
                out.append({'kind': 'quarter', 'base': 1.0,
                            'box': [float(bx0), float(by0), float(bx1), float(by1)],
                            'cx': (bx0 + bx1) / 2.0, 'cy': (by0 + by1) / 2.0,
                            'w': float(bx1 - bx0), 'h': float(by1 - by0),
                            'split': True, 'staff_hint': staff_hint})
        else:
            bx0 = b['x0']
            by0 = y0 + b['y0']
            bx1 = b['x0'] + b['w']
            by1 = y0 + b['y0'] + b['h']
            out.append({'kind': 'quarter', 'base': 1.0,
                        'box': [float(bx0), float(by0), float(bx1), float(by1)],
                        'cx': (bx0 + bx1) / 2.0, 'cy': (by0 + by1) / 2.0,
                        'w': float(b['w']), 'h': float(b['h']),
                        'split': False, 'staff_hint': staff_hint})
    out.sort(key=lambda q: (q['cy'], q['cx']))
    return out


# ------------------------------------------------------- raster TAB digits
_FONT_CANDIDATES = [
    # Sans (TAB engraving is usually sans), serif and monospace faces are
    # all useful: the classifier is template-based, so a wider range of
    # glyph shapes generalises better to an unseen publisher font. System
    # fonts are used at runtime only; the OFL Arimo fallback ships here.
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/System/Library/Fonts/Supplemental/Verdana.ttf',
    '/System/Library/Fonts/Supplemental/Georgia.ttf',
    '/System/Library/Fonts/Supplemental/Times New Roman.ttf',
    '/System/Library/Fonts/Supplemental/Courier New.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf',
    '/usr/share/fonts/truetype/arimo/Arimo-Regular.ttf',
    '/Library/Frameworks/Python.framework/Versions/3.13/lib/python3.13/site-packages/matplotlib/mpl-data/fonts/ttf/DejaVuSans.ttf',
    '/Library/Frameworks/Python.framework/Versions/3.13/lib/python3.13/site-packages/matplotlib/mpl-data/fonts/ttf/DejaVuSans-Bold.ttf',
    '/Library/Frameworks/Python.framework/Versions/3.13/lib/python3.13/site-packages/matplotlib/mpl-data/fonts/ttf/DejaVuSansMono.ttf',
    '/Library/Frameworks/Python.framework/Versions/3.13/lib/python3.13/site-packages/matplotlib/mpl-data/fonts/ttf/DejaVuSerif.ttf',
    '/Library/Frameworks/Python.framework/Versions/3.13/lib/python3.13/site-packages/matplotlib/mpl-data/fonts/ttf/STIXGeneral.ttf',
    str(Path(__file__).resolve().parent / 'fonts' / 'Arimo.ttf'),
]


def template_font_paths():
    """Fonts used to build digit templates.

    GV_DIGIT_FONTS (path-separated) overrides the list; the benchmark uses
    it for leave-one-font-out evaluation. Default: every available face.
    """
    env = os.environ.get('GV_DIGIT_FONTS')
    if env:
        return [p for p in env.split(os.pathsep) if p and Path(p).exists()]
    return [p for p in _FONT_CANDIDATES if Path(p).exists()]


def _norm_digit(mask, W=24, H=32):
    import cv2
    return cv2.resize((mask.astype(np.uint8) * 255), (W, H),
                      interpolation=cv2.INTER_AREA) > 110


_DIGIT_TEMPLATES = None


def digit_templates():
    """Binary templates for 0-9 from the best available font."""
    global _DIGIT_TEMPLATES
    if _DIGIT_TEMPLATES is not None:
        return _DIGIT_TEMPLATES
    from PIL import ImageFont, ImageDraw
    out = {}
    used = []
    for fp in template_font_paths():
        try:
            font = ImageFont.truetype(fp, 48)
            for size in (40, 44, 48, 52, 56):
                font = ImageFont.truetype(fp, size)
                for d in '0123456789':
                    img = Image.new('L', (120, 120), 0)
                    ImageDraw.Draw(img).text((10, 10), d, fill=255, font=font)
                    a = np.asarray(img)
                    ys, xs = np.nonzero(a > 40)
                    if len(ys) == 0:
                        continue
                    m = (a[ys.min():ys.max() + 1, xs.min():xs.max() + 1] > 110)
                    out.setdefault(d, []).append(_norm_digit(m).astype(np.uint8))
            used.append(Path(fp).name)
        except Exception:
            continue
    _DIGIT_TEMPLATES = {'templates': out, 'font': '+'.join(used),
                        'fonts': used}
    return _DIGIT_TEMPLATES


def classify_digit(mask, templates):
    q = _norm_digit(mask)
    scores = []
    for d, ts in templates.items():
        s = max(float((q & t).sum()) / max(float((q | t).sum()), 1) for t in ts)
        scores.append((s, d))
    scores.sort(reverse=True)
    if len(scores) > 1 and {scores[0][1], scores[1][1]} == {'2', '3'} \
            and scores[0][0] - scores[1][0] < 0.15:
        # A damaged 3 can lose its upper-left bowl and read as 2. The
        # lower-right bowl is the discriminator: a 3 keeps right-side
        # ink low in the glyph, a 2 does not.
        lr = float(q[16:32, 15:24].mean())
        ll = float(q[16:32, 0:9].mean())
        if lr >= 0.40 and ll <= 0.36:
            return '3', scores[0][0]
    return scores[0][1], scores[0][0]


def raster_tab_events(u8):
    """Fret digits and strings from the rendered page (no text layer).

    Tuned for the clean-scan case: strongly dark pixels isolate digits
    from grey staff lines; a long horizontal opening removes the line
    core; components are filtered and measured RELATIVE TO THE STAFF
    GAP. Multi-digit frets are grouped on the same string line. A
    system-opening TAB clef is excluded from the first measure.
    """
    import cv2
    otsu = otsu_threshold(u8)
    thr = max(45, min(120, int(round(0.62 * otsu))))
    ink = (u8 <= thr).astype(np.uint8)
    bands = line_bands(u8, thr=otsu)
    groups = band_clusters(bands, min_lines=5)
    if len(groups) < 2:
        return [], [], {}, {'reason': 'no multi-line staff groups'}
    gap_med = float(np.median([g['gap'] for g in groups]))
    hk = cv2.getStructuringElement(cv2.MORPH_RECT, (max(30, int(2.5 * gap_med)), 1))
    lines = cv2.morphologyEx(ink, cv2.MORPH_OPEN, hk)
    close_h = max(3, int(0.15 * gap_med))
    clean = cv2.morphologyEx(ink - lines, cv2.MORPH_CLOSE,
                             cv2.getStructuringElement(cv2.MORPH_RECT, (1, close_h)))
    n, lab, stats, cent = cv2.connectedComponentsWithStats(clean, 8)

    def comps_in(g, top, bot, gap):
        out = []
        for i in range(1, n):
            x, y, w, h, a = stats[i]
            cx, cy = cent[i]
            string = int(round((cy - top) / gap)) + 1
            if not (top - 0.6 * gap <= cy <= bot + 0.6 * gap and 1 <= string <= 6):
                continue
            if not (0.30 * gap <= h <= 0.85 * gap and 0.10 * gap <= w <= 0.65 * gap):
                continue
            if not (15 <= a <= 600 and 0.25 <= w / max(h, 1) <= 1.5):
                continue
            out.append({'i': i, 'x': x, 'y': y, 'w': w, 'h': h,
                        'cx': cx, 'cy': cy, 'string': string})
        return out

    # TAB staves are the groups with digit-like component support.
    candidates = []
    for g in groups:
        cs = comps_in(g, g['top'], g['bot'], g['gap'])
        if len(cs) >= 6:
            candidates.append((len(cs), g, cs))
    if not candidates:
        return [], [], {}, {'reason': 'no digit support on any staff'}
    candidates.sort(key=lambda c: -c[0])
    staves = []
    for cnt, g, cs in candidates:
        if not any(abs(g['top'] - s['top']) < 2 * g['gap'] for s in staves):
            staves.append(g)
    staves.sort(key=lambda g: g['top'])

    tpl = digit_templates()
    if not tpl['templates']:
        return [], [], {}, {'reason': 'no digit template font available'}

    events = []
    all_digit_widths = []
    for si, g in enumerate(staves):
        top, bot, gap = g['top'], g['bot'], g['gap']
        comps = []
        for c in comps_in(g, top, bot, gap):
            d, s = classify_digit(lab[c['y']:c['y'] + c['h'],
                                       c['x']:c['x'] + c['w']] == c['i'],
                                  tpl['templates'])
            c['d'] = d
            c['score'] = s
            comps.append(c)
        comps.sort(key=lambda c: (c['string'], c['x']))
        all_digit_widths.extend(c['w'] for c in comps)
        groups_c = []
        for c in comps:
            if groups_c and groups_c[-1][0]['string'] == c['string'] and \
                    c['x'] - (groups_c[-1][-1]['x'] + groups_c[-1][-1]['w']) < 0.55 * gap:
                groups_c[-1].append(c)
            else:
                groups_c.append([c])
        for grp in groups_c:
            grp.sort(key=lambda c: c['x'])
            fret_s = ''.join(c['d'] for c in grp)
            if not fret_s.isdigit():
                continue
            fret = int(fret_s)
            if not (0 <= fret <= 24):
                continue
            events.append({'staff': si, 'string': grp[0]['string'],
                           'fret': fret,
                           'x': float(np.mean([c['cx'] for c in grp])),
                           'y': float(np.mean([c['cy'] for c in grp])),
                           'digits': [c['d'] for c in grp],
                           'digit_score': min(c['score'] for c in grp)})

    barlines = {}
    for si, g in enumerate(staves):
        raw = staff_barlines(u8, g)
        merged = []
        for b in raw:
            if not merged or b - merged[-1] > max(15, 0.75 * g['gap']):
                merged.append(b)
        barlines[si] = merged
    per = [max(1, len(barlines[i]) - 1) for i in range(len(staves))]
    off, acc = [], 0
    for p in per:
        off.append(acc)
        acc += p
    for e in events:
        e['measure'] = off[e['staff']] + max(
            1, int(__import__('bisect').bisect_left(barlines[e['staff']], e['x'])))
    # The system-opening TAB clef (letters T/A/B) sits in the first
    # measure; its fragments can look like digits. Real first onsets
    # begin after the clef.
    events = [e for e in events
              if not (e['measure'] == off[e['staff']] + 1 and
                      e['x'] < barlines[e['staff']][0] + 2.5 * staves[e['staff']]['gap'])]
    events.sort(key=lambda e: (e['staff'], e['measure'], e['x'], e['string']))
    stats_out = {'tab_source': 'raster', 'digit_font': tpl['font'],
                 'digit_threshold': thr,
                 'notation_threshold': max(128, min(200, int(0.8 * otsu))),
                 'digit_width': float(np.median(all_digit_widths)) if all_digit_widths else None,
                 'raster_events': len(events),
                 'raster_staves': len(staves)}
    return staves, barlines, events, stats_out


def attach_rhythm(events, items, staves, ink, beam_mask, rhy,
                  default_time=(4, 4), bands=None, digit_width=None):
    """Attach onset durations derived from actual notation evidence.

    Evidence chain: SMuFL notehead glyph (written value) -> raster stem
    and beam count (shorter values) -> augmentation dots. Dots are
    accepted only when the dotted reading makes the measure sum to the
    time signature; a dotted reading that breaks the measure is rejected
    in favour of the plain one, because stray blobs are common.

    An onset with no notehead, no stem, or a measure that does not sum is
    marked `confident = False`. Nothing is silently defaulted.
    """
    ts, ts_source = time_signature(items, default_time)
    beats = ts[0] * 4.0 / ts[1]
    noteheads = notation_noteheads(items)
    notehead_source = 'smufl-glyphs' if noteheads else 'none'
    if not noteheads and bands is not None:
        # Raster fallback: recognise filled noteheads from the rendered
        # page. This is the path for PDFs whose notation is drawn as
        # vector paths or a bitmap instead of SMuFL text.
        regions = notation_regions(bands, staves)
        for si, st in enumerate(staves):
            reg = regions.get(si)
            if reg is None:
                continue
            noteheads.extend(raster_noteheads(ink, reg[0], reg[1],
                                              st['gap'], staff_hint=si))
        if noteheads:
            notehead_source = 'raster'
    rests = notation_rests(items)

    staff_rows = ink.sum(axis=1) > 0.35 * ink.shape[1]
    widths = [it['bbox'][2] - it['bbox'][0] for it in items
              if (it.get('text') or '').strip().isdigit()]
    if widths:
        digit_width = float(np.median(widths))
    elif not digit_width:
        digit_width = 10.0

    note_by_staff = assign_notation_to_staves(noteheads, staves)
    rest_by_staff = assign_notation_to_staves(rests, staves)

    onsets = tab_onsets(events, digit_width)
    by_staff = {}
    for o in onsets:
        by_staff.setdefault(o['staff'], []).append(o)

    raw = {}
    staff_pairing = []
    for si, os_ in by_staff.items():
        cols = notehead_columns(note_by_staff.get(si, []))
        # Stems are a musical length, not a pixel count: require ~1.6
        # staff spaces. The absolute MIN_STEM_RUN is tuned for a 2px
        # stroke at one DPI and rejects genuine 1px stems on crisp pages.
        min_run = 1.6 * float(staves[si]['gap'])
        flag_min_ink = max(4, int(round(0.3 * float(staves[si]['gap']))))
        # Bound the stem search by the column spacing. Dense eighth-note
        # chords sit ~17px apart; an unbounded +/-16px probe lets a chord
        # borrow its neighbour's stem (and flag/beam evidence).
        for i, c in enumerate(cols):
            gaps = []
            if i:
                gaps.append(c['cx'] - cols[i - 1]['cx'])
            if i + 1 < len(cols):
                gaps.append(cols[i + 1]['cx'] - c['cx'])
            if notehead_source == 'raster':
                # Raster boxes are eroded cores, so the stem sits a few
                # pixels outside them. Bound the search by BOTH the staff
                # scale and the distance to the next onset, so a chord
                # cannot borrow a neighbour's stem.
                lim = min(gaps + [float(staves[si]['gap'])])
                c['side_tol'] = max(3.0, min(16.0, 0.45 * lim))
            else:
                c['side_tol'] = (max(3.0, min(float(rhy.STEM_SIDE_TOL), 0.45 * min(gaps)))
                                 if gaps else float(rhy.STEM_SIDE_TOL))
        # Pair onsets to columns. Equal counts is the common, exact case:
        # both are left-to-right sequences of the same musical events.
        pair = {}
        exact = len(os_) == len(cols)
        if exact:
            for o, c in zip(os_, cols):
                pair[id(o)] = c
        else:
            cap = max(8.0, 2.5 * digit_width)
            used = set()
            for o in os_:
                best, bd = None, cap
                for i, c in enumerate(cols):
                    if i in used:
                        continue
                    d = abs(c['cx'] - o['x'])
                    if d <= bd:
                        best, bd = i, d
                if best is not None:
                    used.add(best)
                    pair[id(o)] = cols[best]
        for o in os_:
            col = pair.get(id(o))
            if col is None:
                raw[(o['staff'], o['measure'], round(o['x'], 2))] = {
                    'duration': None, 'duration_plain': None, 'beams': 0,
                    'dots': 0, 'stem': False, 'confident': False,
                    'ambiguous': False,
                }
                continue
            ev = _column_evidence(col, ink, beam_mask, rhy, min_run,
                                  col.get('side_tol'), staff_rows, flag_min_ink)
            r = _duration_from_evidence(col, ev)
            if not exact:
                # A greedy pairing across unequal counts is a guess about
                # which notehead belongs to which digit. Never let that
                # pass as measured rhythm.
                r['confident'] = False
                r['pairing'] = 'greedy'
            else:
                r['pairing'] = 'exact'
            raw[(o['staff'], o['measure'], round(o['x'], 2))] = r
        staff_pairing.append({
            'staff': si, 'onsets': len(os_), 'columns': len(cols),
            'exact': exact, 'delta': len(cols) - len(os_),
            'reason': ('exact' if exact else
                       ('extra-notation-events (multi-voice or second staff)'
                        if len(cols) > len(os_) else
                        'missing-notation-events')),
        })
        # keep the pairing for the event objects
        for o in os_:
            o['column'] = pair.get(id(o))

    # Measure validation: a dotted reading must explain the measure.
    by_measure = {}
    for o in onsets:
        by_measure.setdefault(o['measure'], []).append(o)
    measure_report = {}
    for m, os_ in sorted(by_measure.items()):
        keys = [(o['staff'], m, round(o['x'], 2)) for o in os_]
        plain = sum(raw[k]['duration_plain'] or 0.0 for k in keys)
        dotted = sum((raw[k]['duration_plain'] or 0.0)
                     * (1.5 ** min(raw[k]['dots'], 2)) for k in keys)
        plain_ok = abs(plain - beats) <= 0.02
        dotted_ok = abs(dotted - beats) <= 0.02
        use_dots = dotted_ok and not plain_ok
        for k in keys:
            r = raw[k]
            if r['duration_plain'] is None:
                continue
            if use_dots and r['dots']:
                r['duration'] = r['duration_plain'] * (1.5 ** min(r['dots'], 2))
            else:
                r['duration'] = r['duration_plain']
                r['dots'] = 0
        total = sum(raw[k]['duration'] or 0.0 for k in keys)
        complete = abs(total - beats) <= 0.02
        if not complete:
            for k in keys:
                raw[k]['confident'] = False
        measure_report[m] = {
            'onsets': len(os_),
            'quarters': round(total, 4),
            'expected': beats,
            'complete': complete,
            'matches_time_signature': complete,
            'dots_applied': sum(1 for k in keys if raw[k]['dots']),
        }

    for o in onsets:
        r = raw[(o['staff'], o['measure'], round(o['x'], 2))]
        for e in o['events']:
            e['rhythm'] = dict(r)
        o['rhythm'] = r

    matched = sum(1 for o in onsets if raw[(o['staff'], o['measure'], round(o['x'], 2))]['duration'] is not None)
    confident = sum(1 for o in onsets if raw[(o['staff'], o['measure'], round(o['x'], 2))]['confident'])
    stats = {
        'time_signature': f'{ts[0]}/{ts[1]}',
        'time_signature_source': ts_source,
        'measure_quarters': beats,
        'noteheads': len(noteheads),
        'notehead_source': notehead_source,
        'rests_detected': len(rests),
        'onsets': len(onsets),
        'onsets_with_notation': matched,
        'onsets_confident': confident,
        'measures_complete': sum(1 for v in measure_report.values() if v['complete']),
        'measures_total': len(measure_report),
        'staff_pairing': staff_pairing,
        'staffs_exact_pairing': sum(1 for p in staff_pairing if p['exact']),
        'voice_ownership': ('single-voice' if staff_pairing and
                            all(p['exact'] for p in staff_pairing)
                            else ('unknown' if notehead_source == 'none'
                                  else 'unresolved-multi-voice')),
        'flags_detected': sum(1 for o in onsets
                              if (raw[(o['staff'], o['measure'], round(o['x'], 2))].get('flags') or 0)),
        'rests_emitted': 0,
        'ties_detected': 0,
        '_onsets': onsets,
        '_rests': {k: v for k, v in rest_by_staff.items()},
        '_measure_report': measure_report,
    }
    return events, stats


# -------------------------------------------------------------- musicxml
TYPE_BASES = [(4.0, 'whole'), (2.0, 'half'), (1.0, 'quarter'),
              (0.5, 'eighth'), (0.25, '16th'), (0.125, '32nd')]


def type_for_quarters(q):
    """Written value -> (MusicXML type, dot count)."""
    if q is None:
        return None, 0
    for base, name in TYPE_BASES:
        for dots in (0, 1, 2):
            if abs(q - base * (1.5 ** dots)) <= 0.011:
                return name, dots
    return None, 0


def _midi_name(midi):
    names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    name = names[midi % 12]
    return name[0], (1 if '#' in name else 0), midi // 12 - 1


def to_musicxml(events, divisions=480, default_duration=480,
                time_sig=(4, 4), rhythm_source='none'):
    """Emit six-line TAB MusicXML.

    Recognised durations are written from the notation evidence. A note
    with no recovered duration keeps a placeholder <duration> (MusicXML
    requires the element) but carries NO <type> and an explicit
    <footnote> plus a score-level miscellaneous field, so no consumer can
    mistake it for measured rhythm.
    """
    score = ET.Element('score-partwise', version='4.0')
    ident = ET.SubElement(score, 'identification')
    misc = ET.SubElement(ident, 'miscellaneous')
    ET.SubElement(misc, 'miscellaneous-field', name='rhythm-source').text = rhythm_source
    ET.SubElement(misc, 'miscellaneous-field', name='rhythm-time-signature').text =         f'{time_sig[0]}/{time_sig[1]}'
    pl = ET.SubElement(score, 'part-list')
    sp = ET.SubElement(pl, 'score-part', id='P1')
    ET.SubElement(sp, 'part-name').text = 'Guitar'
    part = ET.SubElement(score, 'part', id='P1')
    by_measure = {}
    for e in events:
        by_measure.setdefault(e['measure'], []).append(e)
    first_measure = min(by_measure) if by_measure else 1
    for m in sorted(by_measure):
        meas = ET.SubElement(part, 'measure', number=str(m))
        attrs = ET.SubElement(meas, 'attributes')
        ET.SubElement(attrs, 'divisions').text = str(divisions)
        if m == first_measure:
            key = ET.SubElement(attrs, 'key')
            ET.SubElement(key, 'fifths').text = '0'
            time = ET.SubElement(attrs, 'time')
            ET.SubElement(time, 'beats').text = str(time_sig[0])
            ET.SubElement(time, 'beat-type').text = str(time_sig[1])
            clef = ET.SubElement(attrs, 'clef')
            ET.SubElement(clef, 'sign').text = 'TAB'
            ET.SubElement(clef, 'line').text = '5'
            sd = ET.SubElement(attrs, 'staff-details')
            ET.SubElement(sd, 'staff-lines').text = '6'
            for sn in range(1, 7):
                midi = TUNING[sn - 1]
                step, alter, octave = _midi_name(midi)
                st_ = ET.SubElement(sd, 'staff-tuning', number=str(sn))
                ET.SubElement(st_, 'tuning-step').text = step
                if alter:
                    ET.SubElement(st_, 'tuning-alter').text = str(alter)
                ET.SubElement(st_, 'tuning-octave').text = str(octave)
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
            step, alter, octave = _midi_name(midi)
            ET.SubElement(pitch, 'step').text = step
            if alter:
                ET.SubElement(pitch, 'alter').text = str(alter)
            ET.SubElement(pitch, 'octave').text = str(octave)
            rt = e.get('rhythm') or {}
            q = rt.get('duration')
            if q is None:
                ET.SubElement(note, 'duration').text = str(default_duration)
                ET.SubElement(note, 'footnote').text =                     'duration not recovered (declared placeholder, not measured rhythm)'
            else:
                ET.SubElement(note, 'duration').text = str(int(round(q * divisions)))
                if not rt.get('confident'):
                    ET.SubElement(note, 'footnote').text =                         'duration unverified (notation evidence incomplete)'
            ET.SubElement(note, 'voice').text = '1'
            if q is not None:
                name, dots = type_for_quarters(q)
                if name:
                    ET.SubElement(note, 'type').text = name
                    for _ in range(dots):
                        ET.SubElement(note, 'dot')
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
    # Scanned/image PDFs have no text layer. Digit OCR needs resolution,
    # so re-render such pages at 300dpi (the vector path is untouched).
    if not ex['items'] and args.dpi < 300:
        ex = extract(args.pdf, png, 300, args.page)
        if 'error' in ex:
            print('extract failed:', ex['error'])
            return 2
        args.dpi = 300
    u8 = np.asarray(Image.open(png).convert('L')).astype(np.uint8)
    tab_source = 'text-layer'
    raster_info = {}
    if not ex['items']:
        # No text at all: raster TAB digits + raster notation rhythm.
        staves, barlines, events, raster_info = raster_tab_events(u8)
        tab_source = 'raster'
        # Digits need a strict dark threshold; notation heads/stems are
        # anti-aliased and need the page's ink threshold.
        thr_used = int(raster_info.get('notation_threshold', 128))
        bands = line_bands(u8, thr=otsu_threshold(u8))
        if not staves:
            # keep the honest abstention path (no events)
            events = []
            barlines = {}
    else:
        staves, thr_used = find_staves(u8)
        bands = line_bands(u8, thr=thr_used)
        digits = dominant_digit_group(digit_shape_items(ex['items']))
        staves = filter_staves_by_digits(staves, digits)
        barlines = {i: staff_barlines(u8, s) for i, s in enumerate(staves)}
        events = assign_events(ex['items'], staves, barlines, u8.shape[1], u8.shape[0])
    # RHYTHM: notation-side evidence (SMuFL glyphs + raster stems/beams)
    ts, ts_source = time_signature(ex['items'])
    rhythm_stats = {'noteheads': 0, 'rests_detected': 0, 'onsets': 0,
                    'onsets_with_notation': 0, 'onsets_confident': 0,
                    'time_signature': f'{ts[0]}/{ts[1]}',
                    'time_signature_source': ts_source,
                    'measure_quarters': ts[0] * 4.0 / ts[1],
                    'measures_complete': 0, 'measures_total': 0,
                    'flags_detected': 0,
                    'rests_emitted': 0, 'ties_detected': 0}
    try:
        _rhy = _load_mod('proof_rhythm_graph', 'proof-rhythm-graph.py')
        # Use the SAME threshold that found the staff. A grey-stroke PDF
        # detected via the Otsu fallback has stems invisible at <128, and
        # mixing thresholds silently loses all stem evidence.
        _ink = u8 <= thr_used
        _, _bmask = _rhy.detect_stems_beams(u8)
        events, rhythm_stats = attach_rhythm(
            events, ex['items'], staves, _ink, _bmask, _rhy, bands=bands,
            digit_width=raster_info.get('digit_width'))
        rhythm_stats.pop('_onsets', None)
        rhythm_stats.pop('_rests', None)
        rhythm_stats.pop('_measure_report', None)
    except Exception as _e:
        rhythm_stats['error'] = f'{type(_e).__name__}: {_e}'
    recovered = (rhythm_stats.get('onsets', 0) > 0 and
                 rhythm_stats.get('onsets_with_notation') == rhythm_stats.get('onsets') and
                 rhythm_stats.get('staffs_exact_pairing') == len(rhythm_stats.get('staff_pairing', [])) and
                 rhythm_stats.get('measures_total', 0) > 0 and
                 rhythm_stats.get('measures_complete') == rhythm_stats.get('measures_total'))
    blockers = []
    if not staves:
        if len(ex['items']) == 0:
            blockers.append('no PDF text layer (scanned/image PDF); '
                            'raster TAB digit recognition required')
        else:
            blockers.append('no six-line TAB staff with digit support')
    elif rhythm_stats.get('notehead_source') in (None, 'none'):
        blockers.append('no notation noteheads above the TAB (TAB-only '
                        'layout; rhythm-slash recognition not implemented)')
    elif rhythm_stats.get('staffs_exact_pairing') != len(rhythm_stats.get('staff_pairing', [])):
        blockers.append('notation/TAB onset counts differ per system '
                        '(multi-voice or partial notation)')
    elif rhythm_stats.get('onsets_with_notation') != rhythm_stats.get('onsets'):
        blockers.append('TAB onsets without a notation counterpart')
    elif rhythm_stats.get('measures_total', 0) and \
            rhythm_stats.get('measures_complete') != rhythm_stats.get('measures_total'):
        blockers.append('measure duration validation failed')
    summary = {
        'pdf': args.pdf, 'page': args.page, 'dpi': args.dpi,
        'text_items': len(ex['items']),
        'tab_source': tab_source,
        'raster': raster_info,
        'staff_bands': len(bands),
        'tab_staves': staves,
        'barlines_per_staff': {str(k): v for k, v in barlines.items()},
        'events': len(events),
        'events_by_measure': {str(m): sum(1 for e in events if e['measure'] == m)
                              for m in sorted({e['measure'] for e in events})},
        'rhythm_recovered': bool(recovered),
        'rhythm_blockers': blockers,
        'playable': bool(recovered),
        'rhythm_stats': rhythm_stats,
        'rhythm_note': ('durations derived from SMuFL notehead glyphs + '
                        'raster stems/beams and validated against the time '
                        'signature' if recovered
                        else 'rhythm not fully recovered from notation; '
                             'unmeasured durations are explicit placeholders, '
                             'not recognised timing'),
    }
    (out / f'p{args.page}-summary.json').write_text(json.dumps(summary, indent=1))
    (out / f'p{args.page}-events.json').write_text(json.dumps(events, indent=1))
    xml = to_musicxml(events, time_sig=ts,
                      rhythm_source=('smufl-notehead+stem/beam' if recovered
                                     else 'unrecovered-placeholder'))
    ET.ElementTree(xml).write(out / f'p{args.page}-tab.musicxml', encoding='utf-8', xml_declaration=True)
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
