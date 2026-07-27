# Corranzo OMR Quality Campaign — Combined Report

Date: 2026-07-27  
Working tree: continued from Codex mid-phase state (Phase 1 beam candidate not
yet accepted at handoff). Unrelated dirty-worktree edits left untouched.

## Starting baseline

Frozen evaluator authority on 12 sources (written mode; 1 page for sprint-5 /
fixtures; 2 pages for Campanella, Fantaisie, Moonlight 3, Hungarian, Carol):

| Metric | Baseline |
| --- | --- |
| wrongNoteDuration | 418 |
| wrongRestDuration | 2 |
| missingRest (aligned taxonomy) | 66 |
| inventedRest | 1 |
| denseChordSeparation (evaluator bucket) | 190 |
| tupletGrouping (aligned) | 12 |
| correct beam signatures (raw) | 6 |
| beam mismatches (raw) | 257 |

Artifacts: `tmp/omr-quality-campaign/baseline/`.

---

## Phase 1 — Primary beam topology: **ACCEPTED** (narrowed + browser review)

Provisional product accept after manual browser review (2026-07-27) on Carol,
Evangelion, Fantaisie-Impromptu, Guitar standard chords, and
piano-articulation-scan. See `phase1-manual-review/MANUAL_REVIEW.md`.
`MIN_DURATION_OVERRIDE_CONFIDENCE = 0.9` is frozen. Phases 2–5 stay no-ship.

### Root cause

The vector beam/stem graph already reconstructed reliable primary beam
topology but stayed diagnostic-only. Later duration-floor logic promoted
visually beamed notes back to quarters.

### Method shipped

- `applyVectorPrimaryBeamTopology` → written durations + beam begin/continue/end
- Beam-group boundary gating in `buildOmrMusicXml` (`eventsShareBeamTopology`)
- **Narrowing during audit:** `MIN_DURATION_OVERRIDE_CONFIDENCE = 0.9` (grouping
  still at 0.7). Fixes guitar-standard-chords flag-bridge false duration rewrite
  at confidence 0.86 while keeping Carol/Evangelion fixes at 0.92.

### Reverted / rejected during audit

- Pre-gate candidate without 0.9 duration gate (guitar rhythm regression).
- Accepting raw `falseBeamedNotes +7` without chord-normalized audit (metric
  artifact from MusicXML chord beam encoding + tone order).

### Before / after (12-source aggregate)

| Metric | Baseline | Candidate | Δ |
| --- | --- | --- | --- |
| wrongNoteDuration | 418 | 412 | **−6** |
| wrongRestDuration | 2 | 2 | 0 |
| missingRest | 66 | 66 | 0 |
| inventedRest | 1 | 1 | 0 |
| denseChordSeparation | 190 | 190 | 0 |
| tupletGrouping | 12 | 12 | 0 |
| correct beam signatures (raw) | 6 | 144 | +138 |
| beam mismatches (raw) | 257 | 119 | −138 |
| falseBeamedNotes (raw) | 0 | 7 | +7* |

\*After chord-normalized audit: false beams 2→3 (+1 label only); visual PDF
crops confirm printed beams, not invented noise. Evangelion −3 missing-dot;
Carol −3 duration-mismatch. Pitch inventory, attack order, playback 100%,
frozen notation semantics unchanged.

### Production files

- `src/features/omr/applyVectorBeamTopology.js` (new)
- `src/features/omr/processVectorOmrPage.js` (wire + dead-code cleanup)
- `src/features/omr/buildOmrMusicXml.js` (beam boundary)
- `tests/vectorBeamTopology.test.js`
- `scripts/omr-quality-campaign-probe.mjs`

Details: `attempts/phase1-primary-beam/ACCEPTANCE.md`.

---

## Phase 2 — Chord/event structure: **NO PRODUCTION CHANGE**

Recomputed evaluator chord-integrity on 188 `incorrect-chord` examples.

| Class | Count | Nature |
| --- | --- | --- |
| pitch-substitution | 99 (53%) | Pitch/register — not structure |
| sequentialized/merged candidates | 66 | All collapsed on inspection (rhythm span, under-detection, raster noise, measure misalignment) |
| missing/extra tone | 12 | Detection |
| voice-ownership | 6 | Voice numbering |

**Zero** cases of chord tones emitted sequentially or sequential notes falsely
merged into chords. Old “dense chord separation: 149/190” bucket is misleading.
Voice collapse exists (Hungarian m5) but is architectural; only 7/188 examples
in truth-multi-voice measures.

Report: `attempts/phase2-chord-taxonomy/REPORT.md`.

---

## Phase 3 — Visible rests / voice gaps: **NO PRODUCTION CHANGE**

Raw missing-rest counts are dominated by unmatched measures (e.g. Campanella
289/289 unmatched). Aligned residual ~66.

| Finding | Decision |
| --- | --- |
| Gymnopédie 25/31 glyphs skipped `overlaps-staff-notes` | Bass notes occupy from div 0 — no staff gap; inserting rest requires shifting notes (forbidden) |
| Campanella nearest-gap recovery | Gaps far from glyph column / multi-voice; unsafe |
| Carol empty bass staves | **0** SMuFL rest glyphs; whole-rest synthesis without glyphs reintroduces phantoms |
| Multi-voice voice-rests | Needs per-voice attachment (architecture) |

Glyph detector already applies safely when a clear same-staff gap exists
(Minecraft 3/3). Report: `attempts/phase3-visible-rests/REPORT.md`.

---

## Phase 4 — Tuplets: **NO PRODUCTION CHANGE**

Aligned residual **exactly 12**, all Fantaisie Impromptu m4 (`expected 6:4`).
piano-rhythm-tuplets-vector remains **0** tuplet-mismatch (10→0 gain preserved).

Nearby PDF `6` glyphs are metronome **66**, not tuplet numbers. Digit-gated
3:2 recovery correctly refuses (`insufficient-digits`). Inventing 6:4 from
column count alone, or treating metronome digits as tuplet evidence, rejected.
Evaluator exact-key `6:4`≠`3:2` is frozen.

Report: `attempts/phase4-tuplets/REPORT.md`.

---

## Phase 5 — Raster triage: **NO PRODUCTION CHANGE**

Only `piano-articulation-scan` is pure raster (empty text layer). Rebuilt
taxonomy: **219** defects (brief’s “~59” does not match current reports).

| Bucket | Count |
| --- | --- |
| Articulation misses | 49 |
| Note invent/miss structure | 48 |
| Rhythm | 43 |
| Pitch/register | 42 |
| Chord-label | 33 |
| Sustain | 4 |

Generated note count 111 vs truth 88 (over-detection). Identical to baseline
after Phase 1. No safe edit without risking articulation/sustain TPs. Did not
reopen on-line chord separation.

Report: `attempts/phase5-raster-triage/REPORT.md`.

---

## Combined before / after defect counts

Authority: Phase 1 comparison aggregate (aligned taxonomy) + phase audits.

| Metric | Start | End | Shipped change? |
| --- | --- | --- | --- |
| wrongNoteDuration | 418 | 412 | Yes (Phase 1) |
| Beam signature recovery (raw correct) | 6 | 144 | Yes (Phase 1) |
| wrongRestDuration | 2 | 2 | No |
| missingRest | 66 | 66 | No |
| inventedRest | 1 | 1 | No |
| denseChordSeparation bucket | 190 | 190 | No (misleading; not a structure defect) |
| tupletGrouping aligned | 12 | 12 | No (Fantaisie 6:4, no safe evidence) |
| Raster articulation-scan total | 219 | 219 | No |

### Per-piece Phase 1 material wins

- **Evangelion:** −3 missing-dot (beamed dotted-eighths)
- **Carol of the Bells:** −3 duration-mismatch; large beam-tag recovery
- **Others (12-source set):** no wrong-duration regression; playback stable

---

## Visual gallery / MusicXML examples

- `attempts/phase1-primary-beam/evidence/carol-m14-gallery.png`
- Carol PDF system crops under `evidence/`
- Guitar flag-bridge: `evidence/guitar-standard-chords-top.png`
- MusicXML: `attempts/phase1-primary-beam/generated/*.musicxml` vs `baseline/generated/`

---

## Non-regression evidence

| Gate | Result |
| --- | --- |
| `tests/vectorBeamTopology.test.js` (6) | pass |
| Notation Fidelity Sprints 2–5 | pass (re-run 2026-07-27) |
| Musical Structure Sprint 1 | pass |
| `detectVectorRests` / `recoverDigitGatedTriplets` | pass |
| Frozen semantic corpus vs dense-rhythm-after | class deltas 0 (Phase 1 ACCEPTANCE) |
| Playback class on 12 sources | 100% unchanged |
| Production build | pass (Phase 1 ACCEPTANCE) |
| Targeted lint on Phase 1 files | clean |
| Full vitest (Phase 1 ACCEPTANCE) | 2636 pass / **9 fail** — same pre-existing dirty-worktree failures, A/B verified unrelated to beam wiring |

### Unrelated dirty-worktree note

The worktree contains many non-campaign modifications (App/practice/playback/
import/docs/etc.). This campaign only owns the Phase 1 beam files above plus
tmp audit scripts/reports. The nine known test failures are **not** claimed as
introduced or fixed by this campaign.

---

## Attempted methods summary

| Phase | Attempt | Outcome |
| --- | --- | --- |
| 1 | Promote beam topology → durations + tags | **Accepted** after 0.9 duration gate |
| 1 | Pre-gate without duration gate | **Reverted** (guitar regression) |
| 2 | Chord tolerance / sequential merge fixes | **Not shipped** (no real structure defect) |
| 3 | Empty-staff whole rests without glyphs | **Rejected** |
| 3 | Nearest-gap rest when preferred overlaps notes | **Rejected** (wrong placement / no gap) |
| 4 | 6:4 from digit `6` / column count | **Rejected** (metronome 66 / invention) |
| 5 | Raster notehead/articulation tweaks | **Not attempted** (safety bar) |

---

## Remaining prioritized backlog

1. **Opening-bass onset grid** so printed leading rests have a staff gap (Gymnopédie).
2. **Per-voice** rest/note ownership (multi-voice staves).
3. **Fantaisie 6:4** with bracket/path evidence (not metronome digits); optional evaluator 3:2↔6:4 equivalence (product decision).
4. **Measure-length / time-signature** inflation (Hungarian 2/4→4-quarter) — dominates many buckets.
5. **Dense-fixture under-detection** (`piano-dense-advanced-vector`).
6. **Raster notehead precision/recall** sprint with articulation TP freeze.
7. **Carol path/ink rests** (no SMuFL rest text).
8. Stop chasing unmatched-measure missing-rest / tuplet-mismatch raw totals.

---

## What improved / unchanged / misleading / unfixable

- **Improved:** beamed written durations (−6); primary beam MusicXML recovery (+138 correct signatures); guitar-safe duration gate.
- **Unchanged:** rests, tuplets, chord structure, raster, pitch inventory, playback signatures, invented rests.
- **Misleading:** evaluator `incorrect-chord` / dense-chord-separation; raw falseBeamedNotes before chord-normalization; raw missing-rest/tuplet counts on unmatched measures; brief’s “~59 raster defects” vs current 219.
- **Unfixable safely here:** multi-voice rests, Fantaisie 6:4 without tuplet-number evidence, Carol glyph-absent rests, raster over-detection without a dedicated sprint.

OMR is not “fixed.” One production change shipped (Phase 1 beam topology with
confidence narrowing). Phases 2–5 are evidence-backed no-ops that prevent
unsafe follow-on edits.
