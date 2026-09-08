# Corranzo PDMX Factory

Status: **GENERIC FACTORY REUSED — JOINT SEMANTIC CONTRACT VALIDATED**.

This isolated developer tool works directly with `PDMX.csv`, `pdf.tar.gz`,
`mxl.tar.gz`, and `subset_paths.tar.gz`. It never requires wholesale or manual
archive extraction. The existing generic ingestion, filtering, pair
verification, piano-structure verification, source-coordinate bundle
ingestion, canonicalization, bounded shards, resume/retry, validation, and
dashboard remain intact.

Phase 2.12Y passed the SCALE gate. The model-specific layer adds the validated
source-coordinate producer integration, semantic-gold assembler, joint emitter
schema, score-isolated shards, reserved future holdout, loader, trainer smoke,
evaluator, registry, and semantic dashboard counters. The full physical build
has completed; semantic assembly now supports bounded incremental resume.
See [SEMANTIC_RESUME.md](SEMANTIC_RESUME.md) for persistence, validation, and the
explicit semantic-only resume command. The worker is never resumed by tests.

## Core commands

Supply the same global paths before each command:

```text
python3 tools/pdmx-factory/cli.py \
  --work-dir tmp/campaign/pdmx-factory-run \
  --csv /Users/ryland/Downloads/PDMX.csv \
  --pdf-archive /Users/ryland/Downloads/pdf.tar.gz \
  --mxl-archive /Users/ryland/Downloads/mxl.tar.gz \
  --subset-paths /Users/ryland/Downloads/subset_paths.tar.gz \
  --model-contract tmp/campaign/piano-vision-phase212y/factory-model-contract.json \
  inspect
```

Commands are `inspect`, `filter`, `build`, `pause`, `stop`, `resume`, `status`,
`retry-failed`, `validate-dataset`, `validate-inputs`,
`freeze-plan`, `preflight`, `produce-source-coordinates`, `semantic-build`, `semantic-validate`,
`trainer-smoke`, and `semantic-evaluate`. `filter` is incremental. `build`
extracts only selected PDF/MXL members in a bounded cache and removes that raw
cache after canonicalization unless explicitly told to retain it.

## Local four-file setup

The dashboard is a separate local process, so closing it does not stop a
worker. It stores local path references only; the four inputs are neither
uploaded nor copied:

```text
python3 tools/pdmx-factory/dashboard.py \
  --work-dir tmp/campaign/pdmx-factory-run \
  --csv /Users/ryland/Downloads/PDMX.csv \
  --pdf-archive /Users/ryland/Downloads/pdf.tar.gz \
  --mxl-archive /Users/ryland/Downloads/mxl.tar.gz \
  --subset-paths /Users/ryland/Downloads/subset_paths.tar.gz \
  --model-contract tmp/campaign/piano-vision-phase212y/factory-model-contract.json
```

The setup panel validates existence, readability, basic CSV/archive structure,
actual sizes, prefix fingerprints, the model contract, and free disk. Native
macOS file selection is used when available, with editable server-side paths as
the fallback. `Build Dataset` remains disabled unless every input, the model
contract, and the 20 GiB disk-safety gate pass. The button is intentionally a
review guard. When enabled, clicking it asks for confirmation and launches the
resumable full pipeline as a detached local process. The same entry point is
available from the command line with `tools/pdmx-factory/full_pipeline.py`.

Only `ACCEPTED_HIGH_CONFIDENCE` same-ID pairs with verified piano MusicXML and
an independent `pdf-source-normalized` source-coordinate bundle enter shards.
Pairs without such a bundle remain `SOURCE_ALIGNMENT_REQUIRED`; MusicXML is
never used to invent source coordinates. Nominal measure identity is forbidden.

Dataset fragments are atomic gzip files grouped into bounded shard directories.
SQLite records fragment hashes, aggregate shard hashes, score-isolated stable
splits, progress, attempts, failures, controls, counters, ETA inputs, and the
live log. A completed score cannot be emitted twice after resume.

Semantic examples are also idempotent across resume. They preserve source
coordinate identity, reject semantic truth from runtime input tensors, split by
whole score and semantic source, and exclude `future-test` from trainer access.
Assembly streams canonical scopes and uses a disk-backed per-score target
lookup. Each bounded chunk commits immutable shard hashes, example rows, and a
scope cursor together. `semantic_score_progress` also records completed,
empty, skipped, and review scores. Stop/restart does not change shard layout.
The default disk floor is 20 GiB and remains enforced during semantic writes.

## Finalizing an existing semantic repair

After `semantic_repair.py` reports
`REPAIR_REGENERATED_PENDING_FULL_AUDIT`, use
`finalize_semantic_repair.py`. Ordinary `full_pipeline.py --semantic-only
--resume` expects the original assembly fingerprint; repaired scores instead
bind that fingerprint to their repair recipe, written XML and repaired split.
The finalizer validates existing data without invoking assembly or repair.

```text
python3 tools/pdmx-factory/finalize_semantic_repair.py \
  --factory-dir <existing-factory> --revision <completed-repair-revision> \
  --model-contract <frozen-model-contract.json> \
  --csv <PDMX.csv> --pdf-archive <pdf.tar.gz> --mxl-archive <mxl.tar.gz> \
  --baseline-dir <original-repair-audit-inputs> \
  --output <new-finalization-directory> --disk-floor-gib 20
```

The baseline directory must contain the original
`baseline-semantic-audit.json` and `physical-db-manifest.jsonl.sha256`.
Every attempt requires a new output directory. The finalizer holds the
pipeline and semantic locks through revision/staging checks, current shard
validation, the full independent pixel/written-notation audit, generic dataset
validation and loader evaluation. It writes a versioned attestation before
atomically publishing both build states as `COMPLETE`. A failed check leaves
both states `FAILED`, with the exact stage and blocker in `blocked.json`.
Neither failure nor success regenerates or deletes repaired shards.
Missing-target records are documented as expected exclusions only when the
score requires source alignment, remains in physical review, was skipped with
zero semantic output, has no assigned target bundle, and is outside the repair
revision. Every other assembly error blocks finalization; no error is deleted.

After success and database closure, `prepare-full` and `review-full` remain
separate Piano Vision steps. Finalization does not record human confirmation
or launch training.

## Precise persisted progress

Phase 2.13 adds a cheap `preflight` command before the expensive source and
semantic build. It completes metadata scanning, freezes an immutable selected
score plan, then makes one bounded streaming pass through the MXL and PDF
archives. MXL measure and note-element totals come from structural XML parsing.
PDF totals use the PDF page tree when available without rendering; the bounded
page-object fallback is labeled `ESTIMATED`. Archives are not unpacked.

```text
python3 tools/pdmx-factory/cli.py [four input arguments above] preflight
```

The frozen plan and per-score inventory live in SQLite tables `build_plan` and
`preflight_inventory`. Rejection, pause, retry, worker restart, or dashboard
restart cannot silently change the original score denominator.

Every progress record carries integer `numerator` and `denominator` values plus
one explicit denominator state:

- `EXACT`: structurally inventoried or generation-complete.
- `ESTIMATED`: visibly approximate, currently based on observed whole-score
  yield or the bounded PDF fallback.
- `CALCULATING`: inventory or deterministic generation is still running.
- `UNAVAILABLE`: no trustworthy denominator can be produced.

The main formula is `FROZEN_SCORE_COMPLETION_V1`:

```text
finalized scores in the frozen plan / all scores in the frozen plan
```

A finalized score is `COMPLETE`, `REVIEW`, `REJECTED`, or `FAILED`; each is one
transparent work unit. The dashboard displays four decimal places and holds a
mathematically complete ratio at `99.9999%` until dataset validation passes,
then shows `100.0000%`. Page, measure, and MusicXML-note progress use their
preflight inventories. Physical-object, semantic-label, and training-example
totals upgrade from `CALCULATING` to visibly `ESTIMATED`, then to `EXACT` only
when generation completes.

The persisted status schema is available under `status.progress`:

- `overall`: formula, numerator, denominator, percentage, and completion gate.
- `units`: scores, pages, measures, MusicXML notes, physical objects, semantic
  labels, and training examples.
- `phases`: input validation, metadata scan, corpus preflight, dataset build,
  semantic assembly, dataset validation, and training.
- `buildPlan`: frozen totals, estimated dataset size, and exact disk shortfall.

`status.semantic` exposes canonical score total, durably processed scores,
status counts, examples, labels, shards, current score, and semantic state.
The semantic-score denominator is the canonical count (18,312 in this build),
not the physical-plan count. Example/label numerators advance with each durable
chunk; denominators remain `CALCULATING` until semantic completion. A first
shard no longer incorrectly makes the entire semantic phase look complete.

ETA uses persisted exponential smoothing over finalized frozen-plan scores.
Before enough samples exist it reports `CALIBRATING`. Active elapsed time,
current-score coordinates, pause state, and the smoothing sample survive
dashboard reconnects. The worker remains independent of the dashboard.

The Phase 2.13 sample was manually verified in the localhost dashboard: exact
12-score totals, all four-decimal percentages, phase progress, disk blocker,
current-score page/measure/note card, pause/reload/resume persistence, and a
dashboard process restart all matched SQLite state with no browser console
errors. The full PDMX build was not started.
