# OMR benchmark dashboard

Generated: 2026-07-05T16:02:41.561Z
Fixtures: 5
Overall: PASS
Largest remaining error bucket: chord = 8346 (32%)

## Status
- pass: 3
- fail: 0
- rejected: 0
- skipped: 2
- error: 0

## Fixtures

### Gymnopédie No. 1 (clean) (`pass`)
- PDF: `/Users/ryland/Downloads/gymnopedie-no-1-satie.pdf`
- Truth: `/Users/ryland/Downloads/gymnopedie-no-1-satie.mxl`
  pitch 100% | duration 100% | onset 100% | chord 100% | F1 100%
  measureΔ 0 | noteΔ 0 | wrongPitch 0 | wrongDuration 0 | wrongOnset 0 | chordMismatch 0
  top error category: Measure allocation (measure-allocation)
  - Primary: Measure allocation (measure-allocation, confidence 0.22)
  - Source scores: measure-allocation=0.22
  - Error buckets: slurs=164
  - Largest remaining error bucket: slurs = 164 (100%)
  Rhythm/voice attribution: (no dense rhythm errors)
  Written vs sounding duration (V2 Phase 3):
  - (no duration errors in report sample)
  Tie/sustain constraints (V2 Phase 4):
  - (no tie/sustain constraint candidates in report sample)
  - Tie glyphs: detected 6, applied 6, slur-like rejected 0, unresolved 0
  - Tie chains (clean): 370 chain(s) in 78 measure(s), 5 malformed

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 78 candidates / 78 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 0 → 0 (Δ 0), wrongDuration 0 → 0 (Δ 0), chord 0 → 0 (Δ 0)
- Rejected candidates: m1:, m2:, m3:, m4:, m5:onset-group-regression, m6:constraints-failed, m7:constraints-failed, m8:constraints-failed…

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 2 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 0 → 0 (Δ 0), wrongDuration 0 → 0 (Δ 0), chord 0 → 0 (Δ 0)
- Rejected measures: m37:constraints-failed, m76:constraints-failed
  ScoreGraph IR (observation): 989 nodes, 1963 edges across 78 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 3 node(s) sounding≠written; 375 tie; 0 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### A Cruel Angel's Thesis (dense) (`pass`)
- PDF: `/Users/ryland/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.pdf`
- Truth: `/Users/ryland/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.mxl`
  pitch 94% | duration 96% | onset 96% | chord 94% | F1 99%
  measureΔ 0 | noteΔ 0 | wrongPitch 147 | wrongDuration 77 | wrongOnset 94 | chordMismatch 172
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: onset-coupled (44 sampled)
  top pitch error category: other (73 sampled)
  - Primary: Rhythm inference (rhythm-inference, confidence 0.899)
  - Source scores: rhythm-inference=0.8987, measure-allocation=0.229
  - Pitch errors (147): other=73, ±2-diatonic=52, ±1-accidental=19, ±octave=3
  - Duration errors (77): onset-coupled=44, too-short=20, too-long=9, beamed-subdivision=4
  - Detection: chord-grouping=172, extra-notes=28, missing-notes=28
  - Error buckets: slurs=800, chord=172, pitch=147, onset=94, duration=77, extra/missing-notes=56, rests=52, accidentals=19, ties=16
  - Largest remaining error bucket: slurs = 800 (56%)
  Rhythm/voice attribution (V2 Phase 1):
  - onset-phase-shift: 94
  - pitch-grouping-symptom: 90
  - chord-grouping-symptom: 81
  - balanced-missing-extra-serialization: 52
  - onset-coupled-duration: 44
  - voice-serialization-shift: 35
  - chord symptom coupled share: 89%
  - missing/extra balanced: 28/28
  Written vs sounding duration (V2 Phase 3):
  - onset-coupled-duration: 44
  - written-duration-wrong: 33
  - Dominant: onset-coupled-duration (44)
  - Hotspot duration traces:
    - m7: 2 wrong durations (onset-coupled-duration=2)
    - m9: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=2)
    - m121: 2 wrong durations (written-duration-wrong=2)
  Tie/sustain constraints (V2 Phase 4):
  - expected-cross-measure-tie: 42
  - sounding-release-too-short: 42
  - written-correct-sustain-wrong: 31
  - slur-like-arc-pitch-differs: 16
  - tie-start-without-continuation: 8
  - continuation-without-tie-start: 4
  - Dominant: expected-cross-measure-tie (42)
  - Tie glyphs: detected 27, applied 11, slur-like rejected 16, unresolved 0
  Hotspot measures (dense):
  - m7: 8 wrong onsets (unique-pitch-slot-shift=1, cross-voice-matcher=2, serialization-voice-shift=5)
  - m9: 18 wrong onsets (duplicate-pitch-instance=2, cross-voice-matcher=5, serialization-voice-shift=11)
  - m121: 9 wrong onsets (cross-voice-matcher=7, serialization-voice-shift=2)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 125 candidates / 125 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 94 → 94 (Δ 0), wrongDuration 77 → 77 (Δ 0), chord 172 → 172 (Δ 0)
- Rejected candidates: m1:constraints-failed, m2:constraints-failed, m3:constraints-failed, m4:constraints-failed, m5:constraints-failed, m6:constraints-failed, m7:constraints-failed, m8:duration-changed+chord-split…
- Hotspot per-measure Δ:
  - m7: onset Δ 0, duration Δ 0, chord Δ 0
  - m9: onset Δ 0, duration Δ 0, chord Δ 0
  - m121: onset Δ 0, duration Δ 0, chord Δ 0

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 115 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 94 → 94 (Δ 0), wrongDuration 77 → 77 (Δ 0), chord 172 → 172 (Δ 0)
- Rejected measures: m2:constraints-failed, m4:constraints-failed, m5:constraints-failed, m6:constraints-failed, m7:constraints-failed, m8:constraints-failed, m9:constraints-failed, m10:constraints-failed…
- Hotspot deltas: m7(onsetΔ0,durΔ0,chordΔ0), m9(onsetΔ0,durΔ0,chordΔ0), m121(onsetΔ0,durΔ0,chordΔ0)
  ScoreGraph IR (observation): 5933 nodes, 12564 edges across 125 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 229 node(s) sounding≠written; 2044 tie; 70 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### Twinkle Twinkle Little Star (simple/legacy-font) (`pass`)
- PDF: `/Users/ryland/Downloads/twinkle-twinkle-little-star-easy.pdf`
- Truth: `/Users/ryland/Downloads/twinkle-twinkle-little-star-easy.mxl`
  pitch 100% | duration 97% | onset 93% | chord 100% | F1 100%
  measureΔ 0 | noteΔ 0 | wrongPitch 0 | wrongDuration 3 | wrongOnset 6 | chordMismatch 0
  top error category: Measure allocation (measure-allocation)
  top duration error category: onset-coupled (2 sampled)
  - Primary: Measure allocation (measure-allocation, confidence 0.22)
  - Source scores: measure-allocation=0.22
  - Duration errors (3): onset-coupled=2, beamed-subdivision=1
  - Error buckets: onset=6, duration=3
  - Largest remaining error bucket: onset = 6 (67%)
  Rhythm/voice attribution (V2 Phase 1):
  - onset-phase-shift: 6
  - voice-serialization-shift: 4
  - onset-coupled-duration: 2
  - missing/extra balanced: 0/0
  Written vs sounding duration (V2 Phase 3):
  - onset-coupled-duration: 2
  - written-duration-wrong: 1
  - Dominant: onset-coupled-duration (2)
  - Hotspot duration traces:
    - m10: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=2)
  Tie/sustain constraints (V2 Phase 4):
  - expected-cross-measure-tie: 2
  - sounding-release-too-short: 2
  - written-correct-sustain-wrong: 1
  - Dominant: expected-cross-measure-tie (2)
  - Tie glyphs: detected 0, applied 0, slur-like rejected 0, unresolved 0
  - False-tie guard (simple): 0 applied (clean)
  Hotspot measures (simple):
  - m10: 6 wrong onsets (unique-pitch-slot-shift=2, serialization-voice-shift=4)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 12 candidates / 12 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 6 → 6 (Δ 0), wrongDuration 3 → 3 (Δ 0), chord 0 → 0 (Δ 0)
- Rejected candidates: m1:no-improvement, m2:no-improvement, m3:no-improvement, m4:no-improvement, m5:no-improvement, m6:no-improvement, m7:no-improvement, m8:no-improvement…
- Hotspot per-measure Δ:
  - m10: onset Δ 0, duration Δ 0, chord Δ 0

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 12 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 6 → 6 (Δ 0), wrongDuration 3 → 3 (Δ 0), chord 0 → 0 (Δ 0)
- Rejected measures: m1:no-improvement, m2:no-improvement, m3:no-improvement, m4:no-improvement, m5:no-improvement, m6:no-improvement, m7:no-improvement, m8:no-improvement…
- Hotspot deltas: m10(onsetΔ0,durΔ0,chordΔ0)
  ScoreGraph IR (observation): 172 nodes, 311 edges across 12 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 20 node(s) sounding≠written; 53 tie; 1 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### La Campanella (Grandes études de Paganini No. 3) (`skipped`)
- PDF: `/Users/ryland/Downloads/la-campanella-grandes-etudes-de-paganini-no-3-franz-liszt.pdf`
- Truth: `/Users/ryland/Downloads/la-campanella-grandes-etudes-de-paganini-no-3-franz-liszt.mxl`
  pitch 24% | duration 65% | onset 39% | chord 52% | F1 77%
  measureΔ 10 | noteΔ -286 | wrongPitch 2189 | wrongDuration 384 | wrongOnset 1526 | chordMismatch 2698
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: beamed-subdivision (291 sampled)
  top pitch error category: other (1426 sampled)
  - Primary: Rhythm inference (rhythm-inference, confidence 0.891)
  - Source scores: rhythm-inference=0.8906, pitch-mapping=0.6414, measure-allocation=0.5695, chord-grouping=0.4351, notehead-detection=0.3012
  - Pitch errors (2189): other=1426, ±1-accidental=308, ±octave=259, ±2-diatonic=187, ±octave-other=9
  - Duration errors (384): beamed-subdivision=291, onset-coupled=85, too-short=8
  - Detection: chord-grouping=2698, missing-notes=1133, extra-notes=847
  - Error buckets: chord=2698, pitch=2189, extra/missing-notes=1980, onset=1526, slurs=901, duration=384, accidentals=308, ties=304, rests=285
  - Largest remaining error bucket: chord = 2698 (26%)
  Rhythm/voice attribution (V2 Phase 1):
  - pitch-grouping-symptom: 1881
  - chord-grouping-symptom: 1630
  - onset-phase-shift: 1276
  - voice-serialization-shift: 261
  - onset-coupled-duration: 85
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - serialization-artifact: 157
  - written-duration-wrong: 142
  - onset-coupled-duration: 85
  - Dominant: serialization-artifact (157)
  - Hotspot duration traces:
    - m2: 2 wrong durations (onset-coupled-duration=2)
    - m3: 6 wrong durations (onset-coupled-duration=3, serialization-artifact=3)
    - m4: 2 wrong durations (written-duration-wrong=2)
    - m6: 3 wrong durations (written-duration-wrong=3)
    - m7: 3 wrong durations (written-duration-wrong=2, serialization-artifact=1)
    - m8: 1 wrong durations (written-duration-wrong=1)
    - m10: 3 wrong durations (written-duration-wrong=3)
    - m11: 3 wrong durations (written-duration-wrong=2, serialization-artifact=1)
    - m12: 2 wrong durations (written-duration-wrong=2)
    - m14: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=1)
    - m15: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m16: 1 wrong durations (onset-coupled-duration=1)
    - m18: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m19: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=1)
    - m20: 3 wrong durations (written-duration-wrong=2, serialization-artifact=1)
    - m21: 1 wrong durations (onset-coupled-duration=1)
    - m22: 8 wrong durations (written-duration-wrong=1, onset-coupled-duration=7)
    - m23: 3 wrong durations (serialization-artifact=3)
    - m24: 3 wrong durations (written-duration-wrong=1, serialization-artifact=2)
    - m25: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=1)
    - m26: 3 wrong durations (onset-coupled-duration=3)
    - m27: 4 wrong durations (onset-coupled-duration=3, serialization-artifact=1)
    - m28: 1 wrong durations (onset-coupled-duration=1)
    - m29: 1 wrong durations (serialization-artifact=1)
    - m30: 5 wrong durations (written-duration-wrong=2, onset-coupled-duration=2, serialization-artifact=1)
    - m31: 1 wrong durations (serialization-artifact=1)
    - m32: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m33: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m34: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m35: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m36: 5 wrong durations (written-duration-wrong=2, onset-coupled-duration=2, serialization-artifact=1)
    - m37: 4 wrong durations (written-duration-wrong=3, onset-coupled-duration=1)
    - m38: 6 wrong durations (written-duration-wrong=1, onset-coupled-duration=3, serialization-artifact=2)
    - m39: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=1)
    - m40: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=1)
    - m43: 1 wrong durations (onset-coupled-duration=1)
    - m44: 2 wrong durations (written-duration-wrong=2)
    - m45: 2 wrong durations (written-duration-wrong=2)
    - m46: 2 wrong durations (serialization-artifact=2)
    - m47: 3 wrong durations (onset-coupled-duration=1, serialization-artifact=2)
    - m48: 4 wrong durations (written-duration-wrong=1, serialization-artifact=3)
    - m49: 3 wrong durations (written-duration-wrong=2, serialization-artifact=1)
    - m50: 3 wrong durations (written-duration-wrong=2, serialization-artifact=1)
    - m52: 5 wrong durations (onset-coupled-duration=1, serialization-artifact=4)
    - m54: 1 wrong durations (written-duration-wrong=1)
    - m55: 1 wrong durations (serialization-artifact=1)
    - m57: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m58: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m62: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m63: 5 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=2)
    - m64: 3 wrong durations (onset-coupled-duration=2, serialization-artifact=1)
    - m65: 3 wrong durations (onset-coupled-duration=2, serialization-artifact=1)
    - m66: 3 wrong durations (onset-coupled-duration=2, serialization-artifact=1)
    - m67: 3 wrong durations (onset-coupled-duration=2, serialization-artifact=1)
    - m68: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m69: 3 wrong durations (serialization-artifact=3)
    - m70: 4 wrong durations (written-duration-wrong=2, serialization-artifact=2)
    - m72: 4 wrong durations (written-duration-wrong=2, serialization-artifact=2)
    - m73: 1 wrong durations (serialization-artifact=1)
    - m74: 5 wrong durations (onset-coupled-duration=1, serialization-artifact=4)
    - m75: 2 wrong durations (written-duration-wrong=2)
    - m76: 2 wrong durations (written-duration-wrong=2)
    - m77: 2 wrong durations (written-duration-wrong=2)
    - m78: 2 wrong durations (written-duration-wrong=2)
    - m79: 2 wrong durations (written-duration-wrong=2)
    - m85: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m86: 2 wrong durations (serialization-artifact=2)
    - m87: 3 wrong durations (written-duration-wrong=2, serialization-artifact=1)
    - m88: 4 wrong durations (written-duration-wrong=2, serialization-artifact=2)
    - m89: 7 wrong durations (written-duration-wrong=4, serialization-artifact=3)
    - m90: 4 wrong durations (written-duration-wrong=1, serialization-artifact=3)
    - m91: 2 wrong durations (serialization-artifact=2)
    - m92: 7 wrong durations (written-duration-wrong=5, serialization-artifact=2)
    - m93: 10 wrong durations (written-duration-wrong=6, onset-coupled-duration=1, serialization-artifact=3)
    - m95: 4 wrong durations (serialization-artifact=4)
    - m96: 3 wrong durations (written-duration-wrong=1, serialization-artifact=2)
    - m98: 1 wrong durations (written-duration-wrong=1)
    - m99: 1 wrong durations (onset-coupled-duration=1)
    - m100: 6 wrong durations (written-duration-wrong=2, serialization-artifact=4)
    - m101: 3 wrong durations (written-duration-wrong=1, serialization-artifact=2)
    - m102: 1 wrong durations (written-duration-wrong=1)
    - m103: 15 wrong durations (onset-coupled-duration=2, serialization-artifact=13)
    - m104: 7 wrong durations (written-duration-wrong=1, onset-coupled-duration=2, serialization-artifact=4)
    - m105: 4 wrong durations (written-duration-wrong=2, serialization-artifact=2)
    - m106: 1 wrong durations (serialization-artifact=1)
    - m107: 2 wrong durations (written-duration-wrong=2)
    - m109: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m110: 1 wrong durations (written-duration-wrong=1)
    - m111: 7 wrong durations (written-duration-wrong=3, onset-coupled-duration=3, serialization-artifact=1)
    - m113: 8 wrong durations (written-duration-wrong=3, serialization-artifact=5)
    - m114: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m115: 6 wrong durations (written-duration-wrong=2, serialization-artifact=4)
    - m117: 1 wrong durations (serialization-artifact=1)
    - m122: 6 wrong durations (written-duration-wrong=1, serialization-artifact=5)
    - m123: 6 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=4)
    - m124: 6 wrong durations (written-duration-wrong=4, serialization-artifact=2)
    - m125: 5 wrong durations (written-duration-wrong=3, serialization-artifact=2)
    - m126: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m128: 1 wrong durations (serialization-artifact=1)
    - m129: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m131: 3 wrong durations (written-duration-wrong=1, serialization-artifact=2)
    - m132: 3 wrong durations (onset-coupled-duration=2, serialization-artifact=1)
    - m133: 1 wrong durations (written-duration-wrong=1)
    - m137: 6 wrong durations (written-duration-wrong=2, onset-coupled-duration=2, serialization-artifact=2)
    - m138: 4 wrong durations (written-duration-wrong=1, serialization-artifact=3)
    - m139: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m140: 3 wrong durations (written-duration-wrong=2, onset-coupled-duration=1)
    - m141: 7 wrong durations (onset-coupled-duration=5, serialization-artifact=2)
    - m142: 1 wrong durations (serialization-artifact=1)
    - m143: 2 wrong durations (serialization-artifact=2)
    - m145: 8 wrong durations (written-duration-wrong=2, onset-coupled-duration=4, serialization-artifact=2)
    - m147: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m148: 1 wrong durations (written-duration-wrong=1)
    - m149: 6 wrong durations (written-duration-wrong=3, onset-coupled-duration=1, serialization-artifact=2)
    - m150: 3 wrong durations (written-duration-wrong=3)
  Tie/sustain constraints (V2 Phase 4):
  - slur-like-arc-pitch-differs: 304
  - tie-start-without-continuation: 132
  - continuation-without-tie-start: 43
  - written-correct-sustain-wrong: 35
  - expected-cross-measure-tie: 1
  - sounding-release-too-short: 1
  - Dominant: slur-like-arc-pitch-differs (304)
  - Tie glyphs: detected 333, applied 29, slur-like rejected 304, unresolved 0

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 149 candidates / 149 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 1526 → 1526 (Δ 0), wrongDuration 384 → 384 (Δ 0), chord 2698 → 2698 (Δ 0)
- Rejected candidates: m1:duration-changed+chord-split, m2:duration-changed+chord-split+onset-group-regression, m3:duration-changed+chord-split+onset-group-regression, m5:duration-changed, m6:constraints-failed, m7:constraints-failed, m8:constraints-failed, m9:constraints-failed…

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 1 structurally applied (1 duration-coupled) / 0 truth-approved / 140 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 1526 → 1526 (Δ 0), wrongDuration 384 → 384 (Δ 0), chord 2698 → 2698 (Δ 0)
- Rejected measures: m1:constraints-failed, m2:constraints-failed, m3:constraints-failed, m6:constraints-failed, m7:constraints-failed, m9:constraints-failed, m10:constraints-failed, m11:constraints-failed…
  ScoreGraph IR (observation): 9091 nodes, 16995 edges across 160 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 4 underfill measure(s)
  IR duration split: 61 node(s) sounding≠written; 1659 tie; 68 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### La Campanella (Étude S.141/3, G minor) (`skipped`)
- PDF: `/Users/ryland/Downloads/etude-s-1413-in-g-minor-la-campanella-liszt.pdf`
- Truth: `/Users/ryland/Downloads/etude-s-1413-in-g-minor-la-campanella-liszt.mxl`
  pitch 11% | duration 25% | onset 18% | chord 20% | F1 37%
  measureΔ 89 | noteΔ -400 | wrongPitch 1011 | wrongDuration 415 | wrongOnset 749 | chordMismatch 5476
  top error category: Measure allocation (measure-allocation)
  top duration error category: beamed-subdivision (320 sampled)
  top pitch error category: other (680 sampled)
  - Primary: Measure allocation (measure-allocation, confidence 1)
  - Source scores: measure-allocation=1, rhythm-inference=0.882, notehead-detection=0.7378, chord-grouping=0.7236, pitch-mapping=0.6412
  - Pitch errors (1011): other=680, ±2-diatonic=128, ±1-accidental=123, ±octave=76, ±octave-other=4
  - Duration errors (415): beamed-subdivision=320, onset-coupled=90, too-long=4, too-short=1
  - Detection: chord-grouping=5476, missing-notes=2775, extra-notes=2375
  - Error buckets: chord=5476, extra/missing-notes=5150, pitch=1011, slurs=797, onset=749, duration=415, rests=299, ties=157, accidentals=123
  - Largest remaining error bucket: chord = 5476 (39%)
  Rhythm/voice attribution (V2 Phase 1):
  - chord-grouping-symptom: 2496
  - pitch-grouping-symptom: 920
  - onset-phase-shift: 636
  - voice-serialization-shift: 119
  - onset-coupled-duration: 90
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - serialization-artifact: 184
  - written-duration-wrong: 141
  - onset-coupled-duration: 90
  - Dominant: serialization-artifact (184)
  - Hotspot duration traces:
    - m3: 6 wrong durations (written-duration-wrong=3, serialization-artifact=3)
    - m5: 3 wrong durations (written-duration-wrong=3)
    - m6: 3 wrong durations (written-duration-wrong=1, serialization-artifact=2)
    - m7: 1 wrong durations (written-duration-wrong=1)
    - m9: 6 wrong durations (written-duration-wrong=3, onset-coupled-duration=1, serialization-artifact=2)
    - m10: 3 wrong durations (written-duration-wrong=2, serialization-artifact=1)
    - m11: 2 wrong durations (written-duration-wrong=2)
    - m13: 2 wrong durations (onset-coupled-duration=2)
    - m14: 2 wrong durations (onset-coupled-duration=2)
    - m15: 1 wrong durations (serialization-artifact=1)
    - m17: 2 wrong durations (onset-coupled-duration=2)
    - m18: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m19: 6 wrong durations (written-duration-wrong=2, onset-coupled-duration=2, serialization-artifact=2)
    - m20: 2 wrong durations (serialization-artifact=2)
    - m21: 9 wrong durations (written-duration-wrong=2, onset-coupled-duration=7)
    - m22: 5 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=3)
    - m23: 4 wrong durations (written-duration-wrong=3, serialization-artifact=1)
    - m24: 5 wrong durations (onset-coupled-duration=2, serialization-artifact=3)
    - m25: 5 wrong durations (written-duration-wrong=1, onset-coupled-duration=2, serialization-artifact=2)
    - m26: 4 wrong durations (onset-coupled-duration=3, serialization-artifact=1)
    - m27: 1 wrong durations (written-duration-wrong=1)
    - m29: 4 wrong durations (onset-coupled-duration=2, serialization-artifact=2)
    - m31: 4 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=2)
    - m32: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m33: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m34: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m35: 6 wrong durations (written-duration-wrong=4, onset-coupled-duration=1, serialization-artifact=1)
    - m36: 4 wrong durations (written-duration-wrong=2, serialization-artifact=2)
    - m37: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=2)
    - m38: 4 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=2)
    - m39: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m40: 4 wrong durations (written-duration-wrong=1, serialization-artifact=3)
    - m41: 5 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=2)
    - m42: 5 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=3)
    - m43: 3 wrong durations (onset-coupled-duration=2, serialization-artifact=1)
    - m44: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=1)
    - m47: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m48: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m49: 1 wrong durations (serialization-artifact=1)
    - m50: 9 wrong durations (written-duration-wrong=1, onset-coupled-duration=4, serialization-artifact=4)
    - m51: 5 wrong durations (written-duration-wrong=1, serialization-artifact=4)
    - m52: 4 wrong durations (written-duration-wrong=1, onset-coupled-duration=2, serialization-artifact=1)
    - m53: 6 wrong durations (written-duration-wrong=4, serialization-artifact=2)
    - m54: 5 wrong durations (onset-coupled-duration=1, serialization-artifact=4)
    - m55: 8 wrong durations (written-duration-wrong=3, serialization-artifact=5)
    - m57: 6 wrong durations (onset-coupled-duration=1, serialization-artifact=5)
    - m58: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m59: 3 wrong durations (serialization-artifact=3)
    - m60: 1 wrong durations (serialization-artifact=1)
    - m61: 1 wrong durations (serialization-artifact=1)
    - m62: 4 wrong durations (serialization-artifact=4)
    - m63: 1 wrong durations (serialization-artifact=1)
    - m67: 6 wrong durations (written-duration-wrong=3, onset-coupled-duration=3)
    - m68: 5 wrong durations (serialization-artifact=5)
    - m69: 1 wrong durations (serialization-artifact=1)
    - m70: 9 wrong durations (written-duration-wrong=6, onset-coupled-duration=1, serialization-artifact=2)
    - m71: 6 wrong durations (written-duration-wrong=4, serialization-artifact=2)
    - m72: 8 wrong durations (written-duration-wrong=3, onset-coupled-duration=2, serialization-artifact=3)
    - m73: 5 wrong durations (written-duration-wrong=2, serialization-artifact=3)
    - m74: 5 wrong durations (written-duration-wrong=1, serialization-artifact=4)
    - m75: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=1)
    - m76: 6 wrong durations (serialization-artifact=6)
    - m77: 7 wrong durations (written-duration-wrong=3, onset-coupled-duration=2, serialization-artifact=2)
    - m78: 5 wrong durations (written-duration-wrong=3, serialization-artifact=2)
    - m79: 1 wrong durations (written-duration-wrong=1)
    - m80: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m81: 2 wrong durations (written-duration-wrong=2)
    - m82: 3 wrong durations (written-duration-wrong=2, onset-coupled-duration=1)
    - m83: 5 wrong durations (written-duration-wrong=3, serialization-artifact=2)
    - m85: 11 wrong durations (written-duration-wrong=4, serialization-artifact=7)
    - m86: 7 wrong durations (written-duration-wrong=1, serialization-artifact=6)
    - m87: 5 wrong durations (onset-coupled-duration=2, serialization-artifact=3)
    - m88: 5 wrong durations (serialization-artifact=5)
    - m89: 6 wrong durations (written-duration-wrong=1, serialization-artifact=5)
    - m90: 6 wrong durations (written-duration-wrong=3, onset-coupled-duration=3)
    - m91: 6 wrong durations (written-duration-wrong=2, onset-coupled-duration=2, serialization-artifact=2)
    - m92: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m94: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m95: 4 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=2)
    - m96: 3 wrong durations (serialization-artifact=3)
    - m97: 1 wrong durations (written-duration-wrong=1)
    - m98: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=1)
    - m99: 1 wrong durations (written-duration-wrong=1)
    - m100: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=1)
    - m101: 3 wrong durations (onset-coupled-duration=1, serialization-artifact=2)
    - m102: 4 wrong durations (written-duration-wrong=1, onset-coupled-duration=3)
    - m103: 1 wrong durations (serialization-artifact=1)
    - m104: 4 wrong durations (written-duration-wrong=2, serialization-artifact=2)
    - m105: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m106: 4 wrong durations (written-duration-wrong=1, serialization-artifact=3)
    - m107: 1 wrong durations (written-duration-wrong=1)
    - m108: 2 wrong durations (serialization-artifact=2)
    - m110: 2 wrong durations (serialization-artifact=2)
    - m111: 3 wrong durations (onset-coupled-duration=3)
    - m112: 4 wrong durations (onset-coupled-duration=2, serialization-artifact=2)
    - m113: 5 wrong durations (written-duration-wrong=3, serialization-artifact=2)
    - m114: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=2)
    - m116: 3 wrong durations (written-duration-wrong=2, onset-coupled-duration=1)
    - m117: 1 wrong durations (written-duration-wrong=1)
    - m119: 2 wrong durations (serialization-artifact=2)
    - m120: 1 wrong durations (written-duration-wrong=1)
    - m121: 3 wrong durations (written-duration-wrong=1, serialization-artifact=2)
    - m122: 4 wrong durations (written-duration-wrong=2, serialization-artifact=2)
    - m123: 3 wrong durations (onset-coupled-duration=1, serialization-artifact=2)
    - m124: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=1)
    - m125: 1 wrong durations (written-duration-wrong=1)
    - m127: 1 wrong durations (written-duration-wrong=1)
    - m128: 1 wrong durations (onset-coupled-duration=1)
    - m129: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m131: 1 wrong durations (written-duration-wrong=1)
    - m132: 1 wrong durations (written-duration-wrong=1)
    - m133: 4 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=2)
    - m134: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m135: 3 wrong durations (written-duration-wrong=3)
    - m136: 1 wrong durations (written-duration-wrong=1)
    - m137: 1 wrong durations (written-duration-wrong=1)
    - m139: 1 wrong durations (written-duration-wrong=1)
    - m140: 2 wrong durations (written-duration-wrong=2)
  Tie/sustain constraints (V2 Phase 4):
  - slur-like-arc-pitch-differs: 157
  - tie-start-without-continuation: 85
  - continuation-without-tie-start: 24
  - written-correct-sustain-wrong: 23
  - Dominant: slur-like-arc-pitch-differs (157)
  - Tie glyphs: detected 231, applied 74, slur-like rejected 157, unresolved 0

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 193 candidates / 193 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 749 → 749 (Δ 0), wrongDuration 415 → 415 (Δ 0), chord 5476 → 5476 (Δ 0)
- Rejected candidates: m1:chord-split, m2:duration-changed+chord-split, m3:duration-changed+chord-split+onset-group-regression, m4:duration-changed, m5:constraints-failed, m6:constraints-failed, m7:constraints-failed, m8:constraints-failed…

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **diagnostic-only**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Solver: 8 structurally applied (8 duration-coupled) / 2 truth-approved / 146 candidates
- Runtime vs shadow: wrongOnset 749 → 745 (Δ -4), wrongDuration 415 → 408 (Δ -7), chord 5476 → 5472 (Δ -4)
- Accepted measures: m50:accompaniment-adaptive-phase-coupled, m119:accompaniment-adaptive-phase-coupled
- Rejected measures: m1:constraints-failed, m2:constraints-failed, m3:constraints-failed, m5:constraints-failed, m6:constraints-failed, m8:constraints-failed, m9:no-improvement, m10:constraints-failed…
  ScoreGraph IR (observation): 8507 nodes, 15786 edges across 235 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 16 underfill measure(s)
  IR duration split: 54 node(s) sounding≠written; 1583 tie; 46 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

## Top error categories (across fixtures)
- measure-allocation: 3
- rhythm-inference: 2

## Aggregated duration error histogram
- beamed-subdivision: 616
- onset-coupled: 221
- too-short: 29
- too-long: 13

## Aggregated pitch error histogram
- other: 2179
- ±1-accidental: 450
- ±2-diatonic: 367
- ±octave: 338
- ±octave-other: 13

## Error buckets (across fixtures)
Buckets: pitch, duration, onset, chord, ties, slurs, tuplets, accidentals, rests, extra/missing notes
- chord: 8346
- extra/missing-notes: 7186
- pitch: 3347
- slurs: 2662
- onset: 2375
- duration: 879
- rests: 636
- ties: 477
- accidentals: 450
- **Largest remaining error bucket: chord = 8346 (32% of counted errors)**

## Tier breakdown
- clean: 1 fixture(s) (pass=1)
- dense: 1 fixture(s) (pass=1)
- extreme: 2 fixture(s) (skipped=2)
- simple: 1 fixture(s) (pass=1)

## V2 rollout gate
V2 rollout gate (Phase 5):
- Recommended: **voice-aware-serialization** (composite 2.65)
- Parallel prep: onset-grid-refinement
- Target ranking:
  - onset-grid-refinement: composite=4.1, status=eligible-prep
  - written-sounding-duration-solver: composite=3.25, status=blocked-premature
  - tie-sustain-constraint-solver: composite=3.2, status=blocked-premature
  - voice-aware-serialization: composite=2.65, status=recommended
  - measure-level-solver-variant: composite=1.85, status=blocked-exhausted
- Blocked:
  - written-sounding-duration-solver (blocked-premature): 44 onset-coupled duration errors cannot be fixed until onsets/voices are stable.
  - tie-sustain-constraint-solver (blocked-premature): Most sustain deficits are downstream of wrong onsets/voices, not missing tie glyphs.
  - measure-level-solver-variant (blocked-exhausted): Clef-only phase-shift family exhausted: 0 changed, 0 truth-approved on dense.
- Frozen baseline: MATCH

## Voice serialization qualification (Phase 6B)
**NO — zero truth-approved measures on live enforced fixtures.**
Voice serialization qualification (Phase 7):
- Verdict: Blocker is hard constraints (voice overlap) — duration coupling insufficient; inspect gapToNextOnset IR or multi-voice overlap.
- Truth-approved: 0 | Structural: 0
- Global shadow Δ: wrongOnset 0, wrongDuration 0, chord 0
Voice serialization qualification (Phase 7):
- Verdict: Blocker is hard constraints (voice overlap) — duration coupling insufficient; inspect gapToNextOnset IR or multi-voice overlap.
- Truth-approved: 0 | Structural: 0
- Hotspots:
  - m7: structurally-rejected (hard-constraints) onsetΔ0
  - m9: structurally-rejected (hard-constraints) onsetΔ0
  - m121: structurally-rejected (hard-constraints) onsetΔ0
- Global shadow Δ: wrongOnset 0, wrongDuration 0, chord 0
Voice serialization qualification (Phase 7):
- Verdict: No structural candidates on live fixtures — extend lane detection or onset-column IR.
- Truth-approved: 0 | Structural: 0
- Hotspots:
  - m10: structurally-rejected (hard-constraints) onsetΔ0
- Global shadow Δ: wrongOnset 0, wrongDuration 0, chord 0
