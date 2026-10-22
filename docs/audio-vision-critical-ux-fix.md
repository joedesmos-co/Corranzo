# Audio Vision — critical UX repair (generation freeze + wrong score)

**Deployed to** https://corranzo.com
**Commit** `0581658f62` (fix) + `c4c4039ef8` (live-run test hook)
**Cloudflare version** `467bada0-d6df-40db-9769-223a84455eb8` (this deploy;
the site is now serving `022cc97c-1625-4392-a1ef-ba5b008f664c` from the same
build — identical bundle `index-DAJyk8Ct.js`)
**Rollback target** `250d5a82-d985-46bb-8073-3e7cbf00a5de` (the version that was
live immediately before this deploy) —
`npx wrangler rollback 250d5a82-d985-46bb-8073-3e7cbf00a5de`

## Bug 1 — generation froze the interface, the progress bar appeared late

**Root cause.** The whole pipeline ran on the main thread as one long task:

| what | cost on a 30 s recording |
|---|---|
| Basic Pitch inference | one hard 1–3 s block per 2 s model window (~15 windows) — the model itself, not our code |
| HPSS median filter | allocated and sorted a fresh array for **every** output sample (≈2.6 M sorts) |
| the spectrogram | computed **twice** (once for the analysis views, once inside `analyzeMusic`) |
| React paint | never happened between stages, so the panel showed one label for 17 s |

Measured before the fix: **worst main-thread gap 3679 ms**, one 3.6 s long task,
progress bar visible but frozen.

**Fixes**

1. `src/features/audio-vision/audioVisionPitchWorker.js` (new) — Basic Pitch runs
   in a Web Worker. Same model, same thresholds (onset 0.5, frame 0.3), same
   22 050 Hz mono input, so **the notes are identical**; only the thread changed.
   The worker reports the model's real per-window progress.
2. `src/features/audio-vision/audioVisionPitchClient.js` (new) — main-thread
   client with an inline fallback if workers are unavailable.
3. `dsp.js` — the median filter reuses one buffer and uses an insertion sort
   (identical medians, a fraction of the cost). `magnitudeSpectrogram` and
   `hpssMasks` yield to the event loop every 64 frames/bins.
4. `sourceSeparation.js` / `musicAnalysis.js` — the spectrogram is computed once
   and reused; every stage boundary yields, so the panel paints between stages
   and cancellation is honoured promptly.
5. `audioArrangementPipeline.js` — real stage reporting (decode, preparing,
   spectrogram, onsets, tempo, beats, harmony, melody-bass, sections, notes,
   arranging, notation, done) plus a cancellation check at each boundary.
6. `useAudioArrangement.js` — the first state update is flushed synchronously
   (`flushSync`), so the progress panel is in the DOM before any heavy work.
7. `CreateFromAudio.jsx` + `collection.css` — stage labels name the real work, a
   measured percentage is shown when one exists, an honest sliding bar when it
   does not, and the model progress advances the bar 90% → 92%.

**Measured after the fix (live site, 30 s recording)**

| metric | before | after |
|---|---|---|
| progress panel visible after Generate | late (after the first block) | **31–37 ms** |
| worst main-thread gap | 3679 ms | **54–69 ms** |
| long tasks (>50 ms) | 1 × 3627 ms | **0** |
| distinct stage labels | 1–2 | **6+**, with real percentages |
| arrangement result | — | identical notes (60 notes, 8 measures, 61 % confidence, 43 % agreement) |

## Bug 2 — "Open Score" opened the previously imported PDF

**Root cause.** `handleAudioArrangementReady` (App.jsx) set the arrangement's
MusicXML but left the previous PDF in place. The practice workspace is PDF-first
(`!pdfFile ? … : <PDF workspace>`), so the old score was still the active score
and the "Bring your score" screen still showed *Menuet in F, K.2 - Piano.pdf*.

A second cause sat behind it: a **restored** arrangement session was treated as
a legacy notation-only score, so after a reload the app landed on Import asking
for a matching PDF instead of returning to the arrangement.

**Fixes**

1. `handleAudioArrangementReady` releases the stale PDF state (the imported file
   itself is **not** deleted — it stays in the library and can be reopened).
2. `handleSessionRestore` recognises an audio-arrangement session and restores
   it straight into the practice workspace, on the view it was saved on.

## Also fixed

* The arrangement transport never showed "Pause": the practice session object is
  deliberately tick-stable, so `session.playback.isPlaying` was frozen. The
  transport now reads the tick context, and sound errors are surfaced.
* Guitar arrangements engrave as standard notation **plus** a six-line TAB
  staff in standard tuning.

## Verification

`scripts/browser-audio-vision-critical-ux.mjs` — 19 checks, real Chromium, real
audio generation, isolated browser profile:

```
E2E_BASE_URL=https://corranzo.com/ node scripts/browser-audio-vision-critical-ux.mjs
```

| test | what it proves | result |
|---|---|---|
| A1–A3 | PDF imported first, then an arrangement: Open Score opens **the arrangement**, not the PDF | PASS |
| B1–B2 | piano arrangement opens its own practice surface and previews | PASS |
| C1–C2 | guitar arrangement carries a six-line TAB staff in standard tuning | PASS |
| D1–D2 | a corrected tempo reaches the opened score (MusicXML `per-minute`) | PASS |
| E1–E2 | the arrangement survives a browser restart and reopens in practice | PASS |
| F1 | two arrangements in a row: the second is the active score | PASS |
| G1–G3 | progress visibility, stage progression, main-thread responsiveness | PASS |
| H1–H4 | cancel, malformed audio, silence, unsupported file — no infinite waits | PASS |

`scripts/browser-audio-vision-progress-probe.mjs` — the latency / long-task /
stage-timeline measurement above.

Unit tests: `npx vitest run` → **380 files passed, 3846 tests passed, 0 failed**
(main, after the fix). `npm run test:scripts` → exit 0.

## Known limits (unchanged)

* 2 of 3 tempo locks (funk3, rock2) still cannot be resolved automatically from
  onset-domain evidence; the user tempo override exists and now persists.
* A 2/3-minute recording still takes ~30 s end to end (the model is the cost);
  the interface stays responsive throughout and the bar shows real progress.
* Polyphonic-piano note-level truth is still unavailable (Vienna MIDI/audio
  drift).
