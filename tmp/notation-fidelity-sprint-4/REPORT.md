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
- Playback signatures unchanged: false

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
