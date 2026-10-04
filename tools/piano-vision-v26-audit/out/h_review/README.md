# Structural correspondence review packet

You are adjudicating **whether a printed PDF measure and a MusicXML/Verovio measure
are the same music and whether their printed events correspond**. You are NOT judging
pitch, and nothing about pitch is shown to you.

## What is in each item

Each review item is **one mapped measure on one staff**.

* **LEFT — PDF raster.** The actual page image crop for that measure, with machine
  proposals labelled `P1, P2, ...`.
* **RIGHT — source structure.** The same measure rendered from the Verovio layout as
  **staff lines and notehead positions only**. No note names, no MIDI, no stems, no
  glyphs. Onset groups are labelled `X1, X2, ...`.

The two panels are drawn at different scales and are **not x-aligned**: the PDF and
Verovio engrave the same music with different spacing. Judge **counts, order and
cardinality**, never horizontal alignment between panels.

## Important caveat about the `P` labels

The `P` labels are **machine proposals from an unreliable raster detector**. That
detector was measured at roughly 0.22 precision on general notation. So expect:

* `P` labels on things that are not noteheads (clefs, time signatures, rests,
  accidentals),
* printed noteheads that carry **no** `P` label at all.

**Trust your eyes over the `P` labels.** If you see a printed onset that is not
listed, record it in the notes field for that item.

## Questions per item

**A.** Are the PDF and the source the same printed measure? `YES` / `NO` / `UNSURE`

**B.** For each source onset `Xn`: is it printed in the PDF?
`PRINTED_IN_PDF` / `NOT_PRINTED_IN_PDF` / `UNSURE`

**C.** For each PDF proposal `Pn`: does it match a source onset? Choose the `Xn` it
matches, or `NO_COUNTERPART`, or `UNSURE`.

**D.** Where onset correspondence is established, does notehead cardinality agree?
`YES` / `NO` / `UNSURE` / `N_A`

**E.** Your confidence in this item: `HIGH` / `MEDIUM` / `LOW`

Then, **only for items where you set E = HIGH**, the notehead second pass opens:
each matched onset pair is shown zoomed with noteheads numbered vertically
`P1a, P1b, ...` against `X1a, X1b, ...`. Decide whether top maps to top, second to
second, and so on, or mark the group `AMBIGUOUS`.

## How to use the HTML tool

Open `review.html` in any browser. It is fully local: no server, no network, no
install. Answers autosave to the browser, so you can stop and resume. Use
**Export JSON** when finished; save the file next to this README as
`review_answers.json`.

The PNG sheets in `sheets/` show the same items if you would rather work in an image
viewer; in that case record answers in any format that keeps the `item_id`.

## What happens next

Your answers are used to build a **structurally frozen correspondence manifest**
before any pitch or residual is inspected. Only after that freeze is anything
computed about pitch agreement. Proven source disagreements will be **refused, never
relabelled**.

## Do not

* judge pitch, name notes, or infer octave;
* consult any corpus residual, `d0`, `true_d` or decoder output while reviewing;
* assume the `P` labels are correct.
