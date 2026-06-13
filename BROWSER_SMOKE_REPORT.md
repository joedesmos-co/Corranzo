# ScoreFlow Browser Smoke Report

**Date:** 2026-06-12
**Repair/verification commit:** `b162fac` (on top of `1f4cdc2`)
**Environment:** Vite dev server + headless Chromium 131 (Playwright), Linux arm64 sandbox. Production build verified separately. iPad Safari requires the physical-device checklist at the end.

## Results summary

| Gate | Result |
|---|---|
| `npm test` | **64/64 pass** (10 files; was 59 — 5 new regression tests added) |
| `npm run test:scripts` | all 3 pass (pitch detection, auto-align heuristics, note-target position) |
| `npm run build` | **green** (1219 modules; sandbox note: `dist/` could not be emptied due to mount permissions, so build was verified with `--outDir /tmp/sf-dist`; on macOS `npm run build` works as-is) |
| `npm run lint` | **71 problems (64 errors, 7 warnings)** — down from 74/67; all 3 `no-undef` errors fixed; remainder is pre-existing `no-unused-vars`/react-hooks debt |
| Browser smoke | **17/17 (demo pass) + 3/3 (XML-only pass) + 5/5 (MXL/calibration/profile/annotation pass)**, zero console errors, zero page errors |

## Fixed startup/runtime issues

1. **Blank app on load — `ReferenceError: Can't find variable: filterTrustedAnchors`** (`useScoreFollow.js:143`). Phase 3 commit `2576e2a` rewrote the import block and dropped the `filterTrustedAnchors` import while keeping the call site. The helper still exists in `trustedAnchors.js` and is the correct one; the fix re-adds the import. Unit tests and `vite build` could not catch this (free identifiers are assumed runtime globals), which is why the app passed CI but rendered blank.
   *Regression guard:* `tests/staticIntegrity.test.js` runs ESLint `no-undef` over `src/` inside `npm test` and pins it at **zero**, so a missing identifier can never hide in general lint debt again (this one had been sitting in the 67 "known" lint errors).
2. **`process is not defined` latent crashes** in `demoBundledAnchors.js` and `scoreFollowDebug.js` — dual-environment guards now use `globalThis.process` (identical behavior in Vite and node scripts, and `no-undef`-clean so the guard test stays at zero).
3. **Annotations saved under one shared key for every PDF.** `PdfViewer` passes an object-URL *string* where a `File` was expected, so every score's annotations persisted as `scoreflow-annotations-undefined::undefined::undefined` — annotations leaked between scores and could overwrite each other. Annotations are now keyed by the same `fileName::size::lastModified` fingerprint used by score-follow anchors and session restore (`pdfMeta` threaded App → PdfViewer/PracticeView → `useAnnotationPersistence`). A one-time migration adopts the legacy bucket when its recorded `fileName` matches the open score; with no stable identity, persistence is skipped instead of writing a junk key. Covered by `tests/annotationFingerprint.test.js` and browser-verified (draw → key → reload → restore).
4. **Dead Safari notices.** `PracticeEnvironmentNotices` and `MidiInputStatusPanel` still keyed off legacy `isSafariPlaybackLimited()`, which now always returns `false` — so Safari/iPad users got no environment guidance, and the old notice copy ("Chrome or Edge recommended for playback") contradicted the current product (playback works on Safari after a tap). Both now use `isSafariFamilyBrowser()`, and the notice copy matches reality: tap Play once to unlock sound; Web MIDI is unavailable on Safari — use mic or Manual continue.

## Browser smoke checks (all pass)

Demo pass (PDF + MIDI + MusicXML): app loads non-blank; no fatal first-render errors; library/nav renders; demo score opens; PDF canvas renders; practice view opens; timing loads and Play enables; Play from a user gesture starts the clock (seek 9 → 70); score cursor renders during playback; pause/resume/seek/stop clean; tempo control visible (Speed %, effective BPM); metronome control visible; loop controls present; Wait For You section renders after switching practice mode; Setup/calibration collapsible opens and closes; refresh restores the session ("Restored your last practice session") without errors; zero uncaught ReferenceError/TypeError.

XML-only pass (PDF + MusicXML, **no MIDI**): Play is enabled, the synth clock advances, audio source indicator reads "MusicXML synth"; no errors.

Third pass: `.mxl` (zipped MusicXML with `META-INF/container.xml`) imports and enables play; manual calibration marking works end-to-end (Marked 0 of 32 → place marker → Marked 1 of 32 → Undo → Marked 0 of 32); Profile view renders; annotation pen stroke draws, autosaves under the per-PDF key, and survives reload.

## Feature checklist vs product definition

Legend: **A** works in code and tested · **B** works in code, browser-verified here, but not on a real device · **C** works in code, not browser/device verified · **P** partial

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | PDF display | A/B | react-pdf canvas renders (smoke) |
| 2 | PDF annotation | A/B | draw + per-PDF persistence + reload restore (smoke; fixed this pass) |
| 3 | MusicXML import | A/B | upload + timing load (smoke pass 2) |
| 4 | MXL import | A/B | generated .mxl imports (smoke pass 3) |
| 5 | MIDI import | A/B | demo set loads, "MIDI backing" indicator (smoke pass 1) |
| 6 | Parser document order | A | parserTiming: backup/forward, per-part divisions |
| 7 | Repeats | A | timelineExpansion suite |
| 8 | Voltas | A | single/multi-measure endings, voltas in second sections |
| 9 | Tempo changes | A | measure-start, mid-measure, beat-unit scaling tests |
| 10 | Tempo-rate control | A/B | rate-scaled display tempo test; Speed control visible (smoke) |
| 11 | Metronome | A/B | tick-alignment test; level control visible (smoke); audible tick needs device |
| 12 | XML-only synth playback | B | play enabled without MIDI, clock advances (smoke); audio audibility needs device |
| 13 | MIDI playback/backing | B | demo plays, clock advances (smoke); audio audibility needs device |
| 14 | Playback clock | A/B | engine tests + advancing seek (smoke) |
| 15 | Seek | A/B | slider seek without crash (smoke); engine seek tests |
| 16 | Pause/resume | A/B | smoke + engine pause-offset test |
| 17 | Loop | A | performed-domain loop tests (audit A-13 class); UI present (smoke); full loop-wrap cycle not browser-observed |
| 18 | Score-follow cursor | A/B | cursor node during playback (smoke) |
| 19 | Cursor through repeats | A | resolver + performed-timeline tests; not visually traced through a full repeat pass in browser |
| 20 | Cursor through missing anchors | A | interpolation + "no needsSetup flip" tests |
| 21 | Auto/semi-auto calibration | C/P | heuristics script test passes; conservative by design (may decline low-confidence scores); full in-browser auto-run not exercised |
| 22 | Manual calibration correction | A/B | mark + undo verified in browser (smoke pass 3) |
| 23 | WFY beat mode | A | performed-pass checkpoint tests; section renders (smoke) |
| 24 | WFY note mode | A | note checkpoints with repeat passes; UI present |
| 25 | Microphone input | C | pitch-detection script test passes; needs a real microphone |
| 26 | Web MIDI input | C | code present, unsupported-browser path handled; needs Chrome/Edge + device |
| 27 | Note target geometry | A | shared cursor-resolver geometry tests + script test |
| 28 | Practice stats | B/P | Profile view renders (smoke); tracker runs during sessions; metrics math has no dedicated unit test |
| 29 | Session persistence | B | reload restores files, view, and annotations (smoke) |
| 30 | iPad Safari readiness | C | UA amputation removed, gesture unlock wired (`Tone.start()` inside the click handler, error surfaced), visibility-resume present; **requires physical iPad test below** |

Nothing on the list is Missing, and no Broken item remains after this pass.

## Remaining limitations

- Audio is verified to schedule and advance the clock, not to be *audible* — headless cannot judge sound. Listen on real hardware.
- `probeAudioPlaybackCapability()` in `browserPracticeSupport.js` is currently unused (unlock errors surface through the play path instead). Harmless; candidate for later use or removal.
- Semi-auto PDF alignment is conservative on purpose; on scores it can't match confidently it asks for manual markers (demo ships bundled anchors).
- Lint debt remains at 71 (64 errors, 7 warnings), all pre-existing `no-unused-vars`/react-hooks classes; `no-undef` is now pinned to zero by a test.
- Mic and Web MIDI inputs need real devices; loop-wrap and long repeat traversal were verified at the domain level, not by watching minutes of playback.

## iPad Safari manual test checklist

On the iPad (Safari, iPadOS 17+), with Mac and iPad on the same network: run `npm run dev -- --host` on the Mac and open `http://<mac-ip>:5173`.

1. App loads to Library (no blank screen). Refresh once — still loads.
2. Tap **Try sample piece** — Practice opens, PDF renders sharply (retina), page fits.
3. Tap **Play** — first tap unlocks audio; sound starts within ~1s; cursor moves on the score.
4. Confirm the Safari tip notice appears and reads correctly (tap-to-unlock wording).
5. Pause → resume → drag the seek slider → Stop. No stuck audio, no console errors (connect Mac Safari → Develop → iPad to watch the console).
6. Lock the screen or switch apps mid-playback, return — audio resumes or pauses cleanly (visibility-resume path).
7. Set Speed to 75% — pitch unchanged, tempo slower, effective BPM updates; metronome on — ticks align at both 100% and 75%.
8. Loop: Set start / Set end on two measures inside the repeat — playback wraps at the loop end repeatedly without drift; Clear works.
9. Cursor: watch a full run of the demo including the repeat — cursor jumps back at the repeat barline and tracks the second volta correctly.
10. Wait For You (beat mode, Manual continue): playback pauses at checkpoints; **Continue** advances; works in fullscreen too.
11. Wait For You (note mode, microphone): grant mic permission; play/sing the target note — checkpoint advances; mic test panel shows level.
12. Annotation: draw with Apple Pencil and finger (pen + highlighter), erase, undo; leave Practice and return — strokes persist; force-quit Safari and reopen — strokes and session restore.
13. Upload a user PDF + MusicXML pair via the Files app — Practice opens, Play (synth) works without MIDI; mark 3–4 measures manually — approximate cursor appears.
14. Fullscreen (F / fullscreen button): HUD shows; side taps turn pages; exit cleanly.
15. Rotate portrait/landscape — layout stays usable; no crash.
16. Profile view opens; practice minutes from the session appear.
17. Leave the dev server, reopen the tab after 10+ minutes — session restore banner appears; nothing crashes.
