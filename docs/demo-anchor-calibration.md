# Demo anchor calibration (Corranzo)

Tooling to produce bundled demo score-follow anchors for any **safe public-domain** PDF when you also have matching MusicXML (or MIDI converted to MusicXML). This does **not** change the live Minuet demo until anchors are reviewed and promoted separately.

## What gets generated

Each output file matches `public/fixtures/*.anchors.json`:

- Top-level: `version`, `pieceId`, `pdfFile`, `timingFile`, `alignmentNote`, optional `calibration`
- Per anchor: `page`, `x`, `y`, `measureNumber`, `source: "demo"`
- Meta: `measureStartX`, `playableStartX`, `playableEndX`, `systemEndX`, `systemIndex`, `calibrated`, `bundled`, optional `confidence` / `xSource`

## Prerequisites

- Node dependencies installed (`npm install`)
- For **auto** calibration from a real PDF: `@napi-rs/canvas` + `pdfjs-dist` (dev deps) and the PDF on disk
- Minuet fixtures: `npm run fixtures` downloads the Mutopia PDF/MIDI/MusicXML if missing

## Calibrate a new demo piece

### 1. Collect sources

Use redistributable public-domain (or similarly licensed) **PDF + MusicXML** from the same edition. Keep filenames stable; they are stored in the anchors JSON for traceability.

### 2. Inspect layout

```bash
node scripts/diagnose-alignment.mjs path/to/score.musicxml --counts 8,8,8
```

Adjust `--counts` until per-system measure totals match the written measure count. For uneven systems (Minuet: `5,5,6,5,5,6`), counts must reflect the **PDF**, not MusicXML print breaks.

Optional PDF geometry report (synthetic + local PDF when available):

```bash
node scripts/diagnose-alignment.mjs --detect
```

### 3. Choose calibration path

**A. Manual system table (most reliable for shipping)**

Measure barline x positions from the PDF (PyMuPDF, vector inspector, or printed grid). Save a JSON array:

```json
[
  {
    "systemIndex": 0,
    "page": 1,
    "y": 0.16,
    "endX": 0.95,
    "measures": [
      { "n": 1, "x": 0.12 },
      { "n": 2, "x": 0.35 }
    ]
  }
]
```

Generate:

```bash
node scripts/calibrate-demo-anchors.mjs \
  --manual-systems systems.json \
  --piece-id my-piece \
  --pdf-file "My Piece.pdf" \
  --timing-file "My Piece.musicxml" \
  --out public/fixtures/demo-my-piece.anchors.json
```

**B. Auto pipeline + forced counts (starting point)**

```bash
node scripts/calibrate-demo-anchors.mjs \
  --pdf path/to/score.pdf \
  --musicxml path/to/score.musicxml \
  --piece-id my-piece \
  --counts 5,5,6,5,5,6 \
  --out public/fixtures/demo-my-piece.anchors.json
```

**C. Hybrid — auto + manual barline overrides**

When barline detection is noisy but system y/page is correct, supply normalised barline x arrays (one per system, length = measures + 1):

```bash
node scripts/calibrate-demo-anchors.mjs \
  --pdf score.pdf --musicxml score.musicxml \
  --counts 5,5,6,5,5,6 \
  --manual-barlines barlines-by-system.json \
  --out out.anchors.json
```

`barlines-by-system.json` example:

```json
{
  "0": [0.12, 0.35, 0.49, 0.65, 0.79, 0.95],
  "1": [0.05, 0.28, 0.44, 0.63, 0.80, 0.95]
}
```

### 4. Review warnings

The CLI prints calibration warnings (unreliable barline counts, count mismatches, weak systems). **Do not ship** if warnings indicate incomplete coverage or low barline confidence without manual overrides.

### 5. Hybrid workflow (default for `--pdf`)

The CLI uses **hybrid calibration** by default (see `src/features/score-follow/calibrationWorkflow.js`):

1. **Source check** — compares PDF barline totals, system/page counts, and MusicXML layout hints; flags MIDI-derived timing without `<print>` breaks.
2. **Reconcile** — when barline totals are close but not exact, scales per-system counts to the written measure total.
3. **Refuse** — when sources likely disagree (edition mismatch), calibration refuses unless you pass overrides (`--no-refuse` only for diagnosis).
4. **Partial correction** — fix only flagged systems via `--system-counts` or `--manual-barlines`.

Run diagnostics without writing anchors:

```bash
node scripts/calibrate-demo-anchors.mjs \
  --pdf score.pdf --musicxml score.musicxml \
  --piece-id turkish-march --diagnose --report /tmp/calibration-report.json
```

Per-system count overrides (JSON map of `systemIndex → measures`):

```bash
node scripts/calibrate-demo-anchors.mjs \
  --pdf score.pdf --musicxml score.musicxml \
  --system-counts overrides.json --out out.anchors.json --diagnose
```

`overrides.json` example (correct only problematic systems; other systems are re-reconciled):

```json
{ "25": 5, "26": 5 }
```

Legacy strict mode (no reconciliation — old behaviour):

```bash
node scripts/calibrate-demo-anchors.mjs --pdf score.pdf --musicxml score.musicxml --strict --counts 5,5,6,5,5,6
```

### Diagnostics output

`--diagnose` reports:

| Field | Meaning |
|-------|---------|
| `expectedMeasures` / `detectedMeasures` | Written score vs PDF barline sum |
| `source.indicators` | e.g. `measure-count-mismatch`, `midi-derived-timing` |
| `systems.mismatchIndices` | Systems needing manual count or barline correction |
| `systems.suggestedCounts` | Reconciled `--counts` candidate |
| `readiness.status` | `ready` / `needs-review` / `not-safe` |

## Validate anchors

### Bundled Minuet reference (CI)

Round-trip check — proves the tooling matches the hand-calibrated demo format:

```bash
node scripts/calibrate-demo-anchors.mjs --validate-minuet
```

Compare **auto-detected** Minuet geometry against bundled anchors (requires PDF; may fail until manual/hybrid calibration):

```bash
node scripts/calibrate-demo-anchors.mjs --validate-minuet --auto --counts 5,5,6,5,5,6
```

### Compare any generated file to a reference

```bash
node scripts/calibrate-demo-anchors.mjs \
  --manual-systems systems.json --piece-id minuet-in-g \
  --validate public/fixtures/demo-minuet-in-g.anchors.json \
  --out /tmp/candidate.anchors.json
```

Promotion tolerances (`ready`): max error ≤ **0.005**, avg error ≤ **0.002** on geometry fields (`measureStartX`, `playableStartX`, `playableEndX`, `systemEndX`, `y`).

## When **not** to ship a demo piece

Do **not** bundle anchors or replace the public demo when:

- PDF and MusicXML are different editions (measure count, repeats, layout)
- Auto calibration warns about unreliable barlines and you lack manual overrides
- Validation against a trusted reference is `NOT_SAFE` or below `READY`
- Sources are not clearly redistributable public domain
- Dense notation produces false barlines (see `diagnose-alignment.mjs --detect`)
- Multi-page scores lack per-page system tables or consistent `--counts` per page

Tooling-only changes do not swap the demo; wiring a new piece into the app requires separate product work (`demoBundledAnchors.js`, fixture paths, QA).

## Related scripts

| Script | Role |
|--------|------|
| `scripts/calibrate-demo-anchors.mjs` | Generate / validate bundled demo anchors |
| `scripts/generate-demo-anchors.mjs` | Regenerate Minuet bundled anchors from the hand table |
| `scripts/diagnose-alignment.mjs` | Layout reconciliation and geometry detection reports |
| `src/features/score-follow/demoAnchorCalibration.js` | Shared calibration library (tests + CLI) |
| `src/features/score-follow/calibrationWorkflow.js` | Source mismatch, hybrid calibration, diagnostics |
