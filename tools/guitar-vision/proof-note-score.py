"""Score transcribed notes (string/fret/measure) against GT TAB digits.

Matches each transcribed note to the nearest GT tab-text box on the same
page (tolerance 25 image-px), then compares string, fret, and canonical
measure. Reports playable-note accuracy as a fraction of ALL GT digits
(detection misses count against) and of transcribed notes.
"""
import json, os, re, sys
from collections import Counter

W = os.path.expanduser('~/Documents/scoreflow-guitar')

def main():
    notes_path, sample = sys.argv[1], sys.argv[2]
    notes = json.load(open(notes_path))
    w = next(d for d in json.load(open('/tmp/proof/workdirs.json')) if d.endswith('/' + sample))
    joins = json.load(open(os.path.join(W, w, 'joins.json')))
    canon = json.load(open(os.path.join(W, w, 'canonical.json')))
    man = json.load(open(f'/tmp/proof/hires/{sample}-manifest.json'))
    links = {}
    for e in canon['events']:
        m = re.search(r"-n(\d+)$", (e.get('source') or {}).get('noteId') or '')
        if m:
            links[f"{sample}-n{int(m.group(1)) + 1:03d}"] = e
    gt = []  # (page, cx, cy, string, fret, measure)
    for sid, v in joins['joins'].items():
        if 'tab-text' not in (v.get('children') or []):
            continue
        e = links.get(sid)
        if not e:
            continue
        pg = v.get('page', 1)
        m = man[f'page{pg}']
        sx = None
        # notes_out x is image px; convert GT render->image via manifest
        fx = m['cssWidth'] / m['viewBox'][0]
        fy = m['height'] / m['viewBox'][1]
        for b in v.get('boxes', []):
            gt.append((pg, (b[0] + b[2]) / 2 * fx, (b[1] + b[3]) / 2 * fy,
                       (e.get('tab') or {}).get('string'), (e.get('tab') or {}).get('fret'),
                       (e.get('source') or {}).get('measure')))
    used = set()
    res = Counter()
    for n in notes:
        best, bd = None, 30.0
        for i, g in enumerate(gt):
            if g[0] != n['page'] or i in used:
                continue
            d = ((g[1] - n['x']) ** 2 + (g[2] - n.get('y', g[2])) ** 2) ** 0.5
            if d < bd:
                best, bd = i, d
        if best is None:
            res['unmatched'] += 1
            continue
        used.add(best)
        g = gt[best]
        ok_s = g[3] == n['string']
        ok_f = g[4] == n['fret']
        ok_m = g[5] == n['measure']
        res['string_ok'] += ok_s
        res['fret_ok'] += ok_f
        res['measure_ok'] += ok_m
        res['both_ok'] += (ok_s and ok_f)
        res['triple_ok'] += (ok_s and ok_f and ok_m)
        res['matched'] += 1
    print(f'sample={sample} gtDigits={len(gt)} transcribed={len(notes)} matched={res["matched"]} unmatched={res["unmatched"]}')
    for k in ['string_ok', 'fret_ok', 'measure_ok', 'both_ok', 'triple_ok']:
        print(f'  {k}: {res[k]} = {res[k]/max(1,len(gt)):.3f} of GT, {res[k]/max(1,res["matched"]):.3f} of matched')

main()
