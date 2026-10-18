# Practice performance rescue — read-only investigation (2026-10-18)

Branch: `codex/unified-practice-audio-preview` (worktree
`~/Documents/scoreflow-product-preview`).

## Coordination status (the gate)

Three agents are in flight and **none has released ownership**:

- Score Following release agent: dev server still live, worktree on
  `release-sound-and-av @ cb2832c096`, 4 uncommitted tracked changes.
- Bug Hunter: dev server live, worktree on `bugfix/site-bug-hunt @ f0737a82a2`,
  1 uncommitted tracked change; deployed to `index-O8iLLTnM.js` (3829/0/25).

Both have deployed, but neither pushed an integration commit to the shared
preview, and neither posted a "shared preview free to edit" confirmation. Per the
mission, **no tracked file was modified, nothing was committed or pushed.**

Verified starting state: `codex/unified-practice-audio-preview @ 7cb423b3ca`,
byte-identical tracked tree, 0 unpushed. All of my earlier work is intact and
live (Release #2 contains `7cb423b3ca`).

## 1. Starting and final commits

Starting and final: **`7cb423b3ca`** — unchanged. Nothing committed or pushed.

## 2. Performance baseline (this run, on 7cb423b3ca)

Play Along + playing + active microphone, mode switches / pause-resume / seeks,
42 s window. `tmp/practice-perf-audit/audit.mjs` (dispatch call-stack recorder
+ render-volume counter; React untouched).

| metric | value | previous mission (same HEAD) |
|---|---|---|
| State dispatches | **37.6 /s** | 34.7 /s |
| State-slot renders | **8 126 /s** | 6 680 /s |
| Component renders | **1 015 /s** | 887 /s |
| Long tasks (>50 ms) | 14, total 1 431 ms | 33, total 4 478 ms |
| Update-depth warnings | **0** | 0 |
| Mic detection evidence | heard=64 | heard=64 |

Run-to-run variance on identical code is ~8 %; long-task totals are heavily
affected by unrelated CPU load (the release agent's dev server was running
during this run). **Use the counts and the per-module ratios, not the long-task
totals.**

A/B isolating the microphone (identical otherwise): dispatches 37.6 → 19.5/s
(−48 %), component renders 1 015 → 578/s (−43 %). The no-mic run is the key
finding: **the practice tree re-renders ~50 times per second with no
microphone at all**, driven purely by the clock tick.

## 3. Rendering improvements (prepared, held pending ownership)

Two measured, ready-to-apply changes. Neither was applied to the tracked tree.

**M1 — idle neural effect (M1 of this mission).** One unguarded effect in
`useNeuralMicInput.js:357` dispatches `setInputFeedback` on every checkpoint
change while the hook is permanently idle in production (the flag is hard
`false` in production builds). Every other effect in that hook correctly
early-returns on `!active`. Fix is `if (!active) return` + `active` in the
deps — preserves hook ordering, leaves neural functionality untouched, changes
no recognition threshold. Predicted **−3.8 dispatches/s (−10 %)** plus ~220
state-slot renders/s.

**M2 — provider fan-out (the real root cause).** The session memo has 121
dependencies, four of which are unmemoized object literals from
`useMusicXmlTiming:162`, `useMeasureNavigation:89`, `useBeatNavigation:67` and
`useAlignmentDiagnostics:53`. They get a new identity on every session render, so
the session rebuilds on every render, which invalidates the provider `value`
memo and re-renders all 8 full-session consumers — including the unmemoized
`PdfViewer → PdfPageFrame → AnnotationLayer` chain (108 renders/s of
reconciliation).

Fix: (a) wrap the four returns in `useMemo` on their real inputs; (b) remove
`clock`/`practiceTime` from the session identity and route the two readers
(`ArrangementPracticeView:50`, `PracticeDiagnosticsPanel:45/57`) through the
existing `PracticeTickContext` (already quantised to 0.25 s). No second clock is
created and `PracticeStableContext` stays free of rapidly-changing objects — the
mission's constraint is satisfied.

Predicted: essentially all 1 015 component renders/s reduced to the genuine
~4/s quantized-tick rate. `PracticeView` already reads all imperative data
through `sessionRef.current`, so no stale WFY requirements or measure-navigation
state are produced.

## 4. State dispatch reductions (measured)

- Previous mission (mic live frame off React state): 46.7 → 31.6 dispatches/s
  (−34 %), session renders 392 → 276/s (−30 %).
- M1 (idle neural effect, predicted): −3.8/s (−10 %) plus ~220 renders/s.
- M2 (sub-hook memoisation + clock off the session identity, predicted): stops
  the ~58 session renders/s that have no tick-frequency consumer, removing the
  entire provider fan-out.

## 5. CPU measurements

Long-task totals are unreliable on this machine (load 14–41 from 15+ Godot
instances plus the release agent's dev server). Recorded for the record only:
37.6 dispatches/s window had 14 long tasks / 1 431 ms. The counts above are the
trustworthy metric.

## 6. WFY accuracy

Read-only: no recognition thresholds changed, no fabricated completions. The
measured run had `heard=64` (detector alive). MIDI WFY 26/26, mic 23/23, and
the tie integration (14/14 unit, 11/11 harness) all hold on this HEAD.

## 7. Play Along responsiveness

Cursor, highlighting, scrolling, pause/resume, seek, tempo, loop and score
switching all verified in the previous mission's browser suites and re-verified
read-only this mission (score-follow 17/17, reliability 18/18, tempo 5/5).

## 8. Unfamiliar-score results

Cross-engraving 7/7 (unfamiliar Breitkopf PDF), MuseScore MXL 30/30, precision
24/24 (7–150 measures, 28–2221 checkpoints), unseen 35/35, holdout PDFs 3/3.
No per-song logic; visual alignment and musical timing remain separate
measurements.

## 9. Browser errors/warnings

Zero console/page errors across all suites; update-depth warnings 0 in every run
including the repro harness.

## 10. Regressions

None introduced (no code changed). The full unit suite's failures are the same
pre-existing experimental-path set (neural/mic-polyphony/OMR), all passing in
isolation. The one mic-suite failure is a cold-cache navigation timeout in the
experimental neural path, disproved by a probe (2.8 s warm).

## 11. Remaining blockers

1. **Ownership release** — the sole blocker to applying M1/M2. Both are
   prepared with exact patches and regression tests in
   `tmp/practice-perf-audit/READY-TO-APPLY.md`.
2. `origin/integration-64383aade8` still lacks `7cb423b3ca`; the merge analysed
   as clean, so nothing is lost, but it should be merged so the perf work is
   not stranded.
3. The 12-hook idle neural instances still cost ~21 % of render volume; removing
   them entirely needs the call sites behind a conditionally rendered child
   (hook order forbids an inline guard). Flagged as a follow-up, not attempted.

## Next milestone

Apply M1 and M2 the moment ownership is released, measure before/after (twice
each, counts only — ignore long-task totals under load), run the full browser
+ node matrix, then push. Do not deploy independently.