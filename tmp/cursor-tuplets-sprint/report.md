# OMR benchmark dashboard

Generated: 2026-07-17T15:53:39.590Z
Fixtures: 1
Overall: PASS
Largest remaining error bucket: pitch = 30 (29%)

## Status
- pass: 1
- fail: 0
- rejected: 0
- skipped: 0
- error: 0

## Fixtures

### CC0 Rhythm and Tuplet Study (`pass`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.pdf`
- Truth: `/Users/ryland/Documents/scoreflow/benchmarks/omr-fixtures/piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.musicxml`
- License: CC0-1.0 (piano-rhythm-tuplets-vector)
- Categories: eighth-sixteenth-rhythms, tuplets, rests-dotted-rhythms, ties, modern-vector-pdf
  pitch 41% | duration 78% | onset 56% | chord 77% | F1 89%
  measureΔ 0 | noteΔ 0 | wrongPitch 30 | wrongDuration 7 | wrongOnset 21 | chordMismatch 16
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: beamed-subdivision (4 sampled)
  top pitch error category: other (18 sampled)
  - Primary: Rhythm inference (rhythm-inference, confidence 0.884)
  - Source scores: rhythm-inference=0.8839, pitch-mapping=0.5089, measure-allocation=0.3811, chord-grouping=0.2029, notehead-detection=0.1222
  - Pitch errors (30): other=18, ±octave=7, ±1-accidental=4, ±2-diatonic=1
  - Duration errors (7): beamed-subdivision=4, onset-coupled=2, too-short=1
  - Detection: chord-grouping=16, extra-notes=7, missing-notes=7
  - Error buckets: pitch=30, onset=21, chord=16, extra/missing-notes=14, slurs=8, duration=7, accidentals=4, ties=2, rests=2
  - Largest remaining error bucket: pitch = 30 (29%)
  Rhythm/voice attribution (V2 Phase 1):
  - pitch-grouping-symptom: 25
  - onset-phase-shift: 19
  - chord-grouping-symptom: 16
  - balanced-missing-extra-serialization: 14
  - voice-serialization-shift: 11
  - onset-coupled-duration: 2
  - chord symptom coupled share: 100%
  - missing/extra balanced: 7/7
  Written vs sounding duration (V2 Phase 3):
  - written-duration-wrong: 3
  - onset-coupled-duration: 2
  - serialization-artifact: 2
  - Dominant: written-duration-wrong (3)
  - Hotspot duration traces:
    - m1: 1 wrong durations (written-duration-wrong=1)
    - m2: 2 wrong durations (onset-coupled-duration=1, serialization-artifact=1)
    - m3: 2 wrong durations (written-duration-wrong=1, onset-coupled-duration=1)
    - m4: 1 wrong durations (serialization-artifact=1)
    - m5: 1 wrong durations (written-duration-wrong=1)
  Tie/sustain constraints (V2 Phase 4):
  - slur-like-arc-pitch-differs: 2
  - written-correct-sustain-wrong: 1
  - Dominant: slur-like-arc-pitch-differs (2)
  - Tie glyphs: detected 4, applied 2, slur-like rejected 2, unresolved 0
  Pipeline attribution: pitch-inference
  - pitch-inference: 30 (30 wrong pitch match(es))
  - onset-rhythm-inference: 28 (7 duration; 21 onset error(s))
  - voice-serialization: 16 (16 chord/voice grouping mismatch(es))
  - symbol-detection: 14 (7 missing; 7 extra note(s))
  - measure hotspots: m2 onset-rhythm-inference (44), m3 pitch-inference (27), m7 pitch-inference (26), m1 onset-rhythm-inference (15), m4 pitch-inference (12), m8 onset-rhythm-inference (12), m5 symbol-detection (7)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 1 accepted / 5 candidates / 5 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 21 → 21 (Δ 0), wrongDuration 7 → 7 (Δ 0), chord 16 → 16 (Δ 0)
- Rejected candidates: m1:duration-changed, m2:duration-changed+chord-split, m3:duration-changed+chord-split, m7:duration-changed+chord-split, m8:chord-regression+pitch-regression+duration-regression

### Voice serialization shadow (V2 Phase 7 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-7-duration-coupled**
- Note: No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.
- Solver: 0 structurally applied (0 duration-coupled) / 0 truth-approved / 0 candidates
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 21 → 21 (Δ 0), wrongDuration 7 → 7 (Δ 0), chord 16 → 16 (Δ 0)
  ScoreGraph IR (observation): 117 nodes, 217 edges across 8 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 3 node(s) sounding≠written; 18 tie; 0 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

## Top error categories (across fixtures)
- rhythm-inference: 1

## Aggregated duration error histogram
- beamed-subdivision: 4
- onset-coupled: 2
- too-short: 1

## Aggregated pitch error histogram
- other: 18
- ±octave: 7
- ±1-accidental: 4
- ±2-diatonic: 1

## Error buckets (across fixtures)
Buckets: pitch, duration, onset, chord, ties, slurs, tuplets, accidentals, rests, extra/missing notes
- pitch: 30
- onset: 21
- chord: 16
- extra/missing-notes: 14
- slurs: 8
- duration: 7
- accidentals: 4
- rests: 2
- ties: 2
- **Largest remaining error bucket: pitch = 30 (29% of counted errors)**

## Tier breakdown
- piano-rhythm: 1 fixture(s) (pass=1)

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
