# OMR Semantic Defect Taxonomy

Date: 2026-07-17  
Status: **Active — guides validation and prioritization**

## Why this exists

On real scores, OMR often finds the right pitches while playback still sounds wrong.
The dominant failures are musical semantics: durations, rests, ties, and articulations.
Pitch remains tracked, but it is no longer the default first investigation target when
timing and expression are broken.

## Classes

| Class | ID | What it covers |
| --- | --- | --- |
| Rhythm | `rhythm` | Note durations (whole→16th, dotted), multi-voice duration consistency, rest duration/placement, measure balancing, onsets, tuplets |
| Sustain (ties) | `sustain` | Tie detection, cross-measure sustain, tie vs slur discrimination |
| Articulation | `articulation` | Staccato, accent, tenuto, marcato (and slur marks that are not sustain) |
| Measure structure | `measure-structure` | Barlines, measure count, voice lanes, chord grouping, extra/missing notes |
| Interpretation | `interpretation` | Repeats, voltas, D.C., D.S., coda, segno, tempo changes |
| Dynamics | *(future store)* | `p`/`pp`/`mp`/`mf`/`f`/`ff`, cresc./dim. — recognize before playback. Sprint 1 recognition + MusicXML emission landed (`detectOmrDynamics.js`); scored via independent harness until evaluator gains a Dynamics class. |
| Playback | `playback` | Engine timeline, written vs sounding duration, expression mapping after recognition |
| Pitch | `pitch` | Staff position, accidentals, octave, key signature |

## Priority when pitches are mostly correct

1. **Rhythm**
2. **Sustain (ties)**
3. **Articulation**
4. **Measure structure**
5. **Interpretation**
6. **Dynamics** (recognition store; evaluator class TBD — do not retune evaluator mid-sprint)
7. **Playback**
8. **Pitch**

Use this order for sprint selection and for reading dashboard roll-ups. Do not start
pitch-only work when the largest semantic class is rhythm or sustain.

Canonical process: `docs/OMR_RECOGNITION_QUALITY.md`.

## Highest-priority recognition improvements

### 1. Note durations
- Whole, half, quarter, eighth, sixteenth
- Dotted values
- Multi-voice duration consistency

### 2. Rests
- Correct duration
- Correct placement
- Measure balancing

### 3. Ties
- Reliable detection
- Sustain across measures
- Distinguish ties from slurs

### 4. Articulations
- Staccato, accent, tenuto, marcato

## How it maps onto existing metrics

Fine-grained named buckets still exist (`pitch`, `duration`, `onset`, `ties`, `rests`, …).
The semantic layer rolls them up:

| Named bucket / signal | Semantic class |
| --- | --- |
| `pitch`, `accidentals` | Pitch |
| `duration`, `onset`, `tuplets`, `rests` | Rhythm |
| `ties`; duration categories `tie-sustain`, `bass-sustain` | Sustain |
| `slurs`; staccato/accent detect−apply gaps | Articulation |
| `chord`, `extra/missing-notes` | Measure structure |
| Playback engine / sounding-duration mismatches | Playback |

Implementation: `src/features/omr/omrSemanticDefectClass.js`  
Surfaced on: accuracy error grouping + benchmark dashboard (`semanticDefectClasses`).

## Validation rule

When filing or ranking an OMR defect:

1. Assign exactly one primary semantic class from the table above.
2. Note secondary classes only if they are independent failures (e.g. wrong pitch *and* wrong duration on different notes).
3. Prefer fixing the highest-priority class that explains the perceived playback failure.
4. Keep V2 authoritative / recognition-gate policy unchanged unless a class-specific plan says otherwise.

## Semantic MusicXML evaluator

Primary objective measurement tool for future OMR work. Hardened docs:

[`OMR_SEMANTIC_EVALUATOR.md`](./OMR_SEMANTIC_EVALUATOR.md)

```bash
node scripts/evaluate-omr-semantic.mjs --truth gt.musicxml --generated omr.musicxml
node scripts/evaluate-omr-semantic.mjs --self-check gt.musicxml --mode written
```

Does **not** change recognition — measurement only. Do not start rhythm/tie
recognition sprints until self-check + golden fixtures pass.
