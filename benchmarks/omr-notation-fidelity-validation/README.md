# OMR Notation Fidelity — Real-Score Visual Validation Set

Manual / visual validation for **Notation Fidelity Sprints 1–2**.
Does **not** modify evaluator `2.0.0`, schema `2`, or the frozen semantic baseline.

## Failure layers

| Layer | Meaning |
| --- | --- |
| `undetected` | Symbol not found |
| `wrong-attachment` | Found but bound to the wrong note(s) |
| `emission` | Attachment OK but MusicXML wrong/incomplete |
| `renderer` | MusicXML OK but Visual Practice overlay wrong |
| `none` | Correct (TP/TN) |

## Display note

Corranzo’s primary score view is the **PDF**. MusicXML drives playback and
`visualNotationMarkings` overlays. Layer `renderer` applies to those overlays
(and any future engraver), not to the PDF ink itself.

## Sources

| ID | Path | Notes |
| --- | --- | --- |
| `piano-articulation-scan` | `benchmarks/omr-fixtures/piano-articulation-scan/` | Vendored CC0; ties/slurs/articulations |
| `gymnopedie` | `~/Downloads/gymnopedie-no-1-satie.pdf` | Clean engraved ties/slurs (local) |
| `minecraft` | `~/Downloads/beginner-minecraft-piano-themes-in-c-minecraft.pdf` | Real Corranzo listening piece (local) |
| `evangelion` | `~/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.pdf` | Dense real piece (local) |
| `minuet-clean-engraved` | `public/fixtures/demo-minuet-in-g.pdf` | Clean engraved renderer reference with mixed values, dots, beams, rests, and accidentals |

## Cases

Sprint 1 uses `cases.json`. Sprint 2 uses `sprint2-cases.json` (42 traced
PDF → candidate → event → MusicXML → renderer → playback cases). Re-run with:

```bash
npx vitest run tests/notationFidelitySprint1.test.js tests/notationFidelitySprint2.test.js
node scripts/notation-fidelity-probe.mjs
node scripts/notation-fidelity-sprint2-probe.mjs
```

## Rules

- Do not add these cases to `omr-benchmark.manifest.json` thresholds
- Do not hardcode fixture IDs / measures / pitches into recognition
- Do not disable uncertain marks globally to game the benchmark
- Frozen semantic corpus remains non-regression evidence only
