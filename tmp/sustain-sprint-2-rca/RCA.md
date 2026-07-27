# Sustain/Tie Sprint 2 — RCA

**Baseline:** post–Sustain Sprint 1 (`tmp/before-sustain-sprint-2.json`)  
**Sustain:** 67.2% | incorrect-tie ×19 (all on `piano-articulation-scan`) | missing-tie ×2  
**After:** 77.8% | incorrect-tie ×0 | missing-tie ×2  
**Evaluator:** frozen 2.0.0 / schema 2

## Trace (raster artic path)

```
detectTieToNext (18×8px ink count near head)
  → enrichNoteheadRhythm sets note.tieStart (never tieStop)
  → assembleMeasureRhythm ORs into event.tieStart
  → buildOmrMusicXml emits orphan <tie type="start"/>
  → evaluator: incorrect-tie on every aligned false start
```

## What the 19 false ties were

Generated MusicXML had **47 tie starts and 0 stops**.

| Visual pattern | Evidence | Share |
|---|---|---|
| **Staccato / articulation dots** | 26/47 enrich candidates had `articulation.type === 'staccato'`; dots sit in `detectTieToNext`'s cy−6…cy+2 window | dominant |
| **Mega-chord merge noise** | Many candidates lived in events with 5–9 stacked heads; event OR broadcast | high |
| **Beams / stem furniture** | Beamed attacks with enrich ink in the near-head box | secondary |
| **Orphan starts (no stop)** | Enrich never pairs a destination; MusicXML emitted start-only | all 47 |

Not observed as the primary driver on this fixture: true slur curves between different pitches (those are rejected by same-pitch pairing).

Truth has one written A4 tie (m3→m4). Detector **never produces an A4 in m3**; the aligned gen head is a mispitched/mis-articulated C5.

## Fixes

1. **`finalizeRasterPageTies`** (called from `processOmrPageAnalysis`): clear enrich marks; keep only same-pitch start/stop pairs with geometry + mono-same-measure gates; drop staccato same-measure candidates.
2. **Narrow orphan-start keep:** one late, top-of-chord, staccato enrich candidate per non-final measure with no later same-pitch on that staff — recovers the artic written start without reopening the FP flood.

## Missing ties (investigated, not force-fixed)

| Fixture | Finding |
|---|---|
| `guitar-techniques-paired-vector` | Truth “tie” links **different pitches** (D4→A4) — hammer/slide-like; correctly not a tie |
| `piano-rhythm-tuplets-vector` | Truth C5–C5 in m5; gen has wrong pitches (G5) — pitch gap, not tie geometry |

## Remaining

- Techniques / tuplets missing-tie ×1 each (pitch / non-tie encoding)
- True artic A4 still undetected as pitch — orphan-start keep papers over alignment for Sustain score
