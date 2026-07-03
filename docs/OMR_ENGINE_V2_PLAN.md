# OMR Engine V2 — Planning Pass

**Status:** Design / RFC only — **no runtime algorithm changes** in this sprint.  
**Date:** 2026-07-03 (planning lock)  
**Focus:** Dense rhythm, onset, and voice serialization (Cruel Angel stress fixture)  
**Deliverable:** Planning pass output only — app OMR bytes unchanged.  
**Related:** [`omr-architecture-v2.md`](./omr-architecture-v2.md), [`omr-phase3-solver-design.md`](./omr-phase3-solver-design.md), [`OMR_ENGINE.md`](../OMR_ENGINE.md), [`tmp/omr-benchmark-dashboard/onset-voice-phase-diagnosis.md`](../tmp/omr-benchmark-dashboard/onset-voice-phase-diagnosis.md), [`tmp/omr-benchmark-dashboard/report.md`](../tmp/omr-benchmark-dashboard/report.md)

---

## Executive summary

Corranzo’s vector OMR **detects notes well** on the dense benchmark (`noteCountDiff` 0, `measureCountDiff` 0, `noteDetectionF1` 0.99). Remaining Cruel Angel errors are **interpretation**, not detection. The dashboard’s primary error source is **`rhythm-inference`** (confidence 0.90).

| Metric | Dense (Cruel Angel) | Interpretation |
|--------|--------------------:|----------------|
| wrongOnset | **94** | Phase slips (+0.5q / +0.75q), voice serialization |
| wrongDuration | **77** | 44 onset-coupled; beamed subdivision tail (4) |
| chordMismatch | **172** | Same-start grouping / voice assignment |
| wrongPitch | **147** | Mostly matcher coupling to onset/voice (not staff-step) |
| missing / extra | **28 / 28** | Balanced — downstream of grouping/serialization |
| slurs (evaluator) | **800** | Marking/articulation mismatch — not V2.0 rhythm blocker |

**Root cause (confirmed by onset-voice trace):** voice-phase serialization and rhythm inference commit **locally and in fixed order**. Grand-staff accompaniment (truth voice 5 → generated voice 2) is systematically late by one eighth or two sixteenths. Greedy post-process rules (inner-voice phase, phantom columns, cluster snap) either do not apply or regress when broadened.

**OMR Engine V2** does not mean a neural rewrite or a second parallel pipeline. It means:

1. **One canonical Score Graph IR** (observation layer — largely exists).  
2. **Joint per-measure solver** replacing ordered heuristic mutations for rhythm/voice/duration.  
3. **Explicit split** between detected onset columns, notated duration, and sounding span.  
4. **Evaluator-gated, per-measure promotion** (extend the `phantomColumnCorrection` / `promoteMeasureRhythmsWithClips` idiom).

Score Follow, playback, WFY, and PDF viewer geometry stay on the existing measure grid — the IR must preserve `omrMeasureGridMeta` byte-identically.

---

## 1. Current pipeline audit

### 1.1 End-to-end flow

```text
PDF page
  → render ImageData + vector text extraction
  → preprocessOmrPageImage (deskew, contrast)
  → processOmrPageAnalysis
       ├─ legacy font normalization (MScore → SMuFL)
       ├─ staff / system detection
       ├─ measure grid + barlines (buildOmrMeasureGrid)
       └─ processVectorOmrPage (~2k lines)
            ├─ glyph → notehead/rest/accidental/articulation
            ├─ beam/stem graph (runtime + diagnostics)
            ├─ onset column inference (position → divisions)
            ├─ group merge / cluster snap
            ├─ buildNoteEventsFromGroups
            ├─ reconstructMusicalEvents (duration ladder)
            └─ ~30 ordered post-process heuristics
  → per-page measureRhythms[]
  → runPdfOmrPipeline post-pass (document-level)
       ├─ openingLeadNoteMerge
       ├─ innerVoicePhaseCorrection (beat≥2, stack≥5 only)
       ├─ phantomColumnCorrection (simulate → promote if safe)
       ├─ terminalEarlyColumnCorrection
       ├─ terminalSameClefChordQuarterDurations
       └─ scoreGraphSolver.promoteMeasureRhythmsWithClips (clip promotion)
  → buildOmrMusicXml (clef → voice mapping, written vs sounding pitch)
  → omrAccuracyEvaluator + benchmark dashboard
```

### 1.2 Parallel / shadow paths (not runtime)

| Path | Module | Status |
|------|--------|--------|
| Beam ownership event split | `beamOwnershipSimulation.js` | Sim-only; duration regressed |
| Voice serialization | `beamOwnershipVoiceSimulation.js` | Sim-only; duration regressed |
| ScoreGraph IR | `scoreGraph.js` | Observation; parity ok |
| Shadow MusicXML | `omr-scoregraph-shadow` | Δ0 vs runtime on IR round-trip |
| Joint solver design | `scoreGraphSolver.js`, phase-3 doc | Partial clip promotion only |

### 1.3 Where dense errors are introduced

From `onset-voice-phase-diagnosis.md` (m7–m9, m121, Twinkle m10):

| Stage | Finding |
|-------|---------|
| Glyph detection | Adequate — spacing matches sixteenth grid |
| Onset columns | `shouldInferRhythmFromPositions`; opening sustain at beat 0 |
| Grouping | `mergeGroupsSharingBeat` + cluster snap — **not** the primary bug |
| Event build | x→division correct for snap; errors are **column/voice selection** |
| Post-process | Inner-voice phase **not applied** on hotspots (guards too narrow) |
| MusicXML | **Clef→voice map** shifts accompaniment to voice 2; +0.5/+0.75q systematic |

**Error-class mix (94 wrong onsets):**

| Class | Count | Fix in engine? |
|-------|------:|----------------|
| cross-voice-matcher | 43 | Evaluator/matcher — not OMR runtime |
| serialization-voice-shift | 35 | **Yes — V2 target** |
| unique-pitch-slot-shift | 14 | Partial — solver column assignment |
| duplicate-pitch-instance | 2 | Evaluator pairing |

Only **19/94** are strict independent onset errors (pitch+duration ok, slot wrong).

### 1.4 Architectural debt

1. **Three event representations:** heuristic event list, `reconstructMusicalEvents` output, beam-ownership voice serialization — no single source of truth.  
2. **Order-dependent mutations** in `processVectorOmrPage.js` — global rules that fail on dense piano.  
3. **Rhythm and serialization coupled** in `buildOmrMusicXml` — voice assignment changes effective onset grid.  
4. **Written duration heuristics** applied without joint measure budget — causes onset-coupled duration errors.  
5. **Matcher/evaluator confounds pitch/onset** — metrics overstate “pitch” failures.

---

## 2. What OMR V2 should change (and what it should not)

### 2.1 Change

| Area | V2 direction |
|------|----------------|
| **Engine shape** | Feed-forward heuristics → **per-measure joint assignment** over ScoreGraph |
| **Voice serialization** | Clef-agnostic voice IDs → **staff-lane + register continuity** in solver; MusicXML mapping is emit-only |
| **Onset grid** | Implicit x→division → **first-class `onsetColumns[]` in IR** with confidence; solver picks column membership |
| **Duration model** | Single `duration` field → **written duration** + **sounding release** (tie/slur/pedal aware) |
| **Chord model** | Same-x merge rules → **hard constraint**: chord tones share onset+written duration in one voice |
| **Promotion** | Global sims → **per-measure** simulate→evaluate→promote with corpus revert |
| **Diagnostics** | Ad-hoc traces → **stage-attributed** reports (matcher vs serialization vs solver) |

### 2.2 Do not change (V2 scope boundaries)

- PDF raster fallback quality (separate track).  
- Notehead detection thresholds / dedupe gates (detection is solved on dense).  
- Benchmark pass/fail **thresholds** (gates compare ≥ baseline, not relaxed bars).  
- Score Follow anchor geometry source (`omrMeasureGridMeta`).  
- Hardcoded piece/measure fixes.  
- Full ScoreGraph **rewrite** — extend and unify existing `scoreGraph.js` + beam graph.  
- End-to-end neural OMR as first move (wrong cost/latency/regression profile for in-browser product).

---

## 3. Design decisions: five subsystems

### 3.1 Onset grid — **Improve (IR + solver, not more snap rules)**

**Current:** Position-derived divisions with `mergeGroupsSharingBeat`, sixteenth cluster snap, phantom column sims.

**Problem:** Hotspots show **correct snap, wrong column/voice assignment**. Re-simulating cluster snap moved **zero** wrongOnset on dense.

**V2:**

- Store `onsetColumns[]` on `MeasureGraph`: `{ division, xCenter, confidence, noteheadIds[] }`.  
- Solver **assigns** noteheads to columns (soft: x proximity; hard: monotonic within voice).  
- **Do not** add more global snap heuristics without per-measure promotion.

**Impact:** Medium–high (fixes unique-pitch-slot-shift tail; enables solver).  
**Risk:** Low if observation-only first; medium when promoted.

### 3.2 Voice serialization — **Highest impact — redesign**

**Current:** `buildOmrMusicXml` maps clef/staff → voices 1–2 (piano) or 5 for grand-staff bass lane in truth vs 2 in generated. Rhythm inferred **before** stable voice identity.

**Problem:** 35/94 onsets are `serialization-voice-shift` (+0.5q, +0.75q). Twinkle m10: 100% of errors are accompaniment lane late by one eighth.

**V2:**

- Solver variables include **`voiceId`** per notehead (staff lane + register continuity + beam graph edges).  
- MusicXML voice numbers are **export labels** only, derived from solver lanes — not input to rhythm.  
- Grand-staff **accompaniment figure** is a first-class lane template (bass staff, repeating rhythmic pattern).

**Impact:** **Highest** for wrongOnset + chordMismatch on dense.  
**Risk:** **High** — Twinkle m10 is the canary; broad voice rules caused prior regressions.

### 3.3 Written vs sounding duration split — **Improve (solver hard constraints)**

**Current:** Single duration per event; heuristics (`extendDurationsPerClefVoice`, harmonic half-span, quarter-floor, etc.) conflate **notation** with **heard length**.

**Problem:** 44/77 duration errors are **onset-coupled** — fixing onset without duration model fails evaluator.

**V2:**

- **`writtenDurationDivisions`** — what appears on the page (beams, flags, dots).  
- **`soundingReleaseDivision`** — when the pitch stops (tie continues, slur legato may differ).  
- WFY/playback consume **sounding** onset+release; evaluator compares **written** unless tie-linked.

**Impact:** High for wrongDuration + onset-coupled bucket.  
**Risk:** Medium — tie/slur model must be consistent or slur bucket (800 on dense) grows.

### 3.4 Tie / slur model — **Improve incrementally (Phase 4+)**

**Current:** `detectVectorTies.js`, slur diagnostics; large slur **evaluator** bucket (800) mostly marking/articulation mismatch, not primary rhythm blocker.

**V2:**

- IR edges: `tie_links`, `slur_groups` with confidence.  
- Hard constraint: tie = same pitch, no reattack, budget spans barline.  
- Slur = soft same-voice legato (does not merge onsets in V2.0).

**Impact:** Medium long-term; not first sprint.  
**Risk:** Low if ties only in solver hard constraints first; slurs remain diagnostic.

### 3.5 Measure-level solver — **Yes — core V2 engine**

**Current:** `scoreGraphSolver.js` promotes **clip** decisions with confidence; full joint solve is design-only.

**V2 engine (per `omr-phase3-solver-design.md`):**

- **Variables:** `(voiceId, onsetDivision, writtenDuration)` per notehead.  
- **Hard:** measure budget tiles; chord shared onset+duration; voice monotonic onsets; tie links.  
- **Soft:** beam/stem edges, beat grid, minimal voices, register continuity, gap-to-next-onset.  
- **Algorithm:** bounded beam search over onset columns (K-best partials).  
- **Promotion:** offline calibration on benchmark + runtime confidence threshold.

**Impact:** **Highest** — addresses coupled m61/m97 class failures.  
**Risk:** Medium — must beat greedy beam sims that regressed duration 80.96%→80.89%.

---

## 4. Target architecture (layers)

```text
┌─────────────────────────────────────────────────────────────┐
│  Layer 0 — Detection (unchanged in V2.0)                     │
│  glyphs, noteheads, rests, accidentals, beams, stems, ties   │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 1 — Score Graph IR (unify, observation-only)          │
│  nodes, edges, onsetColumns[], measure budget, grid meta       │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2 — Per-measure solver (NEW engine)                   │
│  MAP / beam search → voice + onset + written duration          │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 3 — Sounding span resolver                            │
│  ties, pedal, written→sounding release                       │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 4 — MusicXML emitter (thin)                           │
│  buildOmrMusicXml from solved measureRhythms only            │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 5 — Evaluation & promotion gate                       │
│  per-measure + corpus metrics; shadow vs runtime             │
└─────────────────────────────────────────────────────────────┘
```

**Runtime contract:** Layers 0–1 unchanged bytes until promotion. Layer 2+ runs in **shadow** until evaluator ≥ runtime on all axes.

---

## 5. Phased implementation plan

### Phase 0 — Planning lock (this sprint) ✅

- Document audit, decisions, gates (this file).  
- No runtime changes.

### Phase 1 — Safest first sprint (diagnostics + IR completeness)

**Goal:** Measure the right things; attribute errors to matcher vs serialization vs solver input.

| Work | Risk |
|------|------|
| Extend benchmark dashboard with **error attribution** columns (serialization / matcher / independent) | None |
| Per-measure **onset trace** export in standard dashboard run (`omrOnsetVoiceTrace.js` — exists) | None |
| ScoreGraph: ensure `onsetColumns`, beam edges, measure budget on every dense measure | Low |
| **Written vs sounding** fields on IR nodes (nullable, unused by runtime) | None |
| Tests: pin m7/m9/m10 trace counts; IR parity tests | None |

**Benchmark gate:** Gymnopédie **byte-identical**; dense metrics **unchanged** (±0).

**Tests:** `tests/omrDiagnostics.test.js`, `tests/scoreGraph*.test.js`, dashboard snapshot tests.

---

### Phase 2 — Highest impact sprint (shadow solver, first family)

**Goal:** Joint solve **mixed-ownership onset columns** where beam graph flags `splitCandidate` / budget violation (~24 dense measures).

| Work | Risk |
|------|------|
| Implement measure solver in **shadow only** (`scoreGraphSolver.js` extension) | Medium |
| First family: mixed beam ownership + sustained inner voice | Medium |
| Emit via shadow MusicXML path; compare per-measure vs runtime | Medium |
| Weight tuning on benchmark (coordinate search, offline) | Low |

**Benchmark gate (promotion to runtime for **eligible measures only**):**

| Fixture | Requirement |
|---------|-------------|
| Gymnopédie | Byte-identical (no promoted measures on clean) |
| Cruel Angel | wrongOnset ↓ ≥15%; wrongDuration ↓ ≥10%; chordMismatch ↓ ≥10%; pitch/F1/noteΔ/measureΔ **≥ baseline** |
| Twinkle | wrongOnset m10 → **0**; no other metric regression |

**Tests:** `tests/omrBenchmarkDashboard.test.js`, new `tests/scoreGraphSolver.test.js`, per-measure promotion unit tests, full evaluator on shadow output.

---

### Phase 3 — Voice-aware serialization (shadow → selective promote)

**Goal:** Fix accompaniment-lane phase shift (truth v5 vs gen v2).

| Work | Risk |
|------|------|
| Solver voice lanes: grand-staff bass accompaniment template | **High** |
| Decouple `buildOmrMusicXml` voice numbering from rhythm inference | **High** |
| Promote only measures passing Twinkle m10 + dense m7–m9 canaries | **High** |

**Benchmark gate:** Same as Phase 2 plus **serialization-voice-shift class ↓ ≥50%** on dense trace.

**Tests:** Twinkle m10 dedicated regression; voice-lane continuity tests; MusicXML voice map snapshot tests.

---

### Phase 4 — Written/sounding split + tie hard constraints

**Goal:** Collapse onset-coupled duration bucket (44 samples).

| Work | Risk |
|------|------|
| Solver emits `writtenDuration` + `soundingRelease` | Medium |
| Tie hard constraints in solver; slurs soft/diagnostic | Medium |
| Playback uses sounding span (verify WFY/playback unchanged on clean) | Medium |

**Benchmark gate:** wrongDuration ↓ ≥25% vs Phase 2 baseline; onset-coupled duration share ↓; clean unchanged.

**Tests:** Tie recall tests (`tests/omrTieRecall.test.js`), duration error analysis tests, playback schedule tests.

---

### Phase 5 — Hybrid detector fusion (optional ML weights)

**Goal:** Learn soft-constraint weights from benchmark edges (not end-to-end OMR).

| Work | Risk |
|------|------|
| Logistic/GBDT edge scorer trained on labeled IR edges | Low–medium |
| Runtime: same solver, learned weights | Medium |

**Benchmark gate:** Dense all-axis ≥ Phase 4; no clean movement.

---

### Phase 6 — Production rollout

| Work | Risk |
|------|------|
| Feature flag `omrEngineV2: 'off' \| 'shadow' \| 'promote'` | Low |
| Default promote on calibrated families; V1 heuristics as fallback | Medium |
| Remove redundant `processVectorOmrPage` mutations only after shadow ≥ runtime corpus-wide | High |

**Benchmark gate:** Dashboard **PASS** on clean+dense+simple with metrics strictly ≥ current `tmp/omr-benchmark-dashboard/report.md` baseline.

---

## 6. Sprint priority matrix

| Sprint | Safety | Impact | When |
|--------|--------|--------|------|
| **Phase 1** diagnostics/IR | ★★★★★ | ★★☆☆☆ | **First** |
| **Phase 2** measure solver (mixed-ownership) | ★★★☆☆ | ★★★★★ | **Highest impact** |
| Phase 3 voice serialization | ★★☆☆☆ | ★★★★★ | After Phase 2 proves gate |
| Phase 4 written/sounding + ties | ★★★☆☆ | ★★★★☆ | After voice stable |
| Phase 5 learned weights | ★★★☆☆ | ★★☆☆☆ | Optional |
| Phase 6 production | ★★☆☆☆ | ★★★★★ | Last |

---

## 7. Benchmark gates (no threshold changes)

Use **existing** dashboard fixtures and evaluator — compare **relative to frozen baseline**, not relaxed pass bars.

### Frozen baseline (2026-07-03 dashboard)

| Fixture | wrongOnset | wrongDuration | chordMismatch | wrongPitch | missing/extra |
|---------|----------:|--------------:|--------------:|-----------:|--------------|
| Gymnopédie | 0 | 0 | 0 | 0 | 0/0 |
| Cruel Angel | **94** | **77** | **172** | **147** | 28/28 |
| Twinkle | 6 | 3 | 0 | 0 | 0/0 |

### Corpus revert rule (every phase)

Promotion or weight change **reverts** if **any** of:

- Gymnopédie: pitch, duration, onset, chord, F1, noteΔ, measureΔ not **100% / 0**.  
- Cruel Angel: any of pitch%, duration%, onset%, chord%, F1, noteΔ, measureΔ **&lt; baseline**.  
- Twinkle: pitch **&lt; 100%** or chord **&lt; 100%** or F1 **&lt; 100%**.

### Per-measure promotion rule (runtime)

Reuse `phantomColumnCorrection` pattern:

1. Measure ∈ candidate family (enumerable from IR).  
2. Solver assignment passes **hard constraints**.  
3. Solver objective margin ≥ **offline-calibrated** threshold.  
4. Shadow evaluator ≥ runtime on that measure (offline calibration).  
5. Else: keep runtime bytes.

---

## 8. Tests required (by phase)

| Phase | Required tests |
|-------|----------------|
| **1** | `omrDiagnostics.test.js` (onset trace pins); ScoreGraph parity; dashboard report schema; error attribution unit tests |
| **2** | `scoreGraphSolver.test.js` (budget tiling, mixed-ownership fixtures); shadow-vs-runtime diff harness; benchmark dashboard integration |
| **3** | Twinkle m10 regression; grand-staff voice lane tests; MusicXML voice export snapshots |
| **4** | `omrTieRecall.test.js` extension; written vs sounding unit tests; `omrDurationErrorAnalysis` category shift |
| **5** | ML weight loader tests; solver determinism with fixed weights |
| **6** | `launchReadiness` OMR guards; full `npm test`; `omr:benchmark-dashboard`; PDF OMR hard-PDF tests |

**Continuous:** `tests/omrAccuracyEvaluator.test.js`, `tests/omrBenchmarkDashboard.test.js`, `tests/pdfOmrHardPdf.test.js`.

---

## 9. Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Voice serialization fix regresses Twinkle m10 | High | High | m10 canary + per-measure promote only |
| Solver overfits dense / Cruel Angel | Medium | High | Clean byte-identical gate; simple fixture; hold-out PDFs |
| Beam sim repeat (duration 80.96→80.89) | Medium | Medium | Joint budget constraint; no greedy global split |
| Evaluator matcher confounds metrics | High | Medium | Phase 1 attribution; report matcher-sourced separately |
| Slur/tie scope creep | Medium | Medium | Ties hard in Phase 4; slurs diagnostic-only in V2.0 |
| Score Follow grid drift | Low | Critical | `omrMeasureGridMeta` unchanged; IR observation-only first |
| Browser perf on solver | Low | Medium | Measure-sized beam search; cap K; worker optional |
| Team maintains two engines | Medium | Medium | Feature flag; delete heuristics only after corpus gate |

---

## 10. What we explicitly will not do in V2.0

- Global “opening column” or “terminal phantom” broadening (proven regressions).  
- Extend `innerVoicePhaseCorrection` to beat 0 without per-measure gates.  
- Another feed-forward mutation chain in `processVectorOmrPage.js`.  
- Lower benchmark thresholds to claim progress.  
- Piece-specific `if (measure === 9)` logic.  
- Server-side OMR or cloud transcription dependency.

---

## 11. Success criteria (planning sprint)

After this document, the team should know:

- [x] **What** the current pipeline does and where dense errors originate  
- [x] **Why** voice-phase serialization / rhythm inference is the root cause  
- [x] **Which** subsystems to improve (onset IR, voice solver, written/sounding split, measure solver; ties incremental; slurs later)  
- [x] **Safest first sprint:** Phase 1 diagnostics + IR  
- [x] **Highest impact sprint:** Phase 2 per-measure solver on mixed-ownership family  
- [x] **Gates, tests, and risks** for each phase  

**Next actionable step:** Execute **Phase 1** — wire error attribution into `omr-benchmark-dashboard` standard output and add nullable `writtenDuration` / `soundingRelease` fields to ScoreGraph IR (observation-only, zero runtime bytes).

---

## Appendix A — Module map (V2 touchpoints)

| Concern | Current | V2 role |
|---------|---------|---------|
| Vector detect | `processVectorOmrPage.js` | Layer 0 — freeze heuristics |
| IR | `scoreGraph.js` | Layer 1 — extend |
| Solver | `scoreGraphSolver.js` | Layer 2 — implement |
| Onset trace | `omrOnsetVoiceTrace.js` | Phase 1 metrics |
| Beam graph | `beamStemReconstructionDiagnostics.js` | Soft constraints |
| Voice sim | `beamOwnershipVoiceSimulation.js` | Retire after solver |
| Post-pass | `runPdfOmrPipeline.js` | Shrink as solver promotes |
| MusicXML | `buildOmrMusicXml.js` | Layer 4 — emit only |
| Eval | `omrAccuracyEvaluator.js` | Gates + attribution |

## Appendix B — Hotspot measures (dense promotion canaries)

| Measure | wrongOnset | Notes |
|---------|----------:|-------|
| m9 | 18 | Largest; repeated figure + serialization |
| m7 | 8 | serialization + cross-voice matcher |
| m8 | 7 | opening treble phase |
| m121 | 9 | coda bass register |
| Twinkle m10 | 6 | simple legacy-font canary |

---

*Planning document only. No runtime OMR algorithms were modified in this sprint.*
