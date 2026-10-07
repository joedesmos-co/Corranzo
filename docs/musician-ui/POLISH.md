# Corranzo polish pass — final visual critique

Follow-up to REPORT.md, on `codex/corranzo-musician-ui-redesign` above `ba66f1ba5c`.
No redesign, no feature changes, no new visual system. Targeted fixes only.
Guitar and main untouched; nothing merged.

## 1. What was already strong

- **Repertoire rows** (Library + Home collection): ruled, mono-numbered, serif work
  titles. Distinctive without the logo. Untouched.
- **Practice desk**: dark, score-first, tempo as a printed mark, live bar
  reference, restrained loop bracket. Untouched except one copy fragment (below).
- **Tempo dialog**: large BPM readout, 50/75/100% steps, honest copy. Untouched.
- **Journal with notes**: indented session notes with bar references read like a
  real practice diary. Untouched.
- **Restraint overall**: no fake paper, no decorative notation, no invented
  statistics. Nothing added.

## 2. Remaining AI-looking issues found

1. Note-guide Preview header rendered `both notes together` — a lowercase
   fragment left by stripping `Play ` from the instruction string. Read like a
   debug string, not a listening cue.
2. Uploads tab kept the library lede (`Studies, familiar pieces, and something
   to grow into.`) and labeled its import card `Your music`, duplicating the
   section eyebrow. Wrong context, triple naming.
3. Empty journal headlined absence twice (`None yet` in large serif, twice),
   rendered zero totals as `0s`/`0` (reads `OS`/`O` in serif), and showed a
   `Clear stats` button with nothing to clear. Several elements shouted equally;
   no single focal action.
4. Settings About repeated the global footer's Privacy/Terms/Contact links a
   few pixels above the global footer.
5. Settings `Dark/Light` and `Piano/Guitar` selects used nested pill boxes that
   competed with the ruled tab language used everywhere else on paper.
6. Home on phones hid the practice prompts but kept their heading, orphaning
   `A passage at a time.` above a lone import link.
7. Home featured excerpt sheared mid-system with a hard edge, reading as a
   rendering accident rather than an intentional crop.
8. Import paired two large serif headlines (`Bring your score.` 46px + `A clear
   page. A better start.` 33px) that competed instead of guide.

## 3. Exact targeted changes made

- `src/components/practice/VisualPracticeView.jsx` — new `toListeningCue`
  helper: strip `Play ` then recapitalize (`Both notes together`). Pedagogy
  instruction strings unchanged; `pianoPracticeInstructions` tests unaffected.
- `src/components/LibraryPanel.jsx` — tab-specific hero hint for Uploads
  (`Imported PDFs for {instrument}, kept on this device.`); import-card meta
  `Your music` becomes `{Instrument} · PDF`.
- `src/components/profile/ProfileView.jsx` — `formatDuration(0)` renders `—`;
  zero session count renders `—`; `StatCard` demotes `None yet`/`—` to quiet
  14px sans (`profile-stat__value--placeholder`); `Clear stats` only renders
  when any history exists.
- `src/styles/profile.css` — placeholder stat style + tabular figures for stat
  values (durations are timing, so tabular numerals fit the type system).
- `src/components/shell/SettingsView.jsx` — removed in-page legal button row;
  About sub now points at the page footer. `Button` import still used.
- `src/components/shell/shell.css` — removed the now-unused
  `.cz-settings__legal` rule.
- `src/styles/collection.css` — paper-surface single-selects (`.cz-segmented`,
  Settings `.instrument-selector`) use the ruled tab idiom: no boxes, 2px
  vermilion underline for the choice. Pill boxes remain on the dark desk.
  `SegmentedControl` is only used in Settings (+ dev sandbox), so scope is safe.
- `src/components/home/home.css` — on phones the prompts collapse to one quiet
  line (`Listen · Isolate · Repeat`) instead of disappearing; excerpt stage gets
  a solid-color falloff so the crop reads as intentional. No gradients
  introduced elsewhere; the fade is a paper-to-paper dissolve on one element.
- `src/styles/import.css` — import guidance `h2` demoted to 25px (copy
  unchanged; rule placed after the shared group rule it refines).

## 4. Deliberately left unchanged

- Practice transport/dock: mode tabs vs Play have a working hierarchy; loop and
  completion states are honest. No restyle.
- Library Practice-tab header (`Piano` eyebrow + `Practice Library` title):
  real hierarchy (instrument scope + toolbar anchor), not duplication.
- Dual footers/content, header Import duplication, sidebar numbering, global
  footer email: honest beta chrome, out of scope for a polish pass.
- Advanced/diagnostic accordions: denser legacy layouts, acknowledged in
  REPORT.md; restyling them would risk behavior and is not polish.
- Phone dense-score readability: zoom remains the honest answer; nothing shrunk.
- 7 pre-existing test failures on the `ba66f1ba5c` baseline (stale assertions in
  `betaOnboarding`, `designPhaseA` contrast, `ipadLayout` profile padding,
  `launchReadiness` Progress naming, `minimalAudioUi`, `mobileOverlays`,
  `uxPolishSprint` demo copy) were left failing as found — fixing stale
  contracts is not this pass.

## 5. Strongest final screens

Repertoire (library-1440), practice desk (practice-1440), tempo dialog,
journal with notes.

## 6. Weakest remaining screen

Empty journal (history-1440): materially calmer now (quiet placeholders,
single `Start timer` focal), but it still explains two tracking modes before
the user has any history. Acceptable honesty; a further merge of the two
empty panels would be restructuring, not polish.

## 7. Responsive / accessibility

- Review scripts re-ran at 390–1920px: no horizontal overflow anywhere.
- Axe: 21/21 production checks, 17/17 workflow checks, 4/4 detail checks with
  zero violations (one workflow run flaked on a viewport-transition timeout;
  clean re-run passed 7/7 — script timing, not product).
- Reduced-motion, dialog focus restore, 44px targets, keyboard tabs unchanged
  and re-verified by the scripts.

## 8. Build / test

- `npm run build` passes (unchanged chunk-size warning only).
- Targeted suites: 118/119 pass across shell, library, import, practice,
  history, session, annotation and instruction tests. The single failure is the
  pre-existing `designPhaseA` contrast assertion, failing identically on the
  `ba66f1ba5c` baseline.
- Full suite: same 7 pre-existing baseline failures, no new failures.
- Changed-file ESLint output is identical to baseline (pre-existing findings in
  `VisualPracticeView.jsx` untouched); `git diff --check` passes.

## 9. Final screenshots

`docs/musician-ui/after/` regenerated for every surface whose pixels changed
(Home, History, Import, Uploads, Practice modes/dialogs, Settings, Note guide);
unchanged states are byte-identical and intentionally unmodified.

## 10. Integration readiness

Yes. The visual system is coherent, restrained, and musician-led; the polish
diff is small, reviewed pixel-by-pixel above, and fully validated. Ready for
integration at the maintainer's discretion. Not merged here, per instructions.
