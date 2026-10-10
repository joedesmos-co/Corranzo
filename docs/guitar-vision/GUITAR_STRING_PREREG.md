# String Recognition Bottleneck Preregistration (frozen before runs)

From `3f70dab3de`. Sealed TEST untouched. Fret CNN frozen. Splits frozen
(fit=32 / heldout=15, lists in GUITAR_BOTTLENECK_PREREG.md). Technique
abstinent. DO NOT MERGE. Machine idle at start; sequential bounded jobs.

## FIRST: string autopsy (TRAIN-fit GT boxes + heldout)

Confusion matrix truth->pred per string; confidence by string;
staff-geometry features per error (system index on page, y-in-system,
multi-system flag, crop contamination estimate); pairing status
(x-column note+digit or digit-only); box IoU (GT boxes here, so box
errors excluded by construction — detector-box dependence measured
separately via matched-vs-oracle gap). Separates: wrong predictions vs
abstention (tau grid) vs geometry vs pairing.

## StringNet refresh decision (TRAIN evidence only)

Justification bar: errors concentrate in a LEARNABLE pattern (e.g.
specific string confusions with separable geometry, or systematic
underconfidence with correct argmax) rather than irreducible ambiguity
(blurred glyphs, overlapping systems). If justified: ONE capped run —
fine-tune StringNet from current weights on TRAIN-fit GT-box tall crops
only (no detector changes, no new labels), <=10 epochs, Adam 1e-4 (lower
than detector LR), fixed seed, current model preserved as fallback
(stringnet.pt untouched; new weights stringnet-sr.pt). Selection on fit,
verification on heldout, DEV once. If not justified: report why and skip.

## SECOND: large digits + resampling (heldout, inference-only)

Veto-off vs veto-on byClass on heldout-large (existing flags); resampling
verdict from heldout byClass (bilinear vs nearest for the NOTE pass;
digits bypass via native pass). No repeat of layout-inclusive training.
Per-layout map preserved on any regression.

## THIRD: transcription impact

Chains (detected+oracle) per layout with the frozen string path,
semantic MusicXML on the 2 fit etudes + 1 heldout etude (tuplet-figures
has source .musicxml; verify), coverage + precision, pairing accuracy
via x-column agreement on detected (not just GT) boxes.

## FOURTH: beam-tip (only if strings improve)

If string/coverage improves: extend tip search along beam direction +
measure beam-count agreement gain on TRAIN-fit; freeze if better, else
keep. No GNN.

## Gates

String accuracy + coverage, fret accuracy, detector P/R, playable-pitch
coverage, pairing, MusicXML semantic, rhythm (unchanged code path unless
beam work lands). Tests green. Commit + push.
