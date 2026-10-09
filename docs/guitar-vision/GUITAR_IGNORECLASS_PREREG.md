# Ignore-Class Experiment Preregistration Amendment (frozen before running)

**Deviations from GUITAR_OVERNIGHT_PREREG.md Section C, with rationale:**

1. **Justification (measured, Phase B):** clef/key/time-sig alone do NOT
   clear the 30% bar (zonal FPs ~20% of all FPs, less pure-bg). BUT the
   dominant residual FP mass is real notation ink (median ink 0.50,
   8-10px from GT: note-part doubles, accidentals, dots, flags) PLUS
   clef/time-sig/text. The trainable signal is therefore the FULL
   self-mined bg-FP distribution, not clefs alone. Proceeding on that
   basis: FPs are 65% of predictions; the signal needs no new labels.

2. **Negatives:** v2-decoder bg-FPs on TRAIN standard+compact pages only
   (>25px Manhattan from any same-class GT center AND IoU<0.1 with every
   GT box — pure confusers, never near-misses; halo/double peaks near GT
   are EXCLUDED so the ignore target cannot suppress true localization).
   Capped at 40 negatives/page.

3. **Warm start** (prereg was silent): backbone + 3 output rows copied
   from frozen `heatmap16ep.pt`; ignore row small-random. Bounded
   adaptation, not a new model. Same depth/width, fixed seed.

4. **Veto rule:** suppress a note/rest peak if per-page-max-normalized
   ignore heat exceeds the normalized class heat within 12px.
   Tabdigit-veto included as a TRAIN ablation (time-sig digits);
   selected on TRAIN, frozen after.

**Frozen design:** TinyFCN-4ch, Gaussian targets (sigma 6 cells, same),
foreground-weighted MSE over 4 channels, object-centered + ignore-
centered + context patches (deterministic plan, same structure),
<=12 epochs, Adam 3e-3, TRAIN standard+compact pages (score-grouped),
DEV untouched until freeze. Layouts: large stays an unseen probe
(prereg kept despite the diagnosed unseen-layout gap — no post-freeze
scope expansion).

**Success bar (unchanged):** DEV FP-bg -25% with recall neutral-or-better
vs v2, all layouts + chain. Else revert to v2 (weights not committed).
Fret CNN untouched. Sealed sets untouched.
