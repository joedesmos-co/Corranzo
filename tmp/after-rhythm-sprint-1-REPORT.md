# Rhythm Sprint 1 — Report

**ACCEPT: YES** (frozen evaluator 2.0.0 / schema 2, written mode, 9/9 fixtures)

Artifacts:
- `benchmarks/omr-semantic/baseline.json` (before)
- `tmp/after-rhythm-sprint-1.json` / `.txt`
- `tmp/after-rhythm-sprint-1-delta.json` / `.txt`
- RCA notes: `tmp/rhythm-sprint-2-rca/RCA.md`

## Root cause

**Saturated tip-row `beamStrength` misclassified as sixteenth**, and `countBeams` rejected strength > 22.

Pipeline stage: *rhythmic symbol classification* (beam/flag interpretation), cascading into onset/duration assignment because beam caps never fired.

Trace (dense / tuplets representative measures):

1. Noteheads detected (vector glyphs OK)
2. Stems found
3. `measureBeamStrength` saturates at ~29 on continuous primary beams
4. `inferNoteDuration` treated `beamStrength >= 14` as **sixteenth**
5. `countBeams` returned **0** when strength > 22
6. `beamStrength` was **not persisted** on the note → `hasBeamEvidenceForNotes` / gap caps missed
7. Gap-primary event builder + `durationMeta` emitted 16ths / stretched quarters
8. MusicXML carried wrong durations → `duration-mismatch` (+ coupled `onset-mismatch`)

Not fixed in this sprint (separate root causes):
- TAB slot packing (`guitar-tab-sparse`)
- Tuplet 3:2 recognition
- Grand-staff penultimate half heuristic (partially helped via beam caps)

## Recognition change

Files:
- `src/features/omr/detectNoteRhythmFeatures.js`
- `src/features/omr/processVectorOmrPage.js` (`inferredBeamDurationCap` only)

Changes:
1. `countBeams` — accept saturated primary beams (remove strength > 22 reject)
2. `inferNoteDuration` — high tip-row strength → **eighth**; sixteenths require `beams >= 2`
3. Persist `beamStrength` on enriched notes
4. Beam duration cap: strength alone no longer caps at sixteenth

No evaluator changes. No measure-balancing stretch heuristics.

## Scoreboard

| Metric | Before | After | Δ |
| --- | ---: | ---: | ---: |
| Overall | 49.7% | 50.0% | **+0.25 pp** |
| **Rhythm** | **56.8%** | **58.5%** | **+1.73 pp** |
| Pitch | 16.5% | 16.5% | 0 |
| Sustain | 55.8% | 55.8% | 0 |
| Articulation | 68.5% | 68.5% | 0 |
| Measure structure | 50.6% | 50.6% | 0 |
| Interpretation | 0.0% | 0.0% | 0 |

## Rhythm defect counts (corpus topDefects roll-up)

| Defect | Before | After | Δ |
| --- | ---: | ---: | ---: |
| duration-mismatch | 182 | 169 | **−13** |
| onset-mismatch | 145 | 145 | 0 |
| extra-rest | 16 | 16 | 0 |
| tuplet-mismatch | 10 | 10 | 0 |

## Per-fixture Rhythm

| Fixture | Before | After | Δ |
| --- | ---: | ---: | ---: |
| piano-grand-voices-vector | 53.1% | 65.6% | **+12.50 pp** |
| piano-dense-advanced-vector | 27.9% | 30.2% | **+2.32 pp** |
| piano-rhythm-tuplets-vector | 46.9% | 47.7% | **+0.78 pp** |
| others | — | — | 0 |

## Regressions

None in any semantic class (all flat except rhythm/overall).

## Next sprint candidates

1. TAB duration packing (`guitar-tab-sparse` still 17%)
2. Secondary-beam / flag detection for true sixteenths (without reintroducing tip-row false 16ths)
3. Onset cascade once durations stabilize on dense scores
4. Tuplets (still ×10)
5. Rest placement (`extra-rest` ×16)
