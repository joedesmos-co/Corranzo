# Phase 3 — extreme-register root causes

Baseline: `c1faa8c5ba8913cdc5f7862401bcfc4d08b8e8c4`

The corpus demonstrates failures in candidate generation/selection, confirmation, onset state, and mode integration. Exact score matching itself remains absolute-MIDI and behaves correctly once it receives a supported candidate at a valid new attack.

## Root cause 1 — one 2,048-sample expected-note window cannot resolve deep-bass neighbors or octaves

At 44.1 kHz the baseline window contains 1.28 A0 cycles and less than 1.9 cycles through the first six chromatic notes. Exact-frequency Goertzel probes avoid FFT-bin quantization, but they do not avoid short-window leakage. The expected neighboring note can score strongly from the currently ringing deep-bass note.

Demonstrated consequences:

- In `neighboring-extreme-low`, real A0 is matched at 179.77 ms. While A#0 is not scheduled until 580 ms, the A0 decay makes the expected A#0 probe look strong enough to use `score-informed-transition` at 346.44 ms and falsely advance A#0 at 379.77 ms. B0 then advances at 446.44 ms, 593.56 ms before its real attack.
- `fast-extreme-low-passage` and `slow-extreme-low-passage` exhibit the same causal violation. These early advances are counted as false positives and the intended later attacks as false negatives.
- Wait For You is more exposed because each premature confirmation immediately changes the expected checkpoint. Follow Along changes its target from playback time, so it avoids some early advances but still misses rapid notes while the latch remains consumed. This is the first source of mode inconsistency.
- The wrong-octave A1 control is accepted as A0. At the accepting frame, expected A0 h2 is the strongest probe (`0.03311`), h1 still receives `0.01014` from short-window leakage, V2 confidence is `0.58005`, and the blind tracker correctly sits at MIDI `33.02`. The baseline corroboration deliberately ignores that absolute contradiction because expected A0 is below the 55 Hz tracker floor.

An 8,192-sample diagnostic of the same deterministic A1 control already rejects expected A0 without lowering thresholds. This isolates insufficient low-register window duration as the first divergence, with octave-family validation as a necessary second guard.

## Root cause 2 — high expected fundamentals are confused with lower-note harmonics

The score-informed path probes only the expected pitch family. It does not probe the immediate lower octave's **fundamental** as contradictory evidence. C7 h2 therefore looks exactly like expected C8 h1.

In `wrong-octave-for-c8`, the accepting frame has:

- expected C8 h1 magnitude `0.01607` (actually played C7 h2),
- expected-family ratio `1.89032`, confidence `0.38416`,
- blind autocorrelation at MIDI `84.06`, outside the reliable high band and therefore not used as a contradiction,
- a false C8 confirmation at 213.11 ms in both modes.

The focused pre-repair test confirms that the current scorer returns `[108]` for a synthesized C7 frame when `[108]` is expected.

## Root cause 3 — above-Nyquist harmonic probes contaminate the high family

The scorer always loops through h1..h6. `goertzelMagnitude` has no Nyquist guard. At 44.1 kHz, upper C8 partials can exceed 22.05 kHz; evaluating those digital frequencies folds them onto lower frequencies. This can inflate or distort the expected family and its noise-relative confidence. The synthesizer intentionally omits above-Nyquist partials, so any energy returned by those probes is an analysis artifact, not acoustic support.

This does not alone explain every miss, but it makes high-register confidence and harmonic-shape tests device/sample-rate dependent and must be removed before safely relaxing high harmonic acceptance.

## Root cause 4 — the musical/formant gate is register-neutral

For non-bass notes, baseline musical acceptance normally requires h1 to be the strongest partial. That is appropriate in the middle register as a speech guard, but rejects legitimate top-register piano/speaker spectra with weak h1 and dominant h2/h3.

- `high-weak-fundamental`: V2 repeatedly detects C8 with h1 `~0.0050`, h2 `~0.0310`, h3 `~0.0158`, ratio `~1.64`, confidence `~0.31`; every frame is rejected as `non-musical-formant-harmonics`.
- `compressed-extreme-high`: h1 `~0.068`, h2 `~0.115`, ratio `~2.59`, confidence `~0.545`; it is also rejected as formant-like despite a coherent decaying h2/h3 family.

The high-frequency zero-crossing rate additionally exceeds the middle-register cap even for a tonal C8. A safe high-register exception must require coherent harmonic decay and absence of a stronger immediate-lower-octave fundamental; merely allowing any strong h2 is unsafe.

## Root cause 5 — confirmation treats benign octave flips as pitch drift

The raw autocorrelation divisor logic can alternate between a fundamental and an octave-related period on harmonic-rich notes. `frameCorroboratesSingleNote` already treats octave flips as non-contradictory, but `confirmConfidentMatch` compares raw cents without octave wrapping.

For individual MIDI 78, V2 remains stable around confidence `0.70` while raw autocorrelation alternates MIDI `78.17` and `66.03`. Every octave flip restarts the three-frame confirmation, so the note never advances. The focused failing test reproduces this with pitch anchors 7800 → 6600 → 7805 cents.

At MIDI 89 (1,396.9 Hz), the tracker is at its upper search boundary and later locks to MIDI `70.11`, a subharmonic. Strong correct V2 evidence is then rejected by corroboration. The top edge of the blind tracker is not reliable enough to veto the exact-frequency scorer; a lower corroboration ceiling is needed, without expanding match tolerance.

## Root cause 6 — high reattacks have no guarded transient rearm

The accepted repeated-low-note repair is limited to expected MIDI <=59. High same-note reattacks therefore require four gate-closed frames or the broad 1.6x whole-window RMS rise.

In `repeated-extreme-high`, C8 remains acoustically detected with confidence near `0.68`; the second attack raises filtered RMS from about `0.117` to `0.143` (roughly 1.22x), so the latch stays `awaiting-release` and the second score event is missed. In the six-note fast high passage, only the first event advances.

The existing normalized first-difference ratio is a spectral-shape proxy, not an attack magnitude. A high sustained sinusoid already has a large normalized derivative, so the bass transient comparison cannot simply be enabled for all registers. A separate absolute first-difference RMS envelope is required, guarded by strong current expected-note evidence and minimum post-consume time.

## Root cause 7 — one fixed confirmation duration penalizes short high attacks

Very short high events can provide fewer than three consecutive accepted frames after the 46.44 ms rolling window and gating/musical checks. Most fast-passage losses currently begin at the latch, so confirmation should not be globally reduced. The safer repair is to keep the three-frame confirmation, remove false restarts, and allow a high reattack to start a new confirmation run promptly. No broad confidence-threshold reduction is justified by the evidence.

## Non-causes / protected behavior

- Exact score matching compares absolute MIDI by default; pitch-class-only matching is not the source of these failures.
- OMR recognition, evaluator 2.0.0/schema 2, truth data, tolerances, and score checkpoint construction are not implicated.
- The accepted repeated-low-note transient behavior correctly distinguishes a held low sustain from a new bass attack and must remain unchanged.
- Capture lifecycle already uses one shared stream/context and resets detector/matcher state on relevant enablement, checkpoint, score, instrument, and mode boundaries; no duplicate resource was observed in the static trace.

## Evidence-supported repair direction

1. Acquire enough time-domain history for an 8,192-sample deep-bass score window while keeping raw features/high analysis on the existing last 2,048 samples.
2. Apply the long window only to single-note deep-bass expectations; preserve existing middle, chord, and Guitar/TAB behavior and cost.
3. Add explicit octave-family evidence: odd/even support for deep bass and immediate-lower-octave fundamental energy for high notes.
4. Nyquist-bound all spectral probes.
5. Permit coherent weak-fundamental high families only when the lower-octave fundamental guard is clear.
6. Make confirmation drift octave-invariant and stop using upper-bound autocorrelation as contradictory evidence.
7. Track absolute first-difference RMS and add a strictly guarded high-note transient rearm without changing the accepted low branch.

Four of five initial focused tests fail on the baseline exactly as expected; the long-window A1-vs-A0 test already passes, directly validating the multi-resolution premise before production integration.
