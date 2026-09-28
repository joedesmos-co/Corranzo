# Corranzo — Current UI Audit

**Scope:** audit + design only. No implementation.
**Audited tree:** separate worktree (branch `codex/corranzo-ui-overhaul-v1`), HEAD `aecc431`.
**Method:** static inspection of `src/` (App shell, components, features, styles). No screenshots — no running dev server was started, to keep this pass read-only and safe.

---

## 1. Routes / screens (such as they are)

There is **no router**. Navigation is a `activeView` string in `App.jsx` (`src/App.jsx:162`), synced to `window.location.pathname` via `legalRoutes.js` + `appViewDebug.js`.

| View id | Label in TopBar | What renders | Notes |
|---|---|---|---|
| `library` | Library | `LibraryPanel` (Practice Library / My Uploads tabs) | Default view. This is effectively "home" — there is no separate home/landing screen. |
| `practice` | Practice | `PracticeView`, or `AppViewPlaceholder` when no piece is open | Nav button gets a muted style + tooltip when `practiceReady` is false (`TopBar.jsx:80-92`). |
| `profile` | Progress | `ProfileView` (lazy) | Route id (`profile`) and user-facing label (`Progress`) disagree. |
| `privacy` / `terms` / `contact` | — (footer only) | Legal pages | Fine. |
| welcome hero | — | `LibraryWelcomeCard` | **Dead code in practice:** `App.jsx:2464-2470` sets `practiceLibraryIsFirstRunHome = true`, so `showLibraryIntro` is always false. The welcome card never renders. First-run users land directly on the Practice Library grid. |

**Findings:**
- No Home. The product opens onto a library grid, which reads as a file viewer — exactly the complaint in the brief.
- No Score Workspace route identity: Practice is one view whose content swaps between placeholder / PDF score / Visual lane. Deep-linking a piece is impossible.
- `normalizeAppView` silently maps unknown views to `library` — forgiving, but masks bad links.

## 2. Layout hierarchy

```
<header TopBar 72px>  logo+Beta | InstrumentSelector | Library/Practice/Progress | Help▾
<SessionRestoreBanner> (conditional)
<main library-main> OR <main practice-workspace> OR <main profile-view> OR legal
<AppFooter> (legal links)
<GuidedTutorial> (spotlight overlay, conditional)
```

- **Library:** single-column `<aside class="library-panel">` used as a full page. Hero tagline ("Start practicing") + tabs + cards. Content max ~1100px (`--sf-content-max`).
- **Practice (`PracticeView.jsx`):** two-column workspace inside `.practice-workspace__layout`:
  - **Score column** (`.practice-workspace__score`): `PracticeViewSwitchBar` (Score/Visual toggle) → `PracticeTimingPrepBanner` → `OmrQualityWarningBanner` → `ScoreFollowSetupStatus` → `PdfViewer`.
  - **Control column** (`PracticeControlPanel`, `<aside>`, ~sidebar width 300px token): piece title → transport tick → Mode radios → Scope → input selector → WaitForYouSection → cursor section → loop → status strip → collapsible Session stats → collapsible Advanced (Files / Playback / Score cursor / Help / Diagnostics).
- **PdfViewer** has its own floating toolbar (`PdfViewerToolbar.jsx`): pages ‹ 1/5 › · fit popover · markup popover · more popover · (fullscreen: pin + exit). Plus annotation layers, cursor layer, score-follow overlay, fullscreen HUD variant.
- There is **no global left sidebar**. `useWorkspacePreferences` has `sidebarOpen`, and CSS references `.main-layout--sidebar-hidden`, but in the current Practice workspace the collapsible element is the right control panel (toggled from the PDF viewer chrome), not a product-wide nav. The requested collapsible/pull-out product sidebar does not exist yet.

## 3. Navigation audit

- TopBar exposes exactly 3 destinations + Help menu (Replay tutorial / How files work / Contact). Adequate for now, but it is a **top tab bar, not a sidebar**, and it permanently consumes 72px.
- Instrument switcher (Piano/Guitar) sits in the top bar. Switching instruments **clears the live session** and returns to Library (`App.jsx:472-509`) — correct behavior, but surprising without explanation in UI.
- `handleNavigate('library')` forces `setSidebarOpen(true)` — leftover coupling from an older sidebar model.
- No breadcrumbs, no "current piece" indicator outside Practice, no quick-resume entry point (session restore banner exists but is about crash/session restore, not "continue yesterday's piece").

## 4. Score viewer

`PdfViewer.jsx` + `components/pdf/` (16 files). Capabilities: page navigation, fit page/width, dark/light paper, annotations (pen/highlighter/eraser + undo/clear/export/import JSON), score-follow cursor overlay, calibration overlay, fullscreen mode with auto-hiding HUD, adjacent-page preloading.

**Good bones.** Problems are presentational:
- Floating toolbar uses **text-glyph icons** (`‹ › ⤢ ✎ ⋯ ◇ ◆ ✕ ↖ ▬ ⌫`) — no icon set, inconsistent weights, some glyphs render as emoji on some platforms.
- "Saved" hint under the toolbar is cryptic (annotations autosave — but nothing says *what* is saved).
- Annotation import/export JSON is a power-user feature sitting one popover deep in the default toolbar.
- Fullscreen HUD + embedded toolbar are two implementations of similar controls (`PdfFullscreen.jsx` 369 lines + `PracticeFullscreenHud.jsx`).

## 5. Playback / modes — the most confusing area

Source of truth conflict:
- `src/features/practice/practiceMode.js`: labels are **"Normal playback"** vs "Wait For You".
- `PracticeModeSection.jsx`: labels are **"Play Along"** vs "Wait For You".

So the same mode is called two different things in code vs UI, and the requested third mode (**Preview / Listen**) **does not exist as a mode at all** — pressing Play in "Play Along" *is* the listen experience. The user's mental model (Preview → Play Along → Wait For You, three distinct modes) has no counterpart in the product. This is the #1 score-workspace problem to fix.

Other issues:
- **Two transport implementations:** `PracticeTransportSection` (full: tempo + metronome details + play/pause/stop/test-sound + seek) and the compact path actually mounted in the panel (`PracticeTransportTick` + `PracticePlaybackSettings` with `showMetronomeDetails={false}`). The full section appears unused in the default layout — dead-ish weight that still has tour anchoring (`data-tour-id="practice-playback"`).
- In Wait-For-You mode the transport play buttons are **hidden entirely** (`PracticeTransportSection.jsx:91-93`, and tick equivalents) — correct intent (Continue lives by the note target) but there is no transport continuity: tempo still matters, yet its neighbor controls vanish, so the panel visibly jumps between modes.
- **Triplicated controls:** position (`PracticePositionPanel` / `PracticePositionSection` / `PracticePositionTick`), tracks (`PracticeTracksSection` / `PracticeTracksCompactSection`), loops (`PracticeLoopControls` full + `PracticeLoopCompactSection`). Compact vs full diverge in features (e.g. snap-mode hidden in compact), so behavior changes with layout for no user-visible reason.
- Tempo = bare % slider + tiny BPM readout. No tap-tempo, no preset chips, no "original tempo" reference beyond computed BPM.
- Metronome advanced (subdivision, count-in, volume, beat indicator) is buried in Advanced → Playback.
- `MidiTransportControls` custom `transportPropsEqual` memo swallows most prop changes (ignores callbacks entirely) — stale-callback risk; also time display uses unicode `▶ ❚❚ ■ ♪`.

## 6. Wait For You

`WaitForYouSection.jsx` is **539 lines** — the single most overloaded component in the product. It handles: status pill, checkpoint target label (with piano/guitar/chord/mic special cases), reference playback, skip/hint/restart, match-settings panel, mic permission states, MIDI device states. Plus surrounding `WaitForYouInputSourceSelector`, `WaitForYouInputSourceModal`, `WaitForYouMatchSettingsPanel`, mic/MIDI status panels, and `MicTestPanel`.

- The checkpoint label logic is genuinely thoughtful (e.g. "Play this double-stop", piano hand instructions), but it's spread across 3+ files (`WaitForYouSection`, `VisualPracticeView.describeTargetNotes`, `pianoPracticeInstructions`).
- Status vocabulary is large: `waiting / correct / missed / continuing / complete / no-checkpoints` × display statuses × input outcomes. The status strip adds *another* vocabulary (Sound issue / Following score / Mic listening…). A user must learn two overlapping status languages.
- Input source (Manual / MIDI / Mic) selection appears as a modal on entry + inline selector afterwards — reasonable, but the modal timing ("defer") logic in session state is fragile-looking.

## 7. Score cursor / score-following setup

At least four user-facing surfaces say overlapping things: `ScoreFollowSetupStatus` (banner over score), `PracticeScoreCursorSection` (panel), `PracticeSetupPanel` (Advanced), `ScoreFollowApproximateHint`, plus `ScoreFollowControls.jsx` (564 lines) and `CalibrationDebugPanel`. States: running / failed / needs-setup / following-off / following / OMR-running / OMR-failed / playback-ready. Distinguishing "cursor not set up" from "following turned off" from "OMR still working" currently requires reading three different areas. This whole cluster should collapse into one cursor-state machine with one banner + one setup entry point.

## 8. Loop / sections

`PracticeLoopControls`: Set start / Set end / Clear + Loop on toggle + snap details (Measure/Beat) + range readout. Functional but:
- "Set start / Set end" require the user to be *at* the right position with no "use current measure" shortcut.
- No named sections, no saved loops per piece, no visual loop region on the score itself (loop region renders in Visual lane only).
- Hints leak internals ("Load a playback file to hear automatic looping").

## 9. Tracks / sound

`MidiTrackList` + tracks sections: mute/solo presumably; plus `instrumentVoiceStatus` (Sampled / Synth / Loading) surfaced as a status chip. "Synth" fallback is exposed as a *warning* ("Sound issue"?) when it is actually normal on first load — noisy. Safari audio notice exists (`SafariAudioCompatibilityNotice`) — good, keep.

## 10. Annotations

`AnnotationLayer` (344 lines) + `AnnotationToolSettings` + persistence hook (`useAnnotationPersistence`). Autosaved locally per page. Solid. Issues: discoverability (behind ✎ popover), no annotations list/minimap, export/import JSON is dev-flavored, no share story (fine — local-first product, but then import/export could move to Advanced).

## 11. Import flow

Three parallel upload paths that overlap:
1. `MultiFileUpload` dropzone (auto-classifies PDF + MusicXML + MIDI in one drop) — the good path.
2. Per-file inputs in the "Upload one file at a time" `<details>` (numbered cards 1 Sheet music / 2 Timing file / 3 Sound optional).
3. Individual handlers in `App.jsx` (`handleFileSelect`, `handleMidiSelect`, `handleMusicXmlSelect`).

Jargon audit: "Timing file", "MusicXML or MXL", "MIDI - backing audio", "score cursor", "timing map", "practice scope". A normal musician thinks "the notes file", not "timing file". The numbered cards are the clearest part and should become *the* flow; the dropzone + advanced cards should merge rather than coexist.

Piano Vision / OMR UI (`PdfOmrPlaybackPanel.jsx`, **750 lines**):
- Auto-starts on PDF upload (`autoStartKey`), shows progress label + animated bar, success summary, failure message with retry, "Report recognition problem" dialog.
- Failure copy is good ("We could not read enough of this PDF automatically… upload MusicXML/MXL for the most accurate timing").
- **Developer tooling ships in the component**: `omrDevTools` (toggle debug/provenance/trace, V3 compare/prefer, diagnostic export copy, provenance download). Verify before redesign whether these are gated — `getOmrDiagnosticFlags()` suggests flags, but their presence in the main panel component is a smell; dev tools must not be reachable in the normal UX.
- Quality states continue in Practice via `OmrQualityWarningBanner` + `RecognitionProblemReportDialog` — reasonable, keep the pattern, simplify the copy.

Other import notes: MuseScore files are rejected with a "planned" message (acceptable placeholder, must not look like a broken upload); delete uses native `window.confirm` (should become a real dialog in the design system); `DemoPieceCard` ("Try demo") is the best first-run path and should be elevated to Home.

## 12. Library

- Two tabs: Practice Library (built-in pieces, search + difficulty filter, grouped cards with Start Practice) vs My Uploads (upload card + uploaded pieces + accuracy guide). Sensible split.
- Cards repeat identical metadata rows; attribution/license microcopy is prominent relative to its importance.
- `LibraryAccuracyGuide` ("How files work") is genuinely useful content currently parked at the bottom of My Uploads and in Help — candidate for onboarding content in the new Home/Import flows.
- No piece artwork, no recency info, no "continue where you left off" — library feels like a parts catalog, not a music home.

## 13. Practice history / stats

`ProfileView` ("Progress"): manual practice log + auto-tracked totals + per-piece table + instrument scope filter (All/Piano/Guitar). `PracticeStatsCard` compact variant lives in the Practice panel ("Session stats / Saved locally"). Findings:
- Tracking works (auto + manual). Presentation is tables of durations — no trends, no per-piece tempo progress, no loop/section memory surfaced, no goals.
- "Session stats / Saved locally" summary line reads as a disclaimer, not a feature.
- Reset-all-stats exists — destructive action needs design-system dialog treatment (replaces `confirm()` habit).
- Nothing here is gamified (good — keep it that way); it just needs editorial shaping (this week, per-piece resume, tempo over time).

## 14. Visual Mode

`VisualPracticeView.jsx` (651 lines) + `StaffVisualLane` / `TabVisualLane` / `SourcePdfVisualLane` (unused? verify) + keyboard/fretboard strips. What it is: a **synthesized scrolling note lane** (Simply-Piano-style) with target callout ("Play this: E4"), position ("Measure 3, beat 2 · 12 of 48"), legend, and OMR disclaimer ("Notes for this piece were read automatically… the Score view is the reliable reference").

UX verdict, independent of recognition fidelity:
- Presentation is honest (the disclaimer is good) but the Score/Visual toggle undersells the difference: "View: Score | Visual" reads as a display preference, when it is actually **two different practice experiences** (read notation vs follow the lane).
- The lane looks nothing like the uploaded score — expected per brief (fidelity is out of scope), but the UX should frame Visual as "Note guide" (training wheels) rather than an alternate *view of the score*.
- Legend chips (Correct / Wrong-missed / Played / Now / Upcoming) only show outside WFY — the color language isn't explained where it's needed most.
- `SourcePdfVisualLane` (249 lines) appears to be an alternative/experimental lane — candidate for removal during redesign; confirm dead before deleting.

## 15. Onboarding

- `GuidedTutorial.jsx` (386 lines): spotlight tour, 7 steps (Welcome → Library → Practice → Play Controls → Practice Mode → Input Source → Score Cursor → Advanced → Done), focus-trapped, skippable, persists completion. Well-built. Problem: it tours the *current* cluttered layout — step targets (`practice-playback`, `practice-mode`, `practice-input-source`, `score-cursor`, `practice-advanced`) mirror the panel structure we're about to change. Keep the mechanism, rewrite the script after the workspace spec lands.
- `PracticeHelpTip` ("?") popovers: scattered, one-line explanations. Fine pattern for progressive disclosure; copy needs a musician-language pass.
- `LibraryWelcomeCard`: good content, currently unreachable (see §1). Its "How it works: Add files → Practice → Stay local" is the seed of the new Home page.
- Missing: first-import guidance *during* import, mode chooser ("Preview vs Play Along vs Wait For You"), score-following explainer at the moment setup runs, loop/annotation discovery. All listed as contextual onboarding in the brief — none exist yet.

## 16. Empty / loading / error states

Inventory: practice-empty ("Choose a piece first"), visual-empty ("No notes to show yet"), library-empty (search/uploads), timing-prep banner ("Preparing timing for practice…"), OMR progress/failure, restore placeholders, profile loading fallback, `PracticeErrorBoundary` with reload/return actions. Coverage is good; tone is inconsistent (some states technical: "Generated playback is not ready", "Timing could not be prepared… uploading a cleaner MusicXML"). Needs a copy pass + consistent illustration/empty-state component, not new states.

## 17. Typography / spacing / color / tokens

- **Type:** Inter/system stack everywhere (`--sf-font-display`), mono for numbers. Scale 0.625–1.5rem, sensible. `editorial-polish.css` + `practice-section__title--editorial` suggest a second, editorial voice creeping in — titles vary between plain (`Mode`, `Play`) and editorial serif-ish treatments. Pick one voice.
- **Color:** monochrome dark (black `#000`, zinc panels `#121212/#1e1e1e`, white text). Already satisfies "not neon". Risk is the opposite: undifferentiated gray-on-black everywhere, status tones carried by text alone. Note `--sf-accent-green: #d4d4d8` — a gray named green; token hygiene issue. `--sf-text-primary` and `--sf-text-secondary` are both `#ffffff` — hierarchy is carried by size/opacity only.
- **Spacing:** "luxury negative space" scale up to 128px, panel padding 48/64px. On a score workspace this is actively harmful — chrome eats notation space. Practice panel needs a compact density (the `--compact` variants exist but are ad hoc per-component).
- **Radius:** 4–10px + pill; sharp-edge minimal per token comment. Consistently applied-ish.
- **Elevation:** flat, shadows explicitly `none`. Depth must be reintroduced deliberately (the brief allows selective depth) via tokens, not per-component hacks.

## 18. Iconography

No icon set. All glyphs are unicode text (`▶ ❚❚ ■ ♪ ‹ › ⤢ ✎ ⋯ ◇`). Inconsistent sizing/alignment, platform-dependent rendering, several read as emoji. **Adopt a single line-icon set** (e.g. Lucide-style SVGs) as part of Phase A primitives; forbid text-glyph icons in new UI.

## 19. Component reuse

Good: `PracticeCollapsibleSection`, `ToolbarPopover`/`ToolbarIconButton`, `PracticeHelpTip`, `StatusChip` (local), `StatCard` (local), `AppViewPlaceholder`. Bad: transport ×2, tracks ×2, loops ×2 (full+compact), position ×3, diagnostics ×6 panels, fullscreen ×2, status vocabularies ×2, mode labels ×2 (`practiceMode.js` vs `PracticeModeSection`). The redesign should collapse each family to one component with density props.

## 20. Responsiveness

Breakpoints at 1100 / 900 / 800 / 640px (`App.css`, `practice.css:4754+`). Practice layout stacks panel below score on narrow screens. Gaps:
- At laptop widths (~1280) the 300px+ control panel + floating toolbar + banners squeeze the score; banners stack *above* the score pushing notation down on every state change (layout shift).
- Floating toolbar overlays the score top edge — on short windows it covers the first staff.
- No dedicated "score-focused / fullscreen practice" mode beyond the PDF fullscreen (which hides practice controls — you can't practice in it).
- Touch targets: panel buttons are small (`.sidebar-toggle`, loop buttons); audit hit targets ≥ 40px in Phase G.

## 21. Accessibility

Baseline is better than average: focus-visible rings (`--sf-focus-ring`), aria labels on toolbar/transport, radiogroups for modes/scopes, focus trap in tutorial + dialogs, `prefers-reduced-motion` handled in `index.css` + `practice.css:6059`. Issues:
- Glyph-only buttons depend on `title`/`aria-label` — tooltips don't show on touch/keyboard consistently.
- WFY pulsing highlights (`wfy-note-highlight-pulse` 1.8s infinite) — verify they're disabled under reduced-motion.
- Contrast: `--sf-text-muted #a1a1aa` on `#121212` is OK; `--sf-text-subtle #71717a` / faint `#52525b` likely fail for small text — restrict to decorative/large text in tokens.
- Keyboard shortcuts exist (Space/Enter/arrows/F) with a shortcuts disclosure — good; keep and extend to mode switching.

## 22. Animations

Restrained: fades, OMR progress slide, spinner, WFY pulses, status pulse. No gratuitous motion — matches "tasteful and purposeful". Missing: mode-switch transitions, panel collapse animation, score-follow cursor smoothing is in-canvas (fine). Motion tokens exist (`--sf-ease`, durations) — extend, don't replace.

---

## Top findings (priority order)

1. **No Home; library-as-home feels like a file viewer.** Welcome card is dead code.
2. **Mode model is broken in UI:** "Play Along" vs code's "Normal playback"; Preview/Listen doesn't exist as a concept; transport vanishes in WFY.
3. **Control panel is a junk drawer:** ~15 sections, duplicated families (transport/tracks/loop/position), diagnostics scattered, Advanced holds everyday controls (metronome details, tracks).
4. **Score gets crowded:** banners stack above notation; floating toolbar overlays the top staff; generous panel padding steals space.
5. **Jargon everywhere:** timing file, MusicXML, anchors, checkpoints, OMR, practice scope, snap mode.
6. **Status languages ×2** (WFY engine statuses + status-strip chips) + 8+ cursor-follow states across 4 surfaces.
7. **Visual Mode framed as a view toggle** when it's a different practice experience; looks nothing like source notation (known, out of scope — but framing is in scope).
8. **Three overlapping import paths** + dev-flavored OMR tooling inside the shipping component.
9. **Icons are unicode glyphs**, no set; token hygiene issues (green-that-is-gray, primary==secondary).
10. **No resume/continue story**, no per-piece progress narrative, stats are tables not trends.
11. **Onboarding tours clutter** instead of teaching progressively; first-import and mode-choice moments have no guidance.
12. **No product sidebar / app shell** — top tab bar only; Practice placeholder is the closest thing to guidance and it's a dead end with two buttons.
