# Provenance freeze gate results

**Recognition baseline:** `541f607`  
**Commit intent:** diagnostics-only (`scoreflow:omr-provenance`)

## Checks run

| Gate | Result |
|---|---|
| `tests/omrRhythmProvenance.test.js` (+ related rhythm/staccato/chord) | PASS (105) |
| Recognition equivalence, provenance **OFF** (MC/HU fingerprints; EV/Fantaisie controls) | PASS |
| Provenance ON/OFF MusicXML fingerprint A/B (Minecraft) | PASS (`off===on`) |
| Provenance payload only when ON | PASS |
| Frozen semantic corpus (`npm run omr:semantic-corpus`) | PASS (9/9); mean overall **61.8%** vs frozen snapshot 49.7% at older git — **not** a provenance regression |
| Evangelion control | PASS (`dottedQuarter=15`, measures=125, beams=538) |
| Fantaisie tempo map | PASS (84 / 50 / 108 / 168 present) |
| Minecraft baseline | PASS (`dottedQuarter=17`, `whole=144`, `dots=154`) |
| Hungarian baseline fingerprint | PASS |
| Production build (`npm run build`) | PASS |
| Targeted eslint (provenance modules) | PASS |
| Full suite (`npm test`) | 261 passed files / **6 failed files (9 tests)** — unrelated (see below) |

## Known unrelated full-suite failures (pre-existing)

- `tests/demoFixtures.test.js` — Guitar TAB local OMR
- `tests/omrNegativePage.test.js` — decorative cover isolation (2)
- `tests/omrTieRecall.test.js` — tie/slur guards (3)
- `tests/productFixes.test.js` — demo reload source revision
- `tests/scoreSourceGenerationGate.test.js` — activeScoreId shape
- `tests/tabLaneLayout.test.js` — piano hand hint copy

## Pre-existing lint (unchanged files / patterns)

- `PdfOmrPlaybackPanel.jsx` — react-hooks/refs during render (pre-existing pattern)
- `runPdfOmrPipeline.js` — no-useless-assignment (pre-existing)

## Notes

- Campaign baseline MusicXML may include `<tie>` counts from an older UI capture path;
  headless `541f607` Minecraft fingerprint currently has `ties=0` with or without this
  diagnostics commit. Rhythm fingerprint (types/dots/beams/measures) is the freeze gate.
