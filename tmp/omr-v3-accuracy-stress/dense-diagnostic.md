# OMR benchmark dashboard

Generated: 2026-07-17T03:20:47.919Z
Fixtures: 1
Overall: PASS
Largest remaining error bucket: slurs = 856 (58%)

## Status
- pass: 0
- fail: 0
- rejected: 0
- skipped: 1
- error: 0

## Fixtures

### A Cruel Angel's Thesis (legacy copyrighted diagnostic) (`skipped`)
- PDF: `/Users/ryland/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.pdf`
- Truth: `/Users/ryland/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.mxl`
  pitch 94% | duration 96% | onset 96% | chord 94% | F1 99%
  measureΔ 0 | noteΔ -2 | wrongPitch 147 | wrongDuration 77 | wrongOnset 94 | chordMismatch 170
  top error category: Rhythm inference (rhythm-inference)
  top duration error category: onset-coupled (44 sampled)
  top pitch error category: other (73 sampled)
  - Primary: Rhythm inference (rhythm-inference, confidence 0.899)
  - Source scores: rhythm-inference=0.8987, measure-allocation=0.2283
  - Pitch errors (147): other=73, ±2-diatonic=52, ±1-accidental=19, ±octave=3
  - Duration errors (77): onset-coupled=44, too-short=20, too-long=9, beamed-subdivision=4
  - Detection: chord-grouping=170, missing-notes=28, extra-notes=26
  - Error buckets: slurs=856, chord=170, pitch=147, onset=94, duration=77, extra/missing-notes=54, rests=52, accidentals=19, ties=16
  - Largest remaining error bucket: slurs = 856 (58%)
  Rhythm/voice attribution (V2 Phase 1):
  - onset-phase-shift: 94
  - pitch-grouping-symptom: 90
  - chord-grouping-symptom: 79
  - onset-coupled-duration: 44
  - voice-serialization-shift: 35
  - chord symptom coupled share: 89%
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
  Pipeline attribution: onset-rhythm-inference
  - onset-rhythm-inference: 171 (77 duration; 94 onset error(s))
  - voice-serialization: 170 (170 chord/voice grouping mismatch(es))
  - pitch-inference: 147 (147 wrong pitch match(es))
  - symbol-detection: 54 (28 missing; 26 extra note(s))
  - measure hotspots: m9 voice-serialization (90), m7 voice-serialization (65), m8 voice-serialization (65), m61 voice-serialization (59), m121 pitch-inference (56), m119 pitch-inference (51), m123 pitch-inference (51), m125 pitch-inference (50)

### Rhythm shadow solver (V2 Phase 2 — diagnostic only)

- Status: **shadow-no-qualifying-measures**
- Promoted: **no**
- Constraints: **phase-2c**
- Note: No measures passed Phase 2C preservation + truth gates — shadow identical to runtime.
- Solver: 0 accepted / 125 candidates / 125 rejected
- Shadow XML identical to runtime (no qualifying measures)
- Runtime vs shadow: wrongOnset 94 → 94 (Δ 0), wrongDuration 77 → 77 (Δ 0), chord 170 → 170 (Δ 0)
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
- Runtime vs shadow: wrongOnset 94 → 94 (Δ 0), wrongDuration 77 → 77 (Δ 0), chord 170 → 170 (Δ 0)
- Rejected measures: m2:constraints-failed, m4:constraints-failed, m5:constraints-failed, m6:constraints-failed, m7:constraints-failed, m8:constraints-failed, m9:constraints-failed, m10:constraints-failed…
- Hotspot deltas: m7(onsetΔ0,durΔ0,chordΔ0), m9(onsetΔ0,durΔ0,chordΔ0), m121(onsetΔ0,durΔ0,chordΔ0)
  ScoreGraph IR (observation): 5932 nodes, 12661 edges across 125 measures; geometry bridge 100%
  IR voice budget: 0 overflow measure(s), 0 overflow event(s), 0 underfill measure(s)
  IR duration split: 239 node(s) sounding≠written; 2132 tie; 70 gap-to-next
  IR ↔ runtime parity: noteheads ok, rests ok

## Top error categories (across fixtures)
- rhythm-inference: 1

## Aggregated duration error histogram
- onset-coupled: 44
- too-short: 20
- too-long: 9
- beamed-subdivision: 4

## Aggregated pitch error histogram
- other: 73
- ±2-diatonic: 52
- ±1-accidental: 19
- ±octave: 3

## Error buckets (across fixtures)
Buckets: pitch, duration, onset, chord, ties, slurs, tuplets, accidentals, rests, extra/missing notes
- slurs: 856
- chord: 170
- pitch: 147
- onset: 94
- duration: 77
- extra/missing-notes: 54
- rests: 52
- accidentals: 19
- ties: 16
- **Largest remaining error bucket: slurs = 856 (58% of counted errors)**

## Tier breakdown
- legacy-local: 1 fixture(s) (skipped=1)

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
- Frozen baseline: DRIFT DETECTED

## Voice serialization qualification (Phase 6B)
**NO — zero truth-approved measures on live enforced fixtures.**
Voice serialization qualification (Phase 6b):
- Verdict: Re-run live dashboard with includeScoreGraph and truth MXL.
- Truth-approved: 0 | Structural: 0
Voice serialization qualification (Phase 7):
- Verdict: Blocker is hard constraints (voice overlap) — duration coupling insufficient; inspect gapToNextOnset IR or multi-voice overlap.
- Truth-approved: 0 | Structural: 0
- Hotspots:
  - m7: structurally-rejected (hard-constraints) onsetΔ0
  - m9: structurally-rejected (hard-constraints) onsetΔ0
  - m121: structurally-rejected (hard-constraints) onsetΔ0
- Global shadow Δ: wrongOnset 0, wrongDuration 0, chord 0
Voice serialization qualification (Phase 6b):
- Verdict: Re-run live dashboard with includeScoreGraph and truth MXL.
- Truth-approved: 0 | Structural: 0
