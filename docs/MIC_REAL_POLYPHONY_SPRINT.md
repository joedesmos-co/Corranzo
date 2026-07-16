# Corranzo Real Mic Polyphony Sprint

Date: 2026-07-15

## Scope

Sprint 2 lands a redistributable real-timbre mic corpus and developer capture tooling for polyphonic chord measurement. No live detector thresholds were changed.

## What shipped

- `scripts/import-uiowa-mic-fixtures.mjs` (`npm run mic:import-uiowa-fixtures`)
  - Downloads a small University of Iowa MIS piano/guitar subset
  - Extracts single notes and mixes dyads, triads, split-register, and rolled guitar chords
  - Writes WAV fixtures under `benchmarks/mic-accuracy/clips/` and `benchmarks/mic-polyphony/clips/`
  - Upserts labeled manifest entries with attribution and `sourceType: uiowa-mis-derived`
- `scripts/capture-real-mic-fixture.mjs` (`npm run mic:capture-real-fixture`)
  - Developer-gated (`CORRANZO_DEVELOPER_MODE=1`) live mic capture or `--from-wav` import
  - Writes WAV + compact replay trace and upserts the accuracy/polyphony manifest
- README updates for both mic suites

## Corpus added

| Suite | IDs |
| --- | --- |
| Accuracy | `uiowa-piano-mf-c4`, `uiowa-piano-pp-c4`, `uiowa-guitar-mf-g3` |
| Polyphony | `uiowa-piano-mf-c4-e4-dyad`, `uiowa-piano-mf-c-major-triad`, `uiowa-piano-pp-c-major-triad`, `uiowa-piano-mf-split-c3-e4-g4`, `uiowa-guitar-mf-adjacent-g3-b3`, `uiowa-guitar-mf-low-high-e2-e4`, `uiowa-guitar-mf-open-em-strum` |

Source license: University of Iowa MIS — freely redistributable without restrictions (`https://theremin.music.uiowa.edu/mis.html`).

## Measured results (no detector tuning)

### Accuracy replay

- Hit rate: **100%** (27/27 note clips)
- False positives: **0%**
- UIowa single notes all hit; guitar G3 also shows an octave-competitor frame (`wrong 89`) that does not prevent the expected 55 hit

### Polyphony replay

| Scope | V2 chord hit | V2 per-note | FP |
| --- | ---: | ---: | ---: |
| Phase 2B regression suite (synth + prior real) | 100% | 100% | 0% |
| Full suite including UIowa | 69.2% | 89.5% | 0% |
| UIowa guitar chords | 3/3 hit | — | 0% |
| UIowa piano simultaneous / split | 0/4 full hit | E4 (MIDI 64) consistently missed | 0% |

Root cause of the new piano misses: score-informed V2 already recovers C and G on simultaneous MIS piano mixes, but **E4 energy is masked/under-scored** under real acoustic piano timbre. This is a measurement finding for a later detector pass — not a reason to loosen gates or tune blindly.

## Explicit non-goals this sprint

- No changes to `pitchDetection.js`, stabilizer thresholds, or live Mic V2 runtime
- No WFY matching / MIDI / playback timing changes
- No OMR changes
- Generated `tmp/*` reports are not committed

## Verification

- `npm test`
- `npm run build`
- `npm run mic:accuracy-replay`
- `npm run mic:polyphony-replay`
- `npm run omr:benchmark-dashboard`
