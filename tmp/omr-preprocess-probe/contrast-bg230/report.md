# OMR benchmark dashboard

Generated: 2026-07-17T01:58:24.960Z
Fixtures: 1
Overall: FAIL
Largest remaining error bucket: chord = 48 (26%)

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
  pitch 31% | duration 46% | onset 62% | chord 61% | F1 81%
  measureΔ 0 | noteΔ 24 | wrongPitch 46 | wrongDuration 29 | wrongOnset 12 | chordMismatch 48
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: too-short (26 sampled)
  top pitch error category: other (22 sampled)
  - Primary: Rhythm inference (rhythm-inference, confidence 0.867)
  - Source scores: rhythm-inference=0.8667, pitch-mapping=0.5395, notehead-detection=0.358, chord-grouping=0.3484, measure-allocation=0.3222
  - Pitch errors (46): other=22, ±1-accidental=13, ±2-diatonic=11
  - Duration errors (29): too-short=26, onset-coupled=3
  - Detection: chord-grouping=48, extra-notes=31, missing-notes=7
  - Error buckets: chord=48, pitch=46, extra/missing-notes=38, duration=29, accidentals=13, onset=12
  - Largest remaining error bucket: chord = 48 (26%)
  Rhythm/voice attribution (V2 Phase 1):
  - chord-grouping-symptom: 24
  - pitch-grouping-symptom: 22
  - onset-phase-shift: 12
  - onset-coupled-duration: 3
  - chord symptom coupled share: 100%
  Written vs sounding duration (V2 Phase 3):
  - written-duration-wrong: 23
  - onset-coupled-duration: 3
  - serialization-artifact: 3
  - Dominant: written-duration-wrong (23)
  - Hotspot duration traces:
    - m1: 3 wrong durations (written-duration-wrong=3)
    - m2: 4 wrong durations (written-duration-wrong=4)
    - m3: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m4: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m5: 4 wrong durations (written-duration-wrong=4)
    - m6: 4 wrong durations (written-duration-wrong=4)
    - m7: 4 wrong durations (written-duration-wrong=2, onset-coupled-duration=1, serialization-artifact=1)
    - m8: 4 wrong durations (written-duration-wrong=4)
  Tie/sustain constraints (V2 Phase 4):
  - expected-cross-measure-tie: 13
  - sounding-release-too-short: 13
  - written-correct-sustain-wrong: 11
  - Dominant: expected-cross-measure-tie (13)
  - Tie glyphs: detected 0, applied 0, slur-like rejected 0, unresolved 0
  Pipeline attribution: voice-serialization
  - voice-serialization: 48 (48 chord/voice grouping mismatch(es))
  - pitch-inference: 46 (46 wrong pitch match(es))
  - onset-rhythm-inference: 41 (29 duration; 12 onset error(s))
  - symbol-detection: 38 (7 missing; 31 extra note(s))
  - tie-repeat-handling: 1 (0 tie candidate(s); 0 applied)
  - measure hotspots: m7 voice-serialization (39), m2 symbol-detection (36), m6 pitch-inference (36), m8 pitch-inference (34), m4 onset-rhythm-inference (33), m5 pitch-inference (29), m3 pitch-inference (28), m1 symbol-detection (16)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 4 candidates / 4 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 12 → 12 (Δ 0), wrongDuration 29 → 29 (Δ 0), chord 48 → 48 (Δ 0)
- Rejected candidates: m1:chord-split, m4:chord-split, m5:chord-split, m8:chord-split

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 8 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 12 → 12 (Δ 0), wrongDuration 29 → 29 (Δ 0), chord 48 → 48 (Δ 0)
- Rejected measures: m1:constraints-failed, m2:constraints-failed, m3:constraints-failed, m4:constraints-failed, m5:constraints-failed, m6:constraints-failed, m7:constraints-failed, m8:constraints-failed
  ScoreGraph IR (observation): 123 nodes, 244 edges across 8 measures; geometry bridge n/a
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 0 node(s) sounding≠written; 47 tie; 0 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok
- reasons: pitchAccuracy: 0.3125 (need ≥0.3153); durationAccuracy: 0.4643 (need ≥0.4685); noteCountDiff: 24 (need |diff|≤23)

## Top error categories (across fixtures)
- rhythm-inference: 1

## Aggregated duration error histogram
- too-short: 26
- onset-coupled: 3

## Aggregated pitch error histogram
- other: 22
- ±1-accidental: 13
- ±2-diatonic: 11

## Error buckets (across fixtures)
Buckets: pitch, duration, onset, chord, ties, slurs, tuplets, accidentals, rests, extra/missing notes
- chord: 48
- pitch: 46
- extra/missing-notes: 38
- duration: 29
- accidentals: 13
- onset: 12
- **Largest remaining error bucket: chord = 48 (26% of counted errors)**

## Tier breakdown
- piano-scan: 1 fixture(s) (fail=1)
  failing: piano-articulation-scan

## Failure clusters
- fail | source=rhythm-inference | duration=too-short | pitch=other: piano-articulation-scan
  reasons: pitchAccuracy: 0.3125 (need ≥0.3153); durationAccuracy: 0.4643 (need ≥0.4685); noteCountDiff: 24 (need |diff|≤23)

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
