# ScoreFlow Completion Audit

**Date:** 2026-06-12
**Scope:** Full repository read (~21,100 lines of JS/JSX across `src/`, `scripts/`, `public/fixtures/`), all runnable scripts executed, plus two independent verification harness passes that imported the repo's real modules (unmodified) and exercised them with small controlled MusicXML fixtures. No code was changed and nothing was committed.

**Verdict up front:** The architecture is completable, but not by patching. The app shell and several subsystems are genuinely good (anchor storage, session persistence, measure navigation, mic pitch detection, import diagnostics, WFY state machine, profile/stats). What blocks completion is concentrated: **the written-timeline math in the parser is wrong in five verified ways, the repeat/volta expander fails most real notation, two core concepts were never made explicit — the written-vs-performed time domain and a single cursor-position resolver — and playback is disabled by policy on the primary target device (iPad).** Every historical symptom (wrong anchors, repeat mis-mapping, fighting smoothing paths, confusing calibration, wrong vertical centering) traces to these. The plan below fixes foundations first, then deletes the defensive layers built to compensate.

**Evidence discipline:** Every defect marked `[VERIFIED]` was reproduced in this audit by executing repo code; results are in Appendix A. Claims marked `[CODE]` are direct code readings with file:line citations. Browser-only paths are marked `[UNVERIFIED — browser]`. Nothing below is inferred from behavior that could not be run.

---

## 1. Repository inspection

| Item | Finding |
|---|---|
| Git history | **None.** The folder is not a git repository. No history for archaeology; no safety baseline for refactoring. |
| Documentation | `README.md` is the unmodified Vite template. The only real doc is `public/fixtures/README.md` (fixture provenance; admits staff auto-detect "often fails" on the demo PDF). |
| Test framework | **None installed** (no vitest/jest). Tests are 3 standalone node scripts in `scripts/`. |
| `scripts/test-pitch-detection.mjs` | **PASSES** (pitch detection, stabilizer, noise gate). |
| `scripts/test-auto-align-heuristics.mjs` | **PASSES** (staff-detection heuristics, validation). |
| `scripts/test-note-target-position.mjs` | **BROKEN** — crashes on missing `public/fixtures/sample.musicxml` (line 190); fixture was renamed/never committed. Evidence the scripts are not routinely run. |
| Lint | `npm run lint`: **106 problems** (98 errors / 8 warnings) — and ESLint also scans `.venv-fixtures/` (a Python venv) because the config only ignores `dist`. `src/`-only: **70 problems** (37 `no-unused-vars`, ~45 react-hooks rule hits repo-wide). |
| Build | Not verifiable in this audit sandbox: `node_modules` holds macOS-native rolldown bindings only (environment artifact, not a source defect). `dist/` exists but is **stale** (built May 21; root/src files modified May 24). |
| Coverage of the timing core | **Zero.** No test touches the parser, repeat expansion, performed timeline, clock, loop, or cursor selection — exactly where the historical bugs live. |
| Naming | `package.json` is `scoreflow-v2` — this codebase is already a rewrite, consistent with the layered-fallback archaeology below. |

---

## 2. Data-flow trace (import → playback events → cursor coordinates)

### 2.1 Import
- PDF → `App.jsx` (object URL + ArrayBuffer) → `react-pdf` single-page render (`PdfViewer.jsx`). Fingerprint `fileName::size::lastModified` (`scoreFollowStorage.js`) keys anchors (localStorage) and session restore (IndexedDB, `sessionPersistence.js`).
- MIDI → `parseMidiFile.js` (@tonejs/midi; note seconds with the file's tempo map baked in) → `MidiPlaybackEngine`.
- MusicXML/MXL → `loadMusicXmlFile.js` (jszip for .mxl) → `parseMusicXml.js` → timing map `{measures, beats, notes, timingEvents, tempoChanges, performedMeasureTimeline, …}`.

### 2.2 Time production (the clock)
- With MIDI: `MidiPlaybackEngine` is the master clock. It schedules **every note up-front** via `triggerAttackRelease(…, now + delay)` (`midiPlaybackEngine.js:133-159`) and derives time as `offsetSeconds + (Tone.now() − playStartedAt)`. **No Tone.Transport, no rate input** — tempo adjustment is impossible in this design without a scheduler rewrite.
- Without MIDI: **no clock at all.** `resolvePracticeTime` returns manual scrub position (`practiceClock.js:37-58`); Play is disabled (`playDisabled: !hasMidi || …`, `usePracticeSession.js:427`). "XML-only silent playback" is not a bug — **XML-only playback is unimplemented.**
- On Safari (including iPad, the primary target): Play/seek are additionally disabled by UA sniff — `isSafariPlaybackLimited()` (`browserPracticeSupport.js:4-6`; gates at `usePracticeSession.js:329-331,427-428`). `BROWSER_SUPPORT_SUMMARY` confirms this is policy: Safari/tablets are read/annotate/manual-WFY only. **The flagship playback features are switched off on the primary target device.** The historical "browser audio initialization could fail" issue was answered by amputation, not by an unlock flow (Tone v15 runs on iPad Safari when started from a user gesture; `audioLifecycle.js` visibility-resume already exists). The gate even exempts `CriOS` (Chrome on iOS) — the same WebKit engine — confirming it is a UA workaround, not a capability check.
- `[CODE]` Duplicate clock resolution: `usePracticeSession.js:89-103` (`livePracticeTime`) re-implements `resolvePracticeTime`. They currently agree; they are a drift hazard.

### 2.3 Written vs performed time — the central fault line
`parseMusicXml` produces **written** times (each measure once). `buildPerformedMeasureTimeline` expands repeats into **performed** entries with their own clock. Both kinds of seconds flow through the same untyped `practiceTime` number, and each consumer chooses its own interpretation:

| Consumer | Time domain used | Evidence |
|---|---|---|
| Cursor measure lookup `getMeasureAtTime` | **Performed** when repeats expanded | `timingQuery.js:45-62` |
| Measure navigation | **Performed-aware** (correct) | `measureNavigation.js:29-50,69-94` |
| Loop regions | **Written only** | `practiceLoopRegion.js:77-78` — `[VERIFIED]` A-13: loop over m3–4 of a repeat piece returns written 8 s where the performed pass starts at 16 s |
| Wait For You checkpoints | **Written only** | `waitForYouCheckpoints.js:42-61` — `[VERIFIED]` A-14: 16 written beat checkpoints where the performed timeline has 24 |
| Alignment diagnostics | Written (intentionally; documented) | `computeAlignmentDiagnostics.js` disclaimer: "do not change playback or correct timing" |

And the third clock: the **MIDI file's own seconds** (§2.2) are what `practiceTime` actually contains during playback. There is **no mapping layer** between MIDI seconds and XML seconds — they agree only if the XML math is perfect *and* the MIDI export used identical tempos and repeat expansion. The shipped demo already disagrees: XML parses to **39.86 s** written; the MIDI is **41.14 s** (`[VERIFIED]` A-9) — a full measure of drift, see P1. Rather than fixing the divergence, `useImportReadiness.js:80-86` **suppresses the resulting mismatch warnings for the demo piece** (`demoHiddenWarningIds`) — symptom-hiding in shipped code.

Consequence: in any piece with repeats, a WFY checkpoint seek writes a **written** time into a clock the cursor interprets as **performed/MIDI** → the cursor shows the wrong measure. This is the precise mechanism behind "repeats did not map back to the correct score location" and contributes to "playback-time sorting selected the wrong visual anchor."

### 2.4 Cursor coordinates (four sequential stages)
`useScoreFollow.js` chains: ① `computeScoreFollowCursor` (exact-anchor-only; `lockExact: true` always — `scoreFollowCursor.js:23-33`) → ② `validateScoreFollowPosition` (re-derives the *same* lookup; hides the cursor on any >0.002 disagreement — `scoreFollowStartSanity.js`) → ③ `useScoreFollowDisplayCursor` (RAF smoothing) → ④ `getCursorVisibilityState` (9 hide-reasons).

- Stage ② is a defensive duplicate of stage ① — two implementations cross-checking each other instead of one correct one. Classic symptom-patch residue; its only unique power is to make the cursor disappear.
- Stage ③ is **permanently dead code**: smoothing requires `!lockExactCursor` (`useScoreFollow.js:289-298`), but ① always sets `lockExact: true` (`[VERIFIED]` A-15). The "smoothing paths fighting one another" era was ended by disabling smoothing forever while leaving all machinery in place.
- A missing anchor for the current measure makes the cursor vanish **and flips `needsSetup: true` mid-playback** (`scoreFollowStartSanity.js:77-85` → "needs setup" status via `useScoreFollow.js:769-792`; `[VERIFIED]` A-16). This is the "manual calibration was confusing" mechanism: playing past one unmarked measure tells the user their setup is broken.
- There is **no interpolation between anchors** in the live path; the cursor jumps measure-to-measure. The interpolating implementation exists but is dead (§4).

### 2.5 Anchor production (why user uploads never get a cursor)
- Semi-auto analysis (`semiAutoScoreAlignment.js`) produces `AUTO_SYSTEM` system-start/end anchors. These are **deliberately untrusted**: `filterTrustedAnchors` excludes all `AUTO_*` sources (`trustedAnchors.js:10-28`); trust with only auto anchors returns `showCursor: false, needsSetup: true` (`scoreFollowTrust.js:34-42`; `[VERIFIED]` A-17).
- The designed promotion path — `buildMusicXmlLayoutAnchors` interpolating trusted per-measure `MUSICXML_LAYOUT` anchors inside system spans — **never fires**: in `pairSystemSpanAnchors` (`musicxmlLayoutAnchors.js:95-110`), `isAutoSystemAnchor` matches *any* `AUTO_SYSTEM`-source anchor regardless of role, so a system-**end** anchor overwrites `pendingStart` and no span ever pairs. `[VERIFIED]` A-12: canonical semi-auto output + layout-rich timing map → **0 layout anchors**.
- Net effect for a user upload: semi-auto reports "ready" (`useScoreFollow.js:473`), trust evaluates to NONE, status flips to "needs setup", and the only path to a cursor is **manually marking every measure** (stage ① requires an exact per-measure anchor). The demo works only because it ships pre-baked per-measure `demo` anchors bypassing this pipeline — and those are themselves corrupted (P1/A-10).
- `supplementalMeasureAnchors` (barline-based `AUTO_MEASURE` anchors) are computed and returned by the analyzer (`semiAutoScoreAlignment.js:291,331`) but **never consumed anywhere** `[VERIFIED by grep]`.
- The `default-x` heuristic itself is shaky: MusicXML `default-x` is usually measure-relative, not system-relative; the monotonicity gate (`assessMusicXmlLayoutConfidence`) protects against the worst cases but the mapping assumption should be revisited when the pairing bug is fixed.

### 2.6 Page follow / vertical centering
`usePracticePageFollow.js` scrolls so the cursor sits at 36% viewport height. Defects `[CODE]`: the easing state initializes at `top: 0` and never reads the container's actual `scrollTop` (`:18,73-79`), so activation animates from a stale origin ("cursor vertical centering was sometimes wrong"); it writes `scrollTop` every frame with **no user-scroll detection**, fighting manual scrolling; and it queries only the first `.pdf-page-frame` — safe today because exactly one page renders, an implicit invariant that will silently break under continuous scroll. It also inherits every upstream y error (wrong measure → wrong system → wrong scroll).

### 2.7 The demo proves less than it appears to
The bundled Minuet has **no repeat barlines** (0 `<repeat>`/`<ending>` in the XML; repeats flattened into the MIDI) and ships pre-calibrated anchors. So the one fully-working end-to-end path exercises **neither** the repeat machinery **nor** the anchor-production machinery — the two broken subsystems — and its anchors and clock are corrupted/skewed by P1 anyway (A-9/A-10).

---

## 3. Parser and timeline defects (all in `parseMusicXml.js` / `parseMeasureRepeats.js`)

**P1 `[VERIFIED]` Every score's first measure collapses to ~zero length — the highest-impact defect in the repository.** `measureLengthDivisions` is computed from the *incoming* state (default `divisions=1`, 4/4) **before** the measure's `<attributes>` are read, then divided by the *new* divisions (`parseMusicXml.js:207,347-359`). With the standard `divisions=480`, measure 1 gets length 4/480 ≈ **0.0083 quarters** instead of 4 (A-7: m2's note lands at quarterTime 0.0083). **Every measure after the first starts one measure early relative to the audio.** The same mechanism gives any measure containing a time-signature change the *previous* signature's length (A-8: a 3/4 measure after 4/4 records 4 quarters). Only files with `divisions=1` escape — which is why simplistic fixtures (and the second harness's straight-parse check) pass while every real export (MuseScore/Finale/music21 use 480/960/10080) is wrong. Demonstrated consequences in shipped data (A-9, A-10): demo XML totals 93.0004 quarters instead of 96 (39.86 s vs the MIDI's 41.14 s), and the bundled "calibrated" demo anchors — generated by duration-weighting parsed measures (`scripts/generate-demo-anchors.mjs` → `timingMeasureAnchors.js`) — place m1 and m2 at the **same x** (0.1000 vs 0.1001), every system-1 anchor one slot left of truth.

**P2 `[CODE]` Measure children are sorted by tag kind, not document order.** fast-xml-parser groups children by tag name; `getOrderedMeasureChildren` re-sorts by fixed kind order (`parseMusicXml.js:22-36,173-188`): all `direction`/`sound` before any `note`, all `backup` before any `note`. Hence —

**P3 `[VERIFIED]` Mid-measure tempo changes collapse to the measure start** (A-6: `tempo=60` placed after 2 quarters is recorded at the measure's start quarter; the following measure starts at 4.0 s instead of 3.0 s). The same root cause breaks general `backup`/`forward` semantics; the per-voice-cursor system (`parseMusicXml.js:100-133`) is itself a workaround for the lost ordering, correct only for the common parallel-voices case.

**P4 `[VERIFIED]` Secondary parts inherit part 1's `<divisions>`.** Parts ≠ P1 parse with `notesOnly: true`, skipping their `<attributes>` (`parseMusicXml.js:229-232,466-488`). A-5: P2 declaring `divisions=2` got its second note at quarterTime 4 instead of 2. Any piano score whose hands export with different divisions yields wrong left-hand timing — wrong WFY note checkpoints, wrong alignment scores.

**P5 `[VERIFIED]` Single-measure repeats never expand.** `findForwardRepeatIndex` scans strictly *before* the backward-repeat measure (`parseMeasureRepeats.js:91-98`), so `|: m :|` (forward+backward on one measure) finds no start: A-1 plays 1,2,3 for `m1 |: m2 :| m3`; A-4 plays a `times="3"` repeat **once**. Falls back to written order with only a soft warning.

**P6 `[VERIFIED]` Consecutive repeat sections jump to the wrong forward repeat.** A-2: `|: m1 :| |: m2 :| m3` plays **1,2,1,2,3** (m2's backward matched *m1's* forward because its own same-measure forward is excluded). Wrong span replayed — precisely "repeats did not map back to the correct score location."

**P7 `[VERIFIED]` Repeat-to-beginning does not expand.** A-11: a backward repeat with no forward repeat (extremely common notation) produces written order plus an "uncertain" warning.

**P8 `[VERIFIED]` The last measure of a multi-measure first ending replays on pass 2.** The volta bracket is cleared *before* the stop measure is evaluated (`parseMeasureRepeats.js:178-183`). A-3: `m1 |: m2 [1. m3 m4 :|][2. m5]` plays **1,2,3,4,2,4,5**. Single-measure voltas work (A-0 passed).

**P9 `[VERIFIED-by-mechanism]` Global pass counter never resets per section** (`parseMeasureRepeats.js:159,208-213`): after any expanded section, `pass` stays 2, so later repeat sections are treated as already on their final pass and later volta blocks select brackets with a stale pass number (compounds with P5/P6; visible in A-2/A-4 traces).

**P10 `[CODE]` Metronome beat-unit ignored:** `<beat-unit>half</beat-unit><per-minute>60</per-minute>` parses as 60 BPM instead of 120 (`extractTempo.js:24-32`; `[VERIFIED]` A-18). Affects alla-breve/compound-meter scores lacking `<sound tempo>`.

**P11 `[CODE]` D.C. / D.S. / Fine / Coda are entirely unhandled with no warning** — `hasRepeatMarks` only inspects barline repeats/endings, so "D.C. al Fine" pieces silently play in written order with `fullyInterpreted: true`.

`score-timewise` files are rejected with a clear error (acceptable; document it).

**What works `[VERIFIED]`:** straight parsing *given `divisions=1`* (A-19), measure-start tempo changes, time-signature records, system-break flags, two-measure repeat sections with distinct forward/backward measures (A-20), single-measure voltas, performed↔written mapping for the cases the expander handles. The pitch parsing, chord/grace/rest handling, and MXL container resolution read correctly and are exercised indirectly by the passing scripts.

---

## 4. Duplicate, obsolete, conflicting, and dead implementations

**Dead files (zero imports):**
- `scoreFollowPlayhead.js` — `@deprecated`, unimported.
- `autoScoreAlignment.js` — legacy shim superseded by `semiAutoScoreAlignment.js`, unimported.
- `timingMeasureAnchors.js` — imported only by `scripts/generate-demo-anchors.mjs`; tooling code living in `src/`.

**Dead code inside live files:**
- `scoreFollowInterpolation.js` (176 lines): only `sortAnchorsByMeasure` is imported (by `noteTargetContext.js:139`) — and that call omits `practiceTime`, so under a performed timeline `getAnchorPlaybackTime(…, 0)` yields `null`→`+Infinity` sort keys for all but measure 1, silently degrading to measure-number order. The bracket-finding, beat-weighted progress, cross-page interpolation, corridor clamping — the entire previous cursor generation — is unreachable. This module is the fossil of the "playback-time sorting selected the wrong visual anchor" era.
- `useScoreFollowDisplayCursor.js` + `smoothCursorActive`/`resetSnapKey` plumbing + the easing helpers it would use: structurally unreachable (§2.4).
- `beatInterpolation`: React state surfaced as a user-facing checkbox (`ScoreFollowControls.jsx:306`, threaded through `PdfViewer.jsx:248`, `PracticeSetupPanel.jsx:56`) that **influences nothing** — no functional consumer `[VERIFIED by grep]`. A placebo setting.
- `preview.supplementalMeasureAnchors`: computed, returned, never applied (§2.5).
- `ScoreFollowControls` render path in `PdfViewer.jsx` hardcoded off (`showScoreFollowPanel = false`, `:39`); the live panel is in `PracticeSetupPanel`.
- Deprecated exports kept "for compatibility" in a repo with no external consumers: `resolveStartAnchor`/`validateScoreFollowStart` (`scoreFollowStartSanity.js:109-117`), `buildLoopRegion` (`practiceLoopRegion.js:130-133`), `tryMatchCheckpoint` (`waitForYouNoteMatch.js:232`), legacy export in `scoreFollowUserMessages.js:11`, `ANCHOR_SOURCE.AUTO`, `MusicXmlDebugPanel.jsx` (deprecated for `ScoreTimingDiagnosticsPanel`).
- `useWaitForYou` accepts a `practiceTime` parameter it never uses (`useWaitForYou.js:22`).

**Conflicting implementations (same problem solved differently in parallel):**
- **Three** anchor→(x,y) mappers: the live exact-anchor cursor (`scoreFollowCursor.js`), the permissive note-target geometry with interpolation/system-spans/staff-bands (`noteTargetContext.js` + `noteTargetPosition.js`), and the dead interpolation module. The strict cursor and the note target can disagree on screen for the same measure.
- **Two** `buildExactCursor` implementations (`scoreFollowCursor.js:11`, `scoreFollowStartSanity.js:8`) plus the validator re-deriving the computer's answer (§2.4).
- **Two** time-domain policies for seeks (§2.3): performed-aware (measure nav) vs written-only (loop, WFY) — on top of the third, MIDI-seconds clock.
- **Two** practice-clock resolutions (`livePracticeTime` vs `clock.practiceTime`, §2.2).

---

## 5. Feature status (evidence-based)

| Feature | Status | Evidence |
|---|---|---|
| PDF display, page nav, fit modes, annotations (draw/erase/persist) | Implemented; **[UNVERIFIED — browser]** | Code complete and coherent; no automated tests |
| MusicXML/MXL import (incl. container.xml) | **Works** for partwise files | `loadMusicXmlFile.js`; error taxonomy |
| Written timing map with real-world `divisions` | **Broken [VERIFIED]** | P1 (A-7/A-8/A-9); P3 (A-6); P4 (A-5) |
| Written timing map with `divisions=1` toy files | Works [VERIFIED] | A-19 |
| Repeats: two-measure sections, single-measure voltas | **Work [VERIFIED]** | A-20, A-0 |
| Repeats: single-measure, consecutive sections, `times=N`, repeat-to-beginning, multi-measure voltas, D.C./D.S. | **Broken [VERIFIED]** | P5–P9, P11 (A-1…A-4, A-11) |
| MIDI synth playback (Chrome/Edge desktop) | Implemented; [UNVERIFIED — browser]; clean engine; **no tempo control by design** | `midiPlaybackEngine.js` |
| Playback on iPad/Safari (primary target) | **Disabled by policy** | §2.2 |
| XML-only playback | **Unimplemented** | §2.2 |
| Tempo control (slow-down practice) | **Unimplemented** | repo-wide grep; engine design forecloses it |
| Metronome / count-in | **Unimplemented** | repo-wide grep (only `<metronome>` tag parsing exists) |
| Loop (piece without repeats, Chrome) | Implemented; [UNVERIFIED — browser] | `usePracticeLoop`/`useLoopPlayback` |
| Loop (piece with repeats) | **Broken [VERIFIED]** | A-13 |
| Score-follow cursor mechanism with complete trusted per-measure anchors | **Works at measure granularity [VERIFIED]** (correct anchor selected; no intra-measure motion; smoothing dead) | A-15 |
| Shipped demo cursor positions | **Corrupted by P1** | A-10 |
| Score-follow for user uploads via semi-auto | **Effectively unimplemented [VERIFIED]** — auto anchors untrusted; promotion path returns 0 anchors | A-12, A-17 |
| Cursor with an anchor gap | **Broken [VERIFIED]** — vanishes + false "needs setup" | A-16 |
| Page follow / vertical centering | Buggy state handling `[CODE]` | §2.6 |
| Wait For You (beat/note, manual continue) | State machine sound; **wrong time domain** under repeats | A-14; `useWaitForYou.js` |
| WFY MIDI input | Implemented; [UNVERIFIED — browser/hardware]; Safari has no Web MIDI | `useWebMidiInput.js` |
| WFY mic input (pitch detection chain) | **Logic works [VERIFIED]** (script passes); capture [UNVERIFIED — browser] | `test-pitch-detection.mjs` |
| WFY note-target overlay | Implemented; 4-tier heuristic; its test is broken (missing fixture) | `noteTargetPosition.js` |
| Practice statistics / profile / XP / streaks | Implemented; self-consistent; [UNVERIFIED] | `features/profile/*` |
| Session persistence/restore (IndexedDB + prefs) | Implemented; [UNVERIFIED — browser] | `sessionPersistence.js` |
| Import warnings & guidance | Implemented and thoughtful; **demo suppression masks real defects** | `useImportReadiness.js:80-86` |
| MuseScore source import | Explicitly deferred (message only) | `sourceNotationFiles.js` |

---

## 6. Highest-risk architectural issues (ranked)

1. **Untyped triple time domain** (§2.3): written XML seconds, performed XML seconds, and MIDI-file seconds all travel as one number with no mapping layer. Root cause of the repeat/cursor/loop/WFY bug family. Until time domains are an explicit API, every new feature re-introduces the class.
2. **The written timeline itself is computed wrong** (P1/P3/P4) — silent, systematic, affects every real-world file, and has already corrupted shipped artifacts (demo anchors, demo clock skew). Fixing the clock architecture on top of wrong numbers would still produce a wrong cursor.
3. **Platform strategy contradicts the product target**: playback off on iPad Safari by UA sniff; no XML-only playback, no tempo control, no metronome — on the primary device the practice loop is read-only. A product-level decision disguised as a compatibility shim.
4. **Playback engine design forecloses required features**: schedule-everything-upfront + wall-clock time means no tempo scaling, no metronome injection, no XML synthesis without a rewrite — which is on the critical path of three requested features, so it must come first, not last.
5. **Anchor trust pipeline is a completed-looking dead end** (§2.5): semi-auto runs, reports ready, produces nothing trusted; the one promotion path has a one-line pairing bug that makes it return `[]` always; the barline supplemental path is computed and dropped. Users are silently routed to per-measure manual calibration — "manual calibration was confusing" is the designed-in outcome.
6. **Cursor pipeline is defensive duplication, not architecture** (§2.4): compute → re-derive-and-veto → dead smoother → 9-reason visibility gate. The veto converts data gaps into false "needs setup"; the dead layers mislead every maintainer.
7. **Parser orders children by tag kind** (P2) — a structural choice that caps correctness (tempo placement, backup/forward, per-part attributes) no matter how much downstream code is fixed.
8. **No regression safety net**: no git, no runner, 1 of 3 scripts broken, stale `dist/`, 106 lint problems. Refactoring items 1–7 without fixing this first is gambling.
9. **Per-frame React churn** (lower severity): `practiceTime` updates every RAF; `useScoreFollow` memos re-run anchor dedupe/sorts per tick; main context identity changes every frame. Tick/cursor sub-contexts already mitigate; iPad headroom unmeasured.

---

## 7. Proposed deterministic automated tests

Prototypes of exactly this suite were built and executed during the audit (results: Appendix A). Port them into the repo as **Vitest** (`npm test`, CI) with committed fixtures. All timing-core tests are pure Node — no DOM, no canvas, fully deterministic.

**Fixtures** (tiny, hand-written MusicXML; one screen each; all with realistic `divisions=480` unless noted):
- `fx-straight.musicxml` — 8 measures 4/4, ♩=120, quarter notes (covers the user-requested "straight playback").
- `fx-one-repeat.musicxml` — `m1 |: m2 m3 :| m4` **plus** single-measure `|: m5 :|` (P5).
- `fx-two-repeat-sections.musicxml` — consecutive `|: :|` sections (P6, P9).
- `fx-repeat-times3.musicxml` — `times="3"` (P5).
- `fx-repeat-to-beginning.musicxml` — backward repeat, no forward (P7).
- `fx-voltas-single.musicxml` and `fx-voltas-multi.musicxml` — 1- and 2-measure first endings (P8; user-requested "first and second endings").
- `fx-dc-al-fine.musicxml` — must yield an explicit "navigation unsupported" diagnostic until implemented (P11).
- `fx-tempo-midmeasure.musicxml` — 120 → 60 after beat 2; `fx-tempo-measure-start.musicxml`; `fx-tempo-beatunit.musicxml` (`half=60`) (P3, P10; user-requested "tempo changes").
- `fx-timesig-change.musicxml` — 4/4 → 3/4 (P1 variant); `fx-pickup.musicxml` — anacrusis.
- `fx-two-parts-divisions.musicxml` — P1 `divisions=480`, P2 `divisions=960` (P4).
- `fx-multisystem.musicxml` (+ 2-page PDF variant) — `<print new-system>` every 4 measures, `new-page` at m9 (user-requested "multiple systems/pages").

**Test groups and key assertions:**
1. **Parse/timeline** (pure): measure start/end/length in quarters *and* seconds for every fixture — **including measure 1 = full length under `divisions=480`** (P1 red test); per-part note times equal across different divisions; `tempoChanges` quarter positions including mid-measure; beat-unit scaling; time-signature-change measure lengths; pickup handling.
2. **Performed order**: exact arrays — e.g. one-repeat `1,2,3,2,3,4,5,5`; two sections `1,1,2,2,3`-style per fixture; times3 `1,1,1,2`; voltas-multi `1,2,3,4,2,5`; repeat-to-beginning expands; performed beats strictly monotonic; `performedDurationSeconds` equals sum of entries.
3. **Time-domain round trips**: `writtenMeasure → performedStart → getMeasureAtTime` is identity; second-pass probe instants map to correct written measures; (Phase 2+) `toPlaybackTime(toScoreTime(t)) = t` within 1 ms; against MIDI generated from the same fixtures, every measure-start delta < 20 ms.
4. **Cursor resolver** (pure): sweep t in 10 ms steps over each fixture's full performed duration with synthetic trusted anchors — selected anchor's measure equals the performed entry's written measure for 100% of samples, including inside repeats and across the page break; start-lock for t ≤ 0.15 s; **anchor-gap fixture keeps a visible (interpolated) cursor and never flips needs-setup** (red test, A-16).
5. **Anchor promotion**: canonical semi-auto output (start/end per system) + layout-rich timing map → ≥1 `MUSICXML_LAYOUT` anchor per measure (red test, A-12); `AUTO_MEASURE` supplemental anchors either applied behind the confidence gate or the producer deleted.
6. **Loop/WFY domain**: loop m3–4 on `fx-one-repeat` starts at the **performed** start of the targeted pass; `shouldRestartLoop` wraps on both passes; WFY checkpoints cover performed passes (or, if the product decision is "each written measure once", the documented written behavior **plus** correct seek mapping — the current combination satisfies neither).
7. **Playback-event schedule** (after Phase 2): golden JSON event lists per fixture (note on/off under tempo change and repeats; metronome ticks; count-in), compared in simulated time at 1.0× and 0.5× rate.
8. **Port the three scripts** into the runner (fix the broken fixture path); keep the PDF-heuristic and pitch suites as characterization tests.

---

## 8. Phased completion plan (dependency- and risk-ordered)

### Phase 0 — Safety net (no behavior changes)
Initialize git; commit the as-is baseline. Add Vitest + §7 fixtures; port both audit harnesses as tests, committing currently-failing ones as explicit red tests (`.fails`) so progress is visible. Fix `test-note-target-position.mjs`'s fixture path. ESLint: ignore `.venv-fixtures/`, then freeze at current count and fail CI on increase. Get `npm ci && npm test && npm run build` green on Linux + macOS (declares rolldown platform bindings; settles the build question).
**Acceptance:** `npm test` deterministic (two consecutive runs identical); red-test list exactly enumerates §3/§2 verified defects; baseline commit tagged; lint ratchet enforced; CI green on a clean clone.

### Phase 1 — Timeline core (the foundation everything sits on)
1. Re-parse measures in **true document order** (fast-xml-parser `preserveOrder` or equivalent ordered walk) — fixes P2/P3, makes `backup`/`forward` exact, removes the need for the voice-cursor workaround's guesses.
2. Compute measure length from **post-attributes** state with explicit pickup handling — fixes P1 (first measure, time-signature changes).
3. Parse each part with its own `<attributes>` — fixes P4.
4. Rewrite repeat expansion as an explicit interpreter: per-section pass counters, same-measure forward barlines, repeat-to-beginning, `times` attribute, volta-stop membership decided before bracket clearing; detect D.C./D.S./Fine/Coda and surface a first-class "navigation not supported" diagnostic (never silent) — fixes P5–P9, P11.
5. Metronome beat-unit scaling — fixes P10.
6. Introduce an explicit **time-domain API** in one module (`timeline.js`): `performedFromWritten(measure|beat)`, `writtenFromPerformed(t)`, `performedWindowsForMeasure(n)`, `performedBeats()`. Convert loop regions, WFY checkpoints, navigation, and cursor lookup to consume only this API; delete their private domain logic.
7. Regenerate `demo-minuet-in-g.anchors.json` from the fixed parser (kills the corrupted shipped anchors).
**Acceptance:** §7 groups 1–3, 6 green with zero skips; demo XML parses to 96.0 quarters, measure 1 = 3 quarters, XML duration within 0.1 s of the MIDI's 41.14 s; regenerated demo anchors strictly increasing in x within each system; `usesPerformedTimeline` true for every repeat fixture with `fullyInterpreted: true` except the documented D.C. case.

### Phase 2 — One playback engine, one clock
Replace schedule-everything with a windowed scheduler driven by **timing-map events** on a transport with a rate input (Tone.Transport or a small lookahead clock). The **performed score timeline is the master clock**; the MIDI file becomes one event source mapped onto it (the existing alignment heuristics become the mapper, not a diagnostic); MusicXML notes become another (→ XML-only playback exists); metronome is a third event stream from performed beats; loop boundaries are transport-native performed times. One WebKit audio-unlock path (user-gesture `Tone.start()` + the existing visibility resume); **remove the Safari UA gate** and gate on capability probes. Delete `livePracticeTime` duplication and the demo warning suppression (`demoHiddenWarningIds`) — after Phase 1 the demo should genuinely pass diagnostics.
**Acceptance:** §7 group 7 golden schedules pass at 1.0× and 0.5× (simulated clock; rate change keeps cursor-measure mapping correct in tests); XML-only fixture produces a scheduled, audible event list with Play enabled (manual audio check Mac + iPad); loop over `fx-one-repeat` m3–4 wraps on the correct pass; metronome ticks align with performed beats within 10 ms in the schedule; no `isSafariPlaybackLimited` reference gates transport; demo passes alignment diagnostics with the suppression list deleted.

### Phase 3 — One cursor resolver
Collapse compute+validate into a single pure `resolveCursor(performedTime, anchors, timingMap) → {page, x, y, measureNumber, confidence, interpolated}`: exact anchor when present; **interpolation between neighboring trusted anchors** (one implementation — resurrect the best of `scoreFollowInterpolation.js` or write fresh, then delete the module); a data gap never flips needs-setup. Re-enable display smoothing as one thin, tested layer (target-chase with snap-on-seek), now reachable because `lockExact` becomes a startup-only flag. Fix `pairSystemSpanAnchors` role matching so `MUSICXML_LAYOUT` promotion works; decide `AUTO_MEASURE` supplemental anchors (apply behind the confidence gate or delete the producer). Fix page-follow: seed easing from real `scrollTop`, add user-scroll override (suspend ≥ 2 s on user wheel/touch), keep the 36% band.
**Acceptance:** §7 groups 4–5 pass; gap fixture keeps a visible interpolated cursor; semi-auto on the demo PDF **without** bundled anchors yields ≥ 0.8 of measures within ± half a measure-width of the **regenerated** (Phase-1) anchor truth — note: the *current* bundled anchors are corrupted (A-10) and must not be the oracle; zero "needs setup" flips during uninterrupted playback in tests; page-follow unit test converges and yields to simulated user scroll.

### Phase 4 — Practice features on the unified core
WFY checkpoints from the timeline API (explicit, tested product decision on repeat passes); note-target geometry consumes the Phase-3 resolver's shared geometry module (delete the parallel mapper or make it the shared one); tempo control UI (0.25–1.5×) on the Phase-2 rate input; metronome + count-in UI on the Phase-2 event stream; practice stats keyed to performed time; calibration UX simplified to per-system taps (layout promotion now yields per-measure anchors), keeping per-measure marking as the correction tool.
**Acceptance:** WFY beat+note modes pass domain tests on all repeat fixtures; count-in = one bar of current meter at current rate; manual iPad protocol — demo piece **and** one user-grade score (engraved PDF + MuseScore XML with repeats and both endings) complete a full session: play, slow to 0.5×, loop a repeated passage, WFY with mic — cursor and note-target correct throughout; calibration of a 3-page score ≤ 1 tap per system + corrections.

### Phase 5 — iPad hardening, cleanup, docs
60 fps cursor on target iPad (profile per-frame work; cache deduped anchors; quantize non-cursor `practiceTime` consumers); lint to zero; the §9 delete list fully executed; localStorage migration removing `ANCHOR_SOURCE.AUTO`; `ARCHITECTURE.md` (≤ 2 pages: timeline API, engine, resolver); smoke checklist converted to a scripted manual QA protocol with the two reference scores; CI gate = lint + test + build.
**Acceptance:** Safari timeline < 8 ms main-thread per frame during playback on target iPad; lint 0; no §9 file remains; migration unit-tested against captured legacy payloads; clean clone green on Linux + macOS.

**Order rationale:** 0 enables everything; 1 is the dependency of 2–4 (all consume the timeline); 2 and 3 are mutually independent and parallelizable; 4 needs 1+2+3; 5 last. The highest-risk unknowns — WebKit audio on iPad and staff-detection quality on engraved PDFs — are de-risked early by Phase-2 capability probes and the Phase-3 oracle test.

---

## 9. Delete or consolidate (do not patch)

**Delete outright:**
- `scoreFollowPlayhead.js`, `autoScoreAlignment.js` (unimported).
- `scoreFollowInterpolation.js` after Phase 3 extracts/replaces its one used export (whose current call degrades to measure-number order anyway).
- `useScoreFollowDisplayCursor.js` in its current form (replaced by the Phase-3 smoothing layer or removed if snap is kept deliberately).
- `validateScoreFollowPosition` and the duplicate `buildExactCursor` (folded into the Phase-3 resolver).
- The `beatInterpolation` placebo toggle (state + checkbox + prop threading) — or wire it to the Phase-3 resolver; never ship a dead setting.
- Deprecated aliases: `resolveStartAnchor`, `validateScoreFollowStart`, `buildLoopRegion`, `tryMatchCheckpoint`, the legacy `scoreFollowUserMessages` export, `MusicXmlDebugPanel.jsx`, `ANCHOR_SOURCE.AUTO` (after a one-time localStorage migration), `useWaitForYou`'s unused `practiceTime` param.
- `demoHiddenWarningIds` warning suppression (after Phase 1–2 the demo should pass diagnostics honestly).
- `livePracticeTime` duplicate clock resolution.
- `supplementalMeasureAnchors` producer (`buildBarlineMeasureAnchorsIfConfident`) **if** Phase 3 decides against `AUTO_MEASURE`; otherwise its non-consumption is the bug to fix.
- The dead `ScoreFollowControls` path in `PdfViewer.jsx` (`showScoreFollowPanel` hardcoded false).
- The corrupted `demo-minuet-in-g.anchors.json` — **regenerate from the fixed parser; do not hand-edit.**
- Stale `dist/` from version-control scope (gitignore in Phase 0).

**Relocate:** `timingMeasureAnchors.js` → `scripts/` (tooling-only).

**Consolidate (one implementation each):**
- Cursor: `computeScoreFollowCursor` + `validateScoreFollowPosition` + both `buildExactCursor`s → one resolver (Phase 3).
- Anchor→(x,y) geometry: resolver geometry + `noteTargetContext.js` mapper → one shared module (Phase 4).
- Time domain: every private written/performed branch (`practiceLoopRegion`, `waitForYouCheckpoints`, `timingQuery`'s split lookups) → the Phase-1 timeline API.
- Clock: MIDI-seconds-as-practice-time → performed-timeline master clock with MIDI mapped onto it (Phase 2).
- Safari gating: `isSafariPlaybackLimited` UA sniff → capability probes + explicit audio unlock (Phase 2).
- The voice-cursor/kind-sort parsing workaround → superseded by ordered parsing (Phase 1); do not tune it further.

**Patch (small, contained):** `pairSystemSpanAnchors` role matching; metronome beat-unit; per-part divisions; page-follow scroll seed + user-scroll override; broken test-script fixture path; ESLint ignore for `.venv-fixtures`.

---

## 10. What was *not* verified, and how to verify it
Browser-only behavior (PDF rendering, annotations, audio output, Web MIDI permission flow, mic capture, IndexedDB restore, fullscreen HUD) was not executed in this audit environment; treat every such feature as "implemented, unverified" regardless of how complete the code looks. The production build could not run here (macOS-native bindings in `node_modules`); the stale-but-present `dist/` shows it built on the dev Mac on May 21; Phase-0 CI settles it permanently. Real-device iPad behavior (audio unlock, 60 fps, touch calibration) has no substitute for the Phase 2/4/5 manual protocols.

---

## Appendix A — Verification harness results (executed 2026-06-12, Node 22; scratch harnesses outside the repo importing repo modules unmodified)

Repeat/volta expansion and timeline (`parseMusicXml` → `buildPerformedMeasureTimeline`):

| # | Check | Expected | Actual | Verdict |
|---|---|---|---|---|
| A-0 | Single-measure voltas `m1 |: m2 [1. m3 :|][2. m4] m5` | 1,2,3,2,4,5 | 1,2,3,2,4,5 | PASS |
| A-1 | Single-measure repeat `m1 |: m2 :| m3` | 1,2,2,3 | **1,2,3** + "could not be linked" warning, written timeline | FAIL (P5) |
| A-2 | Consecutive sections `|: m1 :| |: m2 :| m3` | 1,1,2,2,3 | **1,2,1,2,3** (m2's backward matched m1's forward) | FAIL (P6) |
| A-3 | Multi-measure first ending `m1 |: m2 [1. m3 m4 :|][2. m5]` | 1,2,3,4,2,5 | **1,2,3,4,2,4,5** (m4 replays in pass 2) | FAIL (P8) |
| A-4 | `|: m1 :|` with `times="3"` | 1,1,1,2 | **1,2** | FAIL (P5/P9) |
| A-5 | P2 declares `divisions=2` (P1 has 1): P2's 2nd half-note | quarterTime 2 | **quarterTime 4** | FAIL (P4) |
| A-6 | Mid-measure `<sound tempo="60"/>` after 2 quarters | change at quarter 2; next measure starts 3.0 s | **quarter 0; next measure 4.0 s** | FAIL (P3) |
| A-7 | `divisions=480`, one 4/4 measure | m1 length 4 quarters | **0.00833 quarters**; m2's note at quarterTime 0.0083 | FAIL (P1) |
| A-8 | 4/4 → 3/4 time-signature change | changed measure = 3 quarters | **4 quarters** | FAIL (P1) |
| A-9 | Shipped demo XML vs MIDI duration | ≈ equal (96 quarters ≈ 41.14 s @140) | XML **93.0004 quarters / 39.86 s**; m1 length 0.0004 q; MIDI 41.14 s | FAIL (P1) |
| A-10 | Shipped demo bundled anchors monotonic | strictly increasing x per system | system 1: m1 x=0.1000, **m2 x=0.1001**, m3 x=0.2115… (one slot left) | FAIL (P1 propagated) |
| A-11 | Backward repeat with no forward ("repeat to beginning") | 1,1,2 (expansion) | **1,2,3 written** + "uncertain" warning | FAIL (P7) |
| A-12 | Layout-anchor promotion: canonical system start/end anchors + layout-rich timing map | ≥1 `MUSICXML_LAYOUT` anchor per measure | **0 anchors** (`pairSystemSpanAnchors` start/end pairing bug) | FAIL (§2.5) |
| A-13 | Loop m3–4 on an expanded-repeat piece uses performed time | performed start 16 s | **written 8 s** | FAIL (§2.3) |
| A-14 | WFY beat checkpoints cover the performed timeline | 24 (performed) | **16 (written)** | FAIL (§2.3) |
| A-15 | Cursor from complete trusted anchors; `lockExact` flag | correct anchor per measure | correct anchor; `lockExact === true` **always** (smoothing unreachable) | PASS / confirms §2.4 |
| A-16 | Cursor with an anchor gap at the current measure | stays visible (interpolated) | **hidden + `needsSetup: true` mid-playback** | FAIL (§2.4) |
| A-17 | Auto-system-only anchors drive a cursor? | n/a (policy) | `showCursor: false, needsSetup: true` — semi-auto alone never yields a cursor | confirms §2.5 |
| A-18 | `<metronome>` `half = 60` | 120 BPM | **60 BPM** | FAIL (P10) |
| A-19 | Straight parse, `divisions=1` toy file | exact measure/beat table | exact | PASS (masks P1 — see A-7) |
| A-20 | Two-measure repeat span `m1 |: m2 m3 :| m4` | 1,2,3,2,3,4 | 1,2,3,2,3,4 | PASS |

Tooling: `test-pitch-detection.mjs` PASS · `test-auto-align-heuristics.mjs` PASS · `test-note-target-position.mjs` CRASH (missing fixture) · `npx eslint` 106 problems (70 in `src/`) · `npm run build` blocked in sandbox by platform-native binding (environment, not source).

## Appendix B — File:line index for principal findings

P1 `parseMusicXml.js:207,347-359` · P2 `parseMusicXml.js:22-36,173-188` · P3 same + `quartersToSeconds` interplay (`timingMath.js`) · P4 `parseMusicXml.js:229-232,466-488` · P5/P6/P7 `parseMeasureRepeats.js:91-98,198-217` · P8 `parseMeasureRepeats.js:169-183` · P9 `parseMeasureRepeats.js:159,208-213` · P10 `extractTempo.js:24-32` · P11 `parseMeasureRepeats.js:226-241` · clock `practiceClock.js:37-58`, `usePracticeSession.js:89-103,329-331,425-428`, `midiPlaybackEngine.js:133-159,284-289` · Safari gate `browserPracticeSupport.js:4-6,29-30` · demo suppression `useImportReadiness.js:80-86` · cursor stack `scoreFollowCursor.js:23-33`, `scoreFollowStartSanity.js:24-117`, `useScoreFollow.js:289-307,769-792`, `useScoreFollowDisplayCursor.js` · trust `trustedAnchors.js:10-28`, `scoreFollowTrust.js:34-42` · promotion bug `musicxmlLayoutAnchors.js:95-110` · unconsumed supplementals `semiAutoScoreAlignment.js:291,331` · page follow `usePracticePageFollow.js:18,59-87` · loop domain `practiceLoopRegion.js:77-78` · WFY domain `waitForYouCheckpoints.js:42-61`, seek `useWaitForYou.js:56` · dead files `scoreFollowPlayhead.js`, `autoScoreAlignment.js`, `scoreFollowInterpolation.js` (+ `noteTargetContext.js:139`), `timingMeasureAnchors.js` (scripts-only) · placebo toggle `useScoreFollow.js:115`, `ScoreFollowControls.jsx:306` · hardcoded-off panel `PdfViewer.jsx:39` · corrupted demo data `public/fixtures/demo-minuet-in-g.anchors.json`, `scripts/generate-demo-anchors.mjs`.
