# Audio Vision — unified Practice Engine + musical quality

**Branch** `main` · **Commits** `10175ad1e8` (one Practice Engine), `5959f79f73` (musical accuracy),
`7a43d7158b` (browser suites follow the unified engine)
**Live** https://corranzo.com
**Deployed** Cloudflare version `9aa81ec4-5fbc-46a7-862b-facb8a554257`
(bundle `index-C_qahCeC.js`, byte-identical to the local build; my own deploy of
the same bundle was `c8abbb82-0f93-4e10-ac5f-98827d1f6de9`)
**Rollback** `npx wrangler rollback 89f525b9-c724-4ec0-9b90-be2616a42671`
(the last deployment before the unified engine)

---

## 1. Why Audio Vision used a separate interface

`PracticeView` forked on the presence of a PDF:

```jsx
{!pdfFile ? (isPdflessNotationSource(musicXmlSource) ? <ArrangementPracticeView …/> : <empty/>) : <workspace-frame>…}
```

An arrangement is internally generated MusicXML with **no PDF**, so it took the
`ArrangementPracticeView` branch: its own header, its own three-button mode
switch, its own transport, and a note explaining that page-follow visuals need a
PDF. The normal workspace — the header, the full `WorkspaceTransport` dock, the
seek bar, the focus mode, the note guide, the tools panel, the score-follow
cursor — was never mounted for an arrangement.

The reason for the fork was real but the remedy was wrong: the *cursor* needed
PDF source-notehead geometry, so the whole workspace was abandoned instead of
just the cursor.

## 2. How it now uses the full Practice Engine

One workspace, two score surfaces:

```
PracticeView
└── workspace-frame            ← the normal chrome, for every score
    ├── workspace-header       Library · title · Score/Note guide · Focus
    ├── practice-workspace__main
    │   └── PdfViewer          (PDF score)      ← or
    │   └── OsmdScoreView      (engraved score) ← Audio Vision
    ├── workspace-dock         WorkspaceTransport: modes, play, tempo, seek, loop, sound
    └── WorkspaceTools         settings, input, loop, diagnostics
```

`ArrangementPracticeView` is deleted. The arrangement reaches practice through
the same `isPracticePlaybackReady` gate, the same session, the same engine.

## 3. Red cursor alignment

The cursor reads the **engraved noteheads**, not a PDF page:

* `pairOsmdNotes` already pairs every canonical (timing-map) note with the
  OSMD notehead it was engraved as — the same pairing the note-state painting
  uses.
* `engravedScoreCursor.js` turns that pairing into a position: the sounding
  note's notehead box → container pixels (the SVG's live scale, the container's
  scroll offset, the border width).
* The line travels across the **rest** before a note and lands exactly on the
  notehead as the note sounds (it does not slide away from a ringing note).
* The driver is a `requestAnimationFrame` loop reading `getScoreTime()` — the
  canonical audio clock. **No second practice clock.**
* Wait For You locks the line to the note the engine is waiting for, like the
  PDF surface does.
* OSMD's own green cursor is hidden: the score shows exactly one cursor.

Measured (real Chromium, real generated arrangement):

| measurement | value |
|---|---|
| cursor element on the engraved score | `display: block`, height 110–132 px |
| cursor x at t≈0 s / t≈2 s | 726 px → 1227 px (moves with the music) |
| note the cursor points at | `data-engraved-cursor-midi` / `-measure` (e.g. midi 69, bar 1) |
| median note-time error vs the reference | **0.006 s** (was 0.048 s) |
| WebKit (Safari engine) | 733 px → 1146 px, same behaviour |

## 4. Musical accuracy — the root causes

Measured with `scripts/browser-audio-vision-quality-eval.mjs`: a synthesized
piano piece with **known** notes, onsets and hands; the pipeline only ever sees
the audio; the real Basic Pitch model runs in its Web Worker; the resulting
MusicXML is compared with the reference. Pitch, onset, false-positive, missed,
event-F1, staff placement, MusicXML validity and playability are reported
**separately**.

The first measurement showed the transcription was already **pitch- and
onset-perfect** (1.0 / 1.0, zero missed) while the *arrangement* scored
**0.10–0.22** pitch accuracy. So the loss was in the arrangement, and there
were four concrete defects:

1. **The model's note strength never reached the arranger.** Basic Pitch
   returns an amplitude per note; the worker and the inline path dropped it, so
   the arrangement's harmonic-double suppression — which needs the amplitude to
   tell a real note from its octave — never ran. (The code was there, and
   measured; it was simply never reached.)
2. **The beat grid was anchored on a missed first onset.** The grid's phase
   decides where the bars fall. The first flux-picked onset was one beat late,
   so the recording's first beat and second beat were written into the same
   bar, and every note sat one beat early. The grid is now anchored on the
   earliest note the model heard — the earliest musical event known exactly.
   The spacing is unchanged: the same period, a different phase.
3. **Spurious notes were never corroborated.** A short transcribed note that
   lands where *no independent detector* heard an attack is a harmonic
   artifact. In an arrangement such a note is worse than useless: it lands
   between two real notes and **chops** them, because a voice can only hold
   one note — that is where the "awkward short note values" came from. The
   spectral-flux onset detector now corroborates every short note.
4. **The per-beat density budget was never applied.** `maxNotesPerBeat` was
   documented but dead: the cap ran per half-beat with the per-onset budget, so
   Intermediate could carry 6 notes per beat. The documented per-beat cap is
   applied now (the melody and the bass root are still protected).

## 5. Notation and playability improvements

* Extreme ledger lines: notes below MIDI 40 or above 84 fell from 20–36 to 0–6
  per arrangement (the range is not narrowed by transposing — spurious notes
  are removed, and the real bass stays).
* 16th-note stubs: 0 (they were created by the spurious notes chopping real
  ones).
* Density: 3.13 → 2.25 notes/second for Intermediate, so a 2:10 recording now
  yields roughly 290 practice targets instead of 1,035.
* Hands: the piano's hand agreement rose 0.875 → 0.969.
* MusicXML validity: 0 overfull and 0 underfull measures in all six
  configurations (checked by walking the written position the way a reader
  does, so a two-voice score is judged per voice).

## 6. Real-audio before / after

Reference: 51 known notes, 100 BPM, 19.2 s. Same audio, same model, same
thresholds — only the arrangement changed.

| metric (solo piano) | before | after |
|---|---|---|
| pitch accuracy (easy / interm. / adv.) | 0.098 / 0.157 / 0.216 | **0.627 / 0.627 / 0.824** |
| onset accuracy | 0.600 / 0.625 / 0.545 | **0.719 / 0.719 / 0.714** |
| event accuracy (F1) | 0.090 / 0.129 / 0.158 | **0.674 / 0.681 / 0.718** |
| false positives | 55 / 65 / 77 | **12 / 11 / 24** |
| missed notes | 46 / 43 / 40 | **19 / 19 / 9** |
| hand agreement | 1.00 / 0.875 / 0.818 | 0.938 / **0.969** / 0.857 |
| density (notes/second) | 2.55 / 3.13 / 3.77 | 2.30 / **2.25** / 3.46 |
| ledger-line notes | 4 / 8 / 10 | **0 / 0 / 6** |
| 16th-note stubs | 0 | 0 |
| overfull / underfull measures | — | **0 / 0** |
| transcription pitch / onset accuracy | 1.0 / 1.0 (unchanged) | 1.0 / 1.0 |
| transcription false positives | 38 | **22** |

Solo guitar follows the same shape (pitch 0.098 → 0.627, event F1 0.090 → 0.681).

## 7. WebKit / Safari results

`scripts/browser-audio-vision-unified-webkit.mjs` — **8/8 pass**, no console
errors, no page errors:

* the file probe works
* the arrangement is generated (the Web Worker inference runs in WebKit)
* the unified workspace is the normal Practice Engine
* all three practice modes are present
* the red cursor is on the engraved score (`display: block`, height 104 px) and
  moves with the music (733 px → 1146 px)
* Wait For You initializes with a target
* seeking moves the practice clock

## 8. Regressions

* Unit tests: **384 files, 3,859 tests, 0 failures** (`npx vitest run`).
* `npm run test:scripts`: exit 0.
* The PDF-first path is untouched: the PDF score still renders through
  `PdfViewer`, the same `ScoreFollowOverlay` cursor, the same score-follow
  setup. The browser regression guard (`scripts/browser-pdf-first-regression.mjs`)
  confirms the PDF practice workspace, its canvas and its modes are intact.
* The Audio Vision worker and progress fixes are preserved: the progress panel
  appears 31–37 ms after Generate, the stages advance with measured
  percentages, and the worst main-thread gap is 54–74 ms with **zero** long
  tasks.
* Guitar TAB is preserved: standard notation plus the six-line TAB staff.

## 9. Remaining musical limitations

* The transcription still produces ~20 spurious notes per 50 real notes on a
  clean synthetic piano piece. They are now corroborated against the onset
  detector, but a note that coincides with a real attack is still accepted.
* A long recording still takes ~30 s end to end; the interface stays responsive
  and the bar shows real progress.
* The Easy and Intermediate budgets are close on sparse material (the melody
  and the bass root are protected, so both land near two notes per beat); the
  difference is clear on dense material.
* The guitar's "hand" metric is meaningless (one voice) and is reported as-is
  rather than dressed up.
* Polyphonic-piano note-level truth against a real recording is still limited
  by the reference material available; the numbers above come from a
  synthesized piece with an exact reference, not from a commercial recording.
