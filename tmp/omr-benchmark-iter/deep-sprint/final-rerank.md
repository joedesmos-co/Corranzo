# OMR error rerank (post inner-voice phase runtime)

**Baseline:** `tmp/omr-benchmark-dashboard/fixtures/dense.json`  
**Context:** Narrow inner-voice phase correction shipped (−18 chord, m33 fixed)  
**Code changes:** None (analysis only)

## Current dense totals

| Metric | Value |
|--------|------:|
| Chord mismatch | **221** (was 239 pre-fix) |
| Wrong pitch | 147 |
| Wrong duration | 103 |
| Wrong onset | 94 |
| Missing | 31 |
| Extra | 28 |
| F1 | 98.95% |
| Clean | unchanged |

## What inner-voice fixed

| Measure | Chord before → after |
|---------|---------------------|
| **m33** | 18 → **0** |
| m61 / m7 / m25 | unchanged (by design) |

**m113:** inner-voice rule applied but chord stays **12** — likely false-positive pattern match; do not extend rule.

---

## Decoupled rerank (independent buckets)

| Rank | Bucket | Count |
|-----:|--------|------:|
| 1 | wrongPitch @ correct onset | 104 |
| 2 | wrongDuration @ correct onset+pitch | 41 |
| 3 | chordMismatch (raw) | 201 |
| 4 | missingNotes | 31 |
| 5 | extraNotes | 28 |
| 6 | wrongPitch onset-coupled | 43 |
| 7 | wrongOnset (raw) | 94 |
| 8 | wrongDuration onset-coupled | 50 |

---

## Chord hotspots (post-fix)

| m | page | chord | pitch | onset | missing | extra | pure? |
|--:|:----:|------:|------:|------:|--------:|------:|:-----:|
| 61 | 4 | 26 | 0 | 0 | 3 | 3 | no |
| 9 | 1 | 23 | 8 | 18 | 0 | 7 | no |
| 7 | 1 | 20 | 4 | 8 | 11 | 3 | no |
| 97 | 7 | 16 | 2 | 1 | 0 | 0 | no |
| 55 | 4 | 14 | 1 | 3 | 0 | 0 | no |
| 8 | 1 | 13 | 12 | 7 | 5 | 6 | no |
| 113 | 8 | 12 | 0 | 0 | 0 | 0 | yes |
| 45 | 3 | 10 | 0 | 1 | 0 | 0 | no |
| 70 | 5 | 8 | 0 | 3 | 1 | 1 | no |
| 94 | 6 | 8 | 0 | 0 | 0 | 0 | yes |

**Pure chord-only** (no pitch/onset/missing/extra in measure): m113 (12), m94 (8), m57 (6).

---

## Missing-note hotspots

| m | count | share |
|--:|------:|------:|
| 7 | 11 | 35% |
| 8 | 5 | 16% |
| 60 | 3 | 10% |
| 61 | 3 | 10% |
| 5 | 1 | 3% |

**m7** holds **11/31** missing notes (beats 1–2.5 harmonic window) — Family A column sparsity, not rhythm phase.

---

## Duration @ correct onset+pitch

Top pattern: **1q→0.5q** — 7 instances.

| m | count |
|--:|------:|
| 70 | 5 |
| 16 | 1 |
| 76 | 1 |

**m70** remains the densest isolated duration hotspot (also 8 chord, 3 onset — partially coupled).

---

## Pitch @ correct onset

Page 8 trailing (m119–125): **81** pitch / **35** onset errors.

Non–page 8: m6 (10), m8 (12) — cross-staff / detection coupling.

---

## Closed / deprioritized

| Target | Why |
|--------|-----|
| m33 inner-voice | **Shipped** |
| Global onset snap | Ruled out (prior diagnosis) |
| m61 narrow +0.25q | Skipped intentionally (+3 onset side effect in full detector) |
| m25 phantom columns | Needs **removal** not phase shift (Family B) |
| m113 extend inner-voice | Applied but **0 chord gain** — revert or tighten gate in separate task |

---

## Recommendation: **diagnose m25 phantom-column chord grouping (Family B)**

**Single safest next target** among remaining high-impact work:

1. **Impact:** m25 is the #2 chord hotspot (**24** mismatches), pitch/onset/duration clean in measure, no missing/extra — same independence profile m33 had before fix.
2. **Safety:** Family B fix is **column removal / phantom suppression**, not another global onset shift — orthogonal to shipped inner-voice rule; clean score unaffected if gated on dense phantom signature.
3. **Scope:** One measure-local pattern (+0.25q phantom columns, uniform stacks) — not m7 detection loss or page-8 pitch register soup.
4. **Not m7 first:** 11 missing notes need extraction/glyph diagnosis; highest missing density but **no obvious safe runtime fix**.
5. **Not m61 next:** Still #1 chord (26) but entangled missing/extra (3/3) and 4-note stacks — requires different rule than shipped narrow phase.
6. **Not m70 duration yet:** Only **7** independent `1q→0.5q` fleet-wide; m70 repro needed before any cap/floor change (m17 lesson).

**Next step:** diagnosis-only on m25 — map phantom columns @+0.25q, simulate **drop** (not shift) under benchmark gate; controls m7/m34/m33 gains/m61 unchanged.

---

Machine-readable: `tmp/omr-benchmark-dashboard/post-inner-voice-rerank.json`
