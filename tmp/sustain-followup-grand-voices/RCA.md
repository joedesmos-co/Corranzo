# Grand-voices missing-tie RCA

## Truth
- Measure 3 beat 4: A4 (midi 69) `tie type=start`
- Measure 4 beat 4: A#4 (midi 70) `tie type=stop`
- Musically invalid: ties require identical pitch; start/stop differ by a semitone.

## Recognition
- No SMuFL tie/slur control glyphs in PDF text layer (`tieControlGlyphCount: 0`).
- `applyVectorPageTies` refuses cross-measure ink arcs (glyph-only by design after Sustain Sprint 2).
- Direct `detectInkArcBetween` / corridor probes between m3 A4 and m4 A4 also find no usable arc.
- Stop note is recognized as A4 (69), not A#4 (70); no sharp glyph near that head.

## Staff emission
- Grand-staff `<staff>` tags did not drop a previously detected tie — `detectedTieCount` was already 0.

## Verdict
Not a staff-association or start/stop pairing bug from Pitch Sprint 1.
The visual tie is not recoverable with current glyph/ink evidence, and the truth encodes a pitch-changing tie.
**No general recognition fix is justified** without inventing ties or fixture-specific logic.

## Recommendation
Document as residual latent FN; leave Sustain mean at 66.7% with accepted measurement exposure.
Proceed to Pitch Sprint 2 (incorrect-pitch taxonomy), including the A4 vs A#4 substitution on this stop note.
