# OMR Engine V2 — Stop/Continue Decision Pass

**Date:** 2026-07-03  
**Status:** Planning only — no runtime OMR changes.  
**Feature freeze:** Active.  
**Evidence sources:** Phase 1–7 diagnostics, live benchmark dashboard (`tmp/omr-benchmark-dashboard/`, generated 2026-07-03), rollout gate (`docs/OMR_V2_ROLLOUT_GATE.md`), Phase 6B/7 qualification (`docs/OMR_V2_PHASE_7_QUALIFICATION.md`).

---

## Executive decision

### **Recommendation: PAUSE OMR V2 solver work**

Pause shadow-solver iteration (Phase 8+) and redirect effort to **mic/audio accuracy**, **benchmark/QA hardening**, and **product polish** until IR prerequisites below are met.

**Rationale in one sentence:** Seven phases proved the diagnosis is correct and the gates work, but every solver variant family tested so far operates on an event representation that cannot atomically fix cross-staff voice serialization — so more variants on the same IR will keep producing **0 truth-approved measures**.

If the team explicitly chooses to continue OMR V2 anyway, the only defensible Phase 8 target is **paired cross-staff atomic lane moves** (not another single-lane tweak). That is an IR/event-model phase, not a quick solver patch.

---

## Frozen baseline (must not regress)

| Fixture | wrongOnset | wrongDuration | chordMismatch | wrongPitch |
|---------|----------:|--------------:|--------------:|-----------:|
| Gymnopédie (clean) | 0 | 0 | 0 | 0 |
| Cruel Angel (dense) | **94** | **77** | **172** | **147** |
| Twinkle (simple) | 6 | 3 | 0 | 0 |

All Phase 1–7 work preserved these numbers. Runtime MusicXML was never promoted.

---

## 1. What each phase proved

### Phase 1 — Rhythm error attribution

**Proved:** Dense errors are **interpretation**, not detection (`noteCountDiff` 0, F1 0.99). Wrong onsets dominate and cluster into mechanistic buckets:

| Bucket | Count (dense) | Meaning |
|--------|--------------:|---------|
| onset-phase-shift | 94 | Systematic late/early grid slips (+0.5q / +0.75q) |
| voice-serialization-shift | 35 | Accompaniment lane assigned to wrong voice phase |
| onset-coupled-duration | 44 | Duration wrong because onset is wrong |
| chord-grouping-symptom | 81 | Same-start / voice assignment mismatch |
| pitch-grouping-symptom | 90 | Matcher coupling to grouping, not staff-step |

**Did not prove:** Any single heuristic bucket is fixable by a local post-pass without chord/pitch regression.

---

### Phase 2 / 2B / 2C — Clef-only rhythm shadow solver

**Proved:**

- Shadow infrastructure works: hard constraints, chord coalescing, note-count preservation, truth MXL gate, per-measure promotion guard.
- **Clef-wide phase shifts are exhausted:** 0 structurally applied, 0 truth-approved on dense (125 candidate measures rejected).
- Broadening constraints in Phase 2 caused chord regressions (+70 `chordMismatch`); Phase 2C gates correctly blocked promotion.

**Did not prove:** Uniform clef-level onset nudging can fix grand-staff accompaniment serialization.

---

### Phase 3 — Written vs sounding duration IR split

**Proved:**

- ScoreGraph nodes can carry `writtenDurationDivisions`, `soundingReleaseDivision`, `durationSource`, `releaseSource`, `gapToNextOnset` without mutating runtime events.
- Dense duration errors split into **44 onset-coupled** vs **33 written-duration-wrong** — most duration pain is downstream of onset/voice, not stem-tail misread.

**Did not prove:** Duration can be solved independently of voice/onset stabilization.

---

### Phase 4 — Tie/sustain constraint diagnostics

**Proved:**

- 42 expected cross-measure ties, 31 written-correct/sustain-wrong, 42 sounding-release-too-short on dense.
- Twinkle false-tie guard remains clean (0 applied ties).
- Most sustain deficits correlate with wrong onsets/voices, not missing tie glyph recall.

**Did not prove:** A tie/sustain solver is safe before onsets stabilize (Phase 5 ranked it `blocked-premature`).

---

### Phase 5 — Rollout gate

**Proved:**

- Data-driven target ranking: **voice-aware serialization** highest root-cause impact; clef-only variant **blocked-exhausted**.
- Parallel low-risk prep: `onset-grid-refinement` (observation-only `onsetColumns[]`).
- Canary strategy: Twinkle m10 (accompaniment-lane phase), dense m7/m9/m121, Gymnopédie 100% guard.

**Did not prove:** Voice-aware serialization could succeed on live IR without new event-model primitives.

---

### Phase 6 / 6B — Voice-aware lane serialization shadow

**Proved:**

- Staff-lane IR (`voiceId`, `staffLane`, `accompanimentLane`, `latePhaseEligible`) populates on live ScoreGraph without runtime mutation.
- Lane-targeted adaptive phase (−2/−3 per lane mod) **matches the error family** on live IR (Twinkle m10, dense hotspots classify into accompaniment-lane / serialization-voice-shift).
- Synthetic Twinkle-like m10 **can** structurally apply `grand-staff-late-minus-2` in isolation.

**Live result (6B):** **0 truth-approved, 0 structural applied** on clean/dense/simple.

**Did not prove:** Per-lane onset shifts alone satisfy hard constraints on live measures. Hotspots rejected at **`hard-constraints`** (voice overlap): shifted onsets leave durations too long for the measure budget.

---

### Phase 7 — Duration-coupled lane shadow

**Proved:**

- Phase 3 fields integrate into shadow pipeline: shift → shorten overlapping durations per voice → coalesce → duration-coupled preservation gate.
- Synthetic overlap cases clear hard constraints after coupling.
- Coupled variants reduce preservation failures vs onset-only (e.g. Gymnopédie m37: coupled drops `onset-group-regression` but still fails **`chord-split`**).

**Live result (7):** **0 truth-approved, 0 structural applied, 0 duration-coupled applied** on enforced fixtures.

| Hotspot | Phase 7 blocker |
|---------|-----------------|
| Twinkle m10 | `hard-constraints` — baseline identity fails constraints; no coupled variant builds a passing candidate |
| Dense m7, m9, m121 | `hard-constraints` — voice overlap survives per-voice trim |
| Gymnopédie m37, m76 | `chord-split` — accompaniment-only shifts decouple cross-staff chord groupings |

**Did not prove:** Duration trimming on the current clef-as-voice event list can fix multi-voice grand-staff serialization.

---

## 2. Why Phase 6B and Phase 7 both ended at zero truth-approved

Both phases targeted the **same root cause** (accompaniment-lane late phase) with increasing sophistication:

```
Phase 6B:  lane onset shift only
Phase 7:   lane onset shift + per-voice duration shorten
```

Both failed for the **same structural reason**, not because the gates are too strict:

### A. The candidate never becomes constraint-valid

On live IR, shifting one staff lane moves some notes earlier but leaves **other voices/events occupying the freed time**. Per-voice duration trim shortens to the next *same-voice* onset, not to the next *musical* onset column across the measure. Residual overlap → `validateHardConstraints` → `voice-overlap` or `overflow`.

Twinkle m10 is the clearest case: the live baseline already violates hard constraints under the shadow model; no variant in the Phase 6/7 family produces a feasible event set.

### B. Even constraint-valid partial fixes fail preservation

Gymnopédie m37/m76: lane shifts split cross-staff chords that runtime currently groups (treble melody + bass accompaniment at the same nominal column). Accompaniment-only moves change onsets asymmetrically → **`chord-split`** preservation rejection.

This is not a threshold problem. It is a **representation problem**: chords spanning clefs are not atomic move units.

### C. Truth gate never runs because structural gate blocks first

The pipeline is:

```
variant build → hard constraints → preservation → soft-score improvement → truth MXL gate
```

With 0 structural applied, **no measure reaches truth evaluation**. Phase 6B and Phase 7 die at step 1–2, not at MusicXML comparison.

### D. Synthetic success ≠ live success

Twinkle-like synthetic graphs used in unit tests omit the full live event topology (extra voices, tied spans, beam-mixed ownership, cross-staff pairing density). Synthetic m10 passes; live m10 does not — confirming the gap is **live IR fidelity**, not solver logic bugs.

---

## 3. True blocker classification

| Candidate blocker | Verdict | Evidence |
|-------------------|---------|----------|
| **Event model** | **Primary** | Events are clef-scoped note lists at `startDivision`; no atomic cross-staff chord unit; no paired multi-lane edit operator. Lane shift edits one clef lane independently → chord-split. |
| **Voice model** | **Primary** | Voice = clef bucket (treble→1, bass→2). Truth uses export voices (e.g. accompaniment voice 5). Serialization phase is a **cross-staff timing relation**, not a single-voice property. Per-voice trim cannot see cross-voice column occupancy. |
| **Chord grouping** | **Primary symptom / secondary cause** | 172 dense `chordMismatch`; 81 chord-grouping-symptom attributions. Grouping errors are mostly downstream of wrong phase, but **preservation gates correctly treat chord topology as invariant** — so any fix that regroups fails before truth. |
| **Hard constraints** | **Gate, not root cause** | Constraints work as designed. They surface infeasible candidates. Removing or relaxing them would reintroduce Phase 2 chord regressions (+70). |
| **MusicXML serializer assumptions** | **Not the blocker** | Serializer faithfully emits the event list it receives. Shadow rebuilds MusicXML from solved events; failures occur **before** emit. Pitch/duration errors in evaluation are largely grouping/onset coupling, not `buildOmrMusicXml` bugs. |
| **onsetColumns[] IR gap** | **Enabling prerequisite** | Phase 5 ranked `onset-grid-refinement` as parallel prep. Incomplete column observation on dense measures limits any solver that assigns notes to columns jointly. |

**Consolidated diagnosis:** The shadow solvers are solving the right *problem* against the wrong *representation*. The missing primitive is **atomic multi-lane / cross-staff serialization** on a column-aware measure graph — not another single-lane phase delta.

---

## 4. Recommendation

### Pause OMR V2 solver work (preferred)

**Why pause now:**

1. **Zero live wins after seven phases.** Diagnostic ROI is diminishing; each phase added gates and evidence, not promoted measures.
2. **Next step is IR architecture, not solver tuning.** Phase 8 requires new event-model operators (paired moves, atomic chords) — estimated as a multi-week IR sprint, not a shadow variant pass.
3. **Feature freeze + user-visible accuracy.** Mic polyphony replay, WFY stabilization, and browser QA (`ACCURACY_ROADMAP.md`) deliver practice-session value without risking dense regression.
4. **Benchmark fragility.** Fixtures live outside the repo (`~/Downloads`); hardening the accuracy suite prevents silent rot while OMR solver work is paused.
5. **Gymnopédie is already 100%.** Further OMR solver work targets dense/Twinkle rhythm interpretation — a narrow, high-risk slice vs broader product polish.

**What to do instead (ordered):**

| Priority | Workstream | Why |
|----------|------------|-----|
| 1 | Mic accuracy replay + polyphony benchmarks | User-facing input quality; harnesses already exist |
| 2 | Browser smoke / WFY QA automation | Catches regressions in the product users touch |
| 3 | Benchmark fixture vendoring + CI gate | Makes OMR diagnostics reproducible across machines |
| 4 | Onset-column IR observation (prep only) | Unblocks future solver resume without runtime promotion |

---

### If continuing anyway: exact Phase 8 target

**Phase 8 — Paired cross-staff atomic serialization (shadow-only)**

Not duration coupling, not single-lane phase, not tie solver.

**Goal:** One shadow operator that moves **accompaniment lane + paired treble late figures** by the same phase delta **atomically**, preserving cross-staff chord grouping and passing hard constraints before truth gate.

**Scope:**

1. Add `onsetColumns[]` assignment observation on MeasureGraph (dense-complete).
2. Introduce `chordAtom` / `crossStaffGroup` identity on ScoreGraph nodes (diagnostic only).
3. Shadow operator: `applyPairedLanePhaseShift({ trebleLane, bassLane, delta })` — single variant, not 12 lane permutations.
4. Re-run Phase 2C + 6B + 7 gates on canaries: Twinkle m10, dense m7/m9/m121, Gymnopédie full-score guard.

**Success criterion:** ≥1 truth-approved measure on Twinkle m10 **or** dense m7 with Δ wrongOnset < 0 and no chord/pitch regression on that measure.

**Abort criterion:** If Phase 8 again yields 0 structural applied on live m10, stop solver iteration until runtime event builder emits column-aware atoms.

---

## 5. Prerequisites before resuming OMR V2 solver work

Do **not** resume shadow solver promotion attempts until all of the following are true:

| # | Prerequisite | Verification |
|---|--------------|--------------|
| 1 | **Benchmark fixtures vendored in-repo** | Dashboard runs in CI without `~/Downloads` paths |
| 2 | **`onsetColumns[]` populated** on ≥95% of dense candidate measures | `onset-grid-refinement` trace shows column assignment per notehead |
| 3 | **Cross-staff chord atom identity** in ScoreGraph IR | Nodes sharing a column+chord group carry stable `chordAtomId`; no clef-only grouping |
| 4 | **Paired lane move operator** spec'd and unit-tested on synthetic m10 | Atomic move preserves chord grouping in `validateRhythmShadowPreservation` |
| 5 | **Written/sounding + tie floors** validated on live m10 IR | Phase 3/4 traces explain why trim is blocked (tie floor vs overlap) |
| 6 | **Truth gate harness** remains frozen | Gymnopédie 100%, dense 94/77/172/147, Twinkle 6/3/0/0 without runtime promotion |

---

## 6. Phase summary table

| Phase | Hypothesis tested | Live structural wins | Live truth wins | Lesson |
|-------|-------------------|---------------------:|----------------:|--------|
| 1 | Attribute errors | — | — | Voice serialization + phase shift dominate |
| 2/2B/2C | Clef-wide phase shift | 0 | 0 | Family exhausted |
| 3 | Duration IR split | — | — | 44/77 duration errors are onset-coupled |
| 4 | Tie/sustain classify | — | — | Downstream of onsets; not primary lever |
| 5 | Pick next target | — | — | Voice-aware serialization ranked #1 |
| 6/6B | Lane-aware onset shift | 0 | 0 | Hard constraints block without duration fix |
| 7 | Lane shift + duration couple | 0 | 0 | Chord-split + cross-voice overlap remain |

---

## 7. Decision record

| Field | Value |
|-------|-------|
| **Decision** | **PAUSE** OMR V2 solver iteration |
| **Resume trigger** | Prerequisites §5 complete + explicit Phase 8 charter approved |
| **Parallel allowed** | Onset-column IR observation, fixture vendoring, mic/QA (no runtime OMR promotion) |
| **Explicitly deferred** | Tie/sustain solver, written-duration solver, threshold changes, runtime promotion |
| **Next solver target (if resumed)** | Phase 8 paired cross-staff atomic serialization |
| **Owner action** | Redirect sprint capacity to mic accuracy + QA hardening per `ACCURACY_ROADMAP.md` |

---

## Appendix — Hotspot status at pause (Phase 7 live)

| Fixture | Measure | wrongOnset (runtime) | Phase 7 shadow status | Dominant rejection |
|---------|---------|---------------------:|-----------------------|--------------------|
| Twinkle | m10 | 6 (hotspot) | structurally-rejected | hard-constraints |
| Dense | m7 | 8 | structurally-rejected | hard-constraints |
| Dense | m9 | 18 | structurally-rejected | hard-constraints |
| Dense | m121 | 9 | structurally-rejected | hard-constraints |
| Gymnopédie | m37, m76 | 0 (global 100%) | structurally-rejected | chord-split |

Global runtime metrics unchanged on all fixtures. Shadow XML identical to runtime everywhere (0 qualifying measures).
