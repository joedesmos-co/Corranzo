# Guitar First Supervised Proof (G0–G8, no full training)

**Artifacts:** `datasets/guitar-vision/proof/` (model, history, DEV metrics,
causal controls, reconstruction, crop summary — no sealed data, no crops)
**Code:** `proof-build-crops.py`, `proof-raster-hires.mjs`, `proof_train.py`,
`proof-eval.py` (renamed to valid module name during this task)
**Crops:** staging only (`/tmp/proof`, 31,080 crops, regenerable, NOT committed)

## 1. Reconciled dataset counts (G0)

PDMX 51 real (18/13/15/5) + v2 60 samples (12 real + 48 etudes; 5 synthetic
excluded from splits) + v2-pilot historical. Zero sample overlap between
PDMX and v2 systems. Proof TRAIN 47 scores / DEV 31 scores (train+validation
only, both systems). Heldout/diagnostic, v2-pilot work, and the fret
benchmark never read (asserted in the crop builder; heldout-overlap check
passes).

## 2. Exact training population

21,245 train crops / 9,835 DEV crops from joined boxes (standard-layout
hires staging rasters, 2.45× real detail). 111 ink/mapping quarantines +
406 TAB-mirror boxes recovered via recorded pairings. Masked-measure rows
keep object/pitch/string/fret loss, drop rhythm/voice loss. Box-masked
duplicates excluded from crops.

## 3. Architecture (G3)

Branch N (notation, trunk 32/64/128 + heads family/pitch/duration/dots/
voice/technique-presence) + Branch T (TAB digits, DEDICATED 16/32/64 trunk
+ string/fret heads). No shared trunk across notation/TAB per the fret
lesson. Technique families schema-only. Detection out of scope (GT boxes).

## 4. Supervised heads (G1)

family, midi, duration, dots, voice, technique-presence, string, fret.
TAB rows oversampled ×8 deterministically (4% of data; without it the fret
head sits on majority forever — data-scarcity finding, not tuning).

## 5. Training curve (G4: 12 epochs, MPS, fixed seed, frozen TRAIN only)

loss 9.34→2.62. DEV: family 0.952→0.994, fret 0.267→0.909 (from epoch 2),
string 0.338→0.430, midi 0.084→0.299, duration 0.368→0.439, voice
0.668→0.795. No sweep, no test inspection.

## 6. DEV metrics (G5)

family 0.994 (real 0.9936, etude 1.0) · fret 0.909 (real 0.910) · voice
0.795 · duration 0.439 (majority 0.423 — weak) · midi 0.299 (128-way) ·
string 0.430 (6-way) · dots 0.967 · tech-presence at majority (uninformative).

## 7. Real vs etude

Etude DEV supports tiny (116 family / 26 fret rows); real dominates.
No claim that etude accuracy generalizes — tiers reported separately.

## 8. Standard vs TAB

Family head on note/rest/tabdigit rows; TAB-digit branch evaluated on
637 DEV digit rows. Layouts: standard-layout hires only (compact/large/
Bravura joins exist in truth but were not cropped — report gap, not a claim).

## 9. Fret performance

0.909 with deterministic ×8 oversampling; 0.267 without (majority
collapse). Verdict: learnable, data-starved — needs real TAB volume.

## 10. Rhythm performance

Duration 0.439 (7 classes, barely above majority 0.423); dots 0.967;
voice 0.795. Rhythm needs bar-level context, not 64px crops — expected,
recorded as architecture evidence for sequence heads.

## 11. Pairing performance

Digit-implied pitch matches true midi on 39.4% (251/637) — tracks string
accuracy (0.43); measure-level same-string conflicts predicted 373 vs true
367 (distributionally matched, not exact).

## 12. Technique support

Schema-only (binary presence head uninformative at 0.993 majority).
No technique-family claims. Etude supervision exists for future heads.

## 13. Causal controls (G6)

Blank→majority (0.848 = marginals: pixel-dependent) · shuffled labels
frozen at majority/chance on every head (family 0.848 vs 0.994, midi 0.069
vs 0.299, voice 0.668 vs 0.795) · wrong-crop mapping below majority
(family 0.734, fret 0.165) · majority floors recorded. The model reads
pixels and label associations, not geometry or order.

## 14. Playable reconstruction (G7)

Per above: isolated glyph accuracy (family 0.994) does NOT yet compose
into correct playable music (digit pitch 0.394). Uncertainty (string
0.43) is the bottleneck — reported, not hidden.

## 15. Remaining data gaps

Real TAB volume (string/fret), real techniques, TAB-only class, duration
context, multi-layout crops in training.

## 16. CASE A/B/C (G8)

CASE A for a scoped object-recognition experiment (family/fret/voice
learn and generalize on DEV). NOT for techniques, pairing, or rhythm
sequence modeling. Comprehensive Guitar Vision is NOT ready.

## 17. Larger training justified

Scoped yes: detection + classification + TAB digits with more real TAB,
same two-branch discipline. Full 115-family training: no.

## 18. Next step

Preregister the scoped experiment (frozen splits, seed, head set, DEV
gates: family ≥ 0.99, fret ≥ 0.90 with ≤×4 oversampling, voice ≥ 0.80)
before running it; keep technique/pairing heads abstinent until real
supervision lands. Then CASE-A re-evaluation for rhythm context heads.
