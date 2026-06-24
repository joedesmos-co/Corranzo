# Alignment corpus benchmark

Repeatable batch evaluation of PDF geometry / alignment quality across a growing public-domain corpus. **Tooling only** — does not change runtime cursor behaviour, the bundled demo, playback, or mic.

## Quick start

```bash
# CI-safe subset (synthetic fixtures + local entries when assets exist)
node scripts/benchmark-alignment-corpus.mjs --ci-only --json /tmp/alignment-benchmark.json

# Full manifest (remote entries skipped unless cached)
node scripts/benchmark-alignment-corpus.mjs --all --json report.json --csv report.csv

# Download Mutopia PDF/MIDI into benchmarks/cache/ (not committed)
node scripts/benchmark-alignment-corpus.mjs --all --download --json report.json
```

npm shortcut:

```bash
npm run benchmark:alignment
```

## Manifest

Corpus entries live in [`benchmarks/alignment-corpus.manifest.json`](../benchmarks/alignment-corpus.manifest.json).

Each entry includes:

| Field | Purpose |
|-------|---------|
| `id` | Stable identifier |
| `title`, `composer` | Human labels |
| `source`, `license` | Provenance (required) |
| `tags` | `simple`, `dense`, `multi-page`, `repeats`, etc. |
| `runner` | `synthetic` \| `local` \| `remote` |
| `runInCi` | `false` skips entry in `--ci-only` runs |
| `expected` | Optional pages / measures / systems for comparison |
| `synthetic` | Page + timing spec (offline) |
| `assets` | Repo-relative PDF/MusicXML paths |
| `mutopia` | PDF/MIDI URLs for remote entries |

### Runners

- **`synthetic`** — deterministic pages from `tests/helpers/syntheticScore.js` (no network, no native PDF).
- **`local`** — files under `public/fixtures/` or similar; skipped when `skipIfMissing` assets absent.
- **`remote`** — Mutopia URLs; PDFs download to `benchmarks/cache/<id>/` with `--download`. **Never commit cache contents.**

## Licensing rules

1. **Only add clearly redistributable sources** — prefer [Mutopia Project](https://www.mutopiaproject.org/) (Public Domain / CC licenses stated per piece).
2. **Do not commit downloaded PDFs, MIDI, or MusicXML** from remote runs — use `benchmarks/cache/` (gitignored).
3. **No random MuseScore uploads** unless license explicitly allows redistribution.
4. Record `source`, `license`, and URL in the manifest for auditability.

## Output

### Console summary

- Counts: READY / NEEDS_REVIEW / NOT_SAFE
- Alignment actions: auto / confirm / manual
- Top blocker categories

### JSON report (`--json`)

Per piece:

- `pages`, `measures`, `systemsDetected`
- `expectedMeasures`, `detectedMeasures`, `measureDelta`
- `barlineReliability`, `weakSystems`, `falsePositiveHints`, `falseNegativeHints`
- `alignmentAction`, `readiness`, `failureReasons`, `blockers`

### CSV report (`--csv`)

Flat table for spreadsheets — id, readiness, measures, blockers, tags, etc.

## Interpreting results

| Readiness | Meaning |
|-----------|---------|
| **READY** | Full calibration coverage; no major source flags (still verify geometry before shipping a demo). |
| **NEEDS_REVIEW** | Anchors generated but edition conflict, reconciled counts, or weak systems need manual check. |
| **NOT_SAFE** | Setup/calibration failed or sources refuse to align. |

### Blocker categories

| Blocker | Typical cause |
|---------|----------------|
| `midi-derived-layout-missing` | Timing from MIDI/music21 without system/page breaks or engraved layout |
| `true-edition-mismatch` | PDF barline totals vs written score when timing is not MIDI-only |
| `pdf-layout-mismatch` | PDF page/system/layout start differs from MusicXML |
| `measure-count-mismatch` | Detected barline measure total ≠ written measures |
| `source-mismatch` | *(legacy umbrella — superseded by granular source tags above)* |
| `dense-false-barlines` | Stem/density false positives (`too-dense`, ambiguous density) |
| `missing-barlines` | Unreliable or missing measure estimates |
| `wrong-system-grouping` | System count mismatch |
| `page-mismatch` | PDF pages ≠ MusicXML page breaks |
| `weak-systems` | Low barline confidence on one or more systems |

Use **top blockers** in the summary to prioritize recognition work (e.g. if `dense-false-barlines` dominates, focus barline thinning; if `source-mismatch` dominates, improve source QA workflow).

## Adding a new piece

1. Confirm **license** and Mutopia piece-info URL.
2. Add manifest entry with `runner: "remote"`, `mutopia.pdfUrl` / `midiUrl`, tags, and `expected` metadata if known.
3. Run locally:

   ```bash
   node scripts/benchmark-alignment-corpus.mjs --all --download --json /tmp/report.json
   ```

4. Cached MIDI is converted to MusicXML automatically when `.venv-fixtures` is present (same as `npm run fixtures`); otherwise install music21 in that venv.
5. Inspect JSON row; do **not** commit cache files.
6. Set `runInCi: true` only for synthetic or repo-local assets available in CI.

## Related tooling

| Module / script | Role |
|-----------------|------|
| `scripts/benchmark-alignment-corpus.mjs` | Batch harness CLI |
| `src/features/score-follow/alignmentBenchmark.js` | Report + summary (tested) |
| `scripts/lib/benchmarkCorpusRunners.mjs` | Asset resolution |
| `src/features/score-follow/calibrationWorkflow.js` | Hybrid calibration diagnostics |
| `scripts/calibrate-demo-anchors.mjs` | Single-piece calibration |
| `scripts/diagnose-alignment.mjs` | Layout reconciliation reports |
