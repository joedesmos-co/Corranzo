# Detection Integration Preregistration (frozen before runs)

**Date:** 2026-10-08. No detection training runs yet under this plan.

## Frozen population

Same 47 train / 31 dev scores, same labels.jsonl (`c19af43931252125`).
Frozen models: proof-model.pt (family/fret), stringnet.pt. Sealed sets untouched.

## System (no sweep)

- Stage 1 (geometry): page staff-system segmentation via projection;
  six-line TAB detection (exact+anchored tiers, frozen code).
- Stage 2 (proposals): connected components after staff-line removal →
  candidate boxes (digit/notehead/rest/noise).
- Stage 3 (recognition): frozen family head filters proposals; frozen fret
  head + StringNet + geometry hybrid classify (all frozen, no retraining).
- Stage 4 (decoder): existing tier-weighed policy (τ=0.6/0.75), unchanged.

## Layouts (G4)

Hires staging rasters for compact/large/Bravura (standard exists).
Layouts inherit the score's split (never independent samples).

## Acceptance criteria

- Detection: recall ≥ 0.85 on DEV tabdigits at IoU ≥ 0.5 with ≤ 2.0
  false positives per page; precision reported, failures split by
  detection-vs-classification.
- End-to-end: pitch precision ≥ 0.85 at coverage ≥ 0.40 on detected boxes
  (below the GT-box 0.924/0.476: detection loss budgeted explicitly).
- Rhythm truth (G5): stems/beams/flags/dots/tuplets extraction agreement
  reported; no GNN training.
- CASE A: both gates pass without fret regression.

## Addendum: learned heatmap detector (frozen before training)

Classical CC detection plateaus at recall 0.14-0.19 (fragments, line-cut
glyphs). Bounded learned experiment authorized (no sweep):

- Tiny FCN (4 conv blocks, stride 8), 3-channel center heatmaps
  (note/digit/rest), Gaussian targets σ=6px at output stride.
- 512px patches, deterministic sampling, TRAIN pages only, 8 epochs.
- Inference: full-page heatmap, peak extraction (3x3 maxpool NMS),
  box = fixed size per class from TRAIN medians (documented approximation).
- Acceptance: DEV recall >= 0.70 @ IoU>=0.5 with precision >= 0.40.
  Below that: CASE C stands, detector work continues outside this task.
