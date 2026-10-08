# Guitar Future Model Plan — refined from pilot distribution (D17)

**Basis:** actual pilot targets (objects 5220, pitch 4309, string/fret 28,
technique 0). No architecture sweep; this refines the decomposed plan from
the Dataset v2 design doc against what supervision really exists.

## LOCAL tasks (per-object, crop-sufficient)

Notehead/rest detection, duration type + dots, accidentals, articulation
glyphs, beam flags. Supervision exists (thousands of joined boxes). These
can train first without waiting for TAB acquisition.

## CONTEXT / SEQUENCE tasks (need bars, voices, spans)

Voice assignment, beam grouping, tuplet ratios, tie chains, standard↔TAB
pairing, technique spans, hairpins, navigation jumps, capo/tuning context.
Supervision exists structurally (multi-voice 11 scores, ties 8, tuplets)
but technique spans have ZERO real examples → span heads train abstention
until acquisition lands.

## Dedicated branches (fret lesson preserved)

- **TAB-digit branch stays dedicated**: digits are ~½ notehead height with
  2-glyph frets; only 28 real digit labels exist, so TAB trains on synthetic
  + fixture supervision with explicit domain labeling until real TAB arrives.
- **Bend/technique-parameter heads**: schema-ready, data-blocked (0 real).
  Amount heads must never train on presence-only labels.
- **Pairing head** (`notationTabPair`): 28 real + fixture relations; joint
  prediction with disagreement → uncertainty, per the approved architecture.

## What the pilot distribution forbids

- No TAB string/fret claim from 28 labels.
- No technique-family claim from 0 labels (abstention + decline, as built).
- No temperature/risk calibration: validation has no risk collection yet.
- No photo-robustness claim: vector/raster only.

## First-training preregistration (for CASE A, when acquisition completes)

1. Freeze 150-scale splits (ratios ~120/15/15, all roles covered, audit CLEAN).
2. Train LOCAL heads on real + synthetic TAB/notation mix with domain tags.
3. Train CONTEXT heads on real only.
4. Technique heads: abstention until per-family UNCOMMON support achieved.
5. Report on sealed TEST once; publish the plan + seed + digests beforehand.
