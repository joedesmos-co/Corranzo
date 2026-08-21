# Corranzo Mic Engine V3 — Phase 0 Baseline

Date: 2026-07-16

Branch: `codex/mic-v3-polyphony`

Baseline commit: `289fb841944fe1a768e9c6532282f1c56def48e8`

Runtime status: unmodified for this measurement

## Scope and source material

This baseline was captured before Mic Engine V3 runtime work. It covers the current raw-instrument capture path, V1 monophonic replay, the production-default V2 score-informed detector, Wait For You matching and attack latching, Play Along feedback, replay harnesses, and browser QA.

`PROJECT_BRIEF.md` is not present in this repository. The only file with that name is in an unrelated sibling project and was not used. The local architecture sources used were `docs/OMR_V3_FINAL_REPORT.md`, `docs/OMR_V3_IR_SPEC.md`, `docs/MIC_ENGINE_V2_RESEARCH.md`, the mic/WFY/Play Along source modules, replay manifests, and their tests.

OMR V3 remains shadow-only and is outside this sprint. The baseline test run confirms its current no-production-change gate remains green.

## Verification baseline

| Command | Result |
| --- | --- |
| `npm test` | PASS — 233 files; 2,301 passed, 5 skipped |
| `npm run build` | PASS — 1,451 modules; existing large-chunk warning only |
| `npm run mic:accuracy-replay` | PASS — 31/31 measured, 0 skipped |
| `npm run mic:polyphony-replay` | PASS — comparison verdict `v2-improves` |
| `npm run mic:browser-qa` | PASS — 27 passed, 0 failed |
| `node scripts/browser-smoke-pass.mjs` | PASS — 17 passed, 0 failed, when run against `npm run preview` as required by the script header |

The first direct smoke invocation found no preview server and exited with `Server not ready at http://127.0.0.1:4173`. Starting the documented preview process and rerunning produced the passing result above. This is a harness invocation prerequisite, not a product recognition failure.

## Recognition metrics

### Single-note replay

| Metric | Baseline |
| --- | ---: |
| Note hit rate | 100.0% (27/27) |
| False negative rate | 0.0% (0/27) |
| Silence/noise false positive rate | 0.0% (0/4) |
| Mean clarity | 0.986 |
| Mean absolute cents error | 6.8 cents |
| Reported mean stabilizer latency | -15 ms |
| File-backed note hit rate | 100.0% (6/6) |
| Synthetic note hit rate | 100.0% (21/21) |
| Quiet-condition hit rate | 100.0% (5/5) |
| Guitar hit rate | 100.0% (15/15) |
| Piano hit rate | 100.0% (12 note clips; 16 entries including reject controls) |

The file-backed subset has a credible positive mean latency of 39 ms, but the aggregate negative latency comes from synthetic clips whose generated audio begins before their manifest `expectedOnsetMs`. It must not be presented as user-perceived confirmation latency.

### Polyphonic replay — production-default V2 scorer

| Metric | V1 monophonic baseline | V2 score-informed baseline |
| --- | ---: | ---: |
| Chord hit rate | 0.0% (0/18) | 94.4% (17/18) |
| Required-tone hit rate | 5.5% | 98.2% |
| Exact / first-attempt success | 0.0% | 94.4% |
| Wrong-tone acceptance | 72.2% | 0.0% |
| False advances | 0 | 0 |
| Silence/noise false positive rate | 0.0% | 0.0% |
| Partial chords | 3 | 1 |
| Missed required notes | 52 | 1 |
| Unexpected accepted notes | 13 | 0 |
| Reported mean confirmation latency | unavailable | -120 ms (invalid onset reference) |

V2 breakdowns:

- Dyads: 100.0% chord hit (7/7).
- Triads: 100.0% chord hit (6/6).
- Four-or-more-note chords: 66.7% chord hit (2/3), 92.9% required-tone hit.
- Rolled chords: 100.0% chord hit (2/2).
- Split-register chords: 100.0% chord hit (2/2).
- Guitar chord entries: 100.0% chord hit (6/6).
- Piano chord entries: 91.7% chord hit (11/12).
- File-backed chord entries: 90.9% chord hit (10/11).

The single V2 chord miss is `uiowa-piano-mf-cmaj7`: C4, G4, and B4 are found while E4 is missed. It is the only partial chord and the main current replay weakness.

## Replay coverage and provenance

The monophonic manifest has 31 entries: 23 synthetic entries and 8 WAV-backed entries. Only six WAV-backed entries contain notes; three are explicitly generated in-repo placeholders and three are UIowa MIS single-instrument samples. The other two WAV entries are room-rejection controls.

The polyphonic manifest has 21 entries: 9 synthetic entries and 12 WAV-backed entries. Eleven WAV entries contain chords and one is a quiet-room control. Two chord WAVs are in-repo generated fixtures. Nine are derived by combining redistributable UIowa MIS isolated-note samples: six Piano and three acoustic Guitar.

The corpus does **not** yet contain a provenance-confirmed developer microphone performance of a complete chord. UIowa-derived chords provide real instrument timbre but are assembled fixtures, not natural musician performances. The `real-*` generated placeholders are also not real performances despite their legacy IDs. Synthetic electric-guitar cases must not be described as real electric recordings.

Current coverage includes single notes, quiet notes, bass notes, acoustic-guitar dyads/split register/open Em, Piano dyads/triads/tetrad/split register/long sustain, synthetic clean and distorted electric Guitar, rolled chords, silence, broadband noise, quiet-room and noisy-room beds, ringing transitions, and repeated-note attack cases.

Coverage gaps include natural electric-guitar mic performances, distorted amp recordings, natural acoustic strums and muted strings, hammer-ons/pull-offs, varied chord shapes and inversions, natural Piano sustain-pedal and repeated-note passages, more speech/noise speakers, multiple rooms/devices/distances, and true first-attempt multi-performance trials.

## Browser and integration baseline

Browser Mic QA passed all 27 checks. The deterministic frame suite covers:

- a new note while the previous note rings;
- no checkpoint skipping from sustain;
- repeated notes requiring a fresh attack;
- speech over a ringing instrument and room-noise rejection;
- quiet Piano, acoustic Guitar, and electric-style Guitar;
- complete, incomplete, staggered, and wrong Guitar double-stops.

The production browser path confirms V2 is the default when the flag is unset, captures debug frames, survives permission denial, calibration, input-source and instrument transitions, and has no iPad/mobile horizontal overflow. The general browser smoke pass reports no console errors, page errors, or desktop/iPad/mobile overflow.

Browser QA does not play every WAV performance through a complete scored WFY session. Its real-WAV Chromium cases currently prove safe enablement and absence of a false confirmation for room controls, not end-to-end accuracy on real Piano/Guitar performances.

## Remaining weak cases and measurement limits

1. Four-note Piano chord completion is the only measured V2 accuracy miss; E4 is masked in the UIowa-derived Cmaj7.
2. Confirmation latency is not trustworthy because generated and derived WAV content starts before the manifest onset marker; both single-note and chord reports can be negative.
3. Current first-attempt success is equivalent to one exact replay outcome per fixture, not repeated human first attempts.
4. The current V2 runtime state is detector-centric (`Map` tracks and scattered WFY refs), not a serializable recognition model with an auditable decision lifecycle.
5. The V2 detector receives expected MIDI notes and optional string/fret data but not the full checkpoint context: timing, ties, sustain, neighbors, voice, measure, or attack/ringing history are owned elsewhere.
6. Current gating proves zero false positives on a small reject set (digital silence, synthetic broadband noise, and two room beds). Speech rejection is covered by deterministic frame tests, not a diverse recorded speech corpus.
7. Play Along feedback classifies early/on-time/late/wrong visually, but the mic recognition evidence is not represented as a shared musical decision model.
8. No automated benchmark can establish how the app feels under a live musician. Manual real-world validation remains required and must be reported honestly if the needed instruments or recordings are unavailable in this environment.

## Baseline conclusion

The existing engine is already strong on its curated score-informed replay set and has effective reject guards. Mic V3 therefore should not chase easier thresholds. The justified architecture work is to make expectations, evidence, timing, attacks, sustain/ringing state, chord progress, confidence, and decisions explicit and serializable; correct the metric definitions; expand honest provenance and real-performance coverage; and promote runtime behavior only where evaluation gates preserve the current zero-false-advance baseline.
