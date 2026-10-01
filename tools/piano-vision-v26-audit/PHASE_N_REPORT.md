# Phase N — reflow vs partition: question NOT answered, and my own numbers are invalid

**Systems align well between the two documents. The measure-count comparison is
invalid because the PDF barline detector over-counts by ~5.7×, and the "class C"
result is an artefact of that detector, not evidence of a partition difference.
I am withdrawing it. No policy decision, no certification, no refusal, no
qualification set, no model or RTX work.**

---

## 1. Reflow or true partition difference? **Not established.**

## 2–5. Per-score counts

| score | PDF systems | PDF barlines | Verovio systems | Verovio measures | diff |
|---|---|---|---|---|---|
| bach-fugue | **10** | 155 | **10** | 27 | +128 |
| beethoven-sonata | 20 | 557 | 34 | 152 | +405 |
| chopin-etude-10-01 | 21 | 354 | 28 | 79 | +275 |
| chopin-etude-10-12 | 21 | 537 | 31 | 84 | +453 |
| chopin-nocturne | 12 | 475 | 19 | 38 | +437 |
| mozart-k153 | 22 | 290 | 21 | 67 | +223 |
| dense-advanced | 2 | 30 | 2 | 8 | +22 |
| grand-voices | 2 | 43 | 2 | 8 | +35 |
| rhythm-tuplets | 2 | 26 | 1 | 8 | +18 |
| bach-prelude | 12 | 260 | 15 | 35 | +225 |
| fur-elise | 19 | 625 | 14 | 105 | +520 |
| brahms-waltz | 3 | 30 | 6 | 33 | −3 |
| mazurka | 23 | 377 | 17 | 74 | +303 |
| handel-gavotte | 4 | 95 | 5 | 20 | +75 |
| turkish-march | 25 | 810 | 20 | 128 | +682 |
| old-french-song | 4 | 48 | 6 | 33 | +15 |
| demo-minuet | 6 | 137 | 5 | 32 | +105 |

**System counts are broadly comparable**, which is encouraging and consistent
with pure reflow: bach-fugue 10/10, mozart 22/21, fur-elise 19/14, mazurka
23/17, beethoven 20/34, chopin 21/28. Two documents that partition measures
identically but wrap lines differently would look exactly like this.

## 6. Pickup / terminal handling

Not reached. Convention differences cannot be assessed while the boundary counts
are dominated by a detector defect. The one score that came out *close*
(`brahms-waltz`, −3) is not evidence of anything either.

## 7. First structural divergence

**Cannot be located, because the PDF boundary sequence is not yet a measurement.**
A 5.7× over-count means the "PDF" sequence contains ~5 spurious boundaries per
real one, so no prefix of it corresponds to the Verovio sequence.

## The reason, and it is a defect I own

The PDF detector tests

```
column_ink_count >= 0.85 * band_height      and      group width <= 7 px
```

That counts **total** ink in a column, not a **contiguous** vertical run. Across a
full system extent a column routinely contains several separate note stems —
stacked voices, chord members, beam edges — and their ink sums past 0.85 × the
band height while being obviously not a barline. Dense polyphonic music is
therefore maximally vulnerable, which is exactly the corpus.

This is precisely the criterion Phase L's L4 told me to replace, and which I
deferred as unnecessary once the Verovio census refuted *that* phase's stated
cause. I refuted the Verovio undercount correctly, and then wrongly carried the
conclusion that the PDF detector did not need work. It does.

Evidence the criterion is at fault rather than the notation: beethoven-sonata
reports **557** boundaries for 152 measures (3.7 per measure) and turkish-march
**810** for 128 (6.3 per measure). Real engraving has at most one barline per
measure boundary.

## 8–16

| | |
|---|---|
| pitch-independent ordinal measure mapping | **does not exist yet** — the PDF side is not measured |
| clean matched-note N | not evaluated |
| clean `<0.25` / `r_render=0` | not evaluated |
| valid >98% gate result | **NOT EVALUATED** |
| source mismatch certified | **NO** |
| Corpus 2.1 qualified | **NO** — remains unqualified |
| valid capability number | **none** — 2.1 immutable: 6,775 labels, 16.30% disagreement, step 0.8370 / octave 0.9782 / accidental 0.7990 / written pitch 0.7342 / 0.7006 |
| model / RTX work | **not justified** |

I am also **not** treating the reproduced medians (+0.54 / −0.45 staff spaces) as
sufficient. They are strong supporting evidence, but clean correspondence has
never exceeded ~73%, so per N7 nothing is certified or refused on that basis.

---

## Correction to Phase M, in the opposite direction

Phase M concluded the documents "partition measures differently" and I presented
that as a structural finding. On this evidence that conclusion is **not
supported**. What is actually established:

- the **Verovio** boundary sequence is complete and exact (Phase M: A=B, C=2B);
- the **system wrapping** differs between the documents, which is expected and
  is precisely what N0 asks us to cancel;
- the **PDF** boundary sequence is **not yet measured**, so the partition
  question is open, not answered.

I over-claimed once by reading a grid-cell detector output as a notated measure
count, and I have now also caught the mirror-image error of treating a
broken detector output as a structural difference. Both times the mistake was
treating a measurement as a fact.

## The next step, stated but not taken

Implement the L4 criterion the brief already specified, and only that:

- **longest contiguous vertical dark run** within the band, not total column ink;
- require the run to cover from near the top staff line to near the bottom staff
  line, with internal gaps bounded;
- require horizontal isolation from neighbouring ink within ±1 staff gap;
- cluster multi-stroke boundary events (double/final/repeat) by central x;
- **assert** that a system row's boundary count is within 1 of its measure count
  once a reference exists — and until then, assert the weaker but still decisive
  invariant that a heavily polyphonic score cannot report more boundaries than
  roughly 1.5 per measure.

That is a single, well-specified function with a numeric acceptance test. It is
the last unmeasured quantity in the source-truth question, and it is genuinely
CPU-only with no runtime and no model.

---

## Script

- `phase_n_reflow.py` — N0–N3: pitch-independent staff-extent recovery from
  raster staff-line rows, barline detection inside the true staff extent,
  Verovio DOM measure counting, and per-score comparison. Its output is the
  evidence that the PDF boundary sequence is not yet a measurement.
