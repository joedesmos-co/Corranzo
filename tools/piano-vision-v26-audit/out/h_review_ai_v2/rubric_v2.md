# Structural correspondence rubric - V2 (blinded, pitch-scrubbed)

You judge **printed structure only**. Never name a note, octave or accidental value,
and be aware that no pitch-bearing field of any kind is shown to you.

## The two panels

* **LEFT - PDF raster.** The real printed measure from a scanned page. Thin red
  vertical lines labelled `P1, P2, ...` are **machine proposals from an unreliable
  detector**. Expect them on clefs, key signatures, time signatures, rests,
  accidentals, articulations, stems and beams, AND expect genuinely printed
  noteheads that carry no `P` label. **Trust your eyes, not the labels.**
* **RIGHT - SOURCE rhythm skeleton.** The same measure engraved from the source
  MusicXML **with every pitch canonicalised away**. Each notehead's vertical
  position is a neutral slot determined ONLY by how many notes are in that chord:
  one note sits centred, two notes sit one slot apart, three notes spread over
  three slots, and so on. So the right panel shows **rhythm, onset order, chord
  cardinality, stems, beams, flags, rests, dots, tuplets, barlines and meter** -
  and deliberately shows nothing about which pitches the source actually has.

The panels are **independently laid out and not horizontally aligned**. Judge
sequence and rhythm, never pixel alignment.

## Questions

**A - does the rhythmic / onset structure on the right plausibly correspond to this
PDF measure and staff?** `SAME_STRUCTURE` / `DIFFERENT_MEASURE` / `UNSURE`

A is about *structure*, not about every individual event matching. A single extra or
missing note does **not** by itself make A `DIFFERENT_MEASURE` - that is what
questions B and C are for. Use `DIFFERENT_MEASURE` when the overall rhythmic shape
does not correspond at all.

**B - for each source onset `Xn`: is that event printed in the PDF?**
`PRINTED` / `NOT_PRINTED` / `UNSURE`

**C - for each PDF proposal `Pn`: which source onset does it correspond to?**
an `X` id, or `NO_SOURCE_COUNTERPART`, or `UNSURE`

**D - for onsets you matched, does notehead cardinality agree?**
`YES` / `NO` / `UNSURE`

**E - structural confidence** `HIGH` / `MEDIUM` / `LOW`

**Second pass, only if E = HIGH.** For each matched onset pair, decide whether the
visible noteheads pair by vertical structural rank, top to top:

* `RANK_OK` with an explicit map, e.g. `{"P1a":"X1a","P1b":"X1b"}`
* or `AMBIGUOUS`

## Be conservative

Prefer `UNSURE` over a forced match. Never invent a one-to-one mapping to fill C.
If a printed onset is clearly visible but carries no `P` label, list it in
`unlisted_visible_onsets` rather than ignoring it.
