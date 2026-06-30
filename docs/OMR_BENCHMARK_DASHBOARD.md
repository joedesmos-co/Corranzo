# OMR Benchmark Dashboard

The OMR benchmark dashboard is the standard health check for local PDF OMR
changes. Run it before and after algorithm work, and save the reports with the
experiment artifacts.

## Command

```sh
npm run omr:benchmark-dashboard
```

Equivalent direct command:

```sh
node scripts/omr-benchmark-dashboard.mjs --manifest benchmarks/omr-benchmark.manifest.json
```

The manifest expects local benchmark assets in `~/Downloads`:

- `gymnopedie-no-1-satie.pdf`
- `gymnopedie-no-1-satie.mxl`
- `a-cruel-angels-thesis-neon-genesis-evangelion.pdf`
- `a-cruel-angels-thesis-neon-genesis-evangelion.mxl`

Do not commit downloaded PDF/MIDI/MXL assets.

## Outputs

Default output directory:

```text
tmp/omr-benchmark-dashboard/
```

Important files:

| File | Purpose |
| --- | --- |
| `report.md` | Human-readable clean/dense summary. |
| `report.json` | Machine-readable dashboard summary. |
| `fixtures/clean.json` | Full evaluator report for Gymnopedie. |
| `fixtures/dense.json` | Full evaluator report for Cruel Angel. |

The dashboard does not intentionally change OMR runtime logic. It runs the
current runtime pipeline and evaluator against the manifest fixtures.

## Current Baseline

Last known checkpoint from `tmp/omr-benchmark-dashboard/report.md`:

| Fixture | Pitch | Duration | Onset | Chord | F1 | Measure delta | Note delta | Wrong duration |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Gymnopedie clean | 100% | 100% | 100% | 100% | 100% | 0 | 0 | 1 |
| Cruel Angel dense | 34% | 81% | 72% | 66% | 89% | +2 | -2 | 223 |

Treat clean Gymnopedie as the regression guard. Treat dense Cruel Angel as the
stress fixture for rhythm, event grouping, and note matching.

## From Existing Reports

Use `--from-reports` when comparing saved evaluator JSON files without rerunning
PDF OMR:

```sh
node scripts/omr-benchmark-dashboard.mjs --from-reports tmp/omr-benchmark-iter/<experiment>
```

The directory should contain fixture JSON files such as:

- `clean.json`
- `dense.json`
- `after-clean.json`
- `after-dense.json`
- `before-clean.json`
- `before-dense.json`

## Experiment Workflow

1. Run the dashboard and save the baseline report.
2. Make the smallest generic change or diagnostic script needed for the task.
3. Rerun the dashboard or a simulation-specific evaluator.
4. Compare duration, onset, chord grouping, pitch, note F1, note count, and
   measure count.
5. Keep runtime changes only if metrics improve cleanly.
6. Revert or leave diagnostics/simulation-only if metrics regress or move only
   trivially.
7. Run focused tests, full tests, and build.

For simulation-only passes, write outputs to a separate directory under
`tmp/omr-benchmark-iter/<experiment>/`. Never overwrite runtime MusicXML with a
simulation unless the benchmark proves it should be promoted.

## Known Simulation-Only Beam Ownership Results

Beam ownership Phase 2 and Phase 3 were intentionally not promoted:

- Phase 2 event splitting: dense duration `80.96% -> 80.89%`, wrong durations
  `223 -> 225`, onset slightly improved, chord/pitch/F1 unchanged.
- Phase 3 voice serialization: dense duration `80.96% -> 80.89%`, wrong
  durations `223 -> 225`, onset/chord/pitch/F1 unchanged.

Runtime XML stayed on the diagnostics-only baseline. See `../OMR_ENGINE.md` for
the full checkpoint.

## Acceptance Checklist For OMR Runtime Changes

- Clean metrics unchanged.
- Dense main target metric improves meaningfully.
- Dense onset/chord/pitch/F1 do not regress.
- Dense note count and measure count do not regress.
- Any generated XML diff is explained by a generic rule.
- `npm test -- --run --testTimeout=30000` passes.
- `npm run build` passes.
