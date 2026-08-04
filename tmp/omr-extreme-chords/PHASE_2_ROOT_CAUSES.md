# Phase 2 — Extreme-register chord root causes

- Commit: `2622914`
- Baseline: `PHASE_1_REGISTER_BASELINE.md` / `chord_inventory.json`
- Extreme incorrect chords: **25** (low-extreme 8, high-extreme 17)
- Crops: `crops/*.png`

## Pipeline trace (expected path)

```
PDF text/path/raster
  → notehead candidate extraction (vector glyph / raster blob)
  → ledger fragment extraction / staff detection
  → staff + clef ownership
  → notehead vertical anchor (font-aware ink vs glyph metrics)
  → ledger-line ownership (implicit via staff-position math today)
  → staff-position quantization → MIDI
  → chord-column grouping → voice/onset
  → MusicXML
```

## Visual evidence

| Crop | Fixture | What is visible |
|---|---|---|
| `crops/dense-system2-high-m6-8.png` | piano-dense-advanced-vector m6–8 | Dense beamed treble chords with 1–3 ledgers above, stacked accidentals, displaced seconds |
| `crops/guitar-m8-open-e.png` | guitar-standard-chords-vector m8 | Open-E style stacks with **many** ledgers below the single staff; lowest heads clearly drawn |
| `crops/artic-m1-3-low-bass.png` | piano-articulation-scan m1–3 | Raster bass chords with **one** ledger below; low head + staff head share a stem |

## Mechanism classification (campaign taxonomy)

| # | Mechanism | Extreme errors explained | Total chord errors explained (approx) | Fixtures | Visual strength | Safest intervention | Regression risk |
|---:|---|---:|---:|---|---|---|---|
| **11** | **Note removed by plausible-range filter** (`MIN_LEDGER_DIATONIC_OFFSET = -8` → `midiFromStaffPosition` returns `null` → vector notehead dropped) | **~6–8 low-extreme** (all guitar open-E missing E2/B2/E3; any treble tone >~4.5 spaces below) | Guitar missing-note / incorrect-chord cluster in m8 | guitar-standard-chords-vector (primary); any deep treble ledger | **Very high** — PDF glyphs at yNorm≈0.62 exist; emitted events stop ~G3 (yNorm≈0.57); synthetic mapping returns NULL beyond ~4.5 spaces | Widen ledger diatonic window in `pitchFromStaffPosition.js` (remove arbitrary clip) | Low–medium: must not invent tones; ghost-staff rejection stays in staff detection |
| **8** | Extreme note snapped to wrong staff step (metric-anchor fallback under ledger ink) | **~7–10 high-extreme** | Subset of dense-advanced incorrect-chord / incorrect-pitch | piano-dense-advanced-vector | High — anchors show `glyph-metrics-fallback` with `no-head-sized-component` / `ambiguous-components` while ledgers suppress rows | Improve ink anchor under ledger suppression **or** trust glyph metric + local staff gap when ink fails | Medium: font-aware path already accepted; avoid song-specific factors |
| **1** | Missing notehead detection (raster) | **~4 low-extreme** (articulation-scan C2/D2/E2) | Scan fixture missing-note load | piano-articulation-scan | High — ledger head visible in crop; generated chord omits low tone or empties | Raster notehead / ledger association (detectOmrNoteheads) | Medium–high on scans |
| **15** | Accidentals assigned wrong / absent accidental evidence | **~4 high-extreme** accidental-like (±1) | Large share of dense-advanced pitch errors (known Corranzo gap) | piano-dense-advanced-vector | High in crop (sharps present) but prior campaign: many fixtures lack text/path accidentals | Preserve path-accidental system; do **not** invent alters | High if guessed |
| **13** | Chord tones split / column merge | **~3 extreme** | ~38 incorrect chords staged as column grouping overall | dense-advanced, articulation-scan | Medium | Adjacent-slot / column evidence only where geometry proves | Medium (prior broad scaffolding rejected) |
| **12** | Stem/glyph-inclusive bounds shift pitch anchor | Overlaps #8 | Font-pitch residual | dense + guitar | Medium — `suppressedStaffOrLedgerRows` high on extreme heads | Already partially addressed by font-aware anchor; extend for ledger-on-head | Medium |
| **5/6** | Ledger ownership / fragment clustering | **~3** staged ledger/anchor | Small in inventory (`ledger_line_ownership_or_pitch_anchor` ×3 extreme) | dense-advanced | Medium — ledgers visible; little explicit ownership provenance today | Add ledger ownership only after range clip fixed | Medium |
| **4** | Ledger fragment removed as ghost staff | **0 proven** in this inventory | Ghost-staff fix must stay | — | Prior campaign evidence | Do not loosen `selectViableStavesForSystemGrouping` | High if relaxed |
| **10** | Neighboring staff assignment | **0** staffAssignmentErrors in extreme bins | — | — | — | — | — |
| **18** | Evaluator alignment symptom | Not dominant for extreme set | Some middle/high-normal | — | — | Ignore for OMR fixes | — |

## Largest multi-fixture root cause

### RC-A — Arbitrary extreme-register limits drop real ledger noteheads (mechanism 11)

Three cooperating clips (before fix):

1. `MIN_LEDGER_DIATONIC_OFFSET = -8` / `MAX = 18` in `midiFromStaffPosition` → `null` MIDI → vector notehead not emitted (`pitch-null` on orphans).
2. Measure Y pad only `gap * 3` in `vectorGlyphAllocationBounds` → deep ledger glyphs never enter the measure.
3. Orphan recovery `ORPHAN_MAX_STAFF_DIST = 0.02` (~2 spaces) → remaining deep glyphs rejected as `far-from-staff` (44 on guitar-standard before fix).

Evidence:

1. Guitar m8 expected `E2 B2 E3 G3 B3 E4`; generated often `G3 B3 E4` (lowest three missing).
2. PDF notehead glyphs exist at yNorm `0.5859 / 0.6010 / 0.6212` for those columns.
3. Emitted notes for the same x stop near yNorm `0.5725` (≈G3, staffPos −5).
4. Synthetic `midiFromStaffPosition` returned `null` beyond ~4.5 spaces below treble.
5. `orphanNoteheads.rejectedOrphanReasons["far-from-staff"] === 44` before widening measure/orphan windows.

This is an **arbitrary ledger-line limit**, which the campaign forbids. It explains the bulk of **low-extreme** incorrect chords and missing tones without inventing pitches.

High side (`MAX=18`) still covers corpus high-extreme tops (A5–D6 observed as midi 81–84). High-extreme pain is not primarily this clip.

### RC-B — Font-aware ink anchor fails on ledger-crossed dense stacks (mechanism 8 / 12)

Extreme and near-extreme dense chords frequently fall back to `glyph-metrics-fallback` because:

- long horizontal ledger ink → `suppressedStaffOrLedgerRows`
- stacked chord heads → `ambiguous-components` or `no-head-sized-component`

Metric fallback then quantizes a slightly wrong staff step / octave neighbor. Dominates **high-extreme** incorrect pitch-sets on `piano-dense-advanced-vector`.

### RC-C — Raster low-ledger notehead miss (mechanism 1)

`piano-articulation-scan` low chords: one ledger below is visible; OMR omits C2/D2/E2 or empties the chord. Separate from the vector MIDI clip.

### RC-D — Accidental evidence gap (mechanism 15)

Several high-extreme mismatches are ±1 / sharp-natural swaps. Path accidental work must stay preserved; do not “fix” extreme chords by inventing alters.

## Ranking for intervention order

1. **RC-A — widen/remove hard diatonic ledger null window**  
   Extreme-low errors explained: high · Total: moderate but surgically relevant · Fixtures: guitar (+ any deep treble) · Visual: very strong · Safest point: `midiFromStaffPosition` limits · Risk: low if only extending range, no musical plausibility invention

2. **RC-B — ledger-stable notehead anchors for stacked extreme chords**  
   Extreme-high explained: high · Total: overlaps font-pitch residuals · Safest after RC-A with focused tests · Risk: medium

3. **RC-C — raster ledger notehead recall**  
   Extreme-low scan only · Risk: medium

4. **RC-D — accidentals** — out of scope unless new path/text evidence appears

5. Chord-column / displaced-second tweaks — only after pitch membership is complete

## What not to do yet

- Do not loosen ghost-staff rejection (`selectViableStavesForSystemGrouping`).
- Do not revive broad chord-ownership scaffolding.
- Do not invent ledger lines or pitches from chord “reasonableness”.
- Do not touch microphone / practice recognition.

## Next step (Phase 3 / 7)

Implement **RC-A** first: extend ledger diatonic offsets so geometrically present noteheads below/above the staff still map to MIDI; add focused failing→passing tests for deep treble ledgers (guitar open E) and several stacked ledgers; re-run register-binned metrics + full corpus gate.
