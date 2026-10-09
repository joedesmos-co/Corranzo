# Multi-Layout Rescue Preregistration (frozen before runs)

From `da1df11d4d`. Sealed TEST untouched. Fret CNN frozen. Splits/tiers
frozen. ONE capped detector run max. No simultaneous heavy training:
Piano idle verified (no training processes, 2026-10-10). Technique
abstinent. DO NOT MERGE.

## G1 audit (TRAIN large vs standard, v3 weights, no training)

Separate on TRAIN: (a) object-channel drift (TP peak values, recall at
fixed thresholds, no-veto decode); (b) veto over-fire (vetoed count, TP
cost); (c) box transfer (IoU-at-center with canonical medians);
(d) digit/glyph px sizes per layout; (e) translation jitter (shifted
control per layout); (f) text/bg split. Verdict names the dominant cause
with counts. A larger model is NOT assumed.

## G2 split verification + ONE capped run

Verify: every score's renderings (standard/compact/large/bravura) share
one partition (score-grouped; alternate layouts never cross TRAIN/DEV).
Capped run (only if G1 shows a trainable signal): TinyFCN-4ch warm start
from v3, SAME depth/width, fixed seed, <=12 epochs, Adam 3e-3, TRAIN
pages standard+compact+large (score-grouped; bravura stays a held
layout probe — 65 scores only, real-data gaps documented). Positives:
GT Gaussians. Negatives: v3 bg-FPs mined on TRAIN incl. large
(same >25px/IoU<0.1 rule, 40/page cap). Decode frozen (v3 veto). No
architecture sweep. MPS only; abort if Piano starts heavy training.

## G3 evaluation + per-layout preservation

DEV once per layout (standard/compact/large/bravura): P/R/FP/FN, box
localization (IoU-at-center), chain string/fret/pitch + controls.
Compare v4 vs v3 vs v2 per layout. PRESERVE the better existing detector
per layout: frozen layout->weights map (layout identified from image
dimensions — image evidence, no truth). No DEV-driven tuning beyond the
frozen per-layout selection.

## G4 rhythm: exact event-link supervision + boundary objects

Build the joins<->canonical event link WITHOUT new manual labels:
order-based alignment (joins x-order vs canonical onset order within
single-voice groups) with unmatched-adjustment from pages.unmatched*,
VALIDATED by pitch agreement (fret CNN + string vs canonical pitch;
agreement rate = link exactness measure). Image inference never touches
truth. Then: barline/measure-boundary detector (full-height verticals at
regular intervals — previously FP source, now signal) validated vs
canonical measure counts; tuplet-numeral census (count + digit-channel
response; recognition only if separable). Relationship quality: stem
P/R, beam-pair agreement, dot agreement, link agreement rate.

## G5 playable events: oracle vs detected + coverage

Oracle chain (GT digit boxes -> fret/string/pitch) separates head errors
from detection errors. Coverage chain: every GT digit counts (decoded
fraction + correct fraction over ALL GT — abstention counts as miss).
Report precision AND coverage per layout. No error hiding.

## G8 gates

Guitar vitest files green. Commit + push. Fret accuracy >=0.92 on
matched (else revert). V1 blockers updated honestly.
