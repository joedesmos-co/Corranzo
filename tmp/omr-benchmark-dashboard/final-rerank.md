# OMR Diagnostic Final Rerank

**Date:** 2026-07-02  
**Dashboard run:** `npm run omr:benchmark-dashboard` — **PASS** (3 enforced, 2 skipped)  
**Code changes this pass:** None (diagnosis only)

---

## Final OMR status (enforced fixtures)

| Fixture | Pitch | Duration | Onset | Chord | F1 | noteΔ | missing | extra | Status |
|---------|------:|---------:|------:|------:|---:|------:|--------:|------:|--------|
| Gymnopédie (clean) | 100% | 100% | 100% | 100% | 100% | 0 | 0 | 0 | pass |
| Cruel Angel (dense) | 94% | 96% | 96% | 94% | 99% | 0 | 28 | 28 | pass |
| Twinkle (simple) | 100% | 97% | 93% | 100% | 100% | 0 | 0 | 0 | pass |

**Structural note:** Skipped tiers (La Campanella ×2) dominate aggregate bucket totals but are **not** acceptance gates. All sprint conclusions below are from **enforced fixtures only**.

**Sprint verdict summary**

| Sprint | Algorithm change | Primary finding |
|--------|------------------|-----------------|
| Rhythm / onset | None | 94 wrong onsets; ±0.50q/±0.75q voice-phase slips; chord 89% coupled |
| Tie / slur | None | Gymnopédie tie recall 6/14; threshold relax zero gain |
| Accidentals / key | None | 7 accidental-miss at correct onset; grouping (90) dominates pitch |
| Missing / extra | None | noteΔ=0; 52/56 are serialization slips (onset downstream) |

---

## Remaining biggest buckets

### On enforced fixtures (actionable)

| Rank | Bucket | Dense | Clean | Simple | Proven root cause? |
|-----:|--------|------:|------:|-------:|--------------------|
| 1 | **onset / rhythm** | **94** | 0 | **6** | **Yes** — `buildNoteEventsFromGroups` x→`startDivision` |
| 2 | slurs (diagnostic) | 800 | 164 | 0 | No — unmodeled; `uncertainSlurCount` only |
| 3 | chord | 172 | 0 | 0 | **Symptom** — 89% onset/detection-coupled |
| 4 | pitch | 147 | 0 | 0 | **Mostly symptom** — 90 grouping-artifact |
| 5 | duration (independent) | 33 | 0 | 3 | Partial — too-short/long/beam-subdiv |
| 6 | duration (onset-coupled) | 44 | 0 | 2 | Symptom of onset |
| 7 | extra/missing | 56 | 0 | 0 | **Symptom** — 52 serialization-mistake |
| 8 | ties gap | 16 | 0† | 0 | Yes on Gym — 6/14 recall† |
| 9 | accidentals (±1) | 19 | 0 | 0 | Small tail — not primary |
| 10 | rests gap | 52 | — | — | Diagnostic |

†Clean accuracy metrics 100%; tie **recall vs truth** is 6/14 voice-ordered pairs (audible gap, not metric gap).

### Across all fixtures (includes skipped — do not optimize blindly)

| Bucket | Total | Driver |
|--------|------:|--------|
| chord | 8346 | La Campanella measure allocation + onset cascade |
| extra/missing | 7186 | Skipped tiers + dense serialization |
| pitch | 3347 | Skipped tiers |
| slurs | 2662 | Unmodeled counter |
| onset | 2375 | Dense + Campanella |

**Largest raw bucket (chord) is misleading** for sprint prioritization: on dense, fixing chord in isolation would chase 89% onset-coupled symptoms.

---

## Ranked remaining issues

Scoring: **Impact** (metric movement on enforced), **Root-cause** (proven vs symptom), **Risk** (regression history), **Generality** (cross-fixture). Scale 1–5 (5 = highest).

| Rank | Issue | Impact | Root cause | Risk | Generality | Dense Δ potential |
|-----:|-------|-------:|-----------:|-----:|-----------:|------------------:|
| **1** | **Onset / voice-phase serialization** | 5 | 5 | **5** | 5 | −94 onset; cascades −172 chord, −90 pitch, −52 miss/extra |
| 2 | Gymnopédie tie recall (ink arc at barline) | 3 | 5 | 3 | 3 | 0 metric; 8 pairs audible on clean |
| 3 | Independent duration (too-short/long, beam-subdiv) | 2 | 4 | 4 | 3 | −33 duration |
| 4 | Twinkle m10 eighth-run grid | 2 | 5 | **1** | 2 | −6 onset (simple guard) |
| 5 | Pitch staff/register pairing | 2 | 3 | 4 | 2 | −25 at correct onset |
| 6 | Detection-loss tail (G5, A#6 ledger) | 1 | 4 | 5 | 1 | −4 miss/extra |
| 7 | Accidental miss (±1) | 1 | 4 | 3 | 2 | −7..19 pitch |
| — | Chord grouping (isolated) | 4† | **1** | 5 | 2 | Symptom — do not target |
| — | Slurs modeling | 3† | N/A | 5 | 4 | New feature — freeze |
| — | La Campanella measure allocation | 5† | 5 | 5 | 1 | Skipped; fixtures external |

†High raw count but not a proven independent defect on enforced fixtures.

---

## Recommendations

### Safest next target

**Twinkle m10 onset grid (6 wrong onsets, 3 durations)** — or **Gymnopédie per-pair tie ink-arc trace (m9→10)**

| Option | Why safest |
|--------|------------|
| **Twinkle m10** | Single measure, beginner regression guard, 0 chord/missing/extra risk, isolated from dense sixteenth voice-phase |
| **Gymnopédie tie m9→10** | Isolated `detectVectorTies.js`; Twinkle false ties pinned at 0; no dense metric movement; diagnostic-first ink trace before threshold change |

Pick Twinkle if the goal is **regression safety**; pick Gymnopédie ties if the goal is **audible correctness on the 100% metric guard fixture**.

### Highest-impact risky target

**Dense onset serialization** — `processVectorOmrPage.js` → `buildNoteEventsFromGroups` voice-phase / sixteenth grid (`shouldInferRhythmFromPositions`)

- Moves onset, chord, pitch, and miss/extra together
- **Proven introduction point**; 100% of wrong onsets are ±0.50q or ±0.75q
- **Failed simulations:** position renormalization (onset 94→285, Twinkle fail), sixteenth cluster snap (zero change), beam ownership (duration regression)
- Requires **measure-scoped diagnosis** (m9, m7–8, m121) before any generic rule

### Targets to avoid

| Target | Reason |
|--------|--------|
| **Chord grouping in isolation** | 89% onset-coupled on dense; 10 “isolated” are adjacent 16th onset pairs |
| **Broad detection threshold lowering** | Risks Twinkle duplicate-note regression (`dedupeNoteheads` spatial keys) |
| **Position / column renormalization** | Proven regression: dense onset 94→285 |
| **Phantom column removal / stack shift** | Regressed chord and missing-note counts |
| **Beam ownership duration edits** | Simulations regressed duration; not promoted |
| **Accidentals / key signatures** | 7 at correct onset vs 90 grouping-artifact pitch errors |
| **Missing/extra as detection** | noteΔ=0; 52/56 serialization — fix onset, not detect |
| **Slurs bucket** | Unmodeled feature; 800 on dense is diagnostic counter, not accuracy defect |
| **La Campanella / measure allocation** | Skipped tier; fixtures in `~/Downloads`; vendor first (ACCURACY_ROADMAP §0.1) |
| **Global pitch offsets / piece hardcoding** | Sprint rules forbid |

---

## Recommended next sprint

**Name:** OMR Onset Voice-Phase Sprint (diagnosis-first)

**Scope**

1. Per-measure ink/x-position traces on dense **m9** (18 onset errors), **m7–m8** (15 combined), **m121** (9)
2. Parallel Twinkle **m10** trace (6 onsets) as regression canary
3. Classify each wrong onset as `duplicate-pitch-instance` vs `unique-pitch-slot-shift` (per `onset-diagnosis.md`)
4. Simulate **one** narrow rule only if a single mechanism covers ≥3 measures without Twinkle/Gymnopédie regression
5. Pin with `analyzeOnsetErrorCoupling` + `rankRhythmRootCauses` tests

**Alternate (lower risk, lower dense impact):** Gymnopédie Tie Ink-Arc Sprint — debug `detectInkArcBetween` on m9→10, m64→65 barline-interrupted pairs before any threshold change.

**Do not start with:** chord sprint, accidental sprint, or missing/extra detection sprint — all prior sprints proved these are downstream.

---

## Verification (this pass)

| Check | Result |
|-------|--------|
| `npm test` | 172 files, 1661 passed |
| `npm run build` | PASS |
| `npm run omr:benchmark-dashboard` | PASS — enforced fixtures unchanged |

---

## Reference diagnostics

| Module | Purpose |
|--------|---------|
| `omrDiagnosticGrouping.js` | `rankRhythmRootCauses`, `analyzeChordMismatchCoupling`, `analyzeOnsetErrorCoupling` |
| `omrPitchErrorAnalysis.js` | `summarizePitchErrorRootCauses` |
| `omrMissingExtraAnalysis.js` | `summarizeMissingExtraRootCauses` |
| `omrTieRecallAnalysis.js` | `evaluateTieRecall`, Gymnopédie 6/14 pin |

Prior sprint docs: `sprint2-rhythm-diagnosis.md`, `tie-slur-diagnosis.md`, `accidentals-diagnosis.md`, `missing-extra-diagnosis.md`.
