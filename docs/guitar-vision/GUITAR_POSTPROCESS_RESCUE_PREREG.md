# Postprocessing Rescue Preregistration (frozen before runs)

**Date:** 2026-10-09. Worktree `~/Documents/scoreflow-guitar`,
branch `codex/guitar-vision`. DO NOT MERGE. Sealed sets untouched.
Fret CNN frozen. Detector weights `heatmap16ep.pt` frozen as baseline.

## Baseline (remeasured, not trusted)

Standard DEV P 0.27 / R 0.35 @0.3 was measured with greedy matching
that does NOT consume GT (duplicate peaks on one object each count TP).
First step: remeasure the frozen baseline with consume-on-match; report
both numbers. The corrected number is the baseline.

## Audit (TRAIN only, frozen weights, no training)

Run `heatmap16ep.pt` on TRAIN pages (standard layout first). Categorize
every FP/FN with image evidence only:

- FP-dup: peak matches an already-matched GT (duplicate extraction).
- FP-xclass: same location fires in ≥2 channels (cross-class dup).
- FP-text: tabdigit peak with no digit-anchored staff comb (page text).
- FP-box: GT center within 25px but IoU < 0.5 (box-size failure).
- FP-halo: IoU in [0.1, 0.5) near unmatched GT (near miss).
- FP-bg: none of the above (pure background/texture).
- FN-sub: GT center has a peak below threshold (threshold failure).
- FN-xclass: GT matched a peak of the wrong class only.
- FN-box: peak at GT center but box IoU < 0.5 (same as FP-box, GT side).
- FN-none: no peak within 25px of GT center (model failure; post
  cannot fix — counts the ceiling).

## Bounded fix (ONE combination, selected on TRAIN)

Candidates, each with a TRAIN-measured ablation:

1. Per-class peak thresholds (sweep on TRAIN; DEV untouched).
2. Radius-NMS per class (suppress weaker peaks within r px; kills dups).
3. Cross-class argmax suppression (one box per location).
4. Staff-comb gate for tabdigit (digit-anchored 6-line comb required;
   reject page text outside TAB staves).
5. Box size: medians stay unless the audit shows systematic bias; then
   ONE per-class scale factor from TRAIN (no per-peak adaptivity — the
   giant-merge failure stands).

Frozen into `proof-heatmap-decode.py` with recorded constants. No
weight updates. No architecture change in this phase.

## Freeze → DEV (once)

Eval DEV standard/compact/large/bravura exactly once with frozen params.
Then detected-box → fret → string → pitch chain + blank/shifted/shuffled
controls. Layouts never cross TRAIN/DEV (score-grouped by construction).

## Acceptance

- DEV recall ≥ 0.55 with precision ≥ 0.35 (both; no trading).
- Honest prior: postprocessing alone is unlikely to lift recall past the
  model ceiling (FN-none fraction); FP reduction + measurement correction
  are the expected wins.
- If gates missed: report the exact blocker. A bounded detector
  architecture experiment is justified ONLY with a preregistered
  hypothesis naming which FN/FP class it targets and why post cannot fix
  it (e.g. FN-none dominance → capacity; FP-text persistence → context).
- Rhythm-graph prep resumes only after this investigation commits.
