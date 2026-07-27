# Pitch Research Spike 6 — On-line stacked chord separation

## Status
**ACCEPTED as completed no-ship research spike (2026-07-26).**  
Production recognition unchanged. Pitch Sprint 4 remains the accepted baseline. Follow-on work moved to **Guitar Pitch Sprint 1** (stage-1 sounding pitch provenance).

## Decision
**Leave production unchanged.**

No method met isolated safety bar (synth singles stay single, ≥75% synth chords, collapse recall≥0.5, ≤0.5 extras/collapse-crop, ≥3 real single on-line controls). Near-misses: mergePrevention(recall=0.73, extras/crop=1.50), ensemble(recall=0.73, extras/crop=1.50), lobesOnSubtracted(recall=0.56, extras/crop=0.63), verticalProfileOnSubtracted(recall=0.52, extras/crop=1.00). Real single controls collected: 0. Production left unchanged.

Production detector was **not** modified. Pitch Sprint 4 remains the baseline.

## Baseline (production, unchanged)
- Pitch: 29% (TP=35)
- Sustain TP: 1/5
- Articulation TP: 8/61

## Methods tested
1. Local staff-line subtraction (column-local thin horizontal removal)
2. Vertical ink-profile splitting
3. Shape/lobe detection on tall bands
4. Staff-position hypothesis testing (ink-supported only)
5. Merge prevention when midpoint lacks support
6. Ensemble of the above

## Real crops
- collapse-like: 8
- chord controls: 1
- single on-line controls: 0

## Method summary
- **verticalProfileOnSubtracted**: collapse recall=0.52, collapse extras=8, single extras=0, synth chords 3/4, synth singles kept 3/3
- **lobesOnSubtracted**: collapse recall=0.56, collapse extras=5, single extras=0, synth chords 3/4, synth singles kept 3/3
- **staffHypotheses**: collapse recall=0.88, collapse extras=33, single extras=0, synth chords 3/4, synth singles kept 0/3
- **mergePrevention**: collapse recall=0.73, collapse extras=12, single extras=0, synth chords 3/4, synth singles kept 3/3
- **ensemble**: collapse recall=0.73, collapse extras=12, single extras=0, synth chords 3/4, synth singles kept 3/3

## Estimated collapse recovery
Of the Sprint 5 ~18 chord-collapse paired errors, isolated collapse crops here: **8**.
Nearest gated method **mergePrevention** mean recall **73%** ⇒ rough recovery estimate **13 / 18** if it translated 1:1 (it may not; extras and missing upper-tone ink argue against shipping).

## Safety checklist
- Fixture/measure/pitch hardcoding: none in research methods
- Tie/articulation recognition: untouched
- Global staff-line rejection / broad seed exceptions: untouched
- Production detector (`detectOmrNoteheads.js`): unchanged
- Evaluator: frozen
- Single on-line notes stay single (synthetic): yes for all methods except `staffHypotheses`
- Real single on-line controls: **0 collected** (need ≥3 before production)
- Staccato/articulation dots as false noteheads: not fully exercised; collapse-crop extras are the proxy risk
- Sustain TP / Articulation TP: baseline unchanged (no integration run)

## Critical scan finding
On the canonical m5 treble opening column, expected upper chord-tone line positions often lack head-like vertical ink (bare staff line only); recoverable ink sits near mid/lower tones. Methods must not invent missing upper tones without ink — and ink-supported recovery still over-proposes extras on real collapses.

## Artifacts
- `tmp/pitch-spike-6/REPORT.json`
- overlays: `tmp/pitch-spike-6/overlays/`
- synthetic: `tmp/pitch-spike-6/synthetic/`
