# OMR benchmark dashboard

Generated: 2026-07-17T03:54:06.262Z
Fixtures: 1
Overall: PASS
Largest remaining error bucket: pitch = 23 (55%)

## Status
- pass: 1
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

## Top error categories (across fixtures)
- rhythm-inference: 1

## Aggregated duration error histogram
- onset-coupled: 2
- too-short: 1

## Aggregated pitch error histogram
- ±octave: 7
- ±1-accidental: 6
- ±2-diatonic: 6
- other: 4

## Error buckets (across fixtures)
Buckets: pitch, duration, onset, chord, ties, slurs, tuplets, accidentals, rests, extra/missing notes
- pitch: 23
- accidentals: 6
- onset: 4
- duration: 3
- chord: 2
- extra/missing-notes: 2
- rests: 2
- **Largest remaining error bucket: pitch = 23 (55% of counted errors)**

## Tier breakdown
- piano-clean: 1 fixture(s) (pass=1)

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
