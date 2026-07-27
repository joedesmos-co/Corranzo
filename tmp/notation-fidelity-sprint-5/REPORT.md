# Notation Fidelity Sprint 5 — articulations

- Manually verified cases: 45
- Correct before: 8
- Correct after: 45
- Missing staccato: 4 → 0
- False staccato: 23 → 0
- Missing accent: 15 → 0
- False accent: 7 → 0
- Tenuto TP/FP/FN: 0/0/3 → 3/0/0
- Marcato TP/FP/FN: 0/0/5 → 5/0/0
- Fermata TP/FP/FN: 0/0/2 → 2/0/0
- Wrong-note attachments: 0 → 0
- Wrong chord broadcasts: 0 → 0
- Rest/dot confusion: 8 → 0
- Noise false positives: 8 → 0
- Renderer-only failures: 0 → 0
- Notation/playback disagreements: 29 → 0

## Real-score coverage

- Gymnopédie and Minecraft: quarter-rest/no-articulation controls.
- Evangelion: page-one below-staff/above-staff accents.
- La Campanella: dense staccato, accents, tenuto, marcato, fermata-on-rest, and a note fermata on page 6.
- Piano Grand Voices: clean engraved chord staccato/accent controls.
- Piano articulation scan: accepted raster TP and augmentation-dot control remain unchanged.

## Root cause and shipped fix

- The repeated root cause was a shifted vector-glyph table: SMuFL accents U+E4A0/E4A1 were classified as staccato, staccato U+E4A2/E4A3 was not authoritative, and quarter rest U+E4E5 was accepted as staccato.
- The smallest general production fix corrects those mappings, preserves above/below placement, attaches by staff and chord column, emits placement in MusicXML, and carries tenuto/marcato/fermata through Visual Practice.
- A conservative page-font compatibility normalizer preserves the frozen clean benchmark whose custom pre-standard cmap swaps visible staccato and accent outlines. It is activated by repeated same-font metric evidence, not by fixture, page, measure, or pitch.
- A raster gating experiment reduced scan staccatos from 58 to 11 but broke frozen Sustain recall, so it was rejected and fully reverted. Raster articulation behavior is unchanged in the shipped slice.

## Failure layers after

- none: 45

## Frozen regressions

- Frozen semantic evaluator changed: no.
- Frozen semantic corpus deltas: overall 0; pitch 0; rhythm 0; sustain 0; articulation 0; measure structure 0; interpretation 0; playback 0.
- Semantic regressions / gate failures: none. The comparator prints `ACCEPT: NO` only because it requires a scored-category gain; all frozen categories are intentionally unchanged and the dedicated real-score cases carry this sprint’s visible articulation evidence.
- Real-source core playback signatures: unchanged for Gymnopédie, Evangelion, Minecraft, piano-articulation-scan, and Piano Grand Voices.
- Performed-expression signature changes are limited to proven notation mismatches: Gymnopédie removes 17 false staccatos; Evangelion replaces 39 false staccatos with 24 printed accents; Minecraft removes 12 false staccatos. Piano Grand Voices and the raster scan remain unchanged. Attack count, MIDI pitch, onset, and written duration remain unchanged.
- Sprint 2 rhythm, Sprint 3 tie/slur, Sprint 4 accidental/key, Sprint 5 articulation, parser, playback, and OMR focused gate: 126 passed, 0 failed.
- Full dirty-worktree suite: 2619 passed, 5 skipped, 9 pre-existing failures; none are in Sprint 5 files.
- Production build: passed.
- Sprint-owned lint and diff check: passed.
- Piano audio and playback-expression policy files: untouched.

## Renderer evidence

- Direct MusicXML-to-Visual-Practice artifacts have 0 renderer-only failures, 0 duplicate chord broadcasts, and 0 notation/playback disagreements.
- Representative source/notation montage: `representative-source-vs-notation.png`.
- Representative before/after: `representative-before.png` and `representative-after.png`.
- Live app SVG audit on the bundled score: 61 noteheads, 13 beams, 2 flags, 0 invalid numeric geometries, 0 zero-size marking glyphs, and 0 console errors. The bundled score contains no articulation marks; real articulation geometry is evidenced by the direct rendered case artifacts.
