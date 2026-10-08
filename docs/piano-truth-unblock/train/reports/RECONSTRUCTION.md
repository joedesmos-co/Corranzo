# Piano reconstruction evaluation (P3–P6): frozen probes → playable score

Evidence: `recon_dev99.json` (full per-score), `recon_dev99_summary.json`.
Code: `scripts/infer.py`, `decode_score.py`, `to_musicxml.py`, `eval_reconstruction.py`.
Commit: `86d7a0f561` + ppq-guard fix (uncommitted at writing time).

Sealed populations untouched: PDMX TEST 99, OLiMPiC TEST 1493. DEV only (99 scores).

## Stage design (leakage control)

- **Stage A (oracle labels):** canonical truth → `preds_from_truth` (same schema as
  model output) → decoder → MusicXML. Measures DECODER error only.
- **Stage B (frozen model):** oracle boxes → 3 frozen probes → combination rule →
  decoder → MusicXML. Measures MODEL + decoder error; A→B gap = model error.
- **Stage C (predicted boxes):** UNAVAILABLE — no detector was trained. Detector
  hunting is banned (`assert_no_detector` fails closed).
- Decoder never consumes truth pitches, durations, onsets, voices, accidentals,
  ties, or text. It uses oracle geometry (notehead_x, boxes) + meter + document
  order, all legitimate inputs.

## Full DEV results (99 scores, 22,299 notes, 578 rests)

| metric | stage A (decoder) | stage B (model+decoder) |
|---|---|---|
| note exact (onset/pitch/dur/voice/staff) | 22299/22299 (100%) | 10533/22299 (47.2%) |
| note pitch-only | 100% | 10731/22299 (48.1%) |
| rest exact | 456/578 (78.9%) | 2/578 (0.3%) |
| timing-valid (measure,voice) slots | — | 948/3334 (28.4%) |

Grouping pairwise (stage B vs truth): chord P 0.992 / R 0.472 (t=6224);
beam P 0.276 / R 0.759 (p=110077 vs t=40001 — over-merge);
tuplet P 0 / R 0 (t=615 true pairs, p=1 — head never fires).
Beam voice purity 100% (all groups single-voice).
music21: 99/99 files parse, 2484 measures, 20 tie starts / 20 tie stops paired.

## Error attribution

- **Decoder (stage A residual):** notes ZERO error corpus-wide. Rests 122 fn /
  146 fp, all attributed to (a) parallel-layer duplicate rests serialized into
  one voice (23% of rest positions; file-adjacent rule fixes 82% of dups,
  nonadjacent residual remains), (b) voice≠layer onset divergence (truth
  accumulates per layer, decoder per voice — unresolvable without layer labels).
- **Model (A→B gap):** note exact 100% → 47.2%; rest exact 78.9% → 0.3%
  (onset cascade from note dur/voice errors; rest boxes ARE emitted, just
  misplaced). Chord recall 1.0 → 0.472 via dur/voice splits. Beam precision
  0.871 → 0.276 via in_beam over-prediction. Tuplet recall ~0 (flag dead).
- **Canonical (metric fixes applied, no truth change):** chord_id drops
  notehead_x from its key (collides distinct same-onset chords) — eval now uses
  the full 5-tuple key. Pilot objects lack source_order for rests — decode uses
  canonical file rank uniformly. `_mlen` clobbering by meter-less events fixed.

## P5 gap list (model coverage, needs new heads or rules)

1. Adjacent same-lane beam groups indistinguishable from `in_beam` flags alone
   (no break/boundary flag among the 25 membership flags).
2. `tuplet_member` never fires on DEV (615 true pairs missed).
3. Beam-break elements, repeats/endings, segno/coda, voltas, nested tuplets,
   glissandi/turns/breaths break and draw through barlines — unmodeled.
4. Exotic-meter full-measure rests (e.g. 15/16) have no single-symbol dur form;
   emitted measure-style (correct) but model can only predict vocab symbols.
5. Cue evaluation, rit text mapping, voice/layer divergence — documented limits.

## P6 validation

music21 parses 99/99 stage-B outputs; ties paired 20/20; timing validity 28.4%
reported per (measure, voice) slot. Failure dossiers: worst score 3.5% joint
exact (`QmZC68y4...`, 256 notes); full per-score records in `recon_dev99.json`.
