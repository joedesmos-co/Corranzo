# Guitar Vision — Phase 0 Audit and Root-Cause Report

**Status:** Phase 0 complete. No model has been trained. No existing test weakened.
**Baseline artifact:** `baselines/guitar-v1-baseline.json` (regenerate: `node tools/guitar-vision/corpus-baseline.mjs --out baselines/guitar-v1-baseline.json`)
**Coverage artifact:** regenerate with `node tools/guitar-vision/notation-coverage.mjs --json <path>`

> **Update — the pitch contract is now frozen and enforced.** RC-1 has been fixed
> (`guitar-pitch/1.0`, see `docs/GUITAR_VISION_PITCH_CONTRACT.md`). Mean pitch
> accuracy on the same 13 real scores moved **5.7% → 17.4%** and the dominant
> +12-semitone systematic offset is eliminated on 5 of 12 scores. This is a fix to
> the measurement and to playback, **not** a gain in recognition. Post-fix baseline:
> `baselines/guitar-v1-pitch-contract-fixed.json`. The numbers in §1 below are the
> pre-fix floor and are kept deliberately, because they are what Guitar Vision
> must actually beat.

---


## 1. Headline

Guitar OMR is not merely inaccurate. It is **non-functional on real guitar scores while reporting high confidence**, and the
evaluation harness that was supposed to catch that is structurally incapable of doing so.

| Metric (13 real Mutopia/public-domain guitar scores) | Mean | Median |
|---|---|---|
| Pitch accuracy | **5.7%** | 5.3% |
| Order-sensitive pitch recovery | **4.1%** | 3.8% |
| Duration accuracy | 30.8% | 24.1% |
| Onset accuracy | 27.7% | 23.4% |
| Onset **time** accuracy | **0.4%** | 0.0% |
| Note detection F1 | 52.1% | 52.5% |
| Chord grouping accuracy | 34.3% | 30.5% |
| Measure count accuracy | 82.7% | 87.4% |
| **Self-reported confidence** | **89.0%** | — |
| Scores accepted as "good quality" | **12 / 13** | — |

5.7% pitch accuracy is below the ~8.3% you would score by guessing uniformly among 12 pitch classes. The system is
not partially working; it is producing plausible-looking, confidently-labelled wrong output.

One of the 13 scores (`guitar-spanish-romance`) is refused outright by the quality gate.

---

## 2. Root causes, in order of impact

### RC-1 — There is no single written-pitch ↔ sounding-pitch contract (highest impact, partially fixable now)

**Evidence.** On BWV 997 the per-note semitone-delta histogram has a dominant spike:

```
   12 :   338   41.0%   #########################################
   11 :    66    8.0%   ########
```

Exactly one octave. Correcting a global −12 shift moves index-paired exact pitch accuracy from **1.1% → 41.0%**, and
within-2-semitones from **4.7% → 57.8%**. The whole corpus shows the same signature (dominant offset +12 on 6 of 12
transcribed scores, up to 58% of notes on a single score).

**Mechanism.** Three components disagree about what pitch a `<pitch>` element means:

| Component | Assumption |
|---|---|
| Emitter (`src/features/omr/buildOmrMusicXml.js:734`) | `const octaveShiftSemitones = 0` — hardcoded. Emits **written** pitch, plus `<clef-octave-change>-1</clef-octave-change>`, and **no** `<transpose>`. |
| Parser (`src/features/musicxml/parseMusicXml.js:547`) | Reads `<clef-octave-change>` into clef metadata but **never applies it or `<transpose>` to note MIDI**. So `<pitch>` is taken as the sounding pitch. |
| Practice-library truth files | Store the **sounding** pitch, expressed in bass clef. BWV 997 opens on `A2` with `<sign>F</sign><line>4</line>`. |

I verified the printed page visually: BWV 997 is engraved in **treble clef with an 8 below** and opens on a written
`A3` on a ledger line. The OMR's clef detection is *correct*. The truth file is storing sounding pitch in a clef that
does not match the print.

**Consequence.** Three separate problems follow:
1. The metric compares two different conventions and reports near-zero pitch accuracy.
2. **Product bug:** playback, score-following, Wait For You and Play Along all consume the parser's MIDI, so guitar
   playback is an octave sharp on real scores.
3. **Interoperability bug:** the emitted file is internally inconsistent — `clef-octave-change="-1"` with written pitch
   and no `<transpose>`. A conformant reader will sound it an octave lower; the Corranzo parser will not. The same file
   behaves differently in Finale/MuseScore and in Corranzo.

The misleading comment at `buildOmrMusicXml.js:730-733` says staff-derived MIDI "is already sounding (matches TAB / CC0
truth)". That is true for the synthetic CC0 fixtures and false for real scores. **The bug was introduced by tuning
against synthetic fixtures, not real engraving.**

### RC-2 — The benchmark cannot detect guitar regression

`benchmarks/omr-benchmark.manifest.json` records guitar thresholds such as:

- `guitar-standard-chords-vector`: `pitchAccuracy: 0.0`
- `guitar-techniques-paired-vector`: `pitchAccuracy: 0.0313`
- `guitar-paired-chords-vector`: `pitchAccuracy: 0.1121`

Running the current engine over those same fixtures today yields **100% on every metric for all four** (verified via
`node scripts/omr-benchmark-dashboard.mjs --from-reports …`). They all report `pass`.

A floor of `0.0` for pitch accuracy **can never fail**. These thresholds were ratcheted down to whatever the engine
happened to emit at the time, under an evaluator version that no longer matches the code. The suite is green because the
bar was set to the floor, not because guitar recognition works.

The same run shows the deeper problem: **synthetic guitar scores 100%, real guitar scores 5.7%** — a ~94-point gap
between the benchmark domain and reality. The CC0 fixtures are rendered with a bespoke font
(`benchmarks/omr-fixtures/font/CorranzoBenchmarkMusic.ttf`), so noteheads and fret digits are crisp synthetic glyphs.
Optimising against them optimises for an engraving style that does not exist in the wild.

### RC-3 — Loose bag metrics hide incorrect object identity

On BWV 997, `correctPitchCount = 122` (12.4%) but `greedyCorrectPitchCount = 28` (2.8%), and
`pitchCorrectAtCorrectOnsetCount = 58`. The bag metric finds 122 "correct" pitches; respecting order and onset
coincidence collapses that to 28–58. Every one of the 793 matched notes has the wrong onset time
(`correctTimeCount: 0`).

Per the standing rule, metrics must be **per-object and alignment-aware**. The current headline `pitchAccuracy` is a
bag metric and materially overstates capability.

### RC-4 — Guitar notation support is emitter-only, never detected

| Family | Parser | Emitter | Detector |
|---|---|---|---|
| hammer-on | reads | emits | **absent** |
| pull-off | reads | emits | **absent** |
| bend | reads (amount hardcoded `'1'`) | **absent** | **absent** |
| vibrato | reads | **absent** | **absent** |
| slide | reads | **absent** | **absent** |

`grep -rn "hammerOn\|pullOff\|bendAmount\|preBend\|releaseBend" src/` returns **4 hits, all in
`omrV3MusicXml.js` lines 250–258 — the emitter.** No detector ever populates these fields, so the code is unreachable
dead code. Bend *amounts*, pre-bends and bend releases are not representable at all (the parser hardcodes `'1'`).

Against the required surface, essentially the entire guitar-technique vocabulary is missing.

### RC-5 — Zero ground truth for most of the notation surface

Generated by `tools/guitar-vision/notation-coverage.mjs` over 653 scores:

- **78 notation families tracked; 42 have ZERO labels**, 13 more are "thin" (<50 labels).
- **1 score in the entire repository contains a real 6-line TAB staff** (`public/fixtures/guitar-ode-to-joy`).
- **1 score contains paired notation + TAB** (the same file).
- **0 scores contain any guitar technique marking** (hammer-on, pull-off, bend, slide, vibrato).
- 13 real guitar scores exist (Mutopia), but all are plain 5-line standard notation with no TAB.

Zero-coverage families include: `bend`, `bend-amount`, `pre-bend`, `bend-release`, `vibrato`, `hammer-on`, `pull-off`,
`slide`, `glissando`, `natural-harmonic`, `artificial-harmonic`, `pinch-harmonic`, `tapping`, `palm-mute`, `let-ring`,
`tremolo-picking`, `whammy-bar`, `capo`, `alternate-tuning`, `scordatura`, `string-assignment`, `fret-position`,
`barre`, `chord-symbol`, `chord-diagram`, `pick-direction`, `sforzando`, `segno`, `coda`, `dc-ds`, first/second
endings, key/time/clef changes, `ritardando`, `accelerando`, `ghost-note`, `dead-note`, `stacked-notes`.

**No amount of modelling can fix a family with no labels.** Acquisition is a prerequisite, not a follow-up.

### RC-6 — TAB rhythm is knowingly faked, and the warning is not surfaced as a failure

`src/features/omr/detectTabNotation.js` infers TAB rhythm by **even beat-slot packing**, not by reading stems, beams
or flags:

```js
const timingModel = { kind: 'tab-approximate-even', approximate: true, … }
```

Rhythm confidence is hardcoded to a **0.42–0.62 band** (`tabTimingConfidence`). This is honest as a warning but it means
**TAB-only guitar scores can never have correct rhythm**, regardless of print quality. Real TAB encodes rhythm through
stem/beaming; the engine does not read it.

Additional TAB deficits: tuning is hardcoded to standard EADGBE `[64,59,55,50,45,40]`; string count is fixed at 6; and
`detectTabTextAnnotations` explicitly discards capo, repeat/coda/segno and tempo text
(`TAB_CAPO_UNSUPPORTED_WARNING`, `TAB_REPEAT_CODA_WARNING`, `TAB_TEMPO_TEXT_WARNING`).

### RC-7 — Piano assumptions reused for guitar

- **Transposition:** `pitchFromStaffPosition.js` applies only *clef* octave change. Written pitch is used as sounding
  pitch — valid for piano, wrong for guitar (RC-1).
- **Grand-staff machinery is on the guitar path.** `processVectorOmrPage.js` calls
  `resolvePitchFromGrandStaff` (lines 312, 918, 939) and carries dedicated grand-staff reconstructors
  (`reconstructGrandStaffHalfDottedCadence`, whole-octave "pedal" recovery) that are piano-specific and are executed
  for guitar input too. Guitar has no grand staff and no sustain pedal.
- **Clef detection is not treated as a decision.** It is a hardcoded assumption, which is why BWV 997's printed
  treble-8vb is emitted with no confidence and no cross-check against the TAB band.
- **Multi-staff pairing heuristics** (`proximityPairs`, `structurePairs` in `detectTabNotation.js:510-526`) are
  barline-count/proximity guesses, not evidence-based pairing.

### RC-8 — No input-quality rejection gate

`preprocessOmrPageImage.js` computes `contrastSpread` and `noiseLevel` as *preprocessing* inputs, not a gate. There is
**no** blur (Laplacian variance), **no** minimum resolution, **no** perspective-distortion check, **no** crop check, and
**no** lighting check. `classifyOmrNegativePage` only detects "no systems" / "decorative page".

Evidence the metrics are not trustworthy: a perfectly clean digital PDF reports `noiseLevel: 54.18` yet
`looksLikeCleanDigital: true`. Meanwhile a genuine 12% -accuracy output reports `overallConfidence: 0.875` and
`acceptance: 'accepted'`, `confidenceBand: 'high'`.

Piano Vision already has the right shape in `tools/piano-vision/piano_vision/v2/quality.py`:
`min_short_side`, `min_contrast`, `min_laplacian_variance`, page-quad detection. **Reuse it.**

### RC-9 — The repository treats model output as data

`tmp/` (2.3 GB) is **committed to git** and contains ~129 `*.musicxml` files that are the OMR engine's own predictions
from past experiments, sitting alongside genuine ground truth. Any tooling that globs `**/*.musicxml` — including the
coverage inventory I wrote before noticing this — counts them as truth. Training on this directory would be circular.

Any corpus builder must classify files by provenance, not by extension.

---

## 3. What the existing engine *does* get right

Not everything is broken, and this should be preserved:

- Clef detection on real engraved pages is accurate (BWV 997 treble-8vb read correctly).
- Measure segmentation is reasonable on real scores (82.7% measure-count accuracy).
- Notehead *detection* finds a plausible number of noteheads (F1 52.1%) — the ink is being found. The failure is in
  interpretation (pitch/rhythm/identity), not primarily in rasterisation.
- Tie detection works on real pages (28 detected / 28 applied on BWV 997).
- The TAB/notation band-pairing scaffolding, measure grid, and diagnostics are real engineering worth building on.
- The engine already refuses rather than hallucinating on `guitar-spanish-romance`. That instinct is right; the gate
  thresholds are not.

---

## 4. Piano Vision reference assessment (read-only; not modified)

`tools/piano-vision/` is a genuine torch stack (torch 2.13.0 available locally) and is the right thing to imitate. Its
architecture is a DETR-style set predictor:

- `v2/visual.py` — `DetailBackbone`: stride-1 detail branch + strides 2/4/8/16 ConvNeXt blocks; `RegionSampler` does
  view-aware RoI grid sampling.
- `v2/model.py` — relation-aware `MusicalAttention` layers, per-object heads, per-relation heads, iterative refinement
  with relation message passing, plus a `NotationDecoder` for text/direction regions.
- `v2/data.py` — `development_scores` **refuses to open non-train/validation splits**; mixed-split shards raise
  `PermissionError`; context must come from the same score *and* split; page `pixel_digest` via SHA-256 of raw pixels.
- `v2/calibration.py` — `validation_partition()` splits validation deterministically into
  **selection / temperature / risk** roles, so checkpoint selection, temperature fitting and risk reporting never share
  data. Clopper-Pearson exact upper bounds per score.
- `v2/quality.py` — the input-quality policy that guitar needs (blur/contrast/resolution/page quad).
- `v2/readiness.py` — 10 named training gates that must all pass before serious training.
- `schemas/notation-ontology.schema.json` — versioned notation graph with `status: known|unknown`,
  `visual_coverage_qualified`, `verified_complete`. This is exactly the mechanism for "do not silently drop
  unsupported notation".

**Guitar Vision should reuse this infrastructure and extend it**, not rebuild it. The required additions are: a 6-line
TAB staff/string-line geometry branch, a fret-number head, a string-assignment head, staff↔TAB pairing relations, and
the full guitar-technique head set.

---

## 5. Phase 0 conclusion

Current guitar OMR is not repairable by patching heuristics. The evidence:

1. The dominant error (a 12-semitone offset on up to 58% of notes) is a **contract bug**, not a recognition failure —
   this is genuinely fixable and should be fixed, but fixing it changes the *metric and playback semantics*, so the
   evaluation contract must be frozen first (Phase 1), not after.
2. After accounting for that offset, residual error is **unstructured** (flat delta spread, 0.4% onset-time accuracy,
   52% F1) — that is a perception problem, which requires a learned model.
3. 42 of 78 required notation families have **no labels at all**, and TAB ground truth is a single score.
4. The existing benchmark **cannot fail**, and reports 100% on a domain that is 5.7% accurate in reality.

Per the standing instruction, no large training run is launched until the evaluation contract is frozen.

---

## 6. Phase 1 entry criteria (next)

- [x] Freeze the written↔sounding pitch convention; migrate truth files to a single canonical representation; make
      emitter, parser, playback and metrics agree. **Done — `guitar-pitch/1.0`.** Expect a large, honest metric jump
      that reflects *fixing the measurement*, not improving recognition. Measured: 5.7% → 17.4% mean pitch accuracy,
      systematic +12 offset eliminated on 5 of 12 scores. 20/20 ground-truth scores already conformed, so no label
      migration was required.
- [ ] Replace the bag metric with per-object, alignment-aware metrics (written pitch, sounding pitch, duration, onset,
      note/rest, string, fret, staff/TAB consistency, chord grouping, voice/lane, and the full technique set).
- [ ] Build frozen split manifests (train / validation / held-out / diagnostic) with pixel + truth fingerprints and
      source-level (song/book/site) grouping to prevent leakage.
- [ ] Re-baseline **both** domains and report the synthetic-vs-real gap as a standing metric.
- [ ] Enforce provenance classification so `tmp/` outputs can never enter a corpus.
- [ ] Produce a concrete acquisition plan for the 42 zero-coverage families, with counts required per family.
