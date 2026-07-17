# Real-score OMR stress corpus

These PDFs exercise PDF import on real, redistributable scores. They are
diagnostic-only: no file in this directory contributes an accuracy pass, a
confidence threshold, or an OMR promotion decision without independently
verified symbolic truth.

The three initial fixtures cover:

- a 151-page, many-staff orchestral full score;
- dense engraved grand-staff piano music; and
- a high-resolution historical scan with page borders, paper variation,
  uneven margins, and a non-musical cover page.

`provenance.json` records the exact source page, direct download, license,
download date, checksum, and permitted use for each file. The public-domain
status is stated by the source institutions: Mutopia marks both Beethoven
editions Public Domain, and the Library of Congress marks the Music for the
Nation collection public domain and free to use and reuse.

The benchmark runs only the first two pages of each PDF. That keeps routine
verification bounded while covering the opening page structure and, for the
historical scan, the transition from cover to music. Full-file page counts are
retained in provenance so longer import soak tests can opt in explicitly.

Rules:

- Do not add a downloaded score unless its edition/file redistribution rights
  are explicit.
- Do not add accuracy thresholds without trustworthy, independently verified
  MusicXML truth.
- Do not treat successful parsing or emitted notes as recognition accuracy.
- Do not convert a diagnostic observation into an enforced pass merely because
  the current runtime accepts it.
