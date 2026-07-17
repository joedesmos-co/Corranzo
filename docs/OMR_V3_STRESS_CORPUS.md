# OMR V3 real-PDF stress corpus

Date: 2026-07-16

## Purpose

This expansion tests import behavior on score PDFs that were not generated for
Corranzo's benchmark. It does not create new accuracy claims. A PDF without
independently verified symbolic truth is recorded as an `import-only`,
diagnostic-only observation and is always excluded from the enforced pass rate.

The dashboard now contains 20 fixtures:

- 10 enforced CC0 PDF + MusicXML regression fixtures;
- 4 import-only real-PDF stress fixtures; and
- 6 historical local diagnostics with PDF + symbolic comparison files.

All 10 enforced fixtures retain their existing frozen thresholds. The expanded
dashboard reports 10 pass, 10 skipped, 0 fail, 0 rejected, and 0 error. Here,
`skipped` means non-blocking diagnostic evidence; it does not mean recognition
success.

## New fixtures and observed behavior

| Fixture | Coverage | Pages exercised | Observation | Confidence | Notes |
| --- | --- | ---: | --- | ---: | --- |
| Beethoven Symphony No. 7, movement 1 | public-domain orchestral full score, 12 staves, vector engraving | 2 of 151 | safely rejected | 0.6391 | `low-confidence`; current staff grouping treats the full-score structure as too ambiguous |
| Beethoven Pathétique, movement 1 | public-domain dense grand-staff piano, vector engraving | 2 of 9 | safely rejected | 0.6545 | dense chords, ornaments, beams, and voices remain beyond the safe acceptance boundary |
| *Twinkle, Twinkle Little Stars* (1880) | public-domain historical scan, border noise, cover page, uneven margins | 2 of 9 | transcription emitted | 0.6212 | 421 notes / 98 measures; no truth, and visual inspection shows false staff structure from the cover/borders, so this is a risk finding rather than a success |
| Local beginner themes workbook | real beginner book/workbook, sparse modern grand staff | 3 of 3 | transcription emitted | 0.9055 | 585 notes / 113 measures; no independent truth, so only import completion is established |

The complete expanded run took 19.57 seconds on the promotion machine. The
dashboard renderer now honors each fixture's page cap, so the 151-page
orchestral file exercises two pages instead of allocating and rendering the
entire document before recognition.

## Requested category coverage

| Category | Corpus coverage |
| --- | --- |
| Piano | enforced beginner, grand-staff, rhythm, scan, and dense fixtures; real Pathétique, historical scan, and local workbook diagnostics |
| Guitar | five enforced standard notation, TAB, paired notation/TAB, technique, and scan fixtures; one historical local guitar diagnostic |
| Orchestral | real public-domain Beethoven full score diagnostic |
| Beginner books | enforced beginner study plus a real, non-vendored local beginner workbook diagnostic |
| Scanned PDFs | enforced CC0 piano and guitar scans plus a real 1880 Library of Congress scan |
| Engraved PDFs | enforced vector fixtures plus two real Mutopia/LilyPond engravings |
| Public-domain scores | ten original CC0 scores and three real public-domain editions from Mutopia and the Library of Congress |

## Provenance and redistribution

The three new vendored PDFs have explicit source rights and checksums in
[`benchmarks/omr-stress/provenance.json`](../benchmarks/omr-stress/provenance.json).

- Mutopia marks the [Beethoven Symphony No. 7 edition](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=891)
  and [Pathétique edition](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=299)
  Public Domain.
- The Library of Congress states that its
  [Music for the Nation collection](https://www.loc.gov/collections/american-sheet-music-1870-to-1885/about-this-collection/rights-and-access/)
  is public domain and free to use and reuse; the scan's item record is
  [2023836677](https://www.loc.gov/item/2023836677/).
- The beginner workbook explicitly prohibits sharing. It remains only a local
  path plus checksum in the manifest; the PDF is not vendored.

## Categories that still struggle

1. Orchestral full scores do not yet recover multi-staff instrument groups with
   enough certainty to import. Safe rejection is preferable to a corrupted
   practice score, but this is a major product gap.
2. Dense advanced piano engravings still cross the confidence boundary because
   chord grouping, beamed subdivisions, and voice serialization compound.
3. Historical scans can turn decorative borders, cover typography, and page
   edges into false staff structure. The 1880 scan demonstrates a potential
   unsafe acceptance and needs cover-page/non-musical-region classification.
4. Scanned paired notation/TAB still produces the enforced honest rejection;
   exact string/fret recovery from an image-only page is not yet dependable.
5. Real beginner material imports, but the new workbook has no redistributable
   ground truth. Import completion and high confidence must not be interpreted
   as verified note accuracy.

## Verification

- Rendered and visually inspected the opening pages of every vendored PDF.
- Verified all present fixture SHA-256 checksums with
  `node scripts/omr-benchmark-dashboard.mjs --check-fixtures`.
- Ran the four import-only observations independently.
- Ran the complete 20-fixture dashboard and compared the original 10 fixtures
  against the Phase 0 baseline: all frozen core metrics are byte-for-byte
  equivalent at the JSON field level.
