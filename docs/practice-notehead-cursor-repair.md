# Corranzo — Practice Notehead & Cursor Repair: Recovery, Fixes and Release Report

This report continues the interrupted GPT/Codex repair of the practice UI. It
records what was recovered, what was finished, what was measured, and what was
deployed.

## 1. Recovery of the interrupted work

The interrupted agent's work was **found intact** and was continued in place —
nothing was reset, cleaned, stashed or rewritten.

| | |
|---|---|
| Isolated checkout | `/Users/ryland/Documents/scoreflow-live-rescue` |
| Branch | `codex/live-practice-rescue` (at `de243f1d1d`, the then-current `main`) |
| Uncommitted work | 15 modified tracked files + 2 new files, ~250 insertions / ~370 deletions |
| Last edits by the interrupted agent | 2026-10-21 08:24–08:30 local |
| Main repository | `/Users/ryland/Documents/scoreflow` — untouched (`git status` clean apart from pre-existing `tmp/` artifacts) |
| Other worktrees | `scoreflow-bughunt`, `scoreflow-audio-vision`, `scoreflow-guitar`, `scoreflow-integration`, `scoreflow-live-rescue`, `scoreflow-mic-reliability`, `scoreflow-piano-unblock`, `scoreflow-product-preview`, `scoreflow-scorefollow-precision` — all preserved |
| Practice Engine stash | `stash@{0} protect-practice-engine-wip-modifications` — preserved untouched |

The interrupted agent's own artifacts were recovered with the checkout:
`scripts/browser-live-practice-rescue.mjs`, `src/features/practice/ownedNoteheadGlyphs.js`,
`tests/playbackEngine.test.js` (pending-cancellation tests) and the browser
evidence under `tmp/live-rescue/`.

### What the interrupted agent had already implemented

1. **Removed the fabricated PDF notehead markers** — `NoteheadFeedbackLayer.jsx`
   reduced to accessible text; `cz-notehead` shapes no longer drawn.
2. **Restored the WFY checkpoint glide** — `useScoreFollowDisplayCursor.js`
   gained a `smoothCheckpoints` transition; `PracticeSessionContext.jsx` stopped
   forcing the cursor onto each checkpoint (`wfyCheckpointCursor = null`), so the
   calibrated motion timeline owns PDF positions again.
3. **Fixed the audio-cancellation race** — `scorePlaybackEngine.js` gained a
   `playRequestGeneration` guard; `referenceNotePlayer.js` a `referenceGeneration`
   guard; `usePracticeSession.js` pauses the engine even before `isPlaying`
   commits.
4. **Fixed Audio Vision engraving** — `arrangementMusicXml.js` now writes a
   correct `<type>`/`<dot>` per duration and ties split notes;
   `osmdEngraving.js` converts OSMD whole-note timestamps to quarters and owns
   the correct voice/staff; `useOsmdEngraving.js` paints the real glyph paths,
   keeps OSMD's natural width and re-renders on resize; `osmd.css` stops the
   SVG being stretched to the container width.
5. **Added per-note glyph ownership** — `ownedNoteheadGlyphs.js` gives each
   chord member exactly one notehead, so a chord is no longer coloured as a
   group.

### What was still unfinished when the usage limit was reached

- The WFY cursor glide was implemented but **unverified** (its probe used a
  600 ms sampling window that could close before the transition, so it reported
  only 2–4 intermediate frames).
- `tests/scoreOverlayNoteStates.test.js` was **left failing** — it still
  asserted the fabricated notehead shapes that had just been removed.
- The PDF feedback had been reduced to screen-reader text only: accurate, but
  invisible, so a correctly played note gave the musician **no** feedback.
- The Audio Vision engraving fixes were **never re-verified in a browser**.

## 2. Root cause and the decision about PDF noteheads

### Measured, not assumed

`scripts/audit/pdf-notehead-geometry-accuracy.mjs` and
`scripts/audit/pdf-notehead-closeup.mjs` were run against the **pre-fix**
build (the `scoreflow-bughunt` worktree, still at the old commit) and measured
the app's computed notehead geometry against the ink actually printed in the
PDF canvas.

The close-up (`tmp/pdf-notehead-geometry/closeup-old.png`, 3× device pixel
ratio) is unambiguous: the blue "notehead" ring **floats in blank paper
between the two staves**, and the second ring **sits on top of the `3/4` time
signature** and the red cursor — neither is on a printed notehead. The
reported regression (≈74 px below, ≈20 px left) is reproduced.

**Therefore the PDF surface has no reliable pixel-accurate notehead
technique.** The score pipeline's PDF notehead position is an *estimate*
(OMR source geometry, or a staff-sized approximation when the score owns no
exact head), and a PDF page is a raster canvas whose noteheads are printed ink
rather than addressable glyphs. Drawing anything at that estimate produces a
marker that floats near — but not on — the printed note.

### What was done instead

- **The PDF score surface draws no notehead feedback at all.** The printed
  notation stays black and untouched, and the red playback cursor keeps
  marking the musical position. Verified: `cz-notehead` count = 0 and
  `score-follow-overlay__note-highlight` / `__note-target` count = 0 in
  Chromium **and** WebKit.
- **The recognition result is reported in the practice controls**, where it is
  exact — the engine already knows which note it asked for and which note was
  played. New `src/components/practice/ScoreFeedbackChips.jsx` renders one chip
  per note: a played note is a solid blue chip with a tick, a wrong attempt or
  a miss is red, and the note still waiting is outlined in the neutral
  engraving colour. Chord members are separate chips, so an unplayed member is
  never mistaken for a played one; repeated notes are separate checkpoints, so
  each occurrence gets its own chip in order.
- **The engraved (OSMD/MusicXML) surface still paints the real notehead
  glyphs** — there the noteheads *are* addressable, and each is coloured
  individually. Measured: the painted glyph's centre matches the printed
  glyph's bounding box **within 1 px**, and only the recognised chord member
  is blue.

**No PDF notehead is recoloured, because no PDF notehead is recoloured.** The
PDF surface reports recognition in the controls; the engraved surface reports it
on the notehead itself. Neither surface draws a substitute note shape.

## 3. The red cursor

### The bug

Wait For You forced the cursor onto each new checkpoint, which bypassed the
approved motion-timeline movement. Measured on the **live site before the
fix**, in both engines:

```
distinct cursor positions across one checkpoint change : 2
largest single-frame jump                               : 41.06 px
```

That is a teleport: the cursor was on one note, then on the next — it covered
the **entire** 41.06 px gap in a single frame.

### The fix

- `useScoreFollowDisplayCursor.js` — the checkpoint transition is now an
  explicit, bounded, eased glide (180–420 ms, scaled by the distance), which
  interpolates **x and y**, and works in either direction (a checkpoint can sit
  further left after a repeat). It is *additive*: it never changes where the
  cursor lands, only how it gets there. A page change is still an immediate
  move, because the bar appears on a different surface.
- `PracticeSessionContext.jsx` — the WFY checkpoint lock stays removed, so the
  calibrated motion timeline owns PDF positions in every mode.
- `OsmdScoreView.jsx` — the engraved surface got the same treatment.

### Measured after the fix

| surface | engine | distinct positions | largest frame jump |
|---|---|---|---|
| WFY checkpoint change (live, after deploy) | Chromium | 14 | 10.0 px |
| WFY checkpoint change (live, after deploy) | WebKit | 10 | 8.8 px |
| WFY checkpoint change (local) | Chromium | 14 | 11.1 px |
| WFY checkpoint change (local) | WebKit | 8 | 16.8 px |
| Play Along, continuous (live) | Chromium | 157 frames in 2.6 s | **2.09 px**, 0 backward steps |
| WFY while waiting | Chromium + WebKit | held still (drift < 0.1 px) | — |

The journey is 41.06 px. Before the fix the cursor covered **all 41.06 px in a
single frame**; after the fix no single frame covers more than half of it. The
cursor **holds on the required note** while the musician plays, and the single
canonical practice clock is unchanged.

## 4. Audio cancellation

The race: a Play request begins loading an instrument, the user presses Pause,
and the pending load later finishes and starts the music anyway.

Fixed with generation counters that a pause/stop/seek/dispose invalidates:
`scorePlaybackEngine.js` (`playRequestGeneration`), `referenceNotePlayer.js`
(`referenceGeneration`), and `usePracticeSession.js` (pause the engine even
before `isPlaying` commits).

`tests/playbackEngine.test.js` — **4 tests pass**: no playback starts after
`pause`, `stop`, `seek` or `dispose` while the instrument is still loading.
Browser-level confirmation: pressing Play and then Pause 40 ms later leaves
the transport stopped and the position unchanged.

## 5. Audio Vision engraving

Verified with the existing suites plus new engraving assertions:

- `browser-audio-vision-critical-ux.mjs` — **19/19 pass** (import → arrangement,
  Open Score opens the *arrangement*, piano arrangement opens and previews,
  guitar six-line TAB in standard tuning, corrected tempo, persistence across
  a browser restart, second arrangement wins, progress and main-thread health,
  and the four failure modes).
- `browser-audio-vision-unified-webkit.mjs` — **12/12 in WebKit, 12/12 in
  Chromium**, including four new engraving assertions:
  - the cursor follows the **notation** staff, never the TAB copy;
  - the engraving keeps its **natural width** (the SVG is never scaled up past
    its own engraving width);
  - a **short score is not stretched** across the workspace (455 px of natural
    trailing space on the probe score);
  - the guitar arrangement keeps standard notation **and** a separate TAB staff.

## 6. Regression results

| suite | result |
|---|---|
| `npm test` (vitest, 389 files) | **3876 passed, 19 skipped, 0 failed** (EXIT=0) |
| `browser-live-practice-rescue.mjs` (Chromium, local) | 14/14 pass |
| `browser-live-practice-rescue.mjs` (WebKit, local) | 13/13 pass (the MIDI-injection checks are Chromium-only — WebKit has no Web MIDI) |
| `browser-practice-surface-regression.mjs` (Chromium, local) | 11/11 pass |
| `browser-audio-vision-critical-ux.mjs` | 19/19 pass |
| `browser-audio-vision-unified-webkit.mjs` | 12/12 WebKit, 12/12 Chromium |
| `browser-practice-reliability-e2e.mjs` | 18/18 pass (import, wrong note, partial chord, repeated notes, restart, mode switch, **switch songs**, no stale score data) |
| `browser-pdf-first-regression.mjs` | 4/4 pass (PDF import → Open score → the PDF practice workspace, all three modes intact) |

### Against the **live** site after deployment

| suite | engine | result |
|---|---|---|
| `browser-live-practice-rescue.mjs` | Chromium | 7/7 pass — 0 drawn shapes, 14 intermediate cursor positions, largest frame jump **10.0 px** (bound 20.5 px), cursor holds while waiting, transport frozen in WFY |
| `browser-live-practice-rescue.mjs` | WebKit | 7/7 pass — 0 drawn shapes, 10 intermediate positions, largest frame jump **8.8 px** |
| `browser-practice-surface-regression.mjs` | Chromium | 11/11 pass — Play Along cursor 157 continuous frames, largest jump **2.09 px**, 0 backward steps; pause during instrument loading never starts the music; fit page / fit width / resize / scroll / tempo all clean |
| `browser-audio-vision-critical-ux.mjs` | Chromium | **19/19 pass** (guitar six-line TAB, tempo correction, persistence across restart, all four failure modes) |
| `browser-audio-vision-unified-webkit.mjs` | WebKit | **12/12 pass** (cursor on the notation staff, natural width, short score not stretched, separate TAB staff) |

The MIDI-injection checks cannot run against a production build (the hook is a
development affordance compiled out of production), so they are reported as
*not applicable* on the live site rather than as passed.

## 7. Files changed

**Recovered and continued (interrupted agent):**
`src/components/pdf/NoteheadFeedbackLayer.jsx`,
`src/components/practice/OsmdScoreView.jsx`,
`src/context/PracticeSessionContext.jsx`,
`src/features/audio-vision/arrangementMusicXml.js`,
`src/features/playback/scorePlaybackEngine.js`,
`src/features/practice/engravedScoreCursor.js`,
`src/features/practice/osmdEngraving.js`,
`src/features/practice/referenceNotePlayer.js`,
`src/features/practice/useOsmdEngraving.js`,
`src/features/practice/usePracticeSession.js`,
`src/features/score-follow/useScoreFollow.js`,
`src/features/score-follow/useScoreFollowDisplayCursor.js`,
`src/styles/osmd.css`,
`tests/audioVisionArrangement.test.js`,
`tests/playbackEngine.test.js`,
`src/features/practice/ownedNoteheadGlyphs.js` (new),
`scripts/browser-live-practice-rescue.mjs` (new).

**Completed in this session:**
`src/features/score-follow/useScoreFollowDisplayCursor.js` (hardened glide),
`src/components/practice/OsmdScoreView.jsx` (hardened glide),
`src/components/practice/ScoreFeedbackChips.jsx` (new — the PDF practice
feedback),
`src/components/practice/WorkspaceTransport.jsx`,
`src/components/pdf/NoteheadFeedbackLayer.jsx`,
`src/components/pdf/ScoreFollowOverlay.jsx`,
`src/features/practice/noteheadFeedback.js` (shared palette + shared state
description),
`src/styles/workspace.css`,
`tests/scoreOverlayNoteStates.test.js` (new contract),
`tests/scoreFeedbackChips.test.js` (new),
`scripts/browser-practice-surface-regression.mjs` (new),
`scripts/audit/pdf-notehead-accuracy-probe.mjs` (new),
`scripts/audit/pdf-notehead-closeup.mjs` (new),
`scripts/audit/pdf-notehead-geometry-accuracy.mjs` (new),
`scripts/audit/audio-vision-dom-dump.mjs` (new),
`scripts/browser-audio-vision-unified-webkit.mjs` (engraving assertions).

## 8. Deployment

**Ownership.** No other `wrangler` process was running, and no other agent
session held the deploy; the deployment was made from the canonical `main`
worktree (`/Users/ryland/Documents/scoreflow`) after the commit was fast-
forwarded onto `main` and pushed, so the deployed tree and the published git
tree are the same bytes.

| | |
|---|---|
| Commit | `2c6fa3bbaf` — *fix(practice): lengthen the WFY checkpoint glide and judge it by travel distance* |
| Branch history | `codex/live-practice-rescue` (`c2aa2fa223` → `2c6fa3bbaf`), fast-forwarded onto `main`, pushed to `origin/main` |
| Cloudflare version ID | **`2dfa5472-b9d4-43aa-8d91-8af12b7f7760`** |
| Live bundle | `assets/index-nKtwCllR.js` (byte-identical to the local build) |
| Routes | `/`, `/privacy`, `/terms`, `/contact` → HTTP 200 |
| Previous live version (rollback target) | `9ce1c710-96fc-4827-8bcb-53d8cf6a226b` (bundle `index-WAVIfkxz.js`) |
| Intermediate version | `d82376f9-8de2-49e8-b578-d4392d069fab` (bundle `index-BzfNBIlm.js`) — the first deploy of this session, superseded by the glide refinement |

```bash
npx wrangler rollback 9ce1c710-96fc-4827-8bcb-53d8cf6a226b   # back to the pre-repair release
git revert 2c6fa3bbaf c2aa2fa223                             # on main, then rebuild and redeploy
```

**Live verification** (all against `https://corranzo.com`, production build):

| what | Chromium | WebKit |
|---|---|---|
| PDF score draws **no** fabricated note shape | 0 | 0 |
| WFY cursor intermediate positions | 14 | 10 |
| WFY cursor largest single-frame jump | 10.0 px | 8.8 px |
| WFY cursor holds on the required note | yes | yes |
| Play Along cursor | 157 continuous frames, 2.09 px max jump, 0 backward steps | — |
| Pause during instrument loading | music never started | — |
| Zoom (fit page / fit width), resize, scroll, tempo | clean | — |
| Audio Vision critical UX | 19/19 | — |
| Audio Vision unified + engraving | — | 12/12 |

### Before / after, same pixels

- `tmp/pdf-notehead-geometry/closeup-old.png` — **before**: two light-blue
  rings floating in blank paper and over the `3/4` time signature.
- `tmp/pdf-notehead-geometry/closeup-live-after.png` — **after (live)**: the
  identical region shows only clean printed notation and the red cursor.
- `tmp/live-rescue/chromium-after/pdf-controls-feedback.png` — the practice
  controls reporting the recognition result (blue ticks for played notes, the
  required note outlined).

## 9. Remaining limitations

- **No PDF notehead is recoloured.** The PDF surface reports recognition in the
  practice controls instead. Colouring the *printed* ink would need a raster
  ink-analysis pass (isolating a notehead blob from the staff line, ledger
  line, stem and beam it touches) — that is a real piece of work and was not
  attempted here, because the upstream geometry is not accurate enough to
  locate a notehead reliably in the first place.
- The engraved surface colours the real notehead **glyph**; it paints the
  glyph's own path, so the engraved shape is preserved (filled / half / whole)
  rather than being covered by a substitute oval.
- MIDI-driven acceptance uses the app's own MIDI matcher through the dev
  injection hook. **No physical microphone or controller was used.**
- `moveOsmdCursor` in `src/features/practice/osmdEngraving.js` is dormant
  (no production caller) and its unit convention predates the quarter-unit
  correction; it was left untouched.
- `tests/scoreOverlayNoteStates.test.js` was rewritten to the corrected
  contract: the PDF overlay must draw **no** fabricated note shape at all, and
  must still expose every state accessibly. This is a stricter guarantee than
  the previous contract, not a weaker one.
