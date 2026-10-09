# Overnight Continuation Preregistration (frozen 2026-10-09)

From `d14fcbb9e7`. Sealed TEST untouched. Fret CNN frozen. Splits/tiers
frozen. No comprehensive training. ONE capped detector run max.

## A. Rest-box scale (post-only, no training)

Hypothesis (TRAIN-measured): rest GT boxes are 1.54x TALLER than the
frozen median (w 1.11x). Experiment: multiply rest median height by the
TRAIN-verified factor (recomputed on TRAIN standard pages with the v2
decoder matching, not the audit's approximate number), freeze as decoder
v2, eval DEV once per layout. Success: rest recall improves with rest
precision neutral or better; overall F1 must not regress vs v1.
Width factor included iff TRAIN shows the same systematic bias (else
width stays 1.0 — one bounded change, documented).

## B. Remaining FP/FN audit (TRAIN, v2 decoder)

Categorize with v2: clef/key/time-sig FPs (count + zone), time-sig-digit
vs tabdigit confusion, X-notehead recall, large-layout weakness, rest
substructure. Output: the ignore-class justification decision with
counts (no training in this phase).

## C. ONE capped ignore-class run (only if B justifies)

Justification bar: >=30% of v2 FP-bg attributable to unlabeled notation
(clef/key/time-sig) AND a trainable negative signal exists without new
manual labels.
Design (frozen before running): TinyFCN + 1 ignore channel (4 outputs),
same depth/width, fixed seed; positives = existing GT Gaussians;
negatives = SELF-MINED TRAIN FPs of the frozen v1 model (its own
confusers: clefs, time-sigs, text) + random background — image-derived,
TRAIN-only, no symbolic truth. Loss: same foreground-weighted MSE +
ignore channel. Cap: <=12 epochs, object-centered patches, TRAIN pages
standard+compact only (score-grouped). Decode: ignore channel suppresses
note/rest peaks (local max-normalized veto within 12px); tabdigit path
unchanged. Eval: DEV once per layout + chain. Success bar: FP-bg -25%
with recall neutral or better vs v2; else report the blocker and keep v2.
Failure reverts to v2 (weights not committed).

## D. Rhythm object-graph (no training)

Scope: associate image-detected note/rest boxes to image-detected stem
segments and beam groups using the validated primitives (stems 68%,
beams 100%, flags 100%, dots 56% from render_identity). Output: per-page
onset graph (note -> stem -> beam-group) with duration labels on TRAIN
(measured) and DEV (once). Technique heads stay abstinent (no real
supervision). No GNN training this run.

## E. Chain + preservation + tests

Detected-box -> fret -> string -> pitch per layout + controls with the
final decoder. Fret accuracy must stay >=0.95 on matched (else revert).
Guitar vitest files green. Commit + push. DO NOT MERGE.
