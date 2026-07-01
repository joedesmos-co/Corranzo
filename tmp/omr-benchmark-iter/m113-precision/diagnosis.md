# m113 Pure Chord Diagnosis

Generated: 2026-07-01

## Measure stats (runtime baseline)

| Metric | Value |
| --- | ---: |
| Chord mismatch | 12 |
| Wrong pitch / onset / missing / extra | 0 / 0 / 0 / 0 |
| Wrong duration | 2 (onset-matched; F5 1q→0.25q, bass G2 0.5q→1q) |

**Note:** m113 is *mostly* a chord-grouping problem, but two duration errors remain after chord repair (evaluator uses matched onsets).

## Failure classification

**Primary:** event reconstruction / onset-column assignment (vector rhythm), **not** MusicXML backup/forward or evaluator artifact.

**Secondary:** inner-voice phase correction (m33 rule) applies to beats 2.5–3.5 but does **not** change chord count; it is not the root cause.

**Not:** detection loss (26/26 notes match), pitch mapping, or phantom-column Family B.

## Pipeline funnel

| Stage | m113 chord | Opening columns (div → note count) |
| --- | ---: | --- |
| 1. Raw vector events | **12** | 0→1, **1→6**, 4→1, 6→1, 8→5, 10→1, 11→5, 13→1, 14→5 |
| 2. After inner-voice (+1 div on 10–14) | **12** | same opening; mid-measure 10/11→11/12, 13/14→14/15 |
| 3. After phantom-column | **12** | unchanged (not a phantom signature) |
| 4. MusicXML / evaluator | **12** | truth@0 wants **7** notes; gen@0 has **1**, gen@0.25 has **6** |

Chord examples:

- truth onset **0.00**: 7 notes → generated onset **0.00**: 1 note
- generated-only onset **0.25**: 6 notes (phantom split)

## Mechanism

Vector x-slot snapping places the top lead tone (F5) on div **0** while the rest of the opening harmony lands on div **1** (+0.25q). Evaluator chord tolerance is 0.08q, so the split becomes a hard chord mismatch even though all pitches match.

Inner-voice window on raw columns: div 10–14 `{1,5,1,5}` — valid m33-like pattern, but fixing it alone leaves all 12 opening chord errors.

## Simulation result

**Strategy:** merge lone div-0 column into adjacent div≤1 stack (≥4 notes) before inner-voice / phantom / terminal corrections.

| Metric | Before | After | Δ |
| --- | ---: | ---: | ---: |
| Dense chord | 201 | 189 | **−12** |
| m113 chord | 12 | 0 | **−12** |
| Dense onset / duration / pitch | 94 / 93 / 147 | unchanged | 0 |
| Clean | 100% all | unchanged | 0 |
| Applied measures | — | **m113 only** | — |

## Verdict

Narrow generic fix **passes** promotion gates. Root cause is opening lead-note column split at vector event reconstruction; repair is forward-merge of the solo lead into the adjacent stack onset.

Machine-readable funnel: `tmp/omr-benchmark-iter/m113-precision/diagnosis.json`
