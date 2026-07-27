# Rhythm Sprint 2 — Recognition RCA

## Verdict

Largest recognition-level root cause: **saturated `beamStrength` misclassified as sixteenth**, with `countBeams` also dropping strength>22 so beam caps never fire.

## Taxonomy (duration messages across 4 fixtures)

| Class | Count | Fixtures |
|---|---:|---|
| Eighth→16th (half-of-truth) | 38 | dense 30, tuplets 8 |
| Quarter→half / Eighth→quarter (double-of-truth) | 58 | grand 30 Q→H, dense 27 E→Q, … |
| False dotted (Q→dotted 8th etc.) | 32 | tab 19+8, dense 9, … |
| Tuplet defects | 10 | tuplets m3 |

## Beam strength evidence (dense)

- stemmed notes: 230
- strength 23+ (rejected by countBeams): **60**
- strength 8–22 (accepted): **9**
- `inferNoteDuration` still sees strength=29 → **sixteenth** even when beams=0

## Recommended smallest fix

**File:** `src/features/omr/detectNoteRhythmFeatures.js`

1. `inferNoteDuration` — remove `beamStrength >= 14 → sixteenth` (keep eighth when strength≥8).
2. `countBeams` — accept strength≥8 even if >22.
3. `enrichNoteheadRhythm` — persist `beamStrength` on the note.

**Expected:** dense + tuplets (Eighth→16th, and beam-cap help for Eighth→quarter). Not tab. Not grand Q→H (use secondary fix on `extendPenultimateHalfBeforeFinalQuarter`).

## Traps

- Gap-primary durations; evaluator frozen; tab is a separate path; grand Q→H is onset-free heuristic stretch; balancing can mask underfull measures.
