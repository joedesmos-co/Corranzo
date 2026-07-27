# OMR benchmark dashboard

Generated: 2026-07-17T13:35:13.511Z
Fixtures: 4
Overall: PASS
Largest remaining error bucket: chord = 203 (32%)

## Status
- pass: 4
- fail: 0
- rejected: 0
- skipped: 0
- error: 0

## Fixtures

### CC0 Sparse TAB Technique Study (`pass`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/guitar-tab-sparse-vector/guitar-tab-sparse-vector.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/guitar-tab-sparse-vector/guitar-tab-sparse-vector.musicxml`
- License: CC0-1.0 (guitar-tab-sparse-vector)
- Categories: tab-only, multi-digit-frets, techniques, sparse-layout, capo-repeat-coda, vector-pdf
  pitch 70% | duration 73% | onset 57% | chord 80% | F1 89%
  measureΔ 0 | noteΔ 8 | wrongPitch 4 | wrongDuration 3 | wrongOnset 9 | chordMismatch 8
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: onset-coupled (2 sampled)
  top pitch error category: other (3 sampled)
  - Primary: Rhythm inference (rhythm-inference, confidence 0.816)
  - Source scores: rhythm-inference=0.8156, measure-allocation=0.2763, notehead-detection=0.27, chord-grouping=0.18, pitch-mapping=0.1188
  - Pitch errors (4): other=3, ±1-accidental=1
  - Duration errors (3): onset-coupled=2, too-short=1
  - Detection: chord-grouping=8, extra-notes=8
  - Error buckets: onset=9, chord=8, extra/missing-notes=8, pitch=4, duration=3, accidentals=1
  - Largest remaining error bucket: onset = 9 (27%)
  Rhythm/voice attribution (V2 Phase 1):
  - onset-phase-shift: 9
  - chord-grouping-symptom: 8
  - pitch-grouping-symptom: 4
  - onset-coupled-duration: 2
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - onset-coupled-duration: 2
  - serialization-artifact: 1
  - Dominant: onset-coupled-duration (2)
  - Hotspot duration traces:
    - m1: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m5: 1 wrong durations (onset-coupled-duration=1)
  Tie/sustain constraints (V2 Phase 4):
  - expected-cross-measure-tie: 2
  - sounding-release-too-short: 2
  - Dominant: expected-cross-measure-tie (2)
  - Tie glyphs: detected 0, applied 0, slur-like rejected 0, unresolved 0
  Pipeline attribution: onset-rhythm-inference
  - onset-rhythm-inference: 12 (3 duration; 9 onset error(s))
  - symbol-detection: 8 (0 missing; 8 extra note(s))
  - voice-serialization: 8 (8 chord/voice grouping mismatch(es))
  - pitch-inference: 4 (4 wrong pitch match(es))
  - tie-repeat-handling: 1 (0 tie candidate(s); 0 applied)
  - measure hotspots: m5 pitch-inference (10), m1 onset-rhythm-inference (9), m2 symbol-detection (7), m3 symbol-detection (7), m4 symbol-detection (7), m6 symbol-detection (7), m7 symbol-detection (7), m8 symbol-detection (7)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 0 candidates / 0 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 9 → 9 (Δ 0), wrongDuration 3 → 3 (Δ 0), chord 8 → 8 (Δ 0)

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 0 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 9 → 9 (Δ 0), wrongDuration 3 → 3 (Δ 0), chord 8 → 8 (Δ 0)
  ScoreGraph IR (observation): 40 nodes, 40 edges across 8 measures; geometry bridge n/a
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 0 node(s) sounding≠written; 0 tie; 2 gap-to-next
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

### CC0 Guitar Technique Pairing Study (`pass`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/guitar-techniques-paired-vector/guitar-techniques-paired-vector.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/guitar-techniques-paired-vector/guitar-techniques-paired-vector.musicxml`
- License: CC0-1.0 (guitar-techniques-paired-vector)
- Categories: paired-notation-tab, techniques-ties-slides-hammer-ons-pull-offs, double-stops, sparse-layout, vector-pdf
  pitch 3% | duration 50% | onset 66% | chord 54% | F1 70%
  measureΔ 4 | noteΔ -4 | wrongPitch 20 | wrongDuration 5 | wrongOnset 0 | chordMismatch 18
  top error category: Measure allocation (measure-allocation)
  top duration error category: too-long (5 sampled)
  top pitch error category: other (15 sampled)
  - Primary: Measure allocation (measure-allocation, confidence 1)
  - Source scores: measure-allocation=1, pitch-mapping=0.9048, rhythm-inference=0.8571, chord-grouping=0.4154, notehead-detection=0.4094
  - Pitch errors (20): other=15, ±octave=3, ±2-diatonic=2
  - Duration errors (5): too-long=5
  - Detection: chord-grouping=18, missing-notes=11, extra-notes=7
  - Error buckets: pitch=20, chord=18, extra/missing-notes=18, duration=5
  - Largest remaining error bucket: pitch = 20 (33%)
  Rhythm/voice attribution (V2 Phase 1):
  - chord-grouping-symptom: 18
  - pitch-grouping-symptom: 4
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - written-duration-wrong: 5
  - Dominant: written-duration-wrong (5)
  - Hotspot duration traces:
    - m2: 1 wrong durations (written-duration-wrong=1)
    - m3: 1 wrong durations (written-duration-wrong=1)
    - m4: 1 wrong durations (written-duration-wrong=1)
    - m5: 1 wrong durations (written-duration-wrong=1)
    - m8: 1 wrong durations (written-duration-wrong=1)
  Tie/sustain constraints (V2 Phase 4):
  - written-correct-sustain-wrong: 1
  - Dominant: written-correct-sustain-wrong (1)
  - Tie glyphs: detected 0, applied 0, slur-like rejected 0, unresolved 0
  Pipeline attribution: pitch-inference
  - pitch-inference: 20 (20 wrong pitch match(es))
  - symbol-detection: 18 (11 missing; 7 extra note(s))
  - voice-serialization: 18 (18 chord/voice grouping mismatch(es))
  - onset-rhythm-inference: 5 (5 duration; 0 onset error(s))
  - measure-barline-segmentation: 4 (measure count 12/8 (Δ4))
  - measure hotspots: m3 symbol-detection (9), m4 pitch-inference (9), m5 symbol-detection (9), m8 pitch-inference (9), m2 pitch-inference (8), m6 symbol-detection (8), m7 pitch-inference (8), m1 pitch-inference (7)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 0 candidates / 0 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 0 → 0 (Δ 0), wrongDuration 5 → 5 (Δ 0), chord 18 → 18 (Δ 0)

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 0 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 0 → 0 (Δ 0), wrongDuration 5 → 5 (Δ 0), chord 18 → 18 (Δ 0)
  ScoreGraph IR (observation): 41 nodes, 81 edges across 12 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 2 underfill measure(s)
  IR duration split: 0 node(s) sounding≠written; 12 tie; 0 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

## Top error categories (across fixtures)
- mixed: 2
- rhythm-inference: 1
- measure-allocation: 1

## Aggregated duration error histogram
- too-long: 23
- too-short: 20
- onset-coupled: 4

## Aggregated pitch error histogram
- other: 77
- ±octave: 16
- ±2-diatonic: 12
- ±1-accidental: 5

## Error buckets (across fixtures)
Buckets: pitch, duration, onset, chord, ties, slurs, tuplets, accidentals, rests, extra/missing notes
- chord: 203
- extra/missing-notes: 193
- pitch: 110
- duration: 47
- slurs: 45
- onset: 32
- accidentals: 5
- ties: 1
- **Largest remaining error bucket: chord = 203 (32% of counted errors)**

## Tier breakdown
- guitar-paired-dense: 1 fixture(s) (pass=1)
- guitar-paired-sparse: 1 fixture(s) (pass=1)
- guitar-standard: 1 fixture(s) (pass=1)
- guitar-tab: 1 fixture(s) (pass=1)

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
