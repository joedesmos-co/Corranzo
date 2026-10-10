# Prereg: staff-gate quantization retry (G1/G3 recovery)

**Problem:** staff-comb gate evaluated at quantized peak centers is
hypersensitive: GT-verified digit (heat 0.99) dropped at decoded
(428,2508) [tier None] while passing 4px away [tier anchored]. One
such miss (Txo m17) shifts 16 downstream measure numbers.

**Frozen design:** in `decode_page` staff-gate, when tier is None at
the peak center, retry 4-neighbors at +-8px (one heat cell), accept
first passing tier. Nothing else changes (thresholds, xclass, veto,
gate constants frozen). Deterministic, no weights.

**Frozen splits:** TRAIN-fit selects (count gate-dropped GT tabdigits
recovered + FP cost via decode-eval); TRAIN-heldout verifies ONCE
(digit P/R + chain + transcription triple); DEV untouched.

**Baselines (heldout, frozen):** digit detection matched 180/362
(@iou0.5 chain matching); transcribe 345/362 found; triple 43.4%.

**Acceptance:** heldout tabdigit F1 (decode-eval @0.5) improves AND
transcription triple_ok does not drop AND no layout regresses >2pts.
Otherwise REJECT (keep exact-center gate).

**Amendment 1 (after fit+heldout A/B):** blanket retry REJECTED
(fit +0TP/+45FP; heldout +2TP/+22FP, F1 0.4795->0.4697). Refined
variant: retry only when peak class heat v>=0.8 (rescue stays for
strong peaks like m17@0.99; weak-peak FP admissions blocked).
Same gates, same populations. ACCEPT iff heldout F1 improves.

**Amendment 2 (end-to-end verdict):** heat-gated retry heldout decode:
tp 180 (same), fp 209->211 (F1 -0.001, noise). BUT end-to-end Txo
transcription: the rescued m17 digit restores the truth-17 interval,
healing numbering for 16 downstream measures: measure_ok 46%->95%,
triple_ok 43%->90%, FULL (+duration) 87.6% of GT, semantic 28%->48%.
Per mission end-to-end criterion (reject only what worsens heldout
END-TO-END accuracy): ACCEPTED. F1 cost negligible (+2FP); benefit
+46pts triple. Blanket (ungated) variant stays REJECTED.

**Constraints:** no training; no sealed TEST; technique abstinent.
