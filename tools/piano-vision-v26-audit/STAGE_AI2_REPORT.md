# Stage AI part 2 — AI_BLIND_CONSENSUS result: ZERO accepted correspondences

**NOT human ground truth. NOT manually certified.** No corpus was modified.

## Validation (first)

All three independent reviewer files present, 80 items each, 80 unique ids, no
duplicates, no unknown ids, P/X references valid, rank pairings internally valid.

| Reviewer | items | container | sha256 |
|---|---|---|---|
| reviewer_1 | 80 | object | `8a6f130f306e27b10ab9202977516a495e615d68e8b0d3ff4769be5f2ded65d1` |
| reviewer_2 | 80 | bare list | `69228a4c0c70b49bb0c5b2de972f2c2b2fce3e68cdac7be3a8f6e9aa9227b7c9` |
| reviewer_3 | 80 | bare list | `ac067b6804c4ac2b81be72ee69c5188f3bfed51c429d3bb15a392ee728094042` |

Container shape differed (one object, two bare lists). Normalised and **reported**
rather than rejecting the campaign over a packaging difference.

## Agreement (A7, computed before any scientific join)

| Metric | Value |
|---|---|
| unanimous SAME-measure rate | **0 / 80 = 0.0000** |
| unanimous onset-PRESENT rate | **0 / 341 = 0.0000** |
| unanimous exact P→X mapping rate | **0 / 435 = 0.0000** |
| unanimous cardinality rate | 28 / 80 = 0.3500 |
| ≥2/3 HIGH and no LOW | 11 / 80 = 0.1375 |
| unanimous rank-pairing rate | 0 / 31 = 0.0000 |
| pairwise exact agreement r1\|r2 | 0.1000 |
| pairwise exact agreement r1\|r3 | 0.1875 |
| pairwise exact agreement r2\|r3 | 0.0375 |

Answer distributions: reviewer_1 returned **SAME for zero items** (NO 46, UNSURE 34);
reviewer_2 SAME 14; reviewer_3 SAME 1. Only reviewer_2 submitted second-pass rank
verdicts (31 across all three), so rank unanimity is structurally impossible.

## Consensus

Accepted items **0**. Unresolved **80**. Matched onsets **0**. Matched noteheads **0**.

## Freeze then join

Frozen consensus manifest sha256
`95aaeae41673ab62bf8cef32adadb56870ff3fed9d96965e42cb1e1fa9922495`, written **before**
any residual access. `h_ai_join.py` re-verifies that hash and aborts if altered.

Clean-control gate: **NOT EVALUATED** — there is no frozen correspondence to join.
N=0 is never PASS or FAIL. Corpus 2.2 not built. Zero-parameter baseline not run.

## Disputes

`out/h_review_ai/disputes_only.html` — 20 highest-value unresolved items with all three
reviewers side by side and a human arbitration column. Ranked by a structural score only
(SAME votes, ≥2/3 HIGH with no LOW, count of 2-of-3 onset and mapping agreements).
Top item **R038** is the single case where two reviewers said SAME
(`UNSURE / SAME / SAME`). Blind: no scientific outcome field is present.
