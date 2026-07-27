# OMR Notation Fidelity Sprint 1 — REPORT

**Date:** 2026-07-26  
**Also frozen this turn:** Audio Rendering / Piano Realism Sprint 1  
(`tmp/piano-realism-sprint-1/ACCEPTED.md`)

## Scope locked (unchanged)

- Piano audio renderer / samples / gain / polyphony  
- Playback-expression policy  
- ActiveScore / PDF cache / Guitar mapping  
- Tempo / dynamics / repeat playback semantics  
- Frozen semantic evaluator `2.0.0` / schema `2`

## Architecture finding (failure layers)

Corranzo shows the **printed PDF** as the score. MusicXML drives playback and
`visualNotationMarkings` overlays. So:

| Layer | What it means here |
| --- | --- |
| 1 Undetected | No candidate for the printed mark |
| 2 Wrong attachment | Candidate bound to the wrong note/chord tone |
| 3 Emission | Marks on notes but MusicXML missing/wrong (`<tied>` / `<slur>` / articulations) |
| 4 Renderer | MusicXML correct but Visual Practice overlay wrong |

Layer 4 is **not** PDF redraw (there is no OSMD engraver). Fix overlays when XML is right.

## Delivered

### 1. Real-score visual validation set
- `benchmarks/omr-notation-fidelity-validation/` — README + **30 cases**
- Sources: piano-articulation-scan (vendored), Gymnopédie, Minecraft, Evangelion
- Covers ties, slurs, articulations, confusables, absences
- Scorer: `src/features/omr/omrNotationFidelityQuality.js`
- Tests: `tests/notationFidelitySprint1.test.js`
- Probe: `scripts/notation-fidelity-probe.mjs`

### 2. Slur emission (vector) — was previously count-only
Different-pitch ink arcs and SMuFL slur glyphs now set `slurStart` / `slurStop`
and emit `<slur type="start|stop" number="N"/>` in `buildOmrMusicXml`.

Ties remain same-pitch only. Slurs do not suppress attacks (playback semantics
already treat them as independent attacks).

### 3. Tie vs staccato confusion
- Vector `applyTieMarks` refuses ties when either note is staccato  
- MusicXML emission drops staccato on tied notes (FP combo)

### 4. Renderer check
`buildVisualSpanMarkings` already builds slur/tie spans from parsed MusicXML.
Once emission is correct, overlays follow — no separate engraver bug found.

## Case-set scores (piano-articulation-scan automated = 20 cases)

| | Before | After | Δ |
| --- | ---: | ---: | ---: |
| Correct (TP+TN) | 7 | 7 | 0 |
| FN (mostly undetected) | 13 | 13 | 0 |
| FP | 0 | 0 | 0 |
| Accuracy | 35% | 35% | 0 |

**Why no movement:** artic-scan is **raster**. New slur path is **vector**. Accents remain
undetected on raster (0 TP). Staccato TP=3 / FN=3 unchanged for the specific case midis.

By kind (after): staccato TP3 FN3 TN2 · accent FN6 · slur FN2 · tie FN2 TN2  

Failure layers: **undetected ×13**, none ×7 — no attachment/emission/renderer hits on this set.

## Semantic corpus (non-regression)

| Metric | Playback-Semantics freeze | After this sprint | Δ |
| --- | ---: | ---: | ---: |
| Overall | 61.9% | 61.9% | 0 |
| Sustain | 46.7% | 46.7% | 0 |
| Articulation | 83.9% | 84.0% | +0.1 |
| Interpreter | 13.3% | 13.3% | 0 |

Evaluator untouched. No false-tie explosion on the corpus scoreboard.

### artic-scan semantic defects (spot check)
- missing-staccato: 41 → 37 (−4)  
- Articulation class defects: 53 → 49  
- incorrect-tie still ×3; missing-tie ×1 (pitch/ownership)

### Gymnopédie (local engraved PDF)
- Generated: many unexpected/missing staccatos; **0** `<tied>` / `<slur>` emitted  
- missing-tie ×22 in semantic compare — raster/path arcs not yet recovered as ties/slurs  
- Confirms: engraved real scores still need stronger **raster/path** curve pairing

## Unit-proven wins (synthetic, not artic-scan PDF)

- Different-pitch ink arc → numbered `<slur>` start/stop, no `<tied>`  
- SMuFL slur glyphs pair without creating ties  
- Staccato note + ink arc → **no** tie  

## Remaining unsupported / next fidelity work

1. **Raster slur + accent recall** (artic-scan, Minecraft, Evangelion)  
2. **Path-drawn ties/slurs** without SMuFL control glyphs (Gymnopédie)  
3. **Chord-aware slur pairing** (grand-voices truth has slurs; monophonic gate blocks)  
4. Cross-system ties with correct ownership  
5. Tenuto / marcato / fermata OMR (still not detected)  
6. Manual verification of `manual-pending` Minecraft / Evangelion / Gym cases  

## Acceptance checklist

| Criterion | Status |
| --- | --- |
| Real-score case harness exists (20–30 cases) | **PASS** |
| Measurable artic-scan case improvement | **NOT YET** (0 Δ) |
| No false-tie explosion | **PASS** |
| Corpus Overall / Sustain hold | **PASS** (61.9% / 46.7%) |
| Audio / semantics / evaluator frozen | **PASS** |
| No fixture hardcoding | **PASS** |
| Clear PDF↔MusicXML comparison path | **PASS** (cases + probe) |

## Honest sprint verdict

Sprint 1 **establishes the measurement system and the vector slur emission path**,
and hardens tie/staccato confusion. It does **not** yet produce a clear visual
improvement on the primary raster real scores (Minecraft / Evangelion / artic-scan).

**Do not open another broad recognition category** until a follow-up pass improves
raster/path curve + articulation attachment enough that PDF vs generated MusicXML
(and overlays) show an obvious difference on those pieces.

## How to re-run

```bash
npx vitest run tests/notationFidelitySprint1.test.js tests/detectVectorTies.test.js
npm run omr:evaluate-semantic -- \
  --truth benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.musicxml \
  --pdf benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.pdf \
  --mode written --save-generated tmp/notation-fidelity-sprint-1/artic-scan-after.musicxml
node scripts/notation-fidelity-probe.mjs
npm run omr:semantic-corpus -- --label notation-fidelity-sprint-1 --mode written \
  --json tmp/notation-fidelity-sprint-1/semantic-after.json \
  --text tmp/notation-fidelity-sprint-1/semantic-after.txt
```
