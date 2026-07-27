# OMR Dynamics — Real-World Validation Set

Manual / visual validation for Dynamics Recognition Sprint 1.
**Does not** modify evaluator `2.0.0`, schema `2`, or the frozen semantic baseline.

## Purpose
The enforced nine-fixture semantic corpus has no ground-truth dynamics.
This set holds representative pages for human-checked expected results.

## Required coverage (add PDFs + notes here as collected)

| ID | Content | Expected (manual) | Status |
| --- | --- | --- | --- |
| `dyn-p-mp-mf-f` | `p`, `mp`, `mf`, `f` | One mark each; correct staff/onset | placeholder |
| `dyn-pp-ff` | `pp` and `ff` | Both emitted; no duplicates | placeholder |
| `dyn-multi-system` | Multiple dynamics in one system | Separate measure associations | placeholder |
| `dyn-cresc-hairpin` | Crescendo hairpin | Wedge start/stop | placeholder |
| `dyn-dim-hairpin` | Diminuendo hairpin | Wedge start/stop; may span barline | placeholder |
| `dyn-midpiece-change` | Mid-piece dynamic change | Later measure onset, not broadcast | placeholder |

## Layout
Place each page under:

```
benchmarks/omr-dynamics-validation/<id>/
  <id>.pdf
  EXPECTED.md          # visual checklist + measure/staff/onset notes
  (optional) snapshot.png
```

## Rules
- Do not add these fixtures to `omr-benchmark.manifest.json` thresholds
- Do not change `semanticMusicXmlEvaluator.js` or `semanticEvalTolerances.js`
- Do not hardcode fixture IDs into recognition code
- Score with `omrDynamicsQuality.js` or manual review only

## How to review
1. Run OMR on the PDF
2. Inspect emitted `<dynamics>` / `<wedge>` in MusicXML
3. Compare to `EXPECTED.md`
4. Record TP/FP/FN in `tmp/dynamics-validation/` if needed
