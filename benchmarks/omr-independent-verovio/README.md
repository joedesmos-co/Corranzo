# Independent engraver fallback fixtures

These are cross-engraver evaluation inputs, kept separate from the historical
and corrected SMuFL corpora:

- MusicXML: the CC0 reference from `benchmarks/omr-fixtures-corrected`.
- PDF: independently engraved with **Verovio 6.3.0** (default font) and printed
  to PDF with Chromium. The PDFs do not expose a SMuFL notehead text layer.

They cover grand-staff voices, ties/slurs and accidentals (grand), tuplets/dotted
rhythms/rests (rhythm), and a hand-authored pickup measure, cross-staff note,
tie, slur, key signature and differing rest values (pickup-crossstaff). They are not a held-out composition
corpus; they test cross-engraver behavior separately from accuracy on the
SMuFL benchmark family.

The Piano vector recognizer must abstain (`route=image`, no notes) rather than
invent notes from the path-only engraving; standard image fallback remains the
only supported route for these inputs.
