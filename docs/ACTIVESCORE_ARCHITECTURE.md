# ActiveScore single authority (incremental)

## Status

ActiveScore is the published source of truth for the current score. Legacy App
fields (`pdfFile`, `musicXmlSource`, …) still exist and feed
`syncActiveScoreFromLegacy`; derived systems (timing, playback, guitar mapping)
stamp and check `ownerScoreId`.

## Competing authorities removed / neutralized

| Former authority | Change |
|---|---|
| Parallel PDF vs MusicXML React state | Synced into one `activeScore`; PDF change mints **new** `scoreId` |
| OMR re-parent stamp | MusicXML gets `ownerScoreId` of the score that started OMR; reject on mismatch |
| Instrument bundle swap on Piano↔Guitar | Switch retains `scoreId`; remounts derived view only |
| Sync re-parent of stale companion | PDF identity change drops companions unless they already own the new PDF |
| PDF analysis document cache | Fixed key for `{ data: Uint8Array }` (was always `'buffer'`); clear on PDF replace + OMR start |

## OMR pageCount stale bug (2026-07-18)

**Symptom:** After an N-page PDF A, uploading 1-page PDF B showed OMR progress `1 / N`.

**Cause:** `pdfPageAnalysis.js` cached `PDFDocumentProxy` with key `pdfSource?.byteLength ?? 'buffer'`. OMR resolves sources as `{ data: Uint8Array }`, which has **no** top-level `byteLength`, so every job keyed as `'buffer'` and reused A's document (wrong `numPages` **and** wrong page pixels for pages 2+).

**Fix:** Content-hash / `scoreId+pdfHash` cache keys (never byteLength alone). Clear on score replacement only — never destroy a pinned in-flight OMR document. Logs: `OMR JOB START` / `OMR PROGRESS` / `OMR FAILURE` / `PDF CACHE`.

**Proof:** `node scripts/omr-pagecount-replacement-regression.mjs` (4-page Hungarian → 1-page beginner → B pageCount=1 only).

## DEV / E2E surfaces

- `window.__SCOREFLOW_ACTIVE_SCORE__`
- `window.__SCOREFLOW_OMR_JOB__` / `__SCOREFLOW_OMR_PROGRESS__`
- Console: `ACTIVE SCORE:` / `PLAYBACK SOURCE:` / `OMR JOB START:` / `OMR PROGRESS:`
- Real-UI: `scripts/stale-score-real-ui-regression.mjs`, `scripts/omr-pagecount-replacement-regression.mjs`

## Manual acceptance (do not close stale-score until this passes)

1. Upload multi-page PDF A → confirm OMR shows `x / A_pages`
2. Upload 1-page PDF B without refresh → confirm OMR shows `1 / 1` (never `1 / A_pages`)
3. Minecraft → Carol → Play → reload → Piano↔Guitar as before
