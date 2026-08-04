# Corranzo microphone recognition acceptance report

Date: 2026-07-31 (America/New_York)

Accepted starting point: `46bbec75306dc032ec6aaf042ee904f8b62bf9ea`

Accepted microphone commit: `11081f68c9e0bf0334f04a7d8d3bdfb729ef2889`

## Decision

ACCEPT the focused microphone change for the release audit. The deterministic repeated-low-note corpus improved from 62/74 to 74/74 matched score events. False negatives fell from 12 to 0, false positives remained 0, the single sustained low note still advanced exactly once, and median latency did not regress.

This is an automated signal-processing and state-machine result. No claim of validation on a physical microphone or a specific audio device is made.

## Exact root cause

The first divergent stage was the attack/release latch, not frame extraction, pitch detection, or exact score matching. On failed repeated C2 fixtures, the detector continued to report MIDI 36 with approximately 0.92-0.95 confidence and correct autocorrelation support. Because the first piano tone was still decaying, the gate never closed and the original latch required either four gate-closed frames or a broad 1.6x whole-window RMS increase. The second hammer attack raised RMS only 1.12-1.42x, so the latch remained consumed even though first-difference/spectral energy rose 1.69-3.3x.

A secondary, isolated failure occurred after a middle-register tone decayed into a bass note. C4 is the fourth harmonic of C2, so the old upper-harmonic cap could reject a correct C2 even when both score-informed detection and autocorrelation independently anchored C2. The failure was in musical acceptance; the detector and matcher inputs were otherwise correct.

## Representative signal trace

Fixture `03-same-low-over-decay`, nominal variant, second C2 attack at 880 ms:

| Frame | Detected | Autocorrelation | Confidence | RMS | Spectral energy | Before | After |
|---:|---:|---:|---:|---:|---:|---|---|
| 879.77 ms | MIDI 36 | 36.0835 | 0.91913 | 0.080936 | 0.000904 | latch consumed | latch consumed |
| 896.44 ms | MIDI 36 | 35.9039 | 0.92637 | 0.081409 | 0.001361 | latch consumed | re-armed: `low-note-transient` |
| 913.11 ms | MIDI 36 | 35.8529 | 0.93875 | 0.085262 | 0.001294 | no match | confirmation 2/3 |
| 929.77 ms | MIDI 36 | 35.9550 | 0.95231 | 0.087861 | 0.001036 | no match | second score event advanced |

The acoustic pitch remained stable across the attack. The new evidence is the spectral-energy transient, so recognition no longer requires a pitch change or full silence.

## Algorithm before and after

Before:

- A consumed onset was re-armed by four gate-closed frames, a 1.6x global RMS attack, or an existing expected-note dominance transition.
- Slow-decaying bass could keep the gate open while hiding a real second attack from the RMS-only rule.
- An old fourth harmonic could veto a correct, independently detected bass fundamental.

After:

- The existing release and global attack rules are unchanged.
- For expected notes below MIDI 60 only, the latch tracks the minimum post-onset RMS and spectral-energy envelopes.
- After at least six frames, a new bass attack may re-arm only when the expected pitch is already strongly detected and the signal has piano-like sustained/distorted shape. It requires either a 1.55x spectral-energy rise plus an absolute margin, or a guarded 1.45x RMS rise.
- A held tone without a new transient does not re-arm.
- The harmonic exception is limited to MIDI 47 and below, requires the fundamental to be the strongest partial, requires independent autocorrelation within 75 cents, and rejects broad upper-partial/formant energy. It cannot turn a wrong octave into the expected note.
- Capture lifecycle listeners now recover from an ended input track, eligible AudioContext suspension/interruption, or loss of the active device. Cleanup removes all listeners, tracks, animation frames, and the context before restart. Hidden pages wait for the visibility-driven resume path.

## Deterministic corpus results

| Metric | Baseline | Final | Change |
|---|---:|---:|---:|
| Runs passing | 32/40 | 40/40 | +8 |
| Expected score events | 74 | 74 | - |
| Matched score events | 62 | 74 | +12 |
| False negatives | 12 | 0 | -12 |
| False positives | 0 | 0 | 0 |
| Median recognition latency | 82.17 ms | 79.77 ms | -2.40 ms |
| Maximum recognition latency | 816.44 ms | 259.77 ms | -556.67 ms |

Critical repeated-note cases, across nominal and quiet/faster variants:

- Same low note over active decay: 2/4 before, 4/4 after.
- Faster repeated low notes: 2/8 before, 8/8 after.
- No silence with a clear attack: 2/4 before, 4/4 after.
- Single sustained low note: 2/2 before and after; zero duplicate advances.
- Weak fundamental/strong second harmonic: 2/2 after.
- Wrong octave with a related harmonic: 0 false advances after.
- Middle/high control transitions: all expected events matched after.

The complete per-frame candidates, harmonic magnitudes, confidence, onset/re-arm timestamps, match events, and latency are in `mic-baseline.json` and `mic-final.json` beside this report.

## Files changed

Production:

- `src/features/practice/micAttackLatch.js`
- `src/features/practice/micMusicalAcceptance.js`
- `src/features/practice/useWaitForYouMicInput.js`
- `src/features/microphone-input/useMicrophoneCapture.js`

Tests and deterministic tooling:

- `tests/finalMicLowNoteCorpus.test.js`
- `tests/microphoneCaptureLifecycle.test.js`
- `tests/micAttackLatch.test.js`
- `tests/micMusicalAcceptance.test.js`
- `tests/wfyRingingNoteRearm.test.js`
- `scripts/final-mic-release-corpus.mjs`
- `scripts/lib/finalMicReleaseCorpus.mjs`
- `package.json`

No OMR implementation, evaluator, truth corpus, score-follow mapping semantics, or UI code was changed.

## Automated validation completed

- Final focused microphone group: 8 files, 117 tests passed.
- Full unit suite: 279 files passed; 2,812 tests passed; 5 skipped.
- Production build: passed.
- Microphone accuracy replay: 27/27 note clips detected; 0/4 silence/noise false positives.
- Microphone polyphony replay: V2 verdict `v2-improves`; 94.4% exact chord hit, 98.2% per-note recall, 0 false advances.
- Frozen semantic OMR corpus: evaluator 2.0.0/schema 2; 9/9 fixtures; accepted metrics unchanged (67.12% overall, 66.86% pitch, 74.64% rhythm, 72.85% measure structure, 55.56% sustain; error counts 161/182/170/102/136/112).
- Focused changed-file lint and whitespace checks: passed. The untouched `useWaitForYouMicInput.js` retains pre-existing repository-wide hook lint findings outside the changed line; its behavior is covered by the full unit suite.

## Physical-device limitations and manual plan

Not physically tested here: real browser permission prompts, unplugging a physical input, browser/OS route changes, hardware AGC, microphone low-frequency rolloff, and actual room hum. These must not be represented as completed scenarios.

Manual device plan:

1. In Chrome, Safari, and Firefox, grant access and play C2-C3 repeated at slow, moderate, and fast tempos; repeat with partial pedal overlap and verify one advance per hammer attack.
2. Hold one bass note for at least ten seconds and verify exactly one advance.
3. Play the wrong octave and harmonically related wrong notes; verify no advance.
4. Revoke permission, unplug/replug or change the input route, suspend/resume the tab, and hide/restore the page; verify the indicator and stream recover or stop honestly without duplicated capture.
5. While capture is active, navigate Practice/Library, replace the score, switch Piano/Guitar, and turn microphone mode off; verify no further advancement and no live track remains.
6. Repeat on a laptop microphone and one external interface with AGC/compression enabled and disabled where supported, recording first- and second-onset latency.

## Remaining limitations

- Browser audio constraints are requests; hardware and browsers may still apply AGC, echo cancellation, low-frequency filtering, or route-specific resampling.
- The fixed 2,048-sample analysis frame limits standalone autocorrelation below roughly MIDI 33. The score-informed harmonic detector covers the supported low-piano fixtures without lengthening the window, but physical A0-B1 behavior remains device-dependent.
- Lifecycle recovery is deterministic under mocked browser events; permission re-prompts and OS route behavior require the manual plan above.
