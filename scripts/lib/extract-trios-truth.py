#!/usr/bin/env python3
"""Extract TRIOS MIDI truth to JSON (notes per part + combined mix truth).

TRIOS data: CC BY-NC-SA 2.0 UK (local eval only, never redistributed).
Usage: extract-trios-truth.py <trios-dir> <out-json>
"""
import glob
import json
import os
import sys

import pretty_midi

trios_dir = sys.argv[1]
out_path = sys.argv[2]
takes = {}
DRUM_PARTS = {'kick', 'snare', 'ride'}

for take in ['mozart', 'schubert', 'brahms', 'lussier', 'take_five']:
    take_dir = os.path.join(trios_dir, take)
    if not os.path.isdir(take_dir):
        continue
    parts = {}
    combined = []
    for mid_path in sorted(glob.glob(os.path.join(take_dir, '*.mid'))):
        part = os.path.basename(mid_path)[:-4]
        try:
            m = pretty_midi.PrettyMIDI(mid_path)
        except Exception as exc:  # noqa: BLE001 - report and continue
            print(f'skip {mid_path}: {exc}', file=sys.stderr)
            continue
        notes = []
        for inst in m.instruments:
            for n in inst.notes:
                if n.pitch < 21 or n.pitch > 108:
                    continue
                notes.append({'midi': int(n.pitch), 'onset': round(float(n.start), 3),
                              'offset': round(float(n.end), 3)})
        notes.sort(key=lambda n: n['onset'])
        parts[part] = {'notes': notes, 'duration': round(m.get_end_time(), 2)}
        # Drum parts are truth for rhythm only; arrangement melody/harmony
        # metrics must not penalize untranscribed kick/snare/ride.
        if part not in DRUM_PARTS:
            combined.extend(notes)
    combined.sort(key=lambda n: n['onset'])
    mix_wav = os.path.join(take_dir, 'mix.wav')
    takes[take] = {'parts': parts, 'mix': {'notes': combined, 'audio': mix_wav}}
    print(f'{take}: parts={list(parts.keys())} mix_notes={len(combined)}')

with open(out_path, 'w', encoding='utf-8') as fh:
    json.dump({'takes': takes}, fh)
print(f'wrote {out_path}')
