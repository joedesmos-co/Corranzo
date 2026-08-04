# Phase 3–5: Exclusive Vector Tie Pairing

**Base:** `994dca6`  
**Evaluator:** frozen `2.0.0` / schema `2`  
**Commit message (if gates pass):** `fix(omr): enforce exclusive vector tie pairing`

---

## Summary

Two complementary general fixes landed:

1. **Vector tie pairing** (`detectVectorTies.js`): pitch-aware endpoint selection + exclusive one-to-one ownership in `applyTieMarks`, with ambiguity rejection.
2. **Written tie flag integrity** (`mergeTiedNotesForPlayback.js`): playback sustain no longer mutates `chainHead.tieStop`, which had falsely doubled stop counts in timing-map / recognition summaries.

MusicXML emission for the user corpus was already balanced (`starts === stops`). The 9/9 “start ≪ stop” inventory signal was almost entirely a **playback-merge mutation** of written flags after parse. Exclusive pairing still hardens geometry contests and is covered by new fixtures.

---

## Files changed

| File | Change |
|---|---|
| `src/features/omr/detectVectorTies.js` | Pitch-aware `selectBestCurveEndpointPair`; exclusive `usedSource`/`usedDestination` in `applyTieMarks`; ambiguity margin; span-weighted `matchScore` |
| `src/features/musicxml/mergeTiedNotesForPlayback.js` | Stop mutating written `tieStop` on chain heads during duration merge |
| `tests/detectVectorTies.test.js` | Geometry fixtures + written-flag preservation test |

---

## Recognition rule before / after

### Before
- Each PDF curve independently snapped to nearest start/end note.
- `applyTieMarks` applied every pair; a note could receive multiple unrelated stops/starts.
- `applyTieSustainToNotes` set `chainHead.tieStop = true` when absorbing a continuation → summary counts showed ~0.5 start/stop ratios even when MusicXML was balanced.

### After
- Curve endpoints prefer same-pitch, same-clef, forward-onset attachments (chord members keep separate ties).
- Valid pairs are ranked; each note may be used once as source and once as destination.
- Near-ties for the same endpoint within score margin `6` are **rejected** (no invented tie).
- Playback still merges duration and sets `suppressPlaybackAttack`; written `tieStart`/`tieStop` stay faithful to MusicXML.

---

## Geometry fixtures (unit)

| Case | Result |
|---|---|
| Two curves compete for one source | Keep one clear winner |
| Two curves compete for one destination | Keep one clear winner |
| Valid separate chord-pitch ties | Both applied |
| Same-pitch cross-measure tie | Applied |
| Slur-like different-pitch curve | Slur only, no tie |
| Ambiguous mirrored destinations | Reject both |

---

## User-report before / after (tieStart / tieStop)

Baseline packaged summaries vs re-parsed MusicXML after both fixes (timing-map counts):

| Report | Source | Before | After | XML tags | Δ\|imb\| |
|---|---|---|---|---|---|
| `…-2100` | evangelion | 14/25 | **14/14** | 14/14 | −11 |
| `…-2101` | vivaldi winter | 8/14 | **0/0** | 0/0 | −6* |
| `…-2102` | la-campanella | 6/12 | **6/6** | 6/6 | −6 |
| `…-2106` | merry-go-round | 79/134 | **81/81** | 81/81 | −55 |
| `…-2112` | Ao no Sumika | 91/173 | **96/96** | 96/96 | −82 |
| `…-2113` | jujutsu OP | 12/24 | **12/12** | 12/12 | −12 |
| `…-2114` | iris-out | 24/47 | **24/24** | 24/24 | −23 |
| `…-2116` | sweden-minecraft | 6/12 | **6/6** | 6/6 | −6 |
| `…-2116 (1)` | aria-math | 51/100 | **51/51** | 51/51 | −49 |

\*Vivaldi under Node re-OMR still diverges (fewer notes / no ties vs packaged browser run). Packaged imbalance cleared conceptually; live path needs separate follow-up.

**8/9** packages now show perfect timing-map balance matching MusicXML. Absolute imbalance eliminated on all successfully re-parsed packages.

Pitch-aware selection slightly increased absolute paired ties on merry-go-round (+2) and Ao no Sumika (+5) while remaining 1:1.

---

## Frozen semantic corpus (evaluator 2.0.0 / schema 2)

| Metric | Before (`994dca6`) | After | Δ |
|---|---|---|---|
| Overall | 61.8% | 61.8% | 0 |
| Pitch | 58.5% | 58.5% | 0 |
| Rhythm | 64.5% | 64.5% | 0 |
| Sustain | 46.7% | 46.7% | 0 |
| Articulation | 84.0% | 84.0% | 0 |
| Measure | 65.9% | 65.9% | 0 |
| Interpretation | 13.3% | 13.3% | 0 |

| Defect | Before | After |
|---|---|---|
| incorrect-tie | 7 | 7 |
| missing-tie | 6 | 6 |

No meaningful regression in Pitch, Rhythm, Articulation, Measure, or Interpretation.  
Corpus compare: scoreboard deltas all **0** (no regressions). Incorrect-tie did not increase; missing-tie did not increase. Corpus sustain score unchanged because truth and generated previously shared the same flag-mutation artifact symmetrically.

---

## Playback / note inventory

- Tied continuations still `suppressPlaybackAttack` and absorb duration into the chain head.
- Unit coverage: cross-measure sustain, partial chord ties, written-flag preservation.
- Sounding MIDI / note inventory unchanged for packages where MusicXML note counts matched baseline (deltas only from Vivaldi path divergence and small measure-boundary noise already present at HEAD).

---

## Regressions checked

| Gate | Result |
|---|---|
| Geometry + tie unit tests | PASS |
| Full unit suite | **2722 passed** / 5 skipped (272 files) |
| Production build | **PASS** |
| Semantic corpus vs Phase-2 baseline | No scoreboard regressions |
| User-report re-OMR / re-parse | Imbalance cleared on 8/9 |

---

## Hardcoding audit

- No song names, filenames, page/measure numbers, exact MIDI exceptions, report IDs, or benchmark conditionals added.
- Thresholds are geometric only (`TIE_MATCH_AMBIGUITY_MARGIN = 6`, span weight `0.2`, candidate limit `6`).

---

## Remaining unresolved

1. **Vivaldi (`…-2101`)** Node re-OMR still yields ~half the notes and zero ties vs the packaged browser summary — separate pipeline/path issue.
2. **Corpus sustain 46.7%** (incorrect-tie 7 / missing-tie 6) unchanged — needs dedicated sustain recall work beyond ownership.
3. Secondary packaged signals (accent floods, zero rests, dense chord grouping) not addressed this phase.

---

## Gate decision

**PASS** — commit production fix + tests.

Acceptance:
- Tie imbalance materially improved across user reports: **YES**
- Incorrect ties did not increase: **YES** (7→7)
- Missing ties did not materially increase: **YES** (6→6)
- No meaningful Pitch/Rhythm/Articulation/Measure/Interpretation regression: **YES**
- Playback continuations do not reattack: **YES**
- Unit suite + production build: **YES**
- No song-specific hardcoding: **YES**
