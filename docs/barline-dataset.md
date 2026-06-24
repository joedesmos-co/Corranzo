# Barline training dataset (local-only)

Tooling to collect and label **real vs fake barline** candidate crops from benchmark PDFs. This pipeline prepares data for a **future browser-run classifier** — it does **not** train a model, add servers, or change runtime score-follow behaviour.

## Overview

```
benchmark PDFs / synthetic pages
        ↓
scripts/export-barline-dataset.mjs
        ↓
datasets/barline-training/
  manifest.json          ← sample metadata + detector features
  crops/*.png            ← grand-staff column crops
        ↓
tools/barline-labeler/index.html   (static, no server)
        ↓
labels.json              ← human labels
```

Generated crops and labels are **gitignored** by default.

## Label schema

| Label | Meaning |
|-------|---------|
| `real-barline` | True measure boundary spanning the grand staff |
| `fake-stem` | Note stem or stem-like vertical ink |
| `fake-notehead-cluster` | Dense notehead column / chord stack |
| `fake-beam` | Beam or beam fragment |
| `unsure` | Ambiguous — review later |
| `missing-barline` | Expected barline location with no clear vertical line (negative example) |

Labels are stored in `labels.json`:

```json
{
  "version": 1,
  "updatedAt": "2026-06-24T12:00:00.000Z",
  "labels": {
    "minuet-in-g-p1-s0-x234": "real-barline"
  }
}
```

## Export samples

### CI subset (synthetic + local, no download)

```bash
node scripts/export-barline-dataset.mjs
# or
npm run dataset:barline:export
```

### Full corpus (remote pieces need cached PDFs)

```bash
node scripts/benchmark-alignment-corpus.mjs --all --download   # once
node scripts/export-barline-dataset.mjs --all --download
```

### Options

| Flag | Purpose |
|------|---------|
| `--out <dir>` | Output directory (default `datasets/barline-training/`) |
| `--ci-only` | Synthetic + local manifest entries only (default) |
| `--all` | Full 32-piece manifest |
| `--download` | Fetch remote Mutopia PDFs when missing |
| `--dry-run` | Build manifest in memory / `--json` without writing PNGs |
| `--piece id1,id2` | Export specific pieces |
| `--max-per-system 48` | Cap candidates per system (prioritises accepted, then rejected) |
| `--include-margin` | Include margin-filtered columns |
| `--json /tmp/manifest.json` | Write manifest to extra path |

### Sample metadata (manifest row)

Each `samples[]` entry includes:

- `id`, `pieceId`, `page`, `systemIndex`
- `x` (normalized), `xPx`
- `cropPath` (relative PNG path)
- `expectedMeasuresPerSystem` (from manifest `expected`, when known)
- `features` — treble/bass/gap/full band stats, stem signal count, detector score
- `detector` — `decision`, `confidence`, `rejectReason`, `finalAccepted`

Detector decisions: `accepted-high`, `accepted-low`, `rejected`, `thinned`, `ignored-margin`.

## Label samples

1. Export crops (see above).
2. Open [`tools/barline-labeler/index.html`](../tools/barline-labeler/index.html) in a browser (double-click or `open tools/barline-labeler/index.html`).
3. **Load manifest.json** from your export directory.
4. **Load crop images** — multi-select all files in `datasets/barline-training/crops/`.
5. Optionally **load existing labels.json** to resume (or rely on browser autosave for the same manifest).
6. Label with buttons or keys **1–6**; **Enter** accepts the detector suggestion (assisted mode); **←/→** navigate; **Z** or **Backspace** undo; **S** downloads `labels.json`.

The labeler shows crops at **8–12×** on a neutral background (**Raw** mode, default) so you can judge ink without overlays. Switch to **Debug** to see detector bands, vertical-run highlights, center column, and extra metadata.

**Assisted labeling** pre-fills each sample with a conservative heuristic from manifest `detector` + `features` fields. Press **Enter** to accept; **1–6** overrides manually. Suggestions prefer **unsure** when evidence is weak or conflicting. Exports include optional `labelMeta` (`source`: `accepted` | `corrected`, plus suggestion snapshot). Use **Low-confidence only** to focus on uncertain cases.

### Labeler shortcuts

| Key | Label |
|-----|-------|
| `Enter` | Accept detector suggestion (assisted mode) |
| `1` | Real barline |
| `2` | Fake stem |
| `3` | Fake notehead cluster |
| `4` | Fake beam |
| `5` | Unsure |
| `6` | Missing barline slot |
| `←` `→` | Previous / next sample |
| `Z` `Backspace` | Undo last label |
| `S` | Download labels.json |

Progress, piece filter, and labels autosave to `localStorage` while you work (same manifest only).

Merge partial label files:

```bash
node scripts/merge-barline-labels.mjs datasets/barline-training/labels.json partial.json
```

## How many examples to collect

Rough targets before training a small on-device model:

| Class | Minimum | Ideal |
|-------|---------|-------|
| `real-barline` | 200 | 800+ |
| `fake-stem` | 300 | 1200+ |
| `fake-notehead-cluster` | 200 | 800+ |
| `fake-beam` | 100 | 400+ |
| `unsure` | — | keep &lt; 10% of total |
| `missing-barline` | 50 | 200+ |

Prioritise **dense benchmark pieces** (`synthetic-dense`, `turkish-march`, `mozart-symphony25-m1`, etc.) where the current heuristic struggles. Include **clean** pieces (`minuet-in-g`, synthetic-clean) so the model does not overfit to noise.

Balance across composers, page density, and accepted vs rejected detector outcomes.

## Training a future local model (not implemented yet)

Recommended approach when ready:

1. **Features-only baseline** — train a tiny classifier (logistic regression / shallow MLP) on the exported `features` JSON in Node or Python; fast iteration, no image I/O.
2. **Image model** — grayscale 28×H or 32×H crops → small CNN (MobileNet-style) or gradient-boosted trees on flattened pixels.
3. **Export format** — combine `manifest.json` + `labels.json` into CSV or TensorFlow.js / ONNX dataset shards.
4. **Validation** — hold out entire **pieces** (not random crops) to measure generalisation.
5. **Success metric** — reduce `dense-false-barlines` benchmark blockers without increasing false negatives on Minuet / clean synthetic layouts.

## Running the model in the browser later

Corranzo can load a compact classifier without a server:

1. Train in Python or TensorFlow.js Node → export **ONNX** or **TensorFlow.js** (`model.json` + weights).
2. At runtime (future work), in `detectBarlinesInSystem.js`:
   - For each column candidate, build the same `features` vector (already stable) and/or crop tensor.
   - Run `ort.InferenceSession` ([onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web)) or `tf.tidy()` inference.
   - **Downgrade confidence** or reject when `p(fake) > threshold` — same safety rule as today (prefer keeping borderline candidates at low confidence).
3. Bundle the model under `public/models/barline-classifier/` (gitignored until release-ready).
4. Gate behind a feature flag; A/B against heuristic-only on the alignment benchmark.

ONNX Runtime Web and TensorFlow.js both run fully client-side in WebAssembly/WebGL — no backend required.

## Files

| Path | Role |
|------|------|
| `src/features/score-follow/barlineDataset.js` | Schema, validation, label merge |
| `src/features/score-follow/barlineDatasetScan.js` | Column feature scan (tooling) |
| `scripts/export-barline-dataset.mjs` | Export CLI |
| `scripts/lib/barlineDatasetExport.mjs` | Corpus → crops + manifest |
| `scripts/merge-barline-labels.mjs` | Merge label JSON files |
| `tools/barline-labeler/index.html` | Static labeler UI |
| `tests/barlineDataset.test.js` | Schema / export tests |

## Tests

```bash
npm test -- tests/barlineDataset.test.js
node scripts/export-barline-dataset.mjs --dry-run --json /tmp/barline-manifest.json
```
