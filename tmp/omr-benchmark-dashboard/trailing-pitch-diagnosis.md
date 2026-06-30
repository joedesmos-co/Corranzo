# Trailing-page pitch diagnosis (m119–125)

**Baseline:** `tmp/omr-benchmark-dashboard/fixtures/dense.json` (post quarter-floor rerank)  
**Scope:** 107 / 173 wrong-pitch errors (61.8%), all in measures 119–125  
**Code changes:** None (analysis only)

---

## Executive summary

| Verdict | Cause |
|---------|-------|
| **Primary** | **Staff-line detection drift on PDF page 8** — detected line gaps ~38% larger than the score-wide norm (0.0083 vs 0.00601), with asymmetric upper/lower gaps on systems 0 and 2 |
| **Secondary** | **±1 diatonic staff-step rounding** — manifests as ±2 semitone errors (61/107); gap inflation shifts `Math.round` in `midiFromStaffPosition` by one step |
| **Contributing** | **Accidental loss on sharps** — after step correction, many A#/D#/G# truths would land on adjacent naturals (e.g. A#1→C2 is one diatonic step up; gap-normalization alone yields B1) |
| **Inflating count** | **Evaluator onset coupling** — 51/107 (48%) have nonzero onset delta; matcher pairs wrong notes when onset slips, adding apparent pitch errors |
| **Ruled out** | Wrong bass/treble clef assignment (notes correctly routed to `lower`/`bass` or `upper`/`treble`); measure misallocation (measureΔ = 0); note-count mismatch (counts match per measure) |

**Safe fix direction (next pass, not shipped here):** Page-local staff-line gap normalization — when a system's detected gap deviates >15% from the document median, re-space lines from measured stave bounds using the median gap. Scope to page 8 / final-page systems only; do **not** change global pitch mapping or clef heuristics.

---

## 1. Error inventory (m119–125)

### By measure

| m | wrongPitch | page | system |
|--:|-----------:|:----:|:------:|
| 119 | 10 | 8 | 0 |
| 120 | 11 | 8 | 0 |
| 121 | 11 | 8 | 0 |
| 122 | 20 | 8 | 1 |
| 123 | 14 | 8 | 1 |
| 124 | 15 | 8 | 1 |
| 125 | 26 | 8 | 2 |

**All 107 errors are on page 8.** Page 7 trailing measures are clean: m115–m116 = 0, m117 = 1, m118 = 0.

### Top pitch deltas (signed semitones)

| Δ | count |
|--:|------:|
| +2 | 32 |
| −2 | 29 |
| −1 | 14 |
| +1 | 11 |
| −3 | 9 |
| other | 12 |

**61 / 107 (57%)** are exactly ±2 semitones — consistent with ±1 diatonic staff step.

### Top truth→generated pairs

| Pair | count | Pattern |
|------|------:|---------|
| C3→A#2 | 14 | −1 diatonic step |
| A#1→C2 | 9 | +1 diatonic step |
| C2→D2 | 8 | +1 diatonic step |
| A#2→G#2 | 7 | −1 diatonic step |
| F3→D3 | 5 | −1 diatonic step |
| C5→D5 | 4 | +1 diatonic step (treble) |
| G5→F5 | 4 | −1 diatonic step (treble) |
| A#4→B4 | 4 | +1 semitone (accidental) |

### Staff / voice distribution

| Bucket | count |
|--------|------:|
| Truth voice 5 (bass LH) | 77 |
| Truth voice 1 | 30 |
| Truth octave ≤ 2 (bass register) | 46 |
| Truth octave ≥ 4 (treble register) | 30 |

Production replay (page 8, onset-matched notes): **26 / 35** wrong pitches on `lower` staff, **9 / 35** on `upper`.

---

## 2. Cause classification

### Staff-line detection drift — **CONFIRMED (primary)**

Compared detected staff-line gaps (normalized y) across pages:

| Page | median upper gap | median lower gap | notes |
|:----:|-----------------:|-----------------:|-------|
| 1 | 0.00601 | 0.00601 | reference |
| 7 | 0.00601 | 0.00601 | m116–118 correct |
| **8** | **0.00830** | **0.00830** | **+38% vs norm** |

Page 8 per-system gaps (from production measure boxes):

| system | measures | upper gap | lower gap | vs 0.00601 |
|:------:|----------|----------:|----------:|-----------:|
| 0 | 119–121 | 0.00636 | **0.00830** | lower +38% |
| 1 | 122–124 | 0.00830 | 0.00830 | both +38% |
| 2 | 125 | **0.00936** | 0.00760 | upper +56%, asymmetric |

System bounding-box span (`yBottom − yTop`) is normal (~0.086) on page 8 — the **line spacing within the box** is wrong, not the overall system extent.

`midiFromStaffPosition` uses:

```javascript
diatonicOffset = Math.round(((bottom - yNorm) / lineGap) * 2)
```

An inflated `lineGap` changes the rounded step; a 38% gap error routinely pushes mapping ±1 diatonic step — exactly the observed ±2 semitone mass.

**Gap-normalization simulation** (anchor bottom line, rescale to 0.00601, replay pitch on 35 onset-matched notes): **8 / 35 fixed**. Partial — confirms drift is real but not the only layer.

### Wrong clef assignment — **RULED OUT**

Replayed notes via `buildVectorMeasureRecord` on page 8. Bass-register errors use `clef: 'bass'`, `staffRole: 'lower'`. Treble errors use `clef: 'treble'`, `staffRole: 'upper'`. No systematic treble/bass flip.

`resolveClefSignForStaffRole` deep-bass override is not misfiring on these examples.

### Final-system geometry — **PARTIAL**

Page 8 has only 3 systems (short final page). System 2 is a **single-measure** final system (m125) with the worst gap asymmetry (upper 0.00936, lower 0.00760). m125 has the highest error count (26). Geometry is a contributor on sys 2, but sys 0–1 also show inflated gaps and high error counts.

### Ledger-line mapping — **UNLIKELY primary**

Errors are predominantly on-staff bass (C2–F3) and treble (G4–G5) material, not extreme ledger territory. `MIN_LEDGER_DIATONIC_OFFSET` rejections are not implicated.

### y-center / staff-step rounding — **SECONDARY (symptom)**

`resolveNoteheadYNorm` applies a small centering shift. The dominant error signature is ±1 diatonic step from gap scale, not sub-step y jitter. Centering tweak alone would not explain 61 × ±2 semitone errors.

### Accidental / key issue — **SECONDARY**

25 errors are ±1 semitone (A#→B, G2→F#2, etc.). Several ±2 cases involve sharps where gap-normalization lands on the wrong natural:

| truth | generated | gap-fix replay | interpretation |
|-------|-----------|----------------|----------------|
| A#1 | C2 | B1 | step drift + missing A# alter |
| A#2 | G#2 | B2 | step drift |
| D#2 | F2 | F2 | step drift masks as “correct natural” |
| G4 | G#4 | — | pure accidental (+1) |

Key signature detection is inherited from page 1; no page-8 key-change evidence.

### Evaluator matching artifact — **PARTIAL (48%)**

| subset | count |
|--------|------:|
| onset delta = 0 | 56 |
| onset delta ≠ 0 | 51 |

The 56 onset-aligned errors are **real mapping bugs**. The 51 onset-coupled cases may include mis-paired notes (e.g. m119 beat 3: truth D#3 vs gen G2, onsetD = 0.25). Fixing onset quantization on page 8 may reduce apparent pitch errors without any pitch-mapping change.

Note counts per measure match truth (e.g. m125: 35 vs 35, 1 missing + 1 extra from one mis-pitch pair). F1 98.93% — not a note-detection problem.

---

## 3. Staff diagnostics: page 8 vs earlier correct systems

| metric | page 7 sys 5 (m116–118) | page 8 sys 0 (m119–121) | page 8 sys 2 (m125) |
|--------|------------------------:|------------------------:|--------------------:|
| wrongPitch in range | 1 (m117 only) | 32 | 26 |
| upper line gap | 0.00601 | 0.00636 | 0.00936 |
| lower line gap | 0.00601 | 0.00830 | 0.00760 |
| ySpan | 0.0863 | 0.0862 | 0.0870 |
| barline reliability | ok | ok | ok |

Barline / measure grid diagnostics on page 8 are **confident** (`reliabilityReason: ok`). This is not a measure-split issue — staff **line spacing within** correctly-bounded systems is wrong.

---

## 4. Generated vs truth examples

### Bass — one diatonic step (onset-aligned)

| m | beat | truth | generated | Δ | yNorm | clef | bass gap |
|--:|-----:|-------|-----------|--:|------:|:-----:|---------:|
| 119 | 0 | A#1 | C2 | +2 | 0.1762 | bass | 0.00830 |
| 119 | 0 | A#2 | G#2 | −2 | 0.1554 | bass | 0.00830 |
| 120 | 0 | C2 | D2 | +2 | 0.1732 | bass | 0.00830 |
| 120 | 0 | C3 | A#2 | −2 | — | bass | 0.00830 |
| 122 | — | C2 | D2 | +2 | 0.3484 | bass | 0.00830 |
| 125 | — | (multiple) | — | ±2 | — | bass | 0.00760 |

### Treble — same step pattern on inflated upper gap

| m | beat | truth | generated | Δ |
|--:|-----:|-------|-----------|--:|
| 122 | — | C5 | D5 | +2 |
| 122 | — | G#4 | A#4 | +2 |
| 123 | — | A#4 | C5 | +2 |
| 123 | — | G5 | F5 | −2 |

### Onset-coupled (matcher noise likely)

| m | beat (truth) | truth | generated | onsetD |
|--:|-------------:|-------|-----------|-------:|
| 119 | 1.0 | A#2 | C3 | +0.5 |
| 119 | 3.0 | D#3 | G2 | +0.25 |
| 120 | 3.0 | F3 | A#2 | +0.75 |

---

## 5. Proposed safe fix (not implemented)

### Recommended: page-local staff gap normalization

**What:** After `estimateGrandStaffLines` / per-measure staff line extraction on each system, if `staffLineGap(lower)` or `staffLineGap(upper)` deviates >15% from the document median gap (computed from pages 1–7), re-space the five lines uniformly from the detected stave `y0`/`y1` bounds using the median gap.

**Why safe:**
- Targets only the demonstrated failure mode (page 8 gap inflation).
- Does not alter clef logic, accidental assignment, or global pitch tables.
- Page 7 trailing systems prove the median gap is correct for this score.
- Simulation fixes ~23% of onset-aligned errors outright; remainder need accidental pass.

**Guards:**
- Apply only when ≥3 prior pages establish a stable median gap.
- Require measured stave bounds (`system.staves`) — do not synthesize from system height alone on final page.
- Do not apply if gap deviation is <15% (avoid churn on clean pages).
- Benchmark clean + dense after any implementation; revert on any regression.

### Not recommended now

| approach | reason |
|----------|--------|
| Blind `midiFromStaffPosition` rounding tweak | would affect all pages |
| Global clef heuristic change | clef routing is correct; evidence points to line spacing |
| Harmonic-span / chord rules | unrelated; user constraint |
| Evaluator matcher change | real mapping errors exist at correct onset (56 cases) |

### Secondary follow-up (after gap fix)

1. Re-run trailing-page accidental pass for A#/D# on page 8 bass (voice 5).
2. Onset quantization on page 8 (51 coupled cases) — may clear residual pitch noise without pitch changes.

---

## 6. Impact estimate

| metric | current | if gap fix + accidentals (est.) |
|--------|--------:|--------------------------------:|
| wrongPitch (total) | 173 | ~90–110 |
| wrongPitch m119–125 | 107 | ~25–45 |
| pitch accuracy | 92.74% | ~95–96% |

Estimate assumes gap normalization recovers most ±2 onset-aligned step errors; onset-coupled and ±1 accidental cases remain.

---

## 7. Validation

- `npm test`: **135 files, 1291 passed** (no code changes)
- Artifacts: `tmp/omr-benchmark-dashboard/trailing-pitch-diagnosis.json`

---

## Decision

**No code this pass.** Root cause is identified and scoped (page 8 staff-line gap drift). A narrow gap-normalization rule on final-page systems is the highest-confidence next fix, but needs implementation + before/after benchmark per project protocol.
