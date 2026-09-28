# Corranzo — Score Workspace Spec

The most important screen. Normative for implementation phases D/E: which controls stay visible, which collapse, which pop over, which appear contextually. Assumes the recommended direction (Studio Console structure, editorial voice) but the information hierarchy stands regardless.

## 1. Layout

```
┌──────────────────────────────────────────────────────────────┐
│ context bar (40px): ‹ back · Piece title · view toggle │ ⋯   │  always visible
├──────────────────────────────────────────────────────────────┤
│ state banner slot (only when needed — never stacked, p. §8)  │
│                                                              │
│   SCORE CANVAS (paper sheet, centered, max-width by zoom)     │
│   floating: page ‹ n/m › (auto-dim) · annotation mini-tools  │
│   WFY target callout docks above deck when active             │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ MODE SWITCH: Preview · Play Along · Wait For You (segmented) │  always visible
│ TRANSPORT DECK (mode-aware, never vanishes — §3)             │
└──────────────────────────────────────────────────────────────┘
Right inspector (overlay drawer, default closed on small / open on wide):
  Tempo · Metronome · Loop · Tracks · Cursor · Annotations · Stats
Sidebar (product nav) collapses to rail automatically in Score.
```

Principles: **notation gets >70% of pixels** at 1440×900; chrome is pinned top + bottom, never floating over the first staff except the auto-dimming page control; the right inspector is an overlay (doesn't reflow the score) so opening it never shifts notation.

## 2. Top context bar (always visible)

- Back (to Home/Library, preserves scroll), piece title (editorial serif accent allowed) + source badge only when non-obvious (e.g. "Auto-read" for OMR timing — replaces today's scattered OMR banners; details in score menu).
- View toggle: **Score | Guide** (renamed from "Visual" — see §9). Segmented, keyboard accessible.
- Score menu (⋯): zoom/page controls, paper theme, fullscreen/focus mode, page-follow toggle, report problem, keyboard shortcuts, diagnostics (gated — see §8).
- Annotation tools live on-canvas (§7), not here.

## 3. Mode selector + transport deck (always visible)

The mode switch is the workspace's primary control — centered, 3 detented positions, each with a one-line plain-language subtitle shown on selection and in a `?` explainer:
- **Preview** — "Listen and follow the score."
- **Play Along** — "Play together; the cursor keeps time."
- **Wait For You** — "Pauses on each note until you play it."

Deck configurations (morph, don't jump — same container, rows swap):
- **Preview:** Play/Pause + Stop + time + seek + tempo (compact slider + BPM) + follow toggle. Minimal by design.
- **Play Along:** Preview deck + metronome toggle (+ details popover: subdivision, count-in, volume, beat LED) + loop button (opens loop popover) + tracks button (opens tracks popover) + count-in readout.
- **Wait For You:** target callout module ("Play this: E–G–C · Measure 3" + position "12 of 48") with Continue / Skip / Hint / Play-reference beside it; tempo (compact, still matters) + input source chip (Manual/MIDI/Mic — opens chooser) + loop + Stop. Transport play is replaced by checkpoint motion (pressing play area advances the *reference*; never ambiguous).
- Mode is remembered per piece; first-open default is Preview.
- Keyboard: `1/2/3` switch modes, `Space` play/pause (or WFY Continue when waiting — same muscle memory), `F` focus mode.

## 4. Tempo

- Visible in deck (all modes): slider 25–150% with detent chips (50/75/100), BPM readout computed from score marking, "original" reset.
- Tap-tempo + exact-BPM entry live in the Tempo popover (inspector → Tempo row opens same popover). No separate full/compact components — one component, density prop.

## 5. Metronome

- Deck toggle with beat LED + count-in badge. Details (subdivision, count-in bars, volume, sound check) in popover. Advanced timing diagnostics are NOT here (see §8).

## 6. Loops

- Deck button shows loop state ("Off" / "Bars 4–8 ×"). Popover: **"Loop this bar"** (one tap — the 80% case), Set start / Set end (at current position), snap (Bar/Beat, default Bar), saved loops for this piece (named, tap to jump), Clear.
- Loop region renders on the score (measure highlight band) AND in Guide lane. This closes today's gap (lane-only rendering).
- Loops persist per piece; Practice area lists them (§: per-piece section).

## 7. Tracks / sound

- Deck button (speaker icon + "2 tracks") opens Tracks popover: per-track mute/solo + volume, instrument voice state in plain words ("Piano sound ready" / "Using basic sound while samples load…"), test-sound, Safari notice inline when relevant.
- No "Sound issue" alarm for normal sample-loading; loading is a quiet progress state.

## 8. Cursor / follow / processing / errors (one state machine, one banner slot)

Cursor states (sole vocabulary, replaces 8+ current strings): **Ready · Following · Paused · Needs setup · Working… · Couldn't follow**.
- Exactly one banner slot above the score; states queue, never stack. Priority: error > working > setup-needed > info. Banners carry one primary action ("Set up cursor", "Retry", "Use timing file", "Dismiss").
- "Needs setup" opens the single Cursor setup flow (replaces SetupStatus + SetupPanel + Controls + ApproximateHint + CalibrationDebug as user-facing surfaces; calibration visuals become one inline step).
- Processing (timing prep, OMR follow-setup): indeterminate-but-honest progress ("Reading your score… usually ~30s") + **leave-and-return** (chip on piece; navigation never blocked).
- Errors in plain language with next step; technical detail (measure grid, anchors, diagnostics export) behind "Details" for support, plus report-problem. Dev flags/provenance/trace are build-gated and unreachable in production builds.
- Fullscreen/focus mode: score fills viewport, deck condenses to a floating mini-bar (play, mode, tempo, WFY continue), auto-hide with pin; ESC/`F` exits; banner slot still works (docked top).

## 9. Guide view (renamed Visual Mode)

- Renamed **Guide** ("Note guide" / "Follow the notes") — framed as training wheels, never as an alternate view of the score.
- Entry/exit explains itself: first visit shows one line — "The guide shows which notes come next. Your uploaded score is the source of truth." OMR inaccuracy disclaimer survives as that single line, not a `<details>`.
- Content: current lane + target callout + keyboard/fretboard strip, legend always visible (including WFY), position readout shared with Score view vocabulary.
- Out of scope (explicitly): making Guide look like the source notation (Piano Vision fidelity problem). No layout work in this campaign may assume otherwise.
- `SourcePdfVisualLane` alternative: confirm dead during Phase D, delete.

## 10. Annotations

- On-canvas mini-toolbar (pen / highlighter / eraser / undo), appears on hover/focus near score edge + touch; autosave stays; "Saved" becomes "All marks saved" tooltip on the pen icon.
- Export/import JSON moves to inspector → Annotations row (with list of pages containing marks + clear-page). No annotations minimap in v1 (noted, deferred).

## 11. Zoom / page / follow controls

- Zoom (fit width / fit page / %): score menu + `⌘±` + pinch (if cheap); persisted per piece.
- Page ‹ n/m ›: auto-dimming floating control bottom of canvas + arrow keys + measure jump (`[`/`]`) + "go to bar" entry in inspector.
- Page-follow toggle (cursor auto-advances pages): score menu + persists; when off, manual paging with "jump to cursor" button appears.

## 12. Practice feedback in workspace

- WFY feedback (correct/missed/partial) renders at the target callout + cursor color — not in a separate panel. Reference-play ("hear it") sits beside Continue.
- Session stats collapse to one inspector row ("Today 12 min · best 84%") linking to Practice area. Status strip chips die; replaced by deck LED modules (sound / follow / input — one icon + word each, quiet when fine, explicit when not).

## 13. Visibility matrix (normative)

| Control | Preview | Play Along | WFY | Where |
|---|---|---|---|---|
| Play/Pause/Stop/seek/time | ✅ deck | ✅ deck | Stop only + Continue | deck |
| Mode switch | ✅ | ✅ | ✅ | deck top |
| Tempo | ✅ compact | ✅ compact | ✅ compact | deck; details popover |
| Metronome | follow-only | ✅ + details | count-in only | deck toggle + popover |
| Loop | hidden | ✅ button→popover | ✅ button→popover | deck |
| Tracks | hidden | ✅ button→popover | hidden (reference only) | deck |
| Input source | hidden | hidden | ✅ chip→chooser | deck |
| Target callout | hidden | hidden | ✅ hero | above deck |
| Cursor state | banner if needed | banner if needed | banner if needed | banner slot |
| Annotations | ✅ on-canvas | ✅ on-canvas | ✅ on-canvas | canvas edge |
| Zoom/page/follow | ✅ menu + pager | ✅ | ✅ | score menu + pager |
| Stats | inspector | inspector | inspector | drawer |
| Diagnostics | score menu → Details | same | same | gated |

Nothing else is visible by default. If a control isn't in this table, it's in the inspector drawer or it doesn't exist.
