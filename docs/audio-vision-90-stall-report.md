# Corranzo — Audio Vision 90% Stall: Root Cause & Release Report

## 1. Exact root cause of the 90% stall

**TF.js's browser platform probes `window` without a guard, inside a Web Worker.**

TF.js's `PlatformBrowser.setTimeoutCustom` reads:

```js
setTimeoutCustom(func, delay) {
  if (!window || !ENV.getBool('USE_SETTIMEOUTCUSTOM')) { setTimeout(func, delay); return }
  ...
}
```

In a Web Worker `window` is **not declared at all**, so the probe throws
`ReferenceError: Can't find variable: window` instead of falling back to the
platform timer. The throw happens inside the **WebGL backend's fence polling**
(`addItemToPoll` → the custom timer), so:

1. the fence promise never settles,
2. `model.evaluateModel()` never resolves,
3. the worker never posts its result,
4. the main thread's pitch job stays **pending forever**,
5. the progress panel sits on its last reported stage — `Analyzing notes · 90%`
   — with no error, no timeout and no way to retry.

Captured live stack (from the deployed bundle):

```
[audio-vision] pitch worker failure: Can't find variable: window
  setTimeoutCustom@…/assets/audioVisionPitchWorker-….js:498:452
```

It only appears where the **WebGL backend is actually available inside a
worker** — Safari always has it, a GPU-backed desktop browser usually does,
and a headless/software-rendered browser does not. That is why the same build
could work in one browser and hang in another, and why the user hit it in
Safari.

A second, independent defect made the failure **permanent instead of
recoverable**: the pitch client had no way to settle a job the worker had
abandoned. A worker error that fired *before* the job was registered, or a
worker that simply stopped answering, left the promise pending forever.

## 2. Code changes made

| File | Change |
|---|---|
| `src/features/audio-vision/audioVisionWorkerEnv.js` *(new)* | Declares `window` as `undefined` inside the worker so the bare `!window` probe behaves as its author intended (fall back to the platform timer). `typeof window` still reads `"undefined"`, so every other TF.js feature probe is unchanged. |
| `src/features/audio-vision/audioVisionPitchWorker.js` | Imports the shim **before** TF.js. Tracks the job in flight and answers it with a failure on any uncaught error or unhandled rejection. `postMessage` failures are reported instead of swallowed. |
| `src/features/audio-vision/audioVisionPitchClient.js` | **A job can never stay pending**: rejects on worker crash, on a message error, on a worker that failed to start before the job was registered, and on a job the worker stops answering (timeout scaled by the recording length). Every rejection falls back to the inline path, so a generation always reaches a terminal state. |
| `scripts/browser-audio-vision-critical-ux.mjs` | `BROWSER=webkit` runs the same acceptance suite in Safari's engine. |

**The model's inference results and thresholds are untouched** (same model,
same onset 0.5 / frame 0.3 thresholds, same 22 050 Hz mono input, same
`outputToNotesPoly`). Only the thread's timer and the failure handling changed.

## 3. Progress / stage behaviour before and after

**Before:** `Preparing audio · 5% → Detecting the rhythm · 35% → Detecting the
harmony · 60% → Analyzing notes · 90% → Analyzing notes · 91%` and then
**nothing, forever**. No error, no cancel responsiveness, no arrangement.

**After:** the same stages, the worker reports its real per-window progress
(`90% → 91% → 92%`), and the run then completes with the genuine post-inference
stages (`Building the arrangement · 92%`, `Generating the notation · 96%`,
`Finished · 100%`) and the review card. 100% is only reported after the
MusicXML exists, so it is never a lie.

## 4. Generation completion times (real audio, real browsers)

| Browser | Audio | Before | After |
|---|---|---|---|
| WebKit (Safari engine) | 12 s | **stalled at 90% > 180 s** | arrangement in **2 s** |
| WebKit | 30 s | stalled | arrangement in **4 s** |
| WebKit | 150 s | stalled | arrangement in **10 s** |
| Chromium | 12 s | 8 s | 8 s (unchanged) |
| Chromium | 150 s | 89 s | 89 s (unchanged) |

## 5. Safari / WebKit test results

The Audio Vision acceptance suite run **in WebKit against the deployed site**:
**19/19 pass**, including

- `G3 main thread stays responsive` — worst heartbeat gap **47 ms** (the worker
  path stays alive, so inference never blocks the UI);
- `C1 guitar arrangement carries a six-line TAB staff`;
- `C2 TAB staff has six lines in standard tuning`;
- `A3 Open Score opens the generated arrangement` (not the previously imported
  PDF);
- `E1/E2 the arrangement survives a browser restart byte-for-byte and reopens
  in practice`;
- `H4 cancel stops the run and leaves the panel` (latency 51 ms).

Same suite in Chromium: **19/19**.

## 6. Successful piano and guitar generations

Live site, WebKit, 30 s of real audio:

- **Piano** → `Tempo 235 BPM · Notes 9 · Measures 6 · Recognized with neural
  pitch recognition · Confidence 29%` — a real arrangement in 3 s.
- **Guitar** → the same real arrangement in 3 s, and the acceptance suite
  confirms the generated score carries a **six-line TAB staff in standard
  tuning** alongside the standard notation staff.

## 7. Open Score and playback results
`A3 Open Score opens the generated arrangement :: arrangement surface, no PDF
canvas` and `B2 piano arrangement preview playback engages` both pass, on the
live site in WebKit. The corrected tempo survives into the opened score
(`D2 … MusicXML per-minute=93`).

## 8. Error and cancellation handling

Verified in WebKit (`scripts/audit/av-terminal-state-probe.mjs`):

| Scenario | Result |
|---|---|
| Unsupported file | Clear refusal, no generation started, panel gone |
| Malformed audio | Reported, not hung |
| Silence | Refused honestly |
| **Failure → retry** (same page, no reload) | **Real arrangement in 2 s** |
| **Generate twice** (tempo rebuild) | **Real arrangement in 2 s**, corrected tempo applied |
| **Cancel during generation** | Progress panel cleared, Arrange button back, no error |
| **Regenerate after cancel** | **Real arrangement in 2 s** |

Every operation now reaches exactly one of the three valid terminal states:
**success** (a real arrangement), **failure** (a clear message + retry), or
**cancelled** (clean stop).

## 9. Regression results

- **Unit:** 384 files, **3859 passed**, 19 skipped, **0 failed** (EXIT=0).
  New: `tests/audioVisionPitchWorkerEnv.test.js` (3), `tests/audioVisionPitchClient.test.js` (5).
  Audio Vision unit suites: 71/71.
- **Browser e2e:** 136/136 — practice-reliability 18, pdf-first-import 17,
  score-follow 17, audio-vision-edge 12, mobile-reliability 12, product-audio
  12, unified-practice-midi 25 (+1 skipped), unified-practice-mic 23 (+1
  skipped).
- **Audio Vision acceptance:** 19/19 in Chromium **and** 19/19 in WebKit,
  locally **and** against the live site.
- No Piano/Guitar Vision research merged. No change to PDF-first importing,
  Score Following, the Practice Engine, MIDI/microphone input, the Sound
  Engine, session persistence, MusicXML correctness, browser navigation or
  saved user data.

## 10. Deployed commit and Cloudflare version

- **Commit:** `709388e952` *(Audio Vision 90% stall fix)* on
  `bugfix/site-bug-hunt` — also fast-forwarded onto official `main`.
- **Cloudflare version ID: `8675f6c0-0e92-4733-8896-c16d01eadc7c`**
- **Live bundle:** `index-CmDq-RUP.js` (verified byte-identical to the local
  build). All routes return HTTP 200.
- Live re-verified after deployment: real 30 s piano **and** guitar
  generations complete in 3 s in Safari's engine, and the full acceptance suite
  passes 19/19 against `https://corranzo.com`.

## 11. Rollback

- Previous live version ID: `2c928f59-51cf-4f7f-9c2a-8d0b60a3aaba`
  (bundle `index-CYtLcE3a.js`).
- `npx wrangler rollback 2c928f59-51cf-4f7f-9c2a-8d0b60a3aaba`
- Git: `git revert <audio-vision-fix-commit>` on `bugfix/site-bug-hunt` /
  `main`, then rebuild and redeploy.

## 12. Remaining limitations

- The generation is refused when the arrangement's confidence is too low
  (a short synthetic test tone often lands in the low-confidence range). That is the honest
  behaviour, unchanged by this fix.
- The worker fallback path (when WebGL is unavailable in a worker) runs the
  model inline and blocks the UI for the model's duration. It is now a
  *fallback* rather than the WebKit default.
- The arrangement's own musical quality is bounded by the transcription's
  confidence, not by this fix.

## Bug ledger
| ID | Feature | Severity | Status | Commit |
|---|---|---|---|---|
| BH-005 | Score Following (cursor alignment) | P1 | Fixed | `2ad1a0b56b` |
| BH-006 | Score Following (blue boxes in Preview) | P2 | Fixed | `2ad1a0b56b` |
| BH-007 | Audio Vision (generation freeze / Open Score) | P1 | Fixed | `9272423a50` |
| **BH-008** | **Audio Vision (generation stalls at 90% forever)** | **P1** | **Fixed** | `709388e952` |
