# OMR benchmark dashboard

Generated: 2026-07-17T01:56:25.903Z
Fixtures: 1
Overall: FAIL
Largest remaining error bucket: chord = 57 (28%)

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
  pitch 31% | duration 49% | onset 54% | chord 54% | F1 83%
  measureΔ 0 | noteΔ 17 | wrongPitch 47 | wrongDuration 29 | wrongOnset 23 | chordMismatch 57
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: too-short (22 sampled)
  top pitch error category: other (23 sampled)
  - Primary: Rhythm inference (rhythm-inference, confidence 0.866)
  - Source scores: rhythm-inference=0.8663, pitch-mapping=0.5581, chord-grouping=0.4104, measure-allocation=0.3528, notehead-detection=0.3024
  - Pitch errors (47): other=23, ±1-accidental=14, ±2-diatonic=10
  - Duration errors (29): too-short=22, onset-coupled=7
  - Detection: chord-grouping=57, extra-notes=25, missing-notes=8
  - Error buckets: chord=57, pitch=47, extra/missing-notes=33, duration=29, onset=23, accidentals=14
  - Largest remaining error bucket: chord = 57 (28%)
  Rhythm/voice attribution (V2 Phase 1):
  - pitch-grouping-symptom: 30
  - chord-grouping-symptom: 28
  - onset-phase-shift: 23
  - onset-coupled-duration: 7
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - written-duration-wrong: 17
  - onset-coupled-duration: 7
  - serialization-artifact: 5
  - Dominant: written-duration-wrong (17)
  - Hotspot duration traces:
    - m1: 3 wrong durations (written-duration-wrong=1, onset-coupled-duration=1, serialization-artifact=1)
    - m2: 4 wrong durations (written-duration-wrong=4)
    - m3: 2 wrong durations (onset-coupled-duration=2)
    - m4: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m5: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m6: 4 wrong durations (written-duration-wrong=4)
    - m7: 4 wrong durations (written-duration-wrong=2, serialization-artifact=2)
    - m8: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=2)
  Tie/sustain constraints (V2 Phase 4):
  - expected-cross-measure-tie: 13
  - sounding-release-too-short: 13
  - written-correct-sustain-wrong: 7
  - Dominant: expected-cross-measure-tie (13)
  - Tie glyphs: detected 0, applied 0, slur-like rejected 0, unresolved 0
  Pipeline attribution: voice-serialization
  - voice-serialization: 57 (57 chord/voice grouping mismatch(es))
  - onset-rhythm-inference: 52 (29 duration; 23 onset error(s))
  - pitch-inference: 47 (47 wrong pitch match(es))
  - symbol-detection: 33 (8 missing; 25 extra note(s))
  - tie-repeat-handling: 1 (0 tie candidate(s); 0 applied)
  - measure hotspots: m7 onset-rhythm-inference (39), m5 voice-serialization (38), m6 pitch-inference (36), m8 onset-rhythm-inference (36), m4 onset-rhythm-inference (34), m2 symbol-detection (32), m3 pitch-inference (27), m1 voice-serialization (24)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 4 candidates / 4 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 23 → 23 (Δ 0), wrongDuration 29 → 29 (Δ 0), chord 57 → 57 (Δ 0)
- Rejected candidates: m1:chord-split, m2:chord-split, m4:chord-split, m5:chord-split

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 8 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 23 → 23 (Δ 0), wrongDuration 29 → 29 (Δ 0), chord 57 → 57 (Δ 0)
- Rejected measures: m1:constraints-failed, m2:constraints-failed, m3:constraints-failed, m4:constraints-failed, m5:constraints-failed, m6:constraints-failed, m7:constraints-failed, m8:constraints-failed
  ScoreGraph IR (observation): 125 nodes, 231 edges across 8 measures; geometry bridge n/a
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 2 node(s) sounding≠written; 45 tie; 0 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok
- reasons: pitchAccuracy: 0.3143 (need ≥0.3153); onsetAccuracy: 0.5429 (need ≥0.6126); chordGroupingAccuracy: 0.544 (need ≥0.6048)

## Top error categories (across fixtures)
- rhythm-inference: 1

## Aggregated duration error histogram
- too-short: 22
- onset-coupled: 7

## Aggregated pitch error histogram
- other: 23
- ±1-accidental: 14
- ±2-diatonic: 10

## Error buckets (across fixtures)
Buckets: pitch, duration, onset, chord, ties, slurs, tuplets, accidentals, rests, extra/missing notes
- chord: 57
- pitch: 47
- extra/missing-notes: 33
- duration: 29
- onset: 23
- accidentals: 14
- **Largest remaining error bucket: chord = 57 (28% of counted errors)**

## Tier breakdown
- piano-scan: 1 fixture(s) (fail=1)
  failing: piano-articulation-scan

## Failure clusters
- fail | source=rhythm-inference | duration=too-short | pitch=other: piano-articulation-scan
  reasons: pitchAccuracy: 0.3143 (need ≥0.3153); onsetAccuracy: 0.5429 (need ≥0.6126); chordGroupingAccuracy: 0.544 (need ≥0.6048)

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
