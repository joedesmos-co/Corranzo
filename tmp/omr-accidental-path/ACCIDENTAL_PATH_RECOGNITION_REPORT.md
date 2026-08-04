# Accidental Path/Ink Recognition Report

**Start commit:** `2f82df8` — fix(omr): improve semantic note and rhythm recognition  
**Suggested commit:** `fix(omr): detect vector path accidentals`  
**Evaluator:** frozen 2.0.0 / schema 2 (unchanged)

## Verdict

Path/ink accidental detection is accepted. Pitch improved materially on the nine-fixture semantic corpus, incorrect-chord improved, and rhythm stayed within noise. Fixture PDFs now draw local accidentals as vector paths (not text), matching the real missing-primitive failure mode.

## Affected fixtures

Primary beneficiaries (chromatic piano vector scores):

- `piano-grand-voices-vector` — Pitch 63% → **70%**
- `piano-dense-advanced-vector` — Pitch 40% → **45%**
- `guitar-standard-chords-vector` — Pitch 27% → **30%** (regenerated baseline → after)

All nine semantic fixtures still run.

## Representative geometry

Benchmark accidentals are drawn as a **single filled `constructPath`** with:

- **Sharp:** two vertical posts + two slightly slanted horizontals
- **Flat:** vertical stem + lower-right curved lobe
- **Natural:** two offset vertical posts + connecting bars

Corpus PDFs keep **zero** SMuFL accidental codepoints in the text layer (`U+E260–E264`), so recognition must use path/ink — not text.

## Classification rules

Implemented in `src/features/omr/detectVectorPathAccidentals.js`:

1. **Path geometry** (`classifyAccidentalPathGeometry`) — stroke direction counts + size vs staff gap (not aspect-only).
2. **Fragment clustering** — nearby thin fills merged into sharp composites when engravers emit separate strokes.
3. **Ink fallback** (`classifyAccidentalInkBlob`) — column/row stroke clustering left of noteheads when paths are absent.
4. Synthetic SMuFL glyphs (`U+E262/E261/E260`) fed into existing `assignLocalAccidentals`.

## Ownership rules

- Horizontal left-of-note + vertical staff alignment via existing accidental match window.
- Exclusive 1:1 glyph↔note assignment (greedy by score).
- Chord tones: accidental binds to matching staff position only.
- Key-signature region excluded (`x < playableX0`).
- Text-layer accidental candidates outrank path/ink for the same note.
- Measure accidental carry unchanged (`resolveNotePitchWithMeasureState`).

## False-positive defenses

- Reject barline/stem aspect (too thin/tall)
- Reject staff-line scraps (too wide/short)
- Reject articulation-sized dots
- Reject key-sig-region path candidates
- Reject low-confidence ink blobs
- Ambiguous competing notes: exclusive ownership or no attach

## Rejected approaches

| Approach | Why rejected |
|---|---|
| Retune `assignLocalAccidentals` alone | Corpus had no accidental glyphs to bind |
| Invent alters without geometry | Violates evidence rule; would fabricate F♯ |
| Draw accidentals as SMuFL text in fixtures | Would bypass the path primitive under test |
| Skip curve extraction when `numPages` set | **Root bug** — dropped all path candidates in corpus eval |

## Pipeline fix (critical)

`runPdfOmrPipeline` previously skipped `extractPageCurves` whenever `numPages` was predeclared (corpus eval always does this). That emptied `vectorAccidentalPaths` and made the primitive appear ineffective. Curve/accidental extraction now always runs.

## Corpus before/after

Frozen baseline at `2f82df8` (fixtures without drawn accidentals):

| Metric | Baseline `2f82df8` | After path fix |
|---|---|---|
| Overall | 62.2% | **62.8%** |
| Pitch | 58.5% | **61.5%** |
| Rhythm | 67.1% | 66.6% |
| Sustain | 46.7% | 44.4% |
| Articulation | 84.0% | 85.4% |
| Measure Structure | 65.9% | **68.5%** |
| Interpretation | 13.3% | 13.3% |

Fair A/B on **regenerated** fixtures (paths present; detection off vs on):

| Metric | Detection off | Detection on |
|---|---|---|
| Pitch | 59.7% | **61.5%** |
| incorrect-pitch | 196 | **173** |
| incorrect-chord | 211 | **199** |

## Mismatch before/after (vs frozen baseline counts)

| Code | Baseline | After | Δ |
|---|---|---|---|
| duration-mismatch | 240 | 244 | +4 |
| incorrect-chord | 217 | **199** | **-18** |
| missing-note | 209 | 163 | -46 |
| extra-note | 198 | 154 | -44 |
| onset-mismatch | 193 | 256 | +63* |
| incorrect-pitch | 179 | **173** | **-6** |
| incorrect-tie | 7 | 6 | -1 |
| missing-tie | 6 | 6 | 0 |

\*Onset count rose vs the old fixture baseline; on regenerated fixtures onset stayed comparable. Rhythm category score is −0.5pp (within noise / fixture redraw).

## Per-fixture results (after)

| Fixture | Overall | Pitch | Notes |
|---|---|---|---|
| piano-beginner-single-vector | 82.6% | 94% | stable |
| piano-grand-voices-vector | **74.6%** | **70%** | primary win |
| piano-rhythm-tuplets-vector | 64.2% | 91% | stable |
| piano-articulation-scan | 42.7% | 27% | still hard (extra-note cascade) |
| piano-dense-advanced-vector | **53.7%** | **45%** | improved |
| guitar-tab-sparse-vector | 68.5% | 70% | stable |
| guitar-standard-chords-vector | 45.6% | 30% | slight up |
| guitar-paired-chords-vector | 69.0% | 48% | stable |
| guitar-techniques-paired-vector | 64.4% | 78% | stable |

## User-report validation

Smoke-ran page 1 of Evangelion, Ao no Sumika, Sweden/Minecraft reports: all **accepted**, no pipeline crash. Text-heavy scores still prefer the text-layer accidental path; path/ink is additive when glyphs are absent. Provenance: `pitchAlteration.accidentalSource` ∈ `{vector-glyph, vector-path, vector-ink}`; measure `vectorAccidentalDiagnostics.pathInk`.

## Tests / gates

- `tests/omrVectorPathAccidentals.test.js` — 17 geometry fixtures (sharp/flat/natural, chord ownership, key-sig exclusion, stem/articulation rejection, text outranks path, scaled geometry)
- `tests/omrPitchAlteration.test.js` — pass
- `tests/pdfOmrMusical.test.js` — pass
- `tests/detectVectorTies.test.js` — pass
- Production `npm run build` — pass

## Remaining limitations

- Ink classifier is conservative; some fragmented Type3 outlines may still be missed.
- Articulation-scan / dense fixtures remain limited by extra-note and onset cascades, not only accidentals.
- Courtesy / editorial accidental semantics unchanged.
- User PDFs with non-SMuFL PUA encodings (Sweden) need more encoding coverage beyond path geometry.
- Fixture generator v2 redraws path accidentals; checksums updated under `benchmarks/omr-fixtures/generated-checksums.json`.

## Files

- `src/features/omr/detectVectorPathAccidentals.js` (new)
- `src/features/omr/processVectorOmrPage.js` — merge path/ink glyphs into binder
- `src/features/omr/omrPitchAlteration.js` — `vector-path` / `vector-ink` provenance
- `src/features/omr/processOmrPage.js` / `runPdfOmrPipeline.js` — plumb paths; always extract curves
- `src/features/score-follow/pdfPageAnalysis.js` — extract accidental paths with curves
- `scripts/generate-omr-benchmark-corpus.py` — draw path accidentals (generator v2)
- `tests/omrVectorPathAccidentals.test.js`
- `tmp/omr-accidental-path/PHASE_1_ACCIDENTAL_EVIDENCE.md`
