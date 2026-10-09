# Playable Transcription Rescue Preregistration (frozen before runs)

From `313cfb024c`. Sealed TEST untouched. Fret CNN frozen. Technique
abstinent. NO comprehensive training. DO NOT MERGE. 16GB RAM, other
agents active: sequential bounded jobs only.

## G5 discipline (unchanged)

TRAIN-fit (32) selects, TRAIN-heldout (15, frozen list in
GUITAR_BOTTLENECK_PREREG.md) verifies, DEV once at the end. Real vs
etude reported separately. No DEV tuning presented as generalization.

## Part 1 (coverage)

Attribution with the MERGED regime on heldout (attr script switched to
infer_page_merged): stage counts + tau calibration (TAU frozen 0.6
unless heldout shows a strictly-dominating operating point with
precision floor 0.45 — documented if changed, else frozen).

## Part 2 (large digits; ONE bounded experiment max)

Heldout verdicts first: (a) veto-off vs veto-on byClass (existing
--no-veto flag); (b) clean-negative purity: fraction of veto-mined
large negatives within 25px of GT (CPU-only); (c) resampling already
decided (merged design). ONE bounded inference-only change max (e.g.
veto-except-digits), selected iff heldout shows strict improvement in
digit recall with precision neutral-or-better. No repeat of the failed
layout-inclusive recipe. Per-layout map preserved on any regression.

## Part 3 (rhythm, no GNN)

Beam-tip association along full stem run (implemented; TRAIN decides
thresholds); chord membership validated via event links (shared
onset+pitch); measure ownership via barlines (reported limits); dots
attached (dedup done); flags/triplets stay abstinent/census unless
separation evidence appears. Detected objects preferred.

## Part 4 (MusicXML, bounded)

Transcriber v1: detected TAB digits -> (string,fret,pitch) via frozen
heads + onset columns (x-clustering) + staff-side duration rule where
available (quarter default flagged, counted separately) + barline
measures + voice 1 + chord tags -> TAB-staff MusicXML. Semantic eval
with scripts/evaluate-omr-semantic.mjs vs source MusicXML on 2
TRAIN-fit scores first; DEV sample (2-3 scores) only if pitch agreement
>0.7 on fit. Report semantic accuracy (pitches/rhythms/chords/measures/
voices), not parseability.

## Part 5 gates

Detection P/R, coverage, fret/string, pairing, rhythm, reconstructed
events, MusicXML correctness, per-layout, real-vs-etude. Tests green.
Commit + push.
