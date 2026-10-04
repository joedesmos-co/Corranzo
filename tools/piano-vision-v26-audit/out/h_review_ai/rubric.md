# Structural correspondence rubric (blinded)

You are judging **printed structure only**: whether two renderings show the same
music, and whether their printed note events correspond. You are NOT judging pitch
and you must not name notes, octaves, or MIDI numbers.

## What you see

Each item is one image with two panels:

* **LEFT — PDF raster.** The printed measure from a scanned music page.
  Vertical red lines labelled `P1, P2, ...` are **machine proposals only**. They are
  an unreliable pre-annotation. Expect them to be wrong in both directions:
  * some `P` marks sit on things that are NOT noteheads — clefs, key signatures,
    time signatures, rests, accidentals, articulations, stems, beams;
  * some genuinely printed noteheads carry **no** `P` mark at all.
* **RIGHT — source structure.** The same measure redrawn from an independent
  engraving as **five staff lines plus notehead outlines only**. No note names, no
  stems, no beams, no glyphs. Vertical blue lines labelled `X1, X2, ...` mark the
  source note events.

The two panels are drawn at different scales and are **not horizontally aligned**.
Judge counts, order and cardinality — never horizontal alignment between panels.

## Rules

1. Trust your eyes over the `P` marks.
2. Be **conservative**. If a structural match is not visually clear, answer
   `UNSURE`. Never force a one-to-one match.
3. If you can see a printed note onset in the PDF that carries no `P` mark, record
   it as an unlisted visible onset in `unlisted_visible_onsets` rather than
   pretending it does not exist.
4. Do not identify pitch in any form.

## Questions

**A — same printed measure?** `SAME` / `NO` / `UNSURE`

**B — for each source onset `Xn`: is it printed in the PDF?**
`PRINTED` / `NOT_PRINTED` / `UNSURE`

**C — for each PDF proposal `Pn`: which source onset does it correspond to?**
An `X` id (e.g. `X2`), or `NO_SOURCE_COUNTERPART`, or `UNSURE`

**D — for onsets you matched, does notehead cardinality agree?**
`YES` / `NO` / `UNSURE`

**E — structural confidence in this item** `HIGH` / `MEDIUM` / `LOW`

**Second pass (only if E = `HIGH`)** — for each onset pair you matched, decide
whether the visible noteheads pair by vertical structural rank (top↔top,
second↔second, …):

* `RANK_OK` with an explicit mapping, e.g. `{"P1a":"X1a","P1b":"X1b"}`
* or `AMBIGUOUS`

Letter noteheads within an onset top-to-bottom: `P1a` is the top visible PDF
notehead in onset `P1`, `X1a` the top source notehead in `X1`.

## Output

Return one JSON object per item:

```json
{"item_id":"R001",
 "A":"SAME",
 "B":{"X1":"PRINTED","X2":"NOT_PRINTED"},
 "C":{"P1":"X1","P2":"NO_SOURCE_COUNTERPART"},
 "D":"YES",
 "E":"HIGH",
 "unlisted_visible_onsets":["between P4 and P5"],
 "second_pass":{"P1":{"verdict":"RANK_OK","map":{"P1a":"X1a","P1b":"X1b"}}}}
```

Omit `second_pass` unless `E` is `HIGH`. Use `UNSURE` freely.