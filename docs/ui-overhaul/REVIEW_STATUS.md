# Stage 1 — ready for design review

**Update, 21 September 2026:** Phase E is approved and the core UI direction is locked. Phase F import/onboarding/processing is complete and stopped for review; see the [Phase F review and screenshots](PHASE_F_REVIEW.md). Earlier [Phase E](PHASE_E_REVIEW.md), [Phase D](PHASE_D_REVIEW.md) and Stage 1 reports remain historical approval checkpoints.

19 September 2026 · `codex/corranzo-ui-overhaul-v1`  
Worktree: `/Users/ryland/Documents/scoreflow-ui`

**At the Stage 1 checkpoint, Phase D had not started.** The collection direction changed substantially, so implementation stopped there for the requested review. The [takeover audit and concrete Phase D plan](TAKEOVER_REVIEW.md) explain the critique and proposed score workspace.

## What changed

- Replaced the brown-and-gold collection theme with warm paper, ink, restrained vermilion and editorial typography. Added a staff-derived mark, numbered navigation and grouped utilities. Existing routes and instrument selection remain functional.
- Rebuilt Home as one screen with an honest first-run/returning state, an actual score excerpt, a direct import action and three real starter pieces. Removed the accidental Library-above-Home composition. Home is now the fresh-entry and brand-link destination.
- Replaced built-in Library cards with numbered rows, clearer titles/credits and restrained open actions. Kept composer search, difficulty filters, uploads, loading/error feedback and attribution.
- Made the existing tutorial opt-in through Help. Fixed mobile drawer stacking, hidden focus targets, focus containment, Escape return and background interaction. Added keyboard navigation to Help and Library tabs.
- Kept the legacy score workspace and its rendering, audio, matching, loops, annotations and score-follow infrastructure. The new collection palette is scoped so it does not accidentally recolor those controls.

## Review images

| Screen | Current | Before |
|---|---|---|
| First-run Home | [Desktop](review/home-desktop.png) · [Phone](review/home-390.png) · [Laptop](review/home-1280.png) | [Previous Home composition](review/before-home.png) |
| Returning Home | [Current score](review/home-returning.png) | — |
| Library | [Desktop](review/library-desktop.png) · [Phone](review/library-mobile.png) · [Empty search](review/library-empty-search.png) | [Previous Library](review/before-library.png) |
| Navigation | [Open phone drawer](review/navigation-mobile.png) | — |
| Uploads | [Existing upload workflow in the new collection surface](review/uploads-desktop.png) | — |
| Guitar | [Instrument-specific Home](review/home-guitar.png) | — |
| Score | [Current legacy workspace](review/score-current.png) · [Focus](review/score-focus-current.png) | [Previous shell and workspace](review/before-score.png) |
| Existing practice modes | [Wait For You](review/wait-for-you-current.png) · [Visual guide](review/note-guide-current.png) | — |
| Original Phase A prototype | [Design sandbox](review/design-system-current.png) | This is historical, not the revised direction. |

Home and Library are the visual proof. The score screenshots document the starting point for D; they are not a completed redesign. Earlier `after-*-draft` captures are iteration records, not the review target.

## Verification

- Production build passes. The existing large-main-chunk warning remains (approximately 2.1 MB minified / 620 KB gzip).
- 119 selected tests pass across 15 files: shell, primitives, navigation, onboarding, launch gating, Library, session routing, mode behavior, PDF geometry/layout, annotation identity and loop/WFY domain behavior.
- Scoped lint passes for the rewritten Home, collection components, shell components and Help popover. Whitespace validation passes.
- 17 browser check groups pass with no uncaught browser errors. Coverage includes first-run/returning Home, real score loading, keyboard menus/tabs/drawer, focus entry/exit, playback/Space, tempo, metronome, loop start/end/enable/clear, track mute/unmute, saved annotation restoration/resize, manual WFY, Visual presentation, instrument change and reduced motion.
- Home reviewed at 1920, 1440, 1280, 1024, 768 and 390px; no horizontal document overflow. Library and drawer also reviewed at phone width. These checks do not claim that the legacy score workspace is already responsive enough for Phase D.
- Browser automation: [review script](../../scripts/review-ui-takeover.mjs), [machine-readable results](review/browser-results.json). Run only inside the UI worktree with its UI server available at port 5178; `UI_REVIEW_URL` can override the origin.

## Known limitations that matter for Phase D

1. Reopening restores access to the score, but inherited playback state resets tempo/metronome and has incomplete position/session restoration. The new button says **Return to score**, not “resume where you left off.”
2. The inherited annotation hook cancels a pending 600ms autosave on unmount. Leaving immediately after drawing can lose the latest mark despite the unconditional “Saved” label. Completed saves were verified across reopen and resize. Flush-on-leave and truthful save feedback are first-order D work.
3. The actual score mode state remains `normal` / `wait-for-you`. Preview, Play Along and Wait For You need the behavioral integration described in the plan; the prototype alone does not implement this.
4. The old input prompt, right-hand control stack, Visual label, legacy colors, technical import help and fullscreen keyboard precedence remain for D. No microphone/MIDI hardware accuracy or Piano Vision fidelity claims were tested or changed.

## Safety and handoff

The worktree and existing branch were checked at takeover and final verification. Source hashes confirm practice/PDF/playback/recognition/score-follow/hooks/context code is identical to the takeover baseline. Inherited uncommitted work was preserved. Baseline hashes, the inherited diff and verification logs are local under `tmp/ui-takeover-review/`.

No writes, branch switches, resets or cleanup were performed in `/Users/ryland/Documents/scoreflow`. No training/validation process was signaled or restarted. No checkpoints, datasets, sidecars or test/future-test data were touched. No commits, deployments or later feature phases were initiated.

**Review decision:** assess the paper/ink/vermilion direction, navigation and editorial collection treatment before applying them to the darker score workspace.
