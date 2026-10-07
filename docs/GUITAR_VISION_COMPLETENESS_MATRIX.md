# Guitar notation completeness matrix (informational V1 handoff)

Fret recognition is settled (dedicated raw-ROI path, 0.9266 score-disjoint, gated).
Guitar Vision as a whole is NOT complete. Status per family, grounded in what the
model actually has (heads: object_type, string, tile, fret; experimental
slot/presence only) and what was measured (fret numbers only):

| family | status | evidence / note |
|---|---|---|
| fret numbers | SUPPORTED | 0.9266 (366/395), gated, production-integrated |
| string numbers | PARTIAL | head exists and is served; accuracy never established here |
| object detection (notehead / fret-digit / marking regions) | PARTIAL | object_type head exists; unmeasured |
| layout/tile geometry | PARTIAL | internal aid, not a product feature |
| string/fret assignment (playable pairing) | UNVERIFIED | heads exist separately; joint correctness unmeasured |
| standard-note rhythm (onset/duration) | MISSING | no timing model |
| rests | MISSING | generator covers; nothing reads |
| voices (multi-voice/stacked) | MISSING | generator covers; nothing reads |
| ties/slurs | MISSING | — |
| tuplets | MISSING | generator covers; nothing reads |
| key/time/clef/barline context | MISSING | generator covers; nothing reads |
| accidentals | MISSING | generator covers; nothing reads |
| bends (+amount) | MISSING | generator covers; nothing reads |
| slides / glissando | MISSING | generator covers; nothing reads |
| hammer-ons / pull-offs | MISSING | generator covers; nothing reads |
| harmonics (natural/artificial) | MISSING | generator covers; nothing reads |
| tapping | MISSING | generator covers; nothing reads |
| palm muting | MISSING | — |
| dead/ghost notes | MISSING | — |
| vibrato | MISSING | — |
| articulations (staccato/accent/fingering) | MISSING | generator covers some; markings unclassified (284 marking objects, type unread) |
| dynamics | MISSING | — |
| repeats/endings/navigation | MISSING | — |
| tuning | MISSING | — |
| capo | MISSING | — |
| chord diagrams | MISSING | — |
| lyrics/text | MISSING | — |
| uncommon/unsupported notation | MISSING | by definition; gate + refuse-policy is the backstop |

"Generator covers" = the synthetic data engine emits the family; it says nothing
about recognition. Do not report generator coverage as product coverage.

## Next highest-priority V1 blocker

**Playability: timing/rhythm + verified string/fret assignment.** Fret numbers
without onset/duration (and without a measured string pairing) are not playable
music — they are labeled glyphs. Until rhythm exists and the pairing is measured,
the fret path cannot carry a transcription feature alone. After that, the bend /
slide / hammer-on / pull-off articulation family is the largest recognition gap
for real Guitar TAB.
