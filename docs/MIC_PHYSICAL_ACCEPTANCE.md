# Physical microphone acceptance procedure (10 minutes)

Purpose: verify on REAL hardware that the microphone recognizer behaves as
measured with injected streams. No code changes; this is a manual test the
user runs on the website once the integration is approved.

Equipment: the instrument (piano and/or guitar), a quiet room, laptop
speakers muted (use headphones for Play Along or none for Wait For You).

Browser: Chrome or Safari on the Mac being tested. Record the versions.

## Before you start

1. Open the site and go to Practice with a short score (the demo piece is
   fine). Choose Wait For You.
2. Select Microphone as the input. Allow the permission.
3. Stay silent while it calibrates (~3 s). The status should reach "Ready"
   (not "Room noisy — play louder").
4. Do NOT enable the experimental neural engine; it is off by default and
   must stay off.

## Scenarios (record PASS / FAIL for each)

| # | Scenario | Expected |
|---|---|---|
| 1 | Piano: play middle C (C4) once, hold ~1 s | advances, turns green |
| 2 | Piano: play D4 when the score asks C4 | does not advance; shows a refusal |
| 3 | Piano: play C3 while the score asks C4 | **does not advance** (octave ghost) |
| 4 | Piano: play C4+E4+G4 together | completes once |
| 5 | Piano: play only C4+E4 of that chord | stays incomplete (no advance) |
| 6 | Piano: play C4 three separate times on three checkpoints | each advances once, no duplicate award |
| 7 | Guitar: open G3 string | advances |
| 8 | Guitar: play G3 while the score asks G4 | **does not advance** (octave ghost) |
| 9 | Guitar: strum all six open-Em strings | record: completes or not (known limitation) |
| 10 | Silence: stop playing for 10 s | nothing advances, no notes appear |
| 11 | Quiet: play a soft (pp) C4 | advances |
| 12 | Room noise: talk for 5 s / move a chair | nothing advances |

## Also record

- Latency feel: does the highlight follow your playing without a noticeable
  lag? (Expected ~60–100 ms on the production path.)
- Any wrong-note messages during a CORRECT performance (false rejection).
- Any advancement when you played the WRONG note (false award) — the most
  important failure.
- Device: built-in mic vs audio interface; input gain if adjustable.
- Room: quiet / normal / noisy.

## What to send back

Copy this table with PASS/FAIL and notes, plus the browser and macOS
version, the instrument, and the microphone used. If any scenario fails,
include the score name and the checkpoint text shown on screen.

## Known limitations (do not treat as failures)

- An expectation an octave above a note that is also sounding and is not
  itself expected is refused by design.
- A six-string open-Em strum may not complete when the low E fundamental is
  masked by the higher strings (measured: its detection ratio stays below
  the detector floor).
- Dense piano passages can miss checkpoints (the score-informed detector
  needs each expected tone to be present).

## Research diagnostic flow (optional, local-only)

When hardware testing becomes possible, `scripts/mic-acceptance/` provides a
research-only page that runs the same checklist against the REAL microphone
(no injected audio) and records: input level, sample rate, device id,
calibration status, expected checkpoint, detected notes, wrong reports,
first-evidence time, advance time and pass/fail per step. It produces a
local JSON report via a download button; nothing is uploaded and no audio is
recorded unless the reviewer explicitly adds that step.

Run it with `npm run dev` and open `/scripts/mic-acceptance/index.html`.
The page is not part of the product and must be reviewed before integration.
A plumbing smoke test with Chromium's fake audio device is available at
`node scripts/mic-acceptance/smoke.mjs` (simulated input — not hardware
acceptance).

## Local acceptance page v2 (operator-run)

Start it with:

```bash
npm run mic:acceptance
# or: npm run dev, then open /scripts/mic-acceptance/index.html
```

The page now provides:

* instrument selection (piano/guitar) and microphone-device selection;
* pause/resume of the live capture, plus device refresh;
* single notes (C4, G3), wrong note, octave ghost, triad, partial chord,
  repeated notes, repeated chords, quiet note, silence/room noise;
* live input level, filtered RMS, noise floor, sample rate, calibration and
  detected notes;
* per-step expected/actual advance, first-evidence and advance latency, wrong
  reports and feedback;
* a local JSON report download.

Nothing is uploaded. No raw audio is recorded. The optional recording path was
not enabled. The fake-device smoke test is labelled simulated and is not
hardware acceptance; the checklist above remains the real-hardware procedure.
