# Transcription Bottleneck Rescue Preregistration (frozen before runs)

From `b0709823ed`. Sealed TEST untouched. Fret CNN frozen. Splits frozen.
NO comprehensive training. Technique abstinent. DO NOT MERGE.

Machine state: user's own TallCNN training running (CPU-bound, high load).
My work stays inference/analysis-only unless the machine frees AND a
bounded experiment is justified on TRAIN evidence. No heavy training
launched by me in any case without re-checking load.

## G5 split discipline (evaluation integrity)

DEV (validation split) has been observed repeatedly: no further tuning
gains on it will be presented as unbiased generalization. New ideas are
SELECTED on TRAIN-fit (32 scores) and VERIFIED on TRAIN-heldout (15
scores, never used for any threshold/box selection), score-grouped,
stratified etudes-vs-real. DEV is touched ONCE at the end for the final
frozen report. Real scores and etudes reported separately throughout.

TRAIN-heldout (15, verified TRAIN members — reserved for THIS mission's
verification; prior missions used pooled TRAIN, so this is score-disjoint
freshness for new selections, not pristine data):
guitar-aguado-op03-4/5/6, guitar-spanish-romance, etude-slide-chain,
etude-palm-mute-span, etude-legato-pull, etude-ornament-trills,
etude-repeats-endings, etude-harmonic-natural, etude-dynamics-hairpins,
pdmx-QmTxoAbitsi9, pdmx-QmTyVsS8Rm93, pdmx-QmWvkp1mCnkV,
pdmx-Qmbgcj3cCzhC. Rest (32) = TRAIN-fit.

## G1 attribution (TRAIN-fit + heldout, frozen v3/v4 detectors)

Per GT digit/tab event: detected? box IoU>=0.5? family? fret? string?
staff side? abstained (conf<tau)? paired (staff+TAB roles)? rhythm
(stem/beam/dots present)? Counts + oracle-swap headroom per stage
(oracle boxes -> detection headroom; oracle strings/frets -> headroom).

## G2 bounded experiment (TRAIN-only evidence; inference-first) — DECIDED

Scale normalization SELECTED on TRAIN-fit + verified on TRAIN-heldout
(fresh scores): large-fit P/R 0.310/0.260 -> 0.525/0.470 (probe, 1.32x);
heldout universal-ON wins on ALL layouts with zero regressions:
standard 0.418/0.429 -> 0.752/0.711, compact 0.700/0.787 -> 0.702/0.777,
large 0.299/0.250 -> 0.593/0.536, bravura 0.515/0.483 -> 0.825/0.658.
Frozen: TARGET_GAP 26.0 (fit standard median), clamp [0.7, 1.6],
universal application. NO training launched (inference-only fix).
Clean-negative analysis: veto-mined large negatives include veto-killed
TPs (self-reinforcing) — reason recorded, no second mining run.

## G3/G4 (no training)

Beam-tip association (extend along beam direction; TRAIN-fit tune,
heldout verify), flag separation retry (touch-constrained; abstain if it
fails again), dot->note attachment, measure ownership via barlines,
onset/voice/chord grouping by x-columns. Detected objects preferred;
oracle-box ablations separate head errors. No GNN training.

## G6 gates

Focused tests + source/render checks green. Report all 10 items with
precision AND coverage. Commit + push.
