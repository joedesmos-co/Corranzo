# Phase D — Score Workspace, ready for visual review

**Update:** Phase D was approved. Its composition and control model remain accepted. The subsequent focused polish pass is documented in the [Phase E review](PHASE_E_REVIEW.md); the report below preserves the Phase D checkpoint.

20 September 2026 · `codex/corranzo-ui-overhaul-v1`  
Worktree: `/Users/ryland/Documents/scoreflow-ui`

Stage 1 was approved. Phase D is implemented and stops here for the requested visual review. No later feature phase, deployment, commit or pull request has been started.

## Composition

Home and Library retain the approved warm collection identity. The workspace uses dark, quiet chrome around warm score paper. The collapsed navigation rail, restrained vermilion, editorial title and typography connect the two environments without turning practice into another collection page.

The PDF opens at reading width. At 1440 × 1000, the score canvas occupies more than 70% of the viewport, and the paper uses more than 90% of that canvas width. Fit page remains available for an overview. Width fitting was also corrected to start at the top of the page instead of vertically centering a tall page and clipping its beginning.

There is one mode selector and one transport. Tools appear only when requested. Focus expands the workspace across the app viewport, removes navigation, traps keyboard focus and keeps the same transport and an explicit exit. This is app focus, not the browser's native fullscreen API.

## Review screenshots

These captures use the bundled Mozart score and the working app, not mockups. The responsive captures wait for actual notation to be drawn after the PDF resizes.

| Screen | Screenshot |
|---|---|
| Preview, 1440px | [Preview](phase-d/preview.png) |
| Play Along | [Play Along](phase-d/play-along.png) |
| Wait For You | [Wait For You](phase-d/wait-for-you.png) |
| Focus | [Focus](phase-d/focus.png) |
| Wide desktop | [1920px workspace](phase-d/workspace-1920.png) |
| Laptop | [1280px workspace](phase-d/workspace-1280.png) |
| Narrow window | [1024px](phase-d/workspace-1024.png) · [768px](phase-d/workspace-768.png) |
| Phone | [Preview, 390px](phase-d/workspace-390.png) · [Wait For You, 390px](phase-d/wait-for-you-narrow.png) |
| Contextual tools | [Loop editor](phase-d/loop-tools.png) · [Narrow tempo panel](phase-d/tools-narrow.png) |
| Other states | [Note guide](phase-d/note-guide.png) · [Page overview](phase-d/page-overview.png) · [Microphone denied](phase-d/input-denied.png) |

## Mode behavior

| Mode | Behavior |
|---|---|
| Preview | Listen and follow. No player-input prompt or microphone capture; practice-specific target controls are absent. |
| Play Along | The score keeps time while the player plays. Sound & accompaniment exposes part muting, and Practice input enables optional live feedback. |
| Wait For You | The score waits at the target. One target row shows the notes, bar, guidance and Hear it / Hint / Skip. Listening status is explicit, with Continue available as the manual fallback. |

The persisted legacy `normal` mode migrates to Play Along; fresh sessions default to Preview. Switching modes pauses playback and reference notes while preserving shared tempo, click, loop and current position. Entering Wait For You resolves the target near the current position instead of restarting the piece. Input remains an explicit choice for each session.

Score and Note guide are presentations of the same practice mode. “Visual Mode” is now “Note guide,” with an explanation of its purpose and a direct return to Score. The guide shares the transport and target state. Its duplicate Wait For You target header and Preview practice-feedback legend are removed. Its rendering and underlying recognition fidelity are unchanged.

## Controls moved and duplicates removed

| Previous surface | Phase D |
|---|---|
| Permanent control-panel stack | Removed from the workspace; compact contextual dialogs provide its functions. |
| Playback cards and separate mode sections | One bottom transport with the authoritative three-mode selector. |
| Tempo and detailed metronome controls | Tempo opens a speed panel; click toggles directly; count-in, rhythm and volume live in Sound. |
| Track/mute list | Sound & accompaniment, available when needed. |
| Independent loop controls | One Loop entry and editor, with start/end at current position, bar fields, repeat and clear. A marked range on the position line shows its extent. |
| Input prompt on entry | Removed. Connect instrument opens the contextual input panel. |
| Scattered cursor/preparation banners | One musician-facing transport status, with diagnostics under explicitly advanced settings. |
| Separate view-switch banner | Quiet Score / Note guide presentation control in the workspace header. |
| Duplicate fullscreen controls | One workspace Focus action; no separate PDF fullscreen menu in this workspace. |
| PDF markup, page and fit controls | Retained as a small score toolbar, using shared icons and truthful save feedback. |

Existing PDF rendering, annotation geometry, score following, playback engine, matching engines, source ownership, imports and reporting infrastructure remain in use. Advanced placement closes the tool panel immediately so the score is available to click.

## Persistence and annotation fixes

Tempo, metronome enabled state, volume, subdivision and count-in now initialize both the interface and playback engine from the saved preferences. Reopening uses the latest preference snapshot. Updating preferences also updates the already-saved session manifest, guarded by score identity and instrument, so an immediate browser reload restores the latest values. This changes metadata only; it does not rewrite score files or another instrument's preferences.

Existing loop, mode, scope, matching preferences and supported position restoration remain. The position is applied after the playback engine is ready, including Wait For You target synchronization. Track mute restoration, saved fit/zoom, named loops and recording persistence were not invented.

Completed annotations now save synchronously in a layout effect, before the next navigation event can unmount the viewer. The old 600ms debounce could discard the last mark. “Marks saved” now reflects the storage result; failed or unavailable storage no longer claims success. Annotation identity, legacy migration and export/import remain intact. The browser check draws and navigates away immediately, with no autosave delay, then verifies the mark after reopening and reloading.

## Keyboard and interaction

| Key | Action |
|---|---|
| Space | Play / pause in Preview and Play Along |
| Enter / N | Continue in Wait For You |
| 1 / 2 / 3 | Preview / Play Along / Wait For You |
| − / + | Change playback speed in 5% steps |
| L | Open loop tools |
| F | Enter / exit focus |
| Escape | Close the active tool, cancel annotation, then exit focus in that order |
| Left / Right | Previous / next page |
| Shift + Left / Right | Previous / next bar |

The mode selector also supports arrows and Home/End. Editable fields and contextual dialogs retain their own keys. Buttons retain normal Space/Enter behavior; shortcuts ignore modifiers and repeated keydown events. Tool dialogs contain focus and return it to the invoking control. Motion is brief and disabled with reduced-motion preferences.

## Verification

- Production build passes. The existing large-main-chunk warning remains: approximately 2.08 MB minified / 615 KB gzip.
- **308 tests pass across 36 selected files**, covering mode behavior, playback, seeks, click, loops, Wait For You, session ownership/restoration, PDF geometry/layout, annotations, navigation, Library and onboarding. A final focused rerun after the last UI adjustment also passes all 46 tests in its four files; these are a subset, not additional tests.
- Scoped lint passes for the new workspace components and helpers, refactored PracticeView and annotation persistence hook. The wider repository retains inherited lint findings; this is not a claim that repository-wide lint passes.
- **10 browser check groups pass**, with no uncaught browser errors. They cover real PDF rendering and fit, playback, mode changes, shared settings, track mute, denied input fallback, loop editing, manual Wait For You, immediate annotation navigation, reopen/reload persistence, keyboard precedence, focus, Note guide, drawer access and reduced motion.
- Reviewed at 1920, 1440, 1280, 1024, 768 and 390px. No horizontal document overflow was detected. Narrow tools and transport remain reachable.
- [Browser review script](../../scripts/review-score-workspace.mjs) · [Browser results](phase-d/browser-results.json) · [Source safety check](phase-d/source-safety-check.json). Run the browser script only from the UI worktree with its server on port 5178, or set `UI_REVIEW_URL`.
- Whitespace validation passes. Local verification logs remain in `tmp/ui-takeover-review/`.

## Remaining UX limits

1. Note-guide accuracy and the position of generated note targets still depend on the existing recognition and mapping. Some targets remain approximate. Phase D makes no Piano Vision fidelity claim.
2. Physical MIDI and microphone performance were not tested. Browser coverage includes manual input and simulated denied microphone access, not hardware accuracy.
3. A full score at 390px is necessarily small. The phone layout is usable for controls and overview; laptop, larger windows and focus remain the stronger reading experience. PDF pages briefly redraw when their dimensions change.
4. Loop range is shown on the transport position line, not as new shaded regions printed over the score. Existing bar/beat loop behavior is preserved.
5. Advanced setup retains technical diagnostics. Import readiness rules and the existing upload workflow remain; this phase does not add playback for unsupported imports or any transcription feature.

## Safety and review gate

The UI path and existing branch were checked at the milestone. Hashes for 253 protected recognition, microphone, score-follow, geometry and playback source files in the UI worktree match the Phase D baseline. Inherited unrelated changes were preserved.

All edits, generated review files, builds and tests stayed in `/Users/ryland/Documents/scoreflow-ui`. No action edited, switched branches, reset or cleaned `/Users/ryland/Documents/scoreflow`. No training/validation process was signaled or restarted; no checkpoints, datasets, sidecars or test/future-test data were touched.

**Stopped for Phase D visual review.** The next decision is whether to accept this workspace composition and control model before any subsequent polish phase.
