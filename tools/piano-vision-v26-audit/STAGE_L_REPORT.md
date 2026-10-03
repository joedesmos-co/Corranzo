# Stage L — exact labelling work order (PLAN ONLY)

Nothing was mutated: Corpus 2.1, training data, source labels and the qualification
set are untouched, and no labels were created. All inputs are the frozen assets
(measure map hash verified, frozen detector, canonical staff rectangles, corpus 2.1
records read-only, MusicXML/Verovio structural representation only).

## Headline: labelling alone cannot reach a meaningful clean gate

| Category | Noteheads | Measures |
|---|---|---|
| **A** existing source event, corpus annotation missing | **62** | 7 |
| **B** source correspondence itself ambiguous | **365** | 35 |
| total in high-confidence mapped measures | 457 | 42 |

Category A is the only straightforward labelling work, and it is **exhausted**:
labelling *everything* in A yields **68 matched notes**. So the N~100, N~250 and
N~500 targets are all **unreachable by annotation alone** — the round-robin selector
returns the identical set for each target because the pool is empty above 68.

Dominant B cause: `onset_group_count_differs` in 58 measures, then
`degenerate_verovio_span` in 7 and `no_corpus_system` in 6.

## L1 — coverage audit

Totals across 28 high-confidence mapped systems: 457 printed noteheads visible,
134 corpus-labelled (**29.3% coverage**), 62 confidently missing, 365 unresolved.

| System state | Count |
|---|---|
| fully labelled | 6 |
| partially labelled | 8 |
| completely unlabelled | 12 |

Per-score detail is in `out/L1_system_coverage.json`, per-measure in
`out/L2_measure_workorder.json`.

## L3 — tiers

| Tier | Systems | Measures | Missing noteheads |
|---|---|---|---|
| 1 — `EXACT_ANCHORED`, both staves, incomplete | 3 | 3 | 50 |
| 2 — other high-confidence | 2 | 2 | 4 |
| 3 — ambiguous / unresolved (**do not label**) | 21 | 35 | 8 |

Tier 1 detail:

| Score | Page | System | XML ord | Visible | Labelled | Missing |
|---|---|---|---|---|---|---|
| bc-chopin-etude-op10-01 | 1 | 0 | 0 | 17 | 0 | 12 |
| omf-piano-dense-advanced-vector | 1 | 0 | 0 | 33 | 0 | 32 |
| pl-tchaikovsky-old-french-song | 1 | 0 | 0 | 8 | 0 | 6 |

Tier 2 detail: bach-fugue p1 s0 ord 0 (8 visible / 8 labelled / 2 missing),
chopin-mazurka-op6-1 p3 s8 ord 73 (2 / 0 / 2).

## L6 — case studies

| Score | Mapped sys / meas | Visible | Labelled | Missing | **Ambiguous** | Labelling creates complete groups? |
|---|---|---|---|---|---|---|
| pl-handel-gavotte | 6 / 20 | 242 | 65 | 7 | **232** | **NO (0 measures)** |
| bc-bach-fugue-bwv846 | 2 / 2 | 24 | 8 | 2 | 16 | yes, 1 measure |
| bc-beethoven-sonata-op2-m1 | 1 / 1 | 4 | 0 | 0 | 4 | no |
| bc-chopin-etude-op10-12 | 1 / 1 | 19 | 17 | 1 | 5 | no |

**The Handel case overturns the premise.** Handel has 20 count-anchored measures —
the largest mapped region in the corpus — and only 7 missing annotations, but 232 of
its 242 rendered noteheads are category B. Handel's problem is **not** a labelling
gap: every one of its 20 measures fails the onset-structure test, so labelling it
would create **zero** structurally complete groups. All 6 mapped systems are bound to
a corpus system; none is unlabelled.

## L7 — A versus B

- **A (62 noteheads, 7 measures)** — the source event exists and Corpus 2.1 simply
  has no annotation. This is ordinary labelling work.
- **B (365 noteheads, 35 measures)** — the PDF-to-source correspondence cannot be
  established structurally. This needs **source adjudication**, not annotation, and
  annotation cannot fix it.

The reason B dominates is specific: when the corpus labels fewer onset groups than
the source renders, it is not decidable from the corpus alone whether the extra
groups are unlabelled real noteheads or source events absent from the PDF.

## L8 — annotation schema required (existing Corpus 2.1 schema, no replacement)

An added annotation must be one more record in the existing shard `.jsonl.gz` format:

- `schemaVersion`, `scoreId`, `split`, `campaign_split` — as today
- `exampleId` — `scoreId:page-p{page}-s{system}-x{slice}`, one slice per system
- `provenance` — must record that the record was added in the labelling campaign,
  **not** derived from `d0`, the structured decoder, or PDF geometry
- `input.modelInput.geometry` — `coordinateSpace: "pdf-source-normalized"`,
  `scopeBounds` = the measure's mapped `[x0,x1]`, `staffBands[]` with
  `{y0, y1, staffRole}`
- `input.modelInput.physicalObjects[]` — `objectIndex`, `kind`,
  `center{x,y}`, `bounds{x0,x1,y0,y1}`, `geometryConfidence`, `geometrySource`
- `target.families.PITCH_STAFF[]` — `labelId`, `family`, `state`, `confidence`,
  `isPositive`, `objectIndexes[]`, `semanticEventIds[]`, `provenance`, `reason`, and
  `value` = `{staff, staffRole, staffPosition{state, representation,
  stepsFromBandCenter, sourceY, staffGapNormalized}, writtenPitch{step, alter, octave},
  accidentalState{printed, writtenAlter, keyContext}, clefContext{state, value}}`

No new field is required. The only addition worth making is inside `provenance`:
the structural measure identity used (`pdf_ord`, `xml_ord`, `mapping_class`, map
hash), so every added annotation is traceable to the frozen map.

## L9 — safe labelling workflow

1. Only annotate measures that are `EXACT_ANCHORED` or count-anchored in the frozen
   map, and record the map hash in the record's provenance.
2. Establish PDF ↔ source **event** identity structurally first — measure identity,
   then onset identity from raster-printed onset columns. If onset identity is not
   structurally established, mark the record `UNRESOLVED`.
3. Only then may MusicXML supply `writtenPitch`. **Pitch must never be inferred from
   `d0`, from the structured decoder, or from PDF geometry.** If the identity is not
   independent, the label is unresolved, because source mismatch is precisely the
   quantity under test.
4. Leave both current bach-fugue measure-0 failures untouched; they are unresolved
   in this phase.
5. Re-run the frozen clean gate afterwards without changing the map or detector.

## L10 — effort

| Set | Systems | Measures | Noteheads |
|---|---|---|---|
| Tier 1 | 3 | 3 | 50 |
| Tier 1 + Tier 2 | 5 | 5 | 54 |

That is **+54 noteheads** on top of Corpus 2.1's current 134 labelled noteheads in
high-confidence mapped regions — about **+40%** relative to the currently evaluable
labelled set, and about **+11.8%** of the 457 printed noteheads visible in those
regions. It cannot lift the clean-control sample past ~68 notes.

## Conclusion

Adding Tier 1 labels is **cheap and worth doing, but it is not sufficient and on its
own it is not yet scientifically justified as a route to a certified gate.** It yields
at most 68 matched notes against a >98% threshold, which cannot be estimated with
useful confidence.

The binding constraint is category B — 365 noteheads in 35 measures where the PDF ↔
source correspondence is ambiguous. The next step is therefore **not** annotation: it
is a raster-only printed-onset detector, so that printed onset columns can be counted
in the PDF without relying on corpus labels or on the source. That would split B into
genuine A (unlabelled real notes) and agreement, and only then would a labelling
campaign sized for N ≥ 250 be meaningful.
