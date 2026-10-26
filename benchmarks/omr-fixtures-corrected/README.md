# Corrected Piano OMR fixtures (CC0)

This is the Piano subset of the corrected CC0 corpus from the Piano research
branch. It is kept separate from the historical `benchmarks/omr-fixtures`
because the PDF inputs changed:

- quarter rests now use the SMuFL quarter-rest glyph (`U+E4E5`);
- dotted/tuplet notes now carry the flags their reference durations require.

The reference MusicXML is unchanged from the historical corpus. These fixtures
are development/validation material generated from the same in-repository
event model; they are not held-out cross-engraver evidence. Provenance and the
CC0 dedication are in `provenance.json`.

Use `scripts/vision-piano-reference-eval.mjs` with
`VISION_FIXTURES=benchmarks/omr-fixtures-corrected` to report this corpus
separately.
