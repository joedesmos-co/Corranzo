# OMR post-measure-fix error rerank

Generated from live `npm run omr:benchmark-dashboard` (2026-06-30).

## Baseline shift (measure split fix)

| Metric | Before | After | Δ |
|--------|-------:|------:|--:|
| measureΔ | +2 | **0** | fixed |
| pitch | 34.3% | **92.7%** | +58.4pp |
| duration | 80.3% | **94.7%** | +14.4pp |
| onset | 71.8% | **95.8%** | +24.0pp |
| chord | 65.9% | **91.9%** | +26.0pp |
| note F1 | 88.9% | **98.9%** | +10.0pp |
| wrongPitch | 1533 | **173** | −1360 |
| wrongDuration | 243 | **119** | −124 |
| wrongOnset | 480 | **88** | −392 |
| chordMismatch | 1154 | **238** | −916 |

Clean (Gymnopédie): **unchanged** — pitch/onset/chord 100%, F1 100%, 1 wrong duration.

Most prior “pitch” and “chord” mass was **cross-measure misalignment**, not detector bugs.

---

## Dense error rerank (remaining, independent)

| Rank | Bucket | Raw count | Independent subset | Notes |
|-----:|--------|----------:|-------------------:|-------|
| 1 | chordMismatch | 238 | ~68 in m25/m33/m61 hot spots | Many are sixteenth-grid onset splits (m61: 4↔1 alternation); 18 are pitch/onset/duration-clean |
| 2 | wrongPitch | 173 | **107 in m119–125 only** | 62% of remaining pitch; ±2 diatonic 61 in trailing; bass-heavy (77/107) |
| 3 | wrongDuration | 119 | **42** pitch+onset OK, `1q→0.5q` | +51 onset-coupled (fix onset first) |
| 4 | wrongOnset | 88 | **39** pitch+duration OK, Δ=0.5q | Clusters m9, m119–123 |
| 5 | missing/extra | 31 / 29 | F1 98.9% | Low priority |
| 6 | measure issues | **0** | — | Trailing split fix holding |

---

## Sub-bucket detail

### Wrong pitch (173)
- **141/173** at correct onset (real pitch mapping, not matcher noise).
- Histogram: ±2 diatonic **89**, ±1 accidental **39**, other **42**.
- **Trailing pages (m119–125): 107 errors** — newly visible after alignment fix; pattern `A#1→C2 (+2)`, `C3→A#2 (−2)` suggests **bass clef line / octave mapping on final PDF page**, not global pitch regression.
- Non-trailing ±2 diatonic: only **~18** — no longer the dominant story.

### Wrong duration (119)
- onset-coupled: **51** (fixing onsets would absorb many)
- too-short: **42** — top fixable pattern **`1q→0.5q` (42 cases)** with pitch+onset correct
- beamed-subdivision: **17**
- too-long: **9**
- Examples: m17 beat-2 chord tones (G4/B4/D5 @ 2.0 → 0.5q), m25 beat 3, m70 (5 cases)

### Wrong onset (88)
- **49** with pitch+duration OK
- Dominant deltas: **0.5q (31)**, **0.75q (18)** — sixteenth/triplet grid slips

### Chord mismatch (238)
- Worst pure-chord measures (pitch≈0): **m61 (26)**, **m25 (24)**, **m33 (18)**
- m61 pattern: truth `4+1+4+1+…` sixteenth chord arpeggiation vs generated `1+4+1+4+…` — **onset bucket shift by 0.25q**, pitches individually correct
- Not a simple x-gap widen; needs sixteenth-phase chord grouping or onset quantization

### Note F1 / detection
- Precision 98.97%, recall 98.90%, **F1 98.93%**
- missing 31, extra 29 — not the bottleneck

---

## Worst measures (post-fix)

| m | pitch | dur | onset | chord | miss | extra |
|--:|------:|----:|------:|------:|-----:|------:|
| 9 | 8 | 4 | 18 | 23 | 0 | 7 |
| 125 | 26 | 1 | 3 | 0 | 1 | 1 |
| 7 | 4 | 2 | 8 | 20 | 11 | 3 |
| 8 | 12 | 2 | 7 | 13 | 5 | 6 |
| 61 | 0 | 0 | 0 | **26** | 3 | 3 |
| 123 | 14 | 3 | 8 | 0 | 1 | 1 |

m9 is mixed (onset+chord+extra). m61 is **pure chord/onset-grid**. m119–125 cluster **trailing pitch**.

---

## Recommendation: next single safe target

### **Target: quarter harmonic sustain collapse (`1q→0.5q`, 42 cases)**

**Why this one**
- Third-largest raw bucket, but **largest cleanly independent rhythm defect** (pitch+onset already correct).
- Same family as the landed half-note `terminalHarmonicHalfSpan` / `sparseHarmonicHalfSpan` fix — narrow extension, not a new subsystem.
- Spread across mid-score measures (m17, m25, m70, …), **not** on trailing pages → won't fight the measure-split fix.
- Clean fixture has **1** duration error (too-long), not quarter-collapse — low regression surface.

**Why not the alternatives (this pass)**
| Alternative | Blocker |
|-------------|---------|
| Trailing pitch m119–125 (107) | Bigger count but root cause unclear (bass clef on page 8?); risk to trailing measure work — needs diagnosis, not a one-line guard |
| m61 sixteenth chord bucketing (26) | Pure chord count but requires sixteenth-phase grouping change — higher coupling to onset |
| Onset 0.5q shifts (39) | Often coupled to duration/chord; fix order unclear |
| Onset-coupled durations (51) | Downstream of onset fixes |

**Suggested implementation shape (next iteration)**
- Extend per-clef harmonic span guards to **quarter (dur=4)** terminal/same-pitch fragments at beat ≥2, mirroring existing half-note rules.
- Gate: same pitch multiset, sixteenth grid, no foreign-clef bleed, `duration===4` collapsing to `2`.
- Validate: dense `1q→0.5q` −42; clean duration unchanged; measureΔ stays 0.

**No code changes this pass** — report does not show a fix obvious enough to land without simulation; recommendation only.

---

## Artifacts

- `tmp/omr-benchmark-dashboard/report.json` / `report.md` — live dashboard
- `tmp/omr-benchmark-dashboard/fixtures/dense.json` — full accuracy report
- `tmp/omr-benchmark-dashboard/dense-error-rerank.json` — machine rerank
- `tmp/omr-benchmark-dashboard/post-measure-fix-delta.json` — before/after vs rhythm-voice2 baseline
