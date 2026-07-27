# Playback Semantics Sprint 1 — ACCEPTED / FROZEN

**Accepted 2026-07-26.** Do not retune recognition or playback-event semantics
unless a demonstrated regression appears.

## Accepted behavior
- Valid tie continuations do not re-attack; chains and partial chords work per pitch
- Slurs still attack independently
- Staccato, tenuto, accent, marcato, fermata affect performed events
- Dynamics produce ordered velocities; wedges interpolate
- Explicit tempo marks affect performed timing
- Repeats/voltas preserve tempo/expression; cursor follows performed time
- Written MusicXML, pitch, durations, Guitar frets unchanged
- Frozen semantic corpus unchanged (Overall 61.9%)

## Follow-on
Audio Rendering / Piano Realism Sprint 1 — sound generation only.
The audio renderer consumes frozen performed events and must not rewrite musical meaning.
