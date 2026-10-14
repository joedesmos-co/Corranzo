# Sound Engine — handoff back to Score Following

**Date:** 2026-10-13
**Branch:** `codex/notation-aware-audio` (in `~/Documents/scoreflow-sound-engine`)
**State:** clean, pushed, no merge to `main`.

The Sound Engine slot is being returned to Score Following. This note says
what is done, what is deliberately not, and what the next slot should
pick up.

---

## Do this first when you come back

```bash
cd ~/Documents/scoreflow-sound-engine
git pull
npx vitest run tests/audioRender.test.js tests/playbackAcceptance.test.js \
  tests/samplePitchCoverage.test.js tests/sampleProvenance.test.js
```

## What is done

1. **Clean-electric guitar licence resolved.** The bundled set was a
   wrapper-repo redistribution whose originating owner (Karoryfer) could
   not be verified. Replaced with CC0-1.0 "Emilyguitar", provenance proven
   byte-identically, cross-origin fallback removed so the unverified set
   cannot silently return. Evidence in
   `docs/SOUND_ENGINE_RESEARCH.md` §3 and
   `tests/sampleProvenance.test.js`.

2. **Top-octave piano pitch corrected.** B7 and C8 emitted ~+150 cents
   because the bundled C8 sample is sharp and both derived from it. `C8` is
   now deliberately unmapped so they shift from A7; both land near +39
   cents. Full-compass emitted-pitch measurement is in
   `scripts/audio-render/pitch-compass.mjs`.

3. **Brightness-band inversion explained and rejected.** Root cause found
   (Tone's filter is a resonant 2-pole lowpass with a ~+2 dB peak; narrower
   cutoff = bigger boost, so soft bands were boosted more than loud ones).
   The approach is rejected and the baseline preserved. Both guitars and
   the whole piano compass are verified in tune.

4. **Listening handoff prepared.** `docs/LISTENING_HANDOFF.md` plus
   `play-examples.sh` (one Terminal command, ~8 minutes, 7 clips). **Nothing
   has been listened to and no acceptance is claimed.**

## What is deliberately NOT done — and why

The mission's stop condition was reached: objective defects closed, listening
handoff prepared. These are explicitly out of scope until a human has
listened:

- **Real velocity layers.** Requires per-band samplers. The physics is now
  safe (multiple samplers over the same buffers were measured
  *bit-identical*), and Emilyguitar has 4 CC0 layers available, but no one
  has heard the current voice yet, so a timbre change would be a guess.
- **Any per-band filter work.** Rejected on measurement in this workstream;
  Tone's filter gain response is not characterised well enough to change
  safely.
- **New effects / a larger synthesis architecture.**
- **Re-sourcing the Salamander set** (A7 is still ~+39 cents sharp,
  upstream and byte-identical to the CDN; the full set is 394 MB).

## If you have one hour and want to improve the sound

The single highest-value measured change available is **real velocity layers
on the clean-electric voice**, and it is now low-risk because the multi-sampler
path is proven identical. Steps are written out in
`docs/SOUND_ENGINE_RESEARCH.md` §11. Do it only after a listening pass —
otherwise you cannot tell whether it helped.

## Facts the next slot will want

- 88-key emitted-pitch compass: piano 21–100 within ±22 cents; top 6 keys
  +30…+39; acoustic guitar ±12; clean electric ±13.
- Piano dynamic span: **16.3 dB** (was 12.0 dB).
- Master-chain headroom: piano ~10 dB, 6-string guitar strum ~3 dB.
- Bundled samples are band-limited to ~4 kHz, so ff can get louder but not
  genuinely brilliant. No amount of filter work changes that.
