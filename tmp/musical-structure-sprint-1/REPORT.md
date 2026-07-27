# Musical Structure Sprint 1 — real-measure validation

Generated: 2026-07-27T02:11:53.705Z

Shipped slice: strong opposing-stem ownership and printed long-value overlaps now become conservative parallel MusicXML voices with explicit written stems. Pitch, onset, duration, and note count are never changed.

## Acceptance summary

- verified real measures: 36 across 7 sources
- correct measures: 21 → 23
- wrong voice / false chord-merge cases: 8 → 0
- stem-direction/one-stem renderer cases: 2 → 0
- invented visible rests: 0 → 0
- selected-measure playback mismatches: 0
- changed MIDI/onset/duration/note count: 0/0/0/0
- chord sequentialization: 0 → 0
- false chord merges: 2 → 0
- beam-group errors: 0 → 0
- voice-rest errors: 13 → 13 (reported, not promoted)
- invented visible rests: 0 → 0
- tuplet-group errors: 1 → 1 (reported, not promoted)
- cross-staff assignment errors: 0 → 0
- underfull/overfull measures: 0 → 0
- renderer-only failures: 0 → 0

## Frozen regressions

- frozen semantic corpus: overall, pitch, rhythm, sustain, articulation, measure structure, and interpretation all delta 0; no regressions
- generic comparator: `ACCEPT: NO` only because its rhythm-sprint gate requires `rhythm > 0`; this notation-only slice is intentionally semantic-neutral
- Sprints 2–5 plus the new structure slice: 38 focused tests passed, 0 failed
- full suite: 2,626 passed, 9 failed, 5 skipped; seven added tests pass and the same nine unrelated pre-existing failures remain
- production build: passed
- targeted lint: passed
- playback signatures: all 36 selected measures unchanged; all six comparable source baselines unchanged
- the tuplet source's only aggregate mismatch is against a stale Sprint 2 artifact that already differs by two attacks before this sprint

## Failure-layer result

The repeated root cause was layer 1/3 measure reconstruction: detected opposing stems and visible sustained overlaps were retained only in diagnostics, while MusicXML forced all same-staff tones into one timing cursor. The renderer then had no written voice/stem data to distinguish them.

The general fix is gated by strong stem ownership with repeated singleton voice continuity, or by overlap with printed long-value evidence. Short timing overlaps, isolated mixed-stem chords, and mixed-staff notes without independent ownership stay on the legacy path.

Tuplet, cross-staff, and voice-rest misses are reported but not promoted in this narrow slice. No balancing rests were invented.

## Cases

| Case | Source | Location | Structure | Before | After | Playback | Gallery |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01-gymnopedie-p1-m1-sustained-overlapping-voices | Gymnopédie | p1 m1 | sustained overlapping voices | wrong | wrong | unchanged | [gallery](gallery/01-gymnopedie-p1-m1-sustained-overlapping-voices.png) |
| 02-gymnopedie-p1-m2-sustained-overlapping-voices | Gymnopédie | p1 m2 | sustained overlapping voices | wrong | wrong | unchanged | [gallery](gallery/02-gymnopedie-p1-m2-sustained-overlapping-voices.png) |
| 03-gymnopedie-p1-m3-sustained-overlapping-voices | Gymnopédie | p1 m3 | sustained overlapping voices | wrong | wrong | unchanged | [gallery](gallery/03-gymnopedie-p1-m3-sustained-overlapping-voices.png) |
| 04-gymnopedie-p1-m4-sustained-overlapping-voices | Gymnopédie | p1 m4 | sustained overlapping voices | wrong | wrong | unchanged | [gallery](gallery/04-gymnopedie-p1-m4-sustained-overlapping-voices.png) |
| 05-gymnopedie-p1-m5-sustained-overlapping-voices | Gymnopédie | p1 m5 | sustained overlapping voices | wrong | wrong | unchanged | [gallery](gallery/05-gymnopedie-p1-m5-sustained-overlapping-voices.png) |
| 06-gymnopedie-p1-m6-sustained-overlapping-voices | Gymnopédie | p1 m6 | sustained overlapping voices | wrong | wrong | unchanged | [gallery](gallery/06-gymnopedie-p1-m6-sustained-overlapping-voices.png) |
| 07-la-campanella-p1-m17-opposing-stem-voices | La Campanella dense/polyphonic piano | p1 m17 | opposing-stem voices | wrong | correct | unchanged | [gallery](gallery/07-la-campanella-p1-m17-opposing-stem-voices.png) |
| 08-la-campanella-p1-m18-opposing-stem-voices | La Campanella dense/polyphonic piano | p1 m18 | opposing-stem voices | wrong | correct | unchanged | [gallery](gallery/08-la-campanella-p1-m18-opposing-stem-voices.png) |
| 09-minecraft-p1-m4-chord-control | Minecraft | p1 m4 | chord control | correct | correct | unchanged | [gallery](gallery/09-minecraft-p1-m4-chord-control.png) |
| 10-evangelion-p1-m1-chord-control | Evangelion | p1 m1 | chord control | correct | correct | unchanged | [gallery](gallery/10-evangelion-p1-m1-chord-control.png) |
| 11-piano-articulation-scan-p1-m1-chord-control | piano-articulation-scan | p1 m1 | chord control | correct | correct | unchanged | [gallery](gallery/11-piano-articulation-scan-p1-m1-chord-control.png) |
| 12-piano-grand-voices-vector-p1-m1-chord-control | grand-staff voice control | p1 m1 | chord control | correct | correct | unchanged | [gallery](gallery/12-piano-grand-voices-vector-p1-m1-chord-control.png) |
| 13-piano-rhythm-tuplets-vector-p1-m6-no-structure-control | tuplet and voice-rest control | p1 m6 | no-structure control | correct | correct | unchanged | [gallery](gallery/13-piano-rhythm-tuplets-vector-p1-m6-no-structure-control.png) |
| 14-la-campanella-p1-m10-tuplet-control | La Campanella dense/polyphonic piano | p1 m10 | tuplet control | wrong | wrong | unchanged | [gallery](gallery/14-la-campanella-p1-m10-tuplet-control.png) |
| 15-la-campanella-p1-m4-voice-rest-control | La Campanella dense/polyphonic piano | p1 m4 | voice-rest control | wrong | wrong | unchanged | [gallery](gallery/15-la-campanella-p1-m4-voice-rest-control.png) |
| 16-la-campanella-p1-m5-voice-rest-control | La Campanella dense/polyphonic piano | p1 m5 | voice-rest control | wrong | wrong | unchanged | [gallery](gallery/16-la-campanella-p1-m5-voice-rest-control.png) |
| 17-la-campanella-p1-m6-voice-rest-control | La Campanella dense/polyphonic piano | p1 m6 | voice-rest control | wrong | wrong | unchanged | [gallery](gallery/17-la-campanella-p1-m6-voice-rest-control.png) |
| 18-la-campanella-p1-m7-voice-rest-control | La Campanella dense/polyphonic piano | p1 m7 | voice-rest control | wrong | wrong | unchanged | [gallery](gallery/18-la-campanella-p1-m7-voice-rest-control.png) |
| 19-minecraft-p1-m12-chord-control | Minecraft | p1 m12 | chord control | correct | correct | unchanged | [gallery](gallery/19-minecraft-p1-m12-chord-control.png) |
| 20-minecraft-p1-m14-chord-control | Minecraft | p1 m14 | chord control | correct | correct | unchanged | [gallery](gallery/20-minecraft-p1-m14-chord-control.png) |
| 21-minecraft-p1-m16-chord-control | Minecraft | p1 m16 | chord control | correct | correct | unchanged | [gallery](gallery/21-minecraft-p1-m16-chord-control.png) |
| 22-minecraft-p1-m20-chord-control | Minecraft | p1 m20 | chord control | correct | correct | unchanged | [gallery](gallery/22-minecraft-p1-m20-chord-control.png) |
| 23-evangelion-p1-m2-chord-control | Evangelion | p1 m2 | chord control | wrong | wrong | unchanged | [gallery](gallery/23-evangelion-p1-m2-chord-control.png) |
| 24-evangelion-p1-m3-chord-control | Evangelion | p1 m3 | chord control | correct | correct | unchanged | [gallery](gallery/24-evangelion-p1-m3-chord-control.png) |
| 25-evangelion-p1-m4-chord-control | Evangelion | p1 m4 | chord control | correct | correct | unchanged | [gallery](gallery/25-evangelion-p1-m4-chord-control.png) |
| 26-evangelion-p1-m6-chord-control | Evangelion | p1 m6 | chord control | correct | correct | unchanged | [gallery](gallery/26-evangelion-p1-m6-chord-control.png) |
| 27-evangelion-p1-m7-chord-control | Evangelion | p1 m7 | chord control | wrong | wrong | unchanged | [gallery](gallery/27-evangelion-p1-m7-chord-control.png) |
| 28-evangelion-p1-m8-chord-control | Evangelion | p1 m8 | chord control | correct | correct | unchanged | [gallery](gallery/28-evangelion-p1-m8-chord-control.png) |
| 29-piano-articulation-scan-p1-m2-chord-control | piano-articulation-scan | p1 m2 | chord control | correct | correct | unchanged | [gallery](gallery/29-piano-articulation-scan-p1-m2-chord-control.png) |
| 30-piano-articulation-scan-p1-m3-chord-control | piano-articulation-scan | p1 m3 | chord control | correct | correct | unchanged | [gallery](gallery/30-piano-articulation-scan-p1-m3-chord-control.png) |
| 31-piano-articulation-scan-p1-m4-chord-control | piano-articulation-scan | p1 m4 | chord control | correct | correct | unchanged | [gallery](gallery/31-piano-articulation-scan-p1-m4-chord-control.png) |
| 32-piano-articulation-scan-p1-m5-chord-control | piano-articulation-scan | p1 m5 | chord control | correct | correct | unchanged | [gallery](gallery/32-piano-articulation-scan-p1-m5-chord-control.png) |
| 33-piano-articulation-scan-p1-m6-chord-control | piano-articulation-scan | p1 m6 | chord control | correct | correct | unchanged | [gallery](gallery/33-piano-articulation-scan-p1-m6-chord-control.png) |
| 34-piano-articulation-scan-p1-m7-chord-control | piano-articulation-scan | p1 m7 | chord control | correct | correct | unchanged | [gallery](gallery/34-piano-articulation-scan-p1-m7-chord-control.png) |
| 35-piano-grand-voices-vector-p1-m2-chord-control | grand-staff voice control | p1 m2 | chord control | correct | correct | unchanged | [gallery](gallery/35-piano-grand-voices-vector-p1-m2-chord-control.png) |
| 36-piano-grand-voices-vector-p1-m3-chord-control | grand-staff voice control | p1 m3 | chord control | correct | correct | unchanged | [gallery](gallery/36-piano-grand-voices-vector-p1-m3-chord-control.png) |
