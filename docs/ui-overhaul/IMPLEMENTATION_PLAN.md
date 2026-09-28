# Corranzo — Redesign Implementation Plan

Constraint: do NOT rewrite the app at once. Each phase is independently testable and shippable; Piano Vision training/model/data/eval code is never touched (UI campaign lives in `src/components`, `src/styles`, `src/features/{navigation,onboarding}`, and new `src/design/` — never in `tools/piano-vision`, `tmp/campaign`, checkpoints, or OMR recognition internals).

## Phase A — Design tokens + shared primitives
Goal: foundation everything else builds on.
- Extend `tokens.css` (spacing 4/8, chrome padding, desk/paper surfaces, sheet/deck shadows, accent + semantic triplets, display scale); fix hygiene (`accent-green`, primary/secondary dup, subtle/faint usage rules).
- Vendor icon set; forbid new unicode-glyph icons (lint note).
- Build primitives: Button, IconButton, SegmentedControl, Slider, Chip, Popover/Menu, Dialog, Banner/Toast queue, Tooltip/HelpTip, EmptyState, Progress, Skeleton, Kbd.
- Copy glossary file (`notes file`, `Guide`, `Auto-read`…).
- Tests: token snapshot (no un-tokenized hex in new components), a11y smoke (focus ring, contrast pairs, reduced-motion), Storybook-style showcase page if cheap (dev-only route, never linked in prod).
- Done when: primitives render in isolation; audit's icon/token complaints resolved.

## Phase B — App shell + collapsible sidebar
Goal: product-wide navigation exists.
- New `AppShell`: left sidebar (Home/Library/Practice/Import action/Settings; rail 56px ↔ 240px, persisted, keyboard toggle), slimmed top context bar, footer links move to Settings/About.
- Routes: add `home` (`/`) + `settings` (`/settings`); rename `profile`→`practice` route id (keep redirect); Practice Library stays default landing until Home is ready (flag), then Home becomes `/`.
- Product sidebar auto-collapses to rail in Score.
- Tests: nav E2E (each destination, deep links, unknown→home), sidebar persist/collapse, instrument-switch still resets session w/ explanation copy.
- Done when: sidebar navigates everywhere; top tab bar removed; no dead `sidebarOpen` couplings.

## Phase C — Home + Library
Goal: first-use experience stops feeling like a file viewer.
- Home: Continue card (resume w/ position+tempo), capability primer (5 real entries, deep links), starters, recents; first-run hero (resurrect + polish `LibraryWelcomeCard` content; delete the dead-flag path).
- Library: shared `PieceCard` (resume line, recency), real delete dialog, upload entries route to Import; `LibraryAccuracyGuide` content migrates toward Import/Home (component retired or repurposed).
- Tests: first-run vs returning states, resume restores position/tempo/mode, delete flow, search/filter preserved.
- Done when: new users meet Home; returning users resume in one tap.

## Phase D — Score workspace / mode architecture
Goal: the workspace skeleton + true three-mode model.
- Layout per spec (context bar, banner slot, canvas, mode switch, deck mount, inspector drawer); score keeps >70% pixels; inspector overlays.
- Introduce **Preview** as an explicit mode (default for new pieces); migrate `NORMAL`→Play Along labeling; per-piece mode memory; `1/2/3` shortcuts.
- Collapse view toggle to Score|Guide (rename; Guide framing copy).
- Delete-or-merge pass: `SourcePdfVisualLane` (confirm dead), fullscreen dup, `PracticeTransportSection` vs tick (one TransportCluster wins).
- Tests: mode matrix (each mode's visible controls), per-piece memory, deck never unmounts between modes, Guide disclaimer, fullscreen/focus behavior.
- Done when: mode confusion eliminated; workspace matches visibility matrix (§13 of spec).

## Phase E — Playback / practice controls
Goal: every deck module + inspector row, deduplicated.
- Tempo (slider+chips+popover tap-tempo), metronome (toggle+LED+details popover), loop editor (one-tap bar loop, saved per piece, on-score highlight), tracks popover (mute/solo, plain-words voice state), WFY target callout + input chooser (inline, replaces modal-first) + reference play.
- Unify families: position ×3→1, tracks ×2→1, loops ×2→1, diagnostics ×6→1 gated Details surface.
- Cursor/follow single state machine + banner slot + one setup flow (replaces 4+ surfaces).
- Tests: WFY end-to-end (manual/MIDI/mic mocked), loop save/restore, cursor states tour, OMR failure copy paths, keyboard map.
- Done when: audit's junk-drawer panel is gone; Advanced holds only true advanced.

## Phase F — Import / onboarding
Goal: one import path + contextual teaching.
- Import wizard (Add → Identify → Prepare → Ready) with Piano Vision progress + honest fallback + leave-and-return chip; MuseScore message preserved but styled; `MultiFileUpload` + step-cards merge into wizard steps.
- Dev OMR tooling build-gated out of prod.
- Onboarding: retire 7-step tour script (keep mechanism); ship contextual tips (first play, first mode switch, first WFY, first loop, first mic/MIDI); `PracticeHelpTip` copy pass to musician language.
- Tests: PDF-only, PDF+timing, PDF+MIDI, failure/retry, background-leave-return, first-run tip triggers fire once.
- Done when: three upload paths → one; new users can import without help.

## Phase G — Polish, responsiveness, motion, accessibility
Goal: the brief's "polished" bar, verified.
- Responsive: 1440/1280/1024/768/390 + fullscreen-practice + score-focus; no banner-induced layout shift; floating pager never covers first staff; 40px+ targets.
- Motion: deck morph, drawer, banner queue, beat LED, WFY pulse — all tokenized + reduced-motion verified (extend existing media queries; include WFY pulses explicitly).
- A11y audit: contrast table, screen-reader pass of deck/WFY/banners, focus-return everywhere, `confirm()`-hunt (zero remaining).
- Empty/loading/error copy pass with shared `EmptyState`; illustration slot (1–2 simple SVG motifs, music-first, no stock).
- Tests: axe-style checks, keyboard-only run-through script, reduced-motion snapshot, viewport matrix screenshots.
- Done when: checklist in this doc is green; performance (no new jank in cursor rAF) confirmed.

## Ordering + guardrails
- Order: A → B → C → D → E → F → G. B before C (shell hosts Home); D before E (deck hosts modules); F can parallelize with E after D's skeleton lands.
- Each phase: behind existing views until its own flag flips (no big-bang); keep current CSS files untouched until their phase, then migrate.
- Never in this campaign: Piano Vision fidelity, transcription/Learn/ear-training features, multi-instrument transcription, gamification, sharing/social.
- Stop-and-review gates: after A (tokens+icons), after D skeleton (workspace IA), after F (import). Do not start implementation until the audit/direction review (this doc set) is approved.
