# Prereg: large-layout 1.3x Lanczos detect (G3 recovery, no training)

**Problem:** large-layout digits render SMALL (18.7px vs 24.2px
standard: "large" fits more music per page). Detector heat-dead
(median 0.18, 21% >=0.4). Downscale kills heat entirely; bilinear
upscale blurs to death. Sharp 1.3x Lanczos upscale: median 0.55,
84% >=0.4, 99% >=0.2 (Txo-large GT probe).

**Frozen design:** input resampling ONLY (weights, thresholds 0.4,
xclass, gate incl. v0.8 retry, veto, box medians all frozen).
`infer_page_merged(..., upscale=1.0)`: upscale u8 by Lanczos BEFORE
both passes when layout==large (1.3x); decode at scaled fx/fy; map
boxes back (/1.3). Drivers: `--upscale` on decode-eval/chain-eval/
transcribe (default 1.0; transcribe --layout large defaults 1.3).
Compact arm: same 1.3x measured (compact digits also small); applied
only if heldout-compact improves with precision loss <=5pts.

**Frozen splits:** TRAIN-fit selects (digit P/R per layout);
TRAIN-heldout verifies ONCE; DEV untouched (final wave if accepted).

**Baselines (frozen):** decode-eval-merged-large.json,
decode-eval-merged-compact.json (committed); heldout-large chains
(std map); transcription large (77 notes).

**Acceptance (per layout arm):** heldout digit recall up >=10pts AND
precision within 5pts of baseline AND transcription triple_ok does
not drop. Otherwise REJECT (keep native).

**Verdict (fit-select + heldout-verify done):**
- Large arm ACCEPTED: fit R 0.124->0.310 (P 0.156->0.324);
  heldout R 0.091->0.348 (P 0.226->0.390). Transcription Txo-large:
  77->296 notes, strings 100%, frets 99.3%, measures 6->33 and 100%
  matched; triple 0%->81.2%. All gates passed.
- Compact arm REJECTED (measured): fit R 0.799->0.527 with upscale
  (native kept; compact transcription already 91-93% triple).
- Follow-on (same session): digit-cluster fallback bar systems
  (band path untouched when TAB exists): tight inner spans for cover
  + min_cover 0.5 (short barlines). Without it large measures stayed
  at 6 (ownership soup); with it 33/33.

**Constraints:** no training; no sealed TEST; technique abstinent.
