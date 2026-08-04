# OMR Semantic Mismatch Root-Cause and Repair Campaign

**Start commit:** `48757fc` — exclusive vector tie pairing  
**Evaluator:** frozen **2.0.0** / schema **2** (unchanged)  
**Final production commit:** `2f82df8` — improve semantic note and rhythm recognition

---

## Original baseline (`48757fc` / Phase-2 freeze)

| Metric | Score |
|---|---|
| Overall | **61.8%** |
| Pitch | 58.5% |
| Rhythm | 64.5% |
| Sustain | 46.7% |
| Articulation | 84.0% |
| Measure Structure | 65.9% |
| Interpretation | 13.3% |

| Defect | Count |
|---|---|
| duration-mismatch | 280 |
| incorrect-chord | 217 |
| missing-note | 209 |
| extra-note | 198 |
| onset-mismatch | 193 |
| incorrect-pitch | 179 |
| incorrect-tie | 7 |
| missing-tie | 6 |

---

## Phase 1 — Inventory

Artifacts:
- `tmp/omr-semantic-repair/mismatches.json`
- `tmp/omr-semantic-repair/mismatches.csv`
- `tmp/omr-semantic-repair/PHASE_1_MISMATCH_INVENTORY.md`
- Generated MusicXML + semantic JSON under `tmp/omr-semantic-repair/generated/`

**810** structured note-level mismatches exported (expected/generated pitch, onset, duration, staff, voice, chord midis). OMR geometry provenance is not on MusicXML notes; pipeline stage inferred for ranking, then confirmed by code trace.

---

## Phase 2 — Clusters

See `PHASE_2_ROOT_CAUSE_CLUSTERS.md`.

| Rank | Mechanism | Volume | Fixtures | Status |
|---|---|---|---|---|
| 1 | Gap stretch overwrites filled-head enrich (quarter→half) | High | 8 | **Repaired** |
| 2 | Gap packing collapses quarters; quarter floor blocked by event duration gate | High | 8 | **Repaired** |
| 3 | Chord coalesce / dense onset resnap cascade | High | 7 | Deferred (high blast radius) |
| 4 | Missing accidental glyphs in vector text layer (±1 F#→F) | High | 6 | **Blocked** — needs path/ink accidental primitive |
| 5 | Voice/onset resnap (0.25/0.5) | High | 8 | Deferred |
| 6 | True notehead miss / alignment symptom | Medium | many | Deferred |

---

## Production changes

### Repair 1 — Filled-head written duration cap
**File:** `src/features/omr/processVectorOmrPage.js`  
**Rule:** Unbeamed filled heads with stem + enrich `durationDivisions` must not be stretched past that written value (`filledHeadWrittenDurationCap`), mirroring open-head/dot caps.

### Repair 2 — Recover gap-collapsed quarters
**File:** same  
**Rule:** `hasConfidentQuarterInference` trusts stem+enrich quarter evidence even when the event was already packed to an eighth, so same-clef span can restore a written quarter.

### Tests
`tests/omrVectorRhythm.test.js` — geometry fixtures for both rules; subdivision-run guard retained.

### Preserved
Exclusive vector tie pairing (`detectVectorTies` / `mergeTiedNotesForPlayback`) untouched.

---

## Rejected / deferred experiments

| Idea | Why not |
|---|---|
| Retune `assignLocalAccidentals` | Corpus PDFs have **zero** SMuFL accidental glyphs; binder never runs |
| Invent sharps from pitch heuristics | Forbidden (no evidence); would fabricate alters |
| Widen `OMR_CHORD_MERGE_X` / disable dense onset resnap | High risk of merging independent voices; needs dedicated fixtures |
| Path/ink accidental candidates | Correct next primitive, but larger scope than this campaign’s accepted repairs |

---

## Before / after — evaluator scoreboard

| Metric | Before | After | Δ |
|---|---|---|---|
| Overall | 61.8% | **62.2%** | **+0.4** |
| Pitch | 58.5% | 58.6% | +0.1 |
| Rhythm | 64.5% | **67.1%** | **+2.6** |
| Sustain | 46.7% | 46.7% | 0 |
| Articulation | 84.0% | 84.0% | 0 |
| Measure | 65.9% | 65.9% | 0 |
| Interpretation | 13.3% | 13.3% | 0 |

Corpus compare: **ACCEPT: YES** (no category regressions).

---

## Before / after — mismatch counts

| Defect | Before | After | Δ |
|---|---|---|---|
| duration-mismatch | 280 | **240** | **−40** |
| incorrect-chord | 217 | 217 | 0 |
| missing-note | 209 | 208 | −1 |
| extra-note | 198 | 197 | −1 |
| onset-mismatch | 193 | 193 | 0 |
| incorrect-pitch | 179 | 180 | +1 (noise) |
| incorrect-tie | 7 | 7 | 0 |
| missing-tie | 6 | 6 | 0 |

---

## Per-fixture highlights

| Fixture | Notable change |
|---|---|
| piano-grand-voices-vector | overall 70.4%→72.3%; rhythm 76%→89% |
| guitar-paired-chords-vector | rhythm 81%→89% |
| guitar-standard-chords-vector | rhythm 47%→49% |
| Others | Stable or tiny gains |

---

## Real-world report spot check

| Score | Notes | Ties | Rests |
|---|---|---|---|
| Sweden | 277→277 | 6/12→**6/6** | 0→0 |
| Jujutsu OP | 1050→1050 | 12/24→**12/12** | 3→3 |
| Ao no Sumika | 1123→1123 | 91/173→**96/96** | 16→19 |

Tie balance preserved/improved. No catastrophic note-count swings on sampled packages.

---

## Gates

| Gate | Result |
|---|---|
| Evaluator 2.0.0 / schema 2 frozen | PASS |
| 9/9 semantic fixtures | PASS |
| Overall > 61.8% | PASS (62.2%) |
| No meaningful unrelated regressions | PASS |
| Tie counts balanced | PASS |
| No filename/fixture hardcoding | PASS |
| Full unit suite | **2725 passed** |
| Production build | PASS |
| Ownership / guitar / acceptance / ties / vector rhythm tests | PASS |

---

## Remaining limitations

1. **Accidentals absent from vector text layer** — dominant ±1 pitch / incorrect-chord driver on grand-voices & dense fixtures. Next primitive: path/ink accidental candidates → existing `assignLocalAccidentals`.
2. **Dense chord onset resnap** still cascades incorrect-chord + missing/extra + duration on `piano-dense-advanced-vector` / articulation-scan.
3. **Onset 0.25/0.5** mismatches largely untouched.
4. **Interpretation** (tempo/repeat/volta) unchanged at 13.3%.
5. Sustain recall (missing/incorrect-tie 6/7) unchanged beyond prior exclusive-pairing work.

## Recommended next recognition primitive

**Non-text accidental detection** (PDF path fills or left-of-head ink) feeding the existing accidental binder — highest-impact unfinished pitch/chord cluster with clear musical evidence and no song-specific rules.
