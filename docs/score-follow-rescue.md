# Practice score-follow rescue (codex/score-follow-wfy)

## 1. Root cause (why the bar felt "terrible")

1. **The cursor was never note-anchored.** The PDF playhead interpolates
   between per-measure (often per-system) anchors. Intra-measure x comes
   from MusicXML `default-x` when the file carries engraved positions, and
   falls back to time-proportional spacing otherwise. Scores without
   engraved `default-x` therefore get a *time guess*, not the engraved
   note column — the cursor drifts and never sits on noteheads.
2. **Wait For You hid the shared cursor.** `hidePlaybackScoreFollowCursor`
   replaced the playhead with an amber highlight plus an above-staff dot
   marker (`NOTE_TARGET_MARKER_OFFSET_Y`) — the "orange dashed cursor
   above the staff". A separate visual language read as a separate
   exercise.
3. **Play Along / Preview had no score note states**
   (`playAlongNoteTarget: null`): cursor only, zero color feedback.
4. **The dock dominated.** `workspace-your-turn` rendered a 27px
   "Your next notes PLAY C4" line and the transport's primary button
   became Continue.

## 2. What changed (evaluator untouched)

- **One cursor everywhere** (`PracticeSessionContext.jsx`): the hiding
  branch is removed. Preview / Play Along / WFY share the same playhead;
  only advancement behavior differs. Checkpoints, the bounded Play Along
  windows (150 ms early / 280 ms late), and all matchers are unchanged —
  the UI displays engine truth, never decides it.
- **Score note states** (`scoreNoteStates.js`, `useScoreNoteTargets.js`,
  `ScoreFollowOverlay.jsx`): blue required, green played, red error
  flash (CSS-timed, ~1.2 s), muted missed. Color is never the only
  signal: required events carry a "now" tick + aria-labels
  ("Play C5 at measure 1", "Chord at measure 2: 2 of 3 tones played").
- **Chord partials** (`waitForYouInputFeedback.js` now keeps
  `matchedIndices`; `noteTargetPosition.js` carries per-note MIDI into
  highlight boxes): per-tone green/blue split renders **only** from
  owned source noteheads (`individual-source-boxes`). Approximate
  highlights show the whole-event state + "n/m" text — never invented
  per-tone coordinates.
- **WFY dock** (`WorkspaceTransport.jsx`, `workspace.css`): single-line
  status ("Your turn · 3 of 90"), 19px target label, Continue demoted to
  a compact secondary button. Manual Continue / Hear it / Hint / Skip
  and all keyboard shortcuts are preserved (no-instrument practice
  still works).
- **Play Along / Preview** resolve the event under the playhead through
  the same `resolveNoteTargetPosition` geometry (steady, no pulse).
  Play Along maps lane outcomes onto score events by onset proximity
  (±11 ms); past misses render muted. Without connected input there are
  no accuracy claims — current event only.
- **Dev-only e2e path** (`useWebMidiInput.js`, `?e2e-midi=1`): synthetic
  MIDI fans out through the identical listener set as hardware note-ons.
  DEV-gated (`import.meta.env.DEV`); production builds expose nothing.

## 3. Source positioning matrix

| Source | Cursor | Note highlight | Blocker for note-level precision |
|---|---|---|---|
| PDF + MusicXML timing (default) | measure-anchor interpolation | approximate box/dot (dashed) | no notehead coordinates in PDF space |
| + OMR `sourceVisualMap` | same | exact per-notehead boxes | needs accepted OMR run for the score |
| MusicXML `default-x` present | onset-locked glide | onset-mapped x | files without engraved layout fall back to time-proportional |
| Generated notation / images | same anchor pipeline | approximate | same as PDF row |

No fake coordinates are manufactured: where geometry is approximate the
overlay keeps the dashed "approximate" treatment and the reason string
(e.g. "Approximate — staff or pitch on system").

## 4. Evidence

- Unit: `tests/scoreNoteStates.test.js` (9), `tests/scoreOverlayNoteStates.test.js`
  (4: current/completed, chord partial gating, wrong/missed, disabled).
- Browser: `scripts/browser-practice-score-follow-e2e.mjs` → 17/17 on
  Menuet in F, K.2 (real collection score): shared cursor in all modes,
  correct advance + green trail, wrong blocked + red flash, partial
  chord holds, full chord completes, zoom/fit-mode stable, zero console
  errors. Report + PNGs: `tmp/practice-score-follow-e2e/`.
- Full suite: pre-existing failures unchanged (8: 7 UI-copy/CSS
  assertion tests + 1 headless PDF-canvas env test); see final report.

## 5. Remaining issues / next step

- Intra-measure cursor precision on scores without `default-x` or OMR
  geometry is still time-proportional (honest fallback, documented
  above). Next step: promote OMR notehead geometry into the cursor's
  intra-measure glide (not just the WFY target), behind the existing
  OMR acceptance gate.
- `PracticeControlPanel.jsx` / `WaitForYouSection.jsx` are dead in the
  live workspace UI (only self-referenced); left untouched. Follow-up:
  delete or repoint.
- Multi-page trail: completed states render per page via the overlay;
  page-follow already tracks `data-practice-note-target` elements.
