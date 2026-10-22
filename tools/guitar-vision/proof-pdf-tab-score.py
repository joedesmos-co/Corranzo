"""Score PDF-TAB events against a reference MusicXML (evaluation only).

Matching: within each measure, both sequences are ordered by (x or document
order), then matched by multiset of (string, fret). Reports exact-event
precision/recall (counted against ALL reference notes), measure accuracy,
and per-measure breakdown.

Usage:
  python3 tools/guitar-vision/proof-pdf-tab-score.py \
      --events EVENTS.json --ref REF.musicxml [--json OUT]
"""
import argparse, json, sys
from collections import Counter
import xml.etree.ElementTree as ET


def ref_events(path):
    root = ET.parse(path).getroot()
    part = list(root.iter('part'))[0]
    out = []
    for m in part.iter('measure'):
        mn = int(m.get('number'))
        for note in m.iter('note'):
            tech = note.find('notations/technical')
            if tech is None:
                continue
            s = tech.find('string')
            f = tech.find('fret')
            if s is None or f is None:
                continue
            out.append({'measure': mn, 'string': int(s.text), 'fret': int(f.text)})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--events', required=True)
    ap.add_argument('--ref', required=True)
    ap.add_argument('--json', default=None)
    args = ap.parse_args()
    pred = json.loads(open(args.events).read())
    ref = ref_events(args.ref)

    # group by measure, keep order
    def by_meas(evs):
        d = {}
        for e in evs:
            d.setdefault(e['measure'], []).append(e)
        return d
    p_by = by_meas(pred)
    r_by = by_meas(ref)

    tot_tp = tot_fp = tot_fn = 0
    meas_ok = 0
    per = {}
    for m in sorted(set(p_by) | set(r_by)):
        P = Counter((e['string'], e['fret']) for e in p_by.get(m, []))
        R = Counter((e['string'], e['fret']) for e in r_by.get(m, []))
        tp = sum((P & R).values())
        fp = sum(P.values()) - tp
        fn = sum(R.values()) - tp
        tot_tp += tp; tot_fp += fp; tot_fn += fn
        if P == R:
            meas_ok += 1
        per[m] = {'tp': tp, 'fp': fp, 'fn': fn,
                  'pred': sum(P.values()), 'ref': sum(R.values())}

    P = tot_tp / max(tot_tp + tot_fp, 1)
    R = tot_tp / max(tot_tp + tot_fn, 1)
    F1 = 2 * P * R / max(P + R, 1e-9)
    res = {
        'events_pred': len(pred), 'events_ref': len(ref),
        'exact_string_fret_tp': tot_tp, 'fp': tot_fp, 'fn': tot_fn,
        'precision': round(P, 4), 'recall': round(R, 4), 'f1': round(F1, 4),
        'measures_pred': len(p_by), 'measures_ref': len(r_by),
        'measures_exact': meas_ok,
        'measure_exactness': round(meas_ok / max(len(set(p_by) | set(r_by)), 1), 4),
        'per_measure': per,
    }
    print(json.dumps({k: v for k, v in res.items() if k != 'per_measure'}, indent=1))
    print('per measure:', {m: (v['tp'], v['fp'], v['fn']) for m, v in per.items()})
    if args.json:
        open(args.json, 'w').write(json.dumps(res, indent=1))


if __name__ == '__main__':
    main()
