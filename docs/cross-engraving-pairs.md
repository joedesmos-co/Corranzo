# Cross-engraving acceptance pairs

Same piece, independently produced, different engraving geometry. PDFs are
third-party binaries: kept in `tmp/cross-engraving/` (NOT committed).
Download URLs + license evidence below so anyone can reproduce.

## Pair 1 — Für Elise (Beethoven WoO 59)

- MusicXML: `public/fixtures/practice-library/piano-beethoven-fur-elise/…`
  `rights: Public Domain — Mutopia Project #931`, `software: music21
  v.10.1.0`, parts "up:"/"down:", NO default-x, single tempo 72, 105
  measures. A music21-processed derivative of Mutopia's LilyPond engraving.
- PDF: `fur-elise-breitkopf-1888.pdf` (343,027 bytes, 3 pages, `%PDF-1.1`).
  1888 Breitkopf & Härtel plate engraving (Beethoven Werke, Serie 25 No.
  298), scan uploaded to Wikimedia Commons by Yann (2012), categories
  include PD-old / CC-PD-Mark.
  `https://upload.wikimedia.org/wikipedia/commons/2/2a/IMSLP51818-PMLP14377-Beethoven_Werke_Breitkopf_Serie_25_No_298_WoO_59_Fuer_Elise.pdf`
- Independence: 19th-century hand-plate engraving vs 21st-century
  software-processed transcription. Layouts differ (18 PDF systems vs 1
  declared in MusicXML → reported `layoutMismatch`, `approximate`).

## Pair 2 — BWV 846 Prelude (Bach WTC I)

- MusicXML: `public/fixtures/practice-library/piano-bach-prelude-bwv846/…`
  music21-processed Mutopia #5, 35 measures. Contains voice-flattening
  artifacts (7.5 quarters of sequential content in 4/4 bars) — a FILE
  defect, see `docs/upstream-handoff-parser-timing.md` H2.
- PDF: `bwv846-opengoldberg-cc0.pdf` (129,322 bytes, 6 pages, `%PDF-1.4`).
  OpenGoldberg (musescore.com/opengoldberg) engraving, uploaded 2015,
  license CC0.
  `https://upload.wikimedia.org/wikipedia/commons/b/be/Bach-_Well-Tempered_Clavier%2C_Book_1_-_01_Prelude_No._1_in_C_major%2C_BWV_846.pdf`
- Independence: OpenGoldberg MuseScore engraving vs music21/Mutopia chain.

## What was measured

- Node: `scripts/measure-cross-engraving.mjs` — real `analyzeSemiAutoScoreSetup`
  on rendered PDF pages + repo timing; onset alignment, highlight agreement,
  teleports, wrong-page, precision mix.
- Browser: `scripts/browser-cross-engraving-e2e.mjs` — real Library upload
  (PDF + MusicXML), setup-label assertion, Preview pixel sampling, seek,
  WFY lock, zoom, error gates.
