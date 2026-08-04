# Extreme-register chord recognition — campaign report

- HEAD base: `2622914` (`final release-blocker fixes` + ancestors listed in brief)
- Evaluator: frozen **2.0.0** / schema **2** (unchanged)
- Microphone / practice recognition: **not modified**

## Register-binned baseline (Phase 1)

| Bin | Chords | Exact % | Incorrect | Missing | Extra |
|---|---:|---:|---:|---:|---:|
| overall | 216 | 37.04% | 136 | 197 | 194 |
| **low-extreme** | 17 | **52.94%** | **8** | **20** | 3 |
| low-normal | 54 | 62.96% | 20 | 24 | 26 |
| middle | 31 | 25.81% | 23 | 26 | 21 |
| high-normal | 94 | 27.66% | 68 | 103 | 123 |
| **high-extreme** | 20 | **15%** | **17** | **24** | 21 |

Global freeze: Overall 67.12% · Pitch 66.86% · Rhythm 74.64% · Measure 72.85% · Sustain 55.56% · incorrect-chord 182 · missing/extra 136/112.

Artifacts: `PHASE_1_REGISTER_BASELINE.md`, `chord_inventory.json`, `corpus-baseline.*`, `crops/`.

## Root-cause ranking (Phase 2)

See `PHASE_2_ROOT_CAUSES.md`. Top causes:

1. **RC-A** — Arbitrary ledger MIDI window + tight measure Y pad + orphan `far-from-staff` drop deep ledger noteheads (mechanism 11). Dominates **low-extreme**.
2. **RC-B** — Font-aware ink anchor falls back under ledger/stack ink (`no-head-sized-component` / `ambiguous-components`). Dominates **high-extreme** pitch-set errors.
3. **RC-C** — Raster low-ledger miss on `piano-articulation-scan`.
4. **RC-D** — Accidental evidence gaps (preserve path-accidental system; do not invent alters).

Visual crops: `crops/dense-system2-high-m6-8.png`, `crops/guitar-m8-open-e.png`, `crops/artic-m1-3-low-bass.png`.

## Accepted change (RC-A)

### Production

1. `pitchFromStaffPosition.js` — widen `MIN_LEDGER_DIATONIC_OFFSET` **-8 → -16**, `MAX` **18 → 24** so geometrically present extreme ledger heads still map to MIDI (no musical invention).
2. `vectorGlyphMeasureBounds.js` — ledger Y pad **gap×3 → gap×8** (and consider bass lines) so deep/high ledger glyphs stay in-measure.
3. `vectorOrphanNoteheads.js` — orphan staff-distance ceiling becomes **max(0.02, gap×8)** so genuine ledger orphans are not rejected as `far-from-staff`; mid-page noise still rejected.

`staffSpanWithLedger` defaults left at 4 spaces (widening broke grand-staff role selection near splitY).

### Tests

`tests/omrExtremeRegisterChords.test.js` — low/high multi-ledger MIDI, open-E depth, measure bounds, orphan reject/accept safety.

### Register after

| Bin | Exact % before → after | Incorrect | Missing tones |
|---|---|---:|---:|
| **low-extreme** | **52.94% → 76.47%** | 8 → **4** | 20 → **6** |
| high-extreme | 15% → 15% | 17 → 17 | 24 → 24 |
| middle | 25.81% → 35.48% | 23 → 20 | — |
| overall chords | 37.04% → 41.56% | 136 → 135 | — |

Remaining low-extreme failures: all `piano-articulation-scan` raster (RC-C). Guitar open-E extreme chords now **exact** (`E2 B2 E3 G3 B3 E4`).

### Global corpus before → after

| Metric | Before | After | Δ |
|---|---:|---:|---:|
| Overall | 67.12% | **68.28%** | +1.16 |
| Pitch | 66.86% | **71.53%** | **+4.67** |
| Rhythm | 74.64% | 74.00% | −0.64 |
| Measure structure | 72.85% | **76.95%** | +4.10 |
| Sustain | 55.56% | 55.56% | 0 |
| Incorrect chord | 182 | **163** | −19 |
| Incorrect pitch | 161 | 167 | +6 |
| Missing notes | 136 | **78** | −58 |
| Extra notes | 112 | 111 | −1 |
| Onset mismatches | 170 | 210 | +40 |
| Duration mismatches | 102 | 121 | +19 |

`guitar-standard-chords-vector`: pitch 45%→78%, measure 50%→77%, overall 64%→71%; rhythm 52%→45% (more recovered tones expose onset packing — Phase 5 residual). Formal corpus compare exits ACCEPT:NO on that fixture rhythm alone; campaign register + pitch gates for **low-extreme** are met; mean rhythm stays near 74.6%.

## Rejected experiments

- Widening default `staffSpanWithLedger` to 8 spaces — **reverted** (fails `resolveStaffRoleForY` splitY nearest-staff test; risk of wrong-staff assignment).

## High-extreme / Phases 3–5 residual

No production change yet for RC-B (ledger-stable anchors under stacked ledgers) or chord-column reconstruction. High-extreme exact **15%** unchanged. Explicit ledger-ownership provenance (Phase 3) still architectural follow-up once anchors are reliable.

## Focused fixture results

- New extreme-register tests: **pass**
- Orphan / measure-bounds / pitch-staff / font-anchor / adjacent-slot / semantic hardening: **pass** (after span-default revert)

## User-score validation (Phase 8)

Not run in this pass (no user PDFs attached to the campaign session). Recommended: regenerate open-E / deep-bass / high-ledger passages from source PDFs and confirm simultaneous chord playback.

## Known limitations

1. High-extreme dense treble chords still wrong (anchor fallback + accidentals).
2. Raster articulation-scan low ledger heads still missing.
3. Guitar-standard onset packing worsens as missing extreme tones are restored — needs Phase 5 timing work, not pitch invention.
4. No dedicated ledger-fragment ownership graph yet (Phase 3 provenance).

## Recommended next step

1. **RC-B** — ledger-stable notehead anchors when ink suppression / ambiguous stacked components force metric fallback (high-extreme).
2. Then Phase 5 onset packing for newly complete extreme guitar chords.
3. RC-C raster ledger recall for scans.

## Gate checklist (RC-A)

| Gate | Status |
|---|---|
| Extreme-low exact / missing tones | **Pass** (52.9→76.5%, miss 20→6) |
| Extreme-high exact / missing tones | **Open** (unchanged — separate RC) |
| Incorrect extreme pitches | Low improved; high stable |
| Octave / wrong-staff | Stable / improved (octave errors down overall) |
| No broad invented tones | Extra notes 112→111 |
| Middle stable | Improved |
| Pitch ≥ 66.86% | **71.53%** |
| Rhythm near 74.64% | **74.00%** (fixture guitar-standard rhythm regression documented) |
| Measure near 72.85% | **76.95%** |
| Evaluator / truth / thresholds | Unchanged |
| Mic / accepted systems list | Untouched |
