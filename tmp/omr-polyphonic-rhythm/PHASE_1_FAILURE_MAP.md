# Phase 1 — Joint polyphonic rhythm failure map

- Commit: `7d4d5df`
- Frozen evaluator: 2.0.0 / schema 2
- Frozen fixtures executed: 9/9
- Representative measures: 12
- Production code changed during Phase 1: **no**

## Ranked observed mechanisms

| Rank | Mechanism | Mismatches explained | Fixtures | Measures | Evidence | Regression risk |
|---:|---|---:|---:|---:|---|---|
| 1 | stem/beam evidence lost before duration assignment | 158 | 5 | 11 | high | high |
| 2 | voices packed as one shared sequence | 130 | 3 | 8 | high | high |
| 3 | one voice spacing stretches another voice durations | 100 | 2 | 6 | high | high |
| 4 | onset alignment error masquerading as missing/extra notes | 95 | 2 | 3 | high | medium |
| 5 | sustained voice steals timing capacity from moving voice | 44 | 2 | 6 | medium-high | high |
| 6 | missing rests cause onset collapse | 14 | 1 | 3 | high | high |
| 7 | chords split during voice packing | 0 | 0 | 0 | not observed | high |
| 8 | meter overflow triggers destructive resnapping | 0 | 0 | 0 | not observed | high |

Counts are the event/chord mismatches in the representative trace set. Mechanisms overlap because one bad shared timeline can create onset, duration, and missing/extra symptoms together.

## Frozen-corpus coverage

| Fixture | Deep measure trace | Reason |
|---|---|---|
| piano-beginner-single-vector | control only | sparse, TAB, or notation control; full pipeline still executed |
| piano-grand-voices-vector | 4 measures | representative timing hotspot |
| piano-rhythm-tuplets-vector | 3 measures | representative timing hotspot |
| piano-articulation-scan | 2 measures | representative timing hotspot |
| piano-dense-advanced-vector | 2 measures | representative timing hotspot |
| guitar-tab-sparse-vector | control only | sparse, TAB, or notation control; full pipeline still executed |
| guitar-standard-chords-vector | control only | sparse, TAB, or notation control; full pipeline still executed |
| guitar-paired-chords-vector | 1 measure | representative timing hotspot |
| guitar-techniques-paired-vector | control only | sparse, TAB, or notation control; full pipeline still executed |

Two requested keys were not emitted as one-to-one aligned measures (`piano-dense-advanced-vector:m1` and `guitar-paired-chords-vector:m6`), so they are represented by neighboring aligned hotspots rather than assigned speculative event matches.

## piano-grand-voices-vector — measure 1

- Page/system: 1 / 0
- Meter capacity: 4 quarters (16 internal divisions)
- Primary mechanism: **sustained voice steals timing capacity from moving voice**
- Mismatches: onset 0, duration 2, chord 0, missing 0, extra 0, missing rests 0
- Truth voice ends: {"1:1":4,"2:2":4}
- Rest evidence: detected 0, emitted 0

### Expected events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 1 | note | C4, E4, G4 |  |
| 1/1 | 1 | 1 | note | D4 |  |
| 1/1 | 2 | 1 | note | E4, G4 |  |
| 1/1 | 3 | 1 | note | F4 |  |
| 2/2 | 0 | 2 | note | C2, G2 |  |
| 2/2 | 2 | 2 | note | C3, F2 |  |

### Generated events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 1 | note | C4, E4, G4 |  |
| 1/1 | 1 | 1 | note | D4 |  |
| 1/1 | 2 | 2 | note | E4, G4 |  |
| 1/1 | 3 | 1 | note | F4 |  |
| 2/2 | 0 | 2 | note | C2, G2 |  |
| 2/2 | 2 | 2 | note | C3, F2 |  |

### Candidate geometry and packing

| Clef / voice evidence | Candidates | Stems / beams | X columns | Provisional onset→packed | Provisional duration→final | Flags |
|---|---|---|---|---|---|---|
| bass / lower:down:stemmed-sustain-or-quarter-voice:rg-1-4; lower:unknown-stem:unattached-or-rest-like-notehead:rg-1-10 | n-1-3-191-438<br>n-1-4-191-464 | down / 0,0 | 190.54, 190.54 | 0→0 | 8→8 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-1-1; upper:up:stemmed-sustain-or-quarter-voice:rg-1-2; upper:up:stemmed-sustain-or-quarter-voice:rg-1-3 | n-1-0-191-291<br>n-1-1-191-304<br>n-1-2-191-317 | up / 0,0,0 | 190.54, 190.54, 190.54 | 0→0 | 8→4 | perClefDurationAdjusted |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-1-5 | n-1-5-216-310 | up / 0 | 215.6 | 4→4 | 4→4 | — |
| bass / lower:down:beamed-eighth-voice:rg-1-8; lower:unknown-stem:unattached-or-rest-like-notehead:rg-1-11 | n-1-8-244-418<br>n-1-9-244-444 | down / 1,0 | 244.36, 244.36 | 8→8 | 8→8 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-1-6; upper:up:stemmed-sustain-or-quarter-voice:rg-1-7 | n-1-6-243-291<br>n-1-7-244-304 | up / 0,0 | 242.51, 244.36 | 8→8 | 8→8 | perClefDurationAdjusted |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-1-9 | n-1-10-271-297 | up / 0 | 271.27 | 12→12 | 4→4 | — |

### First timing divergence

| Defect | MIDI | Expected→generated | First divergent stage | Candidates |
|---|---:|---|---|---|
| duration-mismatch | 64 | 1→2 | buildNoteEventsFromGroups: shared X-gap duration packing | n-1-6-243-291, n-1-7-244-304 |
| duration-mismatch | 67 | 1→2 | buildNoteEventsFromGroups: shared X-gap duration packing | n-1-6-243-291, n-1-7-244-304 |

## piano-grand-voices-vector — measure 5

- Page/system: 1 / 1
- Meter capacity: 4 quarters (16 internal divisions)
- Primary mechanism: **sustained voice steals timing capacity from moving voice**
- Mismatches: onset 2, duration 5, chord 0, missing 1, extra 1, missing rests 0
- Truth voice ends: {"1:1":4,"2:2":4}
- Rest evidence: detected 0, emitted 0

### Expected events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 1 | note | B4, D5, G4 |  |
| 1/1 | 1 | 1 | note | A4 |  |
| 1/1 | 2 | 1 | note | B4, D5 |  |
| 1/1 | 3 | 1 | note | C5 |  |
| 2/2 | 0 | 2 | note | D3, G2 |  |
| 2/2 | 2 | 2 | note | C3, G3 |  |

### Generated events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 1 | note | A4, B4, F4 |  |
| 1/1 | 1 | 1 | note | G4 |  |
| 1/1 | 1.75 | 2 | note | A4, B4 |  |
| 1/1 | 2.75 | 1 | note | B4 |  |
| 2/2 | 0 | 0.5 | note | D3, G2 |  |
| 2/2 | 2 | 0.5 | note | C3, F3 |  |

### Candidate geometry and packing

| Clef / voice evidence | Candidates | Stems / beams | X columns | Provisional onset→packed | Provisional duration→final | Flags |
|---|---|---|---|---|---|---|
| bass / lower:down:beamed-eighth-voice:rg-5-4; lower:unknown-stem:unattached-or-rest-like-notehead:rg-5-11 | n-5-3-191-853<br>n-5-4-191-879 | down / 1,0 | 190.54, 190.54 | 0→0 | 4→2 | beamDurationAdjusted |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-5-1; upper:up:stemmed-sustain-or-quarter-voice:rg-5-2; upper:up:stemmed-sustain-or-quarter-voice:rg-5-3 | n-5-0-191-706<br>n-5-1-191-719<br>n-5-2-191-732 | up / 0,0,0 | 190.54, 190.54, 190.54 | 0→0 | 4→4 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-5-5 | n-5-5-216-725 | up / 0 | 215.6 | 4→4 | 4→4 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-5-6; upper:up:stemmed-sustain-or-quarter-voice:rg-5-7 | n-5-6-243-706<br>n-5-7-244-719 | up / 0,0 | 242.51, 244.36 | 7→7 | 1→8 | perClefDurationAdjusted |
| bass / lower:down:beamed-eighth-voice:rg-5-8; lower:down:beamed-eighth-voice:rg-5-9 | n-5-8-244-833<br>n-5-9-244-859 | down / 1,1 | 244.36, 244.36 | 8→8 | 4→2 | beamDurationAdjusted |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-5-10 | n-5-10-271-712 | up / 0 | 271.27 | 11→11 | 4→4 | — |

### First timing divergence

| Defect | MIDI | Expected→generated | First divergent stage | Candidates |
|---|---:|---|---|---|
| onset-mismatch | 71 | 2→2.75 | buildNoteEventsFromGroups: shared position/onset grid | n-5-10-271-712 |
| onset-mismatch | 71 | 2→1.75 | buildNoteEventsFromGroups: shared position/onset grid | n-5-6-243-706, n-5-7-244-719 |
| duration-mismatch | 43 | 2→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-5-3-191-853, n-5-4-191-879 |
| duration-mismatch | 50 | 2→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-5-3-191-853, n-5-4-191-879 |
| duration-mismatch | 48 | 2→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-5-8-244-833, n-5-9-244-859 |
| duration-mismatch | 53 | 2→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-5-8-244-833, n-5-9-244-859 |
| duration-mismatch | 71 | 1→2 | buildNoteEventsFromGroups: shared X-gap duration packing | n-5-6-243-706, n-5-7-244-719 |

## piano-grand-voices-vector — measure 7

- Page/system: 1 / 1
- Meter capacity: 4 quarters (16 internal divisions)
- Primary mechanism: **sustained voice steals timing capacity from moving voice**
- Mismatches: onset 0, duration 2, chord 0, missing 0, extra 0, missing rests 0
- Truth voice ends: {"1:1":4,"2:2":4}
- Rest evidence: detected 0, emitted 0

### Expected events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 1 | note | B4, D5, G4 |  |
| 1/1 | 1 | 1 | note | A4 |  |
| 1/1 | 2 | 1 | note | B4, D5 |  |
| 1/1 | 3 | 1 | note | C5 |  |
| 2/2 | 0 | 2 | note | D3, G2 |  |
| 2/2 | 2 | 2 | note | C3, G3 |  |

### Generated events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 1 | note | A4, B4, F4 |  |
| 1/1 | 1 | 1 | note | G4 |  |
| 1/1 | 2 | 2 | note | A4, B4 |  |
| 1/1 | 3 | 1 | note | B4 |  |
| 2/2 | 0 | 2 | note | D3, G2 |  |
| 2/2 | 2 | 2 | note | C3, F3 |  |

### Candidate geometry and packing

| Clef / voice evidence | Candidates | Stems / beams | X columns | Provisional onset→packed | Provisional duration→final | Flags |
|---|---|---|---|---|---|---|
| bass / lower:down:beamed-eighth-voice:rg-7-4; lower:unknown-stem:unattached-or-rest-like-notehead:rg-7-11 | n-7-3-545-853<br>n-7-4-545-879 | down / 1,0 | 545.38, 545.38 | 0→0 | 8→8 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-7-1; upper:up:stemmed-sustain-or-quarter-voice:rg-7-2; upper:up:stemmed-sustain-or-quarter-voice:rg-7-3 | n-7-0-545-706<br>n-7-1-545-719<br>n-7-2-545-732 | up / 0,0,0 | 545.38, 545.38, 545.38 | 0→0 | 8→4 | perClefDurationAdjusted |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-7-5 | n-7-5-581-725 | up / 0 | 581.26 | 4→4 | 4→4 | — |
| bass / lower:down:beamed-eighth-voice:rg-7-8; lower:down:beamed-eighth-voice:rg-7-9 | n-7-8-617-833<br>n-7-9-617-859 | down / 1,1 | 617.14, 617.14 | 8→8 | 8→8 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-7-6; upper:up:stemmed-sustain-or-quarter-voice:rg-7-7 | n-7-6-617-706<br>n-7-7-617-719 | up / 0,0 | 617.14, 617.14 | 8→8 | 8→8 | perClefDurationAdjusted |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-7-10 | n-7-10-653-712 | up / 0 | 653.02 | 12→12 | 4→4 | — |

### First timing divergence

| Defect | MIDI | Expected→generated | First divergent stage | Candidates |
|---|---:|---|---|---|
| duration-mismatch | 71 | 1→2 | buildNoteEventsFromGroups: shared X-gap duration packing | n-7-6-617-706, n-7-7-617-719 |
| duration-mismatch | 69 | 1→2 | buildNoteEventsFromGroups: shared X-gap duration packing | n-7-6-617-706, n-7-7-617-719 |

## piano-grand-voices-vector — measure 8

- Page/system: 1 / 1
- Meter capacity: 4 quarters (16 internal divisions)
- Primary mechanism: **sustained voice steals timing capacity from moving voice**
- Mismatches: onset 0, duration 1, chord 0, missing 0, extra 0, missing rests 0
- Truth voice ends: {"1:1":4,"2:2":4}
- Rest evidence: detected 0, emitted 0

### Expected events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 1 | note | B4, E4, G#4 |  |
| 1/1 | 1 | 1 | note | F#4 |  |
| 1/1 | 2 | 1 | note | B4, G#4 |  |
| 1/1 | 3 | 1 | note | A4 |  |
| 2/2 | 0 | 2 | note | B2, E2 |  |
| 2/2 | 2 | 2 | note | A2, E3 |  |

### Generated events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 1 | note | A#4, E4, F4 |  |
| 1/1 | 1 | 1 | note | F4 |  |
| 1/1 | 2 | 2 | note | F4 |  |
| 1/1 | 2 | 1 | note | A#4 |  |
| 1/1 | 3 | 1 | note | G4 |  |
| 2/2 | 0 | 2 | note | B2, E2 |  |
| 2/2 | 2 | 2 | note | A2, E3 |  |

### Candidate geometry and packing

| Clef / voice evidence | Candidates | Stems / beams | X columns | Provisional onset→packed | Provisional duration→final | Flags |
|---|---|---|---|---|---|---|
| bass / lower:down:beamed-eighth-voice:rg-8-4; lower:unknown-stem:unattached-or-rest-like-notehead:rg-8-10 | n-8-3-745-866<br>n-8-4-745-892 | down / 1,0 | 744.72, 744.72 | 0→0 | 8→8 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-8-1; upper:up:stemmed-sustain-or-quarter-voice:rg-8-2; upper:up:stemmed-sustain-or-quarter-voice:rg-8-3 | n-8-0-745-719<br>n-8-1-745-732<br>n-8-2-745-745 | up / 0,0,0 | 744.72, 744.72, 744.72 | 0→0 | 8→4 | perClefDurationAdjusted |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-8-5 | n-8-5-781-738 | up / 0 | 780.6 | 4→4 | 4→4 | — |
| bass / lower:down:beamed-eighth-voice:rg-8-8; lower:unknown-stem:unattached-or-rest-like-notehead:rg-8-11 | n-8-8-816-846<br>n-8-9-816-872 | down / 1,0 | 816.49, 816.49 | 8→8 | 8→8 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-8-7 | n-8-7-816-732 | up / 0 | 816.49 | —→8 | —→8 | perClefDurationAdjusted |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-8-6 | n-8-6-816-719 | up / 0 | 816.49 | —→8 | —→4 | perClefDurationAdjusted |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-8-9 | n-8-10-852-725 | up / 0 | 852.37 | 12→12 | 4→4 | — |

### First timing divergence

| Defect | MIDI | Expected→generated | First divergent stage | Candidates |
|---|---:|---|---|---|
| duration-mismatch | 65 | 1→2 | buildNoteEventsFromGroups: shared X-gap duration packing | n-8-7-816-732 |

## piano-rhythm-tuplets-vector — measure 4

- Page/system: 1 / 0
- Meter capacity: 4 quarters (16 internal divisions)
- Primary mechanism: **missing rests cause onset collapse**
- Mismatches: onset 3, duration 2, chord 0, missing 0, extra 0, missing rests 2
- Truth voice ends: {"1:1":4}
- Rest evidence: detected 0, emitted 1

### Expected events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 0.5 | rest | — |  |
| 1/1 | 0.5 | 0.5 | note | G4 |  |
| 1/1 | 1 | 1.5 | note | A4 |  |
| 1/1 | 2.5 | 0.25 | rest | — |  |
| 1/1 | 2.75 | 0.25 | note | B4 |  |
| 1/1 | 3 | 1 | note | C5 |  |

### Generated events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0.75 | 0.25 | rest | — |  |
| 1/1 | 1 | 0.5 | note | G4 |  |
| 1/1 | 1.5 | 0.75 | note | A4 |  |
| 1/1 | 3 | 1 | note | B4, C5 |  |

### Candidate geometry and packing

| Clef / voice evidence | Candidates | Stems / beams | X columns | Provisional onset→packed | Provisional duration→final | Flags |
|---|---|---|---|---|---|---|
| treble / upper:down:beamed-eighth-voice:rg-4-1 | n-4-0-763-324 | down / 1 | 763.06 | 4→4 | 2→2 | — |
| treble / upper:down:beamed-eighth-voice:rg-4-2 | n-4-1-781-317 | down / 1 | 780.6 | 6→6 | 3→3 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-4-4; upper:down:beamed-eighth-voice:rg-4-3 | n-4-3-852-304<br>n-4-2-843-310 | up, down / 0,1 | 852.37, 843.4 | 12→12 | 4→4 | — |

### First timing divergence

| Defect | MIDI | Expected→generated | First divergent stage | Candidates |
|---|---:|---|---|---|
| onset-mismatch | 67 | 0.5→1 | buildNoteEventsFromGroups: shared position/onset grid | n-4-0-763-324 |
| onset-mismatch | 71 | 2.75→3 | buildNoteEventsFromGroups: shared position/onset grid | n-4-3-852-304, n-4-2-843-310 |
| onset-mismatch | 69 | 1→1.5 | buildNoteEventsFromGroups: shared position/onset grid | n-4-1-781-317 |
| duration-mismatch | 71 | 0.25→1 | buildNoteEventsFromGroups: shared X-gap duration packing | n-4-3-852-304, n-4-2-843-310 |
| duration-mismatch | 69 | 1.5→0.75 | buildNoteEventsFromGroups: shared X-gap duration packing | n-4-1-781-317 |

## piano-rhythm-tuplets-vector — measure 5

- Page/system: 1 / 1
- Meter capacity: 4 quarters (16 internal divisions)
- Primary mechanism: **missing rests cause onset collapse**
- Mismatches: onset 0, duration 1, chord 0, missing 1, extra 1, missing rests 1
- Truth voice ends: {"1:1":4}
- Rest evidence: detected 0, emitted 1

### Expected events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 3 | note | C5 | start |
| 1/1 | 2 | 1 | note | C5 | stop |
| 1/1 | 3 | 1 | rest | — |  |

### Generated events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 1 | 1 | note | C5 |  |
| 1/1 | 2.75 | 0.5 | rest | — |  |
| 3/1 | 0 | 2 | note | C5 |  |

### Candidate geometry and packing

| Clef / voice evidence | Candidates | Stems / beams | X columns | Provisional onset→packed | Provisional duration→final | Flags |
|---|---|---|---|---|---|---|
| treble / upper:down:stemmed-sustain-or-quarter-voice:rg-5-1 | n-5-0-191-680 | down / 0 | 190.54 | 0→0 | 8→8 | — |
| treble / upper:down:stemmed-sustain-or-quarter-voice:rg-5-2 | n-5-1-244-680 | down / 0 | 244.36 | 4→4 | 4→4 | — |

### First timing divergence

| Defect | MIDI | Expected→generated | First divergent stage | Candidates |
|---|---:|---|---|---|
| duration-mismatch | 72 | 3→2 | buildNoteEventsFromGroups: shared X-gap duration packing | n-5-0-191-680 |

## piano-rhythm-tuplets-vector — measure 8

- Page/system: 1 / 1
- Meter capacity: 4 quarters (16 internal divisions)
- Primary mechanism: **missing rests cause onset collapse**
- Mismatches: onset 3, duration 3, chord 0, missing 0, extra 0, missing rests 1
- Truth voice ends: {"1:1":4}
- Rest evidence: detected 0, emitted 0

### Expected events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 0.75 | note | F4 |  |
| 1/1 | 0.75 | 0.25 | note | G4 |  |
| 1/1 | 1 | 1 | note | A4 |  |
| 1/1 | 2 | 0.5 | note | B4 |  |
| 1/1 | 2.5 | 0.5 | note | C5 |  |
| 1/1 | 3 | 1 | rest | — |  |

### Generated events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0.75 | 0.5 | note | F4 |  |
| 1/1 | 1 | 0.5 | note | G4 |  |
| 1/1 | 1.5 | 0.5 | note | A4 |  |
| 1/1 | 2 | 0.5 | note | B4 |  |
| 1/1 | 2.5 | 0.5 | note | C5 |  |

### Candidate geometry and packing

| Clef / voice evidence | Candidates | Stems / beams | X columns | Provisional onset→packed | Provisional duration→final | Flags |
|---|---|---|---|---|---|---|
| treble / upper:unknown-stem:unattached-or-rest-like-notehead:rg-8-5 | n-8-0-743-706 | — / 0 | 742.87 | 3→3 | 2→2 | — |
| treble / upper:down:beamed-eighth-voice:rg-8-1 | n-8-1-772-699 | down / 1 | 771.63 | 5→4 | 1→2 | beamDurationAdjusted, beamDurationFloored, beamOnsetResnapped |
| treble / upper:down:beamed-eighth-voice:rg-8-2 | n-8-2-781-693 | down / 1 | 780.6 | 6→6 | 2→2 | — |
| treble / upper:down:beamed-eighth-voice:rg-8-3 | n-8-3-817-686 | down / 1 | 816.88 | 8→8 | 2→2 | — |
| treble / upper:down:beamed-eighth-voice:rg-8-4 | n-8-4-834-680 | down / 1 | 834.43 | 10→10 | 4→2 | beamDurationAdjusted |

### First timing divergence

| Defect | MIDI | Expected→generated | First divergent stage | Candidates |
|---|---:|---|---|---|
| onset-mismatch | 67 | 0.75→1 | buildNoteEventsFromGroups: shared position/onset grid | n-8-1-772-699 |
| onset-mismatch | 69 | 1→1.5 | buildNoteEventsFromGroups: shared position/onset grid | n-8-2-781-693 |
| onset-mismatch | 65 | 0→0.75 | buildNoteEventsFromGroups: shared position/onset grid | n-8-0-743-706 |
| duration-mismatch | 67 | 0.25→0.5 | refineEventDurationsFromBeamEvidence (beam-refine) | n-8-1-772-699 |
| duration-mismatch | 69 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-8-2-781-693 |
| duration-mismatch | 65 | 0.75→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-8-0-743-706 |

## piano-articulation-scan — measure 2

- Page/system: 1 / 0
- Meter capacity: 4 quarters (16 internal divisions)
- Primary mechanism: **stem/beam evidence lost before duration assignment**
- Mismatches: onset 6, duration 4, chord 0, missing 0, extra 6, missing rests 0
- Truth voice ends: {"1:1":4,"2:2":4}
- Rest evidence: detected 0, emitted 0

### Expected events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 1 | note | A4, D4, F#4 |  |
| 1/1 | 1 | 1 | note | E4 |  |
| 1/1 | 2 | 1 | note | A4, F#4 |  |
| 1/1 | 3 | 1 | note | G4 |  |
| 2/2 | 0 | 2 | note | A2, D2 |  |
| 2/2 | 2 | 2 | note | D3, G2 |  |

### Generated events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 1 | note | A4, A4, E4 |  |
| 1/1 | 1.25 | 1 | note | A4, E4 |  |
| 1/1 | 2.75 | 1 | note | A4, A4, B4, F4 |  |
| 2/2 | 0 | 1 | note | A2, A2, C3 |  |
| 2/2 | 2.75 | 1 | note | A2, A2, C3, D3, E3 |  |

### Candidate geometry and packing

| Clef / voice evidence | Candidates | Stems / beams | X columns | Provisional onset→packed | Provisional duration→final | Flags |
|---|---|---|---|---|---|---|
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-2-1; upper:up:beamed-eighth-voice:rg-2-2; upper:up:beamed-eighth-voice:rg-2-3; lower:down:stemmed-sustain-or-quarter-voice:rg-2-4; lower:down:beamed-eighth-voice:rg-2-5; lower:down:stemmed-sustain-or-quarter-voice:rg-2-6 | n-2-0-341-281<br>n-2-1-351-279<br>n-2-2-351-297<br>n-2-3-351-414<br>n-2-4-351-424<br>n-2-5-351-428 | up, down / 0,1,1,0,1,0 | 341, 351, 351, 351, 351, 351 | —→0 | —→4 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-2-7; upper:up:beamed-sixteenth-voice:rg-2-8 | n-2-6-379-301<br>n-2-7-387-279 | up / 0,2 | 379, 387 | —→5 | —→4 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-2-9; lower:down:stemmed-sustain-or-quarter-voice:rg-2-10; lower:down:beamed-eighth-voice:rg-2-11; upper:unknown-stem:unattached-or-rest-like-notehead:rg-2-16; lower:unknown-stem:unattached-or-rest-like-notehead:rg-2-17; upper:up:beamed-eighth-voice:rg-2-12; upper:up:beamed-eighth-voice:rg-2-13; lower:down:beamed-eighth-voice:rg-2-14; lower:up:stemmed-sustain-or-quarter-voice:rg-2-15 | n-2-8-414-281<br>n-2-9-414-401<br>n-2-10-414-410<br>n-2-11-415-293<br>n-2-12-415-428<br>n-2-13-423-267<br>n-2-14-423-279<br>n-2-15-423-399<br>n-2-16-425-428 | up, down / 0,0,1,0,0,1,1,1,0 | 414, 414, 414, 415, 415, 423, 423, 423, 425 | —→11 | —→4 | — |

### First timing divergence

| Defect | MIDI | Expected→generated | First divergent stage | Candidates |
|---|---:|---|---|---|
| onset-mismatch | 64 | 1→1.25 | buildNoteEventsFromGroups: shared position/onset grid | n-2-6-379-301, n-2-7-387-279 |
| onset-mismatch | 69 | 2→1.25 | buildNoteEventsFromGroups: shared position/onset grid | n-2-6-379-301, n-2-7-387-279 |
| onset-mismatch | 65 | 2→2.75 | buildNoteEventsFromGroups: shared position/onset grid | n-2-8-414-281, n-2-9-414-401, n-2-10-414-410, n-2-11-415-293, n-2-12-415-428, n-2-13-423-267, n-2-14-423-279, n-2-15-423-399, n-2-16-425-428 |
| onset-mismatch | 69 | 3→2.75 | buildNoteEventsFromGroups: shared position/onset grid | n-2-8-414-281, n-2-9-414-401, n-2-10-414-410, n-2-11-415-293, n-2-12-415-428, n-2-13-423-267, n-2-14-423-279, n-2-15-423-399, n-2-16-425-428 |
| onset-mismatch | 50 | 2→2.75 | buildNoteEventsFromGroups: shared position/onset grid | n-2-8-414-281, n-2-9-414-401, n-2-10-414-410, n-2-11-415-293, n-2-12-415-428, n-2-13-423-267, n-2-14-423-279, n-2-15-423-399, n-2-16-425-428 |
| onset-mismatch | 45 | 2→2.75 | buildNoteEventsFromGroups: shared position/onset grid | n-2-8-414-281, n-2-9-414-401, n-2-10-414-410, n-2-11-415-293, n-2-12-415-428, n-2-13-423-267, n-2-14-423-279, n-2-15-423-399, n-2-16-425-428 |
| duration-mismatch | 45 | 2→1 | buildNoteEventsFromGroups: shared X-gap duration packing | n-2-0-341-281, n-2-1-351-279, n-2-2-351-297, n-2-3-351-414, n-2-4-351-424, n-2-5-351-428 |
| duration-mismatch | 50 | 2→1 | buildNoteEventsFromGroups: shared X-gap duration packing | n-2-8-414-281, n-2-9-414-401, n-2-10-414-410, n-2-11-415-293, n-2-12-415-428, n-2-13-423-267, n-2-14-423-279, n-2-15-423-399, n-2-16-425-428 |
| duration-mismatch | 45 | 2→1 | buildNoteEventsFromGroups: shared X-gap duration packing | n-2-8-414-281, n-2-9-414-401, n-2-10-414-410, n-2-11-415-293, n-2-12-415-428, n-2-13-423-267, n-2-14-423-279, n-2-15-423-399, n-2-16-425-428 |
| duration-mismatch | 45 | 2→1 | buildNoteEventsFromGroups: shared X-gap duration packing | n-2-0-341-281, n-2-1-351-279, n-2-2-351-297, n-2-3-351-414, n-2-4-351-424, n-2-5-351-428 |

## piano-articulation-scan — measure 6

- Page/system: 1 / 1
- Meter capacity: 4 quarters (16 internal divisions)
- Primary mechanism: **stem/beam evidence lost before duration assignment**
- Mismatches: onset 0, duration 4, chord 0, missing 0, extra 10, missing rests 0
- Truth voice ends: {"1:1":4,"2:2":4}
- Rest evidence: detected 0, emitted 0

### Expected events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 1 | note | A4, C#5, E5 |  |
| 1/1 | 1 | 1 | note | B4 |  |
| 1/1 | 2 | 1 | note | C#5, E5 |  |
| 1/1 | 3 | 1 | note | D5 |  |
| 2/2 | 0 | 2 | note | A2, E3 |  |
| 2/2 | 2 | 2 | note | A3, D3 |  |

### Generated events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 1 | note | A4, B4, B4, C5, C5 |  |
| 1/1 | 1 | 1 | note | A4, A4, B4, B4, C5 |  |
| 1/1 | 2 | 1 | note | B4, B4, C5, C5 | start |
| 1/1 | 3 | 1 | note | B4 |  |
| 2/2 | 0 | 1 | note | C3, D3, D3, G2 |  |
| 2/2 | 2 | 1 | note | C3, E3 |  |

### Candidate geometry and packing

| Clef / voice evidence | Candidates | Stems / beams | X columns | Provisional onset→packed | Provisional duration→final | Flags |
|---|---|---|---|---|---|---|
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-6-1; upper:up:stemmed-sustain-or-quarter-voice:rg-6-2; lower:up:stemmed-sustain-or-quarter-voice:rg-6-3; lower:unknown-stem:unattached-or-rest-like-notehead:rg-6-17; upper:up:beamed-eighth-voice:rg-6-4; upper:up:beamed-eighth-voice:rg-6-5; upper:unknown-stem:unattached-or-rest-like-notehead:rg-6-18; lower:unknown-stem:unattached-or-rest-like-notehead:rg-6-19; lower:unknown-stem:unattached-or-rest-like-notehead:rg-6-20 | n-6-0-343-697<br>n-6-1-344-709<br>n-6-2-344-871<br>n-6-3-346-844<br>n-6-4-352-696<br>n-6-5-353-707<br>n-6-6-353-715<br>n-6-7-355-844<br>n-6-8-355-856 | up / 0,0,0,0,1,1,0,0,0 | 343, 344, 344, 346, 352, 353, 353, 355, 355 | —→0 | —→4 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-6-6; upper:up:stemmed-sustain-or-quarter-voice:rg-6-7; upper:up:beamed-sixteenth-voice:rg-6-8; upper:up:stemmed-sustain-or-quarter-voice:rg-6-9; upper:up:stemmed-sustain-or-quarter-voice:rg-6-10 | n-6-9-382-709<br>n-6-10-384-715<br>n-6-11-393-697<br>n-6-12-393-709<br>n-6-13-395-715 | up / 0,0,2,0,0 | 382, 384, 393, 393, 395 | —→4 | —→4 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-6-11; lower:down:beamed-eighth-voice:rg-6-12; upper:up:stemmed-sustain-or-quarter-voice:rg-6-13; lower:down:beamed-eighth-voice:rg-6-14; upper:unknown-stem:unattached-or-rest-like-notehead:rg-6-21; upper:up:beamed-eighth-voice:rg-6-15 | n-6-14-415-697<br>n-6-15-415-850<br>n-6-16-416-709<br>n-6-17-424-837<br>n-6-18-425-703<br>n-6-19-426-697 | up, down / 0,1,0,1,0,1 | 415, 415, 416, 424, 425, 426 | —→8 | —→4 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-6-16 | n-6-20-451-703 | up / 0 | 451 | —→12 | —→4 | — |

### First timing divergence

| Defect | MIDI | Expected→generated | First divergent stage | Candidates |
|---|---:|---|---|---|
| duration-mismatch | 43 | 2→1 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-0-343-697, n-6-1-344-709, n-6-2-344-871, n-6-3-346-844, n-6-4-352-696, n-6-5-353-707, n-6-6-353-715, n-6-7-355-844, n-6-8-355-856 |
| duration-mismatch | 50 | 2→1 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-0-343-697, n-6-1-344-709, n-6-2-344-871, n-6-3-346-844, n-6-4-352-696, n-6-5-353-707, n-6-6-353-715, n-6-7-355-844, n-6-8-355-856 |
| duration-mismatch | 48 | 2→1 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-14-415-697, n-6-15-415-850, n-6-16-416-709, n-6-17-424-837, n-6-18-425-703, n-6-19-426-697 |
| duration-mismatch | 52 | 2→1 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-14-415-697, n-6-15-415-850, n-6-16-416-709, n-6-17-424-837, n-6-18-425-703, n-6-19-426-697 |

## piano-dense-advanced-vector — measure 5

- Page/system: 1 / 1
- Meter capacity: 4 quarters (16 internal divisions)
- Primary mechanism: **stem/beam evidence lost before duration assignment**
- Mismatches: onset 17, duration 23, chord 0, missing 1, extra 1, missing rests 0
- Truth voice ends: {"1:1":4,"2:2":4}
- Rest evidence: detected 0, emitted 0

### Expected events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 0.5 | note | B4, D5, G4 |  |
| 1/1 | 0.5 | 0.5 | note | A4, C#5, E5 |  |
| 1/1 | 1 | 0.5 | note | B4, D#5, F#5 |  |
| 1/1 | 1.5 | 0.5 | note | C5, E5, G5 |  |
| 1/1 | 2 | 0.5 | note | A5, D5, F#5 |  |
| 1/1 | 2.5 | 0.5 | note | C5, E5, G5 |  |
| 1/1 | 3 | 0.5 | note | B4, D#5, F#5 |  |
| 1/1 | 3.5 | 0.5 | note | A4, C#5, E5 |  |
| 2/2 | 0 | 1 | note | D3, G2, G3 |  |
| 2/2 | 1 | 1 | note | A2, E3 |  |
| 2/2 | 2 | 1 | note | B2, F#3 |  |
| 2/2 | 3 | 1 | note | C3, G3 |  |

### Generated events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 1 | note | B4, C5, G4 |  |
| 1/1 | 0.5 | 0.5 | note | A4, C5, D#5 |  |
| 1/1 | 1 | 0.25 | note | B4, C5, F5 |  |
| 1/1 | 1.5 | 0.5 | note | C5, D#5, F#5 |  |
| 1/1 | 2 | 0.25 | note | C#5, F5, G5 |  |
| 1/1 | 2.25 | 0.5 | note | C#5, D#5, F#5 |  |
| 1/1 | 2.75 | 0.25 | note | B4, C#5, F5 |  |
| 1/1 | 3.25 | 0.75 | note | A4, C#5, D#5 |  |
| 2/2 | 0 | 0.5 | note | D3, F3, G2 |  |
| 2/2 | 1 | 0.5 | note | A2, E3 |  |
| 2/2 | 1.5 | 0.5 | note | F3 |  |
| 2/2 | 2 | 0.5 | note | B2 |  |
| 2/2 | 2.75 | 0.5 | note | C3, F3 |  |

### Candidate geometry and packing

| Clef / voice evidence | Candidates | Stems / beams | X columns | Provisional onset→packed | Provisional duration→final | Flags |
|---|---|---|---|---|---|---|
| bass / lower:down:stemmed-sustain-or-quarter-voice:rg-6-4; lower:down:beamed-eighth-voice:rg-6-5; lower:up:stemmed-sustain-or-quarter-voice:rg-6-6 | n-6-3-191-833<br>n-6-4-191-853<br>n-6-5-191-879 | down, up / 0,1,0 | 190.54, 190.54, 190.54 | 0→0 | 1→2 | beamDurationAdjusted, beamDurationFloored |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-6-1; upper:up:stemmed-sustain-or-quarter-voice:rg-6-2; upper:up:stemmed-sustain-or-quarter-voice:rg-6-3 | n-6-0-191-706<br>n-6-1-191-719<br>n-6-2-191-732 | up / 0,0,0 | 190.54, 190.54, 190.54 | 0→0 | 1→4 | perClefDurationAdjusted |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-6-7; upper:up:stemmed-sustain-or-quarter-voice:rg-6-8; upper:up:stemmed-sustain-or-quarter-voice:rg-6-9 | n-6-6-202-699<br>n-6-7-204-712<br>n-6-8-204-725 | up / 0,0,0 | 202.14, 204, 204 | 2→2 | 2→2 | — |
| bass / lower:down:beamed-eighth-voice:rg-6-11; lower:unknown-stem:unattached-or-rest-like-notehead:rg-6-33 | n-6-10-216-846<br>n-6-13-217-872 | down / 1,0 | 215.6, 217.45 | 4→4 | 2→2 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-6-10; upper:up:stemmed-sustain-or-quarter-voice:rg-6-12; upper:up:beamed-sixteenth-voice:rg-6-13 | n-6-9-216-693<br>n-6-11-217-706<br>n-6-12-217-719 | up / 0,0,2 | 215.6, 217.45, 217.45 | 4→4 | 2→1 | beamDurationAdjusted |
| bass / lower:down:beamed-eighth-voice:rg-6-17 | n-6-17-243-840 | down / 1 | 242.51 | 7→6 | 1→2 | beamDurationAdjusted, beamDurationFloored, beamOnsetResnapped |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-6-14; upper:up:stemmed-sustain-or-quarter-voice:rg-6-15; upper:up:stemmed-sustain-or-quarter-voice:rg-6-16 | n-6-14-229-686<br>n-6-15-231-699<br>n-6-16-231-712 | up / 0,0,0 | 229.06, 230.91, 230.91 | 6→6 | 1→2 | perClefDurationAdjusted |
| bass / lower:down:beamed-eighth-voice:rg-6-21 | n-6-21-244-866 | down / 1 | 244.36 | 8→8 | 1→2 | beamDurationAdjusted, beamDurationFloored |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-6-18; upper:up:stemmed-sustain-or-quarter-voice:rg-6-19; upper:up:stemmed-sustain-or-quarter-voice:rg-6-20 | n-6-18-244-680<br>n-6-19-244-693<br>n-6-20-244-706 | up / 0,0,0 | 244.36, 244.36, 244.36 | 8→8 | 1→1 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-6-22; upper:up:stemmed-sustain-or-quarter-voice:rg-6-23; upper:up:stemmed-sustain-or-quarter-voice:rg-6-24 | n-6-22-258-686<br>n-6-23-258-699<br>n-6-24-258-712 | up / 0,0,0 | 257.82, 257.82, 257.82 | 9→9 | 2→2 | — |
| bass / lower:down:beamed-eighth-voice:rg-6-28; lower:down:beamed-eighth-voice:rg-6-29 | n-6-28-271-833<br>n-6-29-271-859 | down / 1,1 | 271.27, 271.27 | 11→11 | 2→2 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-6-25; upper:up:beamed-sixteenth-voice:rg-6-26; upper:up:beamed-sixteenth-voice:rg-6-27 | n-6-25-271-693<br>n-6-26-271-706<br>n-6-27-271-719 | up / 0,2,2 | 271.27, 271.27, 271.27 | 11→11 | 2→1 | beamDurationAdjusted |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-6-30; upper:up:stemmed-sustain-or-quarter-voice:rg-6-31; upper:up:stemmed-sustain-or-quarter-voice:rg-6-32 | n-6-30-285-699<br>n-6-31-285-712<br>n-6-32-285-725 | up / 0,0,0 | 284.73, 284.73, 284.73 | 13→13 | 4→3 | perClefDurationAdjusted |

### First timing divergence

| Defect | MIDI | Expected→generated | First divergent stage | Candidates |
|---|---:|---|---|---|
| onset-mismatch | 78 | 2→2.25 | buildNoteEventsFromGroups: shared position/onset grid | n-6-22-258-686, n-6-23-258-699, n-6-24-258-712 |
| onset-mismatch | 71 | 3→2.75 | buildNoteEventsFromGroups: shared position/onset grid | n-6-25-271-693, n-6-26-271-706, n-6-27-271-719 |
| onset-mismatch | 75 | 3→3.25 | buildNoteEventsFromGroups: shared position/onset grid | n-6-30-285-699, n-6-31-285-712, n-6-32-285-725 |
| onset-mismatch | 69 | 3.5→3.25 | buildNoteEventsFromGroups: shared position/onset grid | n-6-30-285-699, n-6-31-285-712, n-6-32-285-725 |
| onset-mismatch | 73 | 3.5→3.25 | buildNoteEventsFromGroups: shared position/onset grid | n-6-30-285-699, n-6-31-285-712, n-6-32-285-725 |
| onset-mismatch | 75 | 1→0.5 | buildNoteEventsFromGroups: shared position/onset grid | n-6-6-202-699, n-6-7-204-712, n-6-8-204-725 |
| onset-mismatch | 78 | 1→1.5 | buildNoteEventsFromGroups: shared position/onset grid | n-6-14-229-686, n-6-15-231-699, n-6-16-231-712 |
| onset-mismatch | 48 | 3→2.75 | buildNoteEventsFromGroups: shared position/onset grid | n-6-28-271-833, n-6-29-271-859 |
| onset-mismatch | 79 | 1.5→2 | buildNoteEventsFromGroups: shared position/onset grid | n-6-18-244-680, n-6-19-244-693, n-6-20-244-706 |
| onset-mismatch | 73 | 2.5→2.25 | buildNoteEventsFromGroups: shared position/onset grid | n-6-22-258-686, n-6-23-258-699, n-6-24-258-712 |
| onset-mismatch | 75 | 2.5→2.25 | buildNoteEventsFromGroups: shared position/onset grid | n-6-22-258-686, n-6-23-258-699, n-6-24-258-712 |
| onset-mismatch | 77 | 3→2.75 | buildNoteEventsFromGroups: shared position/onset grid | n-6-25-271-693, n-6-26-271-706, n-6-27-271-719 |
| onset-mismatch | 77 | 0.5→1 | buildNoteEventsFromGroups: shared position/onset grid | n-6-9-216-693, n-6-11-217-706, n-6-12-217-719 |
| onset-mismatch | 53 | 2→1.5 | buildNoteEventsFromGroups: shared position/onset grid | n-6-17-243-840 |
| onset-mismatch | 53 | 3→2.75 | buildNoteEventsFromGroups: shared position/onset grid | n-6-28-271-833, n-6-29-271-859 |
| onset-mismatch | 77 | 2.5→2 | buildNoteEventsFromGroups: shared position/onset grid | n-6-18-244-680, n-6-19-244-693, n-6-20-244-706 |
| onset-mismatch | 73 | 3.5→2.75 | buildNoteEventsFromGroups: shared position/onset grid | n-6-25-271-693, n-6-26-271-706, n-6-27-271-719 |
| duration-mismatch | 71 | 0.5→0.25 | refineEventDurationsFromBeamEvidence (beam-refine) | n-6-9-216-693, n-6-11-217-706, n-6-12-217-719 |
| duration-mismatch | 67 | 0.5→1 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-0-191-706, n-6-1-191-719, n-6-2-191-732 |
| duration-mismatch | 71 | 0.5→1 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-0-191-706, n-6-1-191-719, n-6-2-191-732 |
| duration-mismatch | 43 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-3-191-833, n-6-4-191-853, n-6-5-191-879 |
| duration-mismatch | 50 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-3-191-833, n-6-4-191-853, n-6-5-191-879 |
| duration-mismatch | 45 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-10-216-846, n-6-13-217-872 |
| duration-mismatch | 52 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-10-216-846, n-6-13-217-872 |
| duration-mismatch | 47 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-21-244-866 |
| duration-mismatch | 71 | 0.5→0.25 | refineEventDurationsFromBeamEvidence (beam-refine) | n-6-25-271-693, n-6-26-271-706, n-6-27-271-719 |
| duration-mismatch | 75 | 0.5→0.75 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-30-285-699, n-6-31-285-712, n-6-32-285-725 |
| duration-mismatch | 69 | 0.5→0.75 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-30-285-699, n-6-31-285-712, n-6-32-285-725 |
| duration-mismatch | 73 | 0.5→0.75 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-30-285-699, n-6-31-285-712, n-6-32-285-725 |
| duration-mismatch | 48 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-28-271-833, n-6-29-271-859 |
| duration-mismatch | 79 | 0.5→0.25 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-18-244-680, n-6-19-244-693, n-6-20-244-706 |
| duration-mismatch | 73 | 0.5→0.25 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-18-244-680, n-6-19-244-693, n-6-20-244-706 |
| duration-mismatch | 77 | 0.5→0.25 | refineEventDurationsFromBeamEvidence (beam-refine) | n-6-25-271-693, n-6-26-271-706, n-6-27-271-719 |
| duration-mismatch | 77 | 0.5→0.25 | refineEventDurationsFromBeamEvidence (beam-refine) | n-6-9-216-693, n-6-11-217-706, n-6-12-217-719 |
| duration-mismatch | 53 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-17-243-840 |
| duration-mismatch | 72 | 0.5→1 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-0-191-706, n-6-1-191-719, n-6-2-191-732 |
| duration-mismatch | 53 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-3-191-833, n-6-4-191-853, n-6-5-191-879 |
| duration-mismatch | 53 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-28-271-833, n-6-29-271-859 |
| duration-mismatch | 77 | 0.5→0.25 | buildNoteEventsFromGroups: shared X-gap duration packing | n-6-18-244-680, n-6-19-244-693, n-6-20-244-706 |
| duration-mismatch | 73 | 0.5→0.25 | refineEventDurationsFromBeamEvidence (beam-refine) | n-6-25-271-693, n-6-26-271-706, n-6-27-271-719 |

## piano-dense-advanced-vector — measure 7

- Page/system: 1 / 1
- Meter capacity: 4 quarters (16 internal divisions)
- Primary mechanism: **stem/beam evidence lost before duration assignment**
- Mismatches: onset 20, duration 16, chord 0, missing 4, extra 4, missing rests 0
- Truth voice ends: {"1:1":4,"2:2":4}
- Rest evidence: detected 0, emitted 0

### Expected events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 0.5 | note | B4, D#5, F#5 |  |
| 1/1 | 0.5 | 0.5 | note | C#5, F5, G#5 |  |
| 1/1 | 1 | 0.5 | note | A#5, D#5, G5 |  |
| 1/1 | 1.5 | 0.5 | note | B5, E5, G#5 |  |
| 1/1 | 2 | 0.5 | note | A#5, C#6, F#5 |  |
| 1/1 | 2.5 | 0.5 | note | B5, E5, G#5 |  |
| 1/1 | 3 | 0.5 | note | A#5, D#5, G5 |  |
| 1/1 | 3.5 | 0.5 | note | C#5, F5, G#5 |  |
| 2/2 | 0 | 1 | note | B2, B3, F#3 |  |
| 2/2 | 1 | 1 | note | C#3, G#3 |  |
| 2/2 | 2 | 1 | note | A#3, D#3 |  |
| 2/2 | 3 | 1 | note | B3, E3 |  |

### Generated events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0.5 | 0.5 | note | C#5, C5, F5 |  |
| 1/1 | 1 | 0.5 | note | C#5, F#5, F5 |  |
| 1/1 | 1.5 | 0.25 | note | C#5, F#5, G#5 |  |
| 1/1 | 1.5 | 0.5 | note | A#5, D#5, F#5 |  |
| 1/1 | 2 | 0.5 | note | C6, F5, G#5 |  |
| 1/1 | 2.5 | 0.5 | note | C#5, F#5 |  |
| 1/1 | 2.5 | 0.25 | note | A#5, D#5, F#5 |  |
| 1/1 | 3 | 1 | note | C#5, F#5, F5 |  |
| 1/1 | 3 | 0.25 | note | G#5 |  |
| 2/2 | 0.5 | 0.5 | note | A3, B2, F3 |  |
| 2/2 | 1.5 | 0.5 | note | C#3, F#3 |  |
| 2/2 | 2 | 0.5 | note | D#3, G#3 |  |
| 2/2 | 2.5 | 0.5 | note | A3, F3 |  |

### Candidate geometry and packing

| Clef / voice evidence | Candidates | Stems / beams | X columns | Provisional onset→packed | Provisional duration→final | Flags |
|---|---|---|---|---|---|---|
| bass / lower:down:stemmed-sustain-or-quarter-voice:rg-8-6; lower:down:stemmed-sustain-or-quarter-voice:rg-8-7; lower:down:beamed-eighth-voice:rg-8-8 | n-8-3-545-820<br>n-8-4-545-840<br>n-8-5-545-866 | down / 0,0,1 | 545.38, 545.38, 545.38 | 3→2 | 1→2 | beamDurationAdjusted, beamDurationFloored, beamOnsetResnapped |
| treble / upper:down:stemmed-sustain-or-quarter-voice:rg-8-3; upper:up:stemmed-sustain-or-quarter-voice:rg-8-4; upper:up:stemmed-sustain-or-quarter-voice:rg-8-5 | n-8-0-545-693<br>n-8-1-545-706<br>n-8-2-545-719 | down, up / 0,0,0 | 545.38, 545.38, 545.38 | 3→2 | 1→2 | denseChordOnsetResnapped |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-8-11; upper:up:stemmed-sustain-or-quarter-voice:rg-8-9; upper:up:stemmed-sustain-or-quarter-voice:rg-8-10 | n-8-8-566-686<br>n-8-6-563-693<br>n-8-7-563-712 | up / 0,0,0 | 565.75, 563.32, 563.32 | 4→4 | 2→2 | — |
| bass / lower:down:stemmed-sustain-or-quarter-voice:rg-8-14; lower:down:beamed-eighth-voice:rg-8-15 | n-8-11-581-833<br>n-8-12-581-859 | down / 0,1 | 581.26, 581.26 | 6→6 | 1→2 | beamDurationAdjusted, beamDurationFloored |
| treble / upper:up:beam:rg-8-2; upper:up:stemmed-sustain-or-quarter-voice:rg-8-12; upper:up:stemmed-sustain-or-quarter-voice:rg-8-13 | n-8-13-584-680<br>n-8-9-581-686<br>n-8-10-581-706 | up / rg-8-2 | 583.69, 581.26, 581.26 | 6→6 | 1→1 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-8-16; upper:up:beam:rg-8-2 | n-8-16-600-673<br>n-8-14-599-686<br>n-8-15-599-699 | up / rg-8-2 | 599.59, 599.2, 599.2 | 7→6 | 1→2 | denseChordOnsetResnapped |
| bass / lower:down:beamed-eighth-voice:rg-8-19; lower:down:beamed-eighth-voice:rg-8-20 | n-8-20-617-827<br>n-8-21-617-853 | down / 1,1 | 617.14, 617.14 | 8→8 | 2→2 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-8-17; upper:up:beam:rg-8-1; upper:up:stemmed-sustain-or-quarter-voice:rg-8-18 | n-8-17-617-667<br>n-8-18-617-680<br>n-8-19-617-693 | up / rg-8-1 | 617.14, 617.14, 617.14 | 8→8 | 2→2 | — |
| bass / lower:down:beamed-eighth-voice:rg-8-25; lower:down:beamed-eighth-voice:rg-8-26 | n-8-27-653-820<br>n-8-28-653-846 | down / 1,1 | 653.02, 653.02 | 11→10 | 1→2 | beamDurationAdjusted, beamDurationFloored, beamOnsetResnapped |
| treble / upper:up:beam:rg-8-1; upper:up:stemmed-sustain-or-quarter-voice:rg-8-21; upper:down:stemmed-sustain-or-quarter-voice:rg-8-22 | n-8-22-635-673<br>n-8-23-635-686<br>n-8-24-635-699 | up, down / rg-8-1 | 635.08, 635.08, 635.08 | 10→10 | 1→1 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-8-23; upper:up:stemmed-sustain-or-quarter-voice:rg-8-24 | n-8-25-653-686<br>n-8-26-653-706 | up / 0,0 | 653.02, 653.02 | 11→10 | 1→2 | denseChordOnsetResnapped |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-8-27 | n-8-29-657-680 | up / 0 | 657.11 | 12→12 | 1→1 | — |
| treble / upper:up:stemmed-sustain-or-quarter-voice:rg-8-30; upper:up:stemmed-sustain-or-quarter-voice:rg-8-28; upper:up:stemmed-sustain-or-quarter-voice:rg-8-29 | n-8-32-675-686<br>n-8-30-671-693<br>n-8-31-671-712 | up / 0,0,0 | 675.05, 670.96, 670.96 | 13→12 | 4→4 | denseChordOnsetResnapped, perClefDurationAdjusted |

### First timing divergence

| Defect | MIDI | Expected→generated | First divergent stage | Candidates |
|---|---:|---|---|---|
| onset-mismatch | 75 | 1→1.5 | buildNoteEventsFromGroups: shared position/onset grid | n-8-16-600-673, n-8-14-599-686, n-8-15-599-699 |
| onset-mismatch | 82 | 1→1.5 | buildNoteEventsFromGroups: shared position/onset grid | n-8-16-600-673, n-8-14-599-686, n-8-15-599-699 |
| onset-mismatch | 78 | 2→1.5 | buildNoteEventsFromGroups: shared position/onset grid | n-8-13-584-680, n-8-9-581-686, n-8-10-581-706 |
| onset-mismatch | 80 | 2.5→2 | buildNoteEventsFromGroups: shared position/onset grid | n-8-17-617-667, n-8-18-617-680, n-8-19-617-693 |
| onset-mismatch | 82 | 2→2.5 | buildNoteEventsFromGroups: shared position/onset grid | n-8-22-635-673, n-8-23-635-686, n-8-24-635-699 |
| onset-mismatch | 75 | 3→2.5 | buildNoteEventsFromGroups: shared position/onset grid | n-8-22-635-673, n-8-23-635-686, n-8-24-635-699 |
| onset-mismatch | 80 | 3.5→3 | buildNoteEventsFromGroups: shared position/onset grid | n-8-29-657-680 |
| onset-mismatch | 73 | 3.5→3 | buildNoteEventsFromGroups: shared position/onset grid | n-8-32-675-686, n-8-30-671-693, n-8-31-671-712 |
| onset-mismatch | 77 | 3.5→3 | buildNoteEventsFromGroups: shared position/onset grid | n-8-32-675-686, n-8-30-671-693, n-8-31-671-712 |
| onset-mismatch | 47 | 0→0.5 | buildNoteEventsFromGroups: shared position/onset grid | n-8-3-545-820, n-8-4-545-840, n-8-5-545-866 |
| onset-mismatch | 49 | 1→1.5 | buildNoteEventsFromGroups: shared position/onset grid | n-8-11-581-833, n-8-12-581-859 |
| onset-mismatch | 72 | 0→0.5 | buildNoteEventsFromGroups: shared position/onset grid | n-8-0-545-693, n-8-1-545-706, n-8-2-545-719 |
| onset-mismatch | 77 | 1.5→1 | buildNoteEventsFromGroups: shared position/onset grid | n-8-8-566-686, n-8-6-563-693, n-8-7-563-712 |
| onset-mismatch | 77 | 2.5→2 | buildNoteEventsFromGroups: shared position/onset grid | n-8-17-617-667, n-8-18-617-680, n-8-19-617-693 |
| onset-mismatch | 53 | 0→0.5 | buildNoteEventsFromGroups: shared position/onset grid | n-8-3-545-820, n-8-4-545-840, n-8-5-545-866 |
| onset-mismatch | 57 | 1→0.5 | buildNoteEventsFromGroups: shared position/onset grid | n-8-3-545-820, n-8-4-545-840, n-8-5-545-866 |
| onset-mismatch | 57 | 2→2.5 | buildNoteEventsFromGroups: shared position/onset grid | n-8-27-653-820, n-8-28-653-846 |
| onset-mismatch | 53 | 3→2.5 | buildNoteEventsFromGroups: shared position/onset grid | n-8-27-653-820, n-8-28-653-846 |
| onset-mismatch | 78 | 3→2.5 | buildNoteEventsFromGroups: shared position/onset grid | n-8-22-635-673, n-8-23-635-686, n-8-24-635-699 |
| onset-mismatch | 73 | 0.5→1 | buildNoteEventsFromGroups: shared position/onset grid | n-8-8-566-686, n-8-6-563-693, n-8-7-563-712 |
| duration-mismatch | 80 | 0.5→0.25 | buildNoteEventsFromGroups: shared X-gap duration packing | n-8-13-584-680, n-8-9-581-686, n-8-10-581-706 |
| duration-mismatch | 51 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-8-20-617-827, n-8-21-617-853 |
| duration-mismatch | 82 | 0.5→0.25 | buildNoteEventsFromGroups: shared X-gap duration packing | n-8-22-635-673, n-8-23-635-686, n-8-24-635-699 |
| duration-mismatch | 75 | 0.5→0.25 | buildNoteEventsFromGroups: shared X-gap duration packing | n-8-22-635-673, n-8-23-635-686, n-8-24-635-699 |
| duration-mismatch | 80 | 0.5→0.25 | buildNoteEventsFromGroups: shared X-gap duration packing | n-8-29-657-680 |
| duration-mismatch | 73 | 0.5→1 | buildNoteEventsFromGroups: shared X-gap duration packing | n-8-32-675-686, n-8-30-671-693, n-8-31-671-712 |
| duration-mismatch | 77 | 0.5→1 | buildNoteEventsFromGroups: shared X-gap duration packing | n-8-32-675-686, n-8-30-671-693, n-8-31-671-712 |
| duration-mismatch | 47 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-8-3-545-820, n-8-4-545-840, n-8-5-545-866 |
| duration-mismatch | 49 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-8-11-581-833, n-8-12-581-859 |
| duration-mismatch | 78 | 0.5→1 | buildNoteEventsFromGroups: shared X-gap duration packing | n-8-32-675-686, n-8-30-671-693, n-8-31-671-712 |
| duration-mismatch | 53 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-8-3-545-820, n-8-4-545-840, n-8-5-545-866 |
| duration-mismatch | 57 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-8-3-545-820, n-8-4-545-840, n-8-5-545-866 |
| duration-mismatch | 57 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-8-27-653-820, n-8-28-653-846 |
| duration-mismatch | 53 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-8-27-653-820, n-8-28-653-846 |
| duration-mismatch | 78 | 0.5→0.25 | buildNoteEventsFromGroups: shared X-gap duration packing | n-8-13-584-680, n-8-9-581-686, n-8-10-581-706 |
| duration-mismatch | 78 | 0.5→0.25 | buildNoteEventsFromGroups: shared X-gap duration packing | n-8-22-635-673, n-8-23-635-686, n-8-24-635-699 |

## guitar-paired-chords-vector — measure 1

- Page/system: 1 / 0
- Meter capacity: 4 quarters (16 internal divisions)
- Primary mechanism: **stem/beam evidence lost before duration assignment**
- Mismatches: onset 5, duration 8, chord 0, missing 0, extra 4, missing rests 0
- Truth voice ends: {"1:1":4}
- Rest evidence: detected 0, emitted 0

### Expected events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 1 | note | C4, E4, G3 |  |
| 1/1 | 1 | 1 | note | C4, E4 |  |
| 1/1 | 2 | 1 | note | C4, E4, G3 |  |
| 1/1 | 3 | 1 | note | C4, E4 |  |

### Generated events by voice

| Voice/staff | Onset | Duration | Type | Pitches | Tie |
|---|---:|---:|---|---|---|
| 1/1 | 0 | 0.5 | note | C4, E4, G3 |  |
| 1/1 | 0.5 | 0.5 | note | C4, E4 |  |
| 1/1 | 1.25 | 0.5 | note | C4, E4, G3 |  |
| 1/1 | 2 | 1 | note | C4, E4 |  |
| 1/1 | 3.5 | 0.25 | note | A3, D3, D4, G4 |  |

### Candidate geometry and packing

| Clef / voice evidence | Candidates | Stems / beams | X columns | Provisional onset→packed | Provisional duration→final | Flags |
|---|---|---|---|---|---|---|
| treble / upper:down:stemmed-sustain-or-quarter-voice:rg-1-2; upper:down:beamed-eighth-voice:rg-1-3; upper:up:stemmed-sustain-or-quarter-voice:rg-1-4 | n-1-0-191-296<br>n-1-1-191-309<br>n-1-2-191-328 | down, up / 0,1,0 | 190.54, 190.54, 190.54 | —→0 | —→2 | — |
| treble / upper:down:beam:rg-1-1; upper:unknown-stem:unattached-or-rest-like-notehead:rg-1-10 | n-1-3-217-296<br>n-1-4-217-309 | down / rg-1-1 | 217.45, 217.45 | —→2 | —→2 | beamDurationAdjusted |
| treble / upper:down:beam:rg-1-1; upper:down:beamed-eighth-voice:rg-1-5; upper:unknown-stem:unattached-or-rest-like-notehead:rg-1-11 | n-1-5-244-296<br>n-1-6-244-309<br>n-1-7-244-328 | down / rg-1-1 | 244.36, 244.36, 244.36 | —→5 | —→2 | beamDurationAdjusted |
| treble / upper:down:stemmed-sustain-or-quarter-voice:rg-1-6; upper:unknown-stem:unattached-or-rest-like-notehead:rg-1-12 | n-1-8-271-296<br>n-1-9-271-309 | down / 0,0 | 271.27, 271.27 | —→8 | —→4 | perClefDurationAdjusted |
| treble / upper:down:beamed-eighth-voice:rg-1-7; upper:down:stemmed-sustain-or-quarter-voice:rg-1-8; upper:down:stemmed-sustain-or-quarter-voice:rg-1-9; upper:unknown-stem:unattached-or-rest-like-notehead:rg-1-13 | n-1-10-346-283<br>n-1-11-346-302<br>n-1-12-346-322<br>n-1-13-346-348 | down / 1,0,0,0 | 346.03, 346.03, 346.03, 346.03 | —→14 | —→1 | beamDurationAdjusted, beamDurationFloored, beamOnsetResnapped |

### First timing divergence

| Defect | MIDI | Expected→generated | First divergent stage | Candidates |
|---|---:|---|---|---|
| onset-mismatch | 60 | 1→1.25 | buildNoteEventsFromGroups: shared position/onset grid | n-1-5-244-296, n-1-6-244-309, n-1-7-244-328 |
| onset-mismatch | 64 | 1→1.25 | buildNoteEventsFromGroups: shared position/onset grid | n-1-5-244-296, n-1-6-244-309, n-1-7-244-328 |
| onset-mismatch | 55 | 2→1.25 | buildNoteEventsFromGroups: shared position/onset grid | n-1-5-244-296, n-1-6-244-309, n-1-7-244-328 |
| onset-mismatch | 62 | 3→3.5 | buildNoteEventsFromGroups: shared position/onset grid | n-1-10-346-283, n-1-11-346-302, n-1-12-346-322, n-1-13-346-348 |
| onset-mismatch | 67 | 3→3.5 | buildNoteEventsFromGroups: shared position/onset grid | n-1-10-346-283, n-1-11-346-302, n-1-12-346-322, n-1-13-346-348 |
| duration-mismatch | 55 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-1-0-191-296, n-1-1-191-309, n-1-2-191-328 |
| duration-mismatch | 60 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-1-0-191-296, n-1-1-191-309, n-1-2-191-328 |
| duration-mismatch | 64 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-1-0-191-296, n-1-1-191-309, n-1-2-191-328 |
| duration-mismatch | 60 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-1-5-244-296, n-1-6-244-309, n-1-7-244-328 |
| duration-mismatch | 64 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-1-5-244-296, n-1-6-244-309, n-1-7-244-328 |
| duration-mismatch | 55 | 1→0.5 | buildNoteEventsFromGroups: shared X-gap duration packing | n-1-5-244-296, n-1-6-244-309, n-1-7-244-328 |
| duration-mismatch | 62 | 1→0.25 | buildNoteEventsFromGroups: shared X-gap duration packing | n-1-10-346-283, n-1-11-346-302, n-1-12-346-322, n-1-13-346-348 |
| duration-mismatch | 67 | 1→0.25 | buildNoteEventsFromGroups: shared X-gap duration packing | n-1-10-346-283, n-1-11-346-302, n-1-12-346-322, n-1-13-346-348 |

## Phase 1 conclusions

- Vector note groups receive one shared horizontal onset grid before mixed clefs are split. Per-clef duration extension occurs later and cannot restore a correct independent timeline.
- The provenance repeatedly shows wrong provisional durations at `buildNoteEventsFromGroups`; later beam floors, per-clef extension, reconstruction, and clamps are recovery heuristics acting after the first divergence.
- Rest-bearing measures lose explicit silence when the rest glyph is absent or skipped, so the shared sequence collapses into the occupied horizontal columns.
- Dense resnapping is downstream. It can move whole chord events safely, but it cannot infer which same-staff or cross-staff voice owns the remaining meter capacity.
- No representative trace first diverged in a clamp/resnap stage, and no aligned hotspot exposed an isolated chord split. Those mechanisms remain required negative controls, not evidence-backed production targets.
- Rest collapse was observed only in single-voice frozen truth. It is real, but it is adjacent to—not proof for—the joint polyphonic packer.
- The frozen corpus has extensive paired-staff overlap but only one direct semantic voice mismatch; same-staff opposing-voice behavior therefore needs synthetic geometry controls before any production rule is attempted.

Machine-readable detail: `failure-map.json`.
