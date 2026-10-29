# Polyphonic recall and real-room readiness — final report

**Date:** 2026-10-28
**Worktree:** `/Users/ryland/Documents/scoreflow-mic-reliability`
**Branch:** `codex/neural-mic-reliability`
**Start:** `42baa9ccb1` (the previous repeated-attack fix).
**Production changes:** bounded local-prominence chord-tone rescue and an
attack-window temporal invariant. No global detection threshold was lowered;
no main merge, no deployment, neural inference OFF.

## 1. Baseline frozen

Before this round:

* production single-checkpoint `mic-accuracy`: **6/6 true, 0/24 false**,
  p50 49–66 ms / p95 90 ms;
* production sequence matrix: **40/54 passed, 14 missed, 0 false, 0 early**;
* repeated-note/chord controls: stable (previous round).

All changes below are measured against those numbers on the same harness.

## 2. Miss audit — what the 14 actually were

| cause | steps / examples | evidence |
|---|---|---|
| **Quiet chord tone under the global 2048 floor** | UIowa C-major E4; UIowa C4+E4 E4; UIowa Cmaj7 E4/C4 | E4 fundamental 0.0065 vs global floor 0.0080, ratio 0.8–1.3 at 2048; at 8192 a 21–81× local peak. |
| **Absent expected tone in a construction-truth composite** | UIowa open-Em (E2 and several strings) | at 8192 E2 m = 0.00003–0.00014 while G3/B3 are 0.005–0.03; no independent local peak exists. |
| **Quiet/dense natural excerpt or closed gate** | Vienna Mozart second triad; Vienna Schubert single-checkpoint | rms 0.002–0.010, gate closed; only some tones reach the floor. |
| **Fast repeated chord vs confirmation budget** | GuitarSet power dyad at 0.24/0.50/0.95/1.25 s | first attack confirms in 166 ms; next is 71 ms later; a 2.2 s repeated-dyad control passes in 216–329 ms. |
| **Application/classifier interaction** | GuitarSet jazz F3 in the multi-checkpoint sequence | production single-checkpoint replay advances at **83 ms**; the note reads V2 confidence 0.9/ratio 5.2, but the sequence intermittently reports `non-musical-input` during attack/decay and the attack latch can remain armed across intervening non-target notes. |

No missing pitch was “invented” from the score. The absent-E2 and quiet-chord
cases are data/recording limits, not threshold opportunities.

## 3. Changes

### 3.1 Bounded local-prominence rescue

New pure module
`src/features/microphone-input/v2/localChordProminence.js`, called after the
normal chord passes. For an undetected expected tone it requires:

* another expected tone strongly detected in the same frame
  (`ratio ≥ 1.6`, `confidence ≥ 0.3`);
* a long (8192-sample) fundamental at **≥ 0.0007**;
* local prominence over ±0.5..2.5-semitone probes **≥ 6**;
* local peak over the strongest nearby probe **≥ 1.3**;
* no integer-harmonic relation to a strong peer;
* no strong subharmonic at f/2, f/3, f/4;
* no existing deep-bass/high-lower-octave veto.

The expected score only selects the probe target; the acceptance is the
independent local spectral peak plus harmonic/subharmonic guards. The global
detection floor is unchanged.

### 3.2 Attack-window invariant

The V3 piano/guitar recognizer now separates:

* the **sustain/ring window** (how long already matched notes persist);
* the **attack window** `max(rollToleranceMs, rollingWindowMs)` — the only
  period in which a **new chord tone** may be added. Single-note checkpoints
  keep their prior sustained-note behavior; the full-app sustained-C4 probe
  exposed that distinction and the gate is chord-only.

A physically depressed sustain pedal still allows later notes of an
arpeggiated/pedaled chord. A score note's nominal duration alone no longer
lets a late resonance complete a chord. This was required because the
C-major triad against a Cmaj7 expectation produced a false B4 relief 1.2 s
after the attack while C/G rang; the rescue's genuine E4 would otherwise have
completed the wrong chord. The regression is covered by
`tests/micPianoRecognition.test.js` (“refuses a missing B4”).

### 3.3 Integration details

* `scoreInformedChordWindow` invokes the rescue only for incomplete chords
  with a strong peer; single notes and complete chords pay nothing.
* V2 guitar chord collection accepts a rescued note
  (`localProminenceRescue`), because the rescue's evidence is stricter than the
  generic guitar confidence floor.
* The offline polyphony replay now passes a 8192-sample lookback to mirror the
  live path; the normal scorer still trims to its 2048 analysis window.

## 4. Results

### Sequence matrix

Final representative run: **47/54 passed, 0 false advances, 0 early
advances, 7 missed**, latency **p50 56 ms / p95 266 ms**. The previous round
was 40/54. The conservative verified gain is the five UIowa C-triad/dyad steps
(40 → ≥45); the two jazz F3 steps pass intermittently, so the stable floor is
45/54.

Affected controls, 3 repeated runs each:

| scenario | before | after |
|---|---|---|
| UIowa C-triad sustain + holds | 2/3 | **3/3**, 192–208 ms |
| UIowa C-triad repeated ×2 | 1/3 | **3/3**, 184–207 ms |
| piano C4+E4 repeated + hold | 1/3 | **3/3**, 207–224 ms |
| guitar repeated dyad + hold | 3/3 | **3/3**, 216–361 ms |
| partial C-triad negative (expect Cmaj7) | 1/1 | **1/1**, no B4 |

### Production single-checkpoint

`mic-accuracy`: **6/6 true, 0/24 false**, latency **p50 56 ms / p95 89 ms**.
The local rescue does not apply to single-note expectations; the temporal
invariant preserves the single-note false matrix.

### Negative controls

* Frame sweep across every `mic-real` clip and all generated wrong
  expectations: **0 rescue-only false completions**; the 8 frame-level
  detections that occurred were already normal-detector outputs.
* Octave ghost C5 over C4: local peak high, but blocked by the C4
  subharmonic.
* C4+G4 expecting E4, C4 expecting C+G, C-major triad expecting Cmaj7,
  transposed jazz/eg08 chords, noise: no rescue.
* Full mic/WFY unit suite: **614 passed, 5 skipped**.
* Full-app browser E2E (fake audio device, not physical): previous run
  23 passed / 0 failed / 1 skipped, including Play Along timed mic events.
  The latest attempt stalled in the integration's sustained-loop fixture
  (continuous test tone kept calibration in "Calibrating"), so it is not
  counted. The production browser injection suite after the final changes
  passes C4, V3 chord, V2 chord, false-chord and room-noise cases.
* CPU: `scoreInformedChordWindow` 0.449 ms → 0.653 ms on an incomplete UIowa
  chord frame (≈ +0.20 ms/frame); complete chords and single notes unchanged.

### Natural / composite / synthetic separation

* **Natural `mic-real`:** targeted 5/6 true, 0 false; power dyad, strum,
  fifth, jazz dyad, eg08 pass; one dense Vienna chord still misses.
  The natural power-chord fast tempo is a stress miss; the slow repeated dyad
  passes.
* **Construction-truth composites:** UIowa C triad, C4+E4, and Cmaj7 now pass;
  open-Em fails because the recording contains no usable E2 (measured), and is
  reported as a data-quality limitation, not a detector miss to force.
* **Synthetic:** unit/replay suites still pass; no production threshold was
  moved.

## 5. Remaining misses after the final run

1. **Open-Em composite (3 steps):** E2 is absent in the recording
   (0.00003–0.00014 vs 0.005–0.03 for G3/B3). Requires a real open-Em
   recording or per-string/DI data; do not lower the gate.
2. **Mozart second triad (1):** quiet/closed gate; the available tones are
   not strong enough to satisfy the existing chord gate, and the local rescue
   correctly refuses a sub-threshold quiet frame.
3. **Fast power-chord stress (3):** the next chord arrives before the
   confirmation budget; the slow repeated dyad control passes. This is a
   tempo/latency limit, not an acoustic-evidence limit.
4. **Jazz F3 (intermittent, 0–2):** production single-checkpoint passes at
   83 ms; the multi-checkpoint sequence is sensitive to the generic musical
   classifier/attack latch across intervening non-target notes. A candidate
   score-informed classifier override was tested and reverted because it did
   not make the sequence deterministic and would add unverified production
   behavior.

## 6. Physical microphone acceptance

**Unperformed: no physical microphone hardware is available to this agent.**

The research-only page `scripts/mic-acceptance/` and
`docs/MIC_PHYSICAL_ACCEPTANCE.md` remain ready. The page smoke test passes with
Chromium's fake audio device (clearly labelled simulated). The concise manual
plan is the existing 12-step checklist: C4/piano chord/partial chord, repeated
notes, wrong note, octave ghost, guitar open G3/open-Em, silence, quiet note,
room noise, plus latency perception. For this round also record:

* built-in laptop mic vs interface, input gain, sample rate;
* a repeated chord/strum and a ~450 ms chord transition;
* device disconnect/reconnect and pause/resume;
* Play Along playback synchronization with headphones;
* input level/device/calibration/advance timings via the acceptance page.

Nothing is uploaded and no recording starts without an explicit action.

## 7. Integration candidates

Reviewable production patch:

* `src/features/microphone-input/v2/localChordProminence.js` (new)
* `src/features/microphone-input/v2/scoreInformedChordScorer.js` (call)
* `src/features/microphone-input/v2/micPolyphonyV2ReplayHarness.js` (test path)
* `src/features/microphone-input/v3/pianoRecognition.js` (attack window)
* `src/features/microphone-input/v3/guitarRecognition.js` (attack window)
* `src/features/practice/waitForYouNoteMatch.js` (V2 guitar rescued-note pass)
* `tests/localChordProminence.test.js`, updated piano/polyphony tests

Research-only: sequence harness and reports. No neural enablement, no cursor
rewrite, no main merge/deploy.

## 8. Recommendation

**Continue with the local-prominence rescue and temporal invariant; pause
further mono threshold work.** They produce a measured recall gain (40 → 47/54
in the final run; ≥45 conservative) with zero false/early advances, preserve
the 6/6/0-of-24 production baseline, and add only ~0.20 ms/frame on incomplete
chords. The remaining misses are absent/inaudible acoustic evidence, a quiet
closed-gate excerpt, or a tempo/confirmation limit. The next evidence source is
a real open-Em/ordinary-laptop-microphone recording or per-string/DI data, not
another global threshold sweep.
