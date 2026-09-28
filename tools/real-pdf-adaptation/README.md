# Real-PDF domain adaptation for the V2.5 adapter

Smallest safe campaign that adapts the **qualified step-2100 checkpoint** to
production-rendered sheet music without losing what it already knows.

Nothing here changes the V2.5 architecture, the production adapter, the
detector, deployment or the UI. Everything here produces *training records* that
travel the exact canonical code path the production adapter already uses, and
evaluates candidates on two fixed gates.

Read `DIAGNOSIS.md` first. It contains the measurement that determines the
learning-rate design: the failure is in the **representation** feeding the pitch
head, not in the pitch head.

---

## 1. Files

| file | role |
|---|---|
| `audit_pairs.py` | audits matched PDF+MusicXML pairs, writes `split_manifest.json` |
| `split_manifest.json` | the frozen by-score split, with content hashes and rejection reasons |
| `musicxml_truth.py` | MusicXML -> printed-measure truth; refuses anything ambiguous |
| `align_objects.py` | detected objects <-> MusicXML alignment; emits `target.families` |
| `build_corpus.py` | renders PDFs through the **production** path, writes canonical records |
| `realpdf_data.py` | `PageResolver`-shaped reader + manifest writer for the real-PDF corpus |
| `train_realpdf.py` | the fine-tune trainer (dual source, 4 LR groups, no self-selection) |
| `evaluate_realpdf.py` | both gates: held-out real PDF **and** original qualification |
| `make_manifests.py` | freezes the four evaluation manifests, refuses a split leak |
| `run_rtx_qualification.ps1` | the whole RTX gate, in order, config at the top |
| `audit_rtx_runner.py` | static audit of the runner; never executes it |
| `DIAGNOSIS.md` | the representation-shift ablation that drives the design |
| `README.md` | this file |

The corpus itself is **not** committed. It is 19 s to rebuild from the PDFs
already in the repository, and it is a derived artifact.

---

## 2. What gets rendered, and why it is the same pixels

`build_corpus.py` imports the production modules and calls them:

```
piano_vision_service.v25_adapter.V25ScoreAdapter._render_pdf_pages     (RENDER_DPI = 150)
                                      ._detect_content_bounds / _detect_staff_systems
                                      ._build_measure_grid
                                      ._detect_page_objects            (the real detector)
piano_vision_service.v25_canonical_features.build_page_records          (modelInput)
                                      .staff_bands / .staff_space
```

Pages are written once as 8-bit grayscale PNGs. Training then re-crops them
through the canonical `piano_vision.v2.data.crop_view`, so a batch fed to the
model during adaptation is cut by the same code, with the same padding, that
cuts the pixels at inference. No crop is precomputed and no tensor is cached, so
training cannot silently drift from production. Concretely identical to
inference:

- rasterization: `fitz.Matrix(150/72, 150/72)`, `get_pixmap(alpha=False)`, `convert("L")`
- DPI: 150
- crop convention: `crop_view(..., 512, 192, pad=.08)`
- proposals: the production detector's own notehead/rest candidates, in its
  canonical `(cx, cy)` order, which is asserted to be V2.5 object slot order
- `build_inputs` -> `attach_object_page_geo` -> `collate_v25` -> `prepare_batch`

`sourceTensor` is left at production's `[0.0]*16` and `sourceGraph` at
`UNAVAILABLE`, exactly as `build_page_records` emits them. We deliberately do
**not** synthesise a richer source tensor: doing so would train the model on
inputs production never produces.

---

## 3. Labels: MusicXML semantics, never a model prediction

For every accepted (measure, band) group the builder emits the same
`target.families` schema the qualified checkpoint was trained on, so
`piano_vision.v2.data.attach_targets` and `tensorize_v25` consume the records
with no special casing.

- `PITCH_STAFF.writtenPitch / accidentalState / clefContext` from MusicXML
- `PITCH_STAFF.staffPosition.stepsFromBandCenter` = `(staffBandCenter - objectCenterY) / staffGap`,
  using the production `staff_bands` / `staff_space`. Verified against 6,029
  qualified-corpus labels across 40 scores: max absolute error 5e-4.
- `DURATION` from MusicXML `duration/divisions/type/dots/time-modification/grace`
- `LANE` from MusicXML `<voice>`, emitted as `"<part>:lane-<n>"`, the exact shape
  `piano_vision/data.py::_lane_class` parses
- `REST` from MusicXML rest elements
- `ATTACK` / `CHORD` from MusicXML onset plus part/voice identity

No checkpoint, no forward pass and no decoder hypothesis is read anywhere in the
label path.

### Refusals, and what they mean

A group is dropped whole, and counted in `coverage.json`, when any of these hold:

| reason | meaning |
|---|---|
| `unreliable_staff_lines` | fewer than 4 staff lines detected in that band |
| `too_few_offset_samples` | not enough objects to establish the band offset |
| `too_few_accepted_matches` | fewer than 3 objects land on the MusicXML pitch lattice |
| `event_coverage_too_low` | the pairing does not explain the events it could contain |
| `object_coverage_too_low` | too few objects explained for the pairing to be real |
| `residual_std_too_large` | pitch residuals scatter beyond 0.35 staff steps |
| `band_offset_disagrees` | the measure's true offset is far from the analytic one, i.e. its staff lines were detected badly |
| `no_xml_measure_partner` | no monotone MusicXML measure pairing cleared the threshold |

The band offset is **derived, not fitted**: a correct five-line staff gives -1
for G-on-line-2 and +1 for F-on-line-4, and the measured medians are -0.977 and
+1.023 with a spread of 0.01 staff steps. Nothing is calibrated against the
ground truth, so the acceptance test is not circular.

---

## 4. Split: by score, never by measure

A score belongs to exactly one split. Held-out and diagnostic scores never
contribute a training measure, and `realpdf_data.assert_trainable` makes every
training entry point refuse them.

The production measure grid splits and merges real measures, so a fixed 1:1
index drifts. The builder searches for a **non-decreasing** map from detected
printed measures onto MusicXML measures, scoring each candidate by how well the
detected pitch values land on that measure's MusicXML pitch lattice, and
requiring the score to clear a threshold before the pair counts. One- and
two-object fragments must land perfectly; fuller measures only have to clear the
ordinary threshold.

---

## 5. Fine-tune configuration

| group | parameters | LR | why |
|---|---|---|---|
| `visual` | `backbone`, `visual_projection`, `object_projection`, `geometry_projection` | 1.2e-4 | the broken path: reads the raster and the sampled box |
| `pitch` | `heads.object.pitch_*` | 2.0e-4 | must move for the new geometry regime |
| `heads` | every other head + feedback projections | 3.0e-5 | already 0.96-0.99 on the original qualification |
| `shared` | `event_projector`, `pointer`, `object_memory`, `notation_bias`, `notation_decoder` | 1.5e-5 | replay-only supervision, off the pitch path |

Reference point: the run that produced the step-2100 checkpoint used
lr 1.5e-4 (trunk) / 3.0e-4 (new heads) from a **V2** trunk over 2,100 steps on
278,463 examples. Here the shared representation moves 5-10x slower than that
to prevent forgetting, while the visual and pitch groups move at a comparable
rate because they must relocate quickly on far fewer examples.

Other settings: AdamW, weight decay 1e-4, grad clip 1.0, warmup 30, cosine to
0.1 over the run horizon, `samples_per_step 8`, `views_per_micro 32`,
`adapt_ratio 0.5`, fp32, `consistency_scale 0`.

`consistency_scale 0` because the label-free structural penalties need
notation sidecars, which real PDFs do not have; replay still supplies them.

`--max-steps` is capped at 300. Passing more requires `--allow-long`, which is a
gate, not a knob.

### Replay

Every optimizer step draws `1 - adapt_ratio` of its window from the **original**
V2.5 training manifest (`v2-serious-medium-full-v1/train.json`, 278,463
examples, with its notation sidecars), mixed 1:1 with adaptation measures. The
corpus distribution the checkpoint earned its capability on never goes stale,
and the sidecar-only heads (pointer, notation) keep their supervision.

### Selection

`train_realpdf.py` **never writes a "best" checkpoint**. It saves periodic step
checkpoints and stops. Checkpoint choice is made offline by
`evaluate_realpdf.py` on the fixed held-out real-PDF set and the fixed original
qualification prefix, with a regression budget against the recorded step-2100
baseline. Training-set accuracy is not read by the evaluator at all.

`object.rest` is masked out of adaptation supervision by default. The qualified
corpus never supervised its positive class, so training it on real-PDF rests
would be an unrelated behaviour change with no bearing on pitch. Replay keeps
the head exactly where qualification left it. `--train-rest-head` opts in.

---

## 6. Runbook (Windows RTX laptop)

The runner does all of this in order and stops at the first failure. Everything
editable is in the config block at the **top** of the file.

```powershell
cd C:\scoreflow-worker
powershell -ExecutionPolicy Bypass -File .\tools\real-pdf-adaptation\run_rtx_qualification.ps1
```

Stages: preflight -> corpus build/verify -> 20-step profile -> baseline real-PDF
validation -> baseline original-distribution check -> 300-step adaptation ->
per-candidate validation + retention -> diagnostic -> held-out (once, on the
fixed winner) -> authoritative 63,086 original run.

Preflight refuses to start unless the checkpoint SHA256 matches the qualified
step-2100 artifact, CUDA is present, and there is disk headroom.

Audit the runner without running it:

```bash
python tools/real-pdf-adaptation/audit_rtx_runner.py --verbose
```

It checks the config block is at the top, that every `--flag` the runner passes
exists in the target script's real argparse surface (69 flags), that no variable
is read before assignment, that selection never references held-out or
diagnostic data, that `--allow-long` is never passed, and that the frozen metric
is present. It has been negative-tested: injecting a bogus flag, leaking
held-out into selection, and passing `--allow-long` each make it fail.

### Manual equivalent

```bash
# corpus
python tools/real-pdf-adaptation/audit_pairs.py
python tools/real-pdf-adaptation/build_corpus.py --out CORPUS \
  --splits adaptation,validation,heldout-test,diagnostic
python tools/real-pdf-adaptation/make_manifests.py --corpus-index CORPUS/index.json

# measure, do not guess
python tools/real-pdf-adaptation/train_realpdf.py --out RUN/profile \
  --adapt-manifest CORPUS/adaptation.json --corpus-index CORPUS/index.json \
  --replay-manifest tmp/campaign/piano-vision-phase214/v2-serious-medium-full-v1/train.json \
  --init-checkpoint CKPT --profile-only 20 --samples-per-step 8 --device cuda

# baseline, then the short run
python tools/real-pdf-adaptation/evaluate_realpdf.py --checkpoint CKPT \
  --corpus-index CORPUS/index.json --out EVAL/baseline-step2100.json \
  --real-pdf-splits validation --original-limit 6000 --device cuda

python tools/real-pdf-adaptation/train_realpdf.py --out RUN/qual-300 \
  --adapt-manifest CORPUS/adaptation.json --corpus-index CORPUS/index.json \
  --replay-manifest tmp/campaign/piano-vision-phase214/v2-serious-medium-full-v1/train.json \
  --init-checkpoint CKPT --max-steps 300 --samples-per-step 8 --adapt-ratio 0.5 \
  --lr-visual 1.2e-4 --lr-pitch 2.0e-4 --lr-heads 3.0e-5 --lr-shared 1.5e-5 \
  --checkpoint-every 50 --pin-memory --device cuda

# every candidate, against the SAME baseline and metric
for CK in RUN/qual-300/checkpoints/checkpoint-step-*.pt; do
  N=$(basename $CK .pt)
  python tools/real-pdf-adaptation/evaluate_realpdf.py --checkpoint $CK \
    --corpus-index CORPUS/index.json --out EVAL/eval-$N.json \
    --real-pdf-splits validation --original-limit 6000 --device cuda \
    --baseline-report EVAL/baseline-step2100.json --max-regression 0.02
done
```

Authoritative original gate, once a winner is chosen:

```bash
python tools/piano-vision-v25-candidate/evaluate_v25.py --checkpoint WINNER \
  --run-identity v25-realpdf-adaptation \
  --val-manifest tmp/campaign/piano-vision-phase214/v2-serious-medium-full-v1/validation.json \
  --out EVAL/winner-full-63086.json --device cuda --engine optimized --workers 6
```

Compare with `v25-windows-transfer-20260927/v25-full-validation-63086.json`.

---

## 7. The frozen metric, and why 0.3676 and 0.0621 disagree

They are **two different metrics**, not two measurements of the same thing, and
neither is wrong. The gap decomposes into a large metric-definition effect and
two smaller population/input effects.

### The historical 0.3676

From `tmp/v25-diagnostics/minuet-report.json`, produced by
`tmp/v25-diagnostics/minuet_eval.py`:

```python
def match(truth, predicted, key):            # key == "key" -> (step, alter, octave)
    fields = ("measure", "staff", key)
    truth_index = Counter(tuple(n[f] for f in fields) for n in truth)
    pred_index  = Counter(tuple(n[f] for f in fields) for n in predicted)
    tp = sum(min(count, pred_index.get(k, 0)) for k, count in truth_index.items())
    return f1(tp, sum(pred_index.values()), sum(truth_index.values()))
# writtenPitchAccuracy = match(...)["precision"] = 75 / 204 = 0.3676
```

Four properties, all consequential:

1. it is a **bag intersection on `(measure, staff, written pitch)`**;
2. it **discards which object in a measure received which pitch** - a
   permutation of correct pitches within a measure still scores as a full match;
3. it runs on the **final generated MusicXML**, end to end through assembly;
4. its denominator is the **true note count (204)**, not the aligned object set.

### The adaptation evaluator's 0.0621

`written_pitch_accuracy` is a **per-object conjunction**: for each detected
object that the aligner matched to a MusicXML event, is
`predicted(step, octave, alter) == MusicXML writtenPitch(step, alter, octave)`?

### The decomposition, measured on one identical population

Both metrics were computed from the **same** 177 aligned Minuet objects and the
**same** step-2100 predictions:

| metric | value | on |
|---|---|---|
| per-object conjunction (strict) | **0.0621** | 11 / 177 objects |
| bag intersection on (measure, staff, pitch) | **0.2542** | 45 / 177 objects |
| historical end-to-end, box 1.3 wide | 0.3676 | 75 / 204 notes |

So:

- **metric definition accounts for 0.0621 -> 0.2542**, a 4.1x inflation, with
  nothing changed but the definition. This is the dominant term.
- **population** accounts for 177 -> 204 (~1.15x): the aligner confidently
  matched 177 of the detector's 204 Minuet noteheads; the historical run scored
  all 204.
- **input box convention** accounts for roughly the last 1.17x: the historical
  report records `objectBoxConvention {widthSpaces: 1.3}`, i.e. the
  `CORPUS_BOX_*` path, whereas raster-detected production objects take
  `RASTER_BOX_WIDTH_SPACES = 1.0`. The ablation in `DIAGNOSIS.md` puts the
  pitch head at 0.6723 with the 1.3-wide box and 0.5763 with both
  perturbations applied.
- **end-to-end vs head-level**: the historical number passes through the whole
  MusicXML assembler, which happened to emit exactly 204 pitched notes
  (`noteCountPerMeasure` P = R = 1.0), so only the pitch assignment was wrong.

### What is now frozen

`evaluate_realpdf.py` carries a `METRIC_DEFINITION` block (version
`real-pdf-metric-v1`) that is written into every report, and
`compare_metric_definitions` **refuses** to compare a candidate against a
baseline produced under a different definition. A baseline report without a
`metric_definition` is rejected outright. This makes it structurally impossible
for a checkpoint to be selected across two metric definitions.

**Canonical selection metric: `written_pitch_accuracy`** (the per-object
conjunction above), because:

- it cannot be inflated by a within-measure permutation of correct pitches;
- baseline and candidate score the identical object population, so the delta is
  meaningful;
- it is head-level, so it does not move when the MusicXML assembler is edited.

Secondary and reported but **never used for selection**:
`written_pitch_multiset` (0.2542 on the canonical population), kept purely so
the historical 0.3676 figure has a continuity series. **Never compare
`written_pitch_accuracy` against 0.3676.**

`object.pitch_staff_step` is likewise reported but not gated: its label
convention is corpus-specific and is expected to move as the representation
re-registers onto the production geometry.

### Recorded step-2100 baselines (Mac, CPU, reference for the RTX run)

| split | scores | records | pitch | midi | duration | note P/R/F1 | rest P/R/F1 |
|---|---|---|---|---|---|---|---|
| diagnostic | 2 | 125 | 0.0360 | 0.0586 | 0.4578 | 0.535/0.704/0.608 | 0.209/0.339/0.258 |
| - demo-minuet-in-g | 1 | 31 | 0.0621 | 0.0791 | 0.5056 | 0.662/0.751/0.704 | - |
| - beethoven-fur-elise | 1 | 94 | 0.0279 | 0.0523 | 0.4453 | 0.503/0.690/0.582 | 0.214/0.342/0.264 |

The authoritative baseline is regenerated by the runner on the RTX and must
reproduce these within noise.

---

## 8. Gates and selection

**Real PDF.** Selection runs on the **validation** split only. Held-out is scored
once, on an already-fixed winner, and can never move the selection. Diagnostic
is reported and never selected on.

- `written_pitch_accuracy` (canonical, defined in section 7)
- `derived_midi_accuracy`
- `duration_accuracy`, scored on the duration heads only and never conditioned
  on pitch being right, because conditioning it on pitch would make the number
  meaningless
- `note` and `rest` precision/recall/F1 on the detector's proposals against the
  MusicXML truth. The detector is unchanged by this campaign, so any drop here
  means something regressed and must be investigated before training continues.

**Original qualification.** Fixed manifest prefix, compared against the step-2100
baseline on the identical prefix:

- `object.pitch_written_step`, `object.pitch_octave`, `object.pitch_accidental`
- `object.duration_type`, `object.duration_dots`
- the token/event metrics the campaign already reports: `event_accuracy`,
  `event_f1`, `pointer_accuracy`, and every group/head accuracy in the report
- the authoritative full 63,086-example run once, via the unmodified
  `evaluate_v25.py`, compared to `v25-full-validation-63086.json`

**The gate is: `written_pitch_accuracy` on validation must improve substantially,
and no original-qualification head may regress by more than 0.02**
(`--max-regression`).

### Selection procedure

1. `candidate-gates` evaluates **validation** + the original prefix for every
   periodic checkpoint, against the step-2100 baseline report.
2. A candidate is eligible only if `gate_verdict.passes` is true.
3. Among eligible candidates, the highest `written_pitch_accuracy` wins.
4. Only then is the winner run on `diagnostic` and on `heldout-test`.

Training-set accuracy is never read by the evaluator, and `train_realpdf.py`
never writes a "best" checkpoint. `realpdf_data.assert_trainable` refuses to
open any non-adaptation split for training.

---

## 9. Known limits of this dataset

- **No LilyPond score survives the audit.** `la-campanella` and
  `spider-dance-undertale` put two MusicXML lanes on the same staff band in
  95/150 and 16/87 printed measures, so the printed measure cannot be split by
  band at all. The `Bravura/Edwin/Leland` engraving family therefore has zero
  training and zero evaluation scores. If LilyPond-domain coverage matters,
  those two exports need fixing before they can be used.
- **Held-out coverage is uneven.** `tchaikovsky-old-french-song` yields 11
  aligned measures of 78 detected, because the production measure grid
  over-splits that engraving. The held-out set is still five scores and 1,277
  pitch labels overall, but per-score numbers in the report should be read
  before drawing conclusions about any single piece.
- **`brahms-lullaby` and `piano-rhythm-tuplets-vector` are rejected outright**:
  their MusicXML declares no F-clef lane, so they are not grand staves.
- **`corranzo-holdout-intake` (13 PDFs) is unusable**: no MusicXML at all, so no
  ground truth can be produced.
- The synthetic `CorranzoBenchmarkMusic` fixtures contribute evaluation scores
  but are single-font 8-measure pages; they are a geometry guard, not a domain
  sample.
