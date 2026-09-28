# Corranzo takeover review — 19 September 2026

Stage 1: audit, revised direction, and a bounded visual proof. **Phase D has not started.**

Worktree: `/Users/ryland/Documents/scoreflow-ui`  
Branch: `codex/corranzo-ui-overhaul-v1`

The earlier campaign arrived with uncommitted source changes and untracked Phase A–C components/docs. These are the starting point, not disposable files. Baseline source hashes and the inherited diff are stored locally in `tmp/ui-takeover-review/`. Browser captures are in `review/`.

## Verdict

The architecture is further along than the product design. The current screens look like a dark settings application with music loaded into it. Brown surfaces and gold buttons supply a theme, but they do not establish an identity. A screenshot could belong to an asset manager, a developer console, or an early component demo.

Phase C is not complete in the working tree. Home mounts the whole Library before its own small panel; fresh visits still default to Library; the brand link also targets Library. First-run Home is two buttons and three low-contrast tooltip labels. Returning Home knows a filename, but ignores the `practiceReady` prop. The original documentation describes an ambition, not the shipped screen.

The score is the strongest visual material the product has, yet it is absent from Home and the Library. Bring the actual music into the composition. Remove decorative containers before inventing more components.

## Audit and critique

| Area | Finding | Decision |
|---|---|---|
| Tokens | Two simultaneous systems: white `--sf-*` accents and gold `--cz-*` accents, brown panels, blue hard-coded hints, purple legacy inputs. Primary and secondary text are both white. Large generic panel padding leaks into dense controls. | Introduce a deliberate collection palette and scoped roles. Keep legacy practice tokens stable during this review proof; consolidate them in D rather than restyling the engine's whole UI accidentally. |
| Typography | Sans headings compete with tiny mono uppercase labels; serif appears mostly in the wordmark. No meaningful contrast between a composition title and a settings heading. | Large editorial headlines and score titles; readable sans controls; numerals only where they convey actual order/time. No ornamental metadata wall. |
| Primitives | Useful icon registry, buttons, fields, reduced-motion tokens. ModeSwitch has a border, raised fill, left marker, pip, icon and subtitle competing to say “selected.” Popover uses menu semantics without menu keyboard navigation. SegmentedControl can stop on a disabled option. | Keep architecture, simplify selection to one mark. Audit keyboard semantics as controls enter D. Settings controls should not look like a sandbox export. |
| Sidebar | Generic rounded active row, generic layered Library icon, a `C` in a box duplicated in the header. Settings has the same priority as the score. Collapse is exposed twice. | A single staff-derived mark, editorial navigation, deliberate action/utility grouping, a compact rail, and a quiet header. Keep real destinations; add no unfinished ones. |
| Shell behavior | Drawer scrim has z-index 75 while the drawer wrapper stays at 40: it covers the navigation. Closed off-screen navigation remains keyboard-focusable. Escape restores focus to a hidden span, not the trigger. No modal focus containment. | Fix these as part of the direction proof; a beautiful drawer that cannot be used is not polish. Preserve desktop collapse preference. |
| Home | Library renders above Home. Welcome hero and guided tutorial can further compete with it. First-run and returning states are placeholders. | One Home main landmark, one clear first action, a real starter score, a compact collection, and reopening only when the piece is actually ready. |
| Library | Card-in-card hierarchy, repeated instrument/difficulty/duration, identical large Start buttons, attribution squeezed beside titles. Much of the viewport repeats framing. | An editorial score list with real titles and credits, readable duration/difficulty, one subtle open action per row. Preserve search, filters, fixture loading, uploads and attribution. |
| Import | Functional batch classifier, PDF preparation, replacement ownership and retries are valuable. UI repeats “timing file,” MusicXML, numbered advanced inputs and readiness information. | Keep implementation. A full import rewrite is outside this stage. D errors should say what the musician can do next; technical file help stays available. |
| PracticeView | A score column and permanent control column inside a shell that can also retain a large left sidebar. View switch consumes a separate strip. Several independent preparation/follow/warning surfaces. | Replace the permanent control column with a stable bottom transport and contextual tools. Preserve page/cursor geometry and score identity. |
| ControlPanel | Piece title → tempo before play → mode radios → hands → input → WFY → cursor → loop → statuses → stats → Advanced. This is source-code organization expressed as UI. | Arrange by the musician's task: choose a mode, start, adjust tempo, work a passage. Move setup/tracks/advanced matching out of the default reading path. |
| Transport | Play is visually secondary to the tempo form. Stop and sound test vanish in the compact transport. WFY removes the transport entirely. The custom memo comparator ignores callback and blocked-title changes. | One stable transport position and one owner. Keep meaningful controls accessible in every mode. Fix memo correctness when integrating the new deck. |
| Mode model | Design prototype has three modes; live engine has `normal` / `wait-for-you`. Live labels call normal “Play Along”; constants call it “Normal playback.” | One product mode source: Preview, Play Along, Wait For You. Explicit migration of persisted normal mode; no cosmetic renaming of one state into two. |
| Play Along | Contrary to the older audit, microphone/MIDI matching and timed lane feedback already exist in `usePracticeSession`. This is not merely normal playback. | Preserve these paths. Preview must bypass matching/input capture; Play Along exposes backing, count-in, hands/parts and optional input feedback while time continues. |
| Input setup | A blocking mic/MIDI modal opens on entry to Practice even in the normal mode. The piano layout offers no visible “not now” or manual option, though Escape dismisses it. | Ask inline when a mode needs input. Keep “Use Continue” available in WFY; never request device access on Preview entry. |
| WFY | Valuable chord/hand guidance, hear-reference, continue/skip/restart, mic calibration, MIDI selection and matching. Too many statuses and nested controls. | A single clear “Your turn” target with the actual note/chord, measure and action. Input state beside the target; match tuning in a disclosure. Preserve matching logic. |
| PDF | Real score rendering, cached sizing, adjacent preloading, overlays and persisted annotations are useful infrastructure. Toolbar mixes Unicode glyphs with new SVG controls. “Saved” is always shown, not an actual save acknowledgement. | Keep the rendering/geometry chain. Use shared icons; make page/fit/marks explicit. Do not claim a save succeeded without evidence. |
| Annotations | Per-score identity, page-scoped strokes, undo/erase and JSON import/export are already present. Browser verification found that navigating away within the 600ms autosave delay loses the latest mark: unmount cancels the pending timer, while the toolbar still says “Saved.” Completed saves restore correctly. | Preserve coordinate transforms and score identity. In D, flush pending marks before navigation/unmount and display actual save state. A compact annotation palette, with export/import tucked into details. Test immediate navigation as well as resize, reopen and focus mode. |
| Loops | Start/end at current position, measure/beat snapping, enable/clear and WFY range already exist. Compact wrapper calls the full control with compact density. | Keep the existing range model. Show “Set start here / Set end here” and the resulting bars. Do not add named/saved-loop product features merely because the old spec suggests them. |
| Tempo/metronome | 25–150% rate, computed BPM, subdivision, volume and count-in already exist. Tempo is always a full form; ordinary and advanced metronome controls are split. | BPM + rate in the deck; exact rate/presets in a popover. Metronome toggle visible; count-in/subdivision/volume contextual. Tap-tempo is not required to complete this campaign. |
| Tracks/mute | Existing backing track mute and hand scope serve different purposes; do not conflate them. Track controls are buried in Advanced and depend on a MIDI source. | Tracks/parts popover with honest availability; preserve mute semantics and instrument routing. Do not promise solo or per-track volume unless supported. |
| Score following | Auto-setup, trusted anchors, approximate states, page-follow and target overlays are integrated deeply. Multiple user-facing surfaces repeat explanations. | One concise status slot and one setup entry. UI aggregation only; leave trust, recognition, timing and alignment calculations intact. |
| VisualPracticeView | Synthesized staff/tab lanes, keyboard/fretboard and timed feedback. WFY duplicates the note target in the lane and sidebar; its legend is hidden. `SourcePdfVisualLane` has no imports. | Presentation name “Note guide,” subordinate to Score and independent of practice mode. Preserve an honest source-fidelity explanation. No model work; no lane deletion required in Stage 1. |
| Focus/fullscreen | Existing portal traps focus, restores prior focus, supports pinning and auto-hide. Its capture-phase Escape can close fullscreen before a popover; arrows can intercept form editing. Guide unmounts the PDF and loses its fullscreen action. | One workspace-level focus owner in D, including Guide. Escape closes the innermost layer; editable controls own their keys. Use the same transport in both layouts. |
| Keyboard | Space plays only normal mode; WFY uses Enter/N; F is fullscreen. Page arrows and Shift+arrows jump measures. Global handler ignores editable fields but not focused buttons or Ctrl/Meta modifiers. | Maintain familiar keys and add mode 1/2/3. Do not hijack typing, buttons, browser shortcuts or dialogs. Centralize precedence and validate it in browser. |
| Responsive | Shell thresholds are 1100/760, with many older practice rules. Header is 60px while old workspace math assumes 72px. Home adds a full viewport below the header. | One shell height contract. Score viewport first; collapse chrome at laptop sizes; drawer/sheet tools on narrow screens. Test actual bounding boxes, not just CSS breakpoints. |
| Onboarding | Nine-step spotlight is automatically opened. It teaches internal file/setup concepts before the user has heard music. | Fresh entry uses contextual Home copy. Retain an explicit Help → Replay tutorial for now. Contextual score hints belong to D; no replacement giant tutorial. |
| Reopening/resume | Browser check found that tempo and metronome reset when reopening. `useScorePlayback` initializes defaults on mount; the practice snapshot omits these fields, and App retains an older initialization snapshot. The source-change effect also resets position on mount. | Stage 1 labels the action “Return to score” honestly. Full position/tempo/loop/mode restoration is a D acceptance requirement, not a completed Phase C feature. |
| Tests | Several tests assert obsolete source strings rather than rendered behavior. Old audit incorrectly calls PracticeTransportSection dead: PracticeTransportTick mounts it. | Keep meaningful library/session/geometry tests. Add a browser review for navigation, focus, search and responsive behavior; report baseline failures separately. |

## Revised direction: the score edition

Retain the useful contrast between a welcoming collection and a focused practice room. Replace the brown-and-gold component aesthetic with **warm paper, near-black ink, and a restrained vermilion editorial mark**. This is a substantial visual change and requires review before D.

- Home and Library are a collection of music, not a dashboard: strong typesetting, fine rules, numbered entries, real notation, no invented progress/streaks or ornamental cards.
- Navigation is like the contents of a score edition. Expanded labels have presence; the compact rail is precise. Import is an action; Settings/History are utilities.
- A custom staff-derived C appears once in the chrome. No stock illustration, floating neon shapes, fake album artwork or persistent animation.
- Warm paper is a real canvas in collection views. Practice stays an ink-dark work surface with readable score paper. Do not tint or invert musical notation to force the brand palette.
- Ink handles primary actions on paper. Vermilion marks selection and a few editorial accents. Errors always have language/icons; brand color alone never means an error.
- Motion is short hover/press feedback and restrained navigation transitions. Reduced motion is respected. Real notation can have selective physical depth on Home; controls remain flat and readable.

## Stage 1 implementation boundary

Implement Home, a collection list treatment, shell identity, header restraint, and drawer usability. Fix Home composition/default navigation and make the old tour opt-in. Wire to real existing load/reopen actions. Do not change practice mode engines, audio, recognition, training, alignment, datasets, score cursors or annotations. Do not introduce future navigation.

The current Practice screen remains a documented legacy screen until this direction is reviewed. Its existing gold/blue details are not presented as finished visual alignment.

## Phase D plan — subject to this review

### Composition

Desktop target: a 64px product rail, 52px workspace context row, flexible score canvas, and a 92–112px bottom control area. At 1440×900, allocate at least 70% of the viewport to the **score canvas**; actual page area depends on aspect ratio and fit. No permanent right inspector. At 1280×800 the score remains primary; at 900px and below tools become anchored sheets and the navigation becomes a temporary drawer at the existing narrow threshold.

```
rail | ‹ Library    Menuet in F, K.2           Score / Note guide    Focus
     | [one actionable status only, when necessary]
     |
     |                        SCORE
     |                (existing PDF + overlays)
     |                         [page / fit / marks]
     |
     |          [WFY target, only in that mode]
     | Preview     Play Along     Wait For You
     | restart  PLAY   bar / time / seek    tempo    click  loop  parts  …
```

The transport is a compact instrument below the score, not another card gallery. Keep its play action in a stable place across modes. The mode selector uses a clear underline/mark and one contextual explanation, not three permanent help paragraphs.

### Behavioral contract

| Mode | Clock/input | Main action | Context |
|---|---|---|---|
| Preview | Score clock runs; no microphone/MIDI matching or device prompt | Play / Pause; restart and seek remain reachable | Listen and follow. Tempo, loop and sound options remain available through tools; switching mode must not discard work. |
| Play Along | Score clock runs regardless of played notes; existing timed matching optional | Play / Pause with count-in shown when enabled | Backing parts, hands, metronome and loop. Input chooser only when the user enables listening feedback. |
| Wait For You | Existing checkpoint engine advances on played notes or manual Continue | Continue in manual mode; a clear listening/pause state with connected input | One target, Hear it / Skip, input state, hands/parts and loop. Restart available without changing modes. No generic Play action whose meaning secretly changes to reference playback. |

Mode changes pause outgoing playback, release outgoing input matching, retain score position/loop/rate when meaningful, and initialize the incoming mode from that position. No simultaneous audio/recognition ownership. Normalize old `normal` preferences explicitly and retain existing WFY values. Per-piece mode memory needs a score-identity-aware migration; do not pretend the present global practice preferences already supply it.

### Control placement and implementation order

1. **Mode model, resume and ownership.** Restore the same score's position, loop, tempo, metronome and mode from a complete owned snapshot; distinguish reopening from replacing sources so initialization does not reset the saved position. Flush pending annotation saves before leaving and expose truthful save feedback. Unify `design/modeOptions` with the live practice vocabulary. Add explicit Preview matching/capture gating, migration and mode-switch tests. Retain the separated stable/tick/visual contexts so the score does not rerender on each clock tick.
2. **Workspace frame and transport.** Mount the existing PDF/overlay chain unchanged in a score-first frame. Extract the current transport into one reusable deck, fix stale memo props, keep disabled reasons visible, and connect mode state. Header owns piece/context, not playback.
3. **Contextual tools.** Reuse current loop range, tempo, count-in, tracks/mute, hand scope, page-follow and annotation handlers. Use popovers for simple settings and a narrow sheet for detailed setup. Mark active loop/metronome states without opening their panels. Focus returns to the initiating control.
4. **WFY presentation.** Consolidate target/status/input. Preserve chord/hand guidance, reference playback, manual fallback, MIDI selection, mic calibration and wrong/partial/correct feedback. Permission denial leaves manual practice usable. No automatic permission prompts.
5. **Note guide and focus.** Separate presentation (Score/Note guide) from practice mode. Both use the same mode/transport. Retain the source-fidelity disclosure and existing lane engine. A workspace-level focus mode removes product chrome; Escape/F exits without restarting the piece or losing marks.
6. **State language and onboarding.** Aggregate existing UI status, without altering recognition policy: loading/preparing, ready, follow off, follow unavailable, input disconnected, playback error. One highest-priority actionable message; details expandable. Contextual tips for first mode/input/loop use, dismissible and locally remembered.
7. **Verification.** Build, relevant unit tests, and browser interaction checks. Fresh load, resume, PDF-only, built-in score and denied input states; modes 1/2/3; Space/Enter; F/Escape layering; loop/seek/tempo/count-in/mute; page-follow and annotations across focus/resize/reopen. Review at 1440, 1280, 1024, 768 and 390px, plus reduced motion. Hardware accuracy remains outside UI verification.

Deferred: named saved loops, tap tempo, transcription, arrangements, theory/ear training, recording and band features. Do not extend the old phase plan automatically.

## Safety at each milestone

All working commands use the UI worktree. No commands change branches in the original checkout, signal training processes, or access checkpoints/datasets/sidecars/test or future-test data. Read-only process inventory at takeover identified the existing validation driver PID 67303 and its evaluation child PID 98811; these were not controlled by this task. Final source-hash verification confirms that practice, playback, recognition, score-follow, PDF, hooks and context code stayed unchanged from the takeover baseline. This includes preserving inherited changes already present in PracticeView and MidiTransportControls. The original process lifecycle remains outside this task's control; no claim is made about whether those processes are still running.

See [Stage 1 review status](REVIEW_STATUS.md) for implemented scope, screenshots and verification results. Earlier design/specification documents remain historical context; this review records the revised proposal and the explicit stop before Phase D.
