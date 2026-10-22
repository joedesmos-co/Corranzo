# Musician review guide — Audio Vision solo arrangements

**Read this first.** These 42 MusicXML files were generated automatically from
legally usable corpus recordings (audio is *not* in this repo). They have been
checked mechanically — timing, playability, faithfulness — but **nobody has
listened to them yet**. Your ears are the missing evidence, and your verdict is
what gates V1.

## How to review (about 20 minutes)

1. Open a `.musicxml` file in MuseScore, Dorico, Finale or Guitar Pro (TAB is
   standard `<technical>` string/fret, so TAB-equipped readers show it).
2. Keep the matching recording open — its path and license are in
   `manifest.json` under `audioPath`.
3. Score each item **1–5** on the five questions below. Answers of "I can tell
   what song this is" and "I could play this on one guitar/one piano" are the
   two that matter most.

## The five questions (in priority order)

1. **Recognition.** Can you tell what the piece is, from the melody alone?
2. **Playability (guitar).** Can one guitarist play it? Look for awkward jumps
   between fret positions, stretches beyond 4 frets, and open-string/fret
   choices that fight the hand.
3. **Playability (piano).** Can two hands play it? Look for spans over an
   octave, LH lines stranded far from RH, and chords that need more than 5 fingers.
4. **Harmony.** Does it sound like the same piece's harmony, or like a
   different (but related) one?
5. **Difficulty ladder.** Easy should still be recognizable; Advanced should
   add real musical detail, not just more notes.

## Where to focus your limited time

- `five-piece-mix--*` (vocals, guitar, drums, bass, piano): the hardest case
  and the one flagged by our own uncertainty check (agreement 0.39). If this
  fails, the honest product answer may be a partial arrangement or a refusal —
  that is a valid outcome, not a bug.
- `mozart-trio-mix--solo-guitar--*` and `--solo-piano--*`: multi-instrument,
  moderately hard. Our melody checks score well here; you are checking whether
  "scored well" translates into something musical.
- `guitarset-comping--*`: chordal guitar; the place to judge chord grips.
- `guitarset-jazz-solo--*`: single melodic instrument; should be the cleanest.
- `chopin-nocturne--*`: real piano, our least reliable instrument; if this
  sounds wrong, say so plainly — we would rather know.

## What our numbers mean (and don't)

- `conf` is evidence-based confidence (onset/tempo/chord evidence, density,
  melody share, and agreement with an independent model-free check). It is not
  a claim that the arrangement sounds good.
- `agreement` is how often our second, model-free transcriber heard the same
  pitches. High agreement means two methods agree — not that both are right.
- `uncertain` counts 2-second passages where the two methods disagreed. Those
  are the moments most worth your ears.
- `notes` counts arranged notes; a higher number is not better.

## Reporting back

Please annotate `manifest.json` with a per-variant `review: { score, comment }`
(or send notes in any form). If a variant is unplayable or unrecognizable, the
exact file name is enough for us to reproduce the investigation.

## Licensing (do not redistribute these recordings)

- TRIOS items — CC BY-NC-SA 2.0 UK, local evaluation only.
- GuitarSet items — CC-BY-4.0 (Xi et al., ISMIR 2018).
- Chopin — public-domain recording (Luke Faulkner via Musopen).
- five-piece-mix — CC BY-NC (ccMixter, Radioontheshelf feat. Spinningmerkaba),
  local evaluation only, **not a commercial asset**.
