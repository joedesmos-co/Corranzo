# Stacked ledger sharps (guitar-standard m7–m8)

**Date:** 2026-08-04  
**Base for experiment:** post-`7495255` (ink dedupe + beat-1 path keep) at `3ff28ab` lineage  
**Production change:** extend `detectVectorPathAccidentals` Y acceptance with notehead extents (builds on `b3414aa` staffGap pad)  
**Do not touch:** committed ink-dedupe / beat-1 gate from `7495255`

## Verdict

| Question | Answer |
|---|---|
| Root cause | Not path extraction collapse — all 4 m8 sharps already emit as `path-cross` candidates. Measure Y gate (`staffLines ± 30px`) dropped ledger-stack accidentals below the staff. |
| Fixed? | **Yes** — accept path candidates within notehead Y span (+ modest staffGap pad) |
| Pareto | **Accept** — guitar-standard pitch up; dense unchanged vs `7495255` |

## Trace (task 1)

`extractPdfVectorPathSymbolsFromOperatorList` on `guitar-standard-chords-vector.pdf` @ width 1000:

| Region | Candidates |
|---|---|
| m8 stack x≈734 | `op1456` y=719, `op1430` y=745, `op1415` y=765, `op1400` y=791 — **four** separate `path-cross` glyphs |
| m7 C# | `op1161` x=535 y=765 |

Fragment clustering did **not** merge them (complete paths are excluded from fragment seeds since the composite-dedupe work).

`detectVectorPathAccidentals` then filtered by:

```js
candidate.y < measureTop - 30 || candidate.y > measureBottom + 30
```

Guitar system-2 staff band ≈ y 653–706. Only the top m8 sharp (y=719) survived `measureBottom+30≈736`. Lower stack + m7 ledger sharp were silently skipped (no reject diagnostic). Ink fallback also returned 0 on those columns.

**Collapse was acceptance/filtering, not extraction.**

## Fix (task 2)

In `detectVectorPathAccidentals.js` (extend only; leave `7495255` logic intact):

1. Compute `contentTop` / `contentBottom` from staff lines **and** notehead `cy` values.
2. Use `verticalAccidentalPad = max(30, staffGap * 1.75)` beyond that content band.

This keeps one path glyph per stacked sharp without fixture hardcoding. Safer than a large staff-only pad (`staffGap * 8` from `b3414aa`), which could reach toward adjacent systems; note extents stay local to the measure’s heads.

## Tests (task 3)

`tests/omrVectorPathAccidentals.test.js`:

- **New:** `emits one path accidental per vertically stacked complete sharp` — extraction must yield 4 `path-cross`, no cluster merge.
- **Hardened:** `keeps deep ledger-line path sharps below the staff band` — tight `y0/y1`, 4-deep stack, assert glyphs + exclusive 1:1 assignment.

All 26 tests in that file pass.

## Corpus (task 4–5)

Focused `--only guitar-standard-chords-vector,piano-dense-advanced-vector,piano-beginner-single-vector,guitar-paired-chords-vector`

Artifacts: `stacked-sharps.{json,txt}`

### Before (`7495255` / `after-guitar-standard-accidentals`)

| Fixture | overall | pitch | defects |
|---|---:|---:|---:|
| guitar-standard-chords-vector | 0.8389 | 0.9483 (110/116) | 14 |
| piano-dense-advanced-vector | 0.7708 | 0.7326 (211/288) | 130 |
| piano-beginner-single-vector | 0.8281 | 0.9394 | 12 |
| guitar-paired-chords-vector | 0.8234 | 0.8966 | 27 |

m7: `C3` expected `C#3`. m8: `F2/C3/F3` expected `F#2/C#3/F#3` (top `C#4` already OK).

### After (note-extent Y band + current HEAD helpers)

| Fixture | overall | pitch | defects | Δ pitch |
|---|---:|---:|---:|---:|
| guitar-standard-chords-vector | **0.8571** | **1.0000 (115/115)** | **1** | **+5.17pp** |
| piano-dense-advanced-vector | 0.7708 | 0.7326 (211/288) | 130 | 0 |
| piano-beginner-single-vector | 0.8281 | 0.9394 | 12 | 0 |
| guitar-paired-chords-vector | 0.8571 | 1.0000 | 3 | +10.34pp* |

\*Paired pitch 100% also reflects intervening TAB/voice commits (`d255606`, `9b97141`) on this branch; dense flat confirms stacked-Y change did not re-poison dense.

Standard residual: tempo-mismatch only. **No incorrect-pitch on m7/m8.**

### Decision

**Accept.** Standard up, dense no serious regression (identical pitch/defect counts vs `7495255` dense baseline).

Production files ready for parent commit (working tree may hold note-extent refinement on top of `b3414aa`). **Do not revert `7495255`.**

## File pointers

- Production: `src/features/omr/detectVectorPathAccidentals.js`
- Tests: `tests/omrVectorPathAccidentals.test.js`
- Prior context: `tmp/omr-zero-defect/experiments/guitar-standard-accidentals.md`
- Crops: `tmp/omr-zero-defect/experiments/guitar-standard-accidental-crops/`
