# Vector tuplet inventory — development witnesses

**Program phase:** Holdout generalization — Target 1 (tuplets)  
**Starting HEAD:** `fc7af58`  
**Production OMR:** `f091ee7` (unchanged at inventory time)  
**Witnesses:** `piano-pokemon-rby-title`, `piano-super-mario-bros-theme`  
**Preflight repro:** both scores `tuplet=0`, `time-modification=0` (see `TUPLET_PREFLIGHT_REPRO.json`)

## Shared failure mechanism (proven before production edits)

| Fact | Evidence |
| --- | --- |
| PDF text layer contains literal `"3"` glyphs | Pokémon p1: **16**; Mario p1: **4**; Mario p2: **10** |
| Glyphs survive `textGlyphsToImage` | Image-space coordinates recorded under `crops/tuplets/*-text.json` |
| Production already has digit-gated recovery | `recoverDigitGatedTriplets.js` called from `buildVectorMeasureRecord` |
| Recovery **abstains** on these scores | Designed for **full-measure** uniform `beats×3` columns (fixture `piano-rhythm-tuplets` m3) |
| Holdout tuplets are **local groups** | 3 eighths (or quarter+eighth) inside mixed polyphonic bars |
| Digit Y gate is **above-only** | `collectTupletDigitThrees` keeps `y ∈ [meanNoteY−90, meanNoteY−4]` — Mario brackets place `"3"` **below** notes |
| Emitter supports `<time-modification>` | `buildOmrMusicXml.js` — but **no** `<tuplet type="start\|stop">` |
| Raster path | No tuplet detection |

**First failing stage:** local tuplet group ownership / ratio application inside `recoverDigitGatedTripletEvents` (full-bar gate + above-only digit band), before MusicXML emission.

---

## Support matrix (current production)

| Feature | Status |
| --- | --- |
| Triplets (3:2) full-bar digit-gated | Partial (fixture-style only) |
| Triplets other than 3 | No |
| Bracketed tuplets | No bracket geometry; digits only |
| Unbeamed tuplets | No local path |
| Tuplets containing rests | No |
| Tuplets containing chords | Full-bar path merges chord columns; local path absent |
| Nested tuplets | No |
| Crossing beats | Full-bar only (entire measure) |
| Crossing barlines | No |
| Multiple voices | No local per-staff ownership |
| Number-only beamed | Digits present; recovery abstains |
| Bracket-only ambiguity | Abstain (correct policy) |

---

## `piano-pokemon-rby-title`

- **PDF:** intake `pokemon-red-and-blue-title-theme-for-piano.pdf` (1 page, vector MuseScore/TCPDF)
- **SHA-256:** `f8ad96511dd1c25e94dd55a0c63fb4d29d779ce695476cd7d858341ea46b84aa`
- **Generated baseline:** 667 notes / 33 measures / 0 tuplet / 0 time-modification

### Visible tuplet groups (PDF authority)

| ID | Page | System | Staff | Measure | Voice | Printed # | Bracket | Group (written) | Expected ratio | Onset span | Notes |
| --- | --- | --- | ---: | --- | --- | ---: | --- | --- | --- | --- | --- |
| P-T01 | 1 | 2 | treble | ~10 | upper | 3 | no (number at beam) | 3× beamed 8ths | 3:2 | 1 quarter | first of two beam groups |
| P-T02 | 1 | 2 | treble | ~10 | upper | 3 | no | 3× beamed 8ths | 3:2 | 1 quarter | second beam group |
| P-T03 | 1 | 2 | treble | ~11 | upper | 3 | no | 3× beamed 8ths | 3:2 | 1 quarter | |
| P-T04 | 1 | 2 | treble | ~11 | upper | 3 | no | 3× beamed 8ths | 3:2 | 1 quarter | |
| P-T05 | 1 | 2 | bass | ~11 | lower | 3 | no (number below) | 3× beamed 8ths | 3:2 | 1 quarter | below-beam digit |
| P-T06 | 1 | 2 | bass | ~11 | lower | 3 | no | 3× beamed 8ths | 3:2 | 1 quarter | |
| P-T07 | 1 | 3 | treble | ~16 | upper | 3 | **yes** hooks | quarter + eighth | 3:2 | 1 quarter | bracket above |
| P-T08 | 1 | 3 | bass | ~16 | lower | 3 | **yes** | quarter + eighth | 3:2 | 1 quarter | bracket below |
| P-T09 | 1 | 3 | treble | ~18 | upper | 3 | **yes** | quarter + eighth | 3:2 | 1 quarter | |
| P-T10 | 1 | 3 | bass | ~18 | lower | 3 | **yes** | quarter + eighth | 3:2 | 1 quarter | |
| P-T11 | 1 | 4 | treble | ~23 | upper | 3 | **yes** | quarter + eighth | 3:2 | 1 quarter | |
| P-T12 | 1 | 4 | bass | ~23 | lower | 3 | **yes** | quarter + eighth | 3:2 | 1 quarter | |
| P-T13 | 1 | 4 | treble | ~25 | upper | 3 | **yes** | quarter + eighth | 3:2 | 1 quarter | |
| P-T14 | 1 | 4 | bass | ~25 | lower | 3 | **yes** | quarter + eighth | 3:2 | 1 quarter | |
| P-T15 | 1 | 6 | treble | ~33 | upper | 3 | **yes** | quarter + eighth | 3:2 | 1 quarter | |
| P-T16 | 1 | 6 | bass | ~33 | lower | 3 | **yes** | quarter + eighth | 3:2 | 1 quarter | |
| P-T17 | 1 | 6 | treble | ~35 | upper | 3 | **yes** | quarter + eighth | 3:2 | 1 quarter | PDF has ~35–36; OMR currently emits 33 measures |
| P-T18 | 1 | 6 | bass | ~35 | lower | 3 | **yes** | quarter + eighth | 3:2 | 1 quarter | |

Measure indices above are **printed** system labels; OMR measure numbering may drift (baseline emits 33 measures vs ~35–36 printed). Inventory uses printed labels for source authority.

### Digit / path provenance

- Number glyphs: PDF text font `g_d0_f5`, `str === "3"`, height ≈ 9 pt.
- Brackets: vector strokes (operator list); curve extractor returned sparse data — treat brackets as **optional corroboration**, not required when digit+beam/group geometry is strong.
- Reject: measure numbers (`6`,`12`,`19`,… as multi-digit left-margin), dynamics, lyrics (none near music), fingering (watch left-margin outliers e.g. image `(60,1051)`).

### Expected MusicXML semantics (per group)

```xml
<time-modification>
  <actual-notes>3</actual-notes>
  <normal-notes>2</normal-notes>
</time-modification>
<!-- first event -->
<notations><tuplet type="start"/></notations>
<!-- last event -->
<notations><tuplet type="stop"/></notations>
```

Written types preserved (eighth / quarter+eighth). Performed duration of group = one quarter note (2 eighths sounding).

### Current generated events

No `timeModification` on any note. Local triplet regions are packed as ordinary rhythm (likely unequal/wrong onsets inside the beat).

---

## `piano-super-mario-bros-theme`

- **PDF:** intake `super-mario-bros-main-theme.pdf` (2 pages)
- **SHA-256:** `381c62726406a5d44fb710191d320cb4cc7e3fb420ce1df700a25348b7288e52`
- **Generated baseline:** 634 notes / 49 measures / 0 tuplet / 0 time-modification  
  (page-1 visual ~26 printed measures; page-2 continues — OMR measure count inflated vs printed labels)

### Visible tuplet groups (page 1 authority)

| ID | Page | System | Staff | Measure | Printed # | Bracket | Group | Ratio | Span |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| M-T01 | 1 | 1 | treble | 5–6 region | 3 | **yes** below | 3× 8ths | 3:2 | 1 quarter |
| M-T02 | 1 | 1 | bass | 5–6 region | 3 | **yes** below | 3× 8ths | 3:2 | 1 quarter |
| M-T03 | 1 | 5 | treble | ~24–25 | 3 | **yes** below | 3× 8ths | 3:2 | 1 quarter |
| M-T04 | 1 | 5 | bass | ~24–25 | 3 | **yes** below | 3× 8ths | 3:2 | 1 quarter |

Page 2 contains additional `"3"` text glyphs (10) — treat as further local triplet candidates with same pattern; confirm visually during implementation against `mario-2.png` without sealed-holdout usage.

### Digit provenance

- Font `g_d2_f4`, height ≈ 10 pt.
- Placement **below** noteheads → excluded by current above-only Y band.
- Brackets present with hooks toward notes.

### Current generated events

0 `<tuplet>` / 0 `<time-modification>`. Digits ignored; below-staff gate + local-group absence.

---

## Neighboring non-tuplet confounders

| Confounder | Handling |
| --- | --- |
| Measure numbers | Multi-digit / left margin — reject |
| Volta / ending labels | Not present on these pages |
| Page number | Mario p2 `"2"` top — reject |
| Beams | Must not be classified as brackets |
| Staccato dots | Near noteheads — not tuplet evidence |
| Chord symbols / lyrics | Absent in tuplet zones |

---

## Implementation direction (post-inventory)

1. Keep full-bar `recoverDigitGatedTripletEvents` for frozen fixture.  
2. Add **local** digit-gated group recovery: one `"3"` → one contiguous 3:2 group in one staff/voice.  
3. Expand digit Y band to allow numbers **below** as well as above noteheads.  
4. Support (a) three equal eighths and (b) quarter+eighth written totaling three eighth units.  
5. Emit balanced `<tuplet start/stop>` in `buildOmrMusicXml`.  
6. Abstain without digit evidence; do not invent from measure packing alone.

## Pipeline stage map

```
PDF text/glyphs → textGlyphsToImage
 → noteheads / stems / beams / rests
 → digit extraction (literal "3")
 → [MISSING] bracket optional corroboration
 → event columns / voices / duration packing
 → ★ recoverDigitGatedTripletEvents (full-bar only)  ← fails here for holdouts
 → beam topology (skips timeModification)
 → score graph → buildOmrMusicXml (time-modification only; no tuplet notations)
```
