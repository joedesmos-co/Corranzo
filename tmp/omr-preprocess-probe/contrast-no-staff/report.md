# OMR benchmark dashboard

Generated: 2026-07-17T01:57:56.766Z
Fixtures: 1
Overall: FAIL
Largest remaining error bucket: chord = 47 (26%)

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
  pitch 31% | duration 48% | onset 62% | chord 61% | F1 81%
  measureΔ 0 | noteΔ 21 | wrongPitch 46 | wrongDuration 28 | wrongOnset 12 | chordMismatch 47
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: too-short (25 sampled)
  top pitch error category: other (22 sampled)
  - Primary: Rhythm inference (rhythm-inference, confidence 0.866)
  - Source scores: rhythm-inference=0.8663, pitch-mapping=0.5462, chord-grouping=0.3467, notehead-detection=0.3408, measure-allocation=0.3301
  - Pitch errors (46): other=22, ±1-accidental=13, ±2-diatonic=11
  - Duration errors (28): too-short=25, onset-coupled=3
  - Detection: chord-grouping=47, extra-notes=29, missing-notes=8
  - Error buckets: chord=47, pitch=46, extra/missing-notes=37, duration=28, accidentals=13, onset=12
  - Largest remaining error bucket: chord = 47 (26%)
  Rhythm/voice attribution (V2 Phase 1):
  - chord-grouping-symptom: 24
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
  - voice-serialization: 47 (47 chord/voice grouping mismatch(es))
  - pitch-inference: 46 (46 wrong pitch match(es))
  - onset-rhythm-inference: 40 (28 duration; 12 onset error(s))
  - symbol-detection: 37 (8 missing; 29 extra note(s))
  - tie-repeat-handling: 1 (0 tie candidate(s); 0 applied)
  - measure hotspots: m7 voice-serialization (39), m6 pitch-inference (36), m2 symbol-detection (34), m4 onset-rhythm-inference (33), m8 pitch-inference (32), m5 pitch-inference (29), m3 pitch-inference (28), m1 symbol-detection (16)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 4 candidates / 4 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 12 → 12 (Δ 0), wrongDuration 28 → 28 (Δ 0), chord 47 → 47 (Δ 0)
- Rejected candidates: m1:chord-split, m4:chord-split, m5:chord-split, m8:chord-split

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 8 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 12 → 12 (Δ 0), wrongDuration 28 → 28 (Δ 0), chord 47 → 47 (Δ 0)
- Rejected measures: m1:constraints-failed, m2:constraints-failed, m3:constraints-failed, m4:constraints-failed, m5:constraints-failed, m6:constraints-failed, m7:constraints-failed, m8:constraints-failed
  ScoreGraph IR (observation): 120 nodes, 237 edges across 8 measures; geometry bridge n/a
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 0 node(s) sounding≠written; 46 tie; 0 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok
- reasons: pitchAccuracy: 0.3119 (need ≥0.3153)

## Top error categories (across fixtures)
- rhythm-inference: 1

## Aggregated duration error histogram
- too-short: 25
- onset-coupled: 3

## Aggregated pitch error histogram
- other: 22
- ±1-accidental: 13
- ±2-diatonic: 11

## Error buckets (across fixtures)
Buckets: pitch, duration, onset, chord, ties, slurs, tuplets, accidentals, rests, extra/missing notes
- chord: 47
- pitch: 46
- extra/missing-notes: 37
- duration: 28
- accidentals: 13
- onset: 12
- **Largest remaining error bucket: chord = 47 (26% of counted errors)**

## Tier breakdown
- piano-scan: 1 fixture(s) (fail=1)
  failing: piano-articulation-scan

## Failure clusters
- fail | source=rhythm-inference | duration=too-short | pitch=other: piano-articulation-scan
  reasons: pitchAccuracy: 0.3119 (need ≥0.3153)

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
