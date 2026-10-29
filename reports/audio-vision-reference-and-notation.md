# Audio Vision — reference truth and user-facing notation quality

Research only. No main merge, deployment, or production model replacement.

## 1. Source-level reference validation

The full Vienna 4x22 source WAV/MIDI files are **not available locally**
(only the 3 s excerpts and the manifest are preserved). Independent
source-level verification of the Schubert offsets is therefore **not possible**
in this environment. The Mozart p01 drift is independently confirmed by the
model-free spectral-flux cross-correlation (consistent −0.70 s across all four
clips); the Schubert offsets remain **unresolved**.

Status of references:
- **Confirmed:** vienna-mozart-p01 ~0.5–0.7 s reference drift.
- **Unresolved:** vienna-schubert-p01, vienna-schubert-p02, vienna-mozart-p02
  (the model-free method is inconsistent within these performances).
- **Invalid/unusable:** `pause-mozart` has no notes; the four manifest-excluded
  clips remain excluded.

Raw labels are preserved; no correction is applied to the stored references.

## 2. Trustworthy evaluation set

Strict event scoring should use only validated timing. The reliable numbers:

| slice | metric | value |
|---|---|---|
| Acoustic guitar (raw, qualified) | strict F1 | 0.779 |
| Electric guitar (raw, qualified) | strict F1 | 0.708 |
| Piano raw (unverified timing) | strict F1 | 0.075 |
| Piano, Mozart p01 only (confirmed drift) | strict F1 | 0.41–0.61 |
| Piano pitch-only recall (within 1 s) | recall | 0.889 |

The 0.583 model-optimized aggregate is **in-sample and unverified**; it is not
held-out transcription quality and is not used as a headline.

## 3. User-facing notation improvement (implemented)

**Defect:** the Audio Vision MusicXML always emitted a C-major key signature
(`<fifths>0</fifths>`), forcing an accidental on every non-diatonic note. A
correct transcription in A major or F major was engraved as if it were in C,
which reads as wrong even when every pitch is correct.

**Fix:** `detectKeySignature()` in `arrangementMusicXml.js` estimates the key
from the duration-weighted pitch-class histogram using Krumhansl-Kessler
major/minor profiles and emits the corresponding `<fifths>` and `<mode>`.
Display-only: `<alter>` stays explicit, so sounding pitches, playback, and the
v3 editor are unchanged.

Validation on the reference pitch content:
- Mozart p01 → A major (fifths 3) — the actual key of K.331.
- Schubert p01/p02 → consistent per performance (0/-3).
- Solutions are stable within a performance.

Regression tests: `tests/audioVisionKeySignature.test.js` (6 tests: C major,
G major, F major, A minor, D minor, MusicXML emission).

## 4. Workflow audit (no further defect proven)

- The pipeline preserves notes through extraction → arrangement → MusicXML
  (transcribed ≈ arranged) on all sampled clips.
- No duplicate `(midi, onset)` events were found in the arrangement on the six
  sampled clips.
- `prepareEventsForNotation` is shared between engraving and preview MIDI, so
  displayed and sounded timing agree.
- Note corrections v3, undo/redo, and save/reopen paths are unchanged and
  covered by the existing test suite.

## 5. Honest limits

- The key-signature change improves readability, not pitch accuracy; it must
  not be presented as a transcription-accuracy gain.
- No browser runtime was available; UI acceptance was not re-run.
- Full source-file verification of the Schubert offsets is still required
  before any corrected aggregate can be called validated.

## 6. Reproduction

```bash
npx vitest run tests/audioVisionKeySignature.test.js \
  tests/audioVisionMusicXmlOutput.test.js \
  tests/audioVisionMusicXmlSemantics.test.js \
  tests/audioVisionPipeline.test.js
node scripts/audio-vision-independent-offset.mjs
```

Artifacts: `benchmarks/audio-vision/independent-offset.json`,
`piano-honest.json`, `reports/audio-vision-reference-and-notation.md`.
Disk 7.3 GiB. No downloads. Production weights and thresholds untouched.
