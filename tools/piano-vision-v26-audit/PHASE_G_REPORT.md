# Phase G — Geometry outliers, fresh-head baseline, context ablation

**Verdict: FAIL. Two of the three candidate levers are now causally falsified.
The remaining one is visual resolution, and it is untested.**

| sub-phase | status | result |
|---|---|---|
| G0 geometry outlier | **done** | root cause found, two defects |
| G1 fresh-head baseline | **done** | 0.5726 weighted / 0.5264 macro LOSO |
| G2 legitimate context | **done** | **+0.006 — falsified** |
| G3 high-res ROI branch | **not done** | — |
| G4 visual causal ablation | **not done** | requires G3 |
| G5 head structure | **not done** | — |
| G6 LOSO acceptance | **FAIL** | 0.578 best, threshold 0.70 |
| G7 original-domain safety | **PASS** | identity at init, 0.0 delta |

I stopped rather than rush G3. It is the largest remaining piece of work, it
depends on a correct staff-anchored ROI implementation, and building it
hastily is precisely how the previous instrument was broken.

---

## 1. Hungarian Dance root cause

`std-hungarian-dance-no5`, closed-form self-consistency 0.246, median residual
**−1.0 diatonic step** (every other score: 0.0). Two distinct defects, both
measured.

### Defect 1 — `staff_space()` pools both bands' gaps (real corpus bug)

`piano_vision_service/v25_canonical_features.py:73`:

```python
lines = list(staff_lines.get("treble") or []) + list(staff_lines.get("bass") or [])
lines = sorted(...)
return float(np.median([lines[i+1]-lines[i] for i in range(len(lines)-1)]))
```

`stepsFromBandCenter` divides a **band-specific** offset by a **pooled** gap.
For this score the bands measure 10.5 px (upper) and 10.25 px (lower) — I
verified the line rows directly in the render: upper at 281/292/302/312/323
(gaps 11,10,10,11) and lower at 391/401/411/422/432 (gaps 10,10,11,10). Every
lower-staff note is therefore scaled by the upper band's gap: a **2.4 % error**
on every bass-clef staff step in the score. The existing
`band_gap_disagrees_with_pooled` check uses a 1.35× threshold and passes this
comfortably, so the gate as written cannot see it.

**Classified as a demonstrated corpus bug** (the pooled gap should be the
band's own gap for a band-relative quantity). I have **not** patched it: the fix
changes label values, which would invalidate the accepted Phase F baseline.

### Defect 2 — the dominant −1 is a PDF↔MusicXML content disagreement

The staff geometry is **pixel-perfect** (line rows verified above), so the
remaining residual is not a detection error. Every mismatch is a note the
MusicXML spells with a sharp, and the geometry reads exactly one diatonic step
lower:

| geometry | MusicXML | printed alter |
|---|---|---|
| E2 | F♯2 | 1 |
| B2 | C♯3 | 1 |
| B1 | C♯2 | 1 |
| D4 | E4 | 1 |
| F4 | G4 | 1 |

The source MusicXML carries `<fifths>` **3, 6, 3** — the key changes mid-piece —
and the mismatches are present from measure 0 at a uniform ~50/50 with the
correct notes, so it is not a mid-piece key change and not a gradual drift.
I could not establish, without rendering-level comparison, whether the PDF is a
different edition of the piece from the MusicXML or whether the aligner mispairs
adjacent noteheads in this dense 15-notes-per-measure music.

**Classified as unreliable pitch supervision.** Per the brief's option B, this
should be refused rather than heuristically corrected. I have **not** applied
the refusal, because it changes the corpus and therefore the accepted Phase F
numbers. The instruction was explicit: do not silently alter Phase F results.

### Impact, measured rather than assumed

| population | frozen champion | fresh head (in-sample) |
|---|---|---|
| all 18 scores, n=7,625 | 0.1204 | 0.7430 |
| excluding hungarian-dance, n=6,795 | 0.1143 | 0.7531 |

Excluding the score moves the fresh head by **+0.010** and the champion by
−0.006. **It is not material to any conclusion in this report.** No re-freeze of
the corpus digest is required for the results below.

## 2. Corpus digest / version

**Unchanged**: `real-pdf-corpus/2.0`,
`c7897bb2217a2999a6af5bfba5c6ac2655065bb5276b75ecb492d535642d2f9b`.
The G0 findings are recorded here as required follow-ups, not applied.

## 3. G1 — embedding-only baseline (frozen inputs only)

A fresh pitch head on the **unchanged** frozen V2.5 object embedding.

| | |
|---|---|
| weighted written pitch | **0.5726** |
| macro written pitch | 0.5264 |
| written step | 0.7356 |
| octave | 0.9546 |
| accidental | 0.7462 |
| derived MIDI | 0.5750 |
| n labels | 7,625 |
| adapter parameters | 206,397 |
| frozen champion, same population | 0.1204 |
| in-sample fit (diagnostic only) | 0.7430 |

The in-sample/LOSO gap (0.743 → 0.573) is the honest measure of how much
score-specific structure the head memorises.

## 4. G2 — legitimate context: **FALSIFIED**

Only the frozen champion's own `context` head outputs, over the scope's staff
nodes. These are model predictions available at inference, never ground truth
(Phase E measured clef 1.0000, clef_line 1.0000, key_fifths 0.9804 on production).

| arm | weighted pitch | macro | step | octave | accidental | MIDI | extra cols | params |
|---|---|---|---|---|---|---|---|---|
| **A embedding only** | **0.5726** | 0.5264 | 0.7356 | 0.9546 | 0.7462 | 0.5750 | 7 | 206,397 |
| B + staff role | **0.5784** | 0.5153 | 0.7444 | 0.9538 | 0.7449 | 0.5816 | 8 | 206,653 |
| C + clef | 0.5721 | 0.5327 | 0.7469 | 0.9550 | 0.7575 | 0.5746 | 26 | 211,261 |
| D + key signature | 0.5725 | 0.5098 | 0.7338 | 0.9555 | 0.7438 | 0.5757 | 22 | 210,237 |
| E + all context | 0.5693 | 0.5186 | 0.7440 | 0.9550 | 0.7644 | 0.5736 | 41 | 215,101 |
| F + staff-relative k | 0.5706 | 0.5228 | 0.7489 | 0.9546 | 0.7530 | 0.5742 | 10 | 207,165 |

**Every arm is within ±0.006 of A — inside seed noise.** The best, B, gains
+0.0058.

I had predicted context would unlock the accidental head, since `k` cannot
determine an accidental. **That prediction was wrong**: all context moves the
accidental head only 0.746 → 0.764 (+0.018), not the ~0.16 needed. The accidental
head is limited by **pixels** — the accidental glyph — not by key knowledge. The
embedding already contains the key signature implicitly and does not need it
stated.

## 5–8. ROI arms (G3)

**Not run.** G3 is the remaining hypothesis and it is untested. The four
requested combinations (ROI only, embedding+ROI, embedding+context,
embedding+ROI+context) do not exist yet.

What the existing evidence says about the expected gain, from independent
measurements:

- embedding-only head, LOSO: **0.5726**
- Phase D probe on a staff-anchored 8 px/staff-space ROI **with** the same
  detector geometry, LOSO, 11 scores: **0.7484**
- champion: 0.1204

The ~0.18 between 0.573 and 0.748 is the only headroom not already explained,
and it is attributable to one thing: the champion's object embedding is a
**3×3 bilinear sample of a 3×-expanded box** — fewer samples than the five staff
lines it must resolve — whereas the ROI resolves the staff directly.

## 9. Visual causal ablations (G4)

**Not run** — requires G3. When it is run it must include blank, vertically
shifted, wrong-staff, shuffled and reduced-resolution ROIs. The falsifications
in F3 and G2 make this gate load-bearing: two other plausible channels have
already been shown causally inert, so a third would need real evidence.

## 10. Best head structure (G5)

**Not run.** One structure was used throughout (additive per-head logit
correction). Notably, the *independent categorical* form already reaches 0.5726,
so G5's structured-decomposition variant has little room: written step is 0.736
and octave 0.955 individually but 0.573 jointly, which is a **calibration** issue
between heads, not a representational one.

## 11. LOSO weighted + macro

Best arm: **weighted 0.5784 / macro 0.5153**. Threshold 0.70. **Not met, not
lowered.**

## 12–13. Per-score and engraving family (arm A, the baseline)

| score | written pitch | accidental | family |
|---|---|---|---|
| std-demo-minuet-in-g | 0.8644 | 0.8814 | emmentaler |
| pl-bach-prelude-bwv846 | 0.8218 | 0.9138 | emmentaler |
| bc-bach-fugue-bwv846 | 0.7712 | 0.9107 | emmentaler |
| pl-beethoven-fur-elise | 0.7439 | 0.8920 | emmentaler |
| pl-handel-gavotte | 0.6667 | 0.8291 | emmentaler |
| bc-chopin-etude-op10-01 | 0.6368 | 0.8322 | feta |
| bc-chopin-nocturne-op9-n2 | 0.5919 | 0.7262 | feta |
| bc-mozart-k153 | 0.5601 | 0.6509 | emmentaler |
| pl-mozart-turkish-march | 0.5459 | 0.7263 | emmentaler |
| bc-beethoven-sonata-op2-m1 | 0.5447 | 0.6239 | emmentaler |
| pl-brahms-waltz-op39-3 | 0.5333 | 0.8000 | emmentaler |
| bc-chopin-etude-op10-12 | 0.5120 | 0.7435 | emmentaler |
| omf-piano-rhythm-tuplets-vector | 0.4118 | 1.0000 | corranzo |
| pl-chopin-mazurka-op6-1 | 0.3884 | 0.5625 | feta |
| omf-piano-grand-voices-vector | 0.3750 | 0.7708 | corranzo |
| std-hungarian-dance-no5 | 0.2675 | 0.5000 | legacy-mscore |
| pl-tchaikovsky-old-french-song | 0.1212 | 0.5455 | emmentaler |
| omf-piano-dense-advanced-vector | 0.1194 | 0.5224 | corranzo |

**By family:** musescore4-emmentaler 0.608 (11), musescore-feta 0.539 (3),
corranzo-benchmark 0.302 (3), musescore-legacy-mscore 0.268 (1).

## 14. Step / octave / accidental / MIDI

Arm A: written step **0.7356**, octave **0.9546**, accidental **0.7462**, MIDI
**0.5750**. Step and octave are individually strong; the strict conjunction is
limited by the accidental head, which context cannot fix and pixels should.

## 15. Added parameter count

**206,397** baseline arm; 215,101 for the widest context arm. Both +0.78% /
+0.82% of the 26,332,539-parameter champion. No capacity confound in the
ablation: the arms differ by 0.08–4 % of the adapter.

## 16. Leakage audit

LOSO by score, 18 folds, each score held out exactly once, 0 duplicates.
Context is the frozen model's own prediction, never a target. The G2 result is
itself evidence against leakage: adding more information changes nothing, which
is not what a leaking setup looks like. Page-level leakage 0/44 shared.

## 17. Original-domain preservation

**PASS** (Phase F F5): max abs logit delta at initialisation **0.0**, outputs
bit-identical to the champion, adapter is a pure function of the embedding so the
original path is untouched on every domain. The new readout is a
production-domain path only and is never installed on the original route.

## 18. Remaining gap to the ceilings

| reference | value | gap from best arm (0.5784) |
|---|---|---|
| fresh head, embedding only | 0.5726 | +0.006 |
| **detected-geometry ceiling** | **0.7484** | **0.1700** |
| perfect-geometry ceiling | 0.8054 | 0.2270 |

## 19. PASS / FAIL

**FAIL.** G6 not met (0.578 vs 0.70). G2 falsified. G3/G4/G5 not run.

## 20. Is an RTX run justified? **No.**

Unmet: ROI causal evidence, LOSO ≥ 0.70, per-family acceptability, and a
concrete reason a GPU run beats a CPU run. The remaining candidate is a small
CNN over a staff-anchored ROI — a few hundred thousand parameters. That is
CPU-feasible in minutes and there is no reason to spend GPU time on it before
the CPU gate has passed, exactly as F1–F3 did for the adapter.

---

## What the three phases now jointly establish

The investigation has eliminated its hypotheses one at a time, causally, rather
than by argument:

| component | verdict | evidence |
|---|---|---|
| staff-line detection | sound where it fires | 0/29 analytic-offset violations |
| label↔object binding | **fixed** | \|k\|>8: 40.0% → 0.0% |
| raster / visual domain | not causal | factory-raster swap −0.005 |
| clef & key context heads | perfect in the frozen model | 1.0000 / 0.9804 |
| **missing staff-relative `k`** | **falsified** | C − F = **+0.005** |
| **legitimate musical context** | **falsified** | best arm **+0.006** |
| **champion pitch heads** | **the immediate failure** | 0.120 → 0.567 on one embedding |
| **object embedding resolution** | **the remaining suspect** | 0.573 here vs 0.748 on a staff-anchored ROI |

The single live hypothesis is that the champion's **3×3 sample of a 3×-expanded
box** is the remaining bottleneck. It is the only one left, and it is the one
Phase D already measured independently at 0.7484.

### Concrete next step (not started)

G3, built properly: a staff-anchored crop with origin at the notehead's own band
centre, extent in staff-space units, sufficient to contain all five staff lines,
ledger lines, the accidental and neighbouring chord tones; a small CNN; the
whole V2.5 model frozen; G4's blank/shifted/wrong-staff/shuffled/reduced
ablations run before any acceptance. Two follow-ups to settle from G0 first,
because both are cheap and both change label values: the pooled-vs-band-local
staff gap, and the Hungarian Dance refusal decision.
