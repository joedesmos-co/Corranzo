# Phase R — aligner bug vs corpus truth

**Verdict: no aligner bug and no target-builder bug is proven. 16.30% of the
corpus pitch labels disagree with the source PDF geometry, and the disagreement
is a per-group uniform one-step transposition. That is a source-pair truth
problem. The refusal-mask rebaseline is tautological and must not be read as an
improvement.**

---

## 1–2. Counts

| | objects |
|---|---|
| mismatch (`true_d != d0`) | **1,104** of 6,775 = 0.1630 |
| exact-match control | **5,671** of 6,775 = 0.8370 |
| printed (measure, band) groups | 976 |

## 3. XML-event identity tracing (R1)

Every `PITCH_STAFF` family carries `semanticEventIds = ["m{M}-n{N}"]`, where `M`
is the XML measure index and `N` is `event.xml_note_index`. Tracing all 1,104
mismatches against the paired MusicXML: **1,104/1,104 resolved to a real
`<note>` element** — step, octave, voice, staff, chord membership, onset and
document position were all recovered. There are no dangling or fabricated event
ids, and the printed measure→XML measure map is consistent.

So the disagreements are **not** dangling references and **not** whole-measure
mispairings (a wrong measure would give a different pitch set, not a parallel
one shifted by a constant step).

## 4–6. Stratification

**By chord size (R4)**

| chord size | n | mismatched | rate |
|---|---|---|---|
| 1 | 5,497 | 787 | 0.1432 |
| 2 | 926 | 249 | **0.2689** |
| 3 | 312 | 61 | 0.1955 |
| 4 | 40 | 7 | 0.1750 |

Chord size 2 is ~1.9× worse than a single note. That is the only chord/voice
signal, and it is modest — the disagreement is not a chord-ordering pathology.

**By staff (R4)** — upper 0.1738 (n=3,602), lower 0.1506 (n=3,173). Clef sign
and clef line are perfectly collinear with staff role corpus-wide.

**By score (R6)** — worst: `bc-chopin-etude-op10-12` 208/462, `bc-beethoven-sonata-op2-m1`
186/684, `bc-mozart-k153` 156/388, `bc-chopin-nocturne-op9-n2` 118/180. Five scores
are essentially clean, including `pl-bach-prelude-bwv846` (**0 mismatches**),
`bc-chopin-etude-op10-01` (0), `std-demo-minuet-in-g` (1), `omf-piano-rhythm-tuplets`
(0) and `pl-brahms-waltz-op39-3` (0).

## 7. Does `d0` match an adjacent XML event? (R2)

| explanation of the observed `d0` | objects | share |
|---|---|---|
| no nearby XML event carries that diatonic | 573 | 0.5190 |
| some *other* event in the same measure+band | 385 | 0.3487 |
| previous event | 51 | 0.0462 |
| next event | 50 | 0.0453 |
| another note in the same chord | 45 | 0.0408 |

**Only 13.2%** (previous + next + chord) is the signature of event mispairing, and
that figure is inflated: "some other event in the measure" is weak evidence when
a 10–20 note polyphonic measure holds ~15 distinct diatonic values.

## 8. Measure-level morphology (R5) — the decisive statistic

Classifying each group by the set of its non-zero `d0 − true_d` values:

| morphology | groups | share | mismatched objects | share of mismatches |
|---|---|---|---|---|
| clean | 499 | 0.5113 | 0 | — |
| **uniform one-step transposition** | 388 | 0.3975 | **780** | **0.7065** |
| mixed signs `{−1,+1}` | 89 | 0.0912 | 324 | 0.2935 |
| mixed magnitudes | **0** | 0 | 0 | 0 |

**Zero groups contain a residual of magnitude ≥ 2.** Every disagreement is
exactly ±1, and in 70.65% of objects the *entire group* shares one sign. That is
the signature of a per-group constant offset, not of event mispairing — mispairing
produces mixed signs, which is what the remaining 324 objects are.

Concrete examples (printed vs assigned, upper band):

```
fur-elise  p1-s0-x1   printed E5 D5 B4   assigned D5 C5 A4
tchaikovsky p1-s4-x46 printed B4 A4 G4   assigned C5 B4 A4
sonata     p2-s0-x0   printed G4 A4 C5   assigned F4 G4 C5
```

The PDF renders the same interval sequence one staff step from the MusicXML.

## 9. Independent MusicXML render (R3) — deliberately not run

Verovio is installed and available. I did **not** use it, because it is not
decisive for this question: Verovio renders *from the paired MusicXML*, so for
the assigned event it will reproduce `true_d` by construction. It can confirm the
MusicXML is self-consistent — which `musicxml_truth.py` already establishes — but
it cannot independently arbitrate between the PDF and the MusicXML, because the
PDF is not an input to it. A genuine arbitration needs the PDF's own engraving,
i.e. the source-extraction geometry, which is already exact (below).

## 10–13. Attribution

| category | objects | share of mismatches |
|---|---|---|
| **% aligner errors** | **0 proven** | 0.0000 |
| % target-builder errors | **0 proven** | 0.0000 |
| consistent with a per-group source transposition | 780 | 0.7065 |
| unresolved (mixed-sign groups) | 324 | 0.2935 |

**Why "0 proven aligner errors" is the honest answer.** I built the monotone
pairing feasibility test (R7): does a zero-residual order-preserving pairing
exist between the objects and the events the aligner actually used? Because the
current pairing is itself monotone, the LCS can never fall below its own score,
and 371 of 477 affected groups return exactly the current score — **the aligner
is already optimal and no monotone pairing does better.** The other 106 groups
return a marginally better LCS, but inspection shows that margin is coincidental
overlap between two *parallel* transposed sequences, not a recoverable pairing.
No group admits a full zero-residual re-pairing except 3 (0.3%).

This overturns my own first pass, which reported 67.9% "aligner bug" on the
strength of a test that compared against an event ordering the aligner never
uses. That number was wrong.

## 14. Exact root causes

**None isolated to a specific defect — and four candidate causes are now
positively excluded:**

- **Not geometric.** The band centre is exactly the middle line (Q6: height/gap =
  4.000000 on all 6,775). With that, `analytic_band_delta` is *algebraically*
  exactly −1 (upper) / +1 (lower) for every measure, so no geometric offset
  error is even representable.
- **Not rounding** (Q5: zero objects at a half-integer).
- **Not an anchor or coordinate-frame error** (Q2/Q3: A ≡ B ≡ C exactly).
- **Not notehead-centre definition** (P2: production box centre is best).
- **Not a dangling, fabricated or whole-measure-mispaired event** (§3).

What remains is: a genuine per-(measure, band) disagreement between the rendered
PDF and the paired MusicXML, uniform to one diatonic step across the group,
concentrated in polyphonic piano scores. Distinguishing "different edition /
different engraving" from "mis-tracked clef state" needs the PDF's own printed
clef per measure, which the shard does not store — it stores only `y0`/`y1` per
band. That is the concrete next forensic step and it is blocked on re-extraction,
which needs the absent runtime.

## 15. Aligner fix

**None.** No aligner defect is demonstrated, so there is nothing to fix. Per R7
the correct action is *not* to change the aligner.

## 16. Refusal policy

Implemented: **`out/realpdf_22_candidate/refusal_manifest.json`**, policy
`REFUSAL_ONLY__NO_RELABELLING`. Every `(score, printed measure, staff)` group
containing at least one disagreement is refused — 477 of 976 groups, 1,104 of
6,775 objects. The unit is the group, because the disagreement is uniform within
it; refusing one note would leave the identical contradiction beside the
survivor. **No label is rewritten from `d0`**, per the R6 standard.

## 17–19. Rebaseline — and why it is meaningless

| | n | step | octave | accidental | written pitch (w / macro) |
|---|---|---|---|---|---|
| 2.1 current | 6,775 | 0.8370 | 0.9782 | 0.7990 | 0.7342 / 0.7006 |
| 2.2 refusal mask | 3,061 | **1.0000** | **1.0000** | 0.9141 | 0.9141 / 0.8933 |

**step = 1.0000 exactly, and that number is a tautology.** I refused precisely
the groups that disagree, so by construction every surviving object has zero
residual. The +0.1799 weighted gain measures *deletion of the counterexamples*,
not any capability. It must not be quoted as an improvement, and the 2.2 row is
not a quality claim.

This also settles the R8 request as stated: a regenerated corpus cannot be built
here, because regeneration needs the champion runtime that is absent after the
external cleanup. 2.2-candidate is a refusal manifest over the frozen cache, and
is labelled as such.

## 20. Is any model/RTX work justified? **No.**

Stronger than in Phase Q. The decoder is exact, every coordinate contract is
provably consistent, and the residual 16.3% is a contradiction *inside the labels*:
for 70.65% of them the PDF renders the whole measure one staff step from where
the MusicXML places it. Training against those labels would fit the
contradiction. Even a perfect model cannot exceed the label's own consistency.

The metric itself is now the blocker: any headline number computed on 2.1 is
capped at 0.8370 step by label disagreement, and any number computed after
refusal is 1.0000 by construction. **There is currently no valid measurement of
this model's pitch capability at all.**

### Required next step (CPU only)

1. Extract each measure's **printed clef** from the source PDF into the shards
   (`staffBands` currently stores only `y0`/`y1`).
2. Re-derive `center_diatonic` from the *printed* clef and re-test the 388
   uniform-transposition groups. A mis-tracked clef is the one remaining
   mechanism that produces a constant one-step group offset.
3. Only if the printed clef agrees, classify those groups as source mismatch and
   refuse them permanently — still without relabelling.

## Scripts

- `phase_r_alignment.py` — R0 manifest, R1/R2 event tracing, R4/R5/R6 strata.
- `phase_r_feasibility.py` — R7 monotone pairing feasibility.
- `phase_r_refuse_rebaseline.py` — R8 refusal manifest, R9 rebaseline.