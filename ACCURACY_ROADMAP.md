# Corranzo Accuracy Roadmap

**Date:** 2026-07-02
**Scope:** Planning only — no runtime changes were made in this pass.
**Covers:** OMR engine, mic input, MIDI input, Wait For You matching/advance.

Every claim below is grounded in the current benchmark dashboard
(`tmp/omr-benchmark-dashboard/report.md`, generated 2026-07-01), the engine
checkpoint docs (`OMR_ENGINE.md`, `MIC_INPUT_REPORT.md`), and a source audit of
the input/matching modules. File references are given so the next session can
jump straight in.

---

## 1. OMR engine — current state

Benchmark snapshot (2026-07-01, vector path):

| Fixture | Pitch | Duration | Onset | Chord | F1 | Residual errors |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Gymnopédie (clean) | 100% | 100% | 100% | 100% | 100% | none — regression guard |
| Cruel Angel (dense) | 94% | 96% | 96% | 94% | 99% | 147 pitch, 93 duration, 94 onset, 175 chord; top category: **rhythm-inference** |
| Twinkle (legacy font, beginner) | 100% | 97% | 93% | 100% | 100% | one eighth-run measure (m10) — rhythm grid, not detection |

Audit findings by requested area:

- **Ties/slurs.** Tie detection was rewritten (column-coverage arc detector,
  `detectVectorTies.js`): false positives are at 0 on Twinkle, but **real-tie
  recall on Gymnopédie is 6 of 14**. Slurs are not modeled at all — the same
  arc geometry read as a tie would produce a wrong sustain, and multi-note
  slurs are currently invisible. This is the clearest measurable OMR gap.
- **Rhythm.** The dominant dense error category. Note *detection* is
  essentially solved (noteΔ −3 of 2810); remaining wrong durations/onsets come
  from event/voice interpretation. Beam/stem evidence is strong (stem
  attachment 99.96%) but two beam-ownership simulations both regressed
  duration slightly and were correctly not promoted (`OMR_ENGINE.md`,
  "Beam Ownership Simulation Outcomes"). Written-vs-sounding duration is still
  one field in the internal model — called out in the checkpoint doc as a
  prerequisite for any beam-driven duration edit.
- **Pitch.** 94% dense, 100% clean/simple. The checkpoint doc's diagnosis:
  many dense "pitch" errors are grouping artifacts (wrong event/chord
  membership), not staff-step mapping errors. Pitch work should wait until
  grouping improves, or it will chase phantoms.
- **Duplicate/extra notes.** Solved to within −3 notes on dense via spatial
  dedupe (`omrNoteDedupe.js`) and orphan reassignment
  (`vectorOrphanNoteheads.js`). No action needed beyond keeping the guards.
- **Simple beginner PDFs.** The legacy MScore-font path
  (`normalizeLegacyMusicFontGlyphs.js`) took Twinkle from pitch 30%/142 notes
  to 100%/86 exact. The raster/scanned fallback remains weak — but scanned
  input is a different product tier; the vector path covers musescore-style
  beginner PDFs, which is the actual beginner corpus.

**Structural gap:** benchmark fixtures live in `~/Downloads` (see dashboard
report paths). They are not in the repo, so the accuracy suite is
single-machine and can silently rot.

## 2. Mic input — current state

Modules: `pitchDetection.js` (plain autocorrelation, monophonic; clarity
floors 0.12 detect / 0.28 accept), `noteStabilizer.js` (attack-transient skip,
stable-hold window, octave-glitch suppression, silence gap before re-trigger),
`micCalibration.js` (~1s room sample → noise gate + status), cents-tolerant
matching (±30¢ default, clamped 15–50).

- **Pitch detection reliability.** Fine for single notes in the tested
  (synthesized) conditions. `MIC_INPUT_REPORT.md` is honest that no live-mic
  corpus exists: *"verified deterministically with synthesized tones… I can't
  drive a live mic here."* There is no recorded-audio regression suite — the
  biggest measurement gap in the whole accuracy program.
- **Note/chord recognition.** Chords are **not** detected polyphonically. A
  chord checkpoint in mic mode uses sequential collection
  (`waitForYouMicChordCollection.js`): one stable pitch at a time within a
  3.5s window, 2 stable hits per note, or single-tone `bass`/`top` shortcut
  modes. A beginner playing the chord *as a chord* feeds the autocorrelator a
  mixed spectrum; the strongest partial wins or nothing passes clarity. This
  is the largest real-world mic failure mode for piano.
- **Calibration.** Reasonable design (quiet/noisy/no-input states seed the
  gate immediately). Not re-run after the first second — a room that gets
  noisy mid-session only surfaces through signal-quality status.
- **False negatives.** The stabilizer's stability window + clarity floor +
  cents tolerance stack multiplicatively; each is individually sane but there
  is no measured false-negative rate. Needs a labeled recording corpus before
  tuning anything.
- **Noisy rooms.** Calibration raises the gate and reports "Room is noisy";
  behavior beyond that is untested against real recordings.

## 3. MIDI input — current state

Modules: `parseMidiMessage.js` (note-on/off incl. velocity-0 note-ons),
`webMidiEngine.js` (held-note list), `useWaitForYouMidiInput.js` →
`waitForYouNoteMatch.js`.

- **Chord grouping.** Musical-event buffer window default **180ms measured
  from the first matched note** (`resolveMusicalEventWindowMs`,
  `ensureMusicalEventWindow`). A beginner rolling a 3-note chord slower than
  180ms total gets the buffer wiped by the timeout and must replay the whole
  chord. Duplicate re-strikes of an already-matched note are tolerated
  (no false "wrong"), and a wrong note does not wipe progress — both good.
  The score side groups chord members with the same 180ms constant
  (`NOTE_TIME_GROUP_SECONDS = 0.18` in `waitForYouCheckpoints.js`), so the
  two windows are at least consistent. The gap: the *input* window should be
  beginner-paced (rolled chords are the norm), independent of the *score*
  grouping window.
- **Event window.** See above — one constant serves two different jobs.
- **Sustain/release.** Matching is note-on only; sustain pedal (CC64) is
  ignored entirely. That is correct for matching but means a held note that
  should count for the *next* checkpoint (tied/repeated notes) never
  re-triggers; the player must re-strike. Acceptable, but undocumented.
- **Stuck notes.** The engine tracks held notes; there is no watchdog if a
  note-off is lost (cable glitch, tab focus loss). Consequence today is
  cosmetic (held-notes display), not matching — matching keys off note-ons.
  Low severity.

## 4. Wait For You — current state

Modules: `useWaitForYou.js`, `waitForYouEngine.js`, `waitForYouGuidance.js`,
`useWaitForYouReferencePlayback.js`.

- **Target matching.** Note mode matches via the buffer above; beat mode taps
  through. Checkpoint ids/grouping shared with the Visual lane (verified in
  browser QA earlier: lane target == WFY panel == keyboard highlight).
- **Auto-advance.** Input match advances immediately (no artificial delay).
  Manual Continue plays a 380ms + 420ms flash sequence during which input is
  intentionally gated (`displayPhase` guards in `usePracticeSession.js`).
  Risk found: **input arriving during the checkpoint transition can drop** —
  the note-on subscription resets when `currentCheckpoint.id` changes, and
  there is no input queue, so a fast player's next note can land in the gap.
  Untested; needs a deterministic test before any fix.
- **Manual Continue fallback.** Present, keyboard-gated correctly at
  COMPLETE/NO_CHECKPOINTS (`usePracticeKeyboardShortcuts.js` line ~85), and
  recorded distinctly in stats (`manual-continue` vs `correct` vs `skipped`).
- **Hear It.** Reference playback exists ("Hear it" button,
  `referenceNotePlayer.js`), pauses transport before playing. Hint (target
  reveal) auto-offers after 2 wrong attempts (`HINT_AFTER_WRONG_ATTEMPTS`).
- **Stuck states.** Advance timers are cleared on unmount/seek/restart; seek
  syncs to nearest checkpoint; loop-region changes rebuild checkpoints and
  restart cleanly. One theoretical wart: `markCorrectAndContinue` invoked at
  COMPLETE re-fires `onCheckpointCompleted({ loopCompleted: true })`, which
  would inflate auto-loop stats — currently unreachable from keyboard/UI
  gating, but cheap to guard at the engine level.

---

## 5. Ranked roadmap

Ordering = (beginner impact × measurability) ÷ risk. "Safest first" within
each tier. **Bench** = new benchmark/fixture work needed.

### P0 — measurement foundations (safe, no runtime behavior changes)

| # | Item | Why first | Tests / Bench |
| --- | --- | --- | --- |
| 0.1 | **Vendor benchmark fixtures into the repo** (or a fetch script + manifest with checksums): Gymnopédie, Cruel Angel, Twinkle PDFs/MXLs out of `~/Downloads`. | The whole OMR program currently depends on one machine's Downloads folder. Zero risk, unblocks everything. | Dashboard runs green from a clean checkout. |
| 0.2 | **Recorded-audio mic corpus**: ~20 short labeled clips (real piano, phone/laptop mics, quiet + noisy rooms, single notes/rolled chords/blocked chords) + an offline harness that replays WAV frames through `pitchDetection` → `noteStabilizer` → matching. | Mic accuracy is currently unmeasurable; every tuning change is blind. Pure test infrastructure. | New `tests/micCorpus.test.js` (or script harness) reporting hit/false-negative/false-positive rates per clip. |
| 0.3 | **WFY input-drop regression test**: deterministic test that fires note-ons across a checkpoint transition (and during the Continue flash) and asserts none are silently lost or asserts the documented gating. | Turns the suspected transition gap from folklore into a red/green fact before touching the engine. | Unit test on `useWaitForYou` + `useWaitForYouMidiInput` wiring (renderless harness). |
| 0.4 | **Engine-level COMPLETE guard** in `markCorrectAndContinue` (return early at COMPLETE). One-line, removes the stat-inflation wart. | Trivial, self-contained. | Unit test: Continue at COMPLETE is a no-op. |

### P1 — highest measured impact

| # | Item | Impact | Risk | Tests / Bench |
| --- | --- | --- | --- | --- |
| 1.1 | **MIDI rolled-chord window**: decouple the input event window from the score grouping constant; extend the window from the *last matched* note (sliding) rather than the first, cap total (~1.5–2s), keep wrong-note behavior. | Beginners roll chords; today >180ms spread = silent reset and a "why didn't it count?" moment. Matching is the product's core promise. | Medium — touches `waitForYouNoteMatch.js` (the do-not-break zone). Behavior change is additive (window only ever gets more forgiving); full existing test suite + new rolled-chord timing tests gate it. | Extend `waitForYou*` tests: rolled chord at 100/400/800ms spreads, wrong-note mid-roll, duplicate strikes, window cap. |
| 1.2 | **OMR tie recall** (6/14 → target ≥12/14 on Gymnopédie without new false positives on Twinkle/dense): diagnostic-first pass on the 8 missed arcs — the checkpoint doc suggests apex exclusion by empirical row detection already fixed one class; classify the rest before loosening anything. | Ties are audible correctness for slow beginner pieces (sustained notes cut short = obviously wrong playback + WFY re-strike confusion). | Medium — detector is isolated (`detectVectorTies.js`) and benchmark-gated; the clean fixture guards regressions. | Dashboard before/after; add per-fixture tie-recall row to the report so it can't regress silently. |
| 1.3 | **Slur vs tie discrimination**: same-pitch arc = tie, different-pitch arc = slur (ignore for playback). Emit slur count in diagnostics only first. | Prevents the tie-recall work from importing slurs as false sustains; beginner books are slur-heavy. | Low if diagnostics-first. | New fixture with slurred passages (see Bench list); dense wrong-duration must not regress. |

### P2 — high value, needs P0 infrastructure

| # | Item | Impact | Risk | Notes |
| --- | --- | --- | --- | --- |
| 2.1 | **Mic false-negative tuning** against the P0.2 corpus: stability window, clarity floor, cents tolerance re-fit to measured rates; per-register analysis (low piano notes are autocorrelation-hostile). | Mic is the zero-hardware path for the target user. | Low once corpus exists — pure parameter fit with a regression harness. | Do not start before P0.2; current constants may be locally optimal. |
| 2.2 | **Mic chord UX honesty + fallback**: if corpus confirms blocked chords are unreliable (expected), either (a) auto-suggest `bass`/`top` single-tone mode for chord-heavy pieces in mic mode, or (b) prompt arpeggiation in guidance copy. No polyphonic detector this phase. | Converts the worst mic failure into a guided path. | Low — guidance/settings only, matching untouched. | A/B copy in `waitForYouGuidance.js`; corpus-driven threshold for "chord-heavy". |
| 2.3 | **OMR dense rhythm classification** (checkpoint doc target #1): bucket the 93 wrong durations by cause (voice overlap, sustained-under-moving, beam-owned run, grid quantization) as a report, before any new inference rule. | The dense metric that moves F1 next; classification prevents another round of reverted broad rules. | None (diagnostics only). | Extends `omrDurationErrorAnalysis.js`; output into the dashboard report. |
| 2.4 | **Written vs sounding duration split** in the internal OMR model (checkpoint doc target #5) — prerequisite for any future beam-derived duration edit. | Unblocks the beam-ownership program that has twice failed for lack of this separation. | Medium — model field addition, emission unchanged until proven. | Byte-identical runtime XML assertion while the field is diagnostics-only. |

### P3 — later / conditional

- **Polyphonic mic detection** (chromagram or multi-pitch): only after P2.1/2.2
  data shows single-tone + guidance is insufficient. High effort, high risk.
- **Beam-ownership duration edits**: only after 2.3 + 2.4, per the checkpoint
  doc's promotion gates.
- **Raster/scanned OMR**: separate initiative; vector path covers the beginner
  corpus.
- **MIDI stuck-note watchdog** (clear held list on visibility change/timeout):
  cosmetic today; bundle with any future held-note-dependent feature.

### Do not touch (explicitly out of scope for this phase)

- `evaluateNoteInput` single-note path and wrong/duplicate semantics — they are
  correct and battle-tested; only the chord *window arithmetic* is in scope (P1.1).
- Clean-fixture OMR behavior: any Gymnopédie metric movement fails the gate.
- Score-follow cursor, playback engine, timeline API, Visual mode renderer.
- Checkpoint grouping (`NOTE_TIME_GROUP_SECONDS`) — Visual lane, WFY, and
  stats all share it; changing it re-keys checkpoint ids everywhere.
- The reverted approaches list in `OMR_ENGINE.md` — do not retry blindly.

---

## 6. Recommended first sprint

Theme: **"Measure first, then forgive the roll."** Roughly a week of focused work.

1. **P0.1** Fixtures into repo/manifest (half day). Exit: dashboard green from clean checkout.
2. **P0.2** Mic recording corpus + offline replay harness (1–2 days incl. recording). Exit: baseline hit/FN/FP table committed.
3. **P0.3 + P0.4** WFY transition-input test + COMPLETE guard (half day). Exit: gap documented red or proven green; guard landed.
4. **P1.1** Rolled-chord sliding window behind the existing match-settings plumbing (1–2 days). Exit: rolled-chord tests green at 800ms spread, full suite green, no change to single-note or score-grouping behavior.
5. **P1.2 diagnostic half only** if time remains: classify the 8 missed Gymnopédie ties into failure buckets (no detector changes yet). Exit: tie-miss classification table in the dashboard report.

Sprint acceptance: all new tests green, dashboard unchanged on clean/dense
(except new diagnostic rows), no runtime behavior change outside P1.1's
window arithmetic, and a measured baseline exists for every P2 item.

---

## 7. OMR Accuracy Sprint diagnosis (2026-07-02) — chord bucket

Ran the dashboard and evaluated the largest **proven, generic** error bucket on
the enforced fixtures (clean/dense/simple only; the two La Campanella fixtures
are diagnostic-only and their measure-allocation collapse inflates every
downstream bucket, so they are excluded from the "generic" signal).

Findings (enforced fixtures):

- The aggregate `chord = 8346` headline is ~98% La Campanella; on enforced
  fixtures the largest bucket is **`slurs = 964`**, which is an *unmodeled-feature
  counter* (`uncertainSlurCount` = detected different-pitch arcs), not an
  accuracy error — it moves no enforced metric.
- The largest bucket that is a **proven accuracy error** is **`chord = 172`,
  entirely in dense** (clean is perfect; simple has 9 trivial rhythm-grid errors).

Root cause (evidence in `tests/omrDiagnostics.test.js` →
`analyzeChordMismatchCoupling`, and `src/features/omr/omrDiagnosticGrouping.js`):

- **162 of 172 chord-mismatch notes (94%) occur in measures that also have
  onset or note-detection errors.** The 10 "isolated" notes (m21/32/73/82/112)
  are adjacent 16th-note onset pairs (e.g. onsets 3.5 vs 3.75) where every note
  IS detected but one landed in the neighboring onset bucket.
- The accuracy evaluator's `compareChordGroups` re-buckets notes by onset
  (`chordOnsetToleranceQuarters` 0.08), so an onset that is slightly off is
  recounted as a chord mismatch. The chord bucket is therefore a **downstream
  symptom of onset / rhythm inference**, not a primary chord-grouping defect.
- The upstream onset errors are all 0.5q / 0.75q (half-beat / dotted) voice-phase
  shifts — the `rhythm-inference` class where two beam-ownership simulations
  already regressed and were correctly not promoted (§1, `OMR_ENGINE.md`).

Decision: **no detection/threshold change this sprint.** The smallest honest fix
for the chord bucket would require touching onset/rhythm inference — a broad,
high-risk change on the protected dense fixture, which the sprint rules forbid
and prior reverted work warns against. There is no isolated chord-grouping-logic
defect to fix. The diagnosis is pinned by regression tests so a future
onset/rhythm effort (P2.3 "dense rhythm classification") can be measured against
it, and so the chord bucket is not "fixed" in isolation. Enforced fixtures
remain unchanged: Gymnopédie 100/100/100/100/100, Cruel Angel 94/96/96/94/99,
Twinkle 100/97/93/100/100.

## 8. OMR Accuracy Sprint 2 — Rhythm and tie (2026-07-02)

Target: improve dense onset/duration without regressing clean/simple.

### Rerank (enforced fixtures, dense)

| Bucket | Count | Verdict |
|--------|------:|---------|
| onset/rhythm | 94 | **Primary proven root cause** |
| chord | 172 | 89% onset-coupled — symptom |
| pitch | 147 | Often matcher artifact |
| duration independent | 33 | Secondary rhythm bucket |
| duration onset-coupled | 44 | Follows onset |
| ties gap | 16 | Diagnostic; clean metrics still 100% |

Evidence: `analyzeOnsetErrorCoupling`, `rankRhythmRootCauses` in
`omrDiagnosticGrouping.js`; tests in `tests/omrDiagnostics.test.js`.

### Introduction point

Vector rhythm grid in `processVectorOmrPage.js` (`buildNoteEventsFromGroups`):
x-position → `startDivision` when `shouldInferRhythmFromPositions` is true.
Wrong onsets are ±0.50q / ±0.75q voice-phase slips (m9, m7–8, page-8 run).

### Simulation

Sixteenth-grid `snapStartDivision` for dense cluster phase — **zero metric delta**
on clean/dense/simple. Reverted.

### Decision

**No algorithm change.** Diagnosis pinned; next work should quantify
matcher-instance vs true slot-shift paths per measure before broader rhythm edits.
Full write-up: `tmp/omr-benchmark-dashboard/sprint2-rhythm-diagnosis.md`.

