# OMR Tempo Validation Corpus (v1)

Versioned corpus for Tempo Recognition Sprint 1.
**Independent of** frozen evaluator `2.0.0` and the nine-fixture semantic baseline.

## Policy
- PDFs here must **visually print** the tempo instruction under test
- Expected results are manually verified (recognition + performed timing)
- Do not overwrite `benchmarks/omr-fixtures/` in place
- If the main semantic corpus gains printed tempos later, bump a new version
  (e.g. `v2/`) and keep this `v1` baseline for history

## Required coverage

| ID | Printed content | Expected |
| --- | --- | --- |
| `tempo-quarter-120` | ♩ = 120 | quarter markBpm 120 → quarter BPM 120 @ m1 |
| `tempo-dotted-quarter-72` | dotted quarter = 72 | mark 72 → quarter BPM 108 |
| `tempo-eighth-96` | eighth = 96 | mark 96 → quarter BPM 48 |
| `tempo-word-only` | Allegro (or Moderato) | words preserved; BPM via `TEMPO_WORD_BPM` |
| `tempo-word-plus-numeric` | Allegro + ♩ = 132 | numeric wins for sound |
| `tempo-midscore-change` | initial + later change | two tempo events at correct onsets |
| `tempo-multiple-changes` | ≥3 marks | ordered BPM sequence |
| `tempo-a-tempo` | mark then `a tempo` | restores prior established BPM |
| `tempo-inside-repeat` | change inside repeat | written on measure; each pass uses it |
| `tempo-none` | no tempo text | no invented `<sound tempo>` |
| `tempo-malformed` | ambiguous / impossible BPM | ignored safely; no crash |

## Layout

```
benchmarks/omr-tempo-validation/v1/<id>/
  <id>.pdf
  EXPECTED.md          # manual checklist + expected BPM / onset / words
  (optional) snapshot.png
```

## Scoring
Use unit tests (`tests/tempoSprint1.test.js`) and/or a future harness under
`tmp/tempo-validation/`. Do not add these IDs to the frozen semantic manifest
thresholds.
