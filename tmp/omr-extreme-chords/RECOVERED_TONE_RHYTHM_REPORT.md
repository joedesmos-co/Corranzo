# Recovered-tone rhythm integration — campaign report

- Base commit: `d8016e2` — `fix(omr): improve extreme-register chord recognition`
- Follow-up: integrate recovered ledger tones into rhythm packing
- RC-B (high-extreme): **not started**

## Phase 1 — Regression trace

Artifact: `RECOVERED_TONE_RHYTHM_TRACE.md`

Recovered open-E / deep-ledger tones already joined their visual chord columns
(`fragmentedOnsetCount: 0`). The Guitar-standard Rhythm drop (52% → 45%) was not
orphan splitting, TAB duplication, or joint-polyphonic retiming.

**First failing transition:** dense position snap parked chord columns on a late
first-beat onset (`≈0.16` → startDiv `2`/`3`), and `alignOpeningGroupStart` left
the whole shared grid delayed. RC-A then scored many more onset mismatches on
those delayed columns.

## Phase 2 — Narrow fix

In `src/features/omr/processVectorOmrPage.js`:

1. **`alignOpeningGroupStart`** — for sparse chord-column packs (`groups.length ≤ beats+2`)
   with a multi-note opening inside the first beat, translate the full onset grid
   to the barline (eighth-floor when dense snap lands on an odd sixteenth).
2. **`alignOpeningEventStarts`** — re-apply after beam onset resnap when the opening
   is still a delayed chord column.
3. **`refineSparseChordColumnStarts` / `Onsets`** — for the common beats+1 chord-chart
   shape, expand a compressed post-align tail onto `[0,2,4,8,12]` in 4/4 so later
   columns do not steal truth onsets.

Guards: opening must be a chord; dense tuplet textures (`> beats+2` attacks) are
untouched; ambiguous single orphans are not force-merged; RC-A pitch/windows
unchanged.

## Phase 3 — Tests

`tests/omrRecoveredToneRhythm.test.js` covers:

- recovered low / open-E tones sharing chord onset
- multi-ledger tones moving as one event
- independent bass remaining separate
- opposing Guitar voices remaining separate
- TAB/string metadata preserved; no notation+TAB duplicate
- no dense-rhythm collapse; duration retained through packing
- ambiguous orphan rejected
- sparse chord-column refine unit cases

## Phase 4 — Validation vs `d8016e2`

| Gate | Required | Result |
|---|---|---|
| low-extreme exact | ≥ 76.5% | **76.47%** (13/17) |
| low-extreme missing tones | ≤ 6 | **6** |
| mean Pitch | ~71.5% | **72.4%** |
| incorrect-chord | ≤ 163 | **159** |
| missing notes | ≤ 78 | **73** |
| extra notes | ≤ 111 | **106** |
| Guitar-standard Rhythm | ≥ pre-RC-A (~52%) | **100%** (was 45%) |
| mean Rhythm | stable/up | **74.0% → 80.2%** |

Frozen corpus compare: **ACCEPT: YES**

Guitar-standard: overall **81.3%**, Pitch **86%**, Rhythm **100%**, notes still **115**,
open-E stacks retained (e.g. m8 `[40,47,52,55,59,64]` at startDiv 0).

Piano-tuplets unchanged (Pitch 91%) after sparse-pack gating.

### Suites

- focused extreme-register + recovered-tone + vector rhythm: pass
- frozen semantic corpus 9/9: pass, ACCEPT:YES
- full unit suite: **281 files / 2838 tests** pass
- production build: pass
- Guitar/TAB, joint polyphonic, playback, mic, report/export, dense/hard PDF perf: pass

## Decision

**ACCEPT** — commit `fix(omr): integrate recovered ledger tones into rhythm packing`

Do not begin high-extreme RC-B in this follow-up.
