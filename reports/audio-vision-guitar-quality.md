# Audio Vision — guitar playability quality (not just validator success)

Research/fix only. No merge or deployment. Model weights and thresholds untouched.

## Resource recovery

Disk was 3.3 GiB. Cleared the npm cache and the Vite cache (both
regenerable) — no recordings, user files or research evidence removed.
Disk is now 5.4 GiB, above the 5 GiB floor.

## Priority 1 — musical preservation (OLD vs NEW, 12 real clips)

Same transcription, same quantized grid; OLD = per-onset `assignChordPositions`,
NEW = `arrangeSoloGuitar` with the playability model.

| metric | OLD | NEW |
|---|---|---|
| Melody (top note) preservation | **1.000** | **1.000** |
| Bass (lowest note) preservation | 0.667 | **0.667** |
| Note retention | 0.953 | **0.950** |
| Chroma similarity to input | 0.988 | **0.999** |
| Validator violations | 4 across 12 clips | **0** |

The new arrangement does **not** pass by dropping the music: melody is fully
preserved, bass is unchanged, note retention is within 0.3 %, and chroma
similarity is slightly better. Only the physically impossible notes are
reduced, and every reduction is disclosed (`droppedNotes`).

Artifact: `scripts/audio-vision-guitar-preservation.mjs`.

## Priority 2 — full fingering and transitions

`guitarPlayability.js` now also provides:

- `assignFingers()`: finger 1 on the lowest fret (a barre when it covers 2+
  strings), fingers 2–4 on the remaining distinct frets, open strings = 0,
  hard failure when more than four fingers are required.
- Barre/partial-barre provenance (`fret`, `strings`, `from`, `to`, `partial`).
- `analyzeGuitarTransitions()`: hand-jump and fast-shift detection using real
  beat duration, plus same-string overlap detection (a new pitch on a string
  still sounding an older one).
- `fingerArrangement()` attaches `finger` (and `barre`) to every emitted event.
- `validateGuitarArrangement()` now reports shapes, finger feasibility and
  transitions, and treats finger-infeasible shapes as violations.

## Priority 3 — difficulty

Easy / Intermediate / Advanced keep distinct hard spans (3 / 4 / 5) and voice
budgets. A new test confirms Easy emits no more notes than Advanced on the same
dense input and both pass their own span gates.

## Priority 4 — export correctness

New test builds MusicXML from a guitar arrangement and parses it back: the
notation staff carries exactly the arranged `midi`/`string`/`fret`. The preview
MIDI shares `prepareEventsForNotation`, so playback and engraving agree. Note
corrections remain removal-only (v3), so editing cannot re-introduce an
invalid fingering. The faithful transcription stays in
`transcriptionEvidence`; the playable arrangement is `model.parts[0].events`.

## Priority 5 — acceptance status

This is an algorithmic and export audit, not human acceptance. Twelve real
clips (six guitar, six piano-as-guitar) were measured end to end, but
full-length songs and an independent guitarist's review are still required
before calling an arrangement genuinely playable. The validator and preservation
metrics are necessary evidence, not a substitute for that review.

## Remaining limits

- Barre handling is conservative (lowest fret = one finger); no partial-barre
  thumb-over voicings.
- Sustained-note finger conflicts are reported, not solved by a full
  finger-assignment search across time.
- Repeated-passage fingering consistency is provided by the hand anchor, not a
  memorised pattern library.
- No browser acceptance run in this environment.

## Tests

`tests/audioVisionGuitarPlayability.test.js` now has 16 tests: nine-fret
rejection, melody-first reduction, same-string conflicts, dense-chord
reduction, open C, F barre, four-fret accept / five-fret reject, finger
assignment, barre detection, open strings unfingered, five-fret infeasibility,
hand jump, same-string overlap, difficulty differences, end-to-end pipeline
disclosure, and MusicXML export consistency.

All 211 Audio Vision tests pass.

## Reproduction

```bash
npx vitest run tests/audioVisionGuitarPlayability.test.js
node --expose-gc scripts/audio-vision-guitar-preservation.mjs
node --expose-gc scripts/audio-vision-guitar-playability-eval.mjs
```
