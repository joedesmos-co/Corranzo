# Tempo Recognition Sprint 1 — ACCEPTED / FROZEN

**Accepted 2026-07-26.** Do not retune Tempo Sprint 1 unless a demonstrated
real-score failure appears.

## Accepted behavior
- Numeric metronome marks (beat unit + optional dot + BPM)
- Common tempo words and `a tempo`
- Measure/onset association (not page broadcast)
- MusicXML `<metronome>`, preserved `<words>`, and `<sound>`
- Never invents a default 120 BPM when unrecognized
- Mid-score tempo events reach the playback timeline
- Repeat/volta and all frozen semantic categories unchanged

## Benchmark-source mismatch (not a recognition failure)
The nine frozen truth MusicXML files contain `quarter = 88`, but their PDFs do
**not** visibly print a tempo instruction.

Do **not**: hardcode 88, infer invisible tempo, modify the frozen evaluator, or
overwrite frozen corpus PDFs in place.

## Validation corpus
See `benchmarks/omr-tempo-validation/` (versioned, separate from the semantic baseline).

If the main semantic corpus is later repaired, create a **new** corpus version and
preserve the existing baseline for historical comparisons.
