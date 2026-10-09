# Overnight Continuation Report (from d14fcbb9e7)

**Preregs:** `GUITAR_OVERNIGHT_PREREG.md` + `GUITAR_IGNORECLASS_PREREG.md`
(amendment with documented deviations). Sealed TEST untouched. Fret CNN
untouched (weights identical; chain fret 0.92-1.00 throughout). Splits and
tiers frozen. No comprehensive training (ONE capped 12-epoch run only).
Technique output abstinent throughout (no technique heads trained).

## A. Rest-box scale (post-only, TRAIN-verified, frozen v2)

Audit's 1.54x was the UNMATCHED-subset median; full-population TRAIN grid
(matched + unmatched center-hits): x1.25 height optimal (REST P/R
0.396/0.397 -> 0.506/0.507, ALL F1 0.387 -> 0.395; x1.54 and x1.75 worse).
Width unbiased (1.0). Root cause confirmed by forensics: rest heights form
DISCRETE populations (~90 / ~280 / ~480 / ~560 canonical units =
whole-half vs quarter vs flagged). Frozen as decoder v2 (`BOX_SCALE`).
DEV (once per layout): standard rest P 0.289->0.341 / R 0.344->0.406;
overall standard core P 0.348->0.352 / R 0.399->0.404 (no regression
anywhere; compact 0.492/0.594, large 0.315/0.329, bravura 0.355/0.355).

## B. Remaining FP/FN forensics (TRAIN, v2)

- Canonical medians IDENTICAL across standard/large (note 226x192, rest
  199x312, digit 188x253) — large weakness is heat quality (unseen
  layout; TRAIN large R 0.35 vs standard 0.41), not box scale.
- Residual FPs: median ink 0.50 (real notation, not noise), 8-10px from GT
  (note-part doubles, accidentals, dots, flags) + ~20% in clef/title zones
  (clefs, keys, time-sigs, titles).
- Clef/key/time-sig alone miss the 30% ignore-CLASS bar (~20% zonal) ->
  amendment: target the FULL self-mined bg-FP distribution (4,053 note /
  600 rest / 329 tabdigit confusers mined from 216 TRAIN pages).

## C. ONE capped ignore run (warm-started TinyFCN-4ch, <=12 epochs)

Negatives = v2 bg-FPs (>25px from GT, IoU<0.1 with all GT; halos
excluded). TRAIN: no-veto F1 0.438 (refit effect over v2's 0.387), veto
+tabdigit-veto F1 0.442 (846 FPs killed, ~100 TPs). Frozen veto:
normalized-ignore > normalized-class within 12px, all classes.
DEV (once per layout) vs v2:

| layout | v2 P/R | v3 P/R | verdict |
|---|---|---|---|
| standard | 0.352/0.404 | **0.410/0.425** | win both |
| compact | 0.492/0.594 | **0.628/0.700** | big win; tabdigit 0.696/0.672 |
| large | 0.315/0.329 | 0.296/0.247 | REGRESS (unseen-layout veto+drift) |
| bravura | 0.355/0.355 | **0.451/0.433** | win both |

Success bar (FP-bg -25%, recall neutral+, ALL layouts): met on 3/4,
missed on large. ADOPTED as v3 primary with the deviation documented
(mean F1 0.398 -> 0.448; v2 weights retained for revert). Standard now
passes the precision gate (0.410 >= 0.35); recall 0.425 < 0.55 still.
Compact passes both gates. Cause of large miss: trained standard+compact
only (prereg kept); exact next step is a layout-inclusive capped run.

## Playable pitch (v3 chain, fret preserved)

Standard 227->107 decoded, pitch **0.78** (fret 1.00, string 0.78);
compact 428->192, pitch **0.52** on n=81 (v2: 0.70 on n=23 — 2.6x more
truth pairs recovered: 42 vs 16 correct pitches); large 0.67 (n=12);
bravura 0.50 (n=6). Controls: blank 0/0, shifted collapse, shuffled
0.78->0.16. Fret head 0.92-1.00 everywhere (preserved).

## D. Rhythm object-graph (image-only, no training)

Path: global morphological stems FAILED twice (staffless chopping, then
barline/beam merging) -> note-ANCHORED search (bridged vertical runs at
notehead edges) + chord-share clusters (x-center + y-overlap; pure
x-overlap over-merges) + thin-stem density fix (pdmx stems ~2px).
Flag detection attempted and ABSTAINED (tip regions are staff/stem
fragments everywhere; documented negative). TRAIN: stem P 0.43/R 0.52
association IoU>=0.3); beam pairs tp 2452 (over-grouping remains);
stem+dot agreement 0.65. DEV standard (once): **stem P 0.46/R 0.56**,
beam pairs tp 1541. Duration rule defined but end-to-end duration
accuracy BLOCKED (canonical noteIds part+measure-relative, no exact
joins link; not faked).

## Remaining blockers / exact next step

1. Large-layout generalization (detection + veto): layout-inclusive
   capped run (add large TRAIN pages; preregistered shape).
2. Exact joins->canonical event link for duration validation.
3. Flag detector (needs a separator beyond tip proximity).
4. 21 real-data gaps + technique supervision (unchanged).
5. Rhythm-graph prep: beam-group precision, TAB-column durations.

Next: commit v3 + rhythm graph (this report), then the layout-inclusive
capped run. Rhythm prep continues on validated primitives. DO NOT MERGE.
