# Natural polyphony and physical-mic readiness — stage 2 report

**Date:** 2026-10-29
**Worktree:** `/Users/ryland/Documents/scoreflow-mic-reliability`
**Branch:** `codex/neural-mic-reliability`
**Start:** `106da6ca53`. **End:** `aad12134d8` plus this docs commit.
No main merge, no deployment, neural inference OFF.

## 1. Baseline (preserved)

* sequence: **47/54** representative, **45/54** conservative; **0 false,
  0 early**; p50 56 ms / p95 266 ms.
* production `mic-accuracy`: **6/6 true, 0/24 false**, p50 56 ms / p95 89 ms.
* repeated attack/latch and local-prominence fixes from the previous round are
  unchanged.

## 2. Remaining misses classified

| miss (count) | class | evidence |
|---|---|---|
| Open-Em composite (3) | **1 — absent/untrustworthy source evidence** | E2 fundamental at 8192 is 0.00003–0.00014 vs G3/B3 0.005–0.03; no local peak exists. |
| Mozart second triad (1) | **2/3 — acoustic masking + closed gate** | rms 0.002–0.010, gate closed; only E4 reaches the normal floor. No safe multi-tone evidence. |
| Fast power-chord stress (3) | **4 — chord temporal confirmation budget** | A fair 450 ms control (older attack cropped) confirms the first chord but misses the second in 3/3 runs; a 2.2 s repeated dyad passes in 216–329 ms. |
| GuitarSet jazz F3 (intermittent) | **5 — classifier/attack-latch interaction** | During failure the note is detected at confidence 0.9, dominant exactly F3, but the 8192 semitone veto flags F#3 for two frames and resets the attempt. |
| Wrong score event/annotation | **6 — none identified** | Known GuitarSet annotation errors remain excluded; no new wrong-truth case. |

The F3 is not a missing-pitch case. A score-informed classifier override was
tested and reverted; the actual state transition was the semitone veto.

## 3. Improvements actually shipped

### 3.1 F3 semitone-veto consistency — `115f6bbbb1`

`semitoneLeakFromResolution` now returns no veto when the independent
monophonic dominant pitch agrees with the expected pitch. The long-window
neighbour is then decay, not leakage. If the dominant is the semitone
neighbour (fresh 55-vs-56 case), the veto still fires.

Measured:

* F3 repeated-note sequence: **7/8 runs pass** (the remaining run had no audio
  frames at all — a harness startup transient, not a recognition decision).
* Fresh `acoustic-fresh-ss-single` negative: **0 wrong advances**; wrong
  expectations still refused.
* Octave/piano/guitar unit suites pass.

### 3.2 Local-prominence 8192 cache — `b71c4d0203`

The rescue now reuses one Hann-windowed scratch buffer instead of allocating
32 KB per incomplete chord frame. The products and Goertzel inputs are
identical; all rescue/negative tests produce the same decisions.

CPU on the loaded host: 0.94 ms/frame without rescue, 1.38 ms/frame with it
(extra ≈0.44 ms; a quieter earlier run measured 0.45/0.65). This is far below
the 16.7 ms frame budget and does not block the audio callback.

Low-power browser check: production `mic-accuracy` at **2× CDP CPU throttle**
= **6/6 true, 0/24 false**, p50 88 ms / p95 142 ms (unthrottled 56/89). A 4×
attempt did not complete in this headless environment and is not claimed.

### 3.3 Local acceptance flow — `aad12134d8`

`npm run mic:acceptance` opens the research-only page. It now supports device
selection, pause/resume, single notes, triads, repeated notes/chords, wrong
notes, octave ghosts, quiet playing, silence/noise, live input level/filtered
RMS/noise floor/sample rate/calibration and a local JSON report. No raw audio
is recorded or uploaded. Fake-device smoke passes (labelled simulated); real
hardware acceptance remains **unperformed**.

## 4. Fast-chord and dense-chord experiments (negative results)

* **Fair 450 ms control**: crop the GuitarSet power dyad to the 0.50/0.95 s
  attacks. The first checkpoint advances; the second misses 3/3. The second
  chord is detected but the same-set stale boundary rejects it because the
  first chord's decay contaminates the new pluck's transient baseline.
* **Strong-spectral rearm under the stale boundary**: tested and **rejected**.
  It caused early advances of −195/−202 ms (the first chord's own rising tail
  was admitted as the next checkpoint) and missed in other runs. No production
  change.
* **Dense natural Schubert**: the local rescue recovers A3 at the frame level,
  but the live single-checkpoint replay emits wrong-tone reports and refuses;
  no threshold was lowered to force it.
* **Open-Em**: no E2 evidence to rescue; requires a real recording.
* **Mozart second**: quiet/closed gate; no safe acoustic evidence.
* **Repeated strums/dyads**: the 2.2 s repeated controls pass; the ordinary
  natural strum/fifth controls pass.

## 5. What is still missing

1. Real open-Em and ordinary laptop-microphone recordings.
2. A per-string/DI source for octave/fifth/transposed ambiguity (still
   acquisition-blocked by disk in the previous round; now 8.6 GiB free but no
   new download was made).
3. A fast-chord policy that can distinguish the next pluck from the previous
   chord's rising tail without accepting the tail. The negative control shows
   the current evidence cannot do it safely.
4. Hardware acceptance, which was not possible here.

## 6. Recommendation

**Keep the F3 consistency fix, local-prominence rescue, attack-window safety
and the cached probe; pause further mono threshold work.** The F3 fix removes
the remaining application-state flake; the other seven misses are absent
source evidence, a quiet closed-gate excerpt, or a fast-chord temporal limit.
The next step is real physical recording (acceptance page / `MIC_PHYSICAL_ACCEPTANCE.md`)
or per-string/DI data, not another global threshold sweep.

**Commits:** `115f6bbbb1` F3 state fix · `b71c4d0203` cache/low-power
measurement · `aad12134d8` acceptance v2 · plus docs. Branch pushed, not merged.
