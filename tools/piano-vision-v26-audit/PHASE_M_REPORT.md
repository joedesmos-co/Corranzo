# Phase M — reconciliation complete: the Verovio barline layer is CLOSED

**There is no bug. A = B = C = D on the selected staff unit, and
`measures == barLineGroups` holds on every staff unit of all three sample scores.
The cause is class 5 — "system-row expectation was wrong". The Verovio barline
layer is now closed with a complete accounting.**

---

## 1–3. Selected staff unit and its full accounting

**M0 — staff unit:** page 1, `y_top = 1343.0`, upper staff of the first system
row (x extent 0 → 13,222; staff gap 180). Page 1 carries 12 distinct staff
`y_top` values = **6 system rows**, and 17 measure groups.

**M1 — measures on that row: 3.** Derived by testing each `<g class="measure">`
for a descendant staff at `y_top = 1343.0` within tolerance — never from page
order:

| # | measure id | on row | staff y_tops |
|---|---|---|---|
| 0 | `i1298x84` | **YES** | [1343.0, 3143.0] |
| 1 | `l1tn0kk5` | **YES** | [1343.0, 3143.0] |
| 2 | `t19bfla1` | **YES** | [1343.0, 3143.0] |
| 3–16 | … | no | other rows |

**M2 — their barLine groups: 3**, each with one path per staff:

| measure | barLine id | x | y0 | y1 | overlaps y_top=1343 |
|---|---|---|---|---|---|
| 0 | `q3ggfy` | 6718.0 | 1343.0 | 2063.0 | **yes** |
| 0 | `q3ggfy` | 6718.0 | 3143.0 | 3863.0 | no |
| 1 | `tu16jqe` | 13209.0 | 1343.0 | 2063.0 | **yes** |
| 1 | `tu16jqe` | 13209.0 | 3143.0 | 3863.0 | no |
| 2 | `b3q6cuv` | 19988.0 | 1343.0 | 2063.0 | **yes** |
| 2 | `b3q6cuv` | 19988.0 | 3143.0 | 3863.0 | no |

The lower staff of the same row (`y_top = 3143.0`) correctly receives the other
three paths — assignment is exact for both staves.

**M3 — reconciliation:**

| | count |
|---|---|
| A. measures whose descendant staff is on this row | **3** |
| B. barLine groups on those measures | **3** |
| C. barLine paths geometrically overlapping this unit | **3** |
| D. paths currently assigned to this staff unit | **3** |

**All four agree. The expected ~5–7 was never real:** page 1 has **6** system
rows, not 3, so 17 measures spread as 3/3/3/3/4/4. I had divided 17 by 3 rows
instead of 6. **3 barlines is exactly correct.**

## 4. Same reconciliation on three sample scores

For **every** staff unit on pages 1–2:

| score | staff units | invariant |
|---|---|---|
| bach-fugue | 12/page | `measures == barLineGroups`, `paths == 2 × groups` |
| beethoven-sonata | 12/page | same (4–5 measures/row) |
| chopin-etude-10-01 | 10/page | same (2–3 measures/row) |

Representative rows: chopin `y_top=1992.0` → 2 measures, 2 groups, 4 paths;
`y_top=6678.0` → 3/3/6. The accounting is exact everywhere.

## 5–6. Exact divergence point, root cause, fix

**Divergence point: there isn't one.** The counts never diverge; only my
*expectation* did.

**Root cause: class 5 — system-row expectation was wrong.** Not measure-to-row
attribution, not barLine-to-measure, not vertical-overlap assignment, not
staff-unit merging. One `barLine` group per measure group, one path per staff,
`measure → barLine` is 1:1 by construction of Verovio's output.

**Minimal fix required: none.** No code changed in this phase, deliberately.

## 7. Verovio barline layer: **CLOSED** (M6)

- measure-on-row count: understood (2–5 per row, from the DOM)
- associated barLine count: understood (1:1 with measures)
- extracted geometry count: understood (`paths = 2 × groups`, one per staff)
- assigned count: consistent with the DOM
- differences explained by boundary convention, not silent loss: **yes**

## 8–19

| | |
|---|---|
| K resumed / matched intervals | **no** — see below |
| clean matched-note N | not evaluated |
| clean `<0.25` / `r_render=0` | not evaluated |
| valid PASS/FAIL | **NOT EVALUATED** |
| **K14 legitimately triggered** | **NO** |
| capability number | **none** — 2.1 immutable: 6,775 labels, 16.30% disagreement, step 0.8370 / octave 0.9782 / accidental 0.7990 / written pitch 0.7342 / 0.7006 |
| model / RTX work | **not justified** |

## Why K is not resumed, and the real remaining obstacle

The Verovio side is now settled, and it exposes the actual blocker plainly.
**Verovio has 2–5 boundaries per staff unit; the PDF raster detector reports
4–12.** The two documents *partition measures differently*.

That is not a detector defect. It is the documented behaviour of the corpus
measure grid, which `align_measure_sequence` describes as built from barline
projections that "split, merge and occasionally invent a measure relative to the
notated score". The corpus grid is therefore **not aligned to the notation**, and
barline-to-barline intervals cannot correspond between the two documents.

This is structural, and it also explains the earlier failures coherently:

- `scopeBounds` is not a notated measure extent (documented, and the reason
  Phase J's `x_rel` was invalid);
- the ink-bbox frame and the notated-bounds frame are different intervals
  (Phase J's specific defect);
- the raw barline count differs because the grid is a *different partition*
  (Phases K/L's residual 4–12 vs 2–5).

The only correspondence between the two partitions that the corpus actually
knows is the monotone measure mapping, and that mapping is **pitch-informed** —
so it is inadmissible for an independent source test. That is the bind: a
genuinely independent PDF-vs-MusicXML comparison requires agreement on where the
measure boundaries are, and the only source for that agreement is the pitch
information the test is supposed to be independent of.

### What this closes, and what it costs

**Closed with evidence:** the entire Verovio side. Barlines are complete,
homogeneous, correctly attributed to staves by vertical overlap, exactly one per
notated measure, on every staff unit of every sample score. The barline layer is
finished and needs no further work.

**The cost, stated plainly:** the route to a *non-circular* independent source
truth is narrower than it looked. I can measure "does the PDF agree with a
re-layout of its own MusicXML" only by adopting the corpus's measure partition,
which is derived from the labels. Any clean-control gate built that way would
partially inherit the thing it is meant to test.

The next decision is therefore not another matcher. It is whether to accept a
**clearly-labelled partial** result — the ±1 displacement, already reproduced by
two independent matchers at medians +0.54 / −0.45 staff spaces — as sufficient
evidence of a source-pair disagreement for those measure-bands, **with refusal
and never relabelling**, or to leave the corpus unqualified. That is a policy
call about what standard of evidence is acceptable, and it should be made
explicitly rather than by another phase of instrumentation.

---

## Script

- `phase_m_reconcile.py` — the M0–M4 reconciliation: measure-to-row attribution
  from the DOM, per-measure barLine enumeration with vertical-overlap assignment,
  the A/B/C/D accounting, and the three-score generalisation check.
