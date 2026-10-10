# Final core practice integration (preview branch)

Merges `codex/score-follow-precision` (`bad9f98e18`) and
`codex/neural-mic-reliability` (`55989e1a72`) into the unified product
preview. Sound engine, Practice UI, MIDI, and canonical evaluator
preserved. Main untouched.

## Integration commit
- `ff15fcd7f8` merges score-follow-precision (clean, no conflicts).
- `090363b250` merges neural-mic-reliability (clean, no conflicts).
- Ancestry: precision branched from integration `ff5b41219c` (extends
  practice-UI cursor/state code, not a rewrite); reliability branched
  from mic-engine `636d27c316`. Only one preview-side file diverged
  from precision's base (`usePracticeSession.js`, untouched by them).

## Branch conflicts and resolutions
- **None requiring manual resolution.** The score-follow agent extended
  my I2 cursor lock (coordinate-space guards, cross-measure rules,
  audio-clock highlight index) rather than replacing it; the mic agent's
  session changes (shared neural ring) sit in different hunks from my
  capture-recovery effect.
- **Complementary duplicates kept deliberately:** mic reliability fixes
  switch starvation with a 1.5 s teardown grace + live-track adoption;
  my session-layer re-request covers gaps beyond the grace. Verified
  they compose (no double-acquire: mine gates on `!isListening`).
- **No overwrites:** V3-accept bypass, Set-contract hardening, session
  recovery, audio-clock index, pageViewRotations — all present
  post-merge (grep-verified), build green.

## Combined browser test results
- Product suite preserved: MIDI 26/26, mic 23/23, audio 12/12 (61/61).
- Score-follow suites: tempo 5/5 (start offset 0.08 s, measures 2.98–
  2.99 s vs 3.00 notated, static onset error 7.4 px), precision 9/9
  (onset lock, no overshoot, frozen pause, seek, WFY lock, zoom),
  cross-engraving 7/7 (honest approximate labeling; fixtures copied
  from the score-follow worktree's untracked tmp/, CC0/public-domain).
- Mic harness suites: `neuralLiveInjection` 9/9 (incl. new WFY→Play
  Along shared-ring survival), `micNeuralPlayAlongTiming` 11/11,
  stream/lifecycle unit suites 47/47.
- `npm test`: 7 pre-existing failures only + load-flakes that pass in
  isolation in both trees. `npm run test:scripts`: exit 0.

## Microphone-to-WFY advancement
Spectral C4 advances Prelude with green trail (V3 default-ON, via the
V3-accept commit); melody multi-advances with cursor travel; neural
progresses with no-dead-path routing; permission-denied and model-404
fall back honestly. Wrong pitches heard-yet-refused without advancing.

## Chord highlighting
Partial chords hold as required (per-tone split from owned noteheads,
whole-event state otherwise); completed chords advance with green
confirmation. No incomplete chord completes (evaluator authority kept).

## Score-following accuracy / mid-song tempo
Correct start position (startup offset 0.08 s), correct MusicXML tempo,
steady mid-song measures, notehead-locked cursor column in WFY,
no wrong-measure positions (0 wrong-page across 40 sampled onsets).

## Playback synchronization
Transport time vs cursor-x monotonic together; pause freezes both;
seek lands; loop renders; per-instrument schedule snapshots. Piano,
acoustic, and electric voices verified through playback traces;
samples same-origin.

## Responsiveness / capture lifecycle (measured)
- MIDI inject → highlight pixels: **16 ms**.
- Playback rAF: **60 fps, zero longtasks** over measured windows.
- Capture cold start (mic select → first frame): **~1.2 s**.
- WFY→PlayAlong+Play recovery: **~0.6 s** (grace adoption, no renegotiation).
- JS heap 27 MB home → 64–77 MB practice/playing.

## Remaining critical bugs
None blocking. Known non-fatal issues (all pre-existing, documented):
update-depth warnings in playing+mic (owner lanes), neural in-app
`listening` timing sensitivity headless, mic wrong-note silent refusal
by design, Retry-calibration AX-tree gap, no curated electric pieces,
imported scores show filename titles + 0:00 duration.

## Exact launch instructions
```
cd ~/Documents/scoreflow-product-preview && npm run dev
E2E_PORT=5399 node scripts/browser-unified-practice-midi-e2e.mjs
node scripts/render-unified-mic-clips.mjs   # once, regenerates WAVs
E2E_PORT=5397 node scripts/browser-unified-practice-mic-e2e.mjs
E2E_PORT=5499 node scripts/browser-product-audio-e2e.mjs
E2E_PORT=5211 node scripts/browser-tempo-acceptance-e2e.mjs
E2E_PORT=5212 node scripts/browser-score-follow-precision-e2e.mjs
E2E_PORT=5213 node scripts/browser-cross-engraving-e2e.mjs   # needs tmp/cross-engraving PDFs
E2E_PORT=5599 node scripts/measure-practice-responsiveness.mjs
```
