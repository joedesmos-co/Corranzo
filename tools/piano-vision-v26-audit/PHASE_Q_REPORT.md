# Phase Q — Target / diatonic coordinate semantics

**Verdict: outcome 5 — NONE.** Every coordinate contract in the stack is
internally consistent. 0.8370 step stands. My own Phase P lead was wrong and I am
recording that plainly.

| suspect | test | result |
|---|---|---|
| anchor contract (Q2/Q3) | derive an algebraic conversion; build 3 decoders | **A ≡ B ≡ C, bit-identical** |
| rounding contract (Q5) | audit `round(2k)` at half values | **no object is ever at a half-integer** |
| band-origin contract (Q6) | (band height)/(line gap) vs 4.0 | **exactly 4.000000, 6775/6775** |
| label contract (Q7) | (bandCentre − sourceY)/gap vs stored steps | **6775/6775 consistent** |

---

## 1. Exact `true_d` formula

From `tools/real-pdf-adaptation/musicxml_truth.py`:

```
diatonic        = octave * 7 + DIATONIC[step]
DIATONIC        = {C:0, D:1, E:2, F:3, G:4, A:5, B:6}
center_diatonic = clef_center_diatonic(sign, line)
                = {"G":30, "F":18, "C":24}[sign] + 2*(line - 1)
```

`true_d` **is** `diatonic`. It is an **absolute diatonic number**, anchored to
nothing — it is simply the note's own diatonic index. Source fields: `pitch/step`,
`pitch/octave`; clef from `attributes/clef` `sign` + `line`, tracked per
`part:staff` lane with octave changes. `alter` never enters `true_d`.

## 2. Exact meaning of 32 / 24

`center_diatonic` — the diatonic of the note printed on the **clef reference
line**, 1-based from the bottom. G clef line 2 → 30+2 = **32** (G4). F clef
line 4 → 18+6 = **24** (F3).

**These constants are used only by `expected_measured_steps(diatonic, center_d)
= (diatonic - center_d)/2`, which builds the aligner's lattice for the per-lane
offset fit. They are NOT the coordinate the label is compared against.** My
Phase P claim that the label was "clef-reference anchored" was simply false.

## 3. Exact `d0` formula

```
d0 = MIDDLE_LINE[band] + round(2*k)
k  = (bandCentreY - noteheadCentreY) / staffGap
MIDDLE_LINE = {upper: 34, lower: 22}
```

## 4. Exact meaning of 34 / 22

**The diatonic of the note on the middle staff line (line 3).** Treble line 3 is
B4 → `true_d(B,4) = 4*7+6 = 34`. Bass line 3 is D3 → `true_d(D,3) = 3*7+1 = 22`.

- `k = 0` means the notehead centre sits **on the middle line**.
- `+1` in `round(2*k)` is **one diatonic step = half a staff space**.
- y grows downward, so `k > 0` is **above** the middle line.
- Parity: `round(2*k)` is even on a line, odd on a space — by construction.

## 5. Algebraic conversion — the anchor hypothesis is dead

Both coordinates are **absolute diatonic numbers in the same frame**. No
conversion exists because none is needed:

```
upper:  32 + round(2(k+1)) = 32 + 2k + 2 = 34 + 2k   ≡ A
lower:  24 + round(2(k-1)) = 24 + 2k - 2 = 22 + 2k   ≡ A
```

The clef-reference offset from the middle line is exactly ±1 space for both
standard clefs, and the anchor constants absorb it exactly. `34/22` and `32/24`
are **not two ways of saying the same thing**: the first pair are middle-line
diatonics, the second are clef-reference-line diatonics used by a different
function. Line/space parity agrees: both are anchored on lines, so parity is
preserved and no parity correction exists.

## 6. Worked examples (treble / bass) — 10/10 unit tests pass

| note | band | `true_d` | `d0` from k | equal |
|---|---|---|---|---|
| B4 — treble middle line | upper | 34 | 34 + 0 | ok |
| D3 — bass middle line | lower | 22 | 22 + 0 | ok |
| D5 — treble line 4 (k=+1) | upper | 36 | 34 + 2 | ok |
| F5 — treble top line (k=+2) | upper | 38 | 34 + 4 | ok |
| E4 — treble bottom line (k=−2) | upper | 30 | 34 − 4 | ok |
| C5 — space above middle (k=+0.5) | upper | 35 | 34 + 1 | ok |
| A4 — space below middle (k=−0.5) | upper | 33 | 34 − 1 | ok |
| A5 — one ledger line above (k=+3) | upper | 40 | 34 + 6 | ok |
| C4 — one ledger line below (k=−3) | upper | 28 | 34 − 6 | ok |
| F3 — bass reference line | lower | 24 | — | ok |

## 7. Current residual by clef / staff (Q4)

Clef sign and clef line are **perfectly collinear** with staff role across all 17
scores (upper ⇒ G/2, lower ⇒ F/4), so they cannot be separated as independent
factors. Reported jointly.

| stratum | n | residual | rate |
|---|---|---|---|
| treble / upper (G clef line 2) | 3,602 | 626 | 0.1738 |
| bass / lower (F clef line 4) | 3,173 | 478 | 0.1506 |
| line (even `2k`) | 3,368 | 582 | 0.1728 |
| space (odd `2k`) | 3,407 | 522 | 0.1532 |
| in staff (`\|k\|`≤2) | 4,039 | 698 | 0.1728 |
| beyond staff (`\|k\|`>2) | 2,736 | 406 | 0.1484 |
| `\|k\|`∈[0,1) | 2,120 | 396 | 0.1868 |
| `\|k\|`∈[1,2) | 1,919 | 302 | 0.1574 |
| `\|k\|`∈[2,3) | 1,355 | 229 | 0.1690 |
| `\|k\|`≥3 | 1,381 | 177 | 0.1282 |

**Spread across every stratum is only 1.46× (0.1282 → 0.1868).** A genuine
anchoring bug produces a *directional* pattern tied to clef and parity — e.g. a
clean ±1 on exactly one clef, or one sign only on spaces. Instead the residual is
diffuse, mildly *decreasing* with `|k|`, and 83.7% of records have mean residual
exactly 0. The anchor hypothesis weakens decisively.

## 8. Rounding audit (Q5)

| `2k` | `round()` | `floor(x+0.5)` | sign-aware |
|---|---|---|---|
| −2.5 | −2 | −2 | −3 |
| −1.5 | −2 | −1 | −2 |
| −0.5 | 0 | 0 | −1 |
| +0.5 | 0 | 1 | 1 |
| +1.5 | 2 | 2 | 2 |
| +2.5 | 2 | 3 | 3 |

The rules do differ at exact halves (Python `round` is half-to-even). **But
0 of 6,775 objects have `2k` within 1e-6 of a half-integer, and 0 have `2k`
exactly integral.** An exact half would place the notehead precisely between two
lines, which is degenerate and does not occur in real engraving. Switching the
rule is not justified by notation geometry, and tuning it against labels is
forbidden. **Not a bug.**

## 9. Staff-middle invariant (Q6)

Invariant: five staff lines span exactly four line-to-line gaps, so
`(band height)/(staff gap)` must equal exactly 4.0 if `(y0+y1)/2` is the middle
line.

Measured over all 6,775 positions: **median 4.000000, p95 4.000000, max
4.000000**; 6,775/6,775 within 0.02 of 4.0. The band origin is **exact**. `y0`
and `y1` are the outermost detected line rows, not a padded or used-extent bbox.

## 10–13. Decoders A / B / C and residual distributions

All three are zero-parameter and **no target information enters any of them**.

| decoder | step | octave | step∧octave | residual −1 / 0 / +1 |
|---|---|---|---|---|
| **A** band-middle anchor (current) | 0.8370 | 0.9782 | 0.8370 | 0.0987 / 0.8370 / 0.0642 |
| **B** clef-reference anchor | 0.8370 | 0.9782 | 0.8370 | 0.0987 / 0.8370 / 0.0642 |
| **C** oracle clef (diagnostic) | 0.8370 | 0.9782 | 0.8370 | 0.0987 / 0.8370 / 0.0642 |

`A == B` is `np.array_equal` → **True**. Metrics identical → **True**. There are
no ±2 residuals in any variant. B and C are identical to A by the algebra in §5.

## 14. First proven semantic inconsistency — **none**

Nothing in the coordinate, rounding, band-origin or label contracts is
inconsistent. Q2 killed the anchor hypothesis algebraically *and* Q3 confirmed it
empirically; Q5, Q6 and Q7 each returned clean.

## 15. Corrected deterministic rule — **none justified**

No correction is derivable. Anything that shifted the anchor by a fractional
amount would be fitted against labels, which the brief forbids and which Q4's
diffuse 1.46× stratum spread gives no geometric basis for.

## 16–18. Held-out result, new result, does 0.7342 improve

**No rule was frozen, so no held-out evaluation was performed** — there is
nothing corrected to test. Written pitch remains **0.7342 weighted / 0.7006
macro**. **Does 0.7342 improve? No: +0.0000.**

## 19. Remaining failure mode — corrected

I must correct my Phase P characterisation. Aligning the cache's `k` against the
corpus label by `objectIndexes` gives `mean −0.00000` spaces and **std 0.00003**:
**the cache's `k` *is* the stored source-geometry `stepsFromBandCenter`, to 4
decimals.** So this benchmark is *not* measuring detector localization noise. The
objects come from the source PDF extractor's `physicalObjects`, not from
detector proposals.

The residual is therefore a **MusicXML ↔ rendered-PDF disagreement inside the
corpus labels**: for 83.7% of objects `diatonic` matches the printed staff
position exactly, and for 16.3% it differs by exactly ±1.

Evidence it is not a convention error:

- 282 of 643 records have mean residual **exactly 0**; only 361 records show any
  deviation, so the MusicXML↔PDF relation is exact within most measures.
- Residuals span every letter (C −1:136/+1:74, G −1:241/+1:70, E −1:59/+1:107),
  so this is not an enharmonic-spelling boundary at B#/C or Cb/B.
- It is mildly asymmetric (−1 : +1 = 1.54 : 1), which is the opposite of a
  fixed-anchor offset, which would be one-directional.
- No letter or pitch is fully explained by it; the worst single pitch (G3) is
  109/420 = 26%.

**Remaining failure mode: a residual MusicXML↔PDF label discrepancy, localised to
a subset of measures, in a benchmark whose "objects" are source-extraction ground
truth.** The next question is upstream of readout — it is whether the corpus
label gate should have rejected those ±1 objects, which is a corpus-contract
question, not a decoder question.

*(Correction: an earlier run of this check reported std 2.02 spaces. That was an
alignment artifact — `PITCH_STAFF` omits rests, so list positions do not
correspond to cache object slots. The `objectIndexes` alignment above is the
correct one and supersedes it.)*

## 20. Is any RTX work justified? **No — and the case is stronger now.**

The decoder is exact. Every geometric and coordinate contract is provably
consistent, so no amount of GPU compute can recover the 16.3%: it is lost in the
corpus labels or upstream of the representation entirely. Training against labels
that disagree with the source rendering by a whole diatonic step would teach the
model to fit the discrepancy. The correct next step is CPU-only corpus-contract
forensics on the ±1 objects.

---

## Scripts

- `phase_q_semantics.py` — Q0/Q1/Q2 derivation + 10 unit tests, Q5, Q6.
- `phase_q_findings.py` — Q3 three decoders, Q4 conditioning, Q6/Q7 contracts.