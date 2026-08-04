# Recognition Problem Report — Implementation Report

**Commit:** `a45c1e9b96e70a61fab93ea7bcffecc2024e7bfa`  
**Frozen baseline:** `7070f61667f0274e2cca95de7c4cbe88424b1c1b`  
**Date:** 2026-07-29

## UX flow

1. **Warning banner** (mid-confidence OMR): secondary “Report recognition problem” link beside Dismiss.
2. **Practice → Advanced → Help**: same secondary trigger for accepted / warning scores.
3. **OMR failure panel** (Library): trigger when failure diagnostics or stage metadata exist; dialog defaults to “Score failed to generate”.
4. Dialog explains local-only export and states:  
   *“The original PDF is not included unless you explicitly choose to include it.”*
5. User picks a plain-language category, optional page/measure/description.
6. Optional **Include original PDF** (unchecked) → requires a second confirmation checkbox before Export is enabled.
7. Export downloads `corranzo-recognition-report-YYYY-MM-DD-HHMM.zip`.
8. Success copy: without PDF / with PDF variants.
9. Escape closes; focus restores to the prior control; score replacement closes the dialog and clears draft fields.

## Privacy model

| Included by default | Never included by default |
|---|---|
| Structured metadata (`report.json`) | Original PDF bytes |
| Bounded provenance samples | Full MusicXML |
| Compact generated summary | Screenshots |
| Sanitized basename only | Absolute paths |
| Browser/OS category (no full UA) | Account / email |
| Acceptance / confidence / run ids | localStorage / IndexedDB dumps |

PDF inclusion is explicit + confirmed. Export never re-runs OMR and never uploads.

## Export schema

### ZIP contents
- `report.json` — schema `corranzo-recognition-report` v1
- `provenance.json` — available rhythm provenance or `provenanceAvailable: false` + reason
- `generated-summary.json` — parts, meters, keys, tempo, histograms, counts (no full note dump)
- `README.txt` — human privacy / contents note
- `original-score.pdf` — only when confirmed

### Ownership protections
Before packaging, `assertRecognitionReportOwnership` requires all non-null of:
`activeScoreId`, MusicXML `ownerScoreId`, quality `ownerScoreId`, provenance owner  
to match. Mismatch → refuse export + DEV warning; no cross-score merge.

Score replacement updates `ownerScoreId` / unmounts Practice dialog → open dialog closes and draft resets.

### Package-size bounds
- Provenance sample arrays capped at 120 entries each
- Generated-summary event lists capped at 40
- Soft JSON budget `1.5MB` (strips sample arrays if exceeded)
- No per-note dump (`noteSampleLimit: 0`)

## Tests

### Unit (`tests/recognitionProblemReport.test.js`) — 17 passed
1. Default export excludes PDF  
2. PDF inclusion requires confirmation  
3. Sanitized filenames have no paths  
4. Report belongs to active score  
5. Ownership mismatch blocks export  
6. Missing provenance exports safely  
7. Warning-score metadata included  
8. Accepted-score metadata included  
9. Failed-OMR metadata exports safely  
10. Report size bounded  
11. Score-keyed dialog reset (source contract)  
12. No unrelated storage files  
13. Deterministic safe ZIP names  
14. User text stored as data (not executed markup)  
+ category + UI wiring contracts  

### UI E2E (`scripts/recognition-problem-report-ui-e2e.mjs`) — 6/6
Artifacts: `tmp/recognition-problem-report/ui/`

| Case | Result |
|---|---|
| warning banner → export without PDF | pass |
| explicit PDF inclusion + confirmation | pass |
| accepted score report (Help) | pass |
| score replacement closes dialog | pass |
| failed OMR report | pass |
| Escape + focus restore | pass |

Screenshots: `01-warning-banner.png` … `08-focus-restore.png`, `UI_E2E.json`.

## Regression gates

| Gate | Result |
|---|---|
| Report unit tests | 17/17 |
| Report UI E2E | 6/6 |
| Full unit suite | **2709 passed / 5 skipped** (270 files) |
| Acceptance-gate + provenance + ActiveScore + TAB + repeats + playback | targeted 141/141 |
| Page-count replacement | PASS |
| Stale A→B ownership | PASS |
| Frozen semantic corpus | 9/9 ok, overall 61.8% |
| Production build | PASS |
| Targeted lint (new report modules + Practice wiring) | clean |

## Limitations

- Build/commit id is included only when `VITE_GIT_COMMIT` / `window.__SCOREFLOW_BUILD__` is present.
- Provenance samples exist only if DEV provenance was enabled during the OMR run; otherwise the package explains unavailability (no silent re-run).
- Library→Practice auto-navigation is intentionally suppressed when the user is mid-upload; E2E therefore asserts dialog close on replace, with draft-reset covered by unit contracts.
- No server submission endpoint (local download only).

## Files added / touched

**New**
- `src/features/omr/recognitionProblemReport/*`
- `src/components/omr/RecognitionProblemReportDialog.jsx`
- `src/styles/recognitionProblemReport.css`
- `tests/recognitionProblemReport.test.js`
- `scripts/recognition-problem-report-ui-e2e.mjs`

**Wired**
- `OmrQualityWarningBanner.jsx`, `PracticeView.jsx`, `PracticeControlPanel.jsx`
- `PdfOmrPlaybackPanel.jsx` (failure diagnostics retention + report CTA)
- `App.jsx` (pass `pdfBuffer` / `musicXmlSource` / active score snapshot)
