# Development truth audit

**Authority:** printed PDF. Companion MusicXML must be audited before use as expected truth.  
**Never** author expected events from Corranzo generated MusicXML.

## Development holdouts

### `piano-pokemon-rby-title` — T4 passage (PDF visual)

Source: intake PDF page 1 (vector MuseScore export).

| Region | Audited facts (PDF) |
| --- | --- |
| Global | Grand staff; open key; printed common-time; 35 measures; born-digital; no skew |
| m1 | Tempo ♩=180 + expressive text; dynamic **f**; dense RH chords; LH repeated staccato eighths on low G pedal; chromatic accidentals |
| m9–10 | Tempo change to ♩=120 “[regular speed]”; **mf**; rolled/arpeggio chords; polyphony (sustained + moving) |
| m11+ | Explicit triplet brackets (3) in treble and/or bass; continuing chromatic accidentals |

Stored: `truth/passages/piano-pokemon-rby-title.json`  
**Semantic score status:** structural/feature checks only until full pitch/onset sheet authored.

### `piano-super-mario-bros-theme` — T4 passage (PDF visual)

| Region | Audited facts (PDF) |
| --- | --- |
| Global | Grand staff; open key; **no printed time signature** (music is 4/4); tempo ♩=180; page 1 shows systems through ~m26; page 2 continues |
| Opening | Syncopation; rests; extensive **staccato**; dense accidentals |
| Mid | Multiple **repeat** start/end barlines; triplets with brackets |
| Truth use | Structure + articulation + repeat presence; full pitch grid not yet hand-transcribed |

Stored: `truth/passages/piano-super-mario-bros-theme.json`

### `piano-korobeiniki-tetris-tiles` — T4 passage (PDF visual)

| Region | Audited facts (PDF) |
| --- | --- |
| Global | Grand staff; open key; 4/4; ♩=170; **Ped.** brackets under bass |
| m1 | Dynamic **f**; RH melody + LH accompaniment |
| ~m8 | End-repeat barline |
| ~m20 | Mid-piece meter change involving **2/4** then return toward **4/4**; high ledger density; **ff** |

Stored: `truth/passages/piano-korobeiniki-tetris-tiles.json`

### `guitar-guaraldi-pumpkin-waltz` — T3 (companion MXL present, unaudited)

- Private Downloads `.mxl` hash `e5191435…` recorded.  
- PDF shows paired notation+TAB, 3/4, 3 flats, swing, dense jazz chords, staccato, ties, 1./2. endings.  
- **Status:** do not use MXL as evaluator truth until measure-by-measure PDF audit completes.  
- Prior visual notes remain valid for structural diagnosis only.

### `guitar-pirates-caribbean-tab` — T3 (companion MXL present, unaudited)

- Private Downloads `.mxl` hash `239722f6…` recorded.  
- PDF is TAB-only with rhythmic stems; treat TAB rhythm policy mismatches as unsupported/policy until audited.

### `guitar-gravity-falls-theme-tab` / `guitar-pachelbel-canon-d-tab` — T4 structural

- TAB-only vector; stems present; no MusicXML.  
- Passage files record layout features only (no pitch grid).

## Reference defects vs OMR defects

| Observation | Class |
| --- | --- |
| Missing printed time signature (Mario) | Score engraving choice — OMR may default 4/4; not automatic production defect |
| TAB-only approximate rhythm warnings | Likely **unsupported-or-policy** until proven wrong vs stem glyphs |
| Unaudited MXL ≠ PDF | **reference defect** candidate — never repair production for this alone |
| Sealed-eval pairing residuals | Not usable for repair gate |

## Repair-gate implication

Without T1/T2 PDF-audited event truth on ≥2 development scores, semantic Overall/Pitch/Rhythm deltas cannot confirm a repeated root cause. Structural/pipeline failures may still satisfy gate B/C if severe and universal.
