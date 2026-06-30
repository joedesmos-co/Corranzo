# OMR onset diagnosis (early-page / m9 focus)

**Baseline:** `tmp/omr-benchmark-dashboard/fixtures/dense.json` (post staff-gap normalization)  
**Scope:** 94 wrongOnset total, 41 independent (pitch+duration OK)  
**Code changes:** None

---

## Executive summary

| Verdict | Cause |
|---------|-------|
| **Primary (41 independent)** | **Two-layer:** (1) **Matcher instance coupling** on repeated pitch classes — 27/41 (66%); (2) **Real sixteenth-grid phase slip** — systematic **+0.5q / +0.75q late** on remaining unique-pitch cases |
| **Secondary (53 coupled)** | Onset errors with pitch/duration mismatch — mostly **matcher pairing wrong instances** when onset slips (m9 beat 0: truth A#4 → gen C3, pitchΔ −22) |
| **Contributing** | Dense-measure **eighth-note `snapStartDivision`** in cluster phase vs **sixteenth `startDivisionFromPosition`** later; m9 opening **2.5q bass sustain** at beat 0 |
| **Minor** | `positionInMeasure` spans **x0→x1** (barline box), not **playableStart→playableEnd**; box `playableX0` equals x0 for non-first measures |
| **Ruled out** | Wrong measure barline bounds (grid reliable); pickup-only issue (m9 is mid-system); page 8 onset (only 6/41 independent) |

**No obvious safe fix to ship.** Next work should separate matcher instance errors from true rhythm-slot bugs before coding.

---

## 1. Error inventory

### Raw counts

| Bucket | Count |
|--------|------:|
| wrongOnset | 94 |
| Independent (pitch+dur OK) | **41** |
| Coupled (pitch or dur wrong) | 53 |
| Duration onset-coupled | 53 |

### Top onset deltas (all 94)

| Δ (q) | Count |
|------:|------:|
| +0.5 | 61 |
| +0.75 | 33 |

**100% of errors are +0.5q or +0.75q late** — no early bias.

### Independent onset deltas (41)

| Δ (q) | Count |
|------:|------:|
| +0.5 | 24 |
| +0.75 | 17 |

### Top measures (independent)

| m | page | sys | indep | total wrongOnset |
|--:|:----:|:---:|:-----:|:----------------:|
| **9** | **1** | 2 | **13** | **18** |
| 7 | 1 | 2 | 5 | 8 |
| 8 | 1 | 2 | 3 | 7 |
| 70 | 5 | — | 3 | — |
| 121 | 8 | 1 | 3 | — |

**Page 1: 22/41 independent (54%).** m9 is the hotspot but not the whole story.

### Top truth→gen patterns (independent)

| Pattern | Count |
|---------|------:|
| 2 → 2.5 | 5 |
| 0.5 → 1.25 | 4 |
| 1 → 1.5 | 4 |
| 1.5 → 2.25 | 3 |
| 0 → 0.5 | 3 |
| 3 → 3.75 | 3 |

Alternating **+0.5q** and **+0.75q** matches **sixteenth-grid phase slip** (2 vs 3 sixteenth slots).

---

## 2. m9 deep dive (page 1, system 2)

### Measure geometry

| field | value |
|-------|------:|
| xStart / xEnd | 0.552 / 0.967 |
| playableStart / playableEnd (grid) | 0.5708 / 0.9295 |
| firstNoteX | 0.5758 |
| playableX0 (box) | 0.552 (= x0, not first-in-system trim) |
| playable vs x0 delta | +0.0188 |

Barlines OK (`reliabilityReason: ok`). Playable width ≈ 0.359 of page; position denominator uses full box width 0.415.

### Rhythm mode

- `shouldInferRhythmFromPositions`: **true** (dense sixteenth grid)
- 19 note events, 38 noteheads detected / emitted

### Opening event (suspicious)

| startQ | durQ | pos | xNorm | role |
|-------:|-----:|----:|------:|------|
| **0** | **2.5** | 0.057 | 0.576 | bass |

A **2.5-quarter bass sustain** at beat 0 consumes most of the measure opening — may compress or displace later cluster slot assignment.

### x position vs assigned onset (selected events)

| startQ | durQ | pos | xNorm | onset from x | Δ (start − x) |
|-------:|-----:|----:|------:|-------------:|--------------:|
| 0 | 2.5 | 0.057 | 0.576 | 0.23 | −0.23 |
| 0.5 | 0.25 | 0.100 | 0.594 | 0.40 | **+0.10** |
| 0.75 | 0.5 | 0.212 | 0.640 | 0.85 | −0.10 |
| 1.25 | 0.25 | 0.315 | 0.683 | 1.26 | −0.01 |
| 1.5 | 0.5 | 0.394 | 0.716 | 1.58 | −0.08 |
| 2.0 | 0.25 | 0.473 | 0.748 | 1.89 | **+0.11** |
| 2.25 | 0.25 | 0.562 | 0.785 | 2.25 | 0.00 |
| 2.5 | 0.5 | 0.641 | 0.818 | 2.56 | −0.06 |

Glyph x positions are **internally consistent** with sixteenth spacing (~0.08–0.09 pos per 0.25q). Assigned `startQ` sometimes lags or leads x-implied onset by ~0.1q — cluster snapping artifact.

### Independent m9 errors (13) — two subtypes

**A. Repeated pitch (7/13) — matcher instance coupling**

| truth | generated | Δ | instances of label in m9 |
|-------|-----------|--:|:------------------------:|
| A#1@0.5 | A#1@1.25 | +0.75 | 4 |
| F2@0.5 | F2@1.25 | +0.75 | 3 |
| A#2@0.5 | A#2@1.25 | +0.75 | 5 |
| A#4@0.5 | A#4@1.25 | +0.75 | 4 |
| A#1@1 | A#1@1.5 | +0.5 | 4 |
| … | … | … | … |

Gen **does** emit events near 0.5q and 1.25q; matcher links truth beat 0.5 instance to gen beat 1.25 instance (same label, wrong slot).

**B. Unique pitch (6/13) — real slot shift**

| truth | generated | Δ |
|-------|-----------|--:|
| B1@1.5 | B1@2.25 | +0.75 |
| F#2@1.5 | F#2@2.25 | +0.75 |
| B2@1.5 | B2@2.25 | +0.75 |
| C2@2 | C2@2.5 | +0.5 |
| G2@2 | G2@2.5 | +0.5 |
| A#4@2 | A#4@2.5 | +0.5 |

These cannot be explained by label swapping alone — **rhythm pipeline assigns onset ~1 slot late**.

### Coupled m9 examples (matcher noise)

| truth@beat | gen@beat | pitchΔ | note |
|------------|----------|-------:|------|
| A#4@0 | C3@0.5 | −22 | cross-voice pairing |
| D4@0 | F3@0.5 | −9 | onset slip + wrong match |
| A#1@0 | C2@0.75 | +2 | pitch + onset |

---

## 3. Cause classification

### Beat grid phase offset — **CONFIRMED (subset)**

Unique-pitch independent errors shift by exactly **+0.5q or +0.75q** (2–3 sixteenth slots). Score-wide pattern, not m9-only.

### Sixteenth/eighth snapping — **CONFIRMED (mechanism)**

In `buildNoteEventsFromGroups` when `usePositionStarts`:

1. Cluster phase uses `snapStartDivision` → **eighth grid** (`grid = divisions/2`)
2. Remap uses `startDivisionFromPosition` → **sixteenth grid** when `denseMeasure`

This inconsistency can shift dense measures by 0.5q or 0.75q depending on cluster merge order.

### Wrong measure x bounds — **RULED OUT**

m9 barlines confident; note x positions monotonic and evenly spaced within playable region.

### Chord grouping phase — **PARTIAL**

Bass/treble at same x sometimes split across adjacent startQ (e.g. both at pos 0.100 but assigned 0.5q). Not the dominant +0.75 pattern.

### Cross-staff matcher coupling — **CONFIRMED (66% of independent)**

27/41 independent errors occur when truth label appears **≥2× in the measure** and truth label === gen label. Repeated A#/F/Bass figures in m9 drive apparent onset errors without wrong glyph x.

### Pickup / leading-space — **PARTIAL**

m9 is not first-in-system (no playableX0 trim). Opening 2.5q bass at beat 0 may act like erroneous pickup sustain.

---

## 4. Coupling to other buckets

| bucket | linkage |
|--------|---------|
| Duration onset-coupled (53) | Same +0.5/+0.75 slips; fixing true slot assignment should reduce |
| wrongPitch (coupled) | 81 pitch errors have onset≠0; many are matcher swaps when onset slips |
| chordMismatch (239) | m61/m25 phase shifts are onset-grid coupled; page 8 chord mismatch = 1 |

Fixing **true rhythm slots** (~14 independent unique-pitch cases score-wide) is smaller than fixing **matcher instance matching** (~27 cases) or **full sixteenth snap pipeline** (could affect 61+53 coupled).

---

## 5. Proposed safe fix

### **Do not ship code this pass**

| candidate | risk | reason deferred |
|-----------|------|-----------------|
| Sixteenth `snapStartDivision` for dense measures | medium | plausible but needs unit test on m9 + full benchmark; could move coupled errors |
| `positionInMeasure` use playableEnd | medium | denominator change affects all vector rhythm |
| Opening 2.5q bass clamp at m9 | low scope but unproven | single-measure symptom; need pattern across m7–9 |
| Evaluator instance-aware matching | N/A for OMR | would reduce wrongOnset count without fixing OMR |

### Recommended next steps (analysis before code)

1. **Split the 41 independent errors** into `duplicate-pitch-instance` (27) vs `unique-pitch-slot-shift` (14) in benchmark dashboard.
2. **Unit test:** m9 x→startQ mapping with frozen glyph fixtures; assert B1@1.5 not 2.25.
3. **If rhythm fix pursued:** align cluster `snapStartDivision` to sixteenth grid when `denseMeasure` — benchmark clean + dense before/after.
4. **Defer chord m61/m25** until onset slot assignment is validated.

### Estimated upside (if sixteenth snap + opening sustain fixed)

| bucket | conservative |
|--------|-------------|
| wrongOnset | 94 → ~50–65 |
| onset-coupled duration | 53 → ~30–40 |
| apparent pitch/chord | partial knock-on |

Instance-aware matching (evaluator-only) could drop independent wrongOnset by ~27 without OMR changes — do not confuse with engine improvement.

---

## 6. Artifacts

- `tmp/omr-benchmark-dashboard/onset-diagnosis.json` — score-wide + m9 x/beat table
- `tmp/omr-benchmark-dashboard/onset-diagnosis-m9.json` — m9 replay (partial)
- Prior: `post-staff-gap-rerank.md`

---

## Decision

**No code.** Root cause is split between **matcher instance coupling** (majority of “independent” onset errors) and a **narrower real sixteenth-grid phase slip** (~14 cases). Next iteration should quantify both paths before any rhythm snap change.
