# guitar-standard-chords-vector accidental defects

**Baseline HEAD for ledger:** `934f011`  
**Fixture:** `benchmarks/omr-fixtures/guitar-standard-chords-vector/`  
**Ledger:** `tmp/omr-zero-defect/head-ledger-934f011/`  
**Key signature:** C major (`fifths=0`)  
**Date:** 2026-08-04

## Verdict

| Question | Answer |
|---|---|
| Root cause | Two coupled bugs in `detectVectorPathAccidentals` (not measure-state math itself) |
| Fixed in production? | **No** — attempted fix `7495255` helped this fixture but failed strict Pareto (piano-dense +1 incorrect-pitch); production files restored to `934f011` content in the working tree |
| Residual after attempted fix | m7 C#3 and m8 F#2/C#3/F#3 still missing (path/ink non-detection on dense ledger stacks) |

## Defect inventory at 934f011

From `PHASE_1_MISMATCH_INVENTORY.md` / `mismatches.csv`:

- **12 incorrect-pitch**, **9 incorrect-chord** (plus rhythm noise on m8)
- m1: F#4 → F4 (missing sharp)
- m6: E3→F3 and A3→A#3 repeatedly (sharp bleed + measure carry)
- m7: C#3 → C3 (missing sharp)
- m8: F#2 / C#3 / F#3 → naturals (missing sharps); C#4 often correct

Truth (MusicXML) for the chromatic cells:

| Measure | Relevant chords |
|---|---|
| m1 | … **F#4** A4 … |
| m6 | A2 E3 A3 \| B2 **F#3** \| A2 E3 A3 … |
| m7 | B2 D3 G3 B3 \| **C#3** E3 A3 … |
| m8 | E2…E4 \| **F#2 C#3 F#3** A3 **C#4** … |

## Stage trace (first incorrect stage)

### m6 sharp bleed — first bad stage: `accidental_state` (ownership)

Evidence from `pitch_error_inventory.json`:

- Staff position / natural MIDI correct before alteration (`naturalMidi` 52 for E3, 57 for A3).
- Opening attachments show `localAccidental: "sharp"`, `accidentalSource: "vector-ink"`.
- Later repeats show `localAccidental: null` + `measureAccidentalState: 1` (carry of the bad local).

`measures[5].accidentalDiagnostics` at 934f011:

- `pathInk`: **pathCandidates=0**, **inkCandidates=3**, **accepted=3**, 1 path rejected as `key-signature-region`
- Three **identical** ink glyphs at `(339, 745.5)` / bounds `328–350 × 736–755`, reason `ink-sharp-cross`
- `selectedAttachments` assigned that one blob to **three** notes:
  1. F3 @ cx≈364 (correct owner for truth F#3) score 32.47, residual 1px
  2. E3 @ cx≈346 score 52.03, residual 6px ← bleed
  3. A3 @ cx≈346 score 112.03, residual 14px ← bleed

Mechanism:

1. m6 is early in system 1; `playableX0` inset rejects the real **vector-path** sharp (`candidate.x < playableStart - 2` → `key-signature-region`).
2. Ink fallback scans **per note**; A3/E3/F3 all see the same left-of-stack sharp blob → **three synthetic glyphs**.
3. `assignLocalAccidentals` is exclusive per glyph/note but not per physical blob → greedy attach of all three.
4. `resolveNotePitchWithMeasureState` then carries sharp on E and A for the rest of the measure.

**Not** a bug in carry rules themselves; carry faithfully propagates poisoned locals.

### m1 / m7 / m8 missing sharps — classifier says `pitch_mapping`; true first failure is accidental detection/attachment

Ledger stages:

- m1/m7/m8: `firstPipelineStageWhereDivergenceAppears.stage = pitch_mapping` with evidence “Detector natural MIDI already differs from expected (altered) MIDI.”
- `pitchAlteration.localAccidental` is **null** everywhere for these misses.

So the stage tag is a **symptom**: natural staff step is correct; the sharp never attached. Real first failure:

| Measure | Diagnostics (934f011) | Visual |
|---|---|---|
| m1 | path/ink accepted **0**; 1 path rejected `key-signature-region` | Sharp clearly left of F#4 in top-staff crop |
| m7 | accepted **0**; 4 paths rejected `key-signature-region` | Sharp present on C#3 chord (ledger stack) |
| m8 | **1** path attached (C#4 @ midi 60); lower sharps absent; 6 paths rejected `key-signature-region` | Dense vertical stack of four sharps |

`key-signature-region` gate (pre-fix):

```js
if (candidate.x < playableStart - 2) {
  diagnostics.rejected.push({ id, reason: 'key-signature-region' })
  continue
}
```

`playableX0` for system-first spans is inset (`buildOmrMeasureGrid.js`: up to 0.085 page / 34% of first span). With `fifths=0` there is no key signature, yet beat-1 / early-column accidentals still sit left of that cursor and are discarded. Ink does not always recover them (m1/m7; partial m8).

## PDF visual audit

Crops under `tmp/omr-zero-defect/experiments/guitar-standard-accidental-crops/`:

- `m1.png` — single sharp aligned to F space before the F#4/A4 dyad
- `m6.png` — single sharp aligned to F ledger / middle tone of the F#-bearing column (truth: second chord B2+F#3)
- `m7.png` — sharp on C# in the ledger chord
- `m8.png` — four stacked sharps before the dense chord; only the top (C#4) was owned by the pipeline at 934f011
- `annotated.png` — overlay of diagnostic sharp/note centers

## Code pointers

| Area | File |
|---|---|
| Local attach + diagnostics | `src/features/omr/omrPitchAlteration.js` (`assignLocalAccidentals`, `accidentalMatchWindow`) |
| Path/ink detect, key-sig gate, ink emit | `src/features/omr/detectVectorPathAccidentals.js` |
| Path calibration | `src/features/omr/accidentalPathCalibration.js` |
| Raster accidental path (separate) | `src/features/omr/detectOmrAccidentals.js` |
| Measure playable inset | `src/features/omr/buildOmrMeasureGrid.js` (`spansToMeasureBoxes`) |
| Vector measure wiring | `src/features/omr/processVectorOmrPage.js` (`detectVectorPathAccidentals` → `assignLocalAccidentals` → `resolveNotePitchWithMeasureState`) |
| Tests | `tests/omrVectorPathAccidentals.test.js`, `tests/omrPitchAlteration.test.js` |

## Prior experiments (do not repeat)

Checked under `tmp/omr-zero-defect/experiments/`:

| Label | Relevance |
|---|---|
| `paired-chord-accidental-owner` | Scan-piano ownership probe @ `2366c37`; not this vector guitar fixture |
| `accidental-fragment-ownership` | Scan-piano; pitch 92% on articulation scan only |
| `raster-accidental-ownership-preserving-lanes` | Raster/scan lane work |
| Gap/TAB measure experiments | Leave guitar-standard pitch at ~88% / 81.8% overall; do not address ink dedupe or playableStart |

No prior rejected experiment already shipped the ink-blob dedupe + beat-1 path keep pairing; that combination was new in `7495255`.

## Attempted fix (`7495255`) — rejected on Pareto

**Change:** in `detectVectorPathAccidentals.js`

1. Keep left-of-`playableStart` path candidates when some notehead in the measure can own them (still reject true key-sig orphans).
2. Dedupe near-identical `vector-ink` glyphs; keep the vertically nearest note’s copy.

**Unit tests:** 164 guitar/accidental-related tests passed on the fix; focused accidental tests passed after revert as well.

**Focused corpus** (`--only guitar-standard-chords-vector,guitar-paired-chords-vector,piano-dense-advanced-vector,piano-beginner-single-vector`), artifacts:

- `tmp/omr-zero-defect/experiments/after-guitar-standard-accidentals.json`
- `tmp/omr-zero-defect/experiments/after-guitar-standard-accidentals.txt`

| Fixture | 934f011 overall / pitch / defects | After 7495255 | Δ |
|---|---|---|---|
| guitar-standard-chords-vector | 0.8179 / 0.8793 / 27 | **0.8389 / 0.9483 / 14** | +2.1pp / +6.9pp / −13 |
| guitar-paired-chords-vector | 0.8234 / 0.8966 / 27 | same | 0 |
| piano-beginner-single-vector | 0.8281 / 0.9394 / 12 | same | 0 |
| piano-dense-advanced-vector | 0.7713 / 0.7361 / 129 | **0.7708 / 0.7326 / 130** | −0.05pp / −0.35pp / **+1** |

Dense regression detail: pitch 212/288 → 211/288; m5 gained an extra incorrect-pitch (`C#5` expected `C5`) — consistent with over-keeping a left-of-playable path sharp.

**Decision:** not Pareto → **fully reverted** working-tree copies of:

- `src/features/omr/detectVectorPathAccidentals.js`
- `tests/omrVectorPathAccidentals.test.js`

back to `934f011` content. Commit `7495255` may still be on `main` history behind later commits (e.g. `3ff28ab`); parent should `git revert 7495255` (or equivalent) if HEAD still contains that patch.

After the attempted fix, guitar-standard residual was mainly **m7 C#3** and **m8 F#2/C#3/F#3** (stack detection), not m6 bleed / m1 miss.

## Recommended next experiment (not implemented)

Separate the two concerns so dense key-like columns do not regress:

1. **Ink dedupe alone** (nearest-note single glyph per blob) — should kill m6 bleed with low risk; validate on dense first.
2. **Beat-1 path keep** only when `fifths===0` **or** when the candidate is within accidental match window of a note whose x is inside the measure’s note column (stricter than “any note can own”).
3. For m7/m8 stacks: path extraction / ink classification under ledger lines (separate from ownership).

## File pointers summary

- Ledger: `tmp/omr-zero-defect/head-ledger-934f011/{PHASE_1_PITCH_ERROR_INVENTORY.md,pitch_error_inventory.json,generated/guitar-standard-chords-vector.pipeline.json}`
- Crops: `tmp/omr-zero-defect/experiments/guitar-standard-accidental-crops/`
- Corpus after attempted fix: `tmp/omr-zero-defect/experiments/after-guitar-standard-accidentals.{json,txt}`
- This note: `tmp/omr-zero-defect/experiments/guitar-standard-accidentals.md`
