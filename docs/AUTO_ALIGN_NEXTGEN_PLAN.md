# Next-Generation Automatic Score Alignment — Implementation Plan

Status: **Phase 1 landed** (reconciliation + confidence + report + diagnostics).
Scope: post-beta engine upgrade. Goal: remove the need for hand-calibrated demo
anchors and make automatic page/system/measure anchor generation reliable enough
for dense, multi-page public-domain pieces (e.g. Turkish March).

This is intentionally incremental. Each phase is additive and **must not regress
any piece that currently follows correctly** (Objective 7). The existing demo
keeps its bundled anchors until automatic generation provably matches them.

---

## 1. What already exists (inventory)

The auto-alignment pipeline is already substantial (~5,650 lines in
`src/features/score-follow/`). The "hand-calibrated demo anchors" are a
reliability *backstop*, not the whole system. Key building blocks:

| Concern | Module(s) |
|---|---|
| PDF raster + ink analysis | `pdfPageAnalysis.js` (injectable pdfjs + canvas factory for headless tests) |
| Staff / system detection | `detectStaffLines.js`, `detectStaffSystems.js` |
| Barline detection | `detectBarlinesInSystem.js` |
| Measure↔system allocation | `allocateMeasuresToSystems.js` (`reconcileCountsToTotal`, weighted/largest-remainder) |
| PDF↔MusicXML mismatch | `layoutAssessment.js` (`detectLayoutMismatch`, `systemStartsFromMusicXml`, `pageCountFromMusicXml`) |
| Confidence grading | `layoutAssessment.js` (`LAYOUT_CONFIDENCE`, `ALLOCATION_MODE`, `assessLayoutConfidence`) |
| "Never show wrong cursor" guard | `autoAlignValidation.js` (`validateAutoAlignResult`) |
| Anchor generation | `buildAnchorsFromSystemStarts.js`, `musicxmlLayoutAnchors.js`, `semiAutoScoreAlignment.js` |
| Cursor resolve / smoothing | `resolveScoreFollowCursor.js`, `useScoreFollowDisplayCursor.js` |
| Orchestration (React) | `useScoreFollow.js`, `useScoreFollowAnchors.js` |
| Debug | `scoreFollowDebug.js`, `components/practice/AlignmentDiagnosticsSection.jsx` |

Existing headless test coverage: `autoSetupPipeline`, `autoSetupAccuracy`,
`realPdfAutoSetup`, `layoutAssessment`, `gurenAnchors`, `systemStartFallback`,
`lightClassicalDetection`, `uploadedScoreAccuracy`, `measureLocalX`.

**Conclusion:** the next-gen work is *hardening + unifying + diagnosing* this
pipeline behind an explicit confidence ladder — not a rewrite.

---

## 2. Objectives → modules → gaps

| Objective | Today | Gap to close |
|---|---|---|
| 1. Detect pages/systems/staves/barlines/measures/x-positions/transitions | `detect*`, `pdfPageAnalysis` | Aggregate into one normalized `PageLayout` model; multi-page robustness |
| 2. Reconcile PDF ↔ MusicXML (measures, repeats/voltas, tempo, time-sig, pickups, missing/extra barlines) | `detectLayoutMismatch`, `allocate*` | **Single reconciliation result** surfacing all structural facts ✅ Phase 1 |
| 3. Generate anchors (measureStartX, playable start/end, systemEndX, page/system index, **per-system confidence**, fallback) | `buildAnchorsFromSystemStarts`, `musicxmlLayoutAnchors` | **Numeric per-system confidence** ✅ Phase 1; unify anchor generators behind reconciliation (Phase 3) |
| 4. Diagnostics (overlay, per-system confidence table, barlines vs measures, weak-system warnings, **exportable report**) | overlay + debug exist | **Exportable report + table + diagnostic script** ✅ Phase 1; overlay wiring (Phase 4) |
| 5. Safe fallbacks (high→auto / medium→confirm / low→manual; never confidently wrong) | `NEEDS_SETUP`, `validateAutoAlignResult` | **Single decision function** for the 3-tier ladder ✅ Phase 1; UI wiring (Phase 4) |
| 6. Validate on a fixture set | partial fixtures | Add Gymnopédie, Carol, Turkish March (PD), dense/fast, multi-page, repeats/voltas (Phase 2) |
| 7. Don't break working pieces | demo bundled anchors | Keep additive + behind flags; promote auto only when it matches bundled ground truth (all phases) |

---

## 3. Phase 1 — landed this change (additive, pure logic, non-breaking)

New modules (no engine/cursor/detection/CV changes, no runtime behaviour change):

- `alignmentReconciliation.js` — `reconcilePdfLayoutWithScore({ timingMap, perSystemBarlineCounts, systemEntries, pdfPageCount })`
  → `{ score, perSystem[], totals, flags }`, including numeric `systemConfidence`,
  per-system `delta` (detected barlines − expected measures), and flags for
  repeats/voltas (`hasRepeats` via performed>written duration), tempo/time-sig
  change counts, pickup, system/page mismatch, and `barlineTotalMismatch`.
- `alignmentConfidencePolicy.js` — `decideFollowAction({ layoutConfidence, reconciliation })`
  → `auto | confirm | manual`. Hard conflicts (needs-setup, barline-total
  mismatch, weak/low-confidence systems) always degrade to manual — the
  "never confidently show a wrong cursor" rule, encoded.
- `alignmentReport.js` — `buildAlignmentReport`, `formatAlignmentReportText`,
  `serializeAlignmentReport`: the exportable report + per-system table + warnings.

Tooling / tests / docs:

- `scripts/diagnose-alignment.mjs` — headless diagnostic; `--check` self-tests on
  the bundled demo (32 measures, 6 systems, all Δ=0, AUTO). Wired into `test:scripts`.
- `tests/alignmentReconciliation.test.js`, `tests/alignmentReport.test.js`.
- `docs/AUTO_ALIGN_BROWSER_CHECKLIST.md` (manual browser verification).

### Honest gap found while building Phase 1 — RESOLVED in Phase 2

`parseMusicXml` did not surface MusicXML `implicit="yes"` and padded the first
measure to a full bar, so Phase 1's `timingMap` carried no pickup signal.
**Phase 2 fixed this additively** (no timing change): the parser now preserves
`measure.implicit` and `measure.notatedLengthQuarters` (the true pre-padding
length), and `detectPickupMeasure` uses them honestly.

---

## 4. Roadmap (subsequent phases, small commits each)

**Phase 2 — parser truthing (DONE) + fixtures (pending).**
Done: parser surfaces `implicit` + `notatedLengthQuarters`; reconciliation now
reports pickup (real metadata), repeats/voltas from the performed timeline
(performed-vs-written, revisited measures, max repeat pass), and tempo /
time-signature change counts **with affected measure numbers**; the diagnostic
prints a concise honest model summary.
Pending (Phase 2b): a license-safe fixture set (Objective 6) — fixed Minuet,
Gymnopédie (PD), Guren, Carol, Turkish March (Mutopia PD — see demo evaluation),
one dense/fast, one multi-page, one repeats/voltas — each MusicXML + per-system
barline counts (hand-checked once) → golden reconciliation snapshot, one commit
per fixture.

**Phase 3 — unified anchor generation from reconciliation.**
A single `generateAnchorsFromLayout(reconciliation, pageLayout)` producing
`measureStartX / playableStartX / playableEndX / systemEndX / page / systemIndex /
confidence`, replacing the divergent generators. Gate behind reconciliation
confidence; keep `validateAutoAlignResult` as the final guard. Golden-anchor
tests vs the demo's bundled anchors (must match within tolerance before auto
generation is allowed to replace bundled anchors).

**Phase 4 — UI wiring (behind a flag).**
Route `decideFollowAction` into `useScoreFollow`: auto→follow, confirm→one-tap
confirm, manual→existing semi-auto. Render the per-system confidence table +
weak-system warnings in `AlignmentDiagnosticsSection`; add the debug overlay
toggle. No default-behaviour change until Phase 5 sign-off.

**Phase 5 — promotion + demo de-calibration.**
Only once auto-generated anchors match bundled ground truth across the whole
fixture set on desktop + tablet + mobile (browser checklist green) do we switch
the demo to auto-generated anchors and retire the hand-calibrated table.

---

## 5. Non-breaking strategy (Objective 7)

1. Every phase adds modules/flags; no existing module's behaviour changes until a
   phase explicitly wires it, and only behind a flag.
2. The demo keeps bundled anchors until Phase 5.
3. Auto generation must pass `validateAutoAlignResult` **and** match bundled
   ground truth before it is allowed to drive the cursor.
4. CI gates: `npm test`, `npm run test:scripts` (now incl. the diagnostic
   self-check), `npm run build`, `npm run lint`. Golden snapshots per fixture
   catch regressions on previously-working pieces.

---

## 6. Validation

```bash
npm test            # vitest — incl. alignmentReconciliation + alignmentReport
npm run test:scripts # incl. node scripts/diagnose-alignment.mjs --check
npm run build
npm run lint
```

Manual browser verification: `docs/AUTO_ALIGN_BROWSER_CHECKLIST.md`.
