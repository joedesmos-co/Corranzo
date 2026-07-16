# Mic Engine V3 manual real-world validation

Date: 2026-07-16
Status: **physical-instrument session pending**

## Honest scope

This workspace can run deterministic replay, real-instrument-timbre composites,
and a browser with a virtual microphone. It cannot play a physical piano,
acoustic guitar, clean electric guitar, or distorted electric guitar. No human
performance was recorded during this sprint, so this document does not claim
manual instrument success.

The automated evidence is encouraging but is not a substitute for the required
musician session:

| Automated gate | Result | Provenance |
| --- | ---: | --- |
| V3 musical events | 17/18 (94.4%) | Synthetic + isolated-sample composites |
| First-attempt success | 94.4% | Offline proxy |
| Confirmation latency | 81 ms mean | Onset annotated; includes FFT capture window |
| Guitar double-stops | 4/4 | Two UIowa composites + two electric synthesis cases |
| Triads | 7/7 | Synthetic + UIowa composites |
| Electric guitar | 3/3 | Deterministic synthesis only |
| Quiet playing | 1/1 | UIowa pp piano composite |
| Ringing transition sequence | 1/1 | Deterministic IR sequence |
| False advances | 0 | Three audio controls + eight sequence scenarios |
| Browser QA | 27/27 | Virtual microphone/browser lifecycle |

Natural performance recordings in the shipped replay corpus: **0**.

## Required physical matrix

Run at least three trials for every condition in
`benchmarks/mic-manual-validation/session-template.json`.

Piano:

- single notes, dyads, triads, four-note chords
- quiet notes and repeated notes
- sustain pedal and rolled chords

Guitar:

- acoustic, clean electric, and distorted electric
- double-stops, full chords, quiet playing, and muted strings
- ringing transitions and staggered strums

Safety:

- speech, room noise, and a deliberately wrong chord must not advance

## Session protocol

1. Build the exact commit being evaluated and record the commit hash, browser,
   operating system, microphone, room, performer, and instrument/amp setup.
2. Keep browser processing disabled where supported: echo cancellation, noise
   suppression, and automatic gain control off.
3. Use the normal Wait For You and Play Along UI. Do not use a detector-only
   test page.
4. For every trial, record whether the checkpoint advanced, attempt number,
   confirmation latency, missed MIDI notes, difficult chord shape, and concise
   observation.
5. Record failures as failures. Do not retry and replace the original result.
6. Validate the session:

```bash
npm run mic:manual-validate -- --session path/to/completed-session.json
```

The validator rejects proxy trials presented as natural performances, requires
three trials per condition by default, counts false advances/rejects, and only
sets `releaseReady` when coverage is complete and every small-sample trial
passes on the first attempt. This is a release gate, not a detector threshold.

## Current manual results

| Metric | Physical result |
| --- | --- |
| First-attempt success | Not measured |
| Average confirmation latency | Not measured |
| Missed notes | Not measured |
| False advances | Not measured |
| False rejects | Not measured |
| Difficult chord shapes | Not measured |
| Acoustic guitar | Not measured |
| Clean electric guitar | Not measured |
| Distorted electric guitar | Not measured |
| Piano sustain/rolled chords | Not measured |

## Known weakness to target first

The UIowa-derived piano Cmaj7 fixture still rejects because E4 never crosses the
existing spectral evidence gate. V3 reports the event as three of four tones
instead of accepting an inferred note. During physical validation, test close
voicings and four-note chords early. If live piano consistently succeeds, keep
the conservative detector. If live piano reproduces the miss, collect the raw
WAV and trace before changing any gate.

Until the physical matrix is completed, “professional on real instruments”
remains an unverified release claim.
