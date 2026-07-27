# Rhythm Sprint 2 — Report

**ACCEPT: YES** (frozen evaluator 2.0.0 / schema 2)

Before: `tmp/after-rhythm-sprint-1.json` (post–Sprint 1)  
After: `tmp/after-rhythm-sprint-2.json`  
Delta: `tmp/after-rhythm-sprint-2-delta.txt`  
RCA: `tmp/rhythm-sprint-2-onset-rca/RCA.md`

## Root causes

### Onset mismatches (~70% class A)
Previous-note **duration → onset cascades**: gap-primary packing invented `durationDivisions=1` on notes with primary beams (`beams=1`). Sprint 1 only **capped** long gaps; it never **floored** short ones, so beamed eighths stayed sixteenths and shifted the measure cursor.

### True sixteenths
`countBeams` returned only 0/1 (tip-row scan). No secondary-beam / flag path. Sixteenths must not use tip-row `beamStrength≥14`.

### Rejected / rolled-back approaches
- Forcing primary-beamed notes onto an eighth onset grid globally → large Q→eighth regressions (beginner −19pp, grand −16pp).
- Always-on beam refine outside dense measures → false tip-row beams capped true quarters.

## Recognition changes

| Change | File |
| --- | --- |
| Secondary-beam row scan → `beams=2` | `detectNoteRhythmFeatures.js` (`hasSecondaryBeamRow`, `countBeams`) |
| Beam duration **floor** (primary → ≥eighth; secondary → ≥16th) | `processVectorOmrPage.js` (`inferredBeamDurationFloor`, `refineEventDurationsFromBeamEvidence`) |
| Cap/floor require **explicit `beams≥1`**, not strength alone | `inferredBeamDurationCap` / floor |
| Resnap odd onsets after flooring | `resnapFlooredBeamOnsets` (dense measures only) |

Evaluator untouched. No TAB / tuplet / rest / architecture work.

## Scoreboard (Sprint 1 → Sprint 2)

| Metric | Before | After | Δ |
| --- | ---: | ---: | ---: |
| Overall | 50.0% | 50.2% | **+0.18 pp** |
| **Rhythm** | **58.5%** | **59.8%** | **+1.35 pp** |
| Pitch | 16.5% | 16.4% | −0.06 pp |
| Sustain | 55.8% | 55.8% | 0 |
| Articulation | 68.5% | 68.5% | 0 |
| Measure structure | 50.6% | 50.6% | −0.01 pp |
| Interpretation | 0.0% | 0.0% | 0 |

Vs original freeze baseline: Rhythm **56.8% → 59.8%** (+3.0 pp).

## Defect counts

| Defect | Sprint 1 | Sprint 2 | Δ |
| --- | ---: | ---: | ---: |
| duration-mismatch | 169 | **148** | **−21** |
| onset-mismatch | 145 | **132** | **−13** |

## Per-fixture Rhythm

| Fixture | Before | After | Δ |
| --- | ---: | ---: | ---: |
| piano-dense-advanced-vector | 30.2% | 38.5% | **+8.28 pp** |
| piano-rhythm-tuplets-vector | 47.7% | 51.6% | **+3.90 pp** |
| all others | — | — | 0 |

## Regressions

None >1 pp. Pitch −0.06 pp (pairing noise from onset coalesce); not a trade-off concern.

## Remaining dominant onset patterns

1. **TAB packing** (`guitar-tab-sparse`, onset×23) — separate `buildTabTimingBuckets` path  
2. **Chord sequentialization** on dense (class C) — still split chord members  
3. **Tuplets 3:2** (m3) — not addressed  
4. **Rests** shifting articulation-scan timeline  
5. **True flags / partial beams** — secondary-beam row helps double beams; flags still unimplemented  

Next sprint candidates: TAB slot packing, chord onset merge, flag detection, tuplets.
