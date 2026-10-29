# Mic Engine rebirth — progress report

**Date:** 2026-10-28
**Worktree:** `/Users/ryland/Documents/scoreflow-mic-reliability`
**Branch:** `codex/neural-mic-reliability`
**Start:** `5cda4a08e8` (previous research head) + `origin/main` `e97283200a`,
merged locally as `4e81922bc6`.
**Production changes:** only the WFY mic attack/checkpoint lifecycle. No
deployment, no main merge, neural recognition stays OFF by default.

## 1. Audit — the production data flow

`getUserMedia` → `useMicrophoneCapture` (AudioContext + analyser + calibration)
→ `useMicEngineV2Detector` → `processMicEngineV2Tick`:

1. `analyzeMicFrame` (mono pitch, gate, signal shape, level).
2. `scoreInformedChordWindow` (expected-MIDI harmonic Goertzel scoring,
   per-string relief when the score supplies string/fret, octave/semitone
   guards).
3. `measureResolutionRatios` (single-note long-window resolution evidence).
4. V2 frame: `v2DetectedMidis`, `v2Notes`, gate/soft-gate, mean confidence.

Then `useWaitForYouMicInput.handleFrame`:

5. `updateMicAttackRelease` / `getMicAttackRearmReason` — attack latch.
6. `updateMusicalTiming` — attack phase / authority.
7. `evaluatePianoRecognition` or `evaluateGuitarRecognition` (V3 expectation).
8. `applyRecognitionTiming` → `recognitionMatchResult` → `applyMatchResult`.
9. `onPlayerInputMatched` → `useWaitForYou.markCorrectAndContinue` (WFY) or
   lane outcome (Play Along; Play Along's target is time-driven, the mic does
   not move the cursor).

What worked: single-note detection, calibration, V3/V2 fallback, octave and
semitone safeguards, chord grouping, score matching, cursor/follower
separation. What failed or was unsafe: see §3.

## 2. New deterministic harness — real audio, real production hook

`scripts/mic-live/sequence.html` + `sequence.js` mount the real capture and
`useWaitForYouMicInput` and walk a scheduled list of checkpoints while one
continuous injected audio stream plays. It records per checkpoint: advance,
latency from the intended onset, early advance, wrong-note reports, matched
notes, decision reason and attack-latch trace. It is a test page only.

`scripts/benchmark-mic-sequences.mjs` builds sequences from WAVs
(`scripts/lib/micSequenceAudio.mjs`) and reports per scenario and per step.
`scripts/benchmark-mic-sequences-repeats.mjs` repeats the whole matrix and
reports unstable steps. Scenarios are explicitly labelled:

* **natural** — `mic-real` (GuitarSet/EGSet12/Guitar-TECHS/Vienna 4x22,
  CC-BY-4.0, independent JAMS/MIDI annotations).
* **construction truth** — `mic-composites` / `uiowa-*` isolated-sample
  composites; valid for lifecycle, not for natural-polyphony claims.
* **isolated fixtures** — `real-piano-c4`, `real-piano-e4`,
  `real-guitar-g3` (known single-note recordings).

Scenarios cover: repeated single notes (long gap and 400 ms retrigger), fast
passages, repeated chords (slow and tempo-stress), sustained notes/chords that
must not skip the next checkpoint, wrong-note recovery, missed-note recovery,
octave ghosts, legitimate octaves/rolled octaves, fifths, a natural strum,
partial-chord negatives, noise negatives, and dense natural excerpts.

## 3. Defects found and fixed

### 3.1 One attack consumed several repeated checkpoints

**Symptom (before):** a single C4/G3 attack was accepted by 3–4 consecutive
identical checkpoints; measured early advances of −1.0 to −1.5 s. The attack
latch treated the same note's rising/decaying envelope and a brief gate
flicker as "new attacks". Repeated chords could also consume the next
checkpoint (guitar dyad early at −1.47 s).

**Fix:** attack identity, not just energy:

* track the post-consume attack peak, post-peak minimum and minimum transient;
* a same-pitch re-arm needs a real decay plus either a new derivative/transient
  spike or a strong spectral re-excitation;
* increasing RMS alone is no longer a new attack (it was the attack still
  reaching its peak);
* after a wrong report, or whenever the next checkpoint asks for the same pitch
  set, a **synchronous frame boundary plus a layout-effect boundary** requires
  a genuine new attack or a real release (8 quiet frames) before the new
  checkpoint can complete. The boundary is seeded from the *first* checkpoint's
  pitch set, because otherwise the first same-set transition compared against
  an empty set and could slip through once;
* a same-pitch re-attack that is quieter than the still-ringing note (a 400 ms
  retrigger inside the previous ring) is admitted by a strong new derivative
  transient even when RMS is falling; plateau wobble is not.

The latch is pure and tested in `tests/micAttackLatch.test.js` (10 tests,
including the rising-envelope false re-arm, decayed re-attack, compressed low
re-attack, stale-boundary release, and pitch-only block).

### 3.2 Measured before / after

| scenario | before | after |
|---|---|---|
| piano single C4 ×3 + tail hold | 1/4 steps, 1 false/early | **4/4**, ×5 runs, p50 15–24 ms, 0 false |
| guitar single G3 ×3 + tail hold | 1/4 steps, 1 false/early | **4/4**, ×8 runs, 0 false |
| guitar G3 400 ms retrigger | 1/2 (early −268 ms) | **2/2**, ×6 runs; final 5/5 runs, p50 ≈100 ms |
| guitar dyad (G3+B3) repeated 2.2 s | 1/3 (early −1472 ms, false hold) | **3/3**, final 5/5 runs, 0 false |
| wrong note → correct note, same checkpoint | pass | **pass** (V3 and V2 fallback) |
| octave ghost then real C4 | 1/5 early advance | **2/2**, final 5/5 runs, 0 early |

The repeated-chord guard is structural: it applies to any checkpoint whose
expected pitch set repeats, independent of the latch's previous state.

## 4. Baseline and repeatability

* Production single-checkpoint corpus (`mic-accuracy`, 6 clips):
  **6/6 true, 0/24 false**, p50 **58 ms**, p95 **133 ms** (single run after
  the fix; previous research baseline p50 49–66 ms, p95 90 ms). The false
  matrix is unchanged at 0/24.
* Full mic/WFY unit suite: **618 passed, 5 skipped, 67 files**.
* Full sequence matrix (24 scenarios / 54 steps): **40 passed, 0 false,
  0 early, 14 missed**, latency p50 34 ms / p95 387 ms. The misses are
  detection recall on construction-truth or dense natural excerpts, not
  premature advancement:
  * UIowa C-major composite: E4 is below the scorer's detection floor at every
    offset (ratio 0.6–0.9); known Class-B limitation.
  * UIowa open-Em composite: E2/A2/upper strings not all detectable; known
    weak-low-E limitation.
  * Vienna Mozart second triad and GuitarSet jazz first F3: quiet/dense
    excerpts; single-checkpoint true rate already varies.
  * Fast natural power-chord stress at 450 ms: the first attack completes in
    ≈170–247 ms; later attacks arrive before the confirmation budget. A 2.2 s
    repeated-dyad control passes 3/3 (and 5/5 in the final lifecycle repeat).
* Full-app browser E2E (`scripts/browser-unified-practice-mic-e2e.mjs`,
  fake audio device — **not physical microphone verification**):
  **23 passed, 0 failed, 1 skipped**, including correct C4 advance, wrong-note
  refusal, several-checkpoint melody, cursor travel, Play Along timed mic
  events, neural-disabled fallback, permission denial, and model-404 fallback.
  The final lifecycle matrix repeats (5 runs) pass every repeated-note/chord,
  recovery and octave-ghost step with 0 false and 0 early advances.

## 5. What remains limited

1. **Mono harmonic ambiguity** (octave ghosts, fifths/body resonance,
   transposed chords): unchanged. No new threshold was invented; the previous
   negative controls still hold.
2. **Weak/masked chord tones** (E2 open Em, quiet E4 in the UIowa C triad):
   detector recall, not lifecycle. These are construction-truth composites or
   known weak-low-E material.
3. **Dense natural excerpts** (Mozart second triad, jazz pickup): detection
   variance of the existing mono detector.
4. **Fast repeated chords**: the confirmation budget (~200–250 ms) cannot keep
   up with 450 ms chord spacing; a real player in Wait For You waits for the
   cursor, so this is a stress case, not the normal interaction.
5. **Physical microphone**: not tested; the acceptance page and checklist are
   unchanged from the previous round.

## 6. Decision

The repeated-note and repeated-chord lifecycle is now measurably safer and
more correct, with zero early/false advances in the dedicated sequences and no
regression in the production false matrix. The remaining misses are acoustic
recall limits already documented (masked fundamentals, dense mono material),
not lifecycle defects, so **do not start another mono threshold-tuning
campaign**.

Next defensible work, when resources allow:

1. Per-string/DI evidence (GuitarSet hex) to resolve octave/fifth/transposed
   ambiguity; still acquisition-blocked by the 5 GiB disk rule.
2. Physical-microphone acceptance (`docs/MIC_PHYSICAL_ACCEPTANCE.md` +
   `scripts/mic-acceptance/`) with real hardware.
3. If new labelled data arrives, test one chord-template likelihood experiment
   with the same negative controls; not a threshold sweep.

No production detector thresholds were changed in this round; the changes are
event identity, checkpoint boundaries, and test infrastructure.
