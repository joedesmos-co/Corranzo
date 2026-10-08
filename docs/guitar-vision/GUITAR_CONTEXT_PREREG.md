# Context Proof Preregistration (G1, frozen before training)

**Date:** 2026-10-08. No training has run under this plan.

## Frozen population

- labels.jsonl sha (first 16): `c19af43931252125`, 31,080 rows.
- TRAIN 21,245 (real 21,065 + etude 180); DEV 9,835 (real 9,719 + etude 116).
- Scores: pdmx train/validation + v2 train/validation (47 + 31). Heldout,
  diagnostic, v2-pilot work, fret benchmark: never read.
- Frozen prior: `datasets/guitar-vision/proof/proof-model.pt` (untouched).

## Models and heads (no sweep)

- StringNet: tall-crop (digit + full TAB staff span) → string 6-way.
- RhythmNet: wide-crop (beat neighbors + stems/beams) → duration 7-way + voice.
- Fret: frozen prior head only (no retraining).
- Geometry-only control: nearest detected TAB line (image-detected lines).

## Budget

≤8 epochs per run, MPS, fixed seed 20261008. Oversampling ≤×4 (TAB rows).
Runs: StringNet, RhythmNet, shuffled-string control (4 epochs), blank eval.

## Selection rules

Checkpoints: last epoch only (no DEV peeking for selection).

## Acceptance criteria (G8)

- CASE A: DEV string ≥ 0.80 with fret ≥ 0.90 (no fret regression), AND
  digit pitch-compose ≥ 0.70, AND duration improves over 0.439 baseline.
- CASE B: string stays < 0.80 → specify TAB data volumes needed.
- CASE C: context inputs fail while isolated heads hold → target/decoder fix.
- Technique heads: none (schema-only stands).
