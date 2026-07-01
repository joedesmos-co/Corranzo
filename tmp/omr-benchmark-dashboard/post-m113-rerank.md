# OMR error rerank (post-m113)

Baseline: chord **189**, pitch **147**, duration **93**, onset **94**

## Decoupled rerank

| Rank | Bucket | Count |
|-----:|--------|------:|
| 1 | wrongPitch @ correct onset | 104 |
| 2 | wrongDuration @ correct onset+pitch | 40 |
| 3 | chordMismatch raw | 189 |
| 4 | missingNotes | 31 |
| 5 | extraNotes | 28 |
| 6 | wrongPitch onset-coupled | 43 |
| 7 | wrongOnset raw | 94 |
| 8 | wrongDuration onset-coupled | 51 |

## Pure chord hotspots (no pitch/onset/missing/extra)

| m | page | chord | dur in measure |
|--:|:----:|------:|:--------------:|
| 94 | ? | 8 | 0 |
| 57 | ? | 6 | 0 |

## Pure chord + pure duration (strictest isolation)

- m94 (page undefined): chord 8
- m57 (page undefined): chord 6

## Top entangled chord hotspots

| m | page | chord | pitch | onset | dur | miss | extra |
|--:|:----:|------:|------:|------:|----:|-----:|------:|
| 61 | ? | 26 | 0 | 0 | 0 | 3 | 3 |
| 9 | ? | 23 | 8 | 18 | 4 | 0 | 7 |
| 7 | ? | 20 | 4 | 8 | 2 | 11 | 3 |
| 97 | ? | 16 | 2 | 1 | 0 | 0 | 0 |
| 55 | ? | 14 | 1 | 3 | 2 | 0 | 0 |
| 8 | ? | 13 | 12 | 7 | 2 | 5 | 6 |
| 45 | ? | 10 | 0 | 1 | 2 | 0 | 0 |
| 70 | ? | 8 | 0 | 3 | 6 | 1 | 1 |
| 94 | ? | 8 | 0 | 0 | 0 | 0 | 0 |
| 6 | ? | 6 | 10 | 3 | 0 | 0 | 0 |
| 27 | ? | 6 | 0 | 1 | 0 | 0 | 0 |
| 57 | ? | 6 | 0 | 0 | 0 | 0 | 0 |
| 25 | ? | 4 | 0 | 2 | 0 | 0 | 0 |
| 88 | ? | 4 | 0 | 2 | 0 | 0 | 0 |
| 60 | ? | 3 | 0 | 0 | 0 | 3 | 0 |

## Duration @ correct onset+pitch

Independent count: **40** (onset-coupled: 51)
Top pattern 1q→0.5q: **7**

| m | count |
|--:|------:|
| 70 | 5 |
| 59 | 3 |
| 9 | 2 |
| 39 | 2 |
| 121 | 2 |
| 1 | 1 |
| 5 | 1 |
| 10 | 1 |

## Pitch @ correct onset hotspots

| m | page | count |
|--:|:----:|------:|
| 6 | ? | 6 |
| 119 | ? | 6 |
| 122 | ? | 6 |
| 121 | ? | 5 |
| 124 | ? | 5 |
| 8 | ? | 4 |
| 123 | ? | 4 |
| 125 | ? | 4 |
| 1 | ? | 2 |
| 3 | ? | 2 |
| 9 | ? | 2 |
| 120 | ? | 2 |

Page 8 (m119–125): pitch 81, onset 35, chord 1, dur 9

## Closed

- **m113**: fixed opening lead-note merge (-12 chord)
- **m33**: fixed inner-voice phase
- **m25**: phantom stack realign (-20 chord partial)

---

## Recommendation: **extend opening lead-note merge to m57 (minStack 3)**

**Single safest next target** — same failure family as m113, simulation-backed, no new mechanism.

### Why m57 (not m94 / m61 / page-8 pitch)

| Candidate | Chord | Isolation | Mechanism (diagnosed) | Simulation |
|-----------|------:|-----------|----------------------|------------|
| **m57** | 6 | pure (0 pitch/onset/dur/miss/extra) | Opening lead split: solo@0 + 3-note stack@0.25 — blocked today by `minStackNotes=4` | **PASS**: chord 189→183 (−6), m57 6→0, controls stable |
| m94 | 8 | pure | **Different family**: terminal-beat phantom/stack at 2.25–3.5, not opening | Opening merge unchanged |
| m61 | 26 | entangled (3 miss, 3 extra) | Sixteenth solo/stack alternation + missing notes | — |
| m70 | 8 chord + 6 dur | entangled | Duration 1q→0.5q + onset coupling | — |
| Page 8 pitch | 81 | cluster | Staff-gap / register residue, mixed onset | — |

### m57 diagnosis (preview)

- Truth@0: **4** notes · Gen@0: **1** (F5) · Gen@0.25: **3** (phantom split)
- Same vector x-slot lead-note pattern as m113; stack has only **3** notes so current `minStackNotes=4` gate skips it.

### Simulation probe (`post-m113-merge3-probe.json`)

Lowering `minStackNotes` to **3** on raw measures + full post-corrections:

| Metric | Current runtime | Simulated |
|--------|----------------:|----------:|
| Dense chord | 189 | **183** |
| m57 chord | 6 | **0** |
| Onset / duration / pitch | 94 / 93 / 147 | unchanged |
| Applied measures | m113 only | m57 + m113 |

### Next step

1. Offline harness: extend `simulate-opening-lead-note.mjs` with `--min-stack-notes 3` gate test.
2. Promote only if clean 100% + dense gates pass (expect m57-only addition).
3. **Do not** conflate with m94 — that needs a separate terminal phantom/stack diagnosis sprint.
