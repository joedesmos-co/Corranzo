# Transcription Bottleneck Rescue Report

**Prereg:** `GUITAR_BOTTLENECK_PREREG.md` (frozen; TRAIN-fit=32 /
TRAIN-heldout=15 / DEV-once). Sealed TEST untouched. Fret CNN frozen
(0.86-1.00 on matched). No training launched by me (user TallCNN running
at start; inference/analysis only). Technique abstinent. DO NOT MERGE.

## 1. End-to-end failure breakdown (G1, TRAIN-fit standard, 548 GT digits)

missed-detection 35 (6%) | wrong-family 0 | bad-box 259 (47%) |
matched 254 | abstained@0.6 45-150 | fret-wrong 4 | string-wrong 47 |
both-correct 51 | pitch-correct 51. TAU tradeoff (matched): 0.4 ->
76 decoded @0.37 prec; 0.5 -> 58 @0.45; 0.6 -> 37 @0.51; 0.7 -> 21
@0.57. TAU=0.6 frozen (precision-preserving; curve reported).
Pairing (x-column audit, CPU): 1,522 multi-object columns, 162
note+digit paired, 62 pitch-agree (38%; clustering/pitch caveats).
Recoverable headroom ranking: boxes (259) > abstention (~40-110 at
lower tau) > strings (47) > missed (35) > frets (4) > family (0).

## 2-3. Detection precision/recall by layout (DEV, merged regime, once)

| layout | P / R (was) | note | rest | digit |
|---|---|---|---|---|
| standard | **0.676/0.710** (0.410/0.425) | .741/.770 | .352/.390 | .314/.356 |
| compact (v4) | **0.643/0.715** (0.628/0.700) | .666/.730 | .409/.564 | .737/.722 |
| large | **0.572/0.526** (0.296/0.247) | .599/.606 | .220/.069 | .166/.085 |
| bravura | **0.715/0.700** (0.451/0.433) | .719/.754 | .697/.317 | .594/.731 |

Driver: scale normalization (TARGET_GAP 26px, TRAIN-fit) + two-pass
merge (notes<-normed, digits/rests<-native). Real-vs-etude DEV: no gap
(std real .676/.710 vs etude .640/.690; large real .572/.524 vs etude
.628/.655). Standard passes precision gate; recall <0.55 everywhere
but large more than doubled. Jitter still collapses (+30px: 227->7 std).

## 4. Playable-pitch coverage (G3/G5, exact links, precision AND coverage)

Oracle heads strong (pitch 0.856-0.891, fret 0.89-0.99) — heads are not
the bottleneck; abstention (decodes 27-35% of GT) + paired-mapping
coverage (5-14%) are reported, not hidden:

| layout | oracle pitch (cov) | detected pitch (cov) |
|---|---|---|
| standard | 0.878 (0.102) | 0.781 (0.039) |
| compact | 0.856 (0.121) | 0.548 (0.080) |
| large | 0.891 (0.089) | 0.667 (0.013) |
| bravura | 0.889 (0.308) | 0.500 (0.115) |

Controls: blank 0/0, shifted collapse, shuffled 0.78->0.16/0.0.

## 5. Decoder abstention rate

TAU=0.6: 45/82 matched abstain (fit); oracle chains abstain 65-73% of
GT. Lowering to 0.5 recovers ~1.6x decoded at ~0.45 precision (fit).

## 6-7. Rhythm accuracy + graph quality (G4, exact links 96-99.9%)

Stems TRAIN 0.314/0.519, **DEV 0.455/0.559**; dots 0.94/0.95; beam pairs
tp 2,452 TRAIN / 1,541 DEV (over-grouping remains); flags ABSTINENT
(touch-retry: P 0.022/R 0.43, unusable); measure ownership poor
(barline-bound); barlines DEV median exact (1.0); tuplets prevalent
(12 TRAIN samples/2,211 events; 5 DEV/772) but numerals inseparable
(0.16-0.39) — census only. Duration rule (exact validation): TRAIN
0.278, DEV 0.294 (quarter-dominated; 8ths->quarter when beams missed).

## 8. Actual score reconstruction

Best path per layout (merged+v3/v4 map): ~4-12% of GT digits become
verified correct pitches; ~17-35% decode; remainder lost to
detection (47% bad-box), abstention, and mapping coverage. Compact
TAB etudes reconstruct best (digit R 0.722).

## 9. Remaining real-data gaps

Paired staff+TAB mapping coverage (5-14%); beam-tip association;
flag separator; triplet numerals; large-digit recall (veto over-fire);
thin-glyph blur under resampling (bilinear tax; native pass covers);
21 real-data gaps (unchanged); technique supervision (unchanged).

## 10. Next justified experiment

Veto-off digit/rest recovery on large (veto costs large-digit recall
0.199->0.085 with no precision gain to justify it) + LANCZOS/sharp
resampling comparison on TRAIN-heldout byClass; then beam-tip
association for durations. No comprehensive training. DO NOT MERGE.
