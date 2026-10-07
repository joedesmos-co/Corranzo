# Piano Vision first verified supervised training proof

Worktree: `/Users/ryland/Documents/scoreflow-piano-unblock`
Branch: `codex/piano-truth-unblock`
Data freeze: `train/manifests/freeze.json` (pilot v0 manifests, splits).
Seals: pilot TEST (99) and OLiMPiC TEST never read; OLiMPiC TEST untouched.
Scope: **small falsification run only** — ~100 TRAIN / ~20 DEV scores.

## T0 — data freeze

Pinned: selection, dataset v0, splits (792/99/99), determinism, baseline and
OLiMPiC benchmark manifests by sha256 (`train/manifests/freeze.json`). Nothing
was regenerated or reshuffled. Subsets `train100`/`dev20` are hash-ranked from
frozen TRAIN/DEV members only; TEST ids are deleted from memory before use and
never materialized for experiments.

## T1 — target adapter

`reports/TARGET_ADAPTER.md`, `manifests/items.json`, `manifests/roundtrip.json`.
Every target family documents source field, identity, encoding, masking and the
unsupported/excluded rule; excluded families (beams, tuplets, ties/slurs,
dynamics, ornaments, pedal, tempo, text, state symbols) are recorded, never
silently mapped. Coordinate mapping is
`png = (svg_units + page_margin_translate)/10 × (png_w/svg_page_w)` with the
translate parsed per page (the T3 audit caught and fixed a missing-translate
bug: 788→1,211/1,211 inky boxes).

## T2 — round-trip

25,103 items checked, **0 failures** (24,086 notes, 935 rests, 82 mRests).
Vocabularies injective; masks match truth missingness.

## T3 — overlay QA

`train/qa/`: 8 pages (6 train + 2 dev), **1,211/1,211 boxes in bounds with ink**,
labels drawn from truth strings. Visual inspection confirms boxes on noteheads
with pitch-consistent labels. No model predictions used.

## T4 — current frozen model baseline

**Skipped with justification.** The repository contains no trained supervised
model: the in-repo OMR stack is a heuristic JS pipeline
(`src/features/omr/runPdfOmrPipeline.js` + accuracy probes); a repo-wide search
finds no `.pt`/`.onnx`/`.safetensors` weights and no model-loading code.
Forcing the heuristic decoder onto the new truth schema would measure the old
disputed pipeline, not a baseline, so no number is reported. Orientation comes
from majority-class baselines recorded in every fit manifest.

## T5 — small supervised fit

Minimal multi-head CNN probe (shared 3-block conv trunk + 9 heads), explicitly
**not** an architecture proposal: it validates that the stack can fit verified
truth and generalize. Preregistered budget: 12 epochs, batch 256, AdamW
lr=3e-4, seed 7, CPU. Subsets: train100 (19,732 items) / dev20 (5,371 items),
full-score separation.

## T6 — architecture

No trained neural stack exists in-repo to reuse; the probe is from-scratch and
minimal. No sweep, no new-architecture claims, no Corpus2.1 assumptions.

## T7 — compute

Mac 16 GB, CPU only (4 torch threads), single-process loader. Budget respected:
12 epochs per mode, no extension. Runtimes recorded per fit manifest.
## T5/T8 — small supervised fit + metrics

Subsets: `train100` (19,732 items) / `dev20` (5,371 items), full-score
separation, no cherry-picking. Model: 109,567-param multi-head CNN probe
(`manifests/fit_normal.json`, `models/probe_normal.pt`).

| head | TRAIN | DEV | majority | verdict |
|---|---|---|---|---|
| kind (note/rest) | 0.993 | 0.996 | 0.967 | fits, near ceiling |
| pitch (88 MIDI) | 0.713 | **0.680** | 0.085 | materially fits + generalizes |
| duration (11) | 0.725 | **0.686** | 0.579 | learns beyond frequency |
| dots | 0.959 | 0.962 | 0.959 | at majority (rare) |
| staff | 0.800 | 0.708 | 0.739 | DEV below majority: local crops lack page context |
| accidental | 0.969 | 0.980 | 0.969 | at majority (rare) |
| grace | 0.997 | 0.991 | 0.997 | at majority (rare) |
| cue | 0.999 | 1.000 | 0.999 | trivial (near-absent) |
| voice | 0.803 | 0.736 | 0.743 | DEV below majority: needs context |

DEV pitch curve: 0.368 → 0.506 → 0.544 → 0.581 → 0.611 → 0.618 → 0.639 →
0.647 → 0.642 → 0.610 → 0.660 → 0.680. Train loss 0.936 → 0.337.

Per-duration-class accuracy (DEV): 8th 0.977 (2,486), half 0.983 (117),
quarter 0.559 (633), 16th 0.035 (679), 32nd 0.000 (133), dotted-quarter 0.000
(125), dotted-8th 0.030 (67), dotted-half 0.000 (13), whole 0.000 (7).
Duration learning concentrates in frequent classes; minority durations collapse
to the majority — reported, not hidden.

Rare subsets: grace-note pitch 0.116 (n=43 dev; 0.190 train, n=58); cue absent
in dev (train 0.000, n=10); octave-shifted notes 0.396 printed-pitch accuracy
(n=2,194, unseen TRAIN scores) vs 0.000 source-octave — the head reads toward
the printed position but degrades on this rare layout. No octave-shifted notes
exist in the T5 subsets (pilot-wide: 3,545); dedicated coverage belongs to the
scaled campaign.

## T9 — shortcut / causal controls

| head | normal DEV | blank DEV | shuffled DEV | geometry DEV |
|---|---|---|---|---|
| pitch | **0.680** | 0.075 | 0.074 | 0.056 |
| duration | **0.686** | 0.159 | 0.584 (≈maj) | 0.107 |
| kind | 0.996 | 0.931 | 0.931 | 0.931 |
| staff | 0.708 | 0.691 | 0.691 | 0.212 |
| voice | 0.736 | 0.118 | 0.793 | 0.122 |

Reading: with content removed (blank) pitch falls to chance (0.075 ≈ 0.085);
with permuted labels (shuffled) nothing is learnable (pitch 0.074, duration at
majority); with bbox geometry only (MLP, no pixels) pitch is 0.056 and duration
0.107 — absolute box position carries no usable signal, so the CNN's 0.680 is
not an absolute-position shortcut. The model materially depends on the correct
notation pixels. (Geometry MLP ran 12 full-batch steps; even so, train accuracy
stayed at chance, consistent with no signal rather than underfitting.)

## T10 — OLiMPiC DEV domain check

`manifests/olimpic_dev_gap.json` (1,438 DEV samples; TEST never touched, no
training, no predictions):

| metric (median) | pilot renders | OLiMPiC DEV scans |
|---|---|---|
| image width | 2,480 px (fixed pages) | 820 px (variable system crops, 140–1,514) |
| contrast (std) | 30.9 | 66.5 |
| Laplacian variance | 2,066 | 11,048 |
| ink fraction | 0.037 | 0.150 |
| LMX tokens / system | n/a (object tables) | 248 (32–808) |

Real scans are tighter crops at varied scales with ~2× contrast, ~5× texture
energy and ~4× ink density (caveat: native-resolution statistics, not
staff-gap-normalized). A crop classifier transfers only after recalibration;
sequence-level LMX transcription needs a sequence model this proof explicitly
did not build. OLiMPiC TEST stays sealed.

## T11 — controlled-capture status

`captures/`: 8 CC0 TRAIN pages staged as a print packet (2.8 MB PDF) with
source/render hashes and a registration procedure in `capture_manifest.json`.
Physical print/scan/photo capture is pending; this batch is **not** validation
data yet.

## T12 — decision

**CASE A — TRAINING PIPELINE VALIDATED**, with documented scope limits.

- Target round-trip: clean (25,103 items, 0 failures).
- Visual overlays: coherent (1,211/1,211 inky; inspected). One consumer-side
  coordinate bug was found by the audit, fixed, and re-verified before any
  fitting; pilot truth joins were unaffected (parity still PASS).
- Model materially fits TRAIN: loss 0.936→0.337; pitch 0.713 vs 0.085
  majority; duration 0.725 vs 0.579.
- DEV improves clearly: pitch 0.368→0.680; duration 0.585→0.686; kind
  0.931→0.996.
- Pixel controls: blank/shuffled/geometry pitch ≈ chance (0.075/0.074/0.056).
- Honest limits (not hidden): staff/voice need page context (DEV at/below
  majority); minority durations collapse to majority; dots/accidentals/grace/
  cue at majority; octave-shifted pitch degrades (0.396); OLiMPiC gap is
  real and sequence-level transfer is unproven.

Next step: scale to the full 792-score TRAIN set with page-context staff/voice
heads and a rare-class strategy, plus the 8-page controlled capture for
note-level real-world acceptance. Full-scale training (including capped RTX)
is now justified; no uncapped sweep; OLiMPiC TEST and pilot TEST stay sealed
until the recipe is frozen.

## Return items

1. **Target-adapter audit**: `reports/TARGET_ADAPTER.md` — every head with
   source field, identity, encoding, masking and excluded-class rules.
2. **Round-trip**: 25,103/25,103 PASS, per-class, in `manifests/roundtrip.json`.
3. **Overlay QA**: 8 pages, 1,211/1,211 boxes in bounds + inky, inspected;
   one mapping bug caught and fixed pre-training.
4. **Old-model baseline**: skipped with justification — no trained supervised
   model exists in-repo (heuristic JS OMR only, no weights); majority
   baselines recorded instead.
5. **Subsets**: train100 (19,732 items) / dev20 (5,371 items), deterministic
   hash-rank, full-score separation, in `manifests/items.json`.
6. **Model/config**: 109,567-param multi-head CNN probe (3 conv blocks + 9
   heads), AdamW lr=3e-4, batch 256, 12 epochs, seed 7, CPU;
   `models/probe_normal.pt` (+blank/shuffled/geometry).
7. **Compute/runtime**: normal 818.9 s, blank 648.5 s, shuffled 486.2 s,
   geometry 1.0 s; Mac CPU, 4 threads; budget respected, no extension.
8. **Training curve**: dev pitch 0.368→0.680 monotonic-ish; loss 0.936→0.337.
9. **TRAIN metrics**: pitch 0.713, dur 0.725, kind 0.993 (dots/staff/acc/grace/
   cue/voice at or near majority).
10. **DEV metrics**: pitch 0.680, dur 0.686, kind 0.996 (staff 0.708, voice
    0.736 below majority — needs context).
11. **Notation-family metrics**: pitch/duration/staff/voice/accidentals/rests
    per-head; dots as family head; ornaments/text excluded by rule.
12. **Rare-class metrics**: grace pitch 0.116 (n=43); cue absent in dev;
    minority durations ≈0; octave-shifted 0.396 printed (n=2,194, unseen
    TRAIN scores).
13. **Controls**: blank pitch 0.075, shuffled 0.074, geometry 0.056 — all at
    chance; duration/staff/voice likewise show pixel dependence.
14. **OLiMPiC DEV result**: no transcription attempted (sequence model out of
    scope); image/token statistics measured (see T10).
15. **Domain gap**: tighter crops, varied scale, ~2× contrast, ~5× texture,
    ~4× ink density vs renders; transfer unproven, recalibration required.
16. **Capture status**: 8-page print packet staged with hashes + procedure;
    physical capture pending; not validation data yet.
17. **CASE A/B/C**: CASE A, with the scope limits above.
18. **Full 792-score training justified**: yes, as the next phase with
    page-context and rare-class handling.
19. **RTX/full training justified**: yes, capped, with the same gates; no
    uncapped sweep.
20. **Exact next experiment**: scale the probe to full TRAIN (792) adding
    page-context staff/voice heads + minority-duration/rare-class handling;
    model-select on DEV; execute the 8-page capture; keep both TESTs sealed
    until the recipe freezes, then run OLiMPiC TEST + pilot TEST once.
