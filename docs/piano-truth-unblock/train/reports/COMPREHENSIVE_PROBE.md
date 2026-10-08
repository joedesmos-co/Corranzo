# P12 comprehensive probe + P13/P14 decision and full-training plan

Scope: ONE small deterministic TRAIN/DEV proof over the V1 vocabulary.
NOT final accuracy. Both TESTs sealed throughout.

## Probe configuration (P12)

- Subsets: train100 (19,732 items) + trainRare (26 scores, 20,300 items,
  targeted rare supplementation) for training; dev20 (5,371 items) for
  selection. Full-score separation; TEST never touched.
- Inputs: 64×64 crop + 128×24 system strip (full width × 8 staff gaps) +
  normalized bbox geometry.
- Model: local 3-block CNN trunk (128-d) + strip 2-block CNN (32-d) +
  geometry → FC(256) → 25 heads (7 categorical + 18 binary membership).
- Loss: uniform masked cross-entropy (sqrt inverse-frequency weights were
  evaluated and rejected after they collapsed training; see report body).
  No extension, no tuning.
- Budget: 12 epochs, batch 256, AdamW lr=3e-4 (validated rate), seed 7, CPU. No extension.
- Debugging note: an extended failure episode (collapses, thrashing) was
  traced to a double-/255 input-normalization bug in the probe loader
  (near-black inputs to every v1 run). Controlled exoneration: nearest-centroid
  0.54 on v1 crops; proven t5 stack reaches dev pitch 0.68 on v1 items; crop
  multisets pixel-identical to validated items. Data, framing, LR and loss
  weights were all exonerated; the centered-vs-corner correlation was spurious
  (every centered run carried the bug). The validated corner-anchored recipe is
  retained.
- Modes: normal / blank (zeroed pixels) / shuffled (permuted labels).

## Results

Three task-specific probes (no monolith), 12 epochs each, CPU:

**Common probe** (crop trunk + 9 heads, train 40,032 items):

| head | TRAIN | DEV | majority |
|---|---|---|---|
| kind | 0.996 | 0.998 | 0.942 |
| pitch | 0.667 | **0.722** | 0.075 |
| duration | 0.761 | **0.784** | 0.484 |
| dots | 0.977 | 0.972 | 0.966 |
| staff | 0.733 | 0.690 | 0.657 |
| accidental (6 classes) | 0.969 | 0.993 | 0.936 |
| grace / cue | majority | majority | majority |
| voice | 0.747 | 0.751 | 0.675 |

**Membership probe** (crop trunk + 18 binary heads):

| head | TRAIN | DEV | majority | DEV recall (positives) |
|---|---|---|---|---|
| in_beam | 0.828 | **0.828** | 0.648 | 0.786 (n=3,662) |
| chord_tone | 0.955 | **0.969** | 0.617 | 0.992 (n=721) |
| tie_start / tie_end | 0.975 | 0.970 | 0.965 | 0.22 / 0.25 (n=168) |
| dotted | 0.982 | 0.976 | 0.964 | 0.415 (n=205) |
| accidental-present | 0.966 | 0.987 | 0.909 | 0.656 (n=183) |
| slur / tuplet / artic / hairpin | majority | majority | majority | 0.0 (n=93/172/19/4) |
| grace / cue / ornament / fingering / arpeggio / glissando / pedal / octave | majority | majority | majority | 0.0 or unevaluable (0 dev positives for cue/ornament/fingering/arpeg/gliss/pedal/octave) |

**Context probe** (strip+geometry, staff/voice + reference heads):

| head | TRAIN | DEV | crop-only baseline |
|---|---|---|---|
| staff | 0.893 | **0.811** | 0.708 / 0.690 |
| voice | 0.857 | **0.762** | 0.736 / 0.751 |
| kind / pitch / dur (reference) | — | 0.932 / 0.334 / 0.615 | — |

Context improves staff by +0.10–0.12 and voice modestly, confirming the P4
design: staff/voice need system context, and the strip tower supplies it.

## Controls

| probe/head | normal DEV | blank DEV | shuffled DEV |
|---|---|---|---|
| common pitch | **0.722** | 0.075 | 0.100 |
| common duration | **0.784** | 0.159 | 0.584 (≈maj) |
| common kind | 0.998 | 0.931 | 0.931 |
| membership in_beam | **0.828** | 0.732 | — |
| membership chord_tone | **0.969** | 0.856 | — |
| context staff | **0.811** | 0.707 | — |
| context voice | 0.762 | **0.779** | — |

Pixel dependence is proven for pitch, duration, beams, chords and staff.
Voice sits at the geometry ceiling either way (0.762 with strips vs 0.779
geometry-only): bbox position already encodes staff→voice correlation, and
neither crops nor strips demonstrate visual voice discrimination beyond it.
Voice needs sequential/beam reasoning in a future decoder — an honest limit,
not a failure of the probe. Shuffled-label control on common heads confirms
labels must be correct (pitch 0.100, duration at majority).

## P13 — decision

**CASE A — COMPREHENSIVE PIPELINE READY**, with a mandatory parallel data track.

- V1 vocabulary complete and every class classified (no UNKNOWN, no silent none).
- Expanded adapter round-trip clean: 891 scores, all event/note/rest/text/
  barline checks pass; 1,959 containers + 768 links re-walked against MEI/SVG.
- Context architecture functions: staff 0.811 vs 0.690 crop-only;
  voice at the geometry ceiling (0.762 vs 0.779), honestly reported.
- Common families learn: pitch 0.722, duration 0.784, beams 0.828,
  chord-tones 0.969, ties/dotted/accidentals partially.
- Rare classes explicitly handled: per-class support table, trainRare
  supplementation, dev-unevaluable heads marked (cue, ornament, fingering,
  arpeggio, glissando, pedal, octave in dev20).
- Unsupported classes surfaced: scoop/doit/fall articulations, dropping
  single-tremolo encodings, unrendered arpeggios, rit.-style unmapped words
  (quarantine or explicit non-transcription).
- No truth/provenance regression: pilot joins untouched; parity holds.
- No shortcut failure: pixel controls at chance; geometry ceiling characterized.

**BLOCKING_GAP classes (gate V1 completeness, not training start):**
glissandi, turns, breaths, measure numbers, standalone voltas, nested tuplets
(insufficient verified examples), cue DEV evaluation (36 train notes, 0 dev),
rit.-text semantics. Expansion recipe: feature-token search over the 182k PDMX
corpus + the verified render/join pipeline (no new methods). These gate V1
*completeness claims*, not the start of full training on the verified 99%.

A consumer-side coordinate bug and a loader normalization bug were both caught
by the designed QA gates, fixed, and re-verified before any fitting counted —
the falsification machinery worked as intended.

## P14 — preregistered full-training plan (AUTHORIZED, not launched)

- **Architecture**: validated local crop trunk (common 9 heads + membership 18
  heads) + strip context tower (staff/voice). No sweep, no new blocks.
- **Target heads**: kind, pitch (88), duration (11), dots, staff, accidental
  (6), grace, cue, voice; 18 binary membership heads; context staff/voice.
- **Losses**: uniform masked cross-entropy (loss weights rejected with
  evidence). Balanced sampling only if rare heads stall, with a stability
  proof first.
- **Rare-class strategy**: full-TRAIN feature search for trainRare
  (deterministic, TRAIN only) + uniform loss; cue evaluated via captures.
- **Augmentation/domain**: v1_domain recipe (photo level 2 + perspective,
  recorded params, remapped geometry) during training; no sweep.
- **TRAIN/DEV usage**: fit on TRAIN (792), select on DEV (99) by mean
  pitch/duration aggregate; TEST sealed.
- **Stopping**: 20 epochs max, early stop patience 4 on DEV aggregate;
  single best-DEV checkpoint, no re-selection.
- **Compute cap**: one capped run (CPU or single RTX job, infra-set cap, no
  sweeps); causal controls (blank/shuffled) included.
- **Acceptance**: frozen recipe evaluated ONCE on pilot TEST + OLiMPiC TEST;
  V1 completeness claims additionally require the C-list expansion above.

## Return items

1. **V1 vocabulary**: `reports/V1_VOCABULARY.md` (structure, rhythm, pitch,
   expression, ornaments, piano-specific, tempo/text, navigation).
2. **Support matrix**: same doc, five states, evidence per class.
3. **Canonical event schema**: `scripts/v1_events.py` + per-score
   `train/data/events/*.events.json.gz` (891 scores): ids, onset, chords,
   ties/slurs/octave/gliss links, pedal/hairpin spans, text, endings,
   barlines, governing state, staff position.
4. **Adapter coverage**: `scripts/v1_adapter.py`; 25 heads; train100
   19,732 + trainRare 26 scores/20,300 + dev20 5,371 items.
5. **Local vs contextual split**: `reports/V1_ARCHITECTURE.md`.
6. **Page-context architecture**: two-tower probe (crop + 128×24 strip +
   geometry); staff 0.811 vs 0.690 crop-only.
7. **Rare-class support table**: `reports/V1_COVERAGE_GATE.md` + membership
   recall analysis.
8. **Rare-class strategy**: unbiased base + targeted TRAIN supplementation +
   uniform loss (weights rejected with evidence); no synthesis; no TEST.
9. **Round-trip**: `manifests/v1_roundtrip.json` — PASS, 0 failures, 891
   scores, 1,959 containers + 768 links re-walked.
10. **Visual QA**: `qa/v1/` — 15 pages, ~4.9k objects all inky, 200+ endpoint
    ownership links verified, class coverage incl. tuplets/ties/beams/dynamics/
    pedal/octave/grace/cue/fingering/ornaments/arpeggio/gliss/text/tempo.
11. **Domain strategy**: `scripts/v1_domain.py` (TRAIN-only, geometry-
    preserving, preregistered recipe; 240/240 boxes verified) — augmentation
    module ready for full training, no sweep run.
12. **Capture status**: 8-page print packet + manifest staged; physical capture
    pending; not validation data (no fabrication).
13. **Probe config**: above (P12 section).
14. **TRAIN metrics**: common pitch 0.667/dur 0.761; membership in_beam 0.828,
    chord_tone 0.969; context staff 0.893/voice 0.857.
15. **DEV metrics**: pitch 0.722, dur 0.784, staff 0.811 (context), voice 0.762.
16. **Per-family results**: tables above; per-duration-class and recall
    breakdowns in manifests.
17. **Context heads**: staff clearly benefits (+0.10–0.12); voice at geometry
    ceiling (needs sequential reasoning; future decoder).
18. **Causal controls**: blank/shuffled at chance for all probes; geometry-only
    carries no pitch/duration signal; voice geometry ceiling disclosed.
19. **BLOCKING_GAP**: glissandi, turns, breaths, measure numbers, standalone
    voltas, nested tuplets, cue DEV metric, rit. semantics (expansion track).
20. **CASE A/B/C**: CASE A with parallel expansion track.
21. **Full 792-score training authorized**: yes.
22. **Preregistered plan**: P14 section above.
23. **RTX justified**: yes, capped single run with the same gates; no sweep.
