# Prereg: sub-cell peak refinement (Step 5 peak separation)

**Problem:** heat argmax quantizes box centers to 8px cells; true peak
often sits up to a cell off GT center (measured ~8px offsets). At
iou>=0.5 with ~18px boxes this flips matches to misses, and offset
boxes degrade head crops + onset columns (beam attribution needs
clean onset units).

**Frozen design:** in `decode_page`, replace cell-center
`((x+0.5)*8)` with heat-weighted 3x3 centroid around the argmax
(weights = max(0, heat)), offset clamped to +-0.5 cell (+-4px).
Thresholds, xclass, gate (incl. v0.7 retry), veto, medians, upscale
all frozen. Deterministic, no weights.

**Frozen splits:** TRAIN-fit selects (digit core P/R @0.5 +
note/rest core); TRAIN-heldout verifies ONCE (same + transcription
triple on Txo); DEV once at end iff accepted.

**Baselines (frozen):** fit tabdigit tp=254/fp=452 (P 0.360/R 0.464);
heldout tp=181/fp=211 (P 0.462/R 0.500); Txo triple 95.9% (348).

**Acceptance:** heldout digit F1 improves AND transcription triple
does not drop AND no class regresses >2pts core F1. Else REJECT.

**Follow-on only if accepted:** shoulder splitting (second peaks on
cell shoulders), then pair-bridge re-evaluation on clean units.

**Constraints:** no training; no sealed TEST; technique abstinent.

**Verdict: REJECTED.** Heat is unbounded ReLU output (peak 1.08, not
probability); a heat-weighted 3x3 centroid drags the peak toward
high-value neighbors (~0.5-cell bias) and HALVES tabdigit recall
(fit 0.464->0.276, heldout 0.500->0.249). Argmax-cell centers stay.
Next variant (only if pursued): 1-D parabolic vertex on the peak axis,
or argmax restricted to the peak's own row/column — never neighbors.

**Amendment (variant B accepted):** centroid variant REJECTED (heat
is unbounded ReLU; neighbors drag peaks ~0.5 cell; tabdigit R
0.464->0.276). Measured offsets are systematic (+4.0/+3.1px median
= half-cell anchor bias, not scatter): anchoring at cell CORNER
(x*8) removes it. Results: fit tabdigit P 0.360->0.687, R 0.464->
0.900; heldout P 0.462->0.855, R 0.500->0.945; core P/R 0.912/0.930.
End-to-end: Txo triple 95.9%->96.1% and FULL 92.0%->93.4%; Qmek
triple 87.5%->94.8%; compact triple 90.2%->90.3%. ACCEPTED.

**Follow-on (same session):** pair-bridge rhythm re-enabled on clean
units. Two bugs fixed to match the audit bit-for-bit (prev only
updated on bridge rows; zone = [system-mindy-140, -40] with mindy
from full system rows). Txo durations 334->339 (93.4%). Qmek stuck
(~10%): its beamed onsets are ISOLATED single groups (no adjacent
group to bridge to) - needs stem-tip beam counting, documented next.
