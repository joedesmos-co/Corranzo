# Phase F — import, onboarding and processing

21 September 2026 · `codex/corranzo-ui-overhaul-v1`  
Worktree: `/Users/ryland/Documents/scoreflow-ui`

**Phase F is complete and stopped for review.** Phase E is approved and the core design remains locked. The workspace composition, three modes, transport, navigation rail and Home/Library identity have not been redesigned.

## Delivered

- **PDF-first import:** one “Import a score” action, keyboard-accessible chooser and drop target, supported-format guidance, filename/page count and a real preview of the original page. My Uploads and file help lead to this dedicated flow.
- **Optional files:** matching MusicXML/XML/MXL and MIDI remain supported under Advanced. Required PDF input and optional companions are clearly separated. Native MuseScore and direct image files are not advertised as supported.
- **Truthful preparation:** the existing processor supplies reading, notation and playback stages with actual page counts. No fabricated percentage, countdown or time-based stage changes. Technical exceptions and developer tools are behind Advanced disclosures.
- **Recovery:** cancel leaves the PDF available with “Prepare score”; failed preparation offers retry or replacement. Unreadable PDFs, insufficient notation, unsupported images and damaged optional files have distinct guidance. Invalid required notation cannot expose an Open score action. Unreadable optional accompaniment asks for removal or replacement before playback.
- **Explicit workspace entry:** completion stays on a validated ready step. The inline first-use introduction explains Preview, Play Along and Wait For You in musician language. One Open score action carries the selected mode into the approved workspace. Returning users get a shorter introduction. Generated scores without sufficient follow information explain why Wait For You is unavailable.
- **Quality:** accepted-with-warning output asks the musician to listen and compare against the original. Rejected input does not claim readiness. Advice covers sharp notes, complete page edges, even lighting and camera angle without inventing a blur/crop diagnosis.
- **Import lifecycle fixes:** optional notation replacement now updates the existing source-ownership guard alongside the session version, so removal/retry works. A small import queue lets cancelled jobs finish cleanup before the shared client starts a replacement; late cleanup cannot stop a newer import. Recognition code and acceptance thresholds are unchanged.

## Review captures

| Requested state | Screenshot |
|---|---|
| Import start | [Import a score](phase-f/import-start.png) |
| File selected | [Original page retained after cancellation](phase-f/file-selected.png) |
| Processing | [Real notation preparation and page count](phase-f/processing.png) |
| Successful ready state | [Prepared score and explicit Open score](phase-f/ready.png) |
| First-use mode introduction | [Inline three-mode introduction](phase-f/first-use-modes.png) |
| Poor-quality / recoverable input | [Real blank-PDF quality rejection](phase-f/poor-quality.png) |
| Processing failure | [Controlled worker failure and recovery](phase-f/processing-failure.png) |
| Narrow window | [768px](phase-f/narrow-ready.png) |

Additional captures: [1280px laptop](phase-f/laptop-ready.png), [390px phone](phase-f/phone-ready.png), [unsupported image](phase-f/unsupported-image.png), [unreadable PDF](phase-f/unreadable-pdf.png), [optional files](phase-f/optional-files.png), [optional accompaniment recovery](phase-f/optional-file-recovery.png).

The successful import, cancellation/resume, page preview and poor-input rejection use the real browser processor and bundled public-domain Mozart PDF. The blank PDF is created in memory by the review script. The generic processing-failure capture uses a browser-only injected worker error; retry then uses the real worker successfully. No production test modes, fake progress or model changes were added.

## Verification

- Production build passes. The inherited large-main-bundle warning remains (approximately 2.08 MB minified / 617 KB gzip).
- **279 tests pass across 31 selected files:** import classification and presentation, queued cancellation/retry, ownership/generation gates, restoration, Library, shell, onboarding, annotations, mode behavior, loops, playback and metronome.
- **9 import browser groups pass**, covering the real PDF-only flow; keyboard picker and mode selection; all three workspace entries; cancel/resume; MusicXML/MXL/MIDI; damaged optional input; quality rejection; retry; unreadable PDF; navigation during processing; rapid replacement; reload; reduced motion; and 1440/1280/768/390px layouts without horizontal overflow.
- **11 approved-workspace regression groups pass:** Preview, Play Along, Wait For You, Focus, loop tools, sound/mute, Note guide, immediate annotation navigation/save, reopen and reload preferences, keyboard shortcuts, reduced motion and responsive controls. The bundled demo remains functional.
- Both final browser runs have zero uncaught errors. One earlier cancellation stress run emitted a transient PDF.js “Worker was terminated” console error; it did not recur in three focused rapid-replacement repetitions or the final complete run. PDF teardown remains a residual edge case to watch in real use.
- New/rewritten import JavaScript and helper tests pass lint. The inherited App/Library/processor panel files still have existing React compiler lint diagnostics for refs, effect state and mutation. A scoped check excluding those three existing rule categories passes with two inherited dependency warnings. Whitespace validation passes.

[Import results](phase-f/browser-checks.json) · [Workspace results](phase-f/workspace-regression/browser-results.json) · [Source safety comparison](phase-f/source-safety-check.json).

Reproduce from the UI worktree, with its UI server on port 5178:

```sh
node scripts/review-import-experience.mjs
UI_REVIEW_PHASE=phase-f node scripts/review-score-workspace.mjs
```

Review scripts use isolated browser storage and do not change the user's library. Build/test/lint logs are in `tmp/ui-takeover-review/phase-f-*.log`.

## Capability limits and safety

- PDF is the supported primary format today. For a photo/image, save or print a PDF first. Existing scan cleanup, denoising and mild straightening run before acceptance; full perspective correction is not promised.
- This is a flow/recovery review, not validation of Piano Vision accuracy across photographed scores or physical microphone/MIDI devices. Recognition fidelity and existing capability gates remain unchanged.
- **394 protected source files match the Phase F baseline**, including recognition, playback, score following, practice, shell/Home components, design primitives and approved styles. Existing feature-file changes are limited to two import-format helpers; the new presentation and queue helpers live under `src/features/import/`.
- All edits and generated review artifacts stayed in the UI worktree. No original-worktree writes, branch changes, training/validation process signals or restarts, checkpoint/dataset/sidecar changes, or test/future-test data operations occurred. A read-only process inventory found no command explicitly containing the phase214 campaign path; it did not signal any process.
- No commits, deployment or later feature campaigns were initiated.
