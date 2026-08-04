# Phase 1 — Accidental Path/Ink Evidence

**Baseline commit:** `2f82df8`  
**Focus mismatches:** `incorrect-pitch` with `|Δ| = 1` (F♯→F, G♯→G, …) and linked `incorrect-chord`

## Summary

On the frozen semantic vector fixtures, chromatic MusicXML `<alter>` values are **not accompanied by any accidental in the PDF text layer or as `constructPath` geometry**. The Corranzo benchmark generator draws noteheads, stems, articulations, and clefs, but never emits sharp/flat/natural glyphs. Pitch resolution therefore never enters `assignLocalAccidentals`, and every written sharp is recovered as the diatonic staff step (F♯→F).

Real engraved user PDFs (Evangelion, Ao no Sumika) **do** expose SMuFL accidentals in the text layer. Sweden/Minecraft uses a non-SMuFL PUA notehead encoding with **no** accidental codepoints — a true path/ink case once geometry is present.

## Representative corpus cases

| Fixture | Measure | Expected | Generated | Staff | Clef | Key (truth) | Text-layer accidentals | Path/`constructPath` accidentals | Disappearance stage |
|---|---|---|---|---|---|---|---|---|---|
| piano-grand-voices-vector | 2 | F♯4 | F4 | 1 | treble | C (`fifths=0`) | none on page | none (stems/staff/barlines only) | PDF generation: `draw_standard_event` omits accidentals |
| piano-grand-voices-vector | 3 | G♯4 | G4 | 1 | treble | C | none | none | same |
| piano-grand-voices-vector | 4 | A♯4 / A♯2 | A4 / A2 | 1+2 | treble/bass | C | none | none | same |
| piano-articulation-scan | multiple | ±1 sharp misses | natural | 1 | treble | C | none | none | same |
| piano-dense-advanced-vector | multiple | ±1 sharp misses | natural | 1 | treble | C | none | none | same |

Inventory sample (`tmp/omr-semantic-repair/mismatches.json`): **45** structured `incorrect-pitch` with `|Δ|=1` (grand-voices 12, articulation-scan 13, dense 15, guitar 5).

### Trace checklist (grand-voices m2 F♯4)

1. **Expected pitch:** F♯4 (`<alter>1</alter>`)
2. **Generated pitch:** F4
3. **Staff position:** F4 diatonic step (correct staff Y; alter missing)
4. **Active clef:** treble
5. **Key signature:** truth `fifths=0`; OMR detects no accidental glyphs → `fifths=0`
6. **Measure accidental state:** never seeded (no local attachment)
7. **PDF text-layer near note:** noteheads `U+E0A4` / `U+E0A3` only; **zero** `U+E260–E264`
8. **Vector paths near note:** stems, staff lines, barlines, beams/slurs; **no** accidental-sized filled outlines
9. **Notehead bbox:** present via SMuFL notehead glyphs
10. **Stem / chord:** D4–F♯4–A4 stack; middle tone is the altered member
11. **Accidental candidate bboxes:** none before repair
12. **Stage of loss:** fixture PDF authoring — font defines `accSharp`/`accFlat`/`accNatural` but generator never calls them; binder `assignLocalAccidentals` receives an empty glyph list

Crops: `tmp/omr-accidental-path/crops/gv-*.png`, `grand-voices-full.png`.

## Real PDF evidence

| Source | Accidental text layer | Notes |
|---|---|---|
| Evangelion (`tmp/sprint1/…evangelion.pdf`) | `U+E260×32`, `U+E261×2`, `U+E262×1` | Text-layer path already usable; attachment quality is separate |
| Ao no Sumika report | flats + naturals in text | same |
| Sweden/Minecraft report | **no** accidental codepoints; PUA noteheads `U+E12C/E12D`… | Needs path/ink once marks exist |

## Implication for this sprint

1. Add a **conservative path/ink accidental primitive** that synthesizes SMuFL-shaped candidates into existing `assignLocalAccidentals`.
2. Restore fixture fidelity by drawing local accidentals as **vector paths** (not text) in the benchmark generator so the nine frozen fixtures exercise the primitive without weakening the text-layer path.
3. Keep text-layer accidentals strictly preferred when present.
