# Guitar Detection Accuracy Rescue (no large training)

**Prereg:** `GUITAR_DETECTION_RESCUE_PREREG.md` (recall ≥ 0.55 + precision
≥ 0.35 required, both; jitter reduction; fret untouched).
**Result:** recall target MISSED (0.35), precision target MISSED (0.27).
Reported as measured; thresholds not lowered.

## Failure audit (TRAIN)

- 96% of GT centers have a ≥0.3 peak within 25px (median 3px):
  LOCALIZATION WORKS. The failure is BOXES + RECALL, not centers.
- Fixed median boxes (188×253 canonical) mismatch variable spans
  (notehead-only vs stem-union differ 10×): TRADE proven — adaptive
  per-peak boxes were tried and failed (dense heat merges chords into
  giants; medians win). Documented negative result.
- Classical CC retired at P 0.11/R 0.17 (fragments, line-cut glyphs);
  morphological staff separation helped (zeros 92%→0.2%) but IoU stayed low.

## Bounded improvement (one corrective run)

Object-centered patches + foreground-weighted loss + LR 3e-3 + 16 epochs
(single extension, documented): P 0.27/R 0.35 (was 0.37/0.31 @8ep —
recall +0.04, precision −0.10: MIXED, reported honestly).
Compact layout: P 0.334/R 0.527 (best). Large/bravura weaker.

## Translation robustness

Jitter flip 0.28 (prior); shifted-box chain collapses to 9 digits;
blank pages decode nothing. Fragility persists (small glyphs + fixed
boxes); multi-layout training crops remain future work.

## End-to-end chain (G2/G3/G7)

Standard: 277 matched digits → 138 decoded → string/fret/pitch 0.81.
Compact: 221 → 86 → 0.70. Large: 0.51. Bravura subset: 1.0 (n=4,
meaningless). Controls: blank 0/0, shuffled 0.81→0.14, shifted collapse.
Fret checkpoint untouched (0.909 / 0.976 on matched).

## Rhythm graph (G5/G9)

Joins carry stems/beams/dots/flags (additive): beams 2548/2548 exact,
flags 100%, stems 68% (chord-share documented), dots 56%. Tuplets have
no SVG objects (verified absence; stay symbolic). No GNN trained.

## Decision

Acceptance gates NOT met → CASE C stands for detection (needs capacity +
real TAB volume beyond this task's bounds), CASE B comprehensive.
Scoped detector-capacity training + string data remain the justified
next step. No full training launched.
