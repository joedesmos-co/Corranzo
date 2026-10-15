# Practice-clock render-loop repair (2026-10-14)

Branch: `codex/unified-practice-audio-preview` (worktree
`~/Documents/scoreflow-product-preview`), based on `8cac636a54`.

Scope: the intermittent React **"Maximum update depth exceeded"** warning during
Corranzo practice playback. No PDF-first import changes, no new import modes, no
UI work, no mobile packaging.

---

## 1. Reproduction

`scripts/browser-practice-clock-repro.mjs` — real Chromium, real React, nothing
suppressed. Known trigger set (from prior QA + the Score Following research
branch): open a practice score, arm the microphone, drive
**Play Along + playing + active input**, then perturb with mode switches, seeks
and pause/resume inside a bounded window.

Optional `--trace` records the call stack of **every React state dispatch whose
value actually changed** (test-harness only; product source and React are
untouched, and traced setters keep a stable identity via a WeakMap on React's
own dispatch, so no extra churn is introduced).

Results, 45–90 s windows:

| build | warnings |
|---|---|
| pristine `8cac636a54` | 2–10 per window (6 in a 45 s window, 10 in a 70 s window) |
| fixed | **0** — eight consecutive windows (45/50/70/90 s), incl. the mode-switch and seek perturbations |
| fixed, mic fixture active | `heard=64` (detector still working, not silenced) |

The same suite previously classified this warning as
`knownPreExisting` in `browser-unified-practice-mic-e2e.mjs` (29 hits/90 s on an
unrelated branch); that suite now reports **0 known-pre-existing warnings**.

## 2. Root cause

React logs the warning from `nestedPassiveUpdateCount > 50`: a sustained chain of
commits, each of which schedules an update from a passive effect. The counter only
resets when a commit's passive effects schedule nothing — so any pause in the
render triggers silently clears it. That is why the defect looked intermittent:
it needed playback to keep the triggers coming.

Dispatch attribution (real state changes only) shows the practice tree sustaining
~20–30 dispatches per 250 ms during playback. Three defects owned that load, all
in the practice-clock/PDF-overlay lifecycle — **not** the score-follow cursor:

1. **PdfPageFrame allocated `innerLayout` on every render** (`{ left: 0, top: 0,
   width, height }` literal) and passed it to `AnnotationLayer`, whose measurement
   effect depended on that object's **identity**. A new reference therefore re-ran
   the effect on every render, and the effect called `setState`.
2. **AnnotationLayer stored the whole `getBoundingClientRect()`.** A DOMRect's
   `left`/`top` change on every scroll event, so the page-follow RAF loop (which
   sets `container.scrollTop` every frame) re-rendered the annotation layer
   continuously. Only `pageRect.width` is ever read.
3. **`useScorePlayback`'s deferred time flush defeated its own throttle.** The
   `requestAnimationFrame` branch also reset `lastTimeEmit`, so the documented
   100 ms / 10 Hz React display rate silently became ~60 Hz: 1824 `currentTime`
   dispatches in a 55 s playback window instead of ~550.

Fixes (narrow, no architectural rewrite):

- `PdfPageFrame`: memoize `innerLayout` on `overlayLayout`; value-guard the
  overlay-layout state update (equal box ⇒ same object, so React bails out).
- `AnnotationLayer`: depend on the layout's **values**, not its identity; store
  `{ width, height }` guarded by value.
- `useScorePlayback`: defer the remainder of the display interval with a timer
  that honours `TIME_UPDATE_INTERVAL_MS`, and clear it on unmount.

## 3. Regression coverage

`tests/pdfAnnotationLayerRenderLoop.test.js` renders the real component with the
real React runtime and asserts the measurement effect does **not** re-run (does
not re-subscribe its scroll/resize listeners) when handed a new-but-equal layout.
Against the pristine parent it reports **20** subscriptions across 10 re-renders
and fails; with the fix it reports **0** and passes.

## 4. Score Following tie integration

Ported selectively from research commit `f04b96f29b` (its tie fix `27736310b8`):
tie-chain duration accounting at every layer. Only the tie repair and its
regression coverage came across — no Piano/Guitar/Audio Vision research changes,
no timing-validation or overfull-file experimental work, no import changes.

Three defects closed: double-counted continuation durations in WFY checkpoints
(2q+2q read as 6q, 38 of Brahms lullaby's 39 chains inflated); chain identity
matched by part/voice/pitch so an unrelated same-pitch chain absorbed another
chain's continuation (52 chains across 7 scores drew a sustain bar across
unrelated measures); voice-less tie-stops re-attacking because `<voice>` is
optional in MusicXML.

Verification: `tests/tieDurationIntegrity.test.js` 14/14 and
`scripts/measure-tie-duration-integrity.mjs` 11/11 (parser == WFY checkpoint ==
visual-lane group == playback onset on every case and every library score).

## 5. Verification summary

- Unit suite: 3767 passed / 2 failed + 25 skipped, versus a recorded pristine
  baseline of 3743 passed / 10 failed. Every remaining failure is pre-existing
  (`audioArrangementMusicXml` — needs a locally generated fixture that was lost
  with the worktree directory and is now regenerated; `finalMicLowNoteCorpus`,
  `neuralLiveInjection`, `micPolyphony*`, `spiderDanceCalibration`,
  `sourceFaithfulZeroDefectBaseline`, `scoreFollowMotionModel` — all pass in
  isolation and are CPU-contention flakes under the full suite, and all failed
  identically at pristine baseline).
- `npm run build` green. `npm run lint` introduces no new findings (the 4 findings
  in the touched files are identical at the pristine parent).
- Browser: `browser-unified-practice-midi-e2e` 26/26,
  `browser-practice-score-follow-e2e` 17/17,
  `browser-pdf-first-import-e2e` 17/17 (no update-depth warning),
  `browser-unified-practice-mic-e2e` 23/23 (0 known-pre-existing warnings),
  `browser-cross-engraving-e2e` 7/7 (no update-depth warning),
  `browser-practice-reliability-e2e` 18/18,
  `browser-long-arrangement-e2e` 7/7 (32 measures / 144 noteheads),
  `browser-musescore-import-e2e` 30/30 (751 / 2221 / 479 checkpoints),
  `browser-tempo-acceptance-e2e` 5/5.
- Node generality: `measure-score-follow-precision.mjs` 24/24 scores, 7–150
  measures, 28–2221 checkpoints, 0 wrong-page, 0 NaN, no hardcoded geometry.

## 6. Remaining blockers / next milestone

1. **13 flagged overfull library scores** still need an authoritative re-export
   (voices preserved) from their notation sources; the per-written-measure WFY
   fallback keeps them honest in the meantime (Score Following limitation, not a
   practice-engine one).
2. **19 dangling tie-stops** in those same flagged files — a source defect with no
   in-file evidence to pair them.
3. Reference playback ("Hear it") uses a fixed 0.55/0.7 s duration rather than the
   note's sounding duration — a fidelity gap, now easier to close because chain
   durations are correct at every layer.
4. The remaining sustained dispatch load during playback is RAF-driven
   (`usePlayAlongVisualCheckpoint`, mic feedback resets, the 80 ms Play Along miss
   interval). The warning is gone, but the dispatch rate is still reducible if
   further headroom is wanted.
