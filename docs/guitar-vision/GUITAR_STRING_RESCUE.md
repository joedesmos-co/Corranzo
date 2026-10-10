# String Recognition Bottleneck Rescue Report

**Prereg:** `GUITAR_STRING_PREREG.md` + `GUITAR_STRING_REFRESH_PREREG.md`
(fit-select / heldout-verify / DEV-once). Sealed TEST untouched. Fret CNN
frozen. NO training launched except ONE capped StringNet fine-tune
(verdict: rejected). Technique abstinent. DO NOT MERGE.

## FIRST: string-2/3/4 autopsy (GT boxes; corrected counters)

Fit (532) / heldout (362) confusion: s1 perfect both (45/45, 28/28);
s6 memorized-then-wiped (41/41 -> 0/10); s4 collapses (20% -> 4%, into
s2/s3); s5 45% -> 10%; s2/s3 cross-fire. Tier/yfrac splits confounded
by page difficulty or homogeneous (all multi-system paired) — no
geometric silver bullet. Mechanism: absolute-vertical-bin architecture
memorizes positions; middles blur across lines.

## StringNet refresh: REJECTED (ONE capped run, evidence below)

Fine-tune from stringnet.pt, fit GT crops, vertical jitter +-30px,
class-balanced, Adam 1e-4, fixed 8 epochs: fit 0.544->0.564 (+2pts),
heldout 0.450->0.381 (-7pts). Overfits fit geometry; harms heldout.
Fallback stringnet.pt kept; sr weights discarded (history committed).
No second variant (cap spent).

## SECOND: large digits + resampling (heldout, no training)

- Veto INNOCENT (heldout-large: 16 vetoed, 0 digit-TP cost; native
  R 0.091 with/without veto). Veto kept.
- Mined negatives 0% impure at core centers (38% was union-vs-core
  artifact — retracted). v4 failure = dilution/underfit, not poisoning.
  No repeat of layout-inclusive training.
- Merged regime stands (bilinear notes + native digits/rests).

## THIRD: transcription impact

Chains unchanged (heads frozen): coverage std 0.049, compact 0.105,
large 0.016, bravura 0.231; oracle 0.86-0.89. TAU=0.6 + T=0.7 frozen
(heldout tauGrid flat ~0.25: no dominating lower point).
Heldout real transcription (pdmx-QmTxoAbitsi9, 2 pages): 226 notes
(62% of joinable digits), 31 measures, semantic 29% (pitch 3%,
rhythm 43%, measure 8%; missing-content + measure-drift dominated).
Truth has 724 tab events vs 362 joins (joins coverage 50% caps all).
Fit transcriptions regenerated with fixed type/dot emission (74%/79%
stable). DEV transcription gate (>0.7 fit pitch) not met — no DEV
transcription (discipline kept). No DEV reruns needed (no DEV-facing
artifact changed).

## FOURTH: beam-tip SKIPPED

Condition (strings improve) failed — no beam-tip work this mission
(per prereg). Prior beam/dot/measure numbers stand.

## Remaining V1 blockers

String accuracy on dense/middle strings (133 heldout errors — the wall);
bad-box 46%; large-digit recall 0.09; beam-tip precision; flag
separator; triplet numerals; joins coverage 50%; paired-mapping 5-14%;
21 real-data gaps; technique supervision.

## Commit

This report + preregs + autopsy JSONs + veto verdicts + sr-history +
heldout transcription + semantics. Tests green (below).

## Exact next step

Line-relative string features (warp tall crops to detected staff lines
so identity is line-relative, not bin-absolute) as the next bounded
head experiment; then veto-off-digit confirmation. No comprehensive
training.
