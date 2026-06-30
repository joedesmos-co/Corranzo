# Staff gap normalization — before/after benchmark

**Change:** Page-local staff line gap normalization for outlier systems (>15% deviation from document median).

## Dense (A Cruel Angel's Thesis)

| Metric | Before | After | Δ |
|--------|-------:|------:|--:|
| Pitch accuracy | 92.74% | **93.67%** | +0.93pp |
| wrongPitch | 173 | **147** | **−26** |
| m119–125 wrongPitch | 107 | **81** | **−26** |
| Duration accuracy | 95.20% | 95.23% | +0.03pp |
| wrongDuration | 104 | 103 | −1 |
| Onset accuracy | 95.77% | 95.55% | −0.22pp |
| wrongOnset | 88 | 94 | +6 |
| Chord accuracy | 91.87% | 91.84% | −0.03pp |
| chordMismatch | 238 | 239 | +1 |
| measureΔ | 0 | 0 | 0 |
| noteΔ | −2 | −3 | −1 |

## Clean (Gymnopédie No. 1)

| Metric | Before | After | Δ |
|--------|-------:|------:|--:|
| Pitch | 100% | 100% | 0 |
| wrongPitch | 0 | 0 | 0 |
| wrongDuration | 1 | 1 | 0 |
| wrongOnset | 0 | 0 | 0 |
| chordMismatch | 0 | 0 | 0 |

**Clean unchanged.**

## Normalization applied

- Document reference gap: **0.00601** (44 treble + 44 bass samples from pages 1–7)
- Page 8: **3 systems normalized** (all page-8 systems)
  - sys 0: bass gap 0.00830 → 0.00601 (38% deviation)
  - sys 1: treble+bass 0.00830 → 0.00601
  - sys 2: treble 0.00936 → 0.00601, bass 0.00760 → 0.00601
- Pages 1–7: no normalization applied

## Verdict

**KEEP** — dense pitch improves materially (−26 wrongPitch, trailing cluster −26); clean unchanged; duration flat/improved; onset/chord noise within tolerance.

Artifacts:
- `before-dense.json`, `before-clean.json`
- `after-dense.json`, `after-clean.json`
- `comparison.json`
