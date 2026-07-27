# OMR benchmark dashboard

Generated: 2026-07-17T15:00:38.523Z
Fixtures: 3
Overall: PASS
Largest remaining error bucket: chord = 294 (31%)

## Status
- pass: 3
- fail: 0
- rejected: 0
- skipped: 0
- error: 0

## Fixtures

### CC0 Beginner Line Study (`pass`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-beginner-single-vector/piano-beginner-single-vector.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-beginner-single-vector/piano-beginner-single-vector.musicxml`
- License: CC0-1.0 (piano-beginner-single-vector)
- Categories: clean-beginner-single-staff, rests-dotted-rhythms, eighth-notes, modern-vector-pdf
  pitch 25% | duration 88% | onset 84% | chord 94% | F1 97%
  measureΔ 0 | noteΔ 0 | wrongPitch 23 | wrongDuration 3 | wrongOnset 4 | chordMismatch 2
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: onset-coupled (2 sampled)
  top pitch error category: ±octave (7 sampled)
  - Primary: Rhythm inference (rhythm-inference, confidence 0.871)
  - Source scores: rhythm-inference=0.871, pitch-mapping=0.7048, measure-allocation=0.2481
  - Pitch errors (23): ±octave=7, ±1-accidental=6, ±2-diatonic=6, other=4
  - Duration errors (3): onset-coupled=2, too-short=1
  - Detection: chord-grouping=2, extra-notes=1, missing-notes=1
  - Error buckets: pitch=23, accidentals=6, onset=4, duration=3, chord=2, rests=2, extra/missing-notes=2
  - Largest remaining error bucket: pitch = 23 (55%)
  Rhythm/voice attribution (V2 Phase 1):
  - pitch-grouping-symptom: 5
  - onset-phase-shift: 4
  - voice-serialization-shift: 2
  - onset-coupled-duration: 2
  - chord-grouping-symptom: 2
  - balanced-missing-extra-serialization: 2
  - chord symptom coupled share: 100%
  - missing/extra balanced: 1/1
  Written vs sounding duration (V2 Phase 3):
  - onset-coupled-duration: 2
  - written-duration-wrong: 1
  - Dominant: onset-coupled-duration (2)
  - Hotspot duration traces:
    - m7: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m8: 1 wrong durations (onset-coupled-duration=1)
  Tie/sustain constraints (V2 Phase 4):
  - expected-cross-measure-tie: 1
  - sounding-release-too-short: 1
  - Dominant: expected-cross-measure-tie (1)
  - Tie glyphs: detected 0, applied 0, slur-like rejected 0, unresolved 0
  Pipeline attribution: pitch-inference
  - pitch-inference: 23 (23 wrong pitch match(es))
  - onset-rhythm-inference: 7 (3 duration; 4 onset error(s))
  - symbol-detection: 2 (1 missing; 1 extra note(s))
  - voice-serialization: 2 (2 chord/voice grouping mismatch(es))
  - measure hotspots: m8 pitch-inference (13), m7 onset-rhythm-inference (10), m4 pitch-inference (8), m2 pitch-inference (7), m5 pitch-inference (7), m6 pitch-inference (7), m1 pitch-inference (6), m3 pitch-inference (6)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 1 candidates / 1 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 4 → 4 (Δ 0), wrongDuration 3 → 3 (Δ 0), chord 2 → 2 (Δ 0)
- Rejected candidates: m8:no-improvement

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 0 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 4 → 4 (Δ 0), wrongDuration 3 → 3 (Δ 0), chord 2 → 2 (Δ 0)
  ScoreGraph IR (observation): 51 nodes, 97 edges across 8 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 0 node(s) sounding≠written; 14 tie; 0 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### CC0 Grand Staff Voice Study (`pass`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-grand-voices-vector/piano-grand-voices-vector.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-grand-voices-vector/piano-grand-voices-vector.musicxml`
- License: CC0-1.0 (piano-grand-voices-vector)
- Categories: grand-staff, chords-multiple-voices, ties-slurs-articulations, repeats-voltas, modern-vector-pdf
  pitch 63% | duration 82% | onset 98% | chord 98% | F1 99%
  measureΔ 0 | noteΔ 0 | wrongPitch 32 | wrongDuration 15 | wrongOnset 1 | chordMismatch 2
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: too-long (14 sampled)
  top pitch error category: ±1-accidental (12 sampled)
  - Primary: Rhythm inference (rhythm-inference, confidence 0.848)
  - Source scores: rhythm-inference=0.8483, pitch-mapping=0.3494, measure-allocation=0.2302
  - Pitch errors (32): ±1-accidental=12, ±2-diatonic=11, other=9
  - Duration errors (15): too-long=14, too-short=1
  - Detection: chord-grouping=2, extra-notes=1, missing-notes=1
  - Error buckets: slurs=40, pitch=32, duration=15, accidentals=12, chord=2, extra/missing-notes=2, onset=1, ties=1
  - Largest remaining error bucket: slurs = 40 (38%)
  Rhythm/voice attribution (V2 Phase 1):
  - pitch-grouping-symptom: 11
  - chord-grouping-symptom: 2
  - balanced-missing-extra-serialization: 2
  - onset-phase-shift: 1
  - chord symptom coupled share: 100%
  - missing/extra balanced: 1/1
  Written vs sounding duration (V2 Phase 3):
  - written-duration-wrong: 14
  - serialization-artifact: 1
  - Dominant: written-duration-wrong (14)
  - Hotspot duration traces:
    - m1: 2 wrong durations (written-duration-wrong=2)
    - m2: 2 wrong durations (written-duration-wrong=2)
    - m3: 2 wrong durations (written-duration-wrong=2)
    - m4: 2 wrong durations (written-duration-wrong=2)
    - m5: 1 wrong durations (serialization-artifact=1)
    - m6: 2 wrong durations (written-duration-wrong=2)
    - m7: 2 wrong durations (written-duration-wrong=2)
    - m8: 2 wrong durations (written-duration-wrong=2)
  Tie/sustain constraints (V2 Phase 4):
  - written-correct-sustain-wrong: 7
  - slur-like-arc-pitch-differs: 1
  - Dominant: written-correct-sustain-wrong (7)
  - Tie glyphs: detected 1, applied 0, slur-like rejected 1, unresolved 0
  Pipeline attribution: pitch-inference
  - pitch-inference: 32 (32 wrong pitch match(es))
  - onset-rhythm-inference: 16 (15 duration; 1 onset error(s))
  - symbol-detection: 2 (1 missing; 1 extra note(s))
  - voice-serialization: 2 (2 chord/voice grouping mismatch(es))
  - measure hotspots: m5 pitch-inference (21), m6 pitch-inference (21), m7 pitch-inference (19), m8 pitch-inference (19), m3 pitch-inference (16), m2 pitch-inference (15), m4 pitch-inference (15), m1 onset-rhythm-inference (8)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 8 candidates / 8 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 1 → 1 (Δ 0), wrongDuration 15 → 15 (Δ 0), chord 2 → 2 (Δ 0)
- Rejected candidates: m1:constraints-failed, m2:constraints-failed, m3:constraints-failed, m4:constraints-failed, m5:constraints-failed, m6:constraints-failed, m7:constraints-failed, m8:constraints-failed

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 0 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 1 → 1 (Δ 0), wrongDuration 15 → 15 (Δ 0), chord 2 → 2 (Δ 0)
  ScoreGraph IR (observation): 163 nodes, 352 edges across 8 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 0 node(s) sounding≠written; 62 tie; 0 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### CC0 Dense Advanced Texture Study (`pass`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-dense-advanced-vector/piano-dense-advanced-vector.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-dense-advanced-vector/piano-dense-advanced-vector.musicxml`
- License: CC0-1.0 (piano-dense-advanced-vector)
- Categories: dense-advanced-score, grand-staff, chords-multiple-voices, eighth-sixteenth-rhythms, modern-vector-pdf
  pitch 15% | duration 39% | onset 33% | chord 29% | F1 46%
  measureΔ 11 | noteΔ -2 | wrongPitch 81 | wrongDuration 16 | wrongOnset 32 | chordMismatch 290
  top error category: Measure allocation (measure-allocation)
  top duration error category: too-short (9 sampled)
  top pitch error category: other (49 sampled)
  - Primary: Measure allocation (measure-allocation, confidence 1)
  - Source scores: measure-allocation=1, rhythm-inference=0.8775, pitch-mapping=0.6413, chord-grouping=0.6397, notehead-detection=0.6019
  - Pitch errors (81): other=49, ±1-accidental=19, ±2-diatonic=12, ±octave=1
  - Duration errors (16): too-short=9, onset-coupled=4, beamed-subdivision=3
  - Detection: chord-grouping=290, missing-notes=144, extra-notes=142
  - Error buckets: chord=290, extra/missing-notes=286, pitch=81, ties=47, slurs=46, onset=32, accidentals=19, duration=16
  - Largest remaining error bucket: chord = 290 (36%)
  Rhythm/voice attribution (V2 Phase 1):
  - chord-grouping-symptom: 106
  - pitch-grouping-symptom: 55
  - onset-phase-shift: 32
  - voice-serialization-shift: 8
  - onset-coupled-duration: 4
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - written-duration-wrong: 7
  - serialization-artifact: 5
  - onset-coupled-duration: 4
  - Dominant: written-duration-wrong (7)
  - Hotspot duration traces:
    - m1: 3 wrong durations (written-duration-wrong=3)
    - m2: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=2)
    - m3: 5 wrong durations (written-duration-wrong=1, serialization-artifact=4)
    - m4: 3 wrong durations (written-duration-wrong=2, onset-coupled-duration=1)
    - m5: 1 wrong durations (serialization-artifact=1)
    - m6: 1 wrong durations (onset-coupled-duration=1)
  Tie/sustain constraints (V2 Phase 4):
  - slur-like-arc-pitch-differs: 46
  - written-correct-sustain-wrong: 3
  - expected-cross-measure-tie: 1
  - sounding-release-too-short: 1
  - Dominant: slur-like-arc-pitch-differs (46)
  - Tie glyphs: detected 50, applied 3, slur-like rejected 46, unresolved 1
  Pipeline attribution: voice-serialization
  - voice-serialization: 290 (290 chord/voice grouping mismatch(es))
  - symbol-detection: 286 (144 missing; 142 extra note(s))
  - pitch-inference: 81 (81 wrong pitch match(es))
  - onset-rhythm-inference: 48 (16 duration; 32 onset error(s))
  - measure-barline-segmentation: 12 (measure count 19/8 (Δ11); 1 irregular system grid(s))
  - measure hotspots: m3 pitch-inference (76), m4 pitch-inference (70), m5 pitch-inference (67), m6 symbol-detection (67), m7 symbol-detection (66), m8 symbol-detection (65), m2 symbol-detection (64), m1 symbol-detection (63)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 14 candidates / 14 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 32 → 32 (Δ 0), wrongDuration 16 → 16 (Δ 0), chord 290 → 290 (Δ 0)
- Rejected candidates: m2:duration-changed+chord-split, m3:duration-changed+chord-split, m4:duration-changed+chord-split+onset-group-regression, m5:duration-changed+chord-split+onset-group-regression, m6:duration-changed+chord-split, m9:constraints-failed, m12:constraints-failed, m13:duration-changed+chord-split…

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 13 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 32 → 32 (Δ 0), wrongDuration 16 → 16 (Δ 0), chord 290 → 290 (Δ 0)
- Rejected measures: m2:constraints-failed, m3:constraints-failed, m4:constraints-failed, m5:constraints-failed, m9:constraints-failed, m12:constraints-failed, m13:constraints-failed, m14:constraints-failed…
  ScoreGraph IR (observation): 516 nodes, 1004 edges across 19 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 1 underfill measure(s)
  IR duration split: 5 node(s) sounding≠written; 91 tie; 3 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

## Top error categories (across fixtures)
- rhythm-inference: 2
- measure-allocation: 1

## Aggregated duration error histogram
- too-long: 14
- too-short: 11
- onset-coupled: 6
- beamed-subdivision: 3

## Aggregated pitch error histogram
- other: 62
- ±1-accidental: 37
- ±2-diatonic: 29
- ±octave: 8

## Error buckets (across fixtures)
Buckets: pitch, duration, onset, chord, ties, slurs, tuplets, accidentals, rests, extra/missing notes
- chord: 294
- extra/missing-notes: 290
- pitch: 136
- slurs: 86
- ties: 48
- accidentals: 37
- onset: 37
- duration: 34
- rests: 2
- **Largest remaining error bucket: chord = 294 (31% of counted errors)**

## Tier breakdown
- piano-clean: 1 fixture(s) (pass=1)
- piano-dense: 1 fixture(s) (pass=1)
- piano-grand: 1 fixture(s) (pass=1)

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
  - written-sounding-duration-solver (blocked-premature): 0 onset-coupled duration errors cannot be fixed until onsets/voices are stable.
  - tie-sustain-constraint-solver (blocked-premature): Most sustain deficits are downstream of wrong onsets/voices, not missing tie glyphs.
  - measure-level-solver-variant (blocked-exhausted): Clef-only phase-shift family exhausted: 0 changed, 0 truth-approved on dense.

## Voice serialization qualification (Phase 6B)
**NO — zero truth-approved measures on live enforced fixtures.**
Voice serialization qualification (Phase 6b):
- Verdict: Re-run live dashboard with includeScoreGraph and truth MXL.
- Truth-approved: 0 | Structural: 0
Voice serialization qualification (Phase 6b):
- Verdict: Re-run live dashboard with includeScoreGraph and truth MXL.
- Truth-approved: 0 | Structural: 0
Voice serialization qualification (Phase 6b):
- Verdict: Re-run live dashboard with includeScoreGraph and truth MXL.
- Truth-approved: 0 | Structural: 0
