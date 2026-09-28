# Phase E — focused workspace polish

20 September 2026 · `codex/corranzo-ui-overhaul-v1`  
Worktree: `/Users/ryland/Documents/scoreflow-ui`

Phase D's composition and control model were approved and remain intact. This pass changes visual hierarchy, control legibility and contextual help. It adds no product features and stops here for review.

## Changes

- **Primary transport:** Play and Pause both retain the warm, light primary surface. The control is 50px high on desktop with a 15px label and stronger 24px icon; Play uses a filled symbol. Pause no longer recedes into a dark secondary state.
- **Active mode:** 14px mode labels, a stronger selected weight and a clear vermilion underline make the current mode easier to scan. Tempo, click, loop and sound remain quieter secondary controls.
- **Small controls:** Secondary transport labels increase to 13px, BPM to 11px, position/status to 12px and page count to 13px. PDF toolbar icons are larger. Sampled laptop header, transport and PDF toolbar buttons have at least 44 × 44px targets. Settings and loop fields/actions are also roomier.
- **Narrow layout:** Compact “Bars 2–4” language and a reserved position width keep bar/time on one line at 768px. The transport structure is unchanged.
- **Navigation rail:** A small open staff bracket echoes the Corranzo mark. The active icon becomes warm paper against a restrained surface, replacing the generic full-height accent stripe.
- **Note guide help:** Hover or keyboard focus explains, “See the notes and finger positions as the music moves. Use Score for the original page.” Escape dismisses the tooltip before exiting Focus. Moving away or selecting the presentation also dismisses it. The existing inline explanation remains available after entry; no onboarding modal or new persisted preference was added.
- **Quieter title:** The app title is now a subordinate 16px editorial label with muted ink-room color. The printed title on the page remains dominant. No title detection, OCR or score-content processing was added.

## Final captures

| State | Laptop, 1280px | Narrow, 768px |
|---|---|---|
| Preview | [Preview](phase-e/preview-laptop.png) · [Pause](phase-e/pause-laptop.png) | [Preview](phase-e/workspace-768.png) |
| Play Along | [Play Along](phase-e/play-along-laptop.png) | [Play Along](phase-e/play-along-narrow.png) |
| Wait For You | [Wait For You](phase-e/wait-for-you-laptop.png) | [Wait For You](phase-e/wait-for-you-768.png) |
| Focus | [Focus](phase-e/focus-laptop.png) | [Focus](phase-e/focus-narrow.png) |
| Loop tools | [Loop editor](phase-e/loop-laptop.png) | [Loop editor](phase-e/loop-narrow.png) |
| Note guide | [Help tooltip](phase-e/note-guide-help.png) · [Guide](phase-e/note-guide-laptop.png) | — |

Additional captures: [1440px](phase-e/preview.png) · [1920px](phase-e/workspace-1920.png) · [390px](phase-e/workspace-390.png).

Screenshots come from the running app with the bundled Mozart score. The purple mark demonstrates annotation retention. Capture waits for actual notation and finishes finite transitions to avoid showing a half-open panel; interaction and reduced-motion checks run separately.

## Verification

- Production build passes. The inherited large-bundle warning remains, approximately 2.08 MB minified / 615 KB gzip.
- **150 tests pass across 18 selected files:** shell, mode behavior, PDF/practice presentation, annotations, loop domain, playback, metronome, and session persistence/ownership. The old test requiring the precise rail stripe was updated to check for the active brand signal.
- Scoped lint passes for every changed JavaScript component. Whitespace validation passes.
- **11 browser check groups pass with no uncaught browser errors.** Preview, Play Along, Wait For You, focus, loop tools, immediate annotation navigation/save, reopening, browser reload, reduced motion and keyboard shortcuts were re-tested.
- Keyboard verification includes Space play/pause, 1/2/3 modes, Enter in Wait For You, mode arrows/Home, tempo adjustment, loop tools, focus and nested Escape behavior. Inputs retain their own keys.
- Laptop and narrow captures cover all three modes, Focus and open loop tools. Document overflow checks also cover 1920, 1440, 1024 and 390px. At 768px, position labels fit without clipping and the last transport control stays within the viewport.
- Measured laptop text samples exceed 4.5:1 contrast; the lowest sampled enabled transport label is approximately 5.6:1. Play/Pause text is approximately 13.4:1. This is a focused measurement of the reviewed controls, not a claim of a complete accessibility audit.

[Browser results](phase-e/browser-results.json) · [Legibility measurements](phase-e/legibility-results.json) · [Review script](../../scripts/review-score-workspace.mjs) · [Source safety check](phase-e/source-safety-check.json).

To reproduce browser review, run `UI_REVIEW_PHASE=phase-e node scripts/review-score-workspace.mjs` from the UI worktree with its server at port 5178. Local build/test/lint logs are in `tmp/ui-takeover-review/phase-e-*.log`.

## Scope and safety

The approved layout, playback and persistence behavior are preserved. Existing recognition/target-placement accuracy, physical MIDI/microphone validation limits and small phone notation remain as documented in the [Phase D review](PHASE_D_REVIEW.md).

The UI path and branch were verified. All **426 source files under `src/features/`** match the Phase E starting baseline; the only application changes are presentation components and their styles. No Piano Vision/model work, training/validation process, original worktree, checkpoint, dataset, sidecar or test/future-test data was touched. No later features, commits or deployment were started.

**Phase E is complete and stopped for review.**
