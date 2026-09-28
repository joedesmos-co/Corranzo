# Guitar Vision — Pitch Contract (frozen)

**Status:** frozen. `guitar-pitch/1.0`.
**Authoritative module:** `src/features/omr/guitar/pitchContract.js`
**Conformance audit:** `node tools/guitar-vision/check-pitch-contract.mjs`
**Guards:** `tests/guitarPitchContract.test.js`, `tests/guitarPitchContractPipeline.test.js`

---

## The rule

For every Corranzo score:

> **`<pitch>` always holds the SOUNDING (concert) pitch.**

One meaning, no exceptions. Playback, score-following, Wait For You and Play Along
all read that one field, so it must not depend on a clef, a transpose block, or a
part-specific convention.

Three consequences follow, and all three are enforced by the validator:

1. A transposing instrument's octave is applied **exactly once**, when the note is
   emitted — never left for a reader to infer from a clef.
2. Guitar parts must **not** emit `<clef-octave-change>`. With a sounding pitch
   already stored, an 8vb clef subtracts the octave a second time.
3. Guitar parts must **not** emit `<transpose>`. The offset is already applied, so
   a transpose block would subtract it again.

`<string>` / `<fret>` must agree with the stored pitch:

```
sounding = tuning[string - 1] + fret + capoFret
```

A note that violates this is reported rather than silently trusted.

---

## Why this had to be frozen first

Guitar is engraved an octave above the pitch it sounds. Before this contract,
three components disagreed about what `<pitch>` meant:

| Component | Behaviour | Result |
|---|---|---|
| Emitter (`buildOmrMusicXml.js`) | wrote **written** pitch, tagged the clef `<clef-octave-change>-1</clef-octave-change>`, and hardcoded `octaveShiftSemitones = 0` | pitch left 12 semitones too high |
| Parser (`parseMusicXml.js`) | read `<pitch>`, **ignored** the clef octave change | treated written pitch as sounding |
| Practice-library truth | stored **sounding** pitch (octave range 1–5, no transpose, no clef change) | correct |

Measured consequence on 13 real guitar scores: mean pitch accuracy **5.7%**,
and on BWV 997 the delta histogram peaked at exactly **+12 semitones on 41% of
notes**. Because the parser drives playback, guitar playback was an octave sharp.
Because the emitted file carried a lowering clef with no `<transpose>`, the same
file sounded differently in a conformant reader than in Corranzo.

The existing test suite did not catch any of this. One test asserted the buggy
behaviour and passed.

---

## Evidence the contract matches reality

`node tools/guitar-vision/check-pitch-contract.mjs` over the whole repository:

```
guitar scores audited:  169
ground truth:           20 (0 non-conforming)
OMR-generated:         149 (143 non-conforming)
```

**All 20 ground-truth scores conform.** That is the check that matters: the
contract was derived from the corpus, not imposed on it. Every real and
synthetic guitar score already used sounding pitch with no transpose and no clef
octave change, so nothing in the labelled data needed to change.

The 143 non-conforming files are historical OMR outputs stored under `tmp/`.
Newly emitted scores conform, which the end-to-end tests assert.

---

## Effect of enforcing it

Same pixels, same detections, same recogniser — the corruption was on the way out.

| BWV 997 | Before | After |
|---|---|---|
| Pitch accuracy | 12.3% | **48.0%** |
| Pitch accuracy at correct onset | 15% | **64%** |
| Onset accuracy | 40.3% | **65.0%** |
| Note detection F1 | 80.3% | 83.0% |

**This is a fix to the measurement and to playback, not an improvement in
recognition.** It must never be reported as a model capability gain. The honest
statement is: the system can now see its own results.

---

## Implementation

`octaveShiftForNote(note, writtenOctaveOffset)` in `buildOmrMusicXml.js` computes
the per-note shift, and it deliberately subtracts any octave change the detector
already recovered from a printed 8vb clef:

```js
const detected = note?.pitchMapping?.clefOctaveChange
const alreadyApplied = Number.isFinite(detected) ? Number(detected) : 0
return (writtenOctaveOffset - alreadyApplied) * SEMITONES_PER_OCTAVE
```

This matters because `resolvePitchFromGrandStaff` already bakes a detected clef
octave change into `note.midi`. A note read from a printed treble-8vb clef is
therefore already sounding, and shifting it again would put it an octave low.
Guitar scores that genuinely change clef mid-piece are handled by the same rule.

Notes that are sounding by construction — TAB digits, which encode a physical
string and fret — set `soundingPitch` and are never shifted.

Piano is unaffected: `writtenOctaveOffset` is 0, so the shift is 0.

---

## Deliberately out of scope

- **Scordatura / alternate tuning** is a per-instrument chromatic offset and is
  not folded into this contract. It needs its own contract revision once real
  data exists; there is currently none (see the coverage report).
- **Printed staff position.** Because `<pitch>` is sounding pitch, a guitar score
  will *display* an octave lower than a typical engraving. That is a rendering
  concern to solve at draw time, not a reason to corrupt the pitch data.
- **Guitar's "written a major second above sounding"** relation. With a treble-8vb
  clef the note *name* is preserved and only the octave differs, which is how
  guitar music is actually engraved and how this repository's truth is encoded.
