# Joint Polyphonic Rhythm Packing Campaign

## Outcome

Accepted. A conservative joint-lane rhythm packer materially improves the
frozen semantic corpus without changing detection, pitch, staff ownership,
MusicXML evaluation, truth data, thresholds, or comparison logic.

- Baseline commit: `7d4d5df`
- Evaluator: frozen 2.0.0
- Schema: 2
- Frozen fixtures: 9/9 passed
- Corpus acceptance gate: **ACCEPT**
- Fixture gate regressions: **none**

## Phase 1 failure map

The complete pre-change trace is in
`tmp/omr-polyphonic-rhythm/PHASE_1_FAILURE_MAP.md`; its structured companion is
`tmp/omr-polyphonic-rhythm/failure-map.json`.

The trace followed PDF geometry through detected noteheads, stems, beam
topology, provisional note groups, per-clef duration recovery, chord
coalescing, rhythm packing, and final MusicXML for 12 representative measures.
The first recurring divergence was the shared X-derived onset/duration grid:
it was created before independent voice timelines were proven. Later
per-clef recovery could alter durations but could not reconstruct both
complete meter timelines.

## Ranked root causes

Counts below are overlapping event/chord symptoms in the representative trace
set, not evaluator-wide independent totals.

| Rank | Mechanism | Mismatches explained | Fixtures | Measures | Evidence | Regression risk |
|---:|---|---:|---:|---:|---|---|
| 1 | stem/beam evidence lost before duration assignment | 158 | 5 | 11 | high | high |
| 2 | voices packed as one shared sequence | 130 | 3 | 8 | high | high |
| 3 | one voice spacing stretches another voice durations | 100 | 2 | 6 | high | high |
| 4 | onset alignment error masquerading as missing/extra notes | 95 | 2 | 3 | high | medium |
| 5 | sustained voice steals timing capacity from moving voice | 44 | 2 | 6 | medium-high | high |
| 6 | missing rests cause onset collapse | 14 | 1 | 3 | high | high |
| 7 | chords split during voice packing | 0 | 0 | 0 | not observed in corpus; retained as a synthetic guard | high |
| 8 | meter overflow triggers destructive resnapping | 0 | 0 | 0 | not observed in corpus; retained as a synthetic guard | high |

## Accepted production change

The accepted model is reject-by-default:

1. It activates only when paired staff lanes are present, or when sustained
   opposing-stem continuity proves separate same-staff voices.
2. It keeps independent timelines per lane and requires every proposed lane to
   fill the meter exactly.
3. It prefers complete written-duration evidence; otherwise it derives a
   standard rhythmic grid from relative X gaps within that lane.
4. It aligns lane openings but does not force voices onto one shared sequence.
5. It coalesces near-identical X columns only within one proven lane, preserving
   every chord tone and refusing conflicting stem directions.
6. It preserves note and rest counts and rejects negative, out-of-meter,
   incomplete, or ambiguous proposals.
7. Detected rests are placed before joint repacking, so visual rest evidence is
   neither displaced nor deleted by an earlier note-only correction.

The packer does not modify pitches, accidentals, ties, staff assignment, note
detection thresholds, evaluator behavior, or truth data.

## Focused geometry fixtures

All 10 requested fixtures fail without the new joint packer and pass with it.

| Fixture | Guarded behavior |
|---|---|
| half notes against four quarters | independent complete timelines |
| whole note against moving eighths | preserved sustain |
| explicit rests against a moving voice | rest ownership and count |
| opposing stems at one onset | separate voice lanes |
| beamed upper voice over sustained lower voice | beam and notehead evidence used jointly |
| independently moving chord voices | no voice merge |
| dotted sustain against shorter events | written dotted duration retained |
| split chord fragments | all tones coalesced into one lane event |
| ambiguous assignment | input returned unchanged |
| out-of-meter overflow | no destructive dense resnap |

Focused regression result: 109/109 passed across the new fixture suite and
adjacent rhythm/chord structure suites.

## Candidate history

| Candidate | Result | Decision |
|---|---|---|
| independent paired-lane packing | Overall 66.24%, Rhythm 71.67%; onset 218, duration 171 | retained and refined |
| exact-start chord coalescing | Overall 66.25%, Rhythm 71.73%; duration 170 | retained and generalized to near-identical geometry |
| near-X lane chord coalescing with conservative paired-staff ownership | Overall 66.74%, Rhythm 74.52%; onset 175, duration 102 | retained |
| rest-preserving integration | same corpus metrics; real-score detected-rest application restored to baseline | accepted final |

Rejected experiments:

- Broad opposing-stem splitting inside paired-staff measures was rejected
  because noisy stem direction could create false voices.
- Packing notes before placing detected rests was rejected after a real-score
  audit showed seven fewer applied rest glyphs. Packing now happens only after
  visual rests claim their slots.
- Missing-rest synthesis and global tolerance/threshold changes were rejected
  because the available geometry did not support them.

## Frozen corpus results

| Metric | Baseline | Final | Delta |
|---|---:|---:|---:|
| Overall | 65.69% | **66.74%** | +1.05 pp |
| Pitch | 65.68% | **66.22%** | +0.53 pp |
| Rhythm | 68.25% | **74.52%** | +6.27 pp |
| Sustain | 55.56% | **55.56%** | 0 |
| Articulation | 85.36% | **85.84%** | +0.48 pp |
| Measure structure | 71.61% | **71.69%** | +0.08 pp |

| Defect | Baseline | Final | Delta |
|---|---:|---:|---:|
| onset-mismatch | 256 | **175** | -81 |
| duration-mismatch | 235 | **102** | -133 |
| incorrect-chord | 196 | **195** | -1 |
| missing-note | 152 | **136** | -16 |
| extra-note | 128 | **112** | -16 |
| split-measure | 4 | **4** | 0 |
| incorrect-pitch | 167 | 178 | +11 matcher reclassification |

The incorrect-pitch count increase is not a production pitch regression:
pitch content is untouched, the Pitch score improves by 0.53 percentage
points, and missing/extra notes each fall by 16. Corrected timing lets the
evaluator pair more existing wrong-pitch notes instead of classifying them as
separate missing and extra notes.

The largest target improvements are:

- dense polyphonic piano: Rhythm +44.95 percentage points
- grand-staff voices: Rhythm +11.49 percentage points to 100%

All sparse, monophonic, Guitar, and TAB corpus fixtures remain at their
baseline scores.

## Real-score validation

The “before” runs used an isolated archive of commit `7d4d5df`; the “after”
runs used the accepted candidate. Both scores remained accepted with the same
single standard PDF-OMR disclaimer and no new warning.

| Score profile | Measures | Notes | Events | Chords | Rests | Tie starts/stops | Playback | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| sustained overlapping voices | 25→25 | 138→138 | 93→93 | 25→25 | 6→6 | 5/5→5/5 | 83.3333s→83.3333s | exact structural control |
| dense polyphonic piano | 49→49 | 802→802 | 713→713 | 144→144 | 77→77 | 0/0→0/0 | 105s→105s | exact structural control |

Per-voice event counts and duration totals were also exact:

- sustained score: 39/94.5q, 25/75q, 25/50q, and 4/12q
- dense score: 247/135.5q, 454/167q, and 12/3.75q

Every per-voice onset-distribution histogram was unchanged. Visual rest
evidence was preserved exactly:

- sustained score: 31 detected, 6 applied, 25 overlap-rejected before and after
- dense score: 102 detected, 77 applied, 25 rejected before and after

The complete before/after distributions are recorded in
`tmp/omr-polyphonic-rhythm/real-scores/baseline.json` and
`tmp/omr-polyphonic-rhythm/real-scores/candidate-4.json`.

## Validation

- Focused joint/adjacent rhythm and structure tests: **109 passed**
- Frozen semantic corpus: **9/9 passed**, acceptance gate passed
- Full unit suite: **2,777 passed, 5 skipped**
- Protected Guitar/TAB, playback/audio, tie, accidental, report/export, and
  performance bundle: **154 passed**
- Production build: **passed**
- Focused source lint: **passed**
- Evaluator 2.0.0/schema 2: **unchanged**
- Frozen thresholds, truth data, expected outputs, comparison logic: **unchanged**

## Remaining bottlenecks

The corrected dense measures now contain meter-complete independent lane
timelines. Much of their remaining apparent onset mass is coupled to wrong
pitch matching: the evaluator pairs a different detected pitch once timing is
fixed. Remaining corpus rhythm errors are concentrated in tuplets, missing
rest detection, guitar/TAB timing, pitch/staff inference, and split-measure
alignment.

Further gains would require stronger voice identity across measures,
cross-staff ownership, explicit rest detection, tuplet structure, or joint
pitch/timing matching. Those are larger architectural campaigns and were not
expanded into this focused change.

## Commit scope

Only the following production/test files are intended for commit:

- `src/features/omr/jointPolyphonicRhythm.js`
- `src/features/omr/processVectorOmrPage.js`
- `tests/omrJointPolyphonicRhythm.test.js`

All temporary traces, generated MusicXML, real-score diagnostics, local
scripts, user PDFs, images, and private paths are excluded.
