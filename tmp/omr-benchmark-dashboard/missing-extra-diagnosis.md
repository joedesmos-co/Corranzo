# OMR Missing/Extra Note Sprint — diagnosis

**Date:** 2026-07-02  
**Algorithm changes:** None

## Benchmark baseline (enforced fixtures)

| Fixture | noteΔ | missing | extra | F1 | Status |
|---------|------:|--------:|------:|---:|--------|
| Gymnopédie | 0 | 0 | 0 | 100% | pass |
| Cruel Angel | 0 | 28 | 28 | 99% | pass |
| Twinkle | 0 | 0 | 0 | 100% | pass |

**Key signal:** Cruel Angel has **noteΔ=0** (2810 truth, 2810 generated) while reporting 28 missing + 28 extra. Every missing note is paired with an extra at the evaluator layer — this is **not** net detection loss.

## Root-cause classification (dense, 56 total)

| Bucket | Count | Role |
|--------|------:|------|
| **serialization-mistake** | **52** | Onset grid slip: truth slot early in measure, generated column late (m7–m9, m61, m70, tail) |
| **detection-loss** | **4** | Residual tail (m95 G5, m107–108 A#6 ledger) — no safe generic fix without threshold risk |
| **matcher-artifact** | **0** | Greedy matcher leaves both sides unmatched only when onsets differ (folded into serialization) |
| **grouping-mistake** | **0** | `dedupedDuringGrouping=0` on all 125 measures |
| **dedupe-mistake** | **0** | Spatial dedupe (`dedupeNoteheads`) not collapsing distinct columns |

## Measure hotspots

| Measure | Missing | Extra | Page | Pattern |
|--------:|--------:|------:|-----:|---------|
| **7** | 11 | 3 | 1 | Opening harmonic window: truth beats 1–2.5 vs generated spill at 3.75 |
| **8** | 5 | 6 | 1 | Continuation of m7 onset phase slip into beat 0 / tail |
| **9** | 0 | 7 | 1 | Generated-only extras from shifted column (no truth at those slots) |
| **61** | 3 | 3 | 4 | Same pitches (A#2/F3/A#3) at truth@3 vs gen@1.5 — pure serialization |
| **119–125** | 1 each | 1 each | 6 | Coda: accompaniment voice@3 vs bass pickup@1.5 |

## Decision

**No algorithm change.** Missing/extra on enforced fixtures are a **downstream symptom of onset serialization** (same root cause as rhythm sprint §8). Fixing them in isolation would require onset/matcher changes that previously regressed Twinkle (position renormalization → onset 93%→collapse) and risks the **Twinkle duplicate-note fix** (`dedupeNoteheads` spatial keys + `buildVectorEvents` column preservation).

La Campanella `noteΔ=-286/-400` is measure-allocation + detection on skipped tiers — out of scope for enforced acceptance.

## Next largest bucket

**Onset/rhythm serialization** (94 wrong onsets on dense) — same introduction point as chord/pitch grouping artifacts.
