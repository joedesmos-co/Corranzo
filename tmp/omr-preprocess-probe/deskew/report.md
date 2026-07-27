# OMR benchmark dashboard

Generated: 2026-07-17T02:01:22.970Z
Fixtures: 1
Overall: FAIL
Largest remaining error bucket: chord = 49 (26%)

## Status
- pass: 0
- fail: 1
- rejected: 0
- skipped: 0
- error: 0

## Fixtures

### CC0 Articulation Scan Study (`fail`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.musicxml`
- License: CC0-1.0 (piano-articulation-scan)
- Categories: scanned-score, grand-staff, ties-slurs-articulations, chords-multiple-voices
  pitch 34% | duration 47% | onset 60% | chord 60% | F1 80%
  measureΔ 0 | noteΔ 21 | wrongPitch 42 | wrongDuration 28 | wrongOnset 14 | chordMismatch 49
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: too-short (22 sampled)
  top pitch error category: other (17 sampled)
  - Primary: Rhythm inference (rhythm-inference, confidence 0.843)
  - Source scores: rhythm-inference=0.843, pitch-mapping=0.5051, chord-grouping=0.3586, notehead-detection=0.3509, measure-allocation=0.3452
  - Pitch errors (42): other=17, ±1-accidental=13, ±2-diatonic=11, ±octave=1
  - Duration errors (28): too-short=22, onset-coupled=6
  - Detection: chord-grouping=49, extra-notes=30, missing-notes=9
  - Error buckets: chord=49, pitch=42, extra/missing-notes=39, duration=28, onset=14, accidentals=13
  - Largest remaining error bucket: chord = 49 (26%)
  Rhythm/voice attribution (V2 Phase 1):
  - chord-grouping-symptom: 21
  - pitch-grouping-symptom: 19
  - onset-phase-shift: 14
  - onset-coupled-duration: 6
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - written-duration-wrong: 21
  - onset-coupled-duration: 6
  - serialization-artifact: 1
  - Dominant: written-duration-wrong (21)
  - Hotspot duration traces:
    - m1: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m2: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=2)
    - m3: 3 wrong durations (written-duration-wrong=2, onset-coupled-duration=1)
    - m4: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=2)
    - m5: 4 wrong durations (written-duration-wrong=4)
    - m6: 2 wrong durations (written-duration-wrong=2)
    - m7: 4 wrong durations (written-duration-wrong=4)
    - m8: 4 wrong durations (written-duration-wrong=4)
  Tie/sustain constraints (V2 Phase 4):
  - expected-cross-measure-tie: 16
  - sounding-release-too-short: 16
  - written-correct-sustain-wrong: 11
  - tie-start-without-continuation: 1
  - Dominant: expected-cross-measure-tie (16)
  - Tie glyphs: detected 0, applied 0, slur-like rejected 0, unresolved 0
  Pipeline attribution: voice-serialization
  - voice-serialization: 49 (49 chord/voice grouping mismatch(es))
  - pitch-inference: 42 (42 wrong pitch match(es))
  - onset-rhythm-inference: 42 (28 duration; 14 onset error(s))
  - symbol-detection: 39 (9 missing; 30 extra note(s))
  - tie-repeat-handling: 1 (0 tie candidate(s); 0 applied)
  - measure hotspots: m4 voice-serialization (39), m6 symbol-detection (39), m8 symbol-detection (36), m7 pitch-inference (32), m5 pitch-inference (29), m2 onset-rhythm-inference (28), m3 onset-rhythm-inference (23), m1 onset-rhythm-inference (20)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-improved**
- Promoted: **no**
- Constraints: **phase-2c**
- Solver: 1 accepted / 4 candidates / 3 rejected
- Runtime vs shadow: wrongOnset 14 → 12 (Δ -2), wrongDuration 28 → 26 (Δ -2), chord 49 → 49 (Δ 0)
- Accepted measures: m1:bass-minus-2
- Rejected candidates: m4:chord-split, m5:chord-split, m8:chord-split

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 8 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 14 → 14 (Δ 0), wrongDuration 28 → 28 (Δ 0), chord 49 → 49 (Δ 0)
- Rejected measures: m1:no-improvement, m2:constraints-failed, m3:constraints-failed, m4:constraints-failed, m5:constraints-failed, m6:constraints-failed, m7:constraints-failed, m8:constraints-failed
  ScoreGraph IR (observation): 120 nodes, 242 edges across 8 measures; geometry bridge n/a
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 2 node(s) sounding≠written; 52 tie; 0 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok
- reasons: durationAccuracy: 0.4679 (need ≥0.4685); onsetAccuracy: 0.5963 (need ≥0.6126); chordGroupingAccuracy: 0.6016 (need ≥0.6048); noteDetectionF1: 0.802 (need ≥0.804)

## Top error categories (across fixtures)
- rhythm-inference: 1

## Aggregated duration error histogram
- too-short: 22
- onset-coupled: 6

## Aggregated pitch error histogram
- other: 17
- ±1-accidental: 13
- ±2-diatonic: 11
- ±octave: 1

## Error buckets (across fixtures)
Buckets: pitch, duration, onset, chord, ties, slurs, tuplets, accidentals, rests, extra/missing notes
- chord: 49
- pitch: 42
- extra/missing-notes: 39
- duration: 28
- onset: 14
- accidentals: 13
- **Largest remaining error bucket: chord = 49 (26% of counted errors)**

## Tier breakdown
- piano-scan: 1 fixture(s) (fail=1)
  failing: piano-articulation-scan

## Failure clusters
- fail | source=rhythm-inference | duration=too-short | pitch=other: piano-articulation-scan
  reasons: durationAccuracy: 0.4679 (need ≥0.4685); onsetAccuracy: 0.5963 (need ≥0.6126); chordGroupingAccuracy: 0.6016 (need ≥0.6048); noteDetectionF1: 0.802 (need ≥0.804)

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
