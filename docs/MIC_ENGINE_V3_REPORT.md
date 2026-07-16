# Corranzo Mic Engine V3 — Final Architecture Report

Date: 2026-07-16

Branch: `codex/mic-v3-polyphony`

Baseline commit: `289fb841944fe1a768e9c6532282f1c56def48e8`

Automated verification: **PASS**

Physical-instrument release gate: **PENDING**

## Executive result

Mic Engine V3 is implemented as a score-aware musical-performance recognition
layer for Piano and Guitar. It is the production-default decision path behind a
rollback flag, while the existing V2 detector remains the spectral evidence
provider. Wait For You and Play Along now consume the same expected musical
event and `RecognitionDecision` model.

The sprint did not lower detection thresholds, hardcode songs, redesign OMR,
or redesign playback. The final automated gates pass with zero false advances
and the same 94.4% chord-event result as the conservative V2 baseline. This is
intentional: V3 improves event ownership, musical timing, chord progress,
ringing protection, diagnostics, and measurement validity without accepting
the one masked chord tone that the microphone evidence did not establish.

This environment could not perform the required physical Piano, acoustic
Guitar, clean electric Guitar, or distorted electric Guitar session. The
shipped corpus contains real-instrument-timbre isolated-sample composites but
zero provenance-confirmed natural performances. Consequently, this report does
**not** claim that professional real-instrument reliability has been proven.
The automated architecture is complete; physical release qualification remains
open.

## Architecture

The runtime data flow is:

```text
V2 spectral evidence
        |
        v
MicFrame + Attack history
        |
        v
PerformanceExpectation <- score checkpoint + neighbors + timing + ties/sustain
        |
        v
GuitarRecognition / PianoRecognition
        |
        v
MusicalTiming (early / target / late, attack / hold / release / ringing)
        |
        v
RecognitionDecision
        |
        +--> Wait For You advancement and concise chord progress
        +--> Play Along correctness/timing/sustain feedback
        +--> debug trace and replay metrics
```

### Recognition IR

`src/features/microphone-input/v3/micRecognitionIr.js` defines the shared,
React-independent IR for `MicFrame`, `Attack`, `PitchCandidate`,
`ChordCandidate`, `RecognitionWindow`, `PerformanceCheckpoint`, confidence
breakdowns, and `RecognitionDecision`. Objects are JSON serializable, validated
at construction boundaries, frozen where practical, and carry stable evidence
references plus optional diagnostic/debug payloads.

The IR replaces ownership through scattered hook refs with an auditable event
lifecycle. It does not replace the signal detector or introduce React into the
recognition layer.

### Score-aware expectation engine

`performanceExpectation.js` builds the primary `PerformanceExpectation` from
the current checkpoint. It includes:

- expected notes and chord tones;
- Guitar string/fret positions when available;
- early, target, late, and completion timing windows;
- ties, sustain state, and held-note intent;
- previous and next checkpoints;
- voice, measure, instrument, mode, and checkpoint identity;
- accumulated chord progress, attack history, and ringing-note context.

The score constrains and explains microphone evidence; it does not manufacture
a missing pitch. This is why the known Cmaj7 E4 miss remains a reject rather
than becoming a false completion.

### Guitar recognition

The Guitar engine supports staggered strums, double-stops, 3–6-note chords,
split registers, bass-dominant spectra, adjacent/high-string masking, ringing
strings, quiet input evidence, and attack transitions used by hammer-ons and
pull-offs. Double-stops require both tones. Larger chords use an expectation-
aware quorum while requiring the bass anchor, and string/fret agreement adds an
instrument-confidence component.

Incomplete and wrong chords return progress/rejection decisions and never
advance. A deterministic six-string case proves quorum behavior without
letting one tone satisfy a chord.

### Piano recognition

The Piano engine supports dyads, triads, four-note chords, split registers,
rolled attacks, ties, held notes, repeated-note reattacks, quiet events, and
sustain-pedal state. Its rolling recognition window permits realistic chord
spread instead of impossible frame-level simultaneity. A repeated note still
requires release/new-attack evidence unless the checkpoint is a tie or hold.

### Attack and musical timing

`musicalTiming.js` owns early, target, and late timing plus attack, hold,
release, and ringing phases. Expected notes can be recognized slightly before
their written onset. Attack ownership is checkpoint-specific: evidence used to
complete one event cannot authorize the next checkpoint merely because a
Piano note or open Guitar string continues ringing.

### Wait For You and Play Along

`useWaitForYouMicInput.js` constructs the expectation, feeds V2 evidence into
V3, publishes recognition decisions, and advances only on an accepted event.
Full-chord checkpoints use V3 event completion as the primary path; the legacy
sequential chord path remains available only through rollback.

Wait For You feedback is concise and musical, showing the requested event,
matched chord tones, and the remaining tone instead of raw pitch dumps. Play
Along retains the existing continuous cursor and UI, with recognition feedback
mapped to green correct, red wrong, yellow early, purple late, and blue
sustain. No playback timing or transport architecture changed.

### Evaluation and rollback gates

V3 is the default mode (`v3-performance-expectation`) but can be disabled by
the existing local/global evaluation flag (`scoreflow.flags.micEngineV3`). The
V2 signal path is preserved, so rollback does not require reverting detector
code. Browser QA asserts both the V3 decision mode and the underlying V2
evidence.

## Metrics before and after

| Metric | Phase 0 baseline | Mic V3 final | Interpretation |
| --- | ---: | ---: | --- |
| Single-note evidence hit rate | 100.0% (27/27) | 100.0% (27/27) | Existing evidence gate preserved |
| Chord event hit rate | 94.4% (17/18) | 94.4% (17/18) | No threshold-driven score inflation |
| Required-tone hit rate | 98.2% | 98.2% | One E4 remains missed |
| First-attempt success | 94.4% | 94.4% | Replay proxy, not human trials |
| False advances | 0 | 0 | Preserved across audio and sequences |
| Wrong-tone acceptance | 0.0% | 0.0% | Wrong chord does not advance |
| Silence/noise false positives | 0.0% | 0.0% | Reject behavior preserved |
| Average confirmation latency | Invalid -120 ms reference | 81 ms | V3 uses annotated onset and FFT-window end |
| Average chord completion latency | Not measured | 24 ms | Time from first captured tone to completion |
| Guitar double-stop accuracy | No dedicated metric | 100.0% (4/4) | Includes acoustic-timbre proxies and synthesis |
| Piano dyad accuracy | No dedicated metric | 100.0% (3/3) | Replay proxy |
| Triad accuracy | 100.0% (6/6) | 100.0% (7/7) | Expanded categorization |
| Large-chord accuracy | 66.7% (2/3) | 75.0% (3/4) | Denominator changed; not a direct uplift claim |
| Quiet-note success | 100.0% in V1 condition set | 100.0% (1/1 V3 event) | Too small for a release claim |
| Electric success | Synthetic coverage only | 100.0% (3/3) | Still synthetic only |
| Acoustic-timbre success | Not separately reported | 88.9% (8/9) | Isolated-sample composites, not performances |
| Ringing transition success | Deterministic browser coverage | 100.0% (1/1 audio; 1/1 sequence) | Attack ownership regression gate |

V3 performance replay covers 18 musical events plus 3 reject controls. It
reports 17 accepted events, one conservative false reject, no false advances,
and no invalid latency annotations. By instrument, Guitar is 6/6 and Piano is
11/12. These are corpus results, not population estimates.

## Replay improvements

The replay system now has explicit performance-onset and FFT-window-end timing,
so confirmation latency is measured rather than clamped or derived from an
invalid marker. Metrics include first-attempt success, chord completion
latency, quiet/electric/acoustic success, false advances/rejects, dyad,
double-stop, triad, large-chord, and ringing-transition success.

Eight deterministic IR sequences pass 8/8 with ten checkpoints and zero false
advances:

1. staggered Guitar double-stop completion;
2. one tone never satisfying a double-stop;
3. wrong Guitar chord rejection;
4. six-string quorum with bass anchor;
5. rolled Piano chord completion;
6. ringing transition without checkpoint skipping;
7. repeated Piano note requiring release and reattack;
8. speech-like non-musical evidence rejection.

Every shipped polyphony fixture now has explicit provenance in
`benchmarks/mic-polyphony/provenance.json`. Legacy `real-*` IDs are correctly
classified as generated placeholders, and UIowa-based chords are classified as
isolated-sample composites. Synthetic audio is never counted as natural.

The capture utility requires an explicit provenance class and onset annotation,
and a manual-session validator rejects proxy trials presented as natural
performances.

## Real-world reliability work

More than half of the implementation effort was directed at instrument-facing
reliability rather than benchmark presentation: Guitar/Piano event models,
rolled/staggered completion, string/fret and bass-anchor reasoning, quiet-note
handling, ties/sustain/repeated attacks, ringing ownership, concise in-context
feedback, provenance controls, and the physical validation gate. The remaining
work was IR, metrics, browser integration, and verification.

The architecture is better aligned with real performance because it reasons
over an expected musical event and a time window, not an isolated pitch frame.
However, this sprint produced **no new physical-instrument measurements**.
Accordingly, the following requested results remain unmeasured on a real
musician:

- first-attempt success and perceived confirmation latency;
- acoustic, clean-electric, and distorted-electric Guitar reliability;
- muted strings, hammer-ons, pull-offs, and difficult chord shapes;
- Piano repeated notes, four-note chords, sustain pedal, and rolled chords;
- live-room speech/noise rejection and false advances;
- end-to-end feel in Wait For You and Play Along.

The required 60-trial minimum matrix and protocol are documented in
`docs/MIC_V3_MANUAL_VALIDATION.md`; its release status remains pending.

## Remaining weaknesses

1. The UIowa-derived Piano Cmaj7 still exposes only C4, G4, and B4 strongly
   enough to pass evidence; E4 remains missing. V3 correctly rejects 3/4 rather
   than inferring completion.
2. The corpus has zero natural performance recordings. Electric Guitar coverage
   is entirely deterministic synthesis; acoustic/Piano polyphony uses isolated
   sample composites.
3. Quiet-event, ringing-audio, and several category samples have a denominator
   of one and cannot establish field reliability.
4. The recorded reject corpus is small. Speech rejection has strong deterministic
   coverage but not diverse speakers, rooms, microphones, and simultaneous
   instrument/speech recordings.
5. Physical first-attempt success, false rejects, false advances, and subjective
   latency are unknown. Automated success must not be used to mark the manual
   release gate ready.
6. `PROJECT_BRIEF.md` was not present in this repository, as recorded in the
   baseline report.

## Final verification

| Gate | Final result |
| --- | --- |
| `npm test` | PASS — 241 files; 2,350 passed, 5 skipped |
| `npm run build` | PASS — existing chunk-size warning only |
| `npm run mic:accuracy-replay` | PASS — 27/27 note hits; 0/4 reject false positives |
| `npm run mic:polyphony-replay` | PASS — 17/18 chord events; 0 false advances |
| `npm run mic:v3-replay` | PASS — 17/18 events; 8/8 sequences; 0 false advances |
| `npm run mic:browser-qa` | PASS — 27 passed, 0 failed; no tuning change |
| `npm run omr:benchmark-dashboard` | PASS — 10 enforced pass, 6 local skipped, 0 fail/error |
| `node scripts/browser-smoke-pass.mjs` | PASS — 17 passed, 0 failed against the documented `npm run preview` prerequisite |

The first chained smoke invocation and one direct retry ran without the preview
server and stopped at `Server not ready`; no browser assertion ran. Starting
the server required by the script header and rerunning produced the 17/17 result
above with zero console errors, zero uncaught page errors, and no desktop/iPad/
mobile overflow.

No OMR or playback source file changed between the baseline and this sprint.
The OMR dashboard remains overall PASS, and OMR V3 remains outside this work.

## Commit structure

1. `c677439` — Mic IR foundation
2. `ef50e55` — Guitar recognition
3. `cda7ccd` — Piano recognition
4. `4949fb1` — Timing engine
5. `53adaf9` — Wait For You / Play Along integration
6. `15e307c` — Metrics
7. `3d043e0` — Replay expansion and provenance
8. `2c9d700` — Manual validation improvements
9. Final verification — this report and generated verification artifacts

Every implementation commit was tested before commit. The final verification
commit records the complete required gate.

## Recommended future work

1. Run the documented physical matrix on this exact commit: at least three
   first-attempt trials for each of 20 Piano, Guitar, and safety conditions.
2. Capture failed and successful raw WAVs with microphone, room, instrument,
   amp/pedal, distance, performer, onset, and license provenance. Add them as
   natural-performance fixtures without replacing first-attempt failures.
3. Test the Cmaj7/close-voicing weakness early. Change evidence logic only if a
   live failure reproduces, and retain raw traces for any proposed fix.
4. Expand electric coverage across clean, overdrive, high-gain, pickup position,
   palm muting, and common noise-gate/compressor chains.
5. Expand acoustic/Piano coverage across microphone families, rooms, quiet
   dynamics, pedal resonance, repeated notes, rolled voicings, and staggered
   strums.
6. Validate the Play Along early/late/sustain colors and Wait For You chord
   progress with musicians for perceived timing and clarity, without changing
   the playback architecture.
7. Promote the physical gate only when zero false advances and effectively zero
   speech/noise advances survive diverse natural sessions. Real-world evidence
   should override a proxy benchmark improvement if they conflict.

## Release conclusion

Mic Engine V3's architecture and automated regression gates are ready for a
physical validation sprint. It is not yet evidence-backed to state that
acoustic Guitar, electric Guitar, and Piano are professionally reliable for
real users. The safe next action is instrument testing and provenance-correct
fixture capture, not threshold relaxation.
