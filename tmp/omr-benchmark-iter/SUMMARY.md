# OMR benchmark iteration — opening beat alignment

## Weakness identified
Dense score (Cruel Angel) primary error source: **rhythm inference** (89% confidence).
Opening note columns with `positionInMeasure` ~0.06–0.12 were snapped to division 2 (beat ½)
instead of beat 0, causing ~300+ onset errors (`onsetDiffQuarters: 0.5`).

## Fix (generic)
`alignOpeningGroupStart()` in `processVectorOmrPage.js`:
- When position-based rhythm is active, snap the leftmost group to beat 0 if its snapped
  division is ≤ eighth grid and visual position is within the opening beat fraction.
- Preserve pre-align grid spacing for **duration** (`rhythmStarts`) so onset correction
  does not inflate the first note length.

## Results

| Metric | Gymnopédie (clean) | Cruel Angel (dense) |
|--------|-------------------|---------------------|
| measures Δ | 0 → 0 | +2 → +2 |
| onset | 99.15% → 99.15% | **46.55% → 57.12%** (+10.6pp) |
| duration | 98.51% → 98.51% | 65.37% → 64.63% (−0.7pp) |
| pitch | 98.51% → 98.51% | 22.88% → 22.95% |
| chord | 98.73% → 98.73% | 47.69% → 47.69% |
| F1 | 99.36% → 99.36% | 88.23% → 88.08% |

Wrong onset count: 1117 → 816 (−301). Wrong duration: 588 → 605 (+17).

## Preserved
Barline filtering, measure grid (+2), vector rhythm, accidentals, clean-score accuracy.

## Next likely weakness
m1 still breaks on **pitch** (8 wrong pitches, ±12/±24 semitone offsets) — pitch/key mapping,
not rhythm.
