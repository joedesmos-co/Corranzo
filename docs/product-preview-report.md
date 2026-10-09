# Unified product preview (codex/unified-practice-audio-preview)

ONE dev build: validated practice + microphone + sound engine.
Branch frozen from `codex/unified-practice-integration` (`4ee31862dd`);
sound merged as `6258818332` (87c61a40f2, zero overlapping files, no
conflicts). Integration branch preserved and untouched by the merge
(its later harness-parity commit is test-scripts only).

## 1. WFY → Play Along microphone fix (practice/UI state)
**Root cause:** the mode switch briefly deactivates capture
(`isWaitForYou || playing` gap); nothing re-acquires it, and no Start
button exists in the Play Along UI. The Play Along detector loop never
ticks again (proven with lifecycle counters + round-trip probes).
**Fix (session layer, mic lifecycle untouched):** when mic is selected
and permission is already granted, the session re-requests capture on
reactivation. Denial/error flips the gate off. Verified: detection
resumes post-switch ([60]/[64] heard). Regression test: mic-e2e run 6
uses the WFY-first transition path.

## 2. Play Along update-depth warnings (narrowed, not blind-fixed)
Matrix (real browser): playing+mic → 22–43 hits; playing+manual → 0;
mic+not-playing → 0; quiet file (no matcher activity) → 43. So it needs
mic-source AND transport together, independent of matching. No
integration code can setState-loop (memos + publish-only effect;
manual-source playing is clean with all new code active). Reproduced on
the mic branch WITHOUT integration code (29/90 s). Verdict:
pre-existing, non-fatal (React aborts excess renders; every functional
assertion passes), owned jointly by mic-lifecycle/playback lanes.
Tracked as `knownPreExisting` in the mic report, never mixed into the
strict gate.

## 3. Sound integration
Parser diff additive (technique/pedal metadata only); engine adds
voices (piano, acoustic, clean electric), pitch curves, deterministic
room; no package.json changes. `npm run build` ✓.
Sound unit suites pass in-tree (playbackExpression, audioRender,
playbackEngine: 43 tests).

## 4. Unified practice functionality — 61/61 browser checks
- MIDI e2e 26/26 (Menuet/Prelude): shared cursor, note states, I2
  notehead-column lock, duplicates single-award, pause/seek/loop,
  score-change reset, clean console.
- Mic e2e 23/23: spectral C4 advance + green, wrong heard-yet-refused,
  melody multi-advance + cursor travel, neural engage/progress/disable,
  denied-permission guidance, Play Along timed events (transition path),
  model-404 honest-unavailable + spectral fallback, clean console.
- Audio e2e 12/12: piano schedule + cursor sync, pause, acoustic +
  electric re-voicing (playback trace), same-origin lazy samples,
  techniques/dynamics/pedal pieces, real file-input MusicXML import,
  bounded memory, clean console.

## 5. Score-follow accuracy
WFY cursor locks to the resolved notehead column (Δ asserted live);
timeline cursor elsewhere. Approximate sources keep dashed treatment.
Screenshots inspected (Bach/Mozart engraving with green/blue states).

## 6. Audio synchronization
Transport time vs cursor-x sampled twice per run: monotonic together;
pause freezes both; seek lands ±3 s; loop range renders. Schedule
snapshot (events/duration/voice) asserted per instrument. Audibility
chain: committed example WAVs + offline render tests (no ears available).

## 7. Instruments
Piano / Acoustic Guitar / Electric Guitar selectable (top-bar radios
are zero-size styled inputs — clicked via DOM). No curated electric
pieces: electric exercised through the import path (finding). Samples
load same-origin from the local mirror.

## 8. Browser tests
`npm test`: 7 pre-existing failures only (UI-copy/CSS, identical to
main). `npm run test:scripts` exit 0. Load-flakes
(`finalMicLowNoteCorpus` et al.) pass in isolation in both trees.

## 9. Performance (headless, 16 GB shared Mac)
JS heap 27 MB home → 64 MB practice → 65–77 MB playing; +101 MB across
a long multi-piece session (bound 400). Zero >50 ms long tasks during
8 s playback. Instrument switch re-renders schedule from local mirror
(no CDN). Viewport meta + 44 px targets present. Latency on real
hardware, CPU-throttle automation, and offline-after-cache remain
attended/CI follow-ups. No service worker: dev build needs its server;
external outage degrades honestly (analytics/fonts/model-404 paths).

## 10. Remaining limitations
- Mic wrong pitches refused silently by design (latching WRONG would
  pause matching); red flash is MIDI-only.
- Neural in-app `listening` timing-sensitive headless (panel present;
  no-dead-path routing proven either way).
- Imported scores show filename titles and 0:00 duration (cosmetic).
- Slow-CPU throttle not automated; offline-after-model-cache not covered.
- Retry-calibration button missing from AX tree (product a11y finding).

## 11. Preview branch and commit
`codex/unified-practice-audio-preview` (this tree). Sound merge
`6258818332`; audio suite + harness hardening on top. Main untouched.
Integration branch: only test-harness parity added since the freeze.

## 12. Launch
```
cd ~/Documents/scoreflow-product-preview && npm run dev
E2E_PORT=5399 node scripts/browser-unified-practice-midi-e2e.mjs
E2E_PORT=5397 node scripts/browser-unified-practice-mic-e2e.mjs   # needs clips first
E2E_PORT=5499 node scripts/browser-product-audio-e2e.mjs
node scripts/render-unified-mic-clips.mjs   # regenerates all WAVs
```

## Recommended next step
WFY→PlayAlong detector handoff is fixed at the session layer, but the
update-depth loop (playing+mic) still needs its owner-lane fix; then
V3 piano acceptance tuning for decaying notes, and the calibration
Retry AX-tree fix.
