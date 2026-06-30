# Late-measure onset-column realignment — diagnosis

**Fixture:** dense  
**Scope:** cross-measure analysis with hotspots m7, m25, m33, m61, m70 (+ m9, m8, m55)  
**Policy:** analysis only — no runtime changes

## Executive summary

m7 and m33 failures share a **symptom** (wrong beat/sixteenth slot → bad chord groups) but **not one shared fix**. Across all high-chord measures, column-to-truth alignment is already good (64/92 columns within 0.08q; 27/92 off by exactly **+0.25q**). The pipeline **already uses playable span** for `positionInMeasure`; switching to full measure box **regresses** every hotspot.

Three distinct failure families emerge:

| Family | Examples | Mechanism |
|--------|----------|-----------|
| **A. Column sparsity** | m7 | Too few PDF x-columns (5 vs 10 truth); onset mapping cannot invent missing attacks |
| **B. Phantom +0.25q columns** | m25, m9, m8, m55 | Extra gen columns at `.25/.75` between truth sixteenths; systematic +0.25q early vs nearest truth |
| **C. Inner-voice alternation phase swap** | m33, m61 | Adjacent `{solo G1, 5-note chord}` pairs; columns land ~0.25q early, swapping group sizes `{1,5}→{5,1}` in chord metric |

**No single generic correction** (full box, playable re-map, column index, or global −0.25q late shift) safely fixes multiple hotspots without regressions. Benchmark-gated next step would be a **narrow, pattern-specific** inner-voice phase rule — not a global realignment.

---

## Global statistics (measures with chordMismatch ≥ 10)

**Per-column nearest-truth delta buckets** (92 columns across 18 measures):

| Delta | Count | Share |
|-------|------:|------:|
| 0 | 64 | 70% |
| +0.25q | 27 | 29% |
| −0.25q | 1 | 1% |

**Mapping mode MAE** (lower is better; assigned = current runtime):

| Measure | Assigned | Linear playable | Linear full box | Column index |
|---------|----------|-----------------|-----------------|--------------|
| m7 | **0.10** | 1.15 | 1.75 | 0.90 |
| m25 | 0.16 | **0.28** | 0.69 | **0.13** |
| m33 | **0.11** | 0.21 | 0.21 | 0.29 |
| m61 | **0.02** | 0.13 | 0.13 | 0.29 |
| m70 | **0.13** | 0.25 | 0.25 | 0.38 |
| m9 | **0.08** | 0.64 | 0.64 | 0.58 |

Current `startDivisionFromPosition` (playable span + dense sixteenth grid) **beats or matches** alternatives in most hotspots. Full-box denominator is ruled out.

**Simulated global fix:** shift assigned onset **−0.25q** for columns at beat ≥ 2 → improves only **15–40%** of columns per measure; **0%** on m61 (already aligned). Not safe.

---

## Hotspot tables

### m7 — Family A (sparsity) + coarse grid

**Stats:** chord 20, wrongOnset 8, missing 11 | padLeft **34%** | cols **5 / 10**

| x | pos (playable) | Assigned | Truth† | Δ nearest |
|---|---------------:|---------:|-------:|----------:|
| 0.157 | 0.12 | 0 | 0 | 0 |
| 0.188 | 0.33 | 1.25 | 1 | +0.25 |
| 0.219 | 0.54 | 2.25 | 2 | 0 |
| 0.250 | 0.76 | 3.00 | 3 | 0 |
| 0.280 | 0.97 | 3.75 | 3.5 | +0.25 |

†Nearest truth onset per column (not ordinal).

Half the truth sixteenth columns have **no PDF glyph column**. Assigned mapping is reasonable for 5 columns (MAE 0.10) but chord/onset metrics fail because **attacks are missing**, not mis-mapped. Playable vs full box irrelevant when columns don't exist.

---

### m25 — Family B (+0.25q phantom columns)

**Stats:** chord 24, wrongOnset 2 | padLeft 26% | cols **8 / 8**

| x | pos | Assigned | Nearest truth | Δ |
|---|-----|----------|---------------|---|
| 0.162 | 0.13 | 0 | 0 | 0 |
| 0.192 | 0.17 | **0.75** | 0.5 | **+0.25** |
| 0.221 | 0.29 | **1.25** | 1.0 | **+0.25** |
| 0.251 | 0.41 | **1.75** | 1.5 | **+0.25** |
| 0.280 | 0.54 | **2.25** | 2.0 | **+0.25** |
| 0.310 | 0.66 | **2.75** | 2.5 | **+0.25** |
| 0.339 | 0.88 | 3.00 | 3.0 | 0 |
| 0.369 | 0.90 | 3.50 | 3.5 | 0 |

Five middle columns sit **+0.25q early**. Gen onsets include **0.75, 1.25, …** where truth uses **0.5, 1.0, …** — phantom half-beat columns from x gaps falling between truth sixteenths. Column-index mapping (MAE 0.13) slightly beats assigned here only; it fails elsewhere.

---

### m33 — Family C (inner-voice alternation)

**Stats:** chord 18, wrongOnset 0 | padLeft 0% | cols **7 / 7**

| x | pos | Assigned | Nearest truth | Δ | Role |
|---|-----|----------|---------------|---|------|
| 0.710 | 0.03 | 0 | 0 | 0 | opening stack |
| 0.759 | 0.24 | 1 | 1 | 0 | beat 1 |
| 0.807 | 0.42 | **1.75** | 2.0 | **−0.25** | harmony early |
| 0.843 | 0.55 | **2.25** | 2.5 | **+0.25** | **solo G1 early** |
| 0.865 | 0.63 | **2.50** | 2.75 | **−0.25** | **5-note stack early** |
| 0.900 | 0.76 | **3.00** | 3.25 | **+0.25** | solo G1 early |
| 0.922 | 0.84 | **3.25** | 3.5 | **−0.25** | 5-note stack early |

Truth pattern (beats 2.5–3.5): `{1, 5, 1, 5}` notes per onset.  
Gen pattern: `{5, 1, 5, 1}` — **phase-inverted** chord sizes. All pitches correct; column count matches; x positions monotonic. Chord metric sees 18 mismatches because **solo and stack columns swap** relative to truth.

---

### m61 — Family C at sixteenth density

**Stats:** chord 26, wrongOnset 0 | cols **12 / 12** (MAE **0.02**)

Per-column x→onset alignment is **excellent**, yet chord mismatch is worst-in-class. Truth alternates `{4, 1, 4, 1, …}` from beat 2 (multi-note stack vs solo upper-voice B3/G4/D4/B4). Gen inserts an **extra 4-note column at 1.75** and **skips truth 3.0**, shifting greedy chord pairing:

| Truth onset | Truth size | Gen size (paired) | Δ |
|-------------|----------:|------------------:|--:|
| 2.0 | 4 | 1 | 3 |
| 2.25 | 1 | 4 | 3 |
| 2.5 | 4 | 1 | 3 |
| … | … | … | … |
| 3.75 | 1 | 0 | 1 |

Same inner-voice figure as m33, at full sixteenth grid density. **Not a linear mapping error** — a **column-count / phase alignment** error in the alternation.

---

### m70 — Mixed (missing column + offset)

**Stats:** chord 8, wrongOnset 3, duration 6 | cols **8 / 9**

| Issue | Detail |
|-------|--------|
| Missing column | Truth 9 attack windows; gen 8 |
| Offset | Col @0.758 assigned 0.5 (truth nearest 1.0, Δ+0.5); beat-2 region +0.25q |
| Duration | Dominates wrongDuration (6); separate from column mapping |

---

### Other high-chord measures (summary)

| m | chord | cols T/G | MAE | Pattern |
|---|------:|----------|----:|---------|
| m9 | 23 | 9/13 (+4) | 0.08 | B: extra columns + pairing shift |
| m8 | 13 | 9/10 (+1) | 0.08 | B: +0.25q phantoms |
| m55 | 14 | 10/10 | 0.13 | B: +0.25q (lateMean 0.20) |
| m97 | 16 | 12/12 | 0.04 | Mostly aligned; chord loss from group pairing |
| m45 | 10 | 8/7 (−1) | 0.11 | Sparse + offset |

---

## Hypothesis checklist

| Hypothesis | Verdict |
|------------|---------|
| Full measure box instead of playable span | **Ruled out** — already uses playable; full box MAE 2–6× worse (m7: 1.75 vs 0.10) |
| Non-linear spacing near measure end | **Partial** — m55 lateMean +0.20; m61 lateMean 0 with end columns correct. Not universal |
| Columns compressed after beat 2 | **Partial** — m7 compresses 10 truth slots → 5; m61 does not compress (12/12) |
| Barline padding / right-edge denominator | **Not primary** — m33 padLeft 0% still fails; m7 padLeft 34% but sparsity dominates |
| Inner-voice `{1, N}` alternation needs local phase | **Confirmed** — m33, m61; root of chord metric inversion |
| Pickup / syncopated index-based slot errors | **Partial** — m7 opening uses `alignOpeningGroupStart`; mid-measure errors are position-grid not index |
| Linear x → division | **Ruled out** — worse than assigned except m25 tie |
| Column-index (ordinal) mapping | **Ruled out** — worse on m7, m33, m61, m70, m9 |

---

## Shared generic cause (refined)

There is **one pipeline stage** responsible — `positionInMeasure` → `startDivisionFromPosition` on a **uniform 16-division grid** — but **three distinct ways** it fails:

1. **Insufficient columns** (PDF) — cannot map what isn't detected.  
2. **Phantom column insertion** — x gaps between truth sixteenths snap to `.25`-offset slots (m25-like).  
3. **Alternating solo/stack phase** — two adjacent columns correctly ordered in x but mapped to `{T, T+0.25}` instead of `{T+0.25, T+0.5}`, inverting chord group sizes (m33/m61-like).

Families 2 and 3 share the **+0.25q offset** signature but need **different** corrections (drop phantom vs swap solo/stack phase).

---

## Safe fix recommendation

### Do not ship (benchmark simulation)

| Fix | Result |
|-----|--------|
| Full-box denominator | Regresses all hotspots |
| Global −0.25q after beat 2 | ≤40% columns improved; 0% on m61; would regress aligned columns |
| Column-index mapping | Helps m25 only; regresses m7/m33/m61/m70 |
| Broaden playable span left edge | m7 already has 34% pad; doesn't restore missing columns |

### If pursuing one benchmark-gated experiment

**Narrowest candidate:** detect **adjacent column pairs** in dense measures where:
- column *k* has 1 bass note with x gap Δx to column *k+1*,
- column *k+1* carries full grand-staff stack,
- assigned onsets differ by exactly 1 division (0.25q),
- truth-style pattern expects solo **before** stack;

→ shift stack column **+1 division** (0.25q later) and solo column **+1 division** together (preserve relative spacing).

**Scope gate:** only measures with ≥6 columns and alternating size pattern `{1, ≥3}` in gen output.  
**Must benchmark:** m33, m61 (targets), m25, m7, m34 (control — m34 chord 0), clean unchanged.

**Why not now:** pattern detector is not yet implemented; m7 needs glyph work not phase work; m25 needs phantom-column **removal** not phase shift. One rule does not cover all three families.

---

## Tests / baseline

- **No code changes.**
- **Tests:** 1297 passed, 5 skipped.
- **Dense baseline:** unchanged.

---

## Artifacts

- `tmp/omr-benchmark-dashboard/onset-column-diagnosis.json` — per-column x, positions, deltas, mapping comparisons
- Prior: `m7-missing-diagnosis.md`, `m33-chord-diagnosis.md`
