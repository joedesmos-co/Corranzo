# Stage H3 — V3 high-fidelity pitch-blind skeleton: packet built, awaiting reviewers

**AI_BLIND_CONSENSUS_V3. NOT human ground truth. NOT manually certified.**
No residual, pitch or decoder field was read. Corpus 2.1 unmodified. No RTX, no training.
V1 and V2 remain historical artifacts only and are never mixed with V3.

Consensus and confidence rules are **unchanged**. This was a rendering-fidelity
correction only.

## V0 — population frozen
Exactly R001–R080, same order, same PDF crops, same measure mappings, same Category A/B
coverage. No item added or removed, and no selection used a V1/V2 reviewer outcome.

## 1. Exact V3 rendering changes

| Element | V2 | V3 |
|---|---|---|
| notehead fill | **always filled** | by duration: hollow whole/half, filled quarter and shorter |
| whole-note stem | drawn | **none** |
| tuplet numeral | hardcoded `3` | real `<actual-notes>` value; bracket only when unknown |
| ties / slurs | absent | schematic arcs between canonical slots |
| ledger context | absent | schematic lines from the **canonical** slot only |
| clef | neutral placeholder | unchanged, documented as intentionally uninformative |

## 2–3. Automated tests — 22 checks, PASS

`fill[type]` and `stem[type]` for whole/half/quarter/eighth/16th; hollow inks fewer
dark pixels than filled (2470 < 2656); half inks more than whole (2470 > 2418); filled
quarter inks more than hollow whole; separate beam groups stay separate; real tuplet
numerals recorded; missing numeral yields **no invented number**; a tie yields exactly
one arc; canonical stacking unchanged for k=1..4.

Two tests initially failed and both were **my test being wrong, not the renderer**: I
compared total ink, which is inverted because hollow noteheads contain more white. The
renderer's dark-pixel ordering was already correct (whole 2418 < half 2470 < quarter
2656). Fixed the metric rather than the renderer.

## 4. Ties / slurs
Implemented as schematic dotted arcs connecting canonical notehead slots, so the curve
shows continuation and never original pitch height. Tie/slur type preserved.

**Honest limitation:** the frozen 80 measures contain **no ties at all**
(0 arcs). Tie parsing is correct — mazurka yields 8 tie-starts in part 0 and 44 in part
1 — but those measures fall outside the frozen population, and P0 forbids adding items.
So V4-style tie improvements cannot help this packet.

## 5. Ledger-line policy
A ledger line is drawn only when a **canonical** slot falls outside the neutral
five-line staff. Real pitch-derived ledger positions are never restored, so ledger
placement cannot leak pitch.

## 6. Clef policy
One neutral placeholder retained for every score. It encodes no pitch reference and is
not varied per score, so it cannot become a tunable reviewer aid.

## 7–9. Preserved from V2
Time signature shown (structural, allowed); key signatures never shown; canonical chord
stacking `k=1 [0]`, `k=2 [-1,+1]`, `k=3 [-2,0,+2]`, `k=4 [-3,-1,+1,+3]`; grace-note
reduced size; augmentation dots; rest types; meter changes.

## 10. Instructional examples V3
Five synthetic cases, none from R001–R080: duration/fill · beamed 8ths and 16ths ·
tied notes · tuplet with numeral **6** (not a fabricated 3) · chord duration and
cardinality.

## 11. Visual QC — mandatory, performed by inspection
- `ex1_duration_fill.png`: filled quarter, **hollow half with stem**, **hollow whole
  with no stem**, filled eighth with flag. The mandatory correction is visibly correct.
- `R002.png` (dense 32nd-note Chopin): **6 separate double-beamed groups** matching the
  PDF, stems correct, no clipping, no blank panel, no accidental pitch leakage, P/X
  labels do not obscure notation.

## 12. Blinding QC
Reviewer-facing rubric, schema and item spec scanned for written pitch, MIDI, source
staff y, key-signature evidence, residual, delta_space, r_corpus, r_render, d0, true_d,
decoder, mismatch, Category labels and V1/V2 reviewer names — **no leaks**.

Prompt token hits for `residual`, `true_d`, `decoder`, `mismatch` occur **only inside
the ABSOLUTE RULES block**, where they are named in order to be forbidden. The audit now
proves that confinement rather than suppressing it.

## 13. V3 packet hash
`3dd6b4342ddc11c9486307e6f62c66c2fb1b4e9978ce6557ab98d69655a09d74`

Covers all 80 rendered images, the rubric, the schema and all instructional examples.

## 14. Prompts and preflight
Three corrected prompts in the already-fixed V2 structure (one continuous job, batches
1→4 sequentially, per-batch temp JSONs, one final JSON after exactly 80 unique items,
no overwrite, no early termination, blinding preserved, reviewers cannot see each other).

**PREFLIGHT: PASS on all three.**

This session cannot spawn isolated top-level contexts (`subagent_depth = 0`) and is
contaminated as the packet builder, so it does not review.

## V16 stop rule, pre-registered
After three fresh V3 reviewers: report agreement first, then frozen consensus. If
consensus matched-notehead N < 50, **stop the AI-packet iteration route** and do not
propose V4.
