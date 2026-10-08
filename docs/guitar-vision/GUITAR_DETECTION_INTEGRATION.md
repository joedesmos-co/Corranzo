# Guitar End-to-End Detection Integration (G1–G10, no full training)

**Previous mission:** complete (geometry rescue, committed 7f635e2f0e).
**This mission:** GT boxes → automatic detection, end-to-end chain,
multi-layout, rhythm-graph truth. No sealed sets opened; no full training.

## 1. Detection architecture (G1)

Two systems measured: (a) classical CC (staff removal + components):
P 0.11 / R 0.17 — fragments and line-cut glyphs; (b) learned heatmap
TinyFCN (4 conv blocks, stride 8, Gaussian σ6 centers, object-centered
patches + foreground-weighted loss, 16 epochs, fixed seed): standard
P 0.27 / R 0.35 @0.3 (P 0.37/R 0.31 @8ep). Fixed median boxes from TRAIN.
Peak extraction with 3×3 NMS. No truth geometry at inference.

## 2–3. Detection P/R, TAB lines

Heatmap P/R above; CC retired with numbers kept. TAB lines: exact tier
0.971 @ 40%, anchored 0.79 @ 60% (prior mission, reused unchanged).
String attribution on detected digits via StringNet + geometry hybrid.

## 4–9. Chain, pitch, coverage, layouts

End-to-end on detected boxes (DEV): 277 matched digits → 138 decoded →
string/fret/both/pitch **0.81** (GT-box decoder was 0.924: detection
costs 0.11). Coverage bounded by detection recall. Layouts: compact
P 0.334/R 0.527 (best), standard 0.27/0.35, large 0.234/0.282, bravura
0.218/0.288 (65-score subset); chain pitch compact 0.70, large 0.51.
Translation: shifted boxes collapse to 9 digits (fragility confirmed).

## 10. Controls (G6/G10)

Blank pages: 0 digits, 0 decoded (no hallucinations). Shuffled
associations: pitch 0.81→0.14 (content-dependent). Head-level blank/
shuffled/wrong-crop from prior report stand. Real vs etude tiers
reported separately throughout.

## 11. Rhythm graph readiness (G5/G9)

Joins extended (additive): per-note stem boxes, beam ancestry ids,
dots counts, flag presence — validated corpus-wide: beams 2548/2548
groups exact, flags 16/16, stems 68% (chord-shared documented),
dots 56%. Tuplets: NO svg objects exist in this renderer (verified
absence) — tuplet truth stays symbolic (time-modification). No GNN
trained (as required). Object-graph proposal stands with validated
supervision for stems/beams/flags.

## 12–14. Reconstruction, tiers, techniques

Playable decoder unchanged in policy (τ=0.6/0.75, exact-geo veto);
technique heads remain abstention-only (schema≠model support);
STANDARD/TAB/paired classes preserved with relationships.

## 15–18. Decision

Remaining V1 blockers: detection recall (0.35), TAB-only real scores,
rhythm GNN build, real techniques (21 gaps stand). Scoped further
training JUSTIFIED for: detector capacity/data (heatmap underfits at
16ep) + string data. NOT justified: comprehensive training.
Next: preregistered detector-capacity run (wider net + real TAB volume)
and rhythm-graph build; technique/pairing heads abstinent.
