# OMR Acceptance-Gate Sprint Report

**Verdict: ACCEPTED**

This sprint changes whether a structurally usable imperfect score is made available
to the user. It does **not** claim recognition accuracy improved.

Frozen recognition baseline remains untouched (pitch/rhythm/beam/dot/staff/chord/voice/
tie/slur/accidental/tempo/TAB/playback recognition logic unchanged).

---

## First failing stage

`runPdfOmrPipelineBody`
→ `assessOmrDifficulty` (legacy binary gate)
→ hard reject **after** successful extraction

Observed Motopia-class vectors extract hundreds–thousands of notes at overall
confidence ≈ **0.64–0.67**, then throw `OMR_TOO_DIFFICULT_MESSAGE`.

---

## Old gate logic

From `assessOmrDifficulty`:

| Rule | Effect |
|------|--------|
| `overallConfidence < 0.42` | LOW_CONFIDENCE |
| `measureCount >= 16 && uncertainRatio > 0.6 && confidence < 0.72` | LOW_CONFIDENCE → tooDifficult |
| `measureCount >= 16 && notesPerMeasure > 14 && uncertainRatio > 0.5` | LOW_CONFIDENCE → tooDifficult |
| `layout spread > 4 && confidence < 0.72` | INCONSISTENT_LAYOUT → tooDifficult |
| NO_NOTES / empty+sparse combo | tooDifficult |

Brahms Lullaby (same library family) **passed** only because `measureCount = 13 < 16`,
not because confidence was higher (~0.66).

---

## Baseline decision table (before)

| Score | Role | Outcome | Notes | Measures | Conf | Mean page conf | Legacy reasons |
|-------|------|---------|------:|---------:|-----:|---------------:|----------------|
| Brahms Lullaby | PASSING | ACCEPTED | 53 | 13 | 0.659 | 0.630 | (none) |
| Evangelion | PASSING | ACCEPTED | 2808 | 125 | 0.909 | 0.865 | (none) |
| Guitar Paired Scan | PASSING | ACCEPTED | 49 | 5 | 0.638 | 0.618 | (none) |
| Guitar Techniques TAB | PASSING | ACCEPTED | 32 | 12 | 0.921 | 0.433* | (none) |
| Iris Out | PASSING | ACCEPTED | 1067 | 52 | 0.903 | 0.865 | (none) |
| Bach Chorale BWV 259 | FALSE REJECT | REJECTED | 358 | 33 | 0.641 | 0.635 | low-confidence |
| Turkish March | FALSE REJECT | REJECTED | 4423 | 130 | 0.652 | 0.629 | inconsistent-layout + low-confidence |
| Für Elise | FALSE REJECT | REJECTED | 3384 | 104 | 0.650 | 0.618 | low-confidence |
| Handel Gavotte | FALSE REJECT | REJECTED | 557 | 22 | 0.649 | 0.617 | low-confidence |
| Demo Minuet | FALSE REJECT | REJECTED | 612 | 32 | 0.649 | 0.617 | low-confidence |
| Chopin Mazurka | FALSE REJECT | REJECTED | 2277 | 119 | 0.651 | 0.622 | inconsistent-layout + low-confidence |
| Pathétique | FALSE REJECT | REJECTED | 5039 | 136 | 0.650 | 0.618 | low-confidence |
| LOC Twinkle 1880 | TRUE REJECT | REJECTED | 667 | 54 | 0.621 | **0.496** | low-confidence |

\* Guitar Techniques TAB mean page conf is low but legacy `tooDifficult` is false
(short score / high overall conf) — remains ACCEPT.

Artifacts: `tmp/omr-acceptance-gate/BASELINE_AUDIT.json`

---

## Separating features (usable mid-conf vs bad scan)

Confidence alone does **not** separate Bach (~0.64) from Twinkle (~0.62).

Structural separator validated on controls:

| Feature | Usable Mutopia-class | LOC Twinkle |
|---------|----------------------|-------------|
| Mean page confidence | ≈ 0.62–0.64 | ≈ **0.50** |
| Systems + notes + coverage | strong | also strong (cannot use alone) |
| Overall confidence | mid (0.55–0.72) | mid |

Policy therefore requires **joint** evidence for warning salvage:

- legacy `tooDifficult === true`
- systems ≥ 1, pagesWithSystems ≥ 1
- noteCount ≥ 40
- systemCoverage ≥ 0.55
- overallConfidence ≥ 0.55 (**with** structure, not alone)
- **mean page confidence ≥ 0.55**

No filename / source-specific branches.

---

## New decision model

Module: `src/features/omr/assessOmrAcceptance.js`

Three outcomes:

1. **ACCEPT** (`accepted`) — legacy gate clears (`!tooDifficult`)
2. **ACCEPT WITH WARNING** (`warning`) — legacy would reject, but structural salvage passes
3. **REJECT** (`rejected`) — emptiness / absolute low confidence / insufficient structure / low page confidence on salvage path

Hard safety still enforced later by existing `validateOmrGeneratedPlayback` + activeScore ownership in `App.jsx`.

Quality metadata (separate from MusicXML):

```text
omrMeta.quality = {
  acceptance, confidenceBand, warningReasons, safetyChecks,
  extractionSummary, ownerScoreId, sourceIdentity, warningMessage
}
```

User-facing warning (not “corrupt” / “unsafe”):

> Corranzo generated this score, but recognition confidence was lower than usual.
> Some notes, rhythms, or markings may be incorrect. Compare with the original PDF
> while practicing.

---

## After outcomes

| Score | Expect | Actual | Playback OK |
|-------|--------|--------|-------------|
| Brahms Lullaby | accepted | accepted | yes |
| Evangelion | accepted | accepted | yes |
| Guitar Paired Scan | accepted | accepted | yes |
| Guitar Techniques TAB | accepted | accepted | yes |
| Iris Out | accepted | accepted | yes |
| Bach Chorale BWV 259 | warning | warning | yes |
| Turkish March | warning | warning | yes |
| Für Elise | warning | warning | yes |
| Handel Gavotte | warning | warning | yes |
| Demo Minuet | warning | warning | yes |
| Chopin Mazurka | warning | warning | yes |
| Pathétique | warning | warning | yes |
| LOC Twinkle 1880 | rejected | rejected | no |

Artifacts: `tmp/omr-acceptance-gate/AFTER_OUTCOMES.json`

---

## UI

- `OmrQualityWarningBanner` — dismissible, score-id scoped
- Wired in `PracticeView` above the PDF
- App stores dismissal in a `Set` keyed by `ownerScoreId`
- Replacement warning→accepted clears warning; accepted→warning shows warning for the new score
- Pipeline still marks READY (not FAILED) for warning path

Screenshots:

- `tmp/omr-acceptance-gate/ui/mutopia-false-reject-bach.png`
- `tmp/omr-acceptance-gate/ui/passing-brahms.png`
- `tmp/omr-acceptance-gate/ui/true-reject-twinkle.png`
- `tmp/omr-acceptance-gate/ui/replace-warning-to-accepted.png`
- `tmp/omr-acceptance-gate/ui/replace-accepted-to-warning.png`

UI E2E: `tmp/omr-acceptance-gate/ui/UI_E2E.json` — all cases OK

---

## Regression results

| Gate | Result |
|------|--------|
| Acceptance-gate unit tests | PASS |
| Quality-warning UI contract tests | PASS |
| pdfOmrHardPdf (incl. blank reject) | PASS |
| Minecraft / Hungarian / Evangelion / Fantaisie freeze gate | PASS (`failed: 0`) |
| Real UI false-reject + replacements + true reject | PASS |
| Production build | PASS |
| Targeted lint (new files) | banner test `process` fixed; remaining lint noise in pre-existing files |

### Known unrelated failures (documented, not introduced by this sprint)

- `tests/omrNegativePage.test.js` — imports missing `decorativeCoverPage` helper
- `tests/demoFixtures.test.js` TAB regression — detached ArrayBuffer in pdf cache key path
- `tests/omrTieRecall.test.js` — pre-existing detector expectation drift
- `tests/productFixes.test.js`, `tests/scoreSourceGenerationGate.test.js`, `tests/tabLaneLayout.test.js` — unrelated product/UI expectation failures

Full suite snapshot: `tmp/omr-acceptance-gate/FULL_SUITE.txt`

---

## Acceptance bar checklist

- [x] Multiple unrelated false-rejected vector scores open successfully
- [x] Labeled ACCEPT WITH WARNING
- [x] True low-information / bad-scan (LOC Twinkle) remains REJECT
- [x] No global confidence-threshold-only change
- [x] No recognition semantics change
- [x] No filename/source-specific branch
- [x] No duration / playback safety bypass
- [x] Warning state is score-owned and does not leak across replacement
- [x] Passing controls remain ACCEPT

---

## Remaining limitations

- Warning salvage still depends on mean page confidence being present in
  `richDiagnostics.pages` (legacy page summaries).
- Mid-confidence scores that clear the legacy gate (Brahms, short scans) stay
  ACCEPT without a warning even when uncertain-measure ratio is high.
- Recognition quality of warning scores is unchanged — users must compare with PDF.
- Blank/malformed PDF rejection still uses the early NO_SYSTEMS / NO_NOTES paths.

---

## Final verdict

**ACCEPTED**

Production changes retained. Structurally usable mid-confidence Mutopia-class
vectors are available with a dismissible quality warning; LOC Twinkle-class
low-page-confidence extractions remain rejected.
