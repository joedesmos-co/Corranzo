# Playable Transcription Rescue Report

**Prereg:** `GUITAR_TRANSCRIPTION_PREREG.md` (TRAIN-fit select /
TRAIN-heldout verify / DEV once). Sealed TEST untouched. Fret CNN
frozen. No training launched (userلے TallCNN active at start; inference/
analysis only). Technique abstinent. DO NOT MERGE.

## Root causes (P0 coverage blockers, measured)

1. **String-head underconfidence + inaccuracy.** Fret essentially
   perfect (13/13 @~1.0 conf on probe page); string argmax right but
   conf 0.26-0.49 on strings 2-4 (abstained at TAU 0.6 even when
   CORRECT); heldout string errors 133 vs fret 6. Temperature T=0.7
   (ECE 0.072->0.043 fit, confirmed heldout) recovers +56-97% decoded
   at precision 0.72-0.84. Frozen.
2. **Bad boxes dominate detection loss** (259/548 fit, 168/362 heldout;
   46-47%): peaks exist, IoU<0.5. Missed only 4-6%. Family 0.
3. **Veto innocent on large digits** (16 vetoed, 0 TP cost heldout-large);
   veto-mined negatives 0% impure (union-vs-core artifact retracted).
   v4 failure = dilution/underfit, not poisoning. No training repeated.
4. **Resampling splits by glyph size:** norm helps notes massively,
   blurs thin digits/rests -> two-pass merge (notes<-normed,
   digits/rests<-native) frozen after heldout verification.
5. **Pairing rare but noisy:** 162 note+digit x-columns (fit), 38% agree
   (clustering/pitch caveats); roles unpopulated in canonical.
6. **Rhythm:** stems DEV 0.455/0.559; beam-tip full-run implemented;
   flags abstinent (retry P 0.02); triplets census-only; durations
   quarter-dominated (0.294 DEV exact-validated).

## Changes implemented

- `STRING_TEMP=0.7` in chain + transcriber (fit-selected, heldout-verified).
- Transcriber v1 (TAB digits -> onset columns -> staff-side durations /
  quarter-default flagged -> barline measures -> voice/chords -> MusicXML
  with consistent type/dot).
- Exact event links reused for chain truth (replaces lossy regex) +
  coverage denominators (decoded/mapped/pitchCorrect over ALL GT).
- Chain `--oracle`, `--detector` (per-layout map), rhythm flag/measure/
  dot-dedup metrics, barline xs API, attr tau-grid + merged regime,
  scale probe, norm-verify byClass + merged mode.

## Detection results (DEV, merged, once)

| layout | P / R (prev) | note | rest | digit |
|---|---|---|---|---|
| standard | **0.676/0.710** (0.410/0.425) | .741/.770 | .352/.390 | .314/.356 |
| compact (v4) | **0.643/0.715** (0.628/0.700) | .666/.730 | .409/.564 | .737/.722 |
| large | **0.572/0.526** (0.296/0.247) | .599/.606 | .220/.069 | .166/.085 |
| bravura | **0.715/0.700** (0.451/0.433) | .719/.754 | .697/.317 | .594/.731 |

Real vs etude DEV: no gap (std real .676/.710 vs etude .640/.690;
large real .572/.524 vs etude .628/.655; n real 1,846-9,742 vs etude
~116). Standard passes precision gate; recall <0.55 (large doubled
but still weakest). Jitter still collapses (+30px: 227->7 std).

## Playable coverage before/after (DEV, T=0.7 calibrated regime)

| layout | oracle pitch (cov) | detected pitch (cov) |
|---|---|---|
| standard | 0.788 (0.129) | 0.689 (0.049) |
| compact | 0.729 (0.148) | 0.536 (0.105) |
| large | 0.796 (0.116) | 0.500 (0.016) |
| bravura | 0.571 (0.308) | 0.600 (0.231) |

Correct-pitch counts before->after calibration: std 25->31, compact
51->67, large 8->10, bravura 3->6. Controls: blank 0/0, shifted
collapse (3), shuffled 0.689->0.111. Fret 0.80-1.00 (large-det 0.80 on
marginal digits; model untouched).

## Rhythm accuracy before/after

Stems TRAIN 0.314/0.519 -> DEV 0.455/0.559; dots 0.94/0.95; beam pairs
tp 2,452 TRAIN / 1,541 DEV (over-grouped); flags abstinent (retry
P 0.02/R 0.43, unusable); measure ownership barline-bound (pairwise
poor on dense pages); barlines DEV median exact (1.0, p10 0.415);
tuplets census-only (12 TRAIN/2,211 events; 5 DEV/772; digit response
0.16-0.39 inseparable). Duration rule exact-validated: 0.278 TRAIN /
0.294 DEV (quarter-dominated).

## Part 2 verdicts (large digits, heldout)

- Veto INNOCENT on large (16 vetoed, 0 digit-TP cost; native R 0.091
  with or without veto). Veto kept.
- Veto-mined negatives 0% impure (core centers; the 38% was a
  union-vs-core artifact — retracted). v4 failure = dilution/underfit.
- Resampling: bilinear notes + native digits/rests (merged) frozen;
  NEAREST helps single-page digits but loses overall (blocky notes).
- Bounded experiment this mission: temperature calibration (post-only)
  + merged regime (already frozen). No new training. Per-layout map kept.

## MusicXML reconstruction results (Part 4, fit baselines)

- etude-tab-only-rhythm: 3/14 notes, semantic 74% (missing-note dominated).
- etude-tab-only-chords: 9 notes, semantic 79% (P25/R50).
- DEV transcription gate (pitch agreement >0.7 on fit) NOT met -> no DEV
  transcription (prereg discipline). Transcriber + harness committed.

## Remaining V1 blockers

String-head accuracy on dense/second strings (133 heldout errors);
bad-box 46%; large-digit recall; beam-tip association precision;
flag separator; triplet numerals; paired-mapping coverage; TAU operating
point; 21 real-data gaps; technique supervision.

## Commit

This report + code + records. Tests green (below).

## Exact next step

String-head scoped refresh (the 133-error wall bounds transcription
harder than any detection lever) + veto-off-digit confirmation on the
next heldout; then beam-tip precision. No comprehensive training.
