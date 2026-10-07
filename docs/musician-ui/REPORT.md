# Corranzo musician UI redesign

Implemented in `/Users/ryland/Documents/scoreflow-ui-redesign` on `codex/corranzo-musician-ui-redesign`, based on committed UI overhaul `77424bd240`. No files were copied from a dirty checkout. No Guitar/Piano research, OMR algorithms, or model files were changed. No merge into main was performed.

## What changed

**One visual system.** Warm paper (`#f3f0e7`), print white, graphite desk and the existing vermilion identity now connect the main product surfaces. Consolidated design tokens replace competing historical definitions. Controls use a modest 4px radius; paper uses 2px; sections use rules rather than cards. Serif type names works and introduces pages; sans-serif type handles navigation and controls. There are no new fonts, remote assets, textures or ornamental animations.

**Home is a working music stand.** “Today’s practice” leads to the current score or a real beginner work. The title, composer and a straight score excerpt replace the promotional hero and tilted paper mockup. A single primary action opens the work. Returning scores preview the actual current page. Practice guidance sits in the margin, with import and repertoire as secondary paths. Guidance is not presented as personal progress.

**Library is repertoire.** Both collection and saved uploads use ruled rows with work titles taking priority. Saved works no longer live in oversized cards. Headings are smaller; supporting labels are more legible. Search, filters, keyboard tabs, import, reopen and remove remain available.

**Practice remains about the page.** Live bar numbers and a printed tempo marking give the transport a musical hierarchy. An enabled loop shows its bar range beside the position and a restrained bracket on the timeline. A completed passage gets a small check, without celebration. The original notation remains unchanged. New pen marks use fine graphite; vermilion is also available. Existing saved purple and other colors, stroke widths and marks remain valid. Markup colors have named, keyboard-accessible buttons and 44px targets. Light and dark score surrounds now have distinct presentation. A legacy restore-notice height rule was corrected so reloading does not leave a gap below the transport.

**Import, journal and settings belong together.** Import uses the shared paper roles, a more deliberate column hierarchy and quiet numbered preparation states. History becomes a practice journal: open sections, compact time summaries, work titles and indented session notes. Settings becomes an open reference page, replacing five dark floating panels. The paper preference is accurately named “Score surround.”

## What removes the generic SaaS feeling

The product leads with a musical work instead of a slogan or statistics. Containers indicate an actual sheet or a tool dialog, rather than wrapping every concept. Editorial hierarchy, ruled repertoire and real marks carry the personality. Musical symbols appear only for tempo, actual loop state and actual completion. No fake annotations, invented clean-run statistics, decorative staff fragments or music-note wallpaper were added.

## Preserved behavior

Playback, pause, tempo/speed, metronome, loop setup, the three practice modes, Note guide, focus view, original PDF navigation and markup persistence. Import preparation/cancellation, optional files, damaged-file recovery, session restoration, library search/filtering, saved-score opening/removal, instrument selection and practice logging remain intact. The recognition and audio engines were not edited.

## Validation

- Production build passes. Vite reports a large JavaScript chunk warning.
- **116 targeted tests pass**: 103 shell/library/import/practice/history/session tests plus 13 annotation tests. The annotation tests now expect graphite and explicitly verify old purple preferences and stroke widths survive normalization.
- Browser workflow review passes at **390, 430, 768, 1024, 1280, 1440 and 1920px**. Includes long/unbroken titles, empty and searched libraries, import readiness, cancellation, corrupt MIDI/XML recovery, route focus, keyboard tabs and dialog traps, mobile drawer, reload and reduced motion.
- Production-build browser review passes: navigation, all major screens, all practice modes, playback, dialogs, Note guide, focus view and practice timer.
- Detail review passes: real drawn graphite marks persist across reload; bars 1–4 loop shows correctly; both surrounds work; the journal saves actual test-session notes; existing Guitar product surfaces share the design.
- **42 automated accessibility screen/state checks report zero violations** across the three final review reports (21 production, 17 workflow, 4 detail). These are repeated state checks, not 42 unique pages.
- Newly edited components and QA scripts pass targeted ESLint, except untouched existing lint defects in `App.jsx` (12 errors, 2 warnings) and `LibraryPanel.jsx` (1 error). Running the committed base versions through the same linter reproduced those findings. The changes in those files are copy only. This is not a claim that repository-wide lint passes.
- `git diff --check` passes.

See [production browser review](review.json), [workflow review](regression/shell-browser-results.json), [detail review](details-review.json) and [test/build evidence](VALIDATION.txt). Review scripts use isolated browser contexts, never the user's saved browser data.

## Visual evidence

Screenshots are actual browser renders. The graphite bracket and journal note in detail screenshots were entered during QA using the product's existing tools; they are not preloaded decoration or claimed user activity.

| Surface | Desktop | Phone |
| --- | --- | --- |
| Home | [Today’s practice](after/home-1440.png) | [Home](after/home-390.png) |
| Repertoire | [Library](after/library-1440.png) | [Library](after/library-390.png) |
| Import | [Import](after/import-1440.png) | [Import](after/import-390.png) |
| Practice | [Score](after/practice-1440.png) | [Score](after/practice-390.png) |
| Journal | [Journal](after/history-1440.png) | [Journal](after/history-390.png) |
| Settings | [Settings](after/settings-1440.png) | [Settings](after/settings-390.png) |

Additional evidence: [marked passage](after/marked-passage.png), [markup tools](after/markup-tools.png), [journal with notes](after/journal-with-notes.png), [light surround](after/light-surround.png), [Guitar Home](after/home-guitar.png), [import ready](regression/ready-1440.png), [narrow long score title](regression/workspace-long-title-390.png). Baseline captures are in `before/`. A representative screenshot selection is committed; review scripts regenerate the complete width matrix.

## Remaining visual weaknesses and limits

- Advanced score-follow/diagnostic tools retain their denser legacy layouts; the main shell and practice controls are more cohesive than those deep settings.
- Very small screens still need zoom to read dense original scores comfortably. The redesign preserves the score geometry and existing zoom rather than reflowing notation.
- The Home excerpt is intentionally cropped; unusually large title pages may show less notation. Open score always exposes the full document.
- Imported scores still inherit the product's existing one-score-per-instrument storage limit. This redesign does not pretend to add a multi-work personal collection or new phrase analytics.
- Automated visual/interaction checks ran in Chromium. Physical MIDI/microphone performance and a live session at an instrument were not part of this visual review.

## Exact source and test changes

- `src/App.jsx` — journal loading copy.
- `src/components/LibraryPanel.jsx` — repertoire and upload copy.
- `src/components/collection/ScoreCover.jsx` — current-page preview and sharper rendering.
- `src/components/home/Home.jsx` — music-stand composition and action hierarchy.
- `src/components/home/home.css` — responsive Home and score excerpt.
- `src/components/pdf/AnnotationToolSettings.jsx` — named, accessible swatch buttons.
- `src/components/pdf/PdfViewerToolbar.jsx` — score-surround wording.
- `src/components/pdf/annotationConstants.js` — graphite default, finer stroke, vermilion option; legacy colors retained.
- `src/components/practice/WorkspaceTools.jsx` — printed tempo readout.
- `src/components/practice/WorkspaceTransport.jsx` — live bar/passage/tempo and completion check.
- `src/components/profile/ProfileView.jsx` — practice-journal language.
- `src/components/shell/SettingsView.jsx` — accurate preference and instrument copy.
- `src/components/shell/shell.css` — navigation and open Settings layout.
- `src/design/primitives.css` — reusable accessible hidden text.
- `src/styles/collection.css` — shared paper theme and saved-work rows.
- `src/styles/import.css` — shared palette, composition and quiet preparation state.
- `src/styles/profile.css` — practice journal layout.
- `src/styles/tokens.css` — consolidated palette, type, spacing and shape roles.
- `src/styles/workspace.css` — score framing, transport, markup and restore sizing.
- `tests/annotationColorPicker.test.js` — graphite expectation and saved-color compatibility.
- `tests/annotationLayer.test.js` — graphite expectation.
- `scripts/review-musician-ui.mjs` — major screens and production-build review.
- `scripts/review-musician-workflows.mjs` — isolated adaptation of the existing comprehensive UI workflow review.
- `scripts/review-musician-details.mjs` — markup, loop, surround, journal and instrument checks.

The complete committed artifact inventory, including screenshots and reports, is in [FILES.txt](FILES.txt).
