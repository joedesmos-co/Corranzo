# Guitar Dataset v2 Plan (design only — no download, no training)

**Status:** plan. Nothing in this doc has been collected, generated, or trained on.
**Sealed reference:** the current 20-score benchmark stays historical evidence
and must NOT tune Dataset v2 (no selection, no temperature, no risk, no
eyeballing failures to steer collection).

## G11 — composition: ~100–200 new high-quality scores

Target **~150 usable scores** (minimum 100, cap 200). "Usable" = exact
symbolic truth (MusicXML/MXL with verified string/fret/pitch agreement) +
deterministic render with retained ids (G7 loop closed first). Diversity is
mandatory across every axis; near-duplicates are rejected at intake:

- composers / publishers / eras / styles (classical, flamenco, jazz, rock,
  fingerstyle — each with its idiomatic techniques, not generic etudes);
- engraving styles and tools (MuseScore, Finale, Sibelius, Dorico, LilyPond,
  hand-engraved editions) — one engraver must not dominate;
- standard notation only / TAB only / standard+TAB (roughly even thirds);
- rhythms (simple → nested tuplets, syncopation, multi-voice), fret range
  (open → 12th+ with multi-digit frets), chord density, technique density
  (bend/slide/legato/harmonic vocabularies per style);
- tunings (standard, drop-D, DADGAD, open-G…), capo positions;
- page layouts (single systems → multi-page), measure counts, repeats/endings
  and D.S./Coda navigation instances with resolvable semantics;
- rare notation deliberately included (harmonics, tapping, rasgueado where
  encodable) so the 3 UNKNOWN families either gain a schema path or stay
  explicitly out of scope.

Intake gate per score: provenance declared (licensed or CC0/public-domain),
`validateGuitarMusicXml` clean, pairing verification ≥ 99% of fretted notes
(the rest quarantined with reasons, never auto-fixed), truth-digest + pixel
digest recorded for leakage control.

## G12 — split design (score-level, collection-grouped, pre-registered)

At ~150 scores: **~120 train / ~15 dev / ~15 sealed test**, exact counts set
by collection grouping (same rules as `corpusSplits.js`: shared
composer/edition/engraver never straddles a split; validation partitioned
into selection/temperature/risk; truth+pixel digests checked across splits).
Page/measure splits are forbidden — leakage unit is the score. The split
manifest (seed, ratios, digest) is frozen and committed BEFORE any training;
`assertUsableForSelection` refuses sealed splits. Dev is for iteration; test
is touched once per candidate, after selection.

## G13 — real-world capture and evaluation

Symbolic truth stays exact while inputs degrade, in staged order:

1. clean vector PDFs (deterministic render from truth);
2. exported raster PDFs (DPI sweep);
3. print/display → scan/photocopy (controlled degradation);
4. phone photos (perspective, blur, lighting, crop variance) with
   print/display → capture → registration, mirroring Piano's
   controlled-capture route.

Each stage reuses the same truth; the input-quality gate (blur, contrast,
resolution, page-quad, cropping) decides readability before recognition, so
a photo failure is a *rejection*, not a hallucination. Stage 4 needs a small
paired pilot (tens of scores, registered captures) before any training on
photos is considered.

## G14 — input quality labels (kept per score/page)

Effective fret-glyph size, staff-space size, resolution/DPI, contrast, blur
(Laplacian variance), skew, perspective (page-quad convexity), crop
completeness, vector/raster/photo provenance. These feed the existing quality
gate and future calibration (selection/temperature/risk need quality
stratification, or confidence will be miscalibrated across clean-vs-photo).

## G15 — training target/head plan (decomposed, not one giant classifier)

Fret-branch lesson applies: do not fuse features because we can. Proposed
decomposition, sharing the detail backbone + relation attention, splitting
where geometry or supervision differs:

| head(s) | supervision | notes |
|---|---|---|
| object family (notehead/rest/fret-digit/marking/…) | boxes + classes | shared trunk |
| string (1–6) + fret (0–24) + digit-count | TAB digits | high-res TAB view; string-conditioned sampling (already architected) |
| rhythm/duration (type, dots, tuplet, beams) | symbolic rhythm truth (G5) | needs voice-aware decoding, not per-glyph classification |
| voice + staff + chord membership | grouping relations | relation heads (`chordMember`, `beamOwnership`, `staffPair`) |
| standard pitch (step/octave/accidental) | notation noteheads | notation view; octave-convention aware |
| notation↔TAB pairing | `notationTabPair` relation | joint prediction, disagreement → uncertainty (per architecture) |
| technique family + parameters | techniques with params (G3) | one family head + per-family parameter heads; amount heads train ONLY on amount-labelled data (no fake truth) |
| articulation / dynamics / text-navigation | marking + context heads | per-staff-band context (key/meter/tempo/capo/tuning), not per-note |

Families with no honest labels keep their head but train abstention and
evaluate as unsupported (the acquisition plan's `claimable` rule); the 3
UNKNOWN families get no head until a schema path exists. New heads require a
data-support check (labels in train/validation/held-out) before they can
carry a product claim.

## Readiness verdict (G10 go/no-go)

Decision criteria and results:

1. **Render/source identity loop exact? YES.** Pilot proves stable IDs
   across processes, 1.0 exact join rate (standard, paired, TAB chord), no
   order fallback, all 40 fixtures Verovio-loadable.
2. **Common V1 notation has structured truth where source permits? YES.**
   111/115 families VERIFIED_SUPPORTED; the G3 priority list (bends with
   parameters, slides, legato, harmonics, tapping, palm-mute, let-ring,
   dead/ghost, vibrato, tremolo-picking, tuning/capo/positions/fingering,
   grace/cue, chord symbols + diagrams, full navigation) is implemented
   with round-trip fixtures.
3. **Unknowns resolved? YES.** Tremolo-picking and golpe are structured
   (implemented); rasgueado is confirmed text-only with 3-leg evidence and
   retains AMBIGUOUS status.
4. **Round-trip tests pass? YES.** 52 JS + 6 Python, 40/40 fixtures.
5. **Remaining unsupported genuinely source-limited and documented? YES.**
   3 source-limited + 1 ambiguous, each with evidence in the gap audit.

- **Dataset v2 collection: AUTHORIZED** — under the intake/split discipline
  in this plan (provenance declared, pairing verification ≥ 99%, frozen
  score-level splits, sealed 20-score benchmark untouched).
- **Model training: NOT YET AUTHORIZED** — training needs the collected
  dataset first, plus the head/data-support checks in G15. The next step is
  score acquisition, not training.
