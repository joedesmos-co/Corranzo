# Stage B — independent barline truth, detector corrections, and where the bottleneck moved

Corpus 2.1 unchanged. No manual labels created. No RTX, no training, no model work.

## B0 — raster-only truth set

Built from page rasters and canonical staff rectangles only. MusicXML, Verovio, pitch,
`d0`, `true_d` and residuals are never read. The primitive is deliberately different
from production: per-column **row coverage** inside the staff span, a requirement to
touch both outer lines, a maximum internal break, a horizontal-isolation test, and
**cross-staff agreement between the two staves of the same raster** (a printed
barline is drawn at one x across both staves — PDF-internal evidence, not second-source
evidence).

Two raster-only refinements were needed, both found by inspecting overlays:

- longest-run coverage missed real barlines in dense polyphony, where a notehead or
  beam crosses the barline and splits the run → switched to row coverage.
- a per-staff test alone admitted false positives on dense beamed blocks → keep only
  cross-staff agreed events.

Raw per-staff events 5138 → 1216 cross-staff agreed events over 272 usable systems.
Overlays were rendered and visually inspected for 3 systems (bach-fugue p1s0,
chopin-etude-op10-12 p3s2, mozart-k153 p2s1).

**Limitation, stated plainly:** the truth set's own error rate is unquantified.
Detector precision measured against it is therefore an upper bound, not a certificate.

## B1 — split by score

| Split | Systems | Scores |
|---|---|---|
| DEV | 93 | chopin-etude-op10-12, mozart-k153, grand-voices-vector, chopin-mazurka-op6-1 |
| HELDOUT | 116 | bach-fugue, beethoven-sonata, turkish-march, prelude, nocturne, minuet |
| EXCLUDED | 63 | etude-op10-01, dense-advanced, fur-elise, handel, tchaikovsky |

No score appears in more than one split.

## B2/B3 — failure taxonomy (DEV)

- **False negatives 89/89**: an event exists on **both** staves but consensus rejected it.
  `|x_up − x_lo|` over truth barlines is exactly 0.000 gaps for 84.8%, p90 0.370,
  max 0.916.
- **False positives 53**: 46 coincident stems / beamed blocks, 5 wide events
  (brace or connector), 2 system-edge.

## B4 — three corrections attempted, one accepted

| Correction | Target | Outcome |
|---|---|---|
| widen strict cross-staff gate 0.15 → 0.25/0.30/0.40/0.50 | FN mode | **REJECTED** — F1 did not improve at any value |
| remove system-edge margin | FP mode at edges | **REJECTED** — recall collapsed 0.753 → 0.327, so edge barlines are real |
| `min_coverage` 0.70 → 0.90 | FP mode: stems/beams spanning part of the staff | **ACCEPTED** — DEV F1 0.7767 → 0.7943 |

Detector performance against the raster-only truth:

| Split | Precision | Recall | F1 |
|---|---|---|---|
| DEV baseline | 0.8233 | 0.7351 | 0.7767 |
| HELDOUT baseline | 0.6280 | 0.5518 | 0.5875 |
| **HELDOUT frozen** | **0.7577** | **0.6589** | **0.7049** |

The ≥0.98 target is **not met**. Frozen config sha256
`fa6256c492c65cf8f1b14aa7e66a6d18b0fe300e1a442f0f44480158d3baa6b2`.

## B6/B8 — the decisive result

Usable measure coverage rose **30 → 42 (+40%)**, and `pl-handel-gavotte` reached exact
count agreement, contributing 19 count-anchored measures. But the frozen structural
subset stayed at **22 note pairs with an identical sha256**, because the extra usable
measures land exactly where the corpus has no labels.

```
onset groups seen / structurally complete : 20 / 2
empty_side 46   onset_group_count_differs 17   corpus_system_unbound 6
```

Handel check: 7 raster systems, corpus labels only 4; system 0 carries 9 upper notes
for ~3 measures; corpus system 2 starts at x = 0.266, so its left-hand measures are
unlabelled.

**So the detector was a real bottleneck, the correction was real, and after applying
it the bottleneck is no longer the detector — it is corpus label coverage.**

## B10 — clean gate

Unchanged at N = 20, `|delta_space| < 0.25` = 0.9000, `r_render = 0` = 0.9000,
GATE **FAIL**. Median delta_space +0.0311, p10/p90 −0.0081/+0.0494.
