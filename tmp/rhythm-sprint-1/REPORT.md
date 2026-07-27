# Rhythm recognition sprint 1 — before/after report

**ACCEPT: YES** (written mode, enforced CC0 corpus, 9/9 fixtures)

## Measurement note

Corpus eval previously skipped PDF text extraction whenever `numPages` was set,
forcing the **raster** path on vector fixtures. Baseline and after runs both use
`makePdfTextExtractor` so scores measure the real **vector-glyphs** path.

Artifacts:
- `tmp/rhythm-sprint-1/before.json` (label `before-vector`)
- `tmp/rhythm-sprint-1/after.json`
- `tmp/rhythm-sprint-1/delta.txt`

## Mean class scores

| Class | Before | After | Δ |
|---|---:|---:|---:|
| rhythm | 0.5481 | 0.5675 | **+0.0194** |
| pitch | 0.1648 | 0.1648 | 0 |
| measureStructure | 0.5062 | 0.5062 | 0 |
| sustain | 0.5585 | 0.5585 | 0 |
| articulation | 0.6852 | 0.6852 | 0 |
| overall | 0.4947 | 0.4974 | +0.0028 |

Gates: rhythm ↑, pitch/measure flat, no class regresses by >1%.

## Per-fixture rhythm

| Fixture | Before | After | Δ |
|---|---:|---:|---:|
| guitar-standard-chords-vector | 33% | 45% | **+0.1191** |
| piano-beginner-single-vector | 81% | 84% | **+0.0318** |
| piano-grand-voices-vector | 50% | 53% | **+0.0313** |
| piano-rhythm-tuplets-vector | 48% | 47% | −0.0078 (within 1%) |
| others | — | — | 0 |

## Largest improvements

1. **guitar-standard-chords-vector** (+11.9 pts) — fewer false dotted durations from gap quantization
2. **piano-beginner-single-vector** (+3.2 pts) — glyph-based dots + undotted gap snap
3. **piano-grand-voices-vector** (+3.1 pts) — same dotted/gap discipline

## Regressions

- **piano-rhythm-tuplets-vector**: rhythm −0.78% (within 1% budget; not a gate failure)

## Recognition changes (rhythm-only)

1. **Vector augmentation dots** (`assignVectorAugmentationDots`): bind SMuFL `U+E1E7` and period `.` beside noteheads; override ink `detectDot` (false positives).
2. **Undotted gap quantization**: `durationMeta(..., { allowDotted })` defaults to undotted ladder; gap spans like 6 no longer invent dotted quarters without dot evidence. Event builders snap undotted when no glyph dots.
3. **Quarter rest glyph**: map free-standing `U+E4E5` as quarter rest (near-notehead filter still drops staccatissimo). Prefer glyph rest duration over full-gap stretch.
4. **Harness**: corpus/`evaluate-omr-semantic` pass Node `makePdfTextExtractor` so vector PDFs use vector recognition.

Evaluator untouched. Pitch / ties / articulations recognition paths not targeted (pitch/measure scores unchanged).
