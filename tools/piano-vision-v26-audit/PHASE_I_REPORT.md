# Phase I — render-side identity, and a FAILED clean-control gate

**STOPPED at I5 as instructed. No certification, no refusal, no qualification set,
no rebaseline, no corpus change, no model work.**

The brief's gate is explicit: *"If exact identity does not collapse that tail:
STOP."* It did not collapse. Clean controls still show **31.9%** of notes beyond
the 0.25-space boundary, against a required threshold of 2%.

---

## 1–2. Does Verovio expose or preserve stable note IDs? **No — proven.**

| probe | result |
|---|---|
| `xml:id` anywhere in `renderToSVG()` | **0** |
| `data-*` attributes in SVG | **0** |
| `data-*` / `xml:id` on `<g class="note">` | none; only Verovio-generated `id="m1hccf23"` |
| diagnostic copy with `xml:id="corranzo-e1..3"` → `getMEI()` | **0 occurrences** |
| diagnostic copy → `renderToSVG()` | **0 occurrences** |

Verovio **discards MusicXML note identity outright**. The I1 diagnostic
instrument was built exactly as specified (stable `corranzo-m{measure}-e{index}`
ids on `<note>`, pitch/onset/duration/staff/voice/chord untouched) and rendered
without error — the ids simply do not survive. So no source-derived id path
exists.

## 3–4. What *does* survive, and the mapping coverage

Verovio's own MEI and SVG share element ids: SVG `<g id="X" class="note">` is
MEI `<note xml:id="X">`, and SVG `<g id="L" class="layer">` is MEI
`<layer xml:id="L" n="V">`. That bridge is real and gives every rendered
notehead a structural address of **(measure n, staff n, layer n, rank in layer)**.

| | count |
|---|---|
| rendered noteheads addressed structurally | 5,070 |
| corpus notes mapped to one | **1,971** |
| rejected: no notehead at that key | **4,804 (70.9%)** |

The high rejection rate means my layer key does not align with the corpus's
voice numbering, so most notes never find their address. Mapping coverage is
therefore **poor in the wrong direction** — it discarded 70.9% of the population
rather than resolving it.

## 5. Fallback matcher result: **worse than the previous method**

| matcher | identified | clean `\|delta\| ≥ 0.25` | clean `r_render = 0` |
|---|---|---|---|
| event-rank (Phase U) | 6,507 | **0.2680** | 0.7321 |
| layer-aware MEI↔SVG (this phase) | 1,971 | **0.3192** | 0.6808 |

The structural matcher made the clean control **worse** on both metrics while
losing two thirds of the coverage. I am not keeping it.

## 6. Confusion matrix (layer-aware, as measured)

| `r_corpus` | n | agrees | rate |
|---|---|---|---|
| −1 | 194 | 133 | 0.6856 |
| 0 | 1,626 | 1,107 | 0.6808 |
| +1 | 151 | 99 | 0.6556 |
| **TOTAL** | **1,971** | 1,339 | **0.6794** |

## 7–8. Clean-control displacement distribution — **the gate**

| | value |
|---|---|
| n | 1,626 |
| median | **+0.0552** spaces |
| p10 / p25 | −0.9397 / +0.0313 |
| p75 / p90 | +0.0745 / **+1.5607** |
| `\|delta\| ≥ 0.25` | **0.3192** |
| `r_render = 0` | 0.6808 |
| **GATE (>98% within 0.25)** | **FAIL** |

The **core is excellent** — p25/p75 are +0.031/+0.075, i.e. the central half of
clean notes agree to within a twentieth of a space. The **tail is the problem**:
p10 is −0.94 and p90 is +1.56, so roughly a third of clean notes are being
compared against the wrong rendered notehead. That is a matcher defect, not a
property of either source document.

## 9–10. ±1 populations (unchanged in substance)

| population | n | median | p10 | p90 | ≥0.25 |
|---|---|---|---|---|---|
| `r_corpus = +1` | 151 | **+0.5418** | −0.9412 | +2.0439 | 0.9801 |
| `r_corpus = −1` | 194 | **−0.4458** | −1.4500 | +0.0518 | 0.9485 |

Worth stating plainly: **these medians reproduce across two structurally
different matchers** (event-rank gave +0.5552 / −0.4508; layer-aware gives
+0.5418 / −0.4458). The direction and rough magnitude of the displacement are
therefore robust to the matcher. That is a genuine consistency check — but it is
not the gate, and the gate is what certification requires.

## 11–12. Contour and within-group variance: not run

Both were gated behind I5. Running them on a population where a third of the
control is mis-matched would produce numbers that look authoritative and mean
nothing, so I stopped instead.

## 13–15. Certification outcome

| | |
|---|---|
| **% uniform groups certified source mismatch** | **0%** |
| **% unresolved** | **100%** of the 1,104 |

Mixed groups (I8) were **not** classified: with 31.9% of clean controls
mis-matched, any taxonomy derived from the same matcher would inherit its error.
Forcing one cause across them is exactly what I8 forbids.

## 16–19. No downstream action

- **Refusal policy:** unchanged, conservative. Nothing refused, nothing
  relabelled. Corpus 2.1 immutable.
- **Qualification set (I10):** not built. Every provenance rule still depends on
  a render identity that does not exist.
- **Qualified N / score count:** none.
- **Zero-parameter decoder on qualified truth (I12):** not run. 2.1 remains
  6,775 labels, 16.30% disagreement, step 0.8370 / octave 0.9782 /
  accidental 0.7990 / written pitch 0.7342 / 0.7006.

Two measurements that *are* exact and worth keeping:

| check | result |
|---|---|
| `k_from_pdf_source − cached k` | mean **0.000000**, std **0.000000**, max **0.000000** |
| `d_pdf == d0` | **1,971 / 1,971** (and 6,507/6,507 under event-rank) |

## 20. Does a valid capability measurement exist? **No.**

## 21. Is any model/RTX work justified? **No.**

---

## What this phase actually settled

1. **Verovio cannot carry note identity**, and this is now proven rather than
   assumed: a diagnostic copy with stable `xml:id`s renders fine and loses them
   completely. Any future claim of exact identity must therefore be
   *constructed*, not inherited.
2. **The PDF side is finished and exact.** Cached `k` reproduces the source
   geometry to 0.000000 and `d_pdf ≡ d0` on every matched note. No further work
   belongs on the PDF side.
3. **The displacement is real and matcher-robust** (±0.45/±0.55 spaces,
   reproduced by two independent matchers), but **not yet certifiable**.

## The precise blocker, and the one thing worth trying next

The blocker is now narrow and well-defined: **within a rendered staff, which
rendered notehead corresponds to which corpus object, using only geometry.**

Rank- and layer-based correspondence both fail because Verovio reorders notes
inside a staff (chord members and voices interleave by onset, not document
order). The correspondence that *should* work is **layout-based rather than
order-based**:

- cluster rendered noteheads by **x** into onset groups (a chord is one x
  cluster; a second is the next cluster);
- cluster corpus objects by x the same way;
- match onset groups **in order**, and within a group match by **vertical
  order**.

This uses only x and y — no pitch, no clef, no residual — and it is immune to
the reordering that defeats both methods tried so far. The clean-control gate
(>98% within 0.25 spaces) is the immediate pass/fail on whether it works.

If that gate still fails, the conclusion is that Verovio's layout is not
recoverable to the required precision by geometry alone, and the honest
conclusion is that **the source-truth question cannot be settled with this tool**
— at which point the remaining option is comparing the *original PDF* against a
second independent renderer rather than against a re-layout of the same file.
Either way it is CPU-only, needs no runtime, and no model or GPU work is
warranted at any point.

---

## Scripts

- `phase_i_identity.py` — I0/I1 stable-ID probes, I3 layer-aware MEI↔SVG
  identity, I4 confusion matrix, I5 clean-control gate. Kept because the
  negative results are the evidence.
