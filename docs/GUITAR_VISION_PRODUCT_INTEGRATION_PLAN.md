# Guitar fret V1: product integration plan (NOT merged — plan only)

Target: Corranzo product main `7348b699ac` ("Record Corranzo musician-UI
integration"). This branch (`codex/guitar-vision`) was NOT merged into main.
Nothing below performs a merge.

## Overlap / conflict check

Main contains no `tools/guitar-vision` (only `tools/barline-labeler`) and no
Python fret implementation — fret/guitar appear in main's docs as plans only.
**Zero file conflicts expected.** The integration is a pure addition of a new
subtree plus a published checkpoint artifact.

## Minimal coherent set (production runtime)

Package (new subtree, e.g. `tools/guitar-vision/python/guitar_vision/`):

- `inference.py` — `GuitarFretModel` loader + one-page inference contract
- `fret_experiments.py` — variant model incl. `DEDICATED_ROI_FRET`
- `roi.py` — canonical `sample_roi` + `RoiFretCnn`
- `model.py`, `dataset.py` (loader/collate), `qualify.py` (device)
- `quality_gate.py` — the V1 gate (stdlib only)

Tests:

- `test_quality_gate.py`, `test_dedicated_roi_production.py`,
  `test_production_inference.py`, `test_batch_invariance_known_bug.py`
  (the last documents the shared padded-plane bug as a known xfail)

Docs:

- `GUITAR_VISION_DEDICATED_ROI_BRANCH.md`, `GUITAR_VISION_QUALITY_GATE.md`,
  `GUITAR_VISION_BATCH_INVARIANCE_FIX_SPEC.md`

Explicitly OUT: all `h*.py` research harnesses, `scale_stress*` diagnostics,
`tmp/` reports, `datasets/` synthetic corpus, experimental head-only checkpoints.

## Artifact publishing (required before integration)

The validated checkpoint `tmp/gvprobe/dedicated-roi-production.pt`
(SHA `89093b66c19c75261056b74b1e574f4ca6e3de7be0b7cbf57c8fc30274701ce8`,
format `guitar-vision-dedicated-roi-v1`) currently lives in git-ignored scratch.
It needs a permanent versioned artifact home with that SHA pinned; the loader
already rejects anything that does not declare the format.

## Contracts that must travel with the code

1. One page per forward (`MultiPageBatchError`); the shared padded-plane softmax
   bug is unfixed by design — documented, xfailed, must not be "fixed" silently.
2. Gate thresholds are provisional (`fret-quality-gate/v1`); product must route
   them to future calibration, not hard-code as universal.
3. Runtime deps: torch, Pillow, numpy, CPU. Python package vs JS product boundary
   (service/CLI/wasm) is an open product decision — not made here.

## Suggested shape (for the integrator, not executed here)

1. Copy the package subset + gate + tests + docs to the agreed subtree.
2. Publish the checkpoint to the artifact store; point the loader at it.
3. Add a thin service/CLI boundary honoring the one-page contract and surfacing
   `PageGateReport` actions/messages to the musician UI.
4. Run the four test files green against the published artifact before wiring UI.
