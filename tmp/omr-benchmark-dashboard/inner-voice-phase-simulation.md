# Inner-voice solo/stack phase correction — simulation report

**Policy:** simulation only — no runtime changes shipped  
**Artifacts:** `tmp/omr-benchmark-iter/inner-voice-phase-narrow/`

## Narrow slice (stack ≥ 5 notes) — **passes acceptance**

Stricter detector: alternating `{solo, stack}+` with **stack columns ≥ 5 notes**, same local guards (beat ≥ 2, sixteenth spacing, no solo beam evidence, measure-end trim).

| Fixture | Chord Δ | Onset Δ | Pitch Δ | Duration Δ |
|---------|--------:|--------:|--------:|-----------:|
| dense | **−18** | **0** | 0 | 0 |
| clean | 0 | 0 | 0 | 0 |

### Targets & controls

| Measure | Chord | Onset | Verdict |
|---------|-------|-------|---------|
| **m33** | 18 → **0** | 0 | Clean win |
| m61 | unchanged | unchanged | Skipped (4-note stacks) |
| m7 / m25 / m34 | unchanged | unchanged | Controls stable |

Also applied on **m113** (same `{1,5,1,5}` figure; chord already correct, no regression).

## Full slice (stack ≥ 3 notes) — do not promote

See `tmp/omr-benchmark-iter/inner-voice-phase/`. Chord −42 but onset +3 from m61 side effect.

## Recommendation: ship narrow runtime slice

After `buildNoteEventsFromGroups`, on cloned measure events:

1. Extract onset columns from beat 2 onward.
2. Detect `{1, ≥5}+` solo/stack runs with sixteenth spacing and no solo beam evidence.
3. Trim trailing solo if shift would cross barline.
4. Shift matched window **+1 division (+0.25q)** before MusicXML serialization.

**Gate:** dense chord improves, wrong-onset/pitch/duration unchanged, clean unchanged.

Run: `node scripts/simulate-inner-voice-phase.mjs` (defaults to `minStackNotes: 5`)
