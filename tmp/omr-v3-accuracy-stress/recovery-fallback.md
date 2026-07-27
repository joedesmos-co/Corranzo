# OMR benchmark dashboard

Generated: 2026-07-17T03:19:08.761Z
Fixtures: 4
Overall: PASS
Largest remaining error bucket: chord = 516 (33%)

## Status
- pass: 4
- fail: 0
- rejected: 0
- skipped: 0
- error: 0

## Fixtures

### CC0 Articulation Scan Study (`pass`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.musicxml`
- License: CC0-1.0 (piano-articulation-scan)
- Categories: scanned-score, grand-staff, ties-slurs-articulations, chords-multiple-voices
  pitch 32% | duration 47% | onset 61% | chord 60% | F1 80%
  measureΔ 0 | noteΔ 23 | wrongPitch 45 | wrongDuration 28 | wrongOnset 12 | chordMismatch 49
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: too-short (25 sampled)
  top pitch error category: other (21 sampled)
  - Primary: Rhythm inference (rhythm-inference, confidence 0.866)
  - Source scores: rhythm-inference=0.8663, pitch-mapping=0.5344, notehead-detection=0.359, chord-grouping=0.3557, measure-allocation=0.3317
  - Pitch errors (45): other=21, ±1-accidental=13, ±2-diatonic=11
  - Duration errors (28): too-short=25, onset-coupled=3
  - Detection: chord-grouping=49, extra-notes=31, missing-notes=8
  - Error buckets: chord=49, pitch=45, extra/missing-notes=39, duration=28, accidentals=13, onset=12
  - Largest remaining error bucket: chord = 49 (26%)
  Rhythm/voice attribution (V2 Phase 1):
  - chord-grouping-symptom: 25
  - pitch-grouping-symptom: 21
  - onset-phase-shift: 12
  - onset-coupled-duration: 3
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - written-duration-wrong: 22
  - onset-coupled-duration: 3
  - serialization-artifact: 3
  - Dominant: written-duration-wrong (22)
  - Hotspot duration traces:
    - m1: 3 wrong durations (written-duration-wrong=3)
    - m2: 4 wrong durations (written-duration-wrong=4)
    - m3: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m4: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m5: 4 wrong durations (written-duration-wrong=4)
    - m6: 4 wrong durations (written-duration-wrong=4)
    - m7: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m8: 3 wrong durations (written-duration-wrong=3)
  Tie/sustain constraints (V2 Phase 4):
  - expected-cross-measure-tie: 13
  - sounding-release-too-short: 13
  - written-correct-sustain-wrong: 11
  - Dominant: expected-cross-measure-tie (13)
  - Tie glyphs: detected 0, applied 0, slur-like rejected 0, unresolved 0
  Pipeline attribution: voice-serialization
  - voice-serialization: 49 (49 chord/voice grouping mismatch(es))
  - pitch-inference: 45 (45 wrong pitch match(es))
  - onset-rhythm-inference: 40 (28 duration; 12 onset error(s))
  - symbol-detection: 39 (8 missing; 31 extra note(s))
  - tie-repeat-handling: 1 (0 tie candidate(s); 0 applied)
  - measure hotspots: m7 voice-serialization (39), m6 pitch-inference (38), m2 symbol-detection (34), m4 onset-rhythm-inference (34), m8 pitch-inference (32), m5 pitch-inference (29), m3 pitch-inference (28), m1 symbol-detection (16)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 4 candidates / 4 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 12 → 12 (Δ 0), wrongDuration 28 → 28 (Δ 0), chord 49 → 49 (Δ 0)
- Rejected candidates: m1:chord-split, m4:chord-split, m5:chord-split, m8:chord-split

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 8 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 12 → 12 (Δ 0), wrongDuration 28 → 28 (Δ 0), chord 49 → 49 (Δ 0)
- Rejected measures: m1:constraints-failed, m2:constraints-failed, m3:constraints-failed, m4:constraints-failed, m5:constraints-failed, m6:constraints-failed, m7:constraints-failed, m8:constraints-failed
  ScoreGraph IR (observation): 122 nodes, 242 edges across 8 measures; geometry bridge n/a
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 0 node(s) sounding≠written; 47 tie; 0 gap-to-next
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

### CC0 Standard Guitar Chord Study (`pass`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/guitar-standard-chords-vector/guitar-standard-chords-vector.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/guitar-standard-chords-vector/guitar-standard-chords-vector.musicxml`
- License: CC0-1.0 (guitar-standard-chords-vector)
- Categories: standard-notation-only, double-stops, three-to-six-note-chord-stacks, sparse-and-dense-layouts, vector-pdf
  pitch 0% | duration 16% | onset 14% | chord 21% | F1 35%
  measureΔ 8 | noteΔ -72 | wrongPitch 28 | wrongDuration 10 | wrongOnset 12 | chordMismatch 104
  top error category: Mixed errors (mixed)
  top duration error category: too-long (6 sampled)
  top pitch error category: other (21 sampled)
  - Primary: Mixed errors (mixed, confidence 1)
  - Source scores: measure-allocation=1, notehead-detection=0.9887, pitch-mapping=0.95, rhythm-inference=0.9, chord-grouping=0.7145
  - Pitch errors (28): other=21, ±octave=7
  - Duration errors (10): too-long=6, too-short=4
  - Detection: chord-grouping=104, missing-notes=87, extra-notes=15
  - Error buckets: chord=104, extra/missing-notes=102, pitch=28, onset=12, duration=10, slurs=8, ties=1
  - Largest remaining error bucket: chord = 104 (39%)
  Rhythm/voice attribution (V2 Phase 1):
  - chord-grouping-symptom: 50
  - pitch-grouping-symptom: 25
  - onset-phase-shift: 12
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - serialization-artifact: 6
  - written-duration-wrong: 4
  - Dominant: serialization-artifact (6)
  - Hotspot duration traces:
    - m1: 2 wrong durations (serialization-artifact=2)
    - m2: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m3: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m4: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
    - m8: 2 wrong durations (written-duration-wrong=1, serialization-artifact=1)
  Tie/sustain constraints (V2 Phase 4):
  - slur-like-arc-pitch-differs: 1
  - Dominant: slur-like-arc-pitch-differs (1)
  - Tie glyphs: detected 10, applied 9, slur-like rejected 1, unresolved 0
  Pipeline attribution: symbol-detection
  - symbol-detection: 111 (87 missing; 15 extra note(s); 9 rejected orphan candidate(s))
  - voice-serialization: 104 (104 chord/voice grouping mismatch(es))
  - pitch-inference: 28 (28 wrong pitch match(es))
  - onset-rhythm-inference: 22 (10 duration; 12 onset error(s))
  - measure-barline-segmentation: 8 (measure count 16/8 (Δ8))
  - measure hotspots: m8 symbol-detection (54), m4 symbol-detection (38), m7 measure-barline-segmentation (34), m3 symbol-detection (30), m1 pitch-inference (27), m6 measure-barline-segmentation (26), m2 pitch-inference (25), m5 measure-barline-segmentation (20)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 5 candidates / 5 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 12 → 12 (Δ 0), wrongDuration 10 → 10 (Δ 0), chord 104 → 104 (Δ 0)
- Rejected candidates: m1:duration-changed+chord-split, m2:duration-changed, m3:duration-changed, m4:duration-changed, m8:duration-changed

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 0 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 12 → 12 (Δ 0), wrongDuration 10 → 10 (Δ 0), chord 104 → 104 (Δ 0)
  ScoreGraph IR (observation): 94 nodes, 176 edges across 16 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 1 underfill measure(s)
  IR duration split: 12 node(s) sounding≠written; 31 tie; 0 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

### CC0 Paired Notation and TAB Study (`pass`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/guitar-paired-chords-vector/guitar-paired-chords-vector.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/guitar-paired-chords-vector/guitar-paired-chords-vector.musicxml`
- License: CC0-1.0 (guitar-paired-chords-vector)
- Categories: paired-notation-tab, three-to-six-note-chord-stacks, multi-digit-frets, dense-layout, capo-repeat-coda, vector-pdf
  pitch 11% | duration 36% | onset 52% | chord 48% | F1 69%
  measureΔ 2 | noteΔ -25 | wrongPitch 58 | wrongDuration 29 | wrongOnset 11 | chordMismatch 73
  top error category: Mixed errors (mixed)
  top duration error category: too-short (15 sampled)
  top pitch error category: other (38 sampled)
  - Primary: Mixed errors (mixed, confidence 0.849)
  - Source scores: rhythm-inference=0.8493, pitch-mapping=0.7761, measure-allocation=0.7209, notehead-detection=0.4806, chord-grouping=0.4693
  - Pitch errors (58): other=38, ±2-diatonic=10, ±octave=6, ±1-accidental=4
  - Duration errors (29): too-short=15, too-long=12, onset-coupled=2
  - Detection: chord-grouping=73, missing-notes=45, extra-notes=20
  - Error buckets: chord=73, extra/missing-notes=65, pitch=58, slurs=37, duration=29, onset=11, accidentals=4
  - Largest remaining error bucket: chord = 73 (26%)
  Rhythm/voice attribution (V2 Phase 1):
  - chord-grouping-symptom: 32
  - pitch-grouping-symptom: 26
  - onset-phase-shift: 11
  - onset-coupled-duration: 2
  - voice-serialization-shift: 1
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - written-duration-wrong: 17
  - serialization-artifact: 10
  - onset-coupled-duration: 2
  - Dominant: written-duration-wrong (17)
  - Hotspot duration traces:
    - m1: 10 wrong durations (written-duration-wrong=4, onset-coupled-duration=1, serialization-artifact=5)
    - m4: 2 wrong durations (written-duration-wrong=2)
    - m5: 3 wrong durations (written-duration-wrong=3)
    - m6: 4 wrong durations (written-duration-wrong=2, serialization-artifact=2)
    - m7: 8 wrong durations (written-duration-wrong=4, onset-coupled-duration=1, serialization-artifact=3)
    - m8: 2 wrong durations (written-duration-wrong=2)
  Tie/sustain constraints (V2 Phase 4):
  - written-correct-sustain-wrong: 3
  - expected-cross-measure-tie: 1
  - continuation-without-tie-start: 1
  - sounding-release-too-short: 1
  - Dominant: written-correct-sustain-wrong (3)
  - Tie glyphs: detected 0, applied 0, slur-like rejected 0, unresolved 0
  Pipeline attribution: symbol-detection
  - symbol-detection: 80 (45 missing; 20 extra note(s); 15 rejected orphan candidate(s))
  - voice-serialization: 73 (73 chord/voice grouping mismatch(es))
  - pitch-inference: 58 (58 wrong pitch match(es))
  - notation-tab-pairing: 45 (81 attached position(s); 10 unpaired notation note(s); 35 unused TAB digit(s))
  - onset-rhythm-inference: 40 (29 duration; 11 onset error(s))
  - measure hotspots: m7 onset-rhythm-inference (51), m3 pitch-inference (38), m1 onset-rhythm-inference (37), m8 symbol-detection (37), m6 symbol-detection (36), m4 symbol-detection (35), m2 pitch-inference (29), m5 pitch-inference (20)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 5 candidates / 5 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 11 → 11 (Δ 0), wrongDuration 29 → 29 (Δ 0), chord 73 → 73 (Δ 0)
- Rejected candidates: m1:duration-changed+chord-split, m3:chord-split+onset-group-regression, m4:constraints-failed, m6:onset-group-regression, m7:duration-changed+chord-split+onset-group-regression

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 4 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 11 → 11 (Δ 0), wrongDuration 29 → 29 (Δ 0), chord 73 → 73 (Δ 0)
- Rejected measures: m3:constraints-failed, m4:constraints-failed, m6:no-improvement, m7:constraints-failed
  ScoreGraph IR (observation): 169 nodes, 367 edges across 10 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 2 node(s) sounding≠written; 57 tie; 4 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

## Top error categories (across fixtures)
- mixed: 2
- rhythm-inference: 1
- measure-allocation: 1

## Aggregated duration error histogram
- too-short: 53
- too-long: 18
- onset-coupled: 9
- beamed-subdivision: 3

## Aggregated pitch error histogram
- other: 129
- ±1-accidental: 36
- ±2-diatonic: 33
- ±octave: 14

## Error buckets (across fixtures)
Buckets: pitch, duration, onset, chord, ties, slurs, tuplets, accidentals, rests, extra/missing notes
- chord: 516
- extra/missing-notes: 492
- pitch: 212
- slurs: 91
- duration: 83
- onset: 67
- ties: 48
- accidentals: 36
- **Largest remaining error bucket: chord = 516 (33% of counted errors)**

## Tier breakdown
- guitar-paired-dense: 1 fixture(s) (pass=1)
- guitar-standard: 1 fixture(s) (pass=1)
- piano-dense: 1 fixture(s) (pass=1)
- piano-scan: 1 fixture(s) (pass=1)

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
