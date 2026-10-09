# Score-follow precision rescue (S1 audit + acceptance record)

Branch: `codex/score-follow-precision`, based on `ff5b4121`
(unified practice integration, which already contains the WFY cursor rescue).

## S1 — Position-mapping audit: root causes found and fixed

Pipeline: MusicXML/OMR → canonical score events (checkpoints) → timing
(performed timeline) → rendered PDF geometry (anchors) → cursor → overlay.

| # | Root cause | Symptom | Fix |
|---|------------|---------|-----|
| R1 | WFY checkpoint lock copied `noteTarget.x` verbatim into the bar. Exact OMR targets live in `pdf-source-normalized` space; the bar paints in analysis space (rotation-mapped). Under any page rotation the locked bar landed in the wrong place. Low-confidence guesses (`measure-beat`/`system-heuristic`/`anchor-only`) also locked the bar to invented columns. | Bar on wrong note/column in WFY, worse when rotated | `wfyCheckpointCursor.js`: convert source→analysis with the page rotation (refuse when unknown); lock only `source-notehead`/`direct-geometry`/`musicxml-layout`; propagate `approximate` + `precision` |
| R2 | Precision was measured self-referentially (resolver vs its own musical ideal) | "Looks better" without proof | `measureCursorHighlightAgreement`: bar vs required box (independent paths); box-aware (nearest-box, not centroid); split-brain overflow flagged separately |
| R3 | Motion-timeline onset groups never recorded chord size (`kind` always `note`) | Held/chord classification noise | Count chord tones per onset group; `kind: 'chord'` when > 1 |
| R4 | Two parallel cursor resolvers (legacy + motion timeline) with inline override; diagnostics measured the legacy one, WFY geometry used another | Painted bar, lock, and measurements could diverge | `scoreFollowDisplayPosition.js`: single `resolveDisplayCursorAtTime` used by posed cursor, RAF driver, WFY geometry, diagnostics |
| R5 | Cursor `confidence: 'exact'` for measure-anchor + default-x-mapped x — overstated: MusicXML default-x mapped into a PDF span is cross-engraving approximation | False precision | `cursorPrecision.js` taxonomy on every cursor: `notehead` / `engraved-mapped` / `time-mapped` / `gap` / `none`; per-phrase `geometryMode` in the timeline; per-event `geometry` in the legacy resolver |
| R6 | Phrase lookup: a query 1 ms before a phrase start (ms-quantized checkpoint times, audio-clock dust) resolved in the PREVIOUS phrase → bar pinned at the previous line's end (up to 0.8 page-width error, 1-frame flicker at every system boundary in real playback) | Full-width backward jumps at line boundaries | `PHRASE_BOUNDARY_EPSILON_SECONDS` (10 ms, below perception and below the 12 ms chord window): prefer the upcoming phrase |
| R7 | Overfull measures (more content than nominal duration — virtuoso runs, tremolo shorthand, backup-less multi-voice .mxl): overflow notes sounded past their window end but belonged to no measure's knots → bar stalled at the barline through the fastest passage | Frozen bar in runs (Campanella m87: 20 orphaned notes) | `onsetOwnedByWindow`: written-measure ownership + orphan adoption (barline-exact downbeats stay single-owned, verified by existing tests) |
| R8 | Timeline highlight index followed the ~10 Hz React state clock while the bar follows the 60 fps audio clock → required box lagged the bar by whole events (~35 px mean on the demo) | Box trails bar during playback | Audio-clock highlight index in `PracticeSessionContext` (RAF loop, re-renders only on index change — same render count, exact timing) |

Cross-measure checkpoints (simultaneous notes in two measures, e.g. tremolo
across a barline): marker column + WFY lock now sit with the checkpoint's
own measure; every required box still renders (`crossMeasure` flag).

## S3 — Exact vs approximate source support

| Source | Geometry | Cursor precision | Status |
|--------|----------|------------------|--------|
| Native MusicXML, same-engraving PDF | default-x mapped into PDF anchor span | `engraved-mapped` | Supported; measured below |
| MusicXML with missing/non-monotonic default-x | time-proportional fallback | `time-mapped` | Supported, labeled |
| Anchor gaps | interpolation/hold | `gap` | Supported, labeled |
| OMR source noteheads (`experimentalOmrPlayback`) | printed notehead boxes | `notehead` (WFY lock) | Supported where OMR succeeds |
| PDF without exact mapping | measure/system navigation only | `gap` + needs-setup states | Documented fallback, no invented positions |
| Overfull-measure overflow across system breaks | time truth vs notation truth diverge structurally | flagged `measureMismatch` | Known limitation (parser timing dependency, see below) |

## S8/S9 — Measurements (2026-10-09)

Node harness `scripts/measure-score-follow-precision.mjs` (synthetic
anchors from each score's own system breaks — consistency/robustness, not
printed-ink truth): **24/24 scores, 8843 checkpoints, 0 NaN, 0 wrong-page,
0 wrong-system, 0 backward steps, 107/107 jumps explained
(page/system/repeat/volta), 0 mid-system teleports.**

Browser pixel pass `scripts/browser-score-follow-precision-e2e.mjs`
(real demo PDF + bundled anchors, 1280×800):
- onset-lock: bar within **0.17 mean / 0.37 max of inter-note spacing**
  at the instant each new required box appears (9 onsets; includes ≤150 ms
  sampling lag, so true error is smaller)
- bar/box share the page 40/40 samples; pause freeze sub-pixel; seek
  relocates; WFY lock on the required box; zoom persists; zero errors

Pre-existing suites: `browser-practice-score-follow-e2e` 17/17,
`browser-unified-practice-midi-e2e` 26/26 (incl. WFY lock, duplicates,
transport, seek, loop, score change). Unit: 3533 passed; the only 7
failures are pre-existing UI-copy assertions that fail identically on the
pristine `ff5b4121` baseline. `npm run build`, `npm run test:scripts` green.

## Final acceptance (additional requirements A1–A10)

Cross-engraving pairs (provenance in `docs/cross-engraving-pairs.md`):
- Für Elise: repo music21/Mutopia-#931 MusicXML (no default-x, single 72bpm
  marking) vs 1888 Breitkopf plate scan, 3 pages (Commons PD-old).
- BWV 846: repo music21/Mutopia-#5 MusicXML vs OpenGoldberg CC0 engraving.
Harness: `scripts/measure-cross-engraving.mjs` (real auto-setup pipeline,
zero synthetic anchors). Browser: `scripts/browser-cross-engraving-e2e.mjs`
(real upload: PDF + MusicXML, real auto-setup, real playback).

Results:
- Both pairs auto-setup `plausible + approximate + layoutMismatch`; UI
  shows "Approximate — measure barlines", never an exact claim.
- Für Elise: onset max 0.0105 page, bar/box agreement max 0.0105 (was 0.33
  before the geometry-exact-anchor fix), 0 teleports, 0 wrong-page.
- Browser on the Breitkopf pair: 20/20 same-page, WFY lock co-located,
  seek/zoom stable, ♩=72 (MusicXML-driven, OMR superseded), zero errors.
- BWV 846 exposes file defect H2 (7.5 quarters in 4/4) → systematic drift;
  follow layer flags it (overflow) and stays crash/jump-free. No mapping
  can align a drifted timeline to print; documented as upstream H1/H2.

A1 start: START_LOCK ≤0.05 s at first anchor; pickup/implicit, opening
rests (leading-rest engraved origin), multi-staff, pause-frozen,
restart-stateless — unit-tested. Browser startup offset: **0.03 s**.
A2/A3 tempo: discrete markings incl. mid-measure changes and beat-unit
scaling verified against hand-computed seconds; cursor velocity ratio
tracks bpm ratio (1.75x for 140/80; 2x for 160/80); measure identity
correct across boundaries. No-tempo fallback: documented 120bpm seed.
Gradual rit./accel. unsupported by the parser — documented (H3).
A4 one clock: engine/bar/events/seek/loop share the performed timeline;
tolerances are generic (20/5/10 ms), none song-specific; output latency
uncompensated uniformly (H4). No hardcoded offsets.
A5 intra-measure: engraved default-x mapped (never time-proportional
assumption); leading rests set the origin; span-anchor vs measure-anchor
confusion fixed (geometry uses the priority-deduped anchor).
A6 browser tempo: hand downbeats 3/6/9/12 s hit at wall 3.03/6.07/8.99/
11.99 s (gaps ≤0.08 s error); static step-through onset error **7.4 px**
(<1 staff space) → the ~11 px playing figure was sampling artifact.
A7 structures: tuplets (15 files), ties (17), repeats, 2 real multi-tempo
scores, guitar TAB, dense runs, multi-page — all in the 24-score harness;
pickup/opening-rest/tempo-change synthetics in unit tests.
A8 modes: Preview follows tempo changes; WFY never auto-advances (MIDI
correct/wrong/partial/chord suites green); Play Along follows canonical
time at playback rate (rate multiplies the single clock).
A9 numbers: startup 0.03 s; tempo gaps ≤0.08 s; static geometry 7.4 px;
onset-lock 0.17 event-spacings playing; zero wrong-measure/system on the
supported corpus (overflow class reported separately, never averaged).

## Remaining limitations (not follow bugs; upstream dependencies)

1. **Parser overfull-measure timing.** Several practice-library guitar
   pieces (e.g. Aguado a-minor: ~96/196 checkpoints) pack more sequential
   content per measure than the nominal duration; the parser places the
   excess past the barline, pairing notes from adjacent measures into one
   checkpoint. The follow layer tracks sound-time correctly and flags
   these (`measureMismatch`), but WFY then requires both notes to advance.
   Fix belongs in MusicXML timing/measure allocation, not the cursor.
2. **Cross-engraving PDF+MusicXML pairs.** When the PDF was not rendered
   from the uploaded MusicXML, `engraved-mapped` is approximate by nature.
   The system labels it and never claims notehead precision; true
   notehead truth needs the OMR path.
3. **Onset-lock target.** Browser onset error ≈ 0.17 event-spacings
   (≈1 staff space incl. sampling lag) vs the 0.5 staff-space aspiration.
   Remaining error is dominated by sampling latency and glide-curve shape,
   not misplacement (zero wrong-page/system across all suites).
