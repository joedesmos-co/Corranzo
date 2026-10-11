# MusicXML-only import: integration seam (verified 2026-10-11)

Finding: the practice engine, playback and the OSMD engraving surface are
all PDF-less capable (the Audio Vision arrangement path proves it end to
end). The import lane, however, gates the notation file behind a PDF.

## Verified facts

- `src/features/import/musicXmlSource.js` — `isPracticePlaybackReady()`
  opens a special case for `source === 'audio-arrangement'` so
  arrangements can practice without a PDF. There is no other PDF-less
  source kind.
- `src/components/library/ImportScoreView.jsx:156` — `MultiFileUpload`
  renders with `disabled={uploadsDisabled || !hasPdf}`, and the copy says
  "Add your PDF first to attach optional files".
- `src/App.jsx:175` — `isPracticeNavigableSet(loaded, musicXmlSource)`
  still expects a PDF.
- The practice view chooses the surface in
  `src/components/practice/PracticeView.jsx:195` with
  `musicXmlSource?.source === 'audio-arrangement'` — the only branch that
  renders `OsmdScoreView` instead of "Choose a piece first".

So a musician exporting MusicXML from MuseScore/Sibelius/Finale and
importing it today gets nowhere: notation without a PDF is not accepted.

## What enabling it would require (scoped, not done tonight)

1. Accept a new source kind in `createMusicXmlSource(...)` for uploads
   (e.g. `source: 'upload-musicxml'`), stamping
   `ownerPdfIdentity: null` so it does not collide with the PDF-owner
   reconciliation in `scoreSourceReplacement.js`.
2. Relax the ImportScoreView gate for the no-PDF-at-all case (MusicXML
   only), keeping the PDF-required message when a PDF exists but no
   notation is attached yet.
3. Extend the PDF-less branch in `PracticeView.jsx` to render
   `OsmdScoreView` for upload sources too (arrangement-only today).
4. Session persistence (`sessionPersistence.js`) restores `musicXmlSource`
   from IndexedDB keyed by PDF meta; a PDF-less restore path is needed
   (validateRestoredSession rejects `missing-pdf-meta` early).
5. Loop/WFY/page-follow surfaces that read `pdfFile` must keep their
   existing guards — the arrangement surface is the proven reference for
   what works without a PDF (transport, checkpoints, input selector,
   target list, engraving, WFY, Play Along).

Steps 1-3 are small; step 4 is the real seam because restore is keyed on
the PDF identity, and step 5 needs a full regression pass over every
PDF-dependent practice surface. Estimated 2-3 focused hours including the
restore path and suite re-runs.

## Recommendation

Ship as its own milestone: "MusicXML-only practice", staged on a branch
off this preview, validated with a real MuseScore export (import -> engrave
-> WFY -> Play Along) plus session restore. Until then, MusicXML import
requires the PDF of the same piece, which is what the cross-engraving
suite exercises.
