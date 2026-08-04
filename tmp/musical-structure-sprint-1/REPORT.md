# Musical Structure Sprint 1 — real-measure validation

Generated: 2026-07-28T01:41:30.696Z

Shipped slice: strong opposing-stem ownership now becomes parallel MusicXML voices and explicit written stems. Pitch, onset, duration, and note count are never changed.

## Acceptance summary

- verified real measures: 36 across 7 sources
- correct measures: 27 → 26
- wrong voice / false chord-merge cases: 0 → 0
- stem-direction/one-stem renderer cases: 0 → 0
- invented visible rests: 0 → 0
- selected-measure playback mismatches: 0
- changed MIDI/onset/duration/note count: 0/0/0/0

## Failure-layer result

The repeated root cause was layer 1/3 measure reconstruction: detected opposing stems were retained only in diagnostics, while MusicXML forced all same-staff tones into one chord/voice. The renderer then had no written voice/stem data to distinguish them.

Tuplet, cross-staff, and voice-rest misses are reported but not promoted in this narrow slice.

## Cases

| Case | Source | Location | Structure | Before | After | Playback | Gallery |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01-minecraft-p1-m4-chord-control | Minecraft | p1 m4 | chord control | correct | correct | unchanged | [gallery](gallery/01-minecraft-p1-m4-chord-control.png) |
| 02-evangelion-p1-m1-chord-control | Evangelion | p1 m1 | chord control | correct | correct | unchanged | [gallery](gallery/02-evangelion-p1-m1-chord-control.png) |
| 03-gymnopedie-p1-m1-sustained-overlapping-voices | Gymnopédie | p1 m1 | sustained overlapping voices | wrong | wrong | unchanged | [gallery](gallery/03-gymnopedie-p1-m1-sustained-overlapping-voices.png) |
| 04-piano-articulation-scan-p1-m1-chord-control | piano-articulation-scan | p1 m1 | chord control | correct | correct | unchanged | [gallery](gallery/04-piano-articulation-scan-p1-m1-chord-control.png) |
| 05-piano-grand-voices-vector-p1-m1-chord-control | grand-staff voice control | p1 m1 | chord control | correct | correct | unchanged | [gallery](gallery/05-piano-grand-voices-vector-p1-m1-chord-control.png) |
| 06-la-campanella-p1-m1-chord-control | La Campanella dense/polyphonic piano | p1 m1 | chord control | correct | correct | unchanged | [gallery](gallery/06-la-campanella-p1-m1-chord-control.png) |
| 07-piano-rhythm-tuplets-vector-p1-m6-no-structure-control | tuplet and voice-rest control | p1 m6 | no-structure control | correct | correct | unchanged | [gallery](gallery/07-piano-rhythm-tuplets-vector-p1-m6-no-structure-control.png) |
| 08-la-campanella-p1-m10-tuplet-control | La Campanella dense/polyphonic piano | p1 m10 | tuplet control | wrong | wrong | unchanged | [gallery](gallery/08-la-campanella-p1-m10-tuplet-control.png) |
| 09-la-campanella-p1-m4-voice-rest-control | La Campanella dense/polyphonic piano | p1 m4 | voice-rest control | wrong | wrong | unchanged | [gallery](gallery/09-la-campanella-p1-m4-voice-rest-control.png) |
| 10-la-campanella-p1-m5-voice-rest-control | La Campanella dense/polyphonic piano | p1 m5 | voice-rest control | wrong | wrong | unchanged | [gallery](gallery/10-la-campanella-p1-m5-voice-rest-control.png) |
| 11-la-campanella-p1-m6-voice-rest-control | La Campanella dense/polyphonic piano | p1 m6 | voice-rest control | wrong | wrong | unchanged | [gallery](gallery/11-la-campanella-p1-m6-voice-rest-control.png) |
| 12-la-campanella-p1-m7-voice-rest-control | La Campanella dense/polyphonic piano | p1 m7 | voice-rest control | wrong | wrong | unchanged | [gallery](gallery/12-la-campanella-p1-m7-voice-rest-control.png) |
| 13-la-campanella-p1-m8-voice-rest-control | La Campanella dense/polyphonic piano | p1 m8 | voice-rest control | wrong | wrong | unchanged | [gallery](gallery/13-la-campanella-p1-m8-voice-rest-control.png) |
| 14-minecraft-p1-m12-chord-control | Minecraft | p1 m12 | chord control | correct | correct | unchanged | [gallery](gallery/14-minecraft-p1-m12-chord-control.png) |
| 15-minecraft-p1-m14-chord-control | Minecraft | p1 m14 | chord control | correct | correct | unchanged | [gallery](gallery/15-minecraft-p1-m14-chord-control.png) |
| 16-minecraft-p1-m16-chord-control | Minecraft | p1 m16 | chord control | correct | correct | unchanged | [gallery](gallery/16-minecraft-p1-m16-chord-control.png) |
| 17-minecraft-p1-m20-chord-control | Minecraft | p1 m20 | chord control | correct | correct | unchanged | [gallery](gallery/17-minecraft-p1-m20-chord-control.png) |
| 18-evangelion-p1-m2-chord-control | Evangelion | p1 m2 | chord control | wrong | wrong | unchanged | [gallery](gallery/18-evangelion-p1-m2-chord-control.png) |
| 19-evangelion-p1-m3-chord-control | Evangelion | p1 m3 | chord control | correct | correct | unchanged | [gallery](gallery/19-evangelion-p1-m3-chord-control.png) |
| 20-evangelion-p1-m4-chord-control | Evangelion | p1 m4 | chord control | correct | correct | unchanged | [gallery](gallery/20-evangelion-p1-m4-chord-control.png) |
| 21-evangelion-p1-m6-chord-control | Evangelion | p1 m6 | chord control | correct | correct | unchanged | [gallery](gallery/21-evangelion-p1-m6-chord-control.png) |
| 22-evangelion-p1-m7-chord-control | Evangelion | p1 m7 | chord control | wrong | wrong | unchanged | [gallery](gallery/22-evangelion-p1-m7-chord-control.png) |
| 23-evangelion-p1-m8-chord-control | Evangelion | p1 m8 | chord control | correct | correct | unchanged | [gallery](gallery/23-evangelion-p1-m8-chord-control.png) |
| 24-piano-articulation-scan-p1-m2-chord-control | piano-articulation-scan | p1 m2 | chord control | correct | correct | unchanged | [gallery](gallery/24-piano-articulation-scan-p1-m2-chord-control.png) |
| 25-piano-articulation-scan-p1-m3-chord-control | piano-articulation-scan | p1 m3 | chord control | correct | correct | unchanged | [gallery](gallery/25-piano-articulation-scan-p1-m3-chord-control.png) |
| 26-piano-articulation-scan-p1-m4-chord-control | piano-articulation-scan | p1 m4 | chord control | correct | correct | unchanged | [gallery](gallery/26-piano-articulation-scan-p1-m4-chord-control.png) |
| 27-piano-articulation-scan-p1-m5-chord-control | piano-articulation-scan | p1 m5 | chord control | correct | correct | unchanged | [gallery](gallery/27-piano-articulation-scan-p1-m5-chord-control.png) |
| 28-piano-articulation-scan-p1-m6-chord-control | piano-articulation-scan | p1 m6 | chord control | correct | correct | unchanged | [gallery](gallery/28-piano-articulation-scan-p1-m6-chord-control.png) |
| 29-piano-articulation-scan-p1-m7-chord-control | piano-articulation-scan | p1 m7 | chord control | correct | correct | unchanged | [gallery](gallery/29-piano-articulation-scan-p1-m7-chord-control.png) |
| 30-piano-grand-voices-vector-p1-m2-chord-control | grand-staff voice control | p1 m2 | chord control | correct | correct | unchanged | [gallery](gallery/30-piano-grand-voices-vector-p1-m2-chord-control.png) |
| 31-piano-grand-voices-vector-p1-m3-chord-control | grand-staff voice control | p1 m3 | chord control | correct | correct | unchanged | [gallery](gallery/31-piano-grand-voices-vector-p1-m3-chord-control.png) |
| 32-piano-grand-voices-vector-p1-m4-chord-control | grand-staff voice control | p1 m4 | chord control | correct | correct | unchanged | [gallery](gallery/32-piano-grand-voices-vector-p1-m4-chord-control.png) |
| 33-piano-grand-voices-vector-p1-m5-chord-control | grand-staff voice control | p1 m5 | chord control | correct | correct | unchanged | [gallery](gallery/33-piano-grand-voices-vector-p1-m5-chord-control.png) |
| 34-piano-grand-voices-vector-p1-m6-chord-control | grand-staff voice control | p1 m6 | chord control | correct | correct | unchanged | [gallery](gallery/34-piano-grand-voices-vector-p1-m6-chord-control.png) |
| 35-piano-grand-voices-vector-p1-m7-chord-control | grand-staff voice control | p1 m7 | chord control | correct | correct | unchanged | [gallery](gallery/35-piano-grand-voices-vector-p1-m7-chord-control.png) |
| 36-minecraft-p1-m1-sustained-overlapping-voices | Minecraft | p1 m1 | sustained overlapping voices | correct | wrong | unchanged | [gallery](gallery/36-minecraft-p1-m1-sustained-overlapping-voices.png) |

