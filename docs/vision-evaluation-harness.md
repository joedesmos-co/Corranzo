# Vision musical evaluation harness (2026-10-26)

## Purpose

One documented matcher for Piano acceptance. Historical, corrected and
cross-engraver inputs are reported separately; results are never mixed without
their corpus label.

## Command

```bash
# Historical corpus, current production core
node scripts/vision-piano-reference-eval.mjs --json out.json

# Corrected corpus, current production core
VISION_LABEL=corrected-production \
VISION_FIXTURES=benchmarks/omr-fixtures-corrected \
node scripts/vision-piano-reference-eval.mjs --json corrected.json

# A pinned research core against the same inputs
VISION_LABEL=corrected-candidate \
VISION_FIXTURES=benchmarks/omr-fixtures-corrected \
VISION_CORE=tmp/piano-b4.mjs \
node scripts/vision-piano-reference-eval.mjs --json candidate.json
```

The report includes `label`, `fixturesDir`, `core`, per-fixture metrics and an
aggregate.

## Matcher

The canonical matcher reads raw MusicXML directly; it does not use
`parseMusicXml`, which normalises tuplets/dots and loses one exact event.

- Measure identity: MusicXML `measure@number` (1-based), not array index.
- Written duration: `<duration>` divided by the inherited `<divisions>`,
  reduced fraction.
- Dots: `<dot>` count.
- Pitch: MIDI from `<step>/<alter>/<octave>`.
- Notes: multiset keyed by `(measure, midi, written-duration, dots)`.
- Rests: multiset keyed by `(measure, written-duration, dots)`.
- Pitch-only: multiset keyed by `(measure, midi)`.
- Duration-only: multiset keyed by `(measure, written-duration, dots)`.
- Full event: notes + rests pooled; precision/recall use the same matched
  counts.
- Measure validity: the recognizer's own `badMeasures`; `validMeasures` is
  reported separately and is **not** used to inflate note counts.
- `abstained` is true when the vector route produced no notes.
- `practiceReady` is the core's gate at evaluation time; a true value is not
  proof of musical correctness.

Mirrored TAB staves are outside this Piano matcher. Guitar evaluation uses the
TAB event stream and must deduplicate staff representations before counting
distinct events.

## Historical vs corrected inputs

| corpus | core | notes | rests | pitch | duration | full event | practice-ready |
|---|---|---:|---:|---:|---:|---:|---|
| historical | production | 306/447 | 3/6 | 325/447 | 390/447 | 309/453 | 0 |
| historical | `b4f6` candidate | 377/447 | 5/6 | 378/447 | 408/447 | 382/453 | grand only |
| corrected | production | 307/447 | 6/6 | 325/447 | 391/447 | 313/453 | **0 after voice gate** |
| corrected | `b4f6` candidate | 378/447 | 6/6 | 378/447 | 409/447 | 384/453 | beginner, rhythm, grand |

The corrected PDFs change the printed notation (quarter-rest glyph and
dotted/tuplet flags) while keeping the same reference MusicXML. They are not
interchangeable with the historical corpus: the corrected beginner goes from
0/1 to 1/1 rests, and production note exact matches move 306→307. The research
report’s “377” is the historical candidate total; the corrected candidate total
is 378/447 under this matcher.

## Corrected PDF semantic checks

- Beginner PDF text layer has one **quarter** rest (`U+E4E5`), matching one
  quarter rest in the reference; it no longer contains the eighth-rest glyph.
- Rhythm PDF text layer has 5 rests (quarter×2, eighth, 16th, whole), matching
  the five reference rests.
- Grand PDF has no rests, matching the reference.
- The corrected candidate reaches 63/63 rhythm notes and 5/5 rests; this is a
  real improvement over production’s 45/63 and confirms the flag repair was
  not merely a checksum change.
- The same reference MusicXML is used; no truth metadata is exposed to the
  recognizer.

## Independent engraver

`benchmarks/omr-independent-verovio/` contains MusicXML rendered by **Verovio
6.3.0** (independent engraver/font) and printed through Chromium:

- grand voices/ties/slurs/accidentals;
- rhythm tuplets/dotted notes/rests;
- hand-authored pickup, cross-staff note, tie, slur, key signature and mixed
  rest values.

These PDFs have no SMuFL notehead text layer. The Piano vector recognizer
returns `route=image`, `notes=0`, `practiceReady=false`; the standard image
fallback remains the only supported route. This is an honest cross-engraver
**abstention**, not an accuracy success.

## Integration-owned adversarial corpus

`scripts/vision-piano-adversarial-audit.mjs` runs synthetic IR controls against
any core:

```bash
node scripts/vision-piano-adversarial-audit.mjs
VISION_CORE=tmp/piano-b4.mjs node scripts/vision-piano-adversarial-audit.mjs
```

Current production (after voice-ownership hardening): **10/10 refused**.
`b4f6` candidate: **6/10 refused**, with false acceptance for same-staff
incomplete voices, equal-pitch short slur, cross-voice curve and decorative
short curve.

The production gate now requires `voiceOwnership === 'verified'`; staff-only
ownership can never make a score practice-ready. This deliberately leaves all
currently extracted Piano scores preview-only until independent voice evidence
exists.

## Independent engraver image fallback — measured

`scripts/browser-independent-engraver-fallback.mjs` uploads the Verovio PDFs
through the standard product import, opens the score and compares the saved
MusicXML with the reference. Fallback routing is treated as executable only if
the workspace and XML exist; it is not treated as success by itself.

| fixture | reference notes | generated notes | exact notes | full precision | full recall | rests |
|---|---:|---:|---:|---:|---:|---:|
| grand-voices | 88 | 63 | 15 | 0.238 | 0.170 | 0/0 |
| rhythm-tuplets | 63 | 83 | 3 | 0.036 | 0.044 | 0/5 |
| pickup-crossstaff | 11 | 16 | 0 | 0 | 0 | 0/2 |

All three produced a visible PDF workspace and parseable MusicXML, with no
console errors. The product fallback is therefore **executable**, but it
produced plausible MusicXML with incorrect events; it did not abstain. This is
a real image-OMR quality blocker, not a passing fallback result. No image
recognition architecture was changed in this round.

## Round-7 voice and fallback evidence

The expanded adversarial corpus now has **15** controls (voice ownership,
curves, rests, accidentals, pages). Current production refuses **15/15**.
`d9680e5703` refuses **8/15**; false acceptances include matching-stem voices,
one-voice/opposite-stem promotions whose ownership is still `staff-only`, and
the three curve cases. A synthetic `3` marker near four notes is also grouped
as a tuplet by the candidate; the grouping limits are better but not independently
proven.

The independent-engraver fallback harness is
`scripts/browser-independent-engraver-fallback.mjs`. The real product fallback
is executable but musically wrong; see the table above. This is recorded as an
image-OMR quality blocker, not as a successful transcription.
