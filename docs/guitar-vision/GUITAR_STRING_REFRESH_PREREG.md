# StringNet Refresh Amendment (frozen before running)

**Autopsy verdict (TRAIN-fit + heldout GT boxes, corrected counters):**
strings 1 perfect both splits (45/45, 28/28); string 6 memorized
(41/41 fit -> 0/10 heldout); middles collapse (s4: 20% fit -> 4%
heldout; s5: 45% -> 10%; s2/s3 cross-fire). Tier/yfrac splits are
confounded by page difficulty (exact-tier pages are dense) or
homogeneous (all multi-system paired) — no geometric silver bullet, but
the identity-concentrated pattern + absolute-vertical-bin architecture
(position memorization, not line-relative reading) is a LEARNABLE
mechanism. Refresh JUSTIFIED.

**Frozen design:** fine-tune StringNet from stringnet.pt (fallback kept)
on TRAIN-fit GT tall crops rendered live in chain geometry
(64x256 box-relative). Vertical window jitter U(-30,+30)px per sample
per epoch (position invariance) + class-balanced resampling to majority
(158/class/epoch). NO label smoothing (keeps logit scale comparable;
T=0.7 stays valid). Adam 1e-4, batch 64, FIXED 8 epochs (mirror original;
no epoch selection -> no heldout contamination), fixed seed. Standard
layout fit only (bounded; layout extension is follow-up). Output
stringnet-sr.pt + per-epoch fit/heldout string accuracy (GT boxes, no
jitter) for the record.

**Adoption bar:** heldout string accuracy (GT boxes) strictly improves
vs baseline with fit accuracy neutral-or-better; else keep fallback.
DEV chains run once with the adopted weights. No detector/head changes
otherwise. No comprehensive training.
