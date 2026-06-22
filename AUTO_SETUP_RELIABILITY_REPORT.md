# Auto Score-Follow Setup — Reliability Pass

**Date:** 2026-06-21
**Goal:** Make automatic scorebar/cursor setup the primary experience. When a user
uploads a normal sheet-music PDF plus a matching MusicXML/MIDI file, ScoreFlow
should produce a usable approximate score-follow cursor automatically in most
cases. Manual marking is now a rare last-resort rescue path, not normal flow.

---

## Measure-local x pass (beat 1 placement)

The cursor sat slightly "behind" — beat 1 of measure 1 landed at the far-left
system margin (brace/clef/key/time area) instead of at the first note, and every
measure on a system was placed by even spacing from that same left edge, so
later measures inherited measure 1's clef padding.

**Fix — a measure-local x model (no global or system-wide offset, no
hardcoding).** Each written measure now carries its own visual span:
`measureStartX`, `measurePlayableStartX` (beat 1), `measurePlayableEndX`.

- **Measure boundaries** come from cumulative MusicXML engraved widths
  (`<measure width>`, newly parsed) anchored onto the detected barlines (first &
  last) of each system. Verified: predicted boundaries land within ~0.001 of the
  detected barlines on the real Gymnopédie. This makes measure 1 (wide, with the
  clef) occupy its true wide span while later measures get their own narrower
  spans — no inherited padding.
- **Beat 1 inside each measure** comes from the first note's `default-x`, which
  the engraver placed *after* the clef/key/time on a system's first measure. So
  measure 1's beat 1 sits at the first note, not the margin; middle measures sit
  just past their own barline. A clamp guards against a mis-encoded default-x
  pushing beat 1 past the notes. When widths/default-x are absent, a conservative
  per-measure lead is used (larger for a system's first measure).
- **The resolver glides within the current measure's own span**
  (`playableStartX → playableEndX`), keeping movement monotonic and snapping to
  the next measure's beat 1 only at the boundary.

**Result on the real Gymnopédie:** measure 1 beat 1 maps to x≈0.205 (past the
clef/key/time, at the first chord — was ≈0.08); measures 2–5 start at their own
barlines (0.356, 0.503, 0.654, 0.801) and do not inherit measure 1's padding.
Guren is unchanged (19 systems, exact starts, 0 backward-x). The dev trace
exposes each active measure's start / playable-start / playable-end / x-source.

---

## Light-classical pass (adaptive detection)

A clean classical piano score (Satie's *Gymnopédie No. 1*) failed with "Auto
setup could not find systems," while dense Guren worked. The staff-line detector
used a **fixed** ink threshold (luminance < 170) and a fixed run-coverage
requirement — fine for dense dark engraving, but light/thin classical staff
lines (luminance ~185–210) fell below it, so no staff-line rows were found, and
very light lines even read as a *blank* page (skipped).

**Fixes (detection only — Guren mapping untouched).**
- **Adaptive ink threshold** (`estimateInkThreshold`): the midpoint between the
  page's paper background and its ink level. Dark engraving → low threshold
  (precise); light engraving → high threshold (catches faint lines). Drives both
  staff-line and barline detection.
- **Broken-line + multi-pass detection**: a row qualifies as a staff line by its
  longest contiguous dark run OR its total dark fraction (handles lines crossed
  by noteheads/slurs); passes run strict→permissive (coverage and short-system
  tolerant) and accept the first plausible result.
- **Consistent-separation pairing**: treble/bass are grouped into grand-staff
  systems when the chunk-boundary gaps *consistently* exceed the within-pair
  gaps — not by a fixed ratio. Satie's airy engraving has a within-pair gap only
  ~12% smaller than the system gap, but the separation is clean, so it pairs
  correctly; uniform spacing (merged staves) is left unchunked.
- **Adaptive ink ratio** so a light page is never skipped as blank.
- The staff-detection failure path now emits a debug trace (analysis threshold,
  candidate rows, max run coverage, clusters, reason).

**Result:** the real Gymnopédie PDF + MXL now auto-detects 15 systems (≈5 per
page) at the staff-line stage with barline-counted measure ranges and a smooth
per-measure cursor — no manual setup. Guren is byte-for-byte unchanged (19
systems, exact acceptance starts). A synthetic light-classical fixture (thin
light lines, short systems, whitespace, slurs) and a dense-arrangement
regression are covered by tests, and "a clean page with visible staff lines can
never return no-systems" is asserted across a range of line intensities.

---

## Playback-following pass (cursor movement)

With PDF mapping correct, the cursor was on the right system but moved wrong
during playback: it stalled on the first measure, jumped to the system end, and
jittered backward before dropping to the next line.

**Cause (proven with a cursor trace on the real Guren anchors):** each system
had only **two** anchors — a start (measure 1, x≈0.085) and an end (measure 5,
x≈0.901). Measure 1 had no next-measure anchor to glide to, so it *sat*;
measures 2–4 had no anchors at all and were bracket-interpolated across the
*entire* start→end span, producing a jump to ~x0.57 then non-monotonic
backward bounces.

**Fix.**
- **One canonical anchor per written measure** (`buildPerMeasureSystemAnchors`):
  evenly spaced across each detected system's x-range (stable and monotonic; the
  measure *count* still comes from barline detection). These `AUTO_MEASURE`
  anchors outrank the `AUTO_SYSTEM` start/end spans during dedupe, so there is
  exactly one canonical visual anchor per measure — no duplicate bouncing.
- **Resolver glide** (`resolveScoreFollowCursor`): within a measure the cursor
  glides toward the next measure's anchor on the same system, or — for the last
  measure of a system — toward the system's right edge (`systemEndX`). The glide
  target is always to the right of the current x, so movement is **forward-only
  and monotonic**; the system end is reached only on the actual last measure.
- Written-measure anchors are never repeat-expanded; repeats affect playback
  order only. The resolver's single timing source of truth is the MusicXML
  performed timeline (measure lookup and anchor times come from the same map).
- The dev debug object (`scoreFollow.debug`) gained a live cursor trace:
  playback time, score measure, beat progress, x/y, motion (locked/glide/hold),
  confidence, and timing source.

**Result on the real Guren PDF (full sweep, 0:00→end):** the cursor glides
smoothly through measures 1–5 on system 1, drops to system 2 exactly at measure
6, and so on (system changes at 6, 11, 15, 19, 23, 27, 31, 35, 38, 41, …) with
**zero backward-x events within a system** — no stall, no early end-jump, no
jitter.

---

## Uploaded-score pass (PDF-geometry-primary rewrite)

The demo's bundled anchors were masking a broken pipeline: real multi-page
uploads mapped the cursor to the wrong system. Investigating the real
**Guren no Yumiya** upload (4-page PDF + MXL) revealed why, and drove a rewrite.

**Key findings on the real files.**
- The MXL embeds a **5-page** layout (page 1 systems at 1, 6, 10, 14); the actual
  **PDF is 4 pages** (systems at 1, 6, 11, 15, 19). So MusicXML's embedded
  page/system breaks come from a *different engraving* than the PDF the user
  follows — **they cannot be trusted as the visual layout**. A "MusicXML-
  layout-first" approach would map every page wrong.
- Row-density band detection found 3 / 0 / 4 / 2 systems on the four pages (true
  counts 5 / 6 / 5 / 3) — dense piano ink has no clean valleys between systems.
- The old global in-order allocation cascaded: under-detecting one page by a
  single system shifted every later measure and dropped the final system.

**The rewrite — PDF geometry is primary, MusicXML supplies count + staff layout.**
1. **Staff-line detection** (`detectStaffLines.js`): staff systems are found from
   long, near-full-width horizontal runs of ink (staff lines), which survive even
   in dense music where row-density bands fail.
2. **Staves-per-system from MusicXML** (`<staves>` summed across parts; 2 for
   piano) groups detected staves into systems. Grouping uses a gap-consistency
   test (within-chunk gaps clearly smaller than between-chunk gaps), robust to
   whether treble/bass render as one merged staff or two.
3. **Barline counting** per system (full-system-height vertical runs, distinct
   from short note stems) gives measures-per-system; sequential allocation across
   pages yields exact, page-anchored measure ranges. Counts are reconciled to the
   MusicXML measure total (repeat/double-bar over-counts are normalised away).
4. **Honesty switch** (`areBundledDemoAnchorsDisabled` / `setBundledDemoAnchorsDisabled`):
   disables the demo's bundled anchors so the sample runs the *same* pipeline as
   uploads. The committed real-PDF tests already run the demo through the real
   pipeline (no bundle).
5. **Guardrails**: implausible mappings (unreconcilable per-page system-count
   mismatch, or measure 1 landing in the title/header) are downgraded to
   "Needs quick setup" rather than shown as a confidently-wrong cursor. Analysis
   resolution was raised to 1000px so thin staff lines/barlines survive.
6. **Debug report** (`scoreFollow.debug.autoSetup`, dev-only): file name /
   fingerprint, bundled-vs-auto-vs-manual provenance, pages analysed, detected
   systems per page, MusicXML measure count + break/`default-x` hints, allocation
   mode, per-system measure ranges, first/last anchor x, stage/confidence, and
   why the cursor is shown or blocked.

**Result on the real Guren PDF + MXL** (run through the actual pipeline): all 19
system starts are exact — page 1 **1, 6, 11, 15, 19**; page 2 **23, 27, 31, 35,
38, 41**; page 3 **45, 49, 53, 57, 61**; page 4 **65, 69, 74** — total 75 = MXL.
Every acceptance checkpoint passes (m1→p1s1, m6→p1s2, m15→p1s4, m23→p2s1,
m45→p3s1, m65→p4s1, m70→p4s2, m74→p4s3), confidence 1.0, stage `staff-lines`,
allocation `barline-counts`. The Minuet demo, run *without* its bundled anchors,
also maps to its 6 systems correctly.

**Honest limitation:** correctness depends on the PDF's staff lines and barlines
being detectable at 1000px. Very low-quality scans, handwritten scores, or
exotic notation may still fall back (tolerant/geometric detection → "Approximate
cursor", or "Needs quick setup" when implausible). The pipeline downgrades
honestly in those cases rather than showing a wrong cursor. This was verified on
two real PDFs (Guren, Minuet) plus synthetic fixtures; it is not a guarantee for
every possible PDF.

---

## Accuracy pass (follow-up)

The first pass made the cursor *appear* automatically. This pass makes it
*land in the right place* — the cursor must be on the correct page and system
and reasonably close to the current measure, not merely visible somewhere.

**Root cause of the "ridiculously off" cursor.** On the real Minuet PDF the
detector found all six staff bands, but the first band merged the title with the
first grand staff, so its top sat above the header cutoff and the **entire first
system was dropped**. With five systems instead of six, every measure was mapped
one system too low (≈13% of page height off — a whole system). The MIDI-derived
demo MusicXML has no system-break hints, so nothing caught the under-count.

**Fixes.**
1. *First-system preservation* — instead of dropping a band whose top is above
   the header cutoff, the detector now trims the title off at the title↔staff
   density gap and keeps the staff. Pure title bands are still dropped.
2. *Stage selection by recall* — the cascade runs conservative AND tolerant
   detection and prefers the higher-recall count (guarding against
   over-segmentation), because under-detection is what shifts the cursor.
3. *System-count reconciliation* — when MusicXML system/page breaks imply N
   systems but detection disagrees by more than one, a single-page result is
   rebuilt geometrically to exactly N bands (MusicXML structure wins).
4. *Allocation from breaks* — when MusicXML has system breaks, measures follow
   them exactly (e.g. 32 measures → 5,5,6,5,5,6), not a flat even split.
5. *Plausibility guardrail* — an unreconcilable system-count mismatch is flagged
   implausible and downgraded to "Needs quick setup" rather than shown as a
   confidently-wrong cursor. "Auto setup complete" is reserved for plausible,
   high-precision results; "Approximate cursor" for plausible coarse ones.
6. *Dev debug report* — `scoreFollow.debug.autoSetup` exposes detected systems,
   y-positions, per-system measure ranges, anchor sources, MusicXML hints used,
   and stage/confidence (dev-only, not in normal UI).

**Result on the real Minuet PDF (measured against PyMuPDF ground-truth anchors):**

| Metric | Before accuracy pass | After |
|--------|---------------------|-------|
| Systems detected | 5 of 6 (first dropped) | 6 of 6 |
| First-system position error | ≈0.13 (a full system) | 0.001 |
| Max per-system y error | ≈0.13 | 0.015 |
| Cursor y error at 25/50/75/95% seek | up to ≈0.13 | 0.004–0.015 |

The cursor now sits on the correct system at every seek point (within ~1.5% of
page height). With no MusicXML break hints, within-system measure boundaries are
still approximate (even distribution); with breaks present, measure ranges are
exact.

## The core bug this pass fixed

Pixel analysis ignored the alpha channel. Many PDFs — especially engraving-tool
exports — do **not** paint their own white background, so the page rasterises
onto a transparent canvas (RGB `0,0,0`, alpha `0`). The old luminance check read
RGB only, so **every pixel — ink and blank alike — looked black**, and staff
detection found zero systems and fell straight through to manual setup.

Verified on the bundled real Minuet in G PDF: before the fix, raster detection
found **0 systems**; after compositing over white it finds **5 of 6 systems** and
produces an approximate multi-row cursor automatically.

The fix is in two places: the analysis canvas is now painted white before
`page.render`, and every luminance/ink test composites over white using the
alpha channel (`detectStaffSystems`, `detectBarlinesInSystem`,
`pdfPageAnalysis`).

## Auto-setup stages

Automatic setup runs the moment a PDF + MusicXML are both loaded
(`useScoreFollow` triggers `analyzeSemiAutoScoreSetup`). It is a cascade that
always returns the best available result rather than refusing early:

1. **Stage 1 — MusicXML structure.** System/page breaks (`new-system`,
   `new-page`) and note `default-x` are read from the score. Break groups drive
   measure→system allocation and seed the geometric fallback; `default-x` is
   promoted to per-measure layout anchors when dense and monotonic enough.
2. **Stage 2a — Conservative staff detection.** High-precision row-density band
   detection with strict scoring. Used whenever it returns a sane system count.
   Produces the highest-confidence result ("Auto setup complete").
3. **Stage 2b — Tolerant staff detection.** Looser thresholds, wider band
   geometry, more aggressive valley splitting, and a higher per-page cap. Built
   for dense piano, anime/game arrangements, lyric-heavy charts, small noteheads
   and uneven scans. Drops title/header ink. Kicks in when conservative finds
   nothing or an implausible count.
4. **Stage 3 — Barline detection.** Within each detected system, vertical ink
   peaks become per-measure (`AUTO_MEASURE`) anchors, but only when the count is
   consistent with the measures expected in that system. Otherwise the system
   span is used.
5. **Stage 4 — Geometric fallback.** When pixels can't isolate systems, the
   inked content region (below the header) is split into bands — targeting the
   MusicXML system count when known, otherwise estimating from density valleys.
   Always yields ≥1 band for an inked page, so a cursor still appears.
6. **Stage 5 — Last resort.** Only if no inked page yields a single band does the
   pipeline fail, with one short line: *"Auto setup could not find systems. Mark
   system starts."*

Measure allocation prefers MusicXML system breaks; without them it distributes
measures across systems weighted by each system's visual width (largest-remainder
rounding), falling back to even distribution when widths are unavailable.

## Trust and cursor display

Approximate auto anchors now drive the cursor. `filterTrustedAnchors` and
`assessScoreFollowTrust` accept `AUTO_SYSTEM` (system spans) **and**
`AUTO_MEASURE` (barline-derived) anchors — the latter were previously built and
then silently discarded. Two or more trusted auto anchors yield trust level
`AUTO`, `showCursor: true`, `needsSetup: false`, labelled "Approximate cursor".
The cursor shows at medium/low confidence as long as the mapping is plausible;
manual markers always override auto guides.

## Fixtures tested

Synthetic sheet-music images (`tests/helpers/syntheticScore.js`) reproduce real
user cases as RGBA ImageData, so the geometry/allocation/trust pipeline is tested
end-to-end without a native rasteriser. The real Minuet PDF is exercised through a
canvas-backed test that runs where a Node canvas is available and skips cleanly
where it isn't.

| # | Fixture | Detection stage | Result |
|---|---------|-----------------|--------|
| 1 | Clean 1-page piano (6 systems) | Conservative | "Auto setup complete", 12 span anchors |
| 1b | Single-system clean page | Conservative + barlines | 2 span + 4 `AUTO_MEASURE` anchors |
| 2 | Dense piano arrangement | Tolerant | 5 systems, 10 span anchors, approximate cursor |
| 3 | Multi-page score | Tolerant | systems + anchors on every page |
| 4 | Visible staves, weak barlines | Tolerant | system spans only (no measure anchors), cursor shows |
| 5 | No MusicXML system hints | Cascade + width allocation | measures distributed across detected systems |
| 6 | Bundled demo (real Minuet PDF) | Tolerant (geometric pre-fix) | 5/6 systems, approximate cursor, no manual setup |
| 7 | Blank page | — | concise no-systems failure |

## Where auto setup succeeds

- Clean engraved one-page and multi-page scores → high-confidence conservative
  setup, "Auto setup complete".
- Dense / non-demo arrangements where conservative detection fails → tolerant
  detection recovers the systems and shows an approximate cursor.
- Scores with no MusicXML layout hints (including the MIDI-derived demo) → systems
  detected from pixels, measures allocated by width.
- The real bundled Minuet PDF → an approximate cursor appears automatically with
  no manual marking.

## Where it still falls short / what remains approximate

- On the real Minuet PDF, raster detection now finds all 6 systems (the accuracy
  pass fixed the dropped first system); per-system y error is ≈0.015. Without
  MusicXML break hints, within-system measure boundaries remain approximate
  (even distribution); precision is exact when `new-system` hints are present.
- Conservative (high-precision) detection still misses very imperfect/real
  engraving and hands off to tolerant/geometric — by design, but it means the
  high-confidence "complete" label is reserved for clean scores.
- Barline → per-measure anchors only appear when barlines are clean and the count
  matches; otherwise the cursor glides across system spans.

## Remaining fallback

The manual "Mark system starts" path still exists but is surfaced **only** when
auto setup genuinely produces no usable mapping (Stage 5). In the UI, manual
tools are tucked behind a small "Adjust cursor" disclosure whenever auto setup
worked, with short copy and no diagnostics by default.

## Is manual setup now a rare fallback?

Yes. Auto setup runs automatically on import and produces an approximate cursor
for every tested realistic fixture, including the real PDF, without manual
marking. Manual marking appears only on genuine detection failure (e.g. a blank
or unreadable page).

## Validation

- `npm test` → 171 passed, 3 skipped (the real-PDF test skips without a Node
  canvas; it runs on machines that have one).
- `npm run test:scripts` → all four suites pass, including the new
  `test-auto-setup-pipeline.mjs`.
- `npm run build` → compiles cleanly (1220 modules). *Note: in the sandbox the
  build's final step can't delete the pre-existing `dist/` mount; `dist` is
  gitignored and the build succeeds normally on the user's machine — verified by
  building to a temp output directory.*
- `npm run lint` → 71 problems (64 errors, 7 warnings). Identical to the
  pre-existing baseline; this pass added none.

## Product-readiness statement

A normal user-uploaded PDF + matching MusicXML now gets a visible approximate
score-follow cursor automatically, without manual setup — verified on synthetic
fixtures and on the real bundled Minuet in G PDF. Manual setup is a rare
last-resort fallback. Remaining limitations are about cursor *precision* on
imperfect scans (approximate, not absent), not about whether a cursor appears.
