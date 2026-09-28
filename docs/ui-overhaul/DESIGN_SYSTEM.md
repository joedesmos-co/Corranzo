# Corranzo — Design System Foundation

Evolves today's tokens (`src/styles/tokens.css`), doesn't torch them. Consumers: Phases A–G in `IMPLEMENTATION_PLAN.md`.

## 1. Principles

1. Tokens over page CSS. No new hex/radius/spacing outside `tokens.css` (lint it).
2. One component per family (collapses today's full/compact triplicates) with `density="comfortable|compact"` + `context` props.
3. Score-first: a `workspace` density with tighter chrome; marketing-ish padding never leaks into Score.
4. Accessibility is a token property (contrast pairs, target sizes, motion fallbacks), not a per-page afterthought.
5. Two temperatures, one product: Score/Practice is dark, precise, studio-like; Home/Library is warmer and editorial (ivory paper, serif titles, shelf rows). Chrome stays dark everywhere — warmth enters through paper, titles, and collection surfaces, never as full-app beige.
6. Status defaults to inline icon + word (`StatusLine`); contained pills (`Badge`) only for flags that need a boundary. Never a row of colored pills as decoration.
7. Brand gold is for primary actions and active states (fills allowed); warning orange is text/icon only, never a fill. If it reads as alert, it must not also be the brand.

## 2. Typography

- Keep Inter/system stack as UI face (`--sf-font-sans`); add one display face for editorial moments only (Home headlines, piece titles, big empty-states) — `--sf-font-display`. Mono stays for time/BPM/data (`--sf-font-mono`, tabular numerals).
- Scale (1.25 ratio-ish, keep current values, rename clearly): `micro 10px / caption 12 / small 13 / body 14.4 / section 16 / heading 18 / title 24 / display 32–40` (display new, Home only).
- Rules: sentence-case UI strings; micro-kickers (tiny uppercase labels) are a sandbox/documentation device only — production UI uses natural labels, never all-caps microcopy everywhere; never all-caps body; WFY target notes always ≥ 18px semibold (glanceable at piano distance).

## 3. Spacing / radius / borders

- Keep 6/12/20/32 scale; **add 4/8** for control interiors (`--sf-space-2xs:4px, --sf-space-2xs…` — name: `--sf-space-3xs:4px`, `--sf-space-2xs:8px`). Split panel padding: `--sf-panel-padding` stays generous for Home/Library; new `--sf-chrome-padding: 8–12px` for Score chrome. This fixes "luxury padding eats notation" without touching marketing surfaces.
- Radius: keep 4/6/8/10/pill; assign roles: controls 6–8, cards 10–12, deck 12, chips pill.
- Borders: keep zinc 1px trio; add `--sf-border-accent` (active mode underline/pip) + focus tokens as-is.

## 4. Surfaces / elevation / color roles

- Roles: `bg-app / bg-raised / bg-panel / bg-inset / bg-score-desk` (new: canvas behind paper sheet) / `bg-paper` (new: notation sheet, always light `#faf8f2` w/ dark-ink notation — never invert the score) / `bg-overlay`.
- Elevation: keep flat default; add **two sanctioned depths**: `shadow-sheet` (score paper on desk) and `shadow-deck` (transport deck). Nothing else casts shadows — gimmick-proof by token.
- Accent: one signal color (recommendation: warm amber per Direction B; validate contrast at 13px+ bold and for LED dots at 3:1+). Semantic: `success` (desat green), `warning` (amber-brown), `error` (clay red) — each with bg/text/border triplets so statuses never rely on hue alone (icon + word always).
- Fix hygiene: rename `--sf-accent-green` (it's gray); merge `--sf-text-primary/secondary` into distinct values or delete one; `--sf-text-subtle/faint` restricted to decorative/large text (contrast).

## 6. Components (Phase A / Phase B)

### Primitives (Phase A)
- Button (primary/ghost/danger/icon/size), IconButton (icon+label, decorative defaults), SegmentedControl (`cz-segmented`, radio group semantics, keypress navigation), Slider (`cz-slider`, progress/value),
- Badge (`cz-badge`, contained pill), StatusLine (`cz-status`, inline icon+word default), Popover (`cz-pop`, menu role + outside-dismiss),
- TextField/TextInput/Select/dropdown, Toggle (switch role), Control sizing (--cz-control-h-*, --cz-target-min), EmptyState (`cz-empty`, staff motif + medallion, serif title).

### Shell Components (Phase B)
- AppShell (`<cz-shell>`): main container with drawer mode (limited to SIDEBAR_DRAWER_MAX_WIDTH), rail mode (<=1100px, forces compact without consuming preference), expanded mode (>=1100px, respects persisted preference), scrim under open drawer, `data-sidebar` attribute.
- Sidebar (`rz-shell__sidebar`): Primary_Nav (home, library, import, practice, settings) + Secondary_Nav (history), collapsed rail mode with tooltips, expanded with labels, brand "C" + wordmark, toggle button.
- ShellHeader (`cz-shell__header`): quiet top bar, brand→location→import→instrument→help; ToolbarIconButton retained for navigation toggles; sizes 40px height, 60px header.
- SettingsView: minimal panels (Appearance, Instrument, Files, About), zero new state, only wires existing preferences.

### Shell Layout Tokens
```
--cz-sidebar-rail-max: 1100px
--cz-sidebar-drawer-max: 760px
```
Responsive thresholds: drawer `->` rail `->` expanded; no media queries for ignored widths.

### Status Language
- **StatusLine** (default): inline icon + word, no container, aria-hidden decorative glyphs, keyboard focus friendly.
- **Badge** (exception): contained pill for flags needing boundary (practices, PWY accuracy, session stats); color-only avoided by always including text.

### Icon System (finalize)
- Registry: `src/design/iconPaths.js` (34 strokes, 1.8px default). Vendored since no external deps confirmed viable in project style.
- Render: `<Icon name size strokeWidth label />`; {icon} maps to shape array; {c: [cx,cy,r]} renders as <circle>.
- Roles: decorative (aria-hidden="true") unless `label` provided → `role="img"` + `aria-label`.
- Use in buttons: `<IconButton icon="play" label="Play" />` with shell cooldown on main actions, signal edge on active/toggle.

## 7. Menus / tooltips / dialogs / cards / panels / sidebar / transport

- Menus: one popover component (score menu, fit, markup, loop/tracks entry points); hover+focus+ESC+outside-dismiss; `role=menu/menuitem`.
- Tooltips: delay 400ms, never the sole carrier of meaning (aria-label mirrors).
- Dialogs: modal, focus-trapped, one primary action; used for delete piece, reset stats, report problem, input-permission rationale. Native `confirm()` forbidden.
- Cards: `PieceCard` single component (cover/excerpt slot, title, meta, resume line, primary action) across Home/Library.
- Panels: right inspector = overlay drawer (doesn't reflow score); left sidebar = push rail (240px, collapses to 56px icons); both animated with motion tokens, both keyboard-toggleable.
- Transport: the deck (§ Score spec) — its submodules (tempo/metronome/loop/tracks) are the *same* components as inspector rows, different density.

## 8. Motion

Extend current tokens: `duration-instant 80 / fast 150 / base 220 / slow 320`, `ease-out` default, `ease-spring` (subtle, panels only — no bounce on controls), `pulse` reserved for WFY target + beat LED. Rules: layout animations only for drawer/deck morph/banner slot (FLIP-ish, transform/opacity only); cursor rendering stays in-canvas rAF; **every infinite animation pauses under `prefers-reduced-motion`** (extend the existing media blocks — verify WFY pulses included); mode switch animates the indicator, not the whole deck.

## 9. Accessibility contract (every phase)

- Contrast: text pairs from token table only (AA for <18px, AAA aspiration for body); status never color-only.
- Keyboard: full Score operation (play, modes 1/2/3, pager, measure jump, loop set, fullscreen, ESC hierarchy: popover → drawer → fullscreen → mode stays).
- Focus: visible ring everywhere (existing `--sf-focus-ring`); focus returns to trigger on dialog/popover close (tutorial already does this — replicate).
- Touch: ≥40px targets for deck/pager/mode; 44px for primary mobile CTAs.
- Screen reader: deck as `toolbar` w/ labeled groups; WFY target as `aria-live=polite` (already the pattern — keep); banners `role=status/alert` with single-slot queue to avoid announcement pileups.
- Reduced motion + `prefers-contrast` respected; paper theme ≠ app theme (score stays readable in both).

## 10. Copy voice (part of the system)

Musician-first, sentence-case, no internals in UI: "Notes file" not "timing file" (migration: rename user-facing strings; keep `musicXml` in code), "Sound" not "MIDI file" unless choosing a file, "Guide" not "Visual Mode", "Auto-read" not "OMR-generated playback", "bars" alongside "measures" where space allows. Error formula: what happened + what to do next + where (one action). Keep a `copy/` glossary file in Phase A so strings stay consistent.
