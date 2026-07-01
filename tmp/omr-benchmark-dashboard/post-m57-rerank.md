# OMR error rerank (post-m57)

Baseline: chord **183**, pitch **147**, duration **93**, onset **94**

## Decoupled rerank

| Rank | Bucket | Count |
|-----:|--------|------:|
| 1 | wrongPitch @ correct onset | 104 |
| 2 | wrongDuration @ correct onset+pitch | 40 |
| 3 | chordMismatch raw | 183 |
| 4 | missingNotes | 31 |
| 5 | extraNotes | 28 |
| 6 | wrongPitch onset-coupled | 43 |
| 7 | wrongOnset raw | 94 |
| 8 | wrongDuration onset-coupled | 51 |

## Pure chord hotspots (no pitch/onset/dur/miss/extra)

| m | page | chord |
|--:|:----:|------:|
| 94 | 6 | 8 |

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
| 94 | 6 | 8 | 0 | 0 | 0 | 0 | 0 |
| 6 | 1 | 6 | 10 | 3 | 0 | 0 | 0 |
| 27 | 2 | 6 | 0 | 1 | 0 | 0 | 0 |
| 25 | 2 | 4 | 0 | 2 | 0 | 0 | 0 |

## Duration @ correct onset+pitch

Independent count: **40** (onset-coupled: 51)
Top pattern 1q→0.5q: **7**

| m | count |
|--:|------:|
| 70 | 5 |
| 16 | 1 |
| 76 | 1 |

## Pitch @ correct onset hotspots

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
| 7 | 1 | 4 |
| 1 | 1 | 2 |

Page 8 (m119–125): pitch **81**, onset **35**, chord **1**, dur **9**

## Missing / extra hotspots

| m | missing | extra |
|--:|--------:|------:|
| 7 | 11 | 3 |
| 8 | 5 | 6 |
| 60 | 3 | 0 |
| 61 | 3 | 3 |
| 5 | 1 | 1 |
| 70 | 1 | 1 |
| 95 | 1 | 0 |
| 119 | 1 | 1 |

## Closed

- **m57**: fixed opening lead-note merge minStack 3 (−6 chord)
- **m113**: fixed opening lead-note merge (−12 chord prior)
- **m33**: fixed inner-voice phase
- **m25**: phantom stack realign (−20 chord partial)

---

## Recommendation: **m94 terminal phantom/stack chord grouping (Family B end-of-measure)**

**Single safest next target** — highest pure-chord isolation after m57 closure.

### Why m94 (not m61 / m70 / page-8 pitch / m7 missing)

| Candidate | Chord | Isolation | Mechanism (diagnosed) | Simulation |
|-----------|------:|-----------|----------------------|------------|
| **m94** | 8 | **pure** (0 pitch/onset/dur/miss/extra) | Terminal phantom @2.25q + stack splits @2.5–3.5q — **not** opening lead | Needs harness (phantom drop/shift at terminal beats) |
| m61 | 26 | entangled (3 miss, 3 extra) | Sixteenth solo/stack alternation | — |
| m7 | 20 | entangled (11 miss, 3 extra) | Column sparsity / extraction loss | — |
| m70 | 8 | entangled (3 onset, 6 dur) | 1q→0.5q duration + onset coupling | — |
| Page 8 pitch | 81 | cluster | Staff-gap register residue | — |
| m27/m88 | 4 each | pure-ish (0 pitch, small onset) | Likely onset-coupled chord residue | Lower impact |

### m94 diagnosis (from `post-m113-candidate-diagnosis.json`)

| Beat | Truth | Generated | Issue |
|-----:|------:|----------:|-------|
| 2.25 | 0 | 1 | Phantom solo column |
| 2.5 | 1 | 2 | Stack over-count |
| 3.0 | 2 | 4 | Stack merge/split |
| 3.5 | 4 | 0 | Missing terminal stack |

Column layout: dense stacks through 1.75q, then fragmenting phantom/split columns at **2.25–3.25q** — same **Family B phantom-column** class as m25/m29/m89 but at **measure terminal** not opening.

Opening lead-note merge (shipped m57/m113) **does not touch m94** (confirmed in merge3 probe: m94 chord stays 8).

### Next step (diagnosis + simulation only)

1. Extend `simulate-phantom-columns.mjs` funnel for m94 terminal signature (phantom @ ≥2.25q, linked stack shift or drop).
2. Simulate **drop phantom** / **shift terminal stack** variants under benchmark gate.
3. Promote only if chord 183→~175, m94 8→0, clean 100%, controls m25/m29/m89/m57 unchanged.

**Do not** broaden opening merge or inner-voice rules for m94.

---

Machine-readable: `tmp/omr-benchmark-dashboard/post-m57-rerank.json`
