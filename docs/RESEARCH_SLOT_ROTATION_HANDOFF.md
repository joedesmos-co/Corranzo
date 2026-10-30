# Research Slot Rotation Handoff — Microphone → Sound Engine

Status: the neural microphone research slot has reached its evidence-based
stop point (see `docs/MIC_FALSE_AWARD_RESEARCH_LOG.md`). This document hands
the slot off cleanly to the next unfinished system. Recommended rotation:
**Sound Engine**.

## State of the mic worktree (branch `codex/neural-mic-reliability`)

- Latest push: `681594796b` (+ this round's documentation commits).
- All regressions green: 19/19 MediaStream injection tests, mic unit suites,
  `npm run build`, `npm run test:scripts`. Full-suite failures are the 7 known
  pre-existing UI tests plus a rotating load-flake on recognition tests when
  the shared machine is loaded (all verified green standalone).
- NOT merged into main. Neural remains experimental and default OFF; spectral
  remains the default microphone path.
- Uncommitted risk: none. No half-finished experiments — every experiment this
  round ended in a documented acceptance or rejection.

## Known follow-ups that do NOT require a research slot

1. Practice-agent UI work from `docs/NEURAL_MIC_PRACTICE_HANDOFF.md`:
   noisy-room warning (`noiseFlatSkips` + `debug.lastFlatness > 0.48`),
   quiet-stall hint (`silenceSkips`), trust framing for neural OFF by default.
2. Attended physical-mic acceptance session (the only path to V1 sign-off).
3. If the model is ever upgraded: revisit `docs/MIC_FALSE_AWARD_RESEARCH_LOG.md`
   — the instrumentation (flux, flatness, fine-pitch probes, corpus scorer)
   is all in place to re-run every measurement in minutes.

## Why Sound Engine is the right next slot

- It is the only other P0 system with an explicit acceptance gap recorded by
  earlier rounds: sampled piano/acoustic/clean-electric rendering is
  operational, but the Salamander Grand Piano (CC-BY-3.0 Alexander Holm) and
  `nbrosowsky/tonejs-instruments` (CC-BY-3.0) attributions still need Terms +
  `SOUND_CREDITS` verification, and per-note technique voices (palm-mute,
  harmonics, pedal) have no automated acceptance suite comparable to the
  microphone corpus.
- The measurement discipline that served the mic slot transfers directly:
  frozen clips + construction truth + an A/B scorer characterises synthesis
  changes the same way it characterised recognition changes.
- Disk is at ~20 GB free; the Sound Engine licenses are small text/data
  assets, well within the no-large-downloads constraint.

## Suggested first milestone for the next slot

1. Re-verify attribution presence in Terms + `SOUND_CREDITS` (quick, closes a
   legal risk).
2. Build a small frozen Sound-Engine clip set (single notes per instrument +
   chord + technique voice) with construction truth, and a node scorer that
   compares rendered output against reference spectra (reuse
   `scripts/lib/readWavPcm.mjs` and the Goertzel probe from
   `scripts/analyze-fine-pitch.mjs`).
3. Deterministic seeded convolver check (reverb regression).
