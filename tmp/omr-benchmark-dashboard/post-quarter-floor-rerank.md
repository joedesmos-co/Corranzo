# OMR error rerank (post quarter-floor fix)

Baseline: live `tmp/omr-benchmark-dashboard/fixtures/dense.json` (2026-06-30).

| Metric | Value |
|--------|------:|
| Duration | **95.20%** |
| wrongDuration | **104** (−15 vs pre-fix) |
| Pitch | 92.74% |
| Onset | 95.77% |
| Chord | 91.87% |
| F1 | 98.93% |
| measureΔ | 0 |
| noteΔ | −2 |

Clean unchanged.

---

## Raw rerank (dense)

| Rank | Bucket | Count | Notes |
|-----:|--------|------:|-------|
| 1 | chordMismatch | 238 | Still #1 raw; debug sample mostly coupled to rhythm/onset |
| 2 | wrongPitch | 173 | **107 in m119–125** (62%) |
| 3 | wrongDuration | 104 | **No longer dominated by one pattern** |
| 4 | wrongOnset | 88 | 49 with pitch+duration OK |
| 5 | missingNotes | 31 | F1 already 98.9% |
| 6 | extraNotes | 29 | |
| 7 | noteΔ | 2 | |
| 8 | measureΔ | 0 | |

---

## Duration breakdown (104) — **new shape**

| Category | Count | vs pre-fix |
|----------|------:|-----------|
| **onset-coupled** | **51** | unchanged — now **largest** bucket |
| too-short | 27 | was 42 (`1q→0.5q` subset) |
| beamed-subdivision | 17 | |
| too-long | 9 | |

**`1q→0.5q` is no longer dominant** (27 remain, −15 fixed). Top independent patterns (pitch+onset OK):

| Pattern | Count |
|---------|------:|
| `1q→0.5q` | 27 |
| `0.75q→0.25q` | 13 |
| `0.5q→1q` | 12 |
| `1q→1.5q` | 6 |

Residual quarter collapses: beat 3 (16), beat 2 (6), beat 0 / m70 (5). **m17 beat-2 treble chord (G4/B4/D5) still emits 0.5q** — quarter-floor did not cover this production case; needs pipeline debug before extending.

---

## Pitch (173)

- 141/173 at correct onset (real mapping, not matcher noise).
- **Trailing m119–125: 107 (61.8%)** — unchanged story; bass-heavy ±2 diatonic (`A#1→C2`, `C3→A#2`).
- Non-trailing: 66; ±2 diatonic at correct onset ≈ 79 total score-wide.

---

## Onset (88)

- 49 independent (pitch+duration OK).
- Dominant deltas: **0.5q (31)**, **0.75q (18)** — sixteenth/triplet grid slips.
- Fixing onset likely absorbs many of the 51 onset-coupled **duration** errors.

---

## Chord (238)

Pure-chord hot spots (pitch≈0, onset≈0):

| m | chordMismatch |
|--:|--------------:|
| 61 | 26 |
| 25 | 24 |
| 33 | 18 |

m61: sixteenth-grid `4↔1` arpeggiation phase shift (truth `4+1+4+1`, gen `1+4+1+4`). Coupled to onset quantization, not a simple x-gap tweak.

---

## Note F1 / counts

- F1 98.93% — not the bottleneck.
- missing 31 / extra 29 — low priority.
- measureΔ 0 — hold.

---

## Recommendation: next safest target

### **No code this pass** — no pattern is both high-confidence and narrow enough to ship without diagnosis.

Priority order for next iteration:

### 1. **Trailing-page pitch (m119–125, ~107 errors)** — highest independent leverage
- Largest remaining pitch mass after measure-alignment fix.
- Appears to be final-page **bass clef / staff-line mapping**, not global pitch regression.
- **Not safe for a one-guard rule** without a dedicated diagnosis pass (page 8 layout, clef, staff positions).
- Does not touch rhythm pipeline; low coupling to quarter-floor work.

### 2. **If staying duration-only: dotted-eighth collapse (`0.75q→0.25q`, 13 cases)**
- Second-largest **independent** rhythm pattern after residual `1q→0.5q`.
- Clustered at **onset 2.75** in arpeggiated figures (m9, m32, m39, m41…); pitch+onset already correct.
- Analogous *shape* to quarter-floor but for 3-division sustain — **unproven**; needs pipeline inspection before implementing.

### 3. **Defer: onset sixteenth quantization (0.5q / 0.75q shifts)**
- Could unlock 51 onset-coupled durations + m61 chord phase, but historically broad onset changes regressed pitch/chord (x-gap widening). Diagnostic-first.

### 4. **Defer: residual `1q→0.5q` (27)**
- Quarter-floor helped but **m17 beat-2 chord still wrong** in live output — debug coverage gap before broadening (single-note beat-0 / staggered-onset cases).

### 5. **Defer: `0.5q→1q` over-extension (12)**
- Beam/over-extension territory; prior beam caps regressed duration.

---

Machine-readable: `tmp/omr-benchmark-dashboard/post-quarter-floor-rerank.json`
