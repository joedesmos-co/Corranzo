# Audio Vision — human-playable guitar arrangements

Research/fix only. No merge or deployment. Production model weights and
thresholds untouched.

## 1. Reproduced failure

The reported shape (string 1 fret 16 + string 6 fret 7, a nine-fret span) is
reproducible from the transcription side:

```
assignChordPositions(strings, [47, 80])  ->  47: string 6 fret 7
                                              80: string 1 fret 16   span 9
```

Root cause: `assignChordPositions` scored span as a **soft penalty** and then
fell back to a greedy assignment with **no hard span rejection**. `soloGuitar`
only emitted a `wide-stretch` warning and still wrote the shape into TAB.

## 2. Fix — a real playability model

New `src/features/audio-vision/guitarPlayability.js`:

- Standard tuning (string 1 = E4 … string 6 = E2), configurable fret count.
- Candidate string/fret positions per pitch.
- **Hard** constraints, never warnings: no two notes on one string; fretted
  span ≤ difficulty max (Beginner 3, Intermediate 4, Advanced 5); at most four
  fretted fingers (the lowest fret may barre); fret range check.
- Cost: span, finger count, hand travel, high-fret penalty, open-string bonus,
  melody near the top strings, bass near the bottom strings.
- Phrase-level hand anchor (`handFret`) carried between onsets; position jumps
  are tracked and reported.
- When a chord is physically impossible, notes are reduced by priority —
  **melody first, then bass, then harmony** — and every dropped note is
  returned (`droppedNotes`) and warned, never silently lost.
- `validateGuitarArrangement()` is an independent post-arrangement gate; its
  result is exposed as `playability` on the part and the pipeline result.

`soloGuitar.js` now uses this model for single notes and chords alike.

## 3. Before / after on real recordings (solo-guitar arrangement)

Eight guitar clips and six piano clips (piano arranged for guitar), same
transcription and grid:

| clip | OLD wide spans | OLD same-string | NEW wide | NEW violations | dropped |
|---|---|---|---|---|---|
| acoustic-jazz-dyad | 0 | 1 | 0 | 0 | 1 |
| acoustic-bossa-single | 0 | 1 | 0 | 0 | 0 |
| piano-mozart-dense | 0 | 1 | 0 | 0 | 0 |
| piano-schubert-single | 0 | 1 | 0 | 0 | 2 |
| acoustic-power-dense | 0 | 0 | 0 | 0 | 6 |
| (others) | 0 | 0 | 0 | 0 | 0 |

The old algorithm produced same-string conflicts on 4/14 clips; the new model
produces **0 validator violations** on all clips and discloses every dropped
note. The exact nine-fret case is now impossible by construction.

## 4. Tests (10 new)

`tests/audioVisionGuitarPlayability.test.js`:
- standard tuning order;
- the exact nine-fret report is rejected by `evaluateShape` and the validator;
- melody kept, unreachable bass dropped and disclosed;
- no two simultaneous notes on one string;
- dense piano-like chord reduced to a playable shape;
- open C and F-barre positives accepted;
- legitimate four-fret stretch accepted, five rejected;
- end-to-end `arrangeSoloGuitar` never exports a nine-fret grip;
- every emitted event has a valid string/fret;
- the full product pipeline exposes `playability` and `simplifiedNoteCount`.

All 205 Audio Vision tests pass.

## 5. Transcription vs arrangement (unchanged contract)

The faithful transcription is still `transcriptionEvidence` / the analysis
notes; the playable arrangement is `model.parts[0].events`. The new
`playability`, `droppedNotes`, and `simplifiedNoteCount` fields make every
simplification visible. Note corrections, undo/redo, MusicXML, playback and
practice targets are unchanged.

## 6. Remaining limits

- Barre handling is conservative (lowest fret counts as one finger); it does
  not model partial barres or thumb-over voicings.
- Finger conflicts across sustained notes are approximated by the hand anchor,
  not a full finger-assignment solver.
- No browser acceptance run was performed in this environment.

## 7. Reproduction

```bash
npx vitest run tests/audioVisionGuitarPlayability.test.js
node --expose-gc scripts/audio-vision-guitar-playability-eval.mjs
```

Artifacts: `src/features/audio-vision/guitarPlayability.js`,
`scripts/audio-vision-guitar-playability-eval.mjs`,
`reports/audio-vision-guitar-playability.md`.
