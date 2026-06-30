# m7 missing noteheads — diagnosis

**Fixture:** dense (`a-cruel-angels-thesis-neon-genesis-evangelion.pdf`)  
**Scope:** measure 7, page 1 (system row m7–m9)  
**Policy:** analysis only — no runtime changes

## Executive summary

m7 accounts for **11 of 31** global missing notes. The loss is **not** in dedupe, chord grouping, event reconstruction, or MusicXML serialization. All **20 detected noteheads are emitted unchanged** (`dedupeLoss = 0`).

The gap is upstream:

1. **Sparse PDF vector noteheads** — only **20 SMuFL notehead glyphs** are assigned to m7 vs **28 truth notes** (−8 instances). Five x-columns carry the entire measure; column 2 (x ≈ 0.188) has only **2** noteheads where truth beat 1 expects a **4-note** chord.
2. **Rhythm column quantization** — those 5 columns map to onsets **{0, 1.25, 2.25, 3, 3.75}**. Truth attack points in the missing cluster use **{1.0, 1.5, 2.0, 2.25, 2.5}**. Every one of the 11 evaluator “missing” notes **has a generated instance at a different beat** (same pitch, wrong slot).

No safe fix identified under current constraints (no onset snapping, no evaluator changes, no broad rhythm caps).

---

## Evaluator snapshot (dense fixture)

| Metric | m7 value |
|--------|----------|
| Truth notes | 28 |
| Generated notes | 20 |
| Matched | 17 |
| **Missing** | **11** |
| Extra | 3 |
| Wrong pitch | 4 |
| Wrong onset | 8 |
| Chord mismatch | 20 |

Missing notes cluster on beats **1.0–2.5** (4 + 2 + 3 + 1 + 1 by onset).

---

## Funnel table

| Stage | Count | Δ from prev | Notes |
|-------|------:|------------:|-------|
| Truth notes | 28 | — | Ground truth (MXL) |
| Raw SMuFL notehead glyphs (assigned to m7) | **20** | **−8** | **Primary collapse** — PDF layer |
| Measure-assigned glyphs | 20 | 0 | `vectorGlyphInMeasure` — no loss |
| Detected noteheads (`vectorNoteCount`) | 20 | 0 | Pitch mapping null rejections: **0** |
| Grouped rhythm events | 10 | — | 20 noteheads → 10 attack columns (dual staff) |
| Emitted noteheads (events) | 20 | 0 | `dedupedDuringGrouping: 0` |
| MusicXML notes | 20 | 0 | No serialization loss |

**Verdict:** loss occurs at **glyph extraction density** (20 vs 28) and **rhythm x→onset mapping** (wrong slots for existing pitches). Everything after detection is lossless.

---

## Raw vector glyph layout (m7)

**Measure bounds:** x 0.065–0.285, playable x from 0.140, y spans grand-staff row.

| x-column (norm) | Glyph count | Generated onset | Notes (after key/accidental) |
|-----------------|------------:|-----------------|------------------------------|
| 0.157 | 6 | **0** | A#2, F2, A#1, F4, D4, A#3 |
| 0.188 | 2 | **1.25** | A#1, F4 |
| 0.219 | 4 | **2.25** | A#2, F2, A#4, D4 |
| 0.250 | 3 | **3.0** | D3, D2, G#4 |
| 0.280 | 5 | **3.75** | D#3, A#2, D#2, G4, D#4 |

Truth expects **10+ attack windows** from beat 0 through 3.5 (including 0.5, 1.0, 1.5, 2.0, 2.5, 2.75, 3.5). OMR finds **5** x-clusters and assigns **no** generated onset at 1.0, 1.5, 2.0, or 2.5.

---

## Per-missing-note trace

All 11 missing notes: **pitch exists in generated output, wrong onset**.

| Truth | Gen onsets (same pitch) | Nearest gen | Δ beat | Mechanism |
|-------|-------------------------|-------------|--------|-----------|
| F2 @ 1.0 | 0, 2.25 | 0 | −1.0 | Column 1 used for beat 0; no beat-1 column |
| A#2 @ 1.0 | 0, 2.25, 3.75 | 0 | −1.0 | Same |
| D4 @ 1.0 | 0, 2.25 | 0 | −1.0 | Same |
| A#4 @ 1.0 | 2.25 | 2.25 | +1.25 | Only in column 3 (mapped to 2.25) |
| D2 @ 1.5 | 3.0 | 3.0 | +1.5 | Column 4 mapped to beat 3 |
| D3 @ 1.5 | 3.0 | 3.0 | +1.5 | Same |
| D#3 @ 2.0 | 3.75 | 3.75 | +1.75 | Column 5 tail cluster |
| D#4 @ 2.0 | 3.75 | 3.75 | +1.75 | Same |
| G4 @ 2.0 | 3.75 | 3.75 | +1.75 | Same |
| F4 @ 2.25 | 0, 1.25 | 1.25 | −1.0 | Early columns absorb F4 |
| D#2 @ 2.5 | 3.75 | 3.75 | +1.25 | Column 5 |

The 3 **extra** generated notes (D#2, D#4, G4 @ 3.75) are the mirror image: correct pitches at the wrong beat vs truth slots at 2.0–2.5.

---

## Stage-by-stage ruling

| Stage | m7 finding |
|-------|------------|
| Glyph extraction | **20 glyphs** vs 28 truth; column 2 severely under-populated (2 vs 4+ expected) |
| Measure assignment | 20/20 assigned; no rect-boundary rejects in final pass |
| Staff assignment | Grand-staff routing OK; pitches resolve with key −3 (Eb major) |
| Pitch mapping null | **0** rejections |
| Dedupe | **0** (`vectorNoteMatching.dedupedDuringGrouping = 0`) |
| Chord grouping | Groups match x-columns; no notehead dropped |
| Event reconstruction | 20 in → 20 out |
| MusicXML | 20 notes serialized |

---

## Root cause

**Dual failure, both upstream of grouping:**

1. **Insufficient PDF notehead instances (extraction density)**  
   The vector PDF encodes m7 as 5 spatial columns / 20 noteheads. Truth requires 28 attack instances across finer sixteenth spacing in beats 1–2.5. Eight truth instances never get a distinct glyph (or share an x-column with another attack). This is the highest-density detection gap on the page.

2. **Rhythm grid mis-anchors x-columns to beats (inference, not detection)**  
   Even for pitches that *are* detected, column→onset mapping places attacks at {0, 1.25, 2.25, 3, 3.75} instead of truth’s {1, 1.5, 2, 2.25, 2.5} cluster. That alone explains all **11** evaluator missing notes without any post-detection drop.

These compound: sparse columns mean fewer simultaneous pitches per attack *and* wrong beat labels, driving chord mismatch (20) and wrong onset (8) in the same measure.

---

## Safe fix assessment

| Candidate | Assessment |
|-----------|--------------|
| Measure bounds widen | Would not add glyphs; at most ±1 edge glyph — insufficient |
| Orphan reassignment | Orphans already recovered; 20 assigned |
| Onset snap / column broaden | **Excluded** by policy; prior onset work showed regressions |
| Rhythm voice/beam caps | **Excluded** by policy |
| Evaluator matching | **Excluded** by policy |

**Recommendation:** treat m7 as **structural** — dense sixteenth figuration with sparse PDF encoding + coarse rhythm quantization. Next gains likely require either (a) richer PDF glyph recovery for tightly spaced noteheads, or (b) a rhythm pass that subdivides the playable span into more than 5 attack columns without the excluded snap heuristics.

---

## Benchmark / tests

- **No code changes** made.
- **Tests:** 1297 passed, 5 skipped.
- **Clean fixture:** unchanged (no runtime edits).
- **Dense baseline preserved:** pitch 93.67%, missing 31, F1 98.95%.

---

## Artifacts

- `tmp/omr-benchmark-dashboard/m7-missing-diagnosis.json` — funnel, columns, per-note trace
- Source paths: `processVectorOmrPage.js` (`noteheadsForMeasure`), `vectorGlyphMeasureBounds.js`, `omrNoteDedupe.js`
