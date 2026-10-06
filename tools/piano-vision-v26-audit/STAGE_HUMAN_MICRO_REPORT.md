# Stage H-MICRO — minimal human source-assisted micro-review: BUILT, awaiting the human

The V3 AI packet route is CLOSED by its pre-registered stop rule (N = 0 noteheads).
No V4. MEDIUM x3 was NOT relaxed into acceptance. No residual was inspected.
Corpus 2.1 immutable. No RTX, no training.

## H0 — population frozen
Exactly the V3 items with 3/3 unanimous SAME_STRUCTURE: **20 items**.
No further filtering on confidence, exact mappings, acceptance, category or decoder
behaviour — the 3/3-SAME set is 20 items and all 20 are included.

R001 R002 R004 R010 R011 R039 R040 R047 R049 R050 R054 R056 R058 R064 R066 R068
R070 R072 R074 R076

population sha256 `6abeebd9a717a03d0d40f2e09460c910e9b727b7517b198fc4fad97e1d65534d`

### Two real defects found and fixed before the UI was usable

**1. The X list was wrong.** The V1 `h_review_manifest.json` `source_onsets` is
truncated to correspondence candidates: it lists 8 X for R004 and 7 for R001, while
the rendered V3 sheets actually contain 12 and 8. Building the tool from the V1
manifest would have shown the human a different X set from the one drawn on the panel
next to it. The tool now derives X from `items_neutral.json`, which is what the
renderer consumed, and QC asserts the two agree.

**2. Markers were evenly spaced.** Even spacing drifts away from the notation and makes
click-pairing misleading. X positions are now computed from the renderer's own
`onset_x()` with the same constants used to draw the sheet; P positions are measured
off the red overlay lines already printed on the PDF panel. QC asserts both counts
equal the manifest, all fractions lie in (0,1) and are strictly increasing, and the
build asserts rather than trusts the geometry.

## H1 — no Question A
STRUCTURE CONSENSUS is displayed as fixed context. No A question, no control.

## H2–H6 — the tool
`out/h_review_human_micro/review.html`, local, no server, no dependencies.

LEFT actual PDF raster with its printed P proposals. RIGHT the V3 pitch-blind
structural rendering, byte-identical to the V3 packet sheet. Panels are full width.

Workflow: click a P, click an X, the pair is recorded and highlighted. Undo, UNSURE,
NO_COUNTERPART, NOT A NOTE ONSET, ADD UNLISTED ONSET, prev/next, and
U / N / Enter / arrows. Rank pairing auto-proposes top-to-top only when both sides
share the same cardinality; on a cardinality difference it is marked AMBIGUOUS and
contributes zero noteheads. No HIGH/MEDIUM/LOW scale exists: the only states are
CONFIRMED, UNSURE, AMBIGUOUS.

Progress: items done, confirmed onset pairs, confirmed matched noteheads, and a
headline HUMAN-CONFIRMED MATCHED NOTEHEAD N with N>=25 / >=50 / >=100 shown as volume
milestones only, never as PASS. At N >= 50 the tool prints "Enough for the first
clean-gate evaluation" and export is available at any point, so the review can stop
early.

## H0/H7 ceiling
Maximum potential matched noteheads from the entire 20-item population: **137**.
N >= 50 is reachable. Roughly 20 onset-pair decisions and 20 presence decisions are
needed, i.e. a few seconds per onset.

## H9 — autosave / export
Autosaves to localStorage on every decision and survives reload (QC reloads a saved
blob and re-renders). One EXPORT REVIEW JSON button writes
`human_review_answers.json` containing the population hash, per-item X presence
decisions, P->X mappings with rank status and notehead-level rank pairs, false-P
decisions and unlisted onsets. No pitch field.

## H10 — blinding
The HTML embeds no residual, delta_space, r_corpus, r_render, d0, true_d, MIDI, decoder,
mismatch, category, reviewer confidence, reviewer answer, staff y or score field. It
never shows an individual reviewer answer or a vote tally. The audit copy of the
excluded-field list is kept in `population.json` on disk and deliberately NOT embedded
in the HTML, because naming the forbidden fields inside the page would itself be the
leak being guarded against.

## H12 — QC: 61 checks, ALL PASS
`node qc_human_micro.cjs` drives the real review.html script under a DOM stub and
asserts: population equals exactly the 3/3-SAME set and nothing filtered; P ids and
order match the frozen manifest; X ids contiguous; X cardinality equals what was
rendered; every referenced image exists; source sheets byte-identical to the V3
packet; PDF sheets byte-identical to the frozen review sheets; click pairing; X
uniqueness; cardinality-mismatch ambiguity; false-P; no-counterpart; unlisted onset
add/remove; undo rewinds exactly one decision; autosave; reload; progress counts;
notehead totals equal the summed confirmed cards; N never exceeds the ceiling; export
contents and the absence of any scientific field in the export; marker geometry.

Four real app bugs were caught by QC and fixed:
- clicking an X never paired anything: `onMarker` tested `side==='x'` but `layout`
  passes `'src'`, so every source click silently became a P selection. Now decided by
  the marker id.
- `setP` stored a bare boolean `true` for "NOT A NOTE ONSET", discarding which decision
  was made. It now stores the decision label.
- the false-P label was `NOCOUNTERPART` while the human-facing wording is
  NO COUNTERPART; labels normalised to `NOTA` / `NO_COUNTERPART`.
- the review template was not part of the builder, so `review.html` was being written
  by hand and went stale. It is now `h_micro_template.html` and the builder always
  regenerates it.

Visual QC by inspection, not only tests: R001, R002, R004, R010, R039, R047, R066.
Markers verified to sit on the notation, including R010 where X1 lands on the
5-notehead chord (card 5) and X2 on the rest (card 0), and R001 where X1 is the rest.

## H13 — post-review processing, prepared but NOT run
`h_human_correspondence.py validate | freeze | gate`

Ordering is enforced by the filesystem, not by good intentions:
1. validate the answers against the frozen population hash and exact item membership
2. build the correspondence from CONFIRMED pairs only
3. freeze and hash it — after this, membership is immutable
4. join hidden scientific fields
5. clean gate: >98% |delta_space| < 0.25 AND >98% r_render = 0

Verified by a **synthetic, self-generated** input that was deleted immediately after:
`gate` refuses without a frozen manifest; a partial item list is refused; a second
`freeze` is refused; appending a pair after freezing is caught by the hash and voids
the result. Those synthetic numbers were fabricated by the test and are NOT a
scientific result.

## H14 — only if the clean gate later passes
+1/-1/mixed analysis, source agreement/mismatch certification, refusal of proven
source mismatches, non-circular Corpus 2.2 qualification, frozen zero-param baseline.
No RTX until that truth baseline exists.

## Status
The tool is built, QC-clean and committed. **No human review has happened. No residual,
delta_space, r_corpus, r_render, d0 or true_d field was read at any point in this
stage.**
