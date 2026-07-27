# Rhythm Sprint 3 Report — Rests + 3:2 Tuplets

Evaluator: **frozen** `2.0.0` / schema `2` (untouched).  
Compare: `tmp/after-rhythm-sprint-2.json` → `tmp/after-rhythm-sprint-3.json`  
Gate: **ACCEPT: YES**

## Scoreboard

| Metric | Sprint 2 | Sprint 3 | Δ |
|--------|----------|----------|---|
| Overall | 50.2% | 50.7% | +0.5 pp |
| **Rhythm** | **59.8%** | **62.7%** | **+2.85 pp** |
| Pitch | 16.4% | 16.7% | +0.29 pp |
| Sustain | 55.8% | 55.8% | 0 |
| Articulation | 68.5% | 68.5% | 0 |
| Measure structure | 50.6% | 51.0% | +0.35 pp |
| Interpretation | 0.0% | 0.0% | 0 |

### Targeted defects

| Defect | Sprint 2 | Sprint 3 | Δ |
|--------|----------|----------|---|
| duration-mismatch | 148 | 149 | +1 |
| onset-mismatch | 132 | 135 | +3 |
| **extra-rest** | **16** | **1** | **-15** |
| missing-rest | 4 | 4 | 0 |
| **tuplet-mismatch** | **10** | **0** | **-10** |

No semantic class mean dropped >1 pp.

## Per-fixture Rhythm

| Fixture | Sprint 2 | Sprint 3 | Δ |
|---------|----------|----------|---|
| piano-rhythm-tuplets-vector | 51.6% | 63.4% | **+11.87 pp** |
| piano-articulation-scan | 80.2% | 91.3% | **+11.03 pp** |
| guitar-standard-chords-vector | 45.2% | 48.0% | +2.76 pp |
| piano-beginner-single-vector | 84.1% | 84.1% | 0 |
| piano-grand-voices-vector | 65.6% | 65.6% | 0 |
| piano-dense-advanced-vector | 38.5% | 38.5% | 0 |
| guitar-tab-sparse-vector | 17.2% | 17.2% | 0 |
| guitar-paired-chords-vector | 72.7% | 72.7% | 0 |
| guitar-techniques-paired-vector | 83.3% | 83.3% | 0 |

## RCA summary

### Rests

Traced path: rest glyph → type → voice/staff → duration → onset → cursor → balancing → MusicXML.

**Dominant failure: rest insertion from measure balancing (false positives / invented rests).**

`validateAndNormalizeMeasureRhythm` filled underfull measures with `buildRestEvent` phantoms (no rest glyph). Worst case: glyph-less `piano-articulation-scan`, which spiked `extra-rest` and polluted onsets.

Classification of rest failures in Sprint 2 corpus:

| Mode | Finding |
|------|---------|
| Missed rests | Present but secondary vs invented rests |
| False-positive rests | **Primary** — balancing invents rests |
| Wrong rest duration | Occasional; not the main lever this sprint |
| Wrong voice | Not primary |
| Wrong onset | Often cascade from invented rests / packing |
| Invisible/implicit rests | GT may use them; OMR should not invent without evidence |
| Rest insertion from balancing | **Root cause fixed** |

### Tuplets (3:2)

Traced path: digit/bracket evidence → note group → written values → time-mod ratio → onset/duration → MusicXML.

**Dominant failure: recognition recovered (or could recover) triplets, but MusicXML never emitted `<time-modification>`**, so evaluator counted `tuplet-mismatch`. Digit `"3"` evidence existed on the tuplet fixture; equal-column packing matched 3:2 written eighths.

Not fixed by inventing tuplets solely to balance measures — recovery is **digit-gated** and requires equal-column / rhythmic packing evidence.

## Root causes fixed

1. **Invented balancing rests** — `validateAndNormalizeMeasureRhythm` defaults to `inventRests: false`; no phantom whole-measure rest in `buildVectorEvents` when there are no notes/glyphs.
2. **Missing MusicXML time-modification** — emit `<time-modification>` when events carry 3:2 ratios; scale `divisions` when tuplets present.
3. **Digit-gated 3:2 recovery** — `recoverDigitGatedTriplets.js`: visual `"3"` near the group + equal atomic columns → apply time-modification; chord heads split for column counting so multi-head chords don’t under-count.

## Remaining dominant rhythm failures

- **duration-mismatch** (~149) and **onset-mismatch** (~135) still lead rhythm defects.
- Likely next patterns (from Sprint 2 backlog, still open): TAB packing, dense chord sequentialization, flags/partial beams, residual rest duration/placement (missing-rest ×4).
- Absolute note-count noise (`missing-note` / `extra-note`) still dwarfs rhythm counts but is out of sprint scope.

## Code touched (recognition only)

- `src/features/omr/validateOmrMeasureRhythm.js` — `inventRests` default false
- `src/features/omr/recoverDigitGatedTriplets.js` — new digit-gated 3:2 recovery
- `src/features/omr/processVectorOmrPage.js` — wire recovery
- `src/features/omr/buildOmrMusicXml.js` — emit time-modification
- Tests: `tests/recoverDigitGatedTriplets.test.js`, `tests/pdfOmr.test.js`

Not touched: evaluator, ActiveScore, ties/sustain, articulations, repeats, dynamics, playback realism.
