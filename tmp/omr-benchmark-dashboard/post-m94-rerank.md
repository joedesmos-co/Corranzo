# OMR error rerank (post-m94)

Baseline: chord **175**, pitch **147**, duration **93**, onset **94**

## Decoupled rerank

| Rank | Bucket | Count |
|-----:|--------|------:|
| 1 | wrongPitch @ correct onset | 104 |
| 2 | wrongDuration @ correct onset+pitch | 40 |
| 3 | chordMismatch raw | 175 |
| 4 | missingNotes | 31 |
| 5 | extraNotes | 28 |
| 6 | wrongPitch onset-coupled | 43 |
| 7 | wrongOnset raw | 94 |
| 8 | wrongDuration onset-coupled | 51 |

## Pure chord hotspots

_None remaining._

Family B opening/terminal phantom sprint lane is **closed** (m57, m113, m94 all fixed).

## Top entangled chord hotspots

| m | page | chord | pitch | onset | dur | miss | extra |
|--:|:----:|------:|------:|------:|----:|-----:|------:|
| 61 | 4 | 26 | 0 | 0 | 0 | 3 | 3 |
| 9 | 1 | 23 | 8 | 18 | 4 | 0 | 7 |
| 7 | 1 | 20 | 4 | 8 | 2 | 11 | 3 |
| 97 | 7 | 16 | 2 | 1 | 0 | 0 | 0 |
| 55 | 4 | 14 | 1 | 3 | 2 | 0 | 0 |
| 8 | 1 | 13 | 12 | 7 | 2 | 5 | 6 |
| 45 | 3 | 10 | 0 | 1 | 2 | 0 | 0 |
| 70 | 5 | 8 | 0 | 3 | 6 | 1 | 1 |
| 6 | 1 | 6 | 10 | 3 | 0 | 0 | 0 |
| 27 | 2 | 6 | 0 | 1 | 0 | 0 | 0 |
| 25 | 2 | 4 | 0 | 2 | 0 | 0 | 0 |
| 88 | 6 | 4 | 0 | 2 | 0 | 0 | 0 |

## Near-pure chord (onset-only coupling ≤2)

| m | page | chord | onset |
|--:|:----:|------:|------:|
| 27 | 2 | 6 | 1 |
| 25 | 2 | 4 | 2 |
| 88 | 6 | 4 | 2 |
| 28 | 2 | 2 | 1 |
| 85 | 6 | 2 | 1 |
| 87 | 6 | 2 | 1 |

## Duration @ correct onset+pitch

Independent count: **40** · 1q→0.5q: **7**

| m | count |
|--:|------:|
| 70 | 5 |
| 16 | 1 |
| 76 | 1 |

## Pitch @ correct onset (top)

| m | page | count |
|--:|:----:|------:|
| 121 | 8 | 14 |
| 8 | 1 | 12 |
| 123 | 8 | 12 |
| 119 | 8 | 11 |
| 120 | 8 | 11 |
| 122 | 8 | 11 |
| 124 | 8 | 11 |
| 125 | 8 | 11 |
| 6 | 1 | 10 |
| 9 | 1 | 8 |

Page 8 (m119–125): pitch **81**, onset **35**, chord **1**

## Missing / extra

| m | missing | extra |
|--:|--------:|------:|
| 7 | 11 | 3 |
| 8 | 5 | 6 |
| 60 | 3 | 0 |
| 61 | 3 | 3 |
| 5 | 1 | 1 |
| 70 | 1 | 1 |

## Closed (shipped)

- m33 inner-voice phase
- m25/m29/m89 mid-measure phantom stack realign
- m113/m57 opening lead-note merge
- m94 terminal early column forward shift

---

## Recommendation: **STOP — no safe isolated precision target**

The narrow phantom/opening-chord promotion lane has no remaining **pure** hotspots and no **simulation-backed** narrow fix ready to promote.

### Why stop (not m61 / m27 / page-8)

| Candidate | Chord | Isolation | Why not next |
|-----------|------:|-----------|--------------|
| **(none pure)** | — | — | Zero pure-chord measures remain |
| m61 | 26 | **entangled** (3 miss, 3 extra) | Sixteenth solo/stack alternation — different rule family; prior inner-voice narrow slice intentionally skipped |
| m97 | 16 | entangled (2 pitch, 1 onset) | Same alternation class as m61 |
| m27 / m88 | 6 / 4 | near-pure (1–2 onset) | Phantom-like splits but **onset-coupled**; no passing simulation; broadening terminal signature risks m29/m89 |
| m25 residual | 4 | onset-coupled (2) | Phantom remove/merge simulations **failed** earlier; only stack-shift shipped |
| m7 | 20 | entangled (11 miss) | Extraction/column sparsity — no narrow runtime fix |
| m70 | 8 | entangled (6 dur, 3 onset) | Duration + onset coupling |
| Page 8 pitch | 81 | cluster | Register/staff-gap residue across m119–125 — not one-measure promotion |

### What improved this sprint arc

| Stage | Chord | Pure hotspot closed |
|-------|------:|-------------------|
| Post inner-voice | 221 | m33 |
| Post phantom | 201 | m25 partial |
| Post opening merge | 183 | m57, m113 |
| **Post m94 terminal** | **175** | **m94** |

Remaining chord errors are **entangled** with onset, pitch, missing/extra, or duration. Further gains require a **different bucket** (pitch register, extraction, or measure-local diagnosis with new simulation harnesses) — not another broad phantom heuristic.

### If resuming OMR later (diagnosis-only, not promotion)

1. **m27/m88** — trace whether mid-measure phantom split resembles m94; build measure-local simulation before any runtime.
2. **Page 8 pitch** — staff-gap / register funnel (81 errors).
3. **m61** — only after dedicated alternation diagnosis (miss/extra entangled).

**No code changes recommended this turn.**

---

Machine-readable: `tmp/omr-benchmark-dashboard/post-m94-rerank.json`
