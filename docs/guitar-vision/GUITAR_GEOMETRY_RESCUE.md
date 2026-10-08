# Guitar TAB Geometry Rescue (G1–G10, no large training)

**Prereg deviations:** none in thresholds. Correctives (documented):
vertical-bin pooling, LR 1e-3, box-relative framing, oversample ≤×4 —
no sweep, budgets held (StringNet 3×8ep, rhythm 2×8ep, controls 4ep).

## 1. Geometry abstention root causes (G1, TRAIN autopsy, n=910)

- foreign-comb 95%: a regular 6-run exists but the digit isn't on it —
  competing regular structures (adjacent systems, slurs, beams) win.
- few-peaks 4%: faint/broken lines. anchor-miss 1%. No skew/perspective
  cases (rendered corpus); low-resolution is the binding constraint
  (digits ~10px at 1050w; proof uses 2.45× hires staging).

## 2. Six-line detection (G2, image pixels only)

Two tiers, calibrated on TRAIN, frozen before DEV: exact (6 observed
peaks + digit anchor): 619 rows, 0.971 agreement. Anchored comb
(digit-constrained ink search): 924 rows, 0.792 agreement. Combined
coverage 99.7% (4 abstentions). Never uses MusicXML labels or truth
coordinates; outputs positions + confidence + ordering.

## 3–5. String attribution (G3)

DEV string: isolated 0.430 → context 0.639 → geometry:
exact 0.971 / anchored 0.792 / blended 0.820. Neural-only 0.639;
geometry-only 0.820 blended (0.971 exact @40%).

## 6–8. Hybrid + pitch + coverage (G4, G7)

Tier-weighed decoder (τ=0.6, gray zone to 0.75, exact-geometry veto):
303/637 decoded (coverage 0.476), pitch precision 0.924
(prereg gate: ≥0.90 at ≥0.50 — precision EXCEEDED, coverage MISSES by
0.024; thresholds not lowered to pass). Jitter flip 0.28 (was 0.30).
Fret 0.909 held. Real/etude tiers unchanged from prior report.

## 9. Jitter robustness (G5)

0.30→0.28. Translation sensitivity persists (line-relative reasoning is
brittle at 10px digits); recorded as an architecture limitation, not
averaged away. Multi-layout training crops remain future work.

## 10–11. Real/etude/multi-layout, predicted boxes

Unchanged tiers; standard-layout hires only. No box predictor exists —
GT-box evaluation only; detected-box evaluation is a separate blocker,
reported honestly (detection integration is the CASE-A scoped experiment).

## 13. Rhythm object-graph proposal (G9, design only)

Inputs: detected primitives (noteheads, stems, beams, flags, dots, rests,
tuplet brackets, barlines) with boxes. Edges: stem-of-notehead,
beam-joins-stems, flag-on-stem, dot-of-note, bracket-spans-notes,
same-measure, same-onset. Targets per notehead: duration class, voice id,
beam-group id, tuplet ratio. Model: 2–3 layer message-passing GNN (or
geometric transformer) over the measure graph. Validation: DEV duration
≥ 0.80, voice ≥ 0.85, beam-group F1, tuplet exact match, edge-ablation
causal, tier splits. Prerequisite (truth gap): extend Verovio joins to
stems/beams/flags/dots + canonical beam-group relations — specified, not
built here. No rhythm training launched (G9 forbids repeating crop runs).

## 14. Remaining limitations

Coverage misses the gate by 0.024; anchored tier at 0.79; jitter 0.28;
rhythm needs the graph build; multi-layout crops untrained.

## 15–16. CASE A/B/C

CASE A (scoped string+decoder integration, gates as preregistered with
the recorded near-miss). CASE C (rhythm-sequence: graph proposal above).
CASE B (comprehensive: 21 real gaps stand). Training NOT authorized
beyond the capped prototypes run here.
