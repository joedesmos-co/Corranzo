# Corranzo — Product Information Architecture

Design target, not current state. See `CURRENT_UI_AUDIT.md` for the as-is.

## 1. Product areas (v1 scope)

```
Home          The front door. Continue practicing, orientation, entry points.
Library       Scores. Built-in pieces + My Uploads. (Scores = the collection.)
Score         The workspace. One piece open; notation is the hero.
Import        Adding a score. (A flow, reachable from Home + Library.)
Practice      The habit layer. History, per-piece progress, resume. ("Progress"
              view is renamed Practice — see §3.)
Settings      App preferences, audio/MIDI devices, files/storage, about.
```

Future areas slot in without restructuring (see §4).

## 2. Navigation model

- **Collapsible pull-out sidebar** (left, desktop) with: Home, Library, Practice, Import (primary action, emphasized), Settings. Footer of sidebar: current piece mini-resume ("Continue: Minuet in G — p.2") when one exists.
- **Collapsed state:** icon rail (~56px). **Expanded:** ~240px with labels. Persisted preference. Keyboard toggleable.
- **Top bar shrinks** to: back/context (piece title in Score), instrument switcher, Help. No more Library/Practice/Progress tabs — the sidebar owns navigation.
- **Mobile/narrow:** sidebar becomes overlay drawer; Score gets bottom transport bar (see `SCORE_WORKSPACE_SPEC.md`).
- Naming fix: `profile` → **Practice** everywhere (route id, label, copy). TopBar's "Progress" label dies with the tab bar.

## 3. Area definitions

### Home (`/`)
Purpose: answer "what do I do now?" in <5 seconds.
Blocks: Continue card (current/last piece, position, one-tap resume) → capability primer (Import · Listen · Play Along · Wait For You · Practice tools — each linking to the real place, no fake features) → built-in starter pieces → recent pieces.
Empty (first launch): Welcome hero (resurrect `LibraryWelcomeCard` content: demo-first, "scores follow you", local-first) → Try Demo (primary) → Import (secondary) → How it works (3 steps).
Must not advertise: transcription, Learn, audio→sheet — at most a muted "Roadmap" line in Settings/About, never as cards with CTAs.

### Library (`/library`)
Keeps the two-tab split (Built-in / My Uploads) — it tested well in audit. Changes: recency + resume affordances per card ("Last played Tue · Bar 12"), consistent card component with Home, real delete dialog (no `window.confirm`), search/filter preserved. Upload entry points route to Import flow rather than inline triple-path.

### Score (`/score` — the workspace)
One piece open. Full spec in `SCORE_WORKSPACE_SPEC.md`. IA points: mode selector (Preview / Play Along / Wait For You) is the workspace's primary control; transport is persistent and mode-aware (never vanishes); everything else (tempo, metronome, loops, tracks, cursor setup, annotations, diagnostics) is progressive: primary → popover → Advanced drawer.

### Import (`/import`)
One guided flow replacing the three overlapping paths: Add files (single dropzone, auto-classify) → Identify (PDF / timing / sound cards in plain musician language) → Prepare (Piano Vision runs here with honest progress; timing-file option always visible) → Ready (lands in Score). Detailed step-copy in implementation phase; guide principle: **one path, plain words, timing file optional and explained**.

### Practice (`/practice`, ex-Progress)
Three jobs: **Resume** (current piece, position, tempo), **Review** (history, per-piece trends: time, tempo progress, sections looped), **Record** (manual log). No gamification: no streaks, no XP, no badges. Weekly summary in words ("3 sessions · 48 min · Minuet tempo 70→84%"). Per-piece page (or section): tempo-over-time, loops saved, last position.

### Settings (`/settings`)
Playback & sound (instrument, sample quality, test sound), Inputs (MIDI devices, microphone + calibration), Score display (paper theme, follow behavior, cursor), Files & storage (what's stored locally, clear, export annotations), Accessibility (reduce motion override, hit-target density?), About (version, roadmap note, feedback/contact, legal). Device permission states currently scattered across WFY panels consolidate here with progressive re-prompts in context.

## 4. Future areas (reserved, not built)

| Future | Reserved slot | Rule until then |
|---|---|---|
| Audio → sheet (Easy/Med/Hard) | Import gets a second entry "Transcribe audio" (disabled with "Coming later" — or hidden; decide in visual design, default hidden) | Never show arrangement-difficulty UI now. |
| Learn / theory / quizzes / ear training | Sidebar section "Learn" (hidden until v1 ships) | No placeholder nav items. |
| Record yourself → sheet | Import entry, same treatment as audio | — |
| Multi-instrument / band | Per-piece track model already exists; IA keeps "Tracks" as a Score concept so ensembles extend it | Don't hardcode piano/guitar assumptions in new components. |

Sidebar is built section-aware from day one (Product / [Learn — hidden] / Library footer) so adding Learn later is a flag flip, not a restructure. Import flow is step-based so "Transcribe" becomes an alternative step-1 source.

## 5. Primary user journeys

**A. First launch.** Home (welcome hero) → Try Demo *or* Import → (demo) Score in Preview with coach-mark "Press Play — the score follows" → dismiss → free exploration. No account, no modal chain; the 7-step tour is replaced by 2–3 contextual tips (see §6).

**B. Import PDF.** Home/Library → Import → drop PDF → Identify (auto: "Sheet music ✓") → Prepare: Piano Vision progress ("Reading your score… ~30s") with honest fallback ("Couldn't read enough — add a timing file instead") → Ready → Score.

**C. Piano Vision processing.** Lives inside Import/Prepare, *and* as a resumable background state: leaving mid-run shows a quiet progress chip on the piece card; returning re-attaches. Failure → plain-language message + two choices (retry / add timing file) + report-problem link. Never blocks navigation.

**D. Open score.** Card → Score workspace, Score view, Preview mode default for new pieces (safest: press play, hear it, watch cursor), last mode remembered per piece afterwards.

**E. Preview / Listen.** Mode → Preview: transport plays, cursor follows, panel collapses to minimal (tempo + follow toggle). This is the new explicit mode, not hidden inside Play Along.

**F. Play Along.** Mode → Play Along: full transport + tempo + metronome + loops + tracks; cursor follows; mic/MIDI optional overlays off by default.

**G. Wait For You.** Mode → Wait For You: first entry shows input chooser (Manual / MIDI keyboard / Microphone) inline in the transport zone, not a modal; checkpoint target callout is the hero ("Play this: E–G–C"); Continue/Skip/Hint beside it; reference-play available; settings (tolerance) one popover deep.

**H. Create loop / practice section.** In Play Along or WFY: Loop button → "Loop this measure" (one tap, uses current measure) → refine via Set start/end or drag on a mini-overview; named + saved per piece; loops listed in Practice per-piece section.

**I. Resume practice later.** Home Continue card *or* Library card resume *or* Practice area → exact position + tempo + mode restored; "Last time: Minuet, 72%, bar 12" line confirms continuity.

## 6. Onboarding strategy (contextual, no long modals)

- First launch: hero + demo (Home).
- First import: the Import flow *is* the tutorial (each step explains itself; `LibraryAccuracyGuide` content moves here).
- First Score open: single coach-mark on Play ("Press Play — the cursor follows the music").
- First mode switch: one-line mode descriptions in the mode selector itself (Preview: "Listen and follow" / Play Along: "Play together, cursor keeps time" / Wait For You: "Stops until you play each note").
- First WFY: inline input chooser + "Try Manual first" hint.
- First loop: empty-state hint in loop popover ("Loop the bar you're on").
- First mic/MIDI use: permission + calibration inline, with Settings fallback.
- The existing `GuidedTutorial` mechanism is kept; its 7-step script is retired and replaced by the above triggers.
