# G2 Prereg: geometric string assigner (no training)

**Status:** line-relative representation SUPPORTED (oracle 100% on 362
heldout digits incl. s4/s5/s6; image line detection 5-6/6 GT lines @~1px
on fit). This replaces the planned StringNet fine-tune (rejected class
of experiment — do not repeat jitter/balanced refresh).

## Frozen design

`tools/guitar-vision/proof-string-geometric.py`, deterministic (no
weights, no optimizer, seed N/A):

1. Input: page PNG + digit boxes (stage A: GT boxes; stage B: merged-
   regime detected boxes), viewBox scale.
2. For each digit: x-band ±150 render-px around digit center; dark-pixel
   row projection; peak-pick (local max > p97 quantile, min dist 4px).
3. Group: among peaks, find 6-peak groups with spacing CV < 0.15 that
   bracket the digit center-y. Score = CV + residual penalty. Top peak
   of group = string 1 (TAB staves have 6 lines; 5-line notation groups
   rejected by count).
4. String = index of nearest group line to digit center. Confidence =
   1 - (residual/spacing) - CV. Abstain (fallback to StringNet) if no
   6-group found or confidence < 0.5.
5. Skew/curvature: handled by local x-band (no global line model).

## Frozen identities / splits

- Fit: `pdmx2-QmekQbhC1yAP` + etude tab samples with ≥4 strings
  (selection/development).
- Heldout: all heldout samples with tab-text joins (verify ONCE per
  stage; no tuning on heldout).
- DEV: single final run only if heldout stage B beats baseline.

## Baselines (frozen, from prior missions)

- StringNet heldout: acc 0.450 overall (s1 1.0, s2 ~0.5, s3 ~0.5,
  s4 0.04, s5 0.10, s6 0/10); fallback artifact kept.

## Acceptance (stage B, heldout, detected boxes)

- ACCEPT if: overall string accuracy > 0.45 AND s4+s5+s6 joint
  accuracy > 0.30 AND coverage (non-abstained) ≥ 0.80.
- REJECT if: overall ≤ baseline, or gains concentrate on s1 only, or
  coverage < 0.80 (precision-by-abstention forbidden).
- On ACCEPT: integrate as primary with StringNet fallback; recompute
  chains + transcription impact; one DEV run.
- On REJECT: keep StringNet; pivot to next non-training bottleneck
  (rhythm/beams). NO second architecture variant this mission
  (one-bounded-experiment cap).

## Constraints

No training. No sealed TEST. No source-truth lines at inference
(supervision only for scoring). Technique abstinent.
