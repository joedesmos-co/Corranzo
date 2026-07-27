# Semantic OMR baselines

Frozen corpus snapshots for recognition-quality sprints.

| File | Role |
| --- | --- |
| `BASELINE.md` | Human scoreboard + top defects |
| `baseline.json` | Machine-readable corpus report |
| `baseline.txt` | CLI text dump |

Do not edit scores by hand. Re-run `npm run omr:semantic-baseline` only when
intentionally freezing a new recognition epoch (and update `BASELINE.md`).

Evaluator freeze: `docs/OMR_RECOGNITION_QUALITY.md`
