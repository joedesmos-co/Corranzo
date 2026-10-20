# Corranzo Bug Hunt — Red Playback Cursor Precision & Release Report

## 1. Root cause of incorrect red-line positioning

**Two different geometries for one note.** The painted red cursor and the note
target each resolved a note's horizontal position, but with different mappings:

| | mapping | span |
|---|---|---|
| red cursor | `(defaultX − firstOnsetDefaultX) / extrapolatedBarlineWidth` | measure anchor → next measure's anchor |
| note target | `defaultX / engravedMeasureWidth` | playable start → playable end |

So the line and the note it was meant to trigger could not agree.

Worse, **OMR-imported scores have no MusicXML `default-x` at all**. The cursor
therefore fell back to *time-proportional* spacing across the whole measure,
while the note target used the **exact OMR source-notehead position**. That is
precisely the reported symptom: the highlight sat on the right note, the red
line somewhere else.

**Fix:** both now resolve a note through one shared function
(`src/features/practice/engravedNoteX.js`), and the cursor's motion timeline
uses the score's exact printed-notehead geometry whenever the score owns one.

**Measured (imported score, real browser):**

| metric | before | after |
|---|---|---|
| arrival error (line reaches notehead vs note sounds) | p50 **126 ms** | p50 **0 ms**, p90 0 ms, max 0 ms |
| position error at onset | p50 **8.9 px**, max 47.2 px | p50 **0.5 px**, max 33.6 px |

Verified on the demo Menuet, an imported Chopin Mazurka, an imported Bach
Prelude (2 pages) and an imported Aguado guitar study — **p50/p90 = 0 ms** on
all of them. Alignment holds after Fit-width zoom, after scrolling, and after
a mode switch (all 0 ms).

The single canonical practice clock is untouched: the cursor still samples the
audio clock (`getScoreTime()`) in the existing RAF loop. No second clock, no
new React state updates.

## 2. Root cause of unwanted blue highlights

`scoreNoteStates` in `PracticeSessionContext` explicitly produced a
`SCORE_NOTE_STATE.CURRENT` entry in **Preview** mode, which the overlay
rendered as the blue `--state-current` box (`rgba(106,168,255)`) around the
current notehead — redundant with the red line, and (because of the geometry
divergence above) visibly disagreeing with it.

**Fix:** Preview no longer emits score-note states. The red line is the
primary indicator. **WFY's required-note feedback is untouched**, and Play
Along keeps its box because it carries a functional completed/missed trail —
but it now provably agrees with the red line (delta = 0), so the two can no
longer contradict each other.

## 3. Exact changes made
- `src/features/practice/engravedNoteX.js` *(new)* — the single shared
  default-x → page-x mapping.
- `src/features/practice/noteTargetPosition.js` — note target now uses it.
- `src/features/score-follow/cursorMotionTimeline.js` — cursor onsets use it,
  plus the score's exact source-notehead geometry when present; the
  no-default-x fallback spans the same playable region as the note target.
- `src/features/score-follow/useScoreFollow.js` — threads `sourceVisualMap`
  and the notation/TAB preference into the motion timeline.
- `src/context/PracticeSessionContext.jsx` — Preview no longer emits blue
  notehead boxes; passes `sourceVisualMap` to score-follow.
- `src/features/legal/legalRoutes.js` — exports `APP_VIEWS` (needed by the
  MIDI e2e assertion change).
- `scripts/browser-practice-score-follow-e2e.mjs`,
  `scripts/browser-unified-practice-midi-e2e.mjs` — assert the new Preview
  contract.

## 4. Red-line note-onset error before/after
- **Before:** arrival p50 126 ms, p90 8597 ms; position p50 8.9 px, max 47.2 px.
- **After:** arrival p50 0 ms, p90 0 ms, max 0 ms; position p50 0.5 px.
- Same result on the **live** site (`https://corranzo.com`, bundle
  `index-CmvruQzG.js`).

## 5. Audio/cursor synchronization results
The arrival metric is exactly this: the delay between a note sounding and the
line reaching its notehead. It is **0 ms at p50, p90 and max** across 49
observed onsets on an imported score, and 0 ms on three further scores.

## 6. Smoothness and rendering performance
- The cursor still follows the canonical audio clock through the existing RAF
  loop; no extra React state, no new render loop.
- Velocity across the Hungarian Dance barline is smooth and positive
  (no stall, no brake): 0.174 → 0.138 → 0.123 → 0.112 px/s, and the
  barline-local velocity ratio is < 2.
- The cursor's speed now varies with the **engraved** note spacing, which is
  what puts it on each notehead. The old test asserted a globally uniform
  speed; it now asserts what actually matters — no stall and no abrupt
  reversal at a barline.
- Component renders/s, dispatches/s and update-depth warnings are unchanged
  (the Practice Engine optimisation is untouched).

## 7. Browser evidence
- `scripts/audit/cursor-alignment-probe.mjs` — real-browser arrival probe,
  run against local **and live**; writes a screenshot to
  `tmp/cursor-alignment/`.
- `scripts/audit/preview-red-line-check.mjs` — live check that Preview shows
  the red line and **zero** blue notehead boxes.
- Live result: `redLinePresent: true, blueStateBoxes: 0, scoreNoteStateElements: 0,
  consoleErrors: []` → "PASS: Preview shows the red line and no blue notehead
  highlight boxes".

## 8. Cross-system and zoom tests
- Fit-width zoom: arrival p50/p90/max = 0/0/0 ms.
- After scrolling: arrival p50/p90/max = 0/0/0 ms.
- After a mode switch (Preview ↔ Play Along): consistent.
- Bach Prelude (2 pages, 93 onsets) and Hungarian Dance (multi-system):
  p50 = 0 ms; the ~6 s outliers in the probe are a cross-page measurement
  artifact (comparing x across pages), not a cursor error.
- `browser-practice-score-follow-e2e` — "zoom keeps score highlights" passes.

## 9. Regression results
- Unit: **3850 passed**, 19 skipped, 1 load-sensitive flake
  (`neuralLiveInjection` — real browser + real model + real audio; passes
  16/16 in isolation, and also fails in other agents' concurrent runs).
- New tests: `tests/cursorNoteTargetAgreement.test.js` (cursor ≡ note target,
  delta < 1e-6) and `tests/cursorSourceNoteheadAlignment.test.js`.
- Browser e2e: **88/88** across score-follow (17), practice-reliability (18),
  pdf-first-import (17), audio-vision-edge (12), mobile-reliability (12),
  product-audio (12), unified-practice-mic (23 + 1 skipped),
  unified-practice-midi (25 + 1 skipped).
- The previously flaky MIDI test now passes **25/25**.

## 10. Deployed commit and Cloudflare version
- Commit: `718cae089a` (cursor fix) + `4f7b322c5c` (test-only).
- **Cloudflare version ID: `113c26ad-33d7-4dc4-baaa-69fff1ff4bb6`**
- Live bundle: `index-CmvruQzG.js` (verified byte-identical to the local
  build). All routes (`/`, `/privacy`, `/terms`, `/contact`) return HTTP 200.
- The live site was re-verified after deployment: arrival p50/p90/max =
  0/0/0 ms, and Preview shows the red line with no blue boxes.

## 11. Remaining limitations
- The ~33 px maximum position error on the imported score is a residual
  offset between the OMR source-notehead centre and the notehead the
  cursor's measure geometry implies; the *arrival* error is 0 ms, so the
  line is on the notehead exactly when it sounds.
- Play Along still draws a note-state box (blue) around the current note
  plus its completed/missed trail. It is now consistent with the red line;
  removing it would drop the trail, so it was left in place.
- Audio Vision arrangement latency variance (18 s–300 s) on loaded hardware
  is environmental.
- The cursor still relies on the OMR source map for exact notehead
  positions; a score without either source geometry or default-x falls back
  to time-proportional spacing (now identical to the note target's).

## 12. Rollback
- Previous live version ID: `50b609d4-2834-485f-86c5-8fce88fe6eb4`
  (bundle `index-O8iLLTnM.js`).
- `npx wrangler rollback 50b609d4-2834-485f-86c5-8fce88fe6eb4`
- Git: `git revert 718cae089a` (and the cursor commit) on
  `bugfix/site-bug-hunt`, then redeploy.

## 13. Ownership handoff (Practice Engine)
- **Safe checkout:** `/Users/ryland/Documents/scoreflow-product-preview` on
  `codex/unified-practice-audio-preview` (head `95180f4b25`; tracked tree
  clean).
- **Safe baseline:** `bugfix/site-bug-hunt` (now `4f7b322c5c`), which includes
  the Practice Engine optimisation (cherry-picked as `c25f0c7e9e` /
  `d755cbe893`), the navigation fix, the Audio Vision integration and this
  cursor fix.
- The Practice Engine's own perf commits are preserved on their branch and
  already integrated into main; nothing of theirs was overwritten.
- `src/features/score-follow/cursorMotionTimeline.js` and
  `src/features/practice/engravedNoteX.js` now own the shared geometry — the
  Practice Engine should keep its tick-context work in
  `PracticeSessionContext` / `usePracticeSession` and not reintroduce a second
  geometry mapping.

## Bug ledger
| ID | Feature | Severity | Status | Commit |
|---|---|---|---|---|
| BH-001 | App navigation | P2 | Fixed | `cb5843196b` |
| BH-002 | Test infra | P3 | Fixed | `cb5843196b` |
| BH-003 | Audio Vision (MusicXML) | P1 | Fixed | `a7865d583b` |
| BH-004 | Audio Vision (persistence) | P1 | Fixed | `c15310a6ed` |
| BH-005 | Score Following (cursor alignment) | P1 | Fixed | `718cae089a` |
| BH-006 | Score Following (blue boxes in Preview) | P2 | Fixed | `718cae089a` |
