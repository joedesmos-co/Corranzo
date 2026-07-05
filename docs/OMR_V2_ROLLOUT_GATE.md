# OMR Engine V2 — Rollout Gate (Phase 5)

**Generated:** 2026-07-05T03:19:59.255Z
**Status:** Diagnostic/planning only — no runtime OMR changes.

## Executive decision

**Recommended Phase 6 target:** `voice-aware-serialization` (shadow-only)

Clef-only phase-shift solver is exhausted. Voice-aware serialization (shadow-only, canary-gated) is the safest path to measurable progress before duration or tie solvers.

**Parallel low-risk prep:** `onset-grid-refinement`

## Frozen baseline verification

| Fixture | wrongOnset | wrongDuration | chordMismatch | wrongPitch |
|---------|----------:|--------------:|--------------:|-----------:|
| Gymnopédie (clean) | 0 | 0 | 0 | 0 |
| Cruel Angel (dense) | **94** | **77** | **172** | **147** |
| Twinkle (simple) | 6 | 3 | 0 | 0 |

Current dashboard dense baseline match: ✅ MATCH

## Phase 1 — Rhythm attribution (dense)

| Bucket | Count |
|--------|------:|
| onset-phase-shift | 94 |
| pitch-grouping-symptom | 90 |
| chord-grouping-symptom | 81 |
| balanced-missing-extra-serialization | 52 |
| onset-coupled-duration | 44 |
| voice-serialization-shift | 35 |

## Phase 2/2B/2C — Shadow solver (dense)

- Status: `shadow-no-qualifying-measures`
- Changed measures: **0**
- Truth-approved: **0**
- Constraint version: phase-2c
- **Conclusion:** clef-only phase-shift family is exhausted.

## Phase 3 — Written vs sounding duration split (dense)

| Class | Count |
|-------|------:|
| onset-coupled-duration | 44 |
| written-duration-wrong | 33 |

- Dominant: onset-coupled-duration (44)

## Phase 4 — Tie/sustain constraints (dense)

| Constraint | Count |
|------------|------:|
| expected-cross-measure-tie | 42 |
| sounding-release-too-short | 42 |
| written-correct-sustain-wrong | 31 |
| slur-like-arc-pitch-differs | 16 |
| tie-start-without-continuation | 8 |
| continuation-without-tie-start | 4 |

## Target ranking

| Target | Impact | Safety | IR ready | Anti-regression | Composite | Status |
|--------|-------:|-------:|---------:|----------------:|----------:|--------|
| onset-grid-refinement | 3 | 5 | 2 | 5 | 4.1 | eligible-prep |
| written-sounding-duration-solver | 4 | 3 | 5 | 2 | 3.25 | blocked-premature |
| tie-sustain-constraint-solver | 3 | 3 | 4 | 3 | 3.2 | blocked-premature |
| voice-aware-serialization | 5 | 2 | 3 | 2 | 2.65 | recommended |
| measure-level-solver-variant | 4 | 1 | 3 | 1 | 1.85 | blocked-exhausted |

### Rationale by target

#### onset-grid-refinement (`eligible-prep`)
- Lowest regression risk: observation-first onsetColumns[] on MeasureGraph.
- Enables future solver column assignment without touching runtime bytes.
- **Blockers:**
  - Alone it does not fix accompaniment-lane serialization (35 voice-shift onsets).
  - onsetColumns[] not yet complete on every dense measure.

#### written-sounding-duration-solver (`blocked-premature`)
- Phase 3 IR fields populated; 44 onset-coupled + 33 written-duration-wrong errors on dense.
- Written vs sounding split is observation-ready for solver constraints.
- **Blockers:**
  - 44 onset-coupled duration errors cannot be fixed until onsets/voices are stable.
  - Fixing duration without voice serialization will trade onset gains for chord regressions (Phase 2B lesson).

#### tie-sustain-constraint-solver (`blocked-premature`)
- Phase 4 classifies 42 expected cross-measure ties and 31 written-correct/sustain-wrong rows.
- Tie hard constraints are designed in OMR_ENGINE_V2_PLAN.md §3.4.
- **Blockers:**
  - Most sustain deficits are downstream of wrong onsets/voices, not missing tie glyphs.
  - Gymnopédie tie recall still incomplete; Twinkle false-tie guard must stay at 0.

#### voice-aware-serialization (`recommended`)
- Highest root-cause impact: 35 voice-serialization-shift onsets, 81 chord-grouping symptoms on dense.
- Twinkle m10 is 100% accompaniment-lane phase error — the narrowest canary for this family.
- Clef-only phase shifts (Phase 2) are exhausted; voice-lane assignment is the missing variable.
- **Blockers:**
  - High regression risk on Twinkle and dense chord grouping.
  - ScoreGraph IR has clef/voice export labels but no stable staff-lane voiceId yet.

#### measure-level-solver-variant (`blocked-exhausted`)
- Phase 2/2B/2C shadow prototype exists with truth gates and chord coalescing.
- **Blockers:**
  - Clef-only phase-shift family exhausted: 0 changed, 0 truth-approved on dense.
  - Broadening constraints caused chord regressions (+70 chordMismatch in Phase 2).
  - Same family cannot progress without a new variable (voice lanes).

## Why voice-aware serialization wins

1. **Root cause:** 35/94 wrong onsets are `serialization-voice-shift`; Twinkle m10 is 100% accompaniment-lane late by one eighth.
2. **Exhausted alternative:** Phase 2 clef-only phase shifts produced 0 truth-approved measures on dense.
3. **Downstream block:** 44 onset-coupled duration errors and 42 expected cross-measure tie candidates cannot be solved until onsets/voices stabilize.
4. **IR gap is narrow:** ScoreGraph has clef, voice export, tie fields — needs `voiceId` staff-lane variable for solver.
5. **Safety path:** shadow-only + per-measure truth gate + Twinkle m10 canary before any dense promotion.

## Blocked targets

- **written-sounding-duration-solver** (`blocked-premature`): 44 onset-coupled duration errors cannot be fixed until onsets/voices are stable.
- **tie-sustain-constraint-solver** (`blocked-premature`): Most sustain deficits are downstream of wrong onsets/voices, not missing tie glyphs.
- **measure-level-solver-variant** (`blocked-exhausted`): Clef-only phase-shift family exhausted: 0 changed, 0 truth-approved on dense.

## Canary gates (unchanged)

- **Gymnopédie:** byte-identical / 100% all axes.
- **Twinkle m10:** 0 wrong onsets; false-tie guard = 0.
- **Dense m7/m9/m121:** hotspot traces must improve without chord regression.

## Recommended Phase 6 prompt

```
Corranzo OMR V2 Phase 6 — voice-aware-serialization (shadow-only).

Feature freeze is active. Do not change runtime OMR output.

Goal:
Implement a shadow-only voice-aware-serialization solver family using ScoreGraph IR, targeting the root cause identified in Phase 5 rollout gate.

Current evidence (frozen baseline):
- Dense: wrongOnset 94, wrongDuration 77, chordMismatch 172, wrongPitch 147
- Phase 1: 35 voice-serialization-shift, 94 onset-phase-shift
- Phase 2/2B/2C: 0 changed measures, 0 truth-approved (clef-only phase shifts exhausted)
- Phase 3: 44 onset-coupled-duration, 33 written-duration-wrong
- Phase 4: 42 expected-cross-measure-tie candidates
- Twinkle false-tie guard: clean (0 applied)
- Gymnopédie: must stay 100% on all axes

Rules:
- Shadow/diagnostic only — no runtime MusicXML promotion.
- No threshold changes.
- No UI/playback/Wait For You changes.
- Per-measure truth gate: improve onset/duration on measure; no chord/pitch/duration regression.
- Twinkle m10 canary must reach 0 wrong onsets before any dense promotion.
- Gymnopédie byte-identical gate on every change.

Tasks:
1. Add staff-lane voiceId assignment to ScoreGraph IR (observation + shadow solver variable).
2. Implement shadow voice-lane solver: grand-staff accompaniment template (truth v5 vs gen v2 pattern).
3. Decouple MusicXML voice numbering from rhythm inference in shadow emit path only.
4. Reuse Phase 2C truth gate + chord coalescing; reject variants that split chords or change note count.
5. Target canary measures first: Twinkle m10, dense m7/m9/m121.
6. (Parallel prep) Extend onsetColumns[] on MeasureGraph — onset-grid-refinement — observation only.
7. Add tests proving shadow solver does not mutate runtime events.
8. Dashboard section: voice-lane shadow report alongside rhythm-shadow-report.json.

Verification:
npm test
npm run build
npm run omr:benchmark-dashboard

Acceptance:
- Runtime OMR unchanged (dense metrics frozen).
- Shadow shows ≥1 truth-approved measure on Twinkle m10 OR dense m7–m9 with Δ wrongOnset < 0 and no chord regression.
- Gymnopédie 100%; Twinkle false ties 0.
- No promotion to runtime.
```

---

See also: [`OMR_ENGINE_V2_PLAN.md`](./OMR_ENGINE_V2_PLAN.md)
