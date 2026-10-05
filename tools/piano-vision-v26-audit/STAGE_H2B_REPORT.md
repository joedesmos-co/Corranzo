# Stage H2b — AI_BLIND_CONSENSUS_V2 result

**NOT human ground truth. NOT manually certified.** No residual, pitch or decoder
field was read at any point in this stage. Corpus 2.1 unmodified. No RTX, no training.

## Reviewer validation

| Reviewer | items | sha256 |
|---|---|---|
| V2_REVIEWER_1 | 80 | `6070933517501db8478b7123340c9528eebb99ca98e31c8a115459713cba4324` |
| V2_REVIEWER_2 | 80 | `ca56933d047849f2943a6e1aa91dfccca974cdc1213c0fbd12a5379320de95df` |
| V2_REVIEWER_3 | 80 | `6d59bd075fa1d3796d5718259e33c8019b92ef914ad25bca12497dcf49c906e9` |

All three complete, 80 items each, three distinct artifacts. Per-batch temporary
artifacts were written as the corrected prompt required, and the final merged files
were written once.

## P14 agreement (reported BEFORE any scientific access)

| Metric | V1 | **V2** |
|---|---|---|
| unanimous measure agreement | 0 / 80 = 0.0000 | **22 / 80 = 0.2750** |
| pairwise A exact (min) | 0.0375 | **0.3125** |
| pairwise A exact (max) | 0.1875 | **0.3500** |
| unanimous onset-PRESENT | 0.0000 | 62 / 436 = 0.1422 |
| unanimous exact P→X | 0.0000 | 6 / 436 = 0.0138 |
| ≥2/3 HIGH and no LOW | — | 1 / 80 = 0.0125 |
| unanimous rank-pairing | 0.0000 | 0 / 1 = 0.0000 |

SAME_STRUCTURE counts per reviewer: **27 / 37 / 39** (V1 was **0 / 14 / 1**).

**The packet fix worked.** Agreement on measure structure rose from 0.0000 to 0.2750
and pairwise agreement roughly doubled to tripled. Reviewer 1, which returned SAME for
*zero* items in V1, now returns 27. A-vote patterns are structured rather than noisy:
22 unanimous SAME, 21 unanimous UNSURE, 5 unanimous DIFFERENT_MEASURE.

## P15 consensus

Accepted **1** item (R010), unresolved **79**, consensus onsets **2**,
consensus matched noteheads **0**.

## P16 freeze

`ai_blind_consensus_v2_manifest.json` sha256
`8ecca07264959bd6277c8cb98435f9a62e6531ecf236cb595dee0776daa9714f`, frozen BEFORE any
residual join.

## Clean gate: NOT EVALUATED

Consensus matched-notehead N = **0**, so there is nothing to join. N=0 is never PASS or
FAIL. **No scientific join was performed.** Corpus 2.2 not built. Zero-parameter
baseline not run.

## Diagnosis: the bottleneck moved from representation to confidence

Of the **22** items with unanimous `SAME_STRUCTURE`, **21 are blocked solely by the
confidence rule** and only 1 also passed it. On those 22 items the confidence pattern
is `MEDIUM/MEDIUM/MEDIUM` for 14 of them, with `HIGH` appearing only **once per
reviewer across all 80 items**.

Only 2 items (R010, R037) received any second-pass rank attempt, and the two attempts
were not unanimous, so rank agreement is 0/1.

So the conservative rule is doing exactly what it should — refusing to promote
unanimous structure that nobody is confident about — but the packet still withholds
something reviewers need.

### Most likely concrete cause: notehead fill is not rendered

`render_skeleton` draws **every** notehead as a filled ellipse regardless of duration.
Open noteheads are rhythmic notation: a half or whole note is hollow, a quarter is
filled. With fill discarded, a whole note, a half note and a quarter note are nearly
indistinguishable in the skeleton apart from stem and flag. That removes a primary
rhythmic cue from the very panel whose job is rhythmic comparison, and is the most
plausible reason reviewers read the structure correctly (27.5% unanimous) yet decline
to call it HIGH.

Secondary gaps, in likely order of impact: slurs and ties are absent; the neutral clef
placeholder carries no reference; ledger lines are absent; tuplet numerals are
hardcoded to "3".

## Next step

A **V3 packet** that renders notehead fill by duration (hollow for half/whole, filled
for quarter and shorter), adds ledger lines, slurs/ties where pitch-safe, and real
tuplet numerals. The measure-identity question is now demonstrably answerable from the
skeleton, so the remaining gap is rendering fidelity rather than correspondence
feasibility.

Consensus was NOT forced, no membership was altered, no label was created, and no
residual was read.
