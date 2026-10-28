# Guitar / OMR notation generalization — measured matrix

All figures are produced by running the **real OMR pipeline**
(`runPdfOmrClient`, `useWorker:false`) on committed PDF/MusicXML pairs and
comparing emitted rests and dotted notes against the reference. Rest type is
normalized (`sixteenth` = `16th`); durations are compared in quarters after
dividing by the measure's `<divisions>`.

## Rests (Phase 1)

| corpus | engraver | TP | FP | FN | note |
|---|---|---:|---:|---:|---|
| `omr-fixtures-corrected/piano-rhythm-tuplets-vector` | benchmark SMuFL | 4 | 0 | 1 | m8 quarter abstains: recognized note intervals over-occupy the measure (free gap 2 of 16 divisions) |
| `omr-fixtures-corrected/piano-beginner-single-vector` | benchmark SMuFL | 1 | 0 | 0 | quarter rest at m7 exact |
| `omr-fixtures-corrected/piano-grand-voices-vector` | benchmark SMuFL | 0 | 0 | 0 | no reference rests, none invented |
| `omr-independent-verovio/piano-rhythm-tuplets-verovio` | Verovio | 0 | 0 | 5 | rests drawn as paths; not recovered |
| `omr-independent-verovio/piano-pickup-crossstaff-verovio` | Verovio | 0 | 0 | 2 | same |
| `omr-independent-verovio/piano-grand-voices-verovio` | Verovio | 0 | 0 | 0 | no reference rests |

Controlled (Bravura-like) corpus: **5/6 TP, 0 FP**. Independent Verovio
corpus: **0/7 TP, 0 FP** — honest abstention, no invented rests.

### Fix that produced the controlled result
`detectVectorRests.tryApplyStaffRest`: quarter-and-longer rests previously
returned `overlaps-staff-notes` when the proportional x→time estimate landed
inside a sustained note (rounded engraving spacing). They now relocate to the
nearest free gap that can hold the **written glyph duration**. The duration is
never stretched; the rest is never invented. Commit `dc86789899`.

## Dotted notes (Phase 2)

| corpus | reference dots | generated dots | TP | FP | FN |
|---|---:|---:|---:|---:|---:|
| corrected rhythm tuplets | 2 | 2 | 2 | 0 | 0 |
| corrected beginner | 1 | 1 | 1 | 0 | 0 |
| corrected dense advanced | 0 | 0 | 0 | 0 | 0 |
| Verovio rhythm tuplets | 2 | 32 | 0 | 32 | 2 |
| Verovio pickup crossstaff | 0 | 3 | 0 | 3 | 0 |
| Verovio grand voices | 0 | 12 | 0 | 12 | 0 |

Controlled corpus: **3/3 exactly, 0 promotions**. Independent Verovio:
**0/2 recall, 47 false dots** — a genuine cross-engraver failure.

### Diagnosis
- `rhythmProvenance.dotCandidates` is **empty** on Verovio, so the false dots
  are not from the augmentation-dot glyph/path assignment.
- They are produced later by duration reconstruction (beam-topology /
  polyphonic rhythm assembly) choosing a dotted written value when measured
  spacing is between grid values. The dotted candidates in
  `jointPolyphonicRhythm.durationMeta` are already gated by `dottedEvidence`;
  the remaining path is `applyVectorBeamTopology.writtenMetaForDuration`,
  which maps a measured 1.5×eighth to a dotted eighth from duration alone.
- Corrected SMuFL dots come from vector **paths** (2 paths, 4.9 px, 4 curves),
  so path dots cannot simply be disabled.

### Safety position
- The experimental guitar path keeps its conservative dot detector and does
  not promote dotted durations (see `tests/guitarVisionDots.test.js`).
- The standard OMR path is exact on the controlled corpus but **must not be
  presented as cross-engraver dot support**. Verovio false dots are a
  pre-existing risk, not introduced by the rest fix.
- No Practice enablement change. Guitar Practice remains disabled.

## Reproduction

```
npx vitest run tests/omrVectorRestDotReference.test.js
```
The test runs the corrected rhythm/beginner/grand fixtures and asserts the
exact rest and dot sets above (including the intentional m8 abstention).
