# Stage H2 — Packet V2: pitch-scrubbed, rhythm-rich source panel

**AI_BLIND_CONSENSUS_V2. NOT human ground truth. NOT manually certified.**
No residual was read. Corpus 2.1 unmodified. No RTX, no training.

## Diagnosis acted on

V1's right panel was an abstract "staff lines + notehead positions" drawing and
reviewers collapsed to pairwise agreement 0.0375–0.1875, with reviewer_1 returning SAME
for **zero** of 80 items. The representation was the blocker.

V2 replaces it with a real rhythmic engraving with every pitch canonicalised away.

## 1. Exact V2 source-render design

For each mapped measure, onsets are placed at **cumulative-duration fractions taken
from the MusicXML**, normalised to the panel. Duration-weighted rather than
Verovio-pixel x, deliberately: it removes the fragile XML↔SVG zip that caused earlier
bugs, and it makes rhythm directly readable.

Drawn: 5 staff lines, measure barline (thicker final bar on the last measure),
neutral clef placeholder, time signature where the meter changes, noteheads at
canonical slots, stems (direction from canonical slot only), beam groups respecting
MusicXML `begin`/`end`, second beam for 16ths, flags for unbeamed flagged notes,
schematic rests, augmentation dots, tuplet brackets, and final/double bar structure.

## 2. Proof pitch was canonicalised

`canonical_positions(k)` returns `range(-(k-1), k, 2)`:

| cardinality k | neutral slots |
|---|---|
| 1 | `[0]` |
| 2 | `[-1, +1]` |
| 3 | `[-2, 0, +2]` |
| 4 | `[-3, -1, +1, +3]` |

Verified equal to spec by test. A notehead's y depends **only** on its onset's
cardinality and its order in the synthetic stack — never on written pitch, staff
position, MIDI, `d0`, `true_d`, corpus labels or PDF geometry. Source accidentals and
note names are never drawn, and no key-signature accidentals are drawn because they
are pitch evidence (P5). Time signature **is** drawn: meter is structural.

## 3. Fields preserved
measure boundaries · onset horizontal order · rhythmic duration · stems · beam
grouping · flags · rests · dots · tuplets · chord cardinality · grace-note width ·
repeat/final/double bar · time-signature changes · neutral clef

## 4. Fields removed
source written pitch · staff position · key-signature accidentals · note names ·
MIDI · any pitch-derived vertical contour

## 5. Question A wording (P7)
`A = SAME_STRUCTURE | DIFFERENT_MEASURE | UNSURE` — explicitly *"does the
rhythmic/onset structure on the right plausibly correspond to this PDF measure and
staff?"*, with the rubric stating that a single extra or missing note does **not**
make A `DIFFERENT_MEASURE`, because that is what B and C are for. This directly
targets the V1 semantic confusion where reviewers used A to answer B.

## 6. Instructional examples (P8)
Five synthetic cases in `out/h_review_ai_v2/examples/`, none from the 80 items:
same-measure-with-one-source-extra · completely-different-rhythm ·
same-rhythm-uncertain-dense-chord · false-P-marker-on-rest · missing-P-proposal.

## 7. Visual QC (P9)
**Two real bugs were found by looking, not by tests:**
1. Scaling the PDF crop by **width** alone made narrow measures explode vertically —
   one sheet came out 687 px tall. Now scaled so every staff renders the same
   physical height, then width-fitted and padded. Sheet heights are now uniform
   (156–198 px).
2. Beam grouping ignored `begin`/`end`, merging separate beamed groups into one
   continuous bar. R002 now renders 6 distinct double-beamed groups, matching the 6
   groups visible in the PDF panel.

Systematic QC over **all 80** sheets: 0 problems, no blank source panel, 36 items
contain chords, maximum cardinality 5, all sheets legible.

## 8. Blinding QC (P10)
`rubric_v2.md`, `schema_v2.json`, `items_neutral.json` scanned for `residual`,
`delta_space`, `r_corpus`, `r_render`, `true_d`, `midi`, `written_pitch`, `decoder`,
`mismatch`, `category`, and V1 reviewer names — **no leaks**. No V1 reviewer answers
appear anywhere in the V2 packet.

## 9. V2 packet hash
`3088efb89719e9e5861260da58e1e1b7ddc0c5e87d5b046c18a94fb17d3ec499`

It covers every input PNG byte, the rubric and the schema — not just metadata. The V1
hash was metadata-only, which was a real auditability flaw.

## 10. Could fresh reviewer sessions be launched automatically?
**No.** `subagent_depth = 0` in the global `~/.config/opencode/opencode.jsonc`, and
this context is additionally contaminated because it built the packet. Three exact
prompts are written to `out/h_review_ai_v2/prompt_{1,2,3}.txt`, each covering 4 batches
of 20 items, with strict file restrictions. Batches are in
`out/h_review_ai_v2/batches/batch{1..4}.json`.

## P0 population
Exactly **R001–R080**, same order, same measures, same mapping, no items added or
removed. Two items (R005, R026) were initially dropped because they are `lower` staff
of **single-part** scores, where both staves come from part 0; that was a bug and is
fixed. V1 artifacts are untouched on disk.

## 13–16. Agreement / consensus / gate
Not available — no V2 reviewer has run. `h2_review.py consensus` correctly refuses.
V1 consensus remains N=0 historical evidence and is never mixed with V2.
