# Notation Fidelity Sprint 3 — ties and slurs

- Manually verified cases: 35
- Correct before: 1
- Correct after: 33
- Tie cases: 22
- Slur cases: 12
- No-curve controls: 1

## Acceptance deltas

- Missing ties: 22 → 0
- False ties: 0 → 0
- Wrong-note tie attachments: 0 → 0
- Missing slurs: 12 → 2
- Tie classified as slur: 0 → 0
- Slur classified as tie: 0 → 0
- Emitted orphan endpoints: 0 → 0
- Renderer-only failures in the real-case set: 0 → 0; the separate three-note chain control now renders every written continuation and one curve per link.
- Recovered tie continuation re-attacks on the page-one playback controls: 14 → 0.
- Written page-one signatures unchanged: false.
- Unrelated page-one playback attack delta: 0.

## Real-score output

- gymnopedie: 38 vector candidates, 24 applied, 14 ties, 10 slurs, 0 emitted orphans
- minecraft: 62 vector candidates, 62 applied, 62 ties, 0 slurs, 0 emitted orphans
- evangelion: 19 vector candidates, 14 applied, 14 ties, 0 slurs, 0 emitted orphans
- piano-articulation-scan: 0 vector candidates, 0 applied, 0 ties, 0 slurs, 0 emitted orphans
- piano-grand-voices-vector: 0 vector candidates, 0 applied, 0 ties, 0 slurs, 0 emitted orphans

## Remaining failures

- Raster-only articulation/control slurs remain undetected and are retained as diagnostics; no unsafe MusicXML is emitted.
- Vector candidates whose selected endpoint pitches disagree are rejected rather than converted into false ties or slurs.
