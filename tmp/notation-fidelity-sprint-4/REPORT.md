# Notation Fidelity Sprint 4 — accidentals and key signatures

- Manually verified real/control cases: 40
- Correct before: 1
- Correct after: 40
- Explicit accidental failures: 25 → 0
- Wrong flat spellings: 10 → 0
- Missing naturals: 7 → 0
- Missing/wrong key signatures and changes: 10 → 0
- Unsafe raster key emissions: 1 → 0
- Wrong-note attachments: 0 → 0
- Noise false-positive emissions: 1 → 0
- Playback signatures unchanged: true

## Scope

- Required real scores: Gymnopédie, Evangelion, Minecraft, piano-articulation-scan.
- Clean engraved controls: Hungarian Dance No. 5 (many sharps and five key states), Mozart Menuet K.2, and Tchaikovsky Old French Song (flat spelling).
- Every case stores crop, overlay, attachment/state, MusicXML, renderer before/after, and sounding MIDI.

## Failure-layer result

- Before — renderer geometry/data loss: 2
- Before — none: 1
- Before — 1-symbol raster false positive: 1
- Before — MusicXML correct but renderer omitted key signature: 7
- Before — MusicXML omitted printed accidental semantics: 8
- Before — MusicXML emitted MIDI-equivalent sharp spelling and no printed accidental: 2
- Before — parser discarded explicit accidental; renderer used MIDI fallback: 7
- Before — parser discarded flat spelling; renderer respelled sounding MIDI as sharp: 8
- Before — clef/staff fragment selected as raster key signature: 4
- After — none: 40

## Frozen regressions

- Frozen semantic evaluator modified: no.
- Sprint 3 / playback / Visual Practice focused tests: 121 passed, 0 failed.
- Final focused post-courtesy renderer gate: 74 passed, 0 failed.
- Frozen semantic scoreboard deltas: overall, pitch, rhythm, sustain, articulation, measure structure, interpretation, and playback all exactly 0.
- Semantic gate failures/regressions: none. The generic corpus comparator reports `ACCEPT: NO` only because it requires a scored-category improvement; printed accidental/key fidelity is intentionally outside its frozen categories.
- Real-source playback signatures: Gymnopédie, Evangelion, Minecraft, and piano-articulation-scan all unchanged.
- Production build: passed.
- Sprint-owned lint set: passed.

The broader dirty-worktree test run completed with 2610 passed, 5 skipped, and
9 failures outside this slice. They include existing source-shape, cache,
negative-page, guitar-guidance, and stale tie-recall expectations; none point
to the Sprint 4 accidental/key code or tests.

## Live renderer audit

- Minuet in G rendered one sharp on both treble and bass staves.
- Both SVG key glyphs had nonzero boxes; malformed/duplicate accidental boxes: 0.
- The time signature shifted right of the key glyphs and did not collide.
- Parenthesized/bracketed courtesy glyphs are preserved by the renderer.
- Evidence: `live-renderer-audit.png`, `representative-before.png`,
  `representative-after.png`, and `representative-source-vs-notation.png`.
