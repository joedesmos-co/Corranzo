# Stage H — blinded human review packet (READY TO REVIEW)

Nothing mutated. Corpus 2.1 immutable, no labels added, no Corpus 2.2, no answer
populated, no pitch inferred from geometry or decoder, no RTX, no training.

This stage **builds a packet and stops**. No human judgement was performed and none
was simulated.

## Packet

| | |
|---|---|
| review items (one mapped measure × one staff) | **80** |
| onset groups labelled (P + X) | **776** |
| PDF onset proposals (P) | 435 |
| source onset groups (X) | 341 |
| potential paired noteheads | **341** |
| distinct scores | **15** |
| mapping classes | 42 `EXACT_ANCHORED`, 38 `HIGH_CONFIDENCE_COUNT_ANCHORED` |
| staff split | 41 upper, 39 lower |
| Category A covered | **62 / 62 (100%)** |
| Category B covered | **365 / 365 (100%)** |

Selection follows H2 priority: Category A / Tier-1 first, then `EXACT_ANCHORED`,
then other high-confidence, then Category B onset-uncertainty, round-robined across
scores for structural diversity. **No selection read `d0`, `true_d`, residual sign,
decoder output or PDF/source pitch agreement** — the only quantities consulted were
mapping class and the structural coverage audit.

Each item shows **LEFT**: the original PDF raster crop for that measure, with machine
proposals `P1..Pn`. **RIGHT**: the same measure from the Verovio layout as staff lines
and notehead positions only, with `X1..Xn`. No note names, MIDI, `d0`, `true_d`,
residual or expected answer appears anywhere.

## H6 notehead second pass

Implemented in the HTML tool: when a reviewer sets confidence `HIGH`, matched onset
pairs unlock a vertical-rank verdict (`RANK_OK`, i.e. top↔top / second↔second, or
`AMBIGUOUS`), with noteheads lettered `P1a, P1b…` against `X1a, X1b…`.

## Bugs found and fixed during QC

Worth recording, because each one silently corrupted the packet:

1. **Staff-line row indices were absolute instead of band-relative.** Line suppression
   ran on the wrong rows, so noteheads stayed welded to the staff lines. This left
   **14** PDF proposals against 341 source noteheads — the PDF side was useless.
2. **Onset clustering chained transitively** (each candidate compared to the previous
   member), collapsing dense runs into a single onset group.
3. **The source panel mixed PDF raster pixels with SVG units** when computing its x
   range, throwing every `X` marker into the wrong place.
4. **Coverage totals double-counted** because all roles' missing/ambiguous counts were
   summed once per role-item, inflating Category A to 122 and Category B to 716.
5. `numpy.resize` was called instead of `PIL.resize` on a raster crop.

The first three were only caught by **looking at the rendered sheets**; the fourth by
an arithmetic inconsistency against the frozen Stage L totals.

## H9 blinding

The blind manifest and HTML contain only structural fields. Verified programmatically:
no occurrence of `residual`, `d0`, `true_d`, `midi`, `decoder`, `mismatch`,
`correct`, `answer` or `sign`. Source geometry and per-onset x positions are written
separately to `h_review_lookup_INTERNAL.json`, which is **not** part of the packet.

## H10 QC

Programmatic over **all 80 items** (not a 20-item sample): required fields present,
sheet exists and is large enough to read, `P`/`X` identifiers sequential and unique,
blinding clean. **QC: PASS, 0 problems, 0 leaks.** Additionally three sheets were
inspected visually (bach-fugue upper, chopin-etude-op10-01 upper, dense-advanced
lower) and are correct and legible.

## H11 projection (planning only — no judgement made)

| Share of review items resolving to HIGH-confidence structural matches | Clean-gate N |
|---|---|
| 50% | **170** |
| 75% | **256** |
| 100% | **341** |

All three exceed the current N=20 and the N~100 target; 75% and 100% clear N~250.
Even the 50% case is ~2.5× the current toy sample.

Estimated human decisions: **80** A + **341** B selects + **435** C selects + **80** D
+ **80** E ≈ **1016**, plus the notehead second pass on HIGH-confidence items only.
Items are priority-ordered, so a reviewer may stop early once ~100–200 noteheads are
adjudicated.

## Artifacts

- `out/h_review_manifest.json` — blind reviewer manifest (80 items)
- `out/h_review_lookup_INTERNAL.json` — internal only, not part of the packet
- `out/h_review/sheets/*.png` — 80 side-by-side contact sheets
- `out/h_review/README.md` — reviewer instructions and caveats
- `out/h_review/review.html` — local review tool, no server, no dependency, autosaves
- `out/h_review/h_qc.json`, `out/h_review/h_projection.json`

## Next step after review

1. Load `review_answers.json`, keep only items judged structurally corresponding.
2. Build a **correspondence manifest** (measure identity, onset x/order, cardinality,
   vertical rank) and **freeze + hash it** — still with no pitch inspected.
3. Only then join corpus residuals and evaluate the clean control gate.
4. Refuse proven source mismatches; never relabel.
