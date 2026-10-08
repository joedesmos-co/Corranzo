# Guitar Context + Playable Rescue (G1–G8, no full training)

**Prereg:** `docs/guitar-vision/GUITAR_CONTEXT_PREREG.md` (frozen before runs;
one documented corrective each for pooling, LR, framing — no sweep).
**Artifacts:** context crops (staging), `stringnet.pt`, decode report.
Prior proof model, splits, and sealed sets untouched.

## 1. String attribution root cause

Two compounding causes: (a) global average pooling erased vertical position
— the very signal string identity is made of (fixed: vertical-bin pooling,
0.36→0.56); (b) staff scale/offset variance across scores (fixed partially:
line-normalized warping on image-detected lines, 0.56→0.64). Geometry-only
nearest-line control: 0.971 agreement at 40% coverage (abstains otherwise).

## 2–5. String / fret / combined / pitch

DEV string 0.639 (chance 0.167; acceptance 0.80 NOT met raw). Fret 0.909
held (frozen head, no regression). Decoder (string+fret posteriors, τ=0.6,
geometry-disagreement abstention): coverage 0.507, pitch precision 0.895
(was 0.394). Combined string+fret exact: reported via pitch agreement.

## 6–7. Rhythm / voice

Negative result, honestly kept: wide-crop duration oscillates 0.43/0.27
(epoch-alternating — unreliable head) and never beats the isolated 0.439;
voice drops to 0.66 (vs 0.795 isolated) because wide crops mix voices under
one label. Rhythm-from-crop is a target-construction failure (CASE C for
the sequence track): duration needs stem/beam association (object graph),
not a bigger window. Isolated duration/voice heads stand as the baseline.

## 8. Playable reconstruction

Abstaining decoder: 323/637 DEV digits decoded, 0.895 pitch precision;
violations quarantined by class (287 low-confidence, 27 geometry
disagreement). Same-string conflicts: predicted 373 vs true 367
(distributionally matched). G3 jitter: 0.30 flip rate under ±10% shift —
translation fragility recorded, not hidden.

## 9. Real vs etude generalization

No new claim: context training population identical to the proof's;
etude DEV supports tiny; tiers reported separately in the prior report.

## 10. Causal controls

Shuffled-string frozen at 0.338 (vs 0.639) · blank → constant string-6
output at 0.045 (vs 0.639; pixel-dependent) · wrong-crop mapping below
majority (prior report) · geometry control 0.971/40% image-only lines.

## 11. Remaining data gaps

Real TAB volume (string 0.43 isolated / 0.64 context needs data, not just
geometry), TAB-only real class, rhythm context architecture, multi-layout
crops in training (standard-layout hires only).

## 12. CASE A/B/C

CASE A (scoped): TAB string attribution + abstaining playable decoder —
meaningful gain (0.43→0.64 raw, 0.895 playable precision held-out from
training) with fret unregressed. Recommend larger scoped training on this
track. CASE C (rhythm-sequence): crop paradigm fails — object-graph
architecture required before scaling rhythm. CASE B (comprehensive): 21
real gaps stand.

## 13. Next step

Preregister the larger scoped run (stringnet capacity ×2, TAB oversample
≤×4, DEV gates: string ≥ 0.80 raw or decoder precision ≥ 0.90 at ≥ 0.50
coverage, fret ≥ 0.90) alongside an object-graph rhythm proposal; keep
technique/pairing heads abstinent. No full training until real TAB volume
and rhythm architecture land.
