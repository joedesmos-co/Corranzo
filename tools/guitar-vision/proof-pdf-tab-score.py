"""Score PDF-TAB events against a reference MusicXML (evaluation only).

Two independent axes are measured, because a recogniser can be right
about pitch and wrong about time:

  string/fret   multiset of (string, fret) per measure (existing metric)
  timing        onset position, onset duration, and complete events
                (position + duration + chord content)

Reference onsets are derived from <duration>, <chord>, <backup>,
<forward> and rests. Predicted onsets are grouped by shared x and their
positions come from the recovered durations, so a wrong early duration
correctly shifts every later onset in that measure.

A measure whose predicted durations are unrecovered contributes timing
false negatives, never free credit.

Usage:
  python3 tools/guitar-vision/proof-pdf-tab-score.py \
      --events EVENTS.json --ref REF.musicxml [--json OUT]
"""
import argparse, json, sys
from collections import Counter
import xml.etree.ElementTree as ET


def _sf(note):
    tech = note.find('notations/technical')
    if tech is None:
        return None
    s, f = tech.find('string'), tech.find('fret')
    if s is None or f is None:
        return None
    return (int(s.text), int(f.text))


def ref_onsets(path):
    """Reference onsets per measure with musical positions in quarters."""
    root = ET.parse(path).getroot()
    part = list(root.iter('part'))[0]
    divisions = 1
    beats = None
    by_measure = {}
    rests = []
    ties = 0
    for m in part.iter('measure'):
        mn = int(m.get('number'))
        t = 0
        cur = None
        out = []
        for el in m:
            if el.tag == 'attributes':
                d = el.find('divisions')
                if d is not None:
                    divisions = int(d.text)
                ts = el.find('time')
                if ts is not None:
                    beats = (int(ts.find('beats').text) * 4.0 /
                             int(ts.find('beat-type').text))
            elif el.tag == 'backup':
                t -= int(el.find('duration').text)
                cur = None
            elif el.tag == 'forward':
                t += int(el.find('duration').text)
                cur = None
            elif el.tag == 'note':
                dur = int(el.find('duration').text or 0)
                if el.find('rest') is not None:
                    rests.append({'measure': mn, 'pos': t / divisions,
                                  'dur': dur / divisions})
                    t += dur
                    cur = None
                    continue
                sf = _sf(el)
                if el.find('chord') is not None and cur is not None:
                    if sf:
                        cur['notes'][sf] += 1
                else:
                    cur = {'pos': t / divisions, 'dur': dur / divisions,
                           'notes': Counter()}
                    if sf:
                        cur['notes'][sf] += 1
                    out.append(cur)
                    t += dur
                ties += 1 if el.find('tie') is not None else 0
        out.sort(key=lambda o: o['pos'])
        by_measure[mn] = out
    return by_measure, beats, rests, ties, divisions


def pred_onsets(events):
    """Predicted onsets per measure: shared x -> one onset."""
    groups = {}
    for e in events:
        groups.setdefault(e['measure'], []).append(e)
    by_measure = {}
    for m, evs in groups.items():
        evs.sort(key=lambda e: (e['x'], e['string']))
        onsets = []
        cur = [evs[0]]
        for e in evs[1:]:
            if abs(e['x'] - cur[-1]['x']) <= 1.5:
                cur.append(e)
            else:
                onsets.append(cur)
                cur = [e]
        onsets.append(cur)
        out = []
        t = 0.0
        timing_known = True
        for grp in onsets:
            dur = (grp[0].get('rhythm') or {}).get('duration')
            notes = Counter((e['string'], e['fret']) for e in grp)
            out.append({'pos': t if timing_known and dur is not None else None,
                        'dur': dur, 'notes': notes})
            if dur is None:
                timing_known = False
            else:
                t += dur
        by_measure[m] = out
    return by_measure


def _prf(tp, fp, fn):
    p = tp / max(tp + fp, 1)
    r = tp / max(tp + fn, 1)
    f1 = 2 * p * r / max(p + r, 1e-9)
    return round(p, 4), round(r, 4), round(f1, 4)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--events', required=True)
    ap.add_argument('--ref', required=True)
    ap.add_argument('--json', default=None)
    args = ap.parse_args()
    pred = json.loads(open(args.events).read())
    ref_by, beats, ref_rests, ref_ties, _div = ref_onsets(args.ref)
    pred_by = pred_onsets(pred)

    # ---- string/fret (unchanged metric, kept for regression safety)
    def by_meas(evs):
        d = {}
        for e in evs:
            d.setdefault(e['measure'], []).append(e)
        return d
    p_by = by_meas(pred)

    tot_tp = tot_fp = tot_fn = 0
    meas_ok = 0
    per = {}
    for m in sorted(set(p_by) | set(ref_by)):
        P = Counter((e['string'], e['fret']) for e in p_by.get(m, []))
        R = Counter()
        for o in ref_by.get(m, []):
            R.update(o['notes'])
        tp = sum((P & R).values())
        fp = sum(P.values()) - tp
        fn = sum(R.values()) - tp
        tot_tp += tp; tot_fp += fp; tot_fn += fn
        if P == R:
            meas_ok += 1
        per[m] = {'tp': tp, 'fp': fp, 'fn': fn,
                  'pred': sum(P.values()), 'ref': sum(R.values())}

    P_, R_, F1_ = _prf(tot_tp, tot_fp, tot_fn)

    # ---- timing
    ref_onset_n = sum(len(v) for v in ref_by.values())
    pred_onset_n = sum(len(v) for v in pred_by.values())
    onset_tp = onset_fp = onset_fn = 0
    dur_tp = dur_fp = dur_fn = 0
    comp_tp = comp_fp = comp_fn = 0
    measures_valid = 0
    measures_timing = 0
    per_measure_timing = {}
    for m in sorted(set(ref_by) | set(pred_by)):
        R = ref_by.get(m, [])
        P = pred_by.get(m, [])
        rpos = {round(o['pos'], 3): o for o in R}
        ppos = {round(o['pos'], 3): o for o in P if o['pos'] is not None}
        inter = set(rpos) & set(ppos)
        o_tp = len(inter)
        o_fp = len(ppos) - o_tp
        o_fn = len(R) - o_tp
        onset_tp += o_tp; onset_fp += o_fp; onset_fn += o_fn
        d_tp = d_fp = d_fn = 0
        c_tp = c_fp = c_fn = 0
        for pos in inter:
            ro, po = rpos[pos], ppos[pos]
            dur_ok = (po['dur'] is not None and
                      abs(ro['dur'] - po['dur']) <= 1e-6)
            notes_ok = ro['notes'] == po['notes']
            if dur_ok:
                d_tp += 1
            else:
                d_fp += 1; d_fn += 1
            if dur_ok and notes_ok:
                c_tp += 1
            else:
                c_fp += 1; c_fn += 1
        # unmatched predicted onsets are also timing FP/FN for duration+event
        d_fp += o_fp; d_fn += o_fn
        c_fp += o_fp; c_fn += o_fn
        dur_tp += d_tp; dur_fp += d_fp; dur_fn += d_fn
        comp_tp += c_tp; comp_fp += c_fp; comp_fn += c_fn
        known = all(o['dur'] is not None for o in P) and len(P) > 0
        total = sum(o['dur'] for o in P if o['dur'] is not None)
        valid = bool(known and beats is not None and abs(total - beats) <= 0.02)
        if known:
            measures_timing += 1
        if valid:
            measures_valid += 1
        per_measure_timing[m] = {
            'onsets_ref': len(R), 'onsets_pred': len(P),
            'onset_tp': o_tp, 'duration_tp': d_tp, 'complete_tp': c_tp,
            'pred_quarters': round(total, 3) if known else None,
            'expected_quarters': beats, 'measure_valid': valid,
        }

    op, orr, of1 = _prf(onset_tp, onset_fp, onset_fn)
    dp, dr, df1 = _prf(dur_tp, dur_fp, dur_fn)
    cp, cr, cf1 = _prf(comp_tp, comp_fp, comp_fn)
    res = {
        'events_pred': len(pred), 'events_ref': sum(p['ref'] for p in per.values()),
        'exact_string_fret_tp': tot_tp, 'fp': tot_fp, 'fn': tot_fn,
        'precision': P_, 'recall': R_, 'f1': F1_,
        'measures_pred': len(p_by), 'measures_ref': len(ref_by),
        'measures_exact': meas_ok,
        'measure_exactness': round(meas_ok / max(len(set(p_by) | set(ref_by)), 1), 4),
        'timing': {
            'ref_onsets': ref_onset_n, 'pred_onsets': pred_onset_n,
            'onset_tp': onset_tp, 'onset_fp': onset_fp, 'onset_fn': onset_fn,
            'onset_precision': op, 'onset_recall': orr, 'onset_f1': of1,
            'duration_tp': dur_tp, 'duration_fp': dur_fp, 'duration_fn': dur_fn,
            'duration_precision': dp, 'duration_recall': dr, 'duration_f1': df1,
            'complete_tp': comp_tp, 'complete_fp': comp_fp, 'complete_fn': comp_fn,
            'complete_precision': cp, 'complete_recall': cr, 'complete_f1': cf1,
            'measures_with_recovered_timing': measures_timing,
            'measures_valid': measures_valid,
            'ref_rests': len(ref_rests), 'pred_rests': 0,
            'missing_rests': len(ref_rests),
            'ref_ties': ref_ties, 'pred_ties': 0,
        },
        'per_measure': per,
        'per_measure_timing': per_measure_timing,
    }
    print(json.dumps({k: v for k, v in res.items()
                      if k not in ('per_measure', 'per_measure_timing')}, indent=1))
    print('per measure:', {m: (v['tp'], v['fp'], v['fn']) for m, v in per.items()})
    if args.json:
        open(args.json, 'w').write(json.dumps(res, indent=1))


if __name__ == '__main__':
    main()
