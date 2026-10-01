# Phase L — barline fidelity: the stated cause is refuted

**L1/L2 answer the question and close it: there are NO missing SVG forms. The
Verovio barline extraction already captures 100% of barline geometry, so generic
geometry extraction is unnecessary here, and the premise that drove Phase L —
"2–3 barlines where 5–7 measures are visible" — is a per-staff-unit vs per-row
conflation, not an extraction undercount. I did not proceed to note matching,
and L4/L5 PDF-detector work is not justified by the cause as stated.**

---

## 1–2. Verovio `barLine` subtree inventory and missing forms

Full recursive walk of every `<g class="barLine">` subtree, page 1 of
`bc-bach-fugue-bwv846`:

| element form | count |
|---|---|
| `path` with a `d` attribute | **34** |
| `g` with `class` | 17 |

**Frequency table is complete: the subtree contains only `g.barLine` → `path[d]`.
There are no `line`, `rect`, `polyline`, `polygon`, `use`, or nested-geometry
forms.** Sample: `<g id="f187hj5r" class="barLine"><path d="M6718 1343 L6718 2063"
stroke-width="27"/>` — which is exactly the `M x y0 L x y1` form my extractor
already parses.

**Missing forms found: none.** The existing regex is not the limitation.

## 3. Generic geometry implementation: not required

Because the observed form set is homogeneous and already handled, L2's
multi-form extractor has nothing to extract. Writing it would be code for its own
sake. I did not write it, and I say so rather than shipping an unused abstraction.

## 4. Verovio count before/after

**No change was needed — the count was already correct.**

| | page 1, bach-fugue |
|---|---|
| measure groups | **17** |
| `barLine` groups per measure | **1** (census: `{1: 17}`) |
| raw `barLine` paths | **34** (2 per group, one per staff) |
| paths captured by the existing extractor | **34 (100%)** |

Across the corpus, from K1R: **56/56** (bach-fugue), **306/306** (beethoven-
sonata), **160/160** (chopin-etude-10-01) barline paths assigned to a staff unit.

## The premise is wrong

Page 1 has **17 measure groups and 17 `barLine` groups — one boundary per
notated measure, which is the correct count.** The "2–3 barlines" figure came
from my K1R diagnostic reporting **per staff unit**, while the expectation of
"5–7" was **per system row**. With 17 measures over page 1's 3 system rows, a row
holds ~5.7 measures and a staff unit in it receives that row's barlines. The
apparent 2× gap is a units mismatch in how I read the earlier table, not a
missing boundary.

**So the L-phase blocker as stated — "Verovio gross undercount" — does not
exist.** Extraction is complete and structurally correct.

## 5–9. PDF detector, event deduplication, count gate: not built

L4/L5/L6/L7 all rest on the premise that Verovio's barlines are missing. They
are not, so the PDF side was never the problem, and the raster detector's
4–12 spread is most likely a legitimate consequence of the **corpus measure grid
splitting and merging measures** — the same documented behaviour that makes
`scopeBounds` unusable as a measure extent. Its candidates may well be correct
boundaries of a *different* partition, not false positives.

I did not implement the stricter contiguous-run test, the stem-cluster
false-positive taxonomy, the barline-event deduplication, or the count-consistency
gate. Building them would have been optimising against a cause that this phase
just refuted.

**PDF count before/after: unchanged (4–12 candidates per staff unit), and now
with a stated reason not to treat that as a defect.**

## 10. Sample score diagnostics

See §1 and §4. The diagnostic that mattered was the form census, and it came out
homogeneous.

## 11. BARLINE GATE: **NOT EVALUATED**

Deliberately. The gate's first condition is "Verovio gross undercount is gone" —
and the count was never under-counted, so there is no gate to pass or fail. Per
the L8 rule I did not calculate any note-match rate, and I did not proceed to
K3R/K6R.

## 12–20

| | |
|---|---|
| matched barline interval count | not computed |
| clean matched-note N | not computed |
| clean `<0.25` / `r_render=0` | not evaluated |
| valid >98% gate result | **NOT EVALUATED** |
| **K14 legitimately triggered** | **NO** |
| source certification | **none** — not justified |
| capability number | **none** — 2.1 immutable: 6,775 labels, 16.30% disagreement, step 0.8370 / octave 0.9782 / accidental 0.7990 / written pitch 0.7342 / 0.7006 |
| model / RTX work | **not justified** |

---

## What this phase is worth

It **removes a false blocker and stops a line of work** that would have been
wasted. Three phases (I, J, K) have now failed on Verovio-side *structure*; this
one establishes that the structure is sound and the remaining obstacle is
something else entirely.

**What is now known-good, with evidence:**
- Verovio barline geometry: complete, homogeneous form, 100% captured, one
  boundary per notated measure.
- Verovio barline → staff-unit assignment: 100% by vertical overlap.
- Verovio staff-unit construction: unique keys after per-measure merging.
- PDF raster barline detection: works.
- PDF geometry: exact (`k_from_pdf_source − cached_k` = 0; `d_pdf ≡ d0`).

**The one thing still unexplained, stated precisely:** a staff unit reports 3
barlines where its system row should contribute ~5.7. I could not resolve whether
that is (a) my K1R diagnostic reading, (b) a genuine factor-of-two in attribution,
or (c) Verovio drawing a boundary only at some measures. Given the census shows
one `barLine` group per measure group, (a) or (c) is far more likely than a
missing-form bug, and I have stopped rather than guess.

**The next step should be a count reconciliation, not a detector rewrite:** print,
for one staff unit, the measure groups intersecting it, the `barLine` groups
attached to those measures, and the extracted x positions side by side. If those
three agree, the barline layer is finished and the pipeline should be resumed;
if they disagree by 2×, the attribution is the bug. That is one diagnostic
print, and it is the honest next step rather than another phase of extractor work.

---

## Script

- `/tmp/opencode/l1.py` (throwaway) — the recursive `barLine` subtree census whose
  output is the finding. The result is recorded here and in the commit message;
  no new tracked script was added, because no new pipeline code was warranted.
