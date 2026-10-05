# Stage H3b — V3 AI_BLIND_CONSENSUS: N = 0 noteheads. AI PACKET ROUTE CLOSED.

**AI_BLIND_CONSENSUS_V3. NOT human ground truth. NOT manually certified.**
No residual, pitch, or decoder field was read. Corpus 2.1 unmodified. No RTX, no training.

## Reviewer validation
| Reviewer | items | unique | sha256 (first 20) |
|---|---|---|---|
| V3_REVIEWER_1 | 80 | 80 | f540908083bb0278c485d |
| V3_REVIEWER_2 | 80 | 80 | 22dfdd631a6d7d71394e6f |
| V3_REVIEWER_3 | 80 | 80 | a0267fb02db70ee071aa |

A: SAME 41/24/32, DIFFERENT 13/15/18, UNSURE 26/41/30.
E: HIGH 2/2/3, MEDIUM 31/33/38, LOW 47/45/39. No LOW-dominance check triggered.

## P14 reviewer agreement (reported BEFORE any science)
| Metric | V1 | V2 | V3 |
|---|---|---|---|
| unanimous SAME_STRUCTURE | 0.0000 | 0.2750 | **0.2500** (20/80) |
| pairwise A-exact (min) | 0.0375 | 0.3125 | **0.0750** |
| pairwise A-exact (max) | 0.1875 | 0.3500 | **0.2375** |
| unanimous onset-PRESENT | 0.0000 | 0.1422 | **0.3112** (136/437) |
| unanimous exact P->X | 0.0000 | 0.0138 | 0.0092 (4/435) |
| unanimous rank-pairing | n/a | 0/1 | 0/3 |
| >=2/3 HIGH no LOW | n/a | 0.0125 | 0.0375 (3/80) |

## P15 consensus — rules UNCHANGED, nothing relaxed
3/3 SAME_STRUCTURE + 3/3 identical onset presence + 3/3 exact P->X + 3/3 RANK_OK +
>=2/3 HIGH and no LOW.

**accepted = 1, unresolved = 79, consensus onsets = 2, consensus noteheads = 0.**

Gate ladder, showing exactly where each item dies:
- 3/3 SAME_STRUCTURE: 20
- of those, blocked ONLY by the confidence rule: 19
- of those, passing the confidence rule: **1**

Of the 20 unanimous-SAME items, 11 were MEDIUM/MEDIUM/MEDIUM and 9 contained a LOW.
Second-pass review was requested on only 2 items in total.

## P16 frozen manifest (structural only)
sha256 ffd7783e9d3d9c8517b1f56117a0a893d957e0d89a5f948ed63eb75dad0d2d21
Verified reproducible. Contains no residual/pitch field; a `d0` grep hit was traced to
hex hash substring `f540908083bb0278...` and is not a field.

## PRE-REGISTERED STOP RULE TRIGGERED
Consensus matched-notehead N = 0, which is < 50. Therefore:
- **STOP the AI packet iteration route.**
- **DO NOT propose V4.**
- **DO NOT inspect residuals.** The clean gate was NOT evaluated, because evaluating it
  requires a residual join that this stop rule forbids.
- Genuine human / source-assisted adjudication is now required.

## Why the fix did not work
V3's duration-correct notehead fill was the right fix and it did raise onset-presence
agreement from 0.1422 to 0.3112. But pairwise structural agreement FELL from 0.3125-0.3500
to 0.0750-0.2375, and notehead N stayed at 0.

The binding constraint is no longer rendering. It is that ~50% of reviewer verdicts are
LOW on every reviewer, and requiring 3/3 exact agreement on which unreliable `P` proposal
maps to which onset survives in 4 of 435 onsets. Those two gates multiply to zero.
No further packet iteration can fix a zero-confidence verdict; that is the definition of
the route's ceiling.

## What would be needed instead
Not another renderer. One of:
1. Human adjudication on the frozen 80 items (annotation capacity, not AI agreement).
2. A source-assisted pass where the original staff is consulted for onset order only.
3. An explicit authorization to treat MEDIUM x3 as sufficient, which would be a rule
   relaxation and was NOT granted here.
