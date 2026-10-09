# Multi-Layout Detection + Rhythm Rescue Report

**Prereg:** `GUITAR_MULTILAYOUT_PREREG.md` (frozen before runs; Piano idle
verified, no simultaneous training). Sealed TEST untouched. Fret CNN
untouched (0.89-1.00 on matched throughout). Technique abstinent (no
technique heads). DO NOT MERGE.

## 1. Large-layout root causes (G1, TRAIN, v3 weights)

- **Object-channel drift DOMINATES.** TRAIN TP peak medians collapse on
  large: note 0.819->0.672, rest 0.788->0.551, tabdigit 0.733->0.539.
  No-veto TRAIN recall: 0.449 (standard) -> 0.267 (large).
- **Veto is secondary:** +0.017P/-0.010R on large (1,801 vetoed of ~19k).
- **Boxes transfer:** canonical medians identical across layouts.
- **Scale compounds it:** large glyphs render ~24% smaller in px
  (fx 0.076 vs 0.100) — the model under-responds to small glyphs.
- **Translation instability confirmed (jitter):** +30px shift collapses
  matched digits on every layout (std 227->7, large 54->12, compact
  428->0). Small glyphs + fixed boxes + peak grid (8px stride).
- Text/bg: ~20% of FPs zonal (clef/title); time-sig digits comb-gated.

## 2-3. Detector changes + training outcome (G2, ONE capped run)

Splits verified (312 manifests, score-grouped, 0 unassigned). Capped run:
TinyFCN-4ch warm-started from v3, TRAIN standard+compact+large,
2,206 v3 bg-FPs mined (273 pages), <=12 epochs, same depth/width.
DEV (once per layout):

| layout | v3 P/R | v4 P/R | verdict |
|---|---|---|---|
| standard | 0.410/0.425 | 0.364/0.385 | REGRESS -> keep v3 |
| compact | 0.628/0.700 | 0.632/0.711 | WIN -> adopt v4 |
| large | 0.296/0.247 | 0.216/0.216 | REGRESS -> keep v3 |
| bravura | 0.451/0.433 | 0.385/0.383 | REGRESS -> keep v3 |

v4 diluted capacity (12ep/3 layouts) and its veto-mined negatives
self-reinforce on unseen scales (veto kills real large TPs -> mined as
ignore -> further suppression). Frozen per-layout map
(`LAYOUT_DETECTOR`; drivers pass `--detector`): compact=v4, rest=v3.
v4 weights preserved, not deleted.

## 4-5. Precision/recall + false positives (per layout, final map)

Standard 0.410/0.425 (fp 4911+616+496 by class), compact 0.632/0.711,
large 0.296/0.247, bravura 0.451/0.433. Box localization: median boxes
transferred (core convention); rest x1.25 retained.

## 6-7. String/fret + playable pitch (G3/G5, exact links, coverage)

Oracle heads are strong (pitch 0.856-0.891 on mapped; fret 0.89-0.99):
heads are NOT the bottleneck. Abstention is heavy (oracle decodes
27-35% of GT; TAU=0.6) and event mapping covers 5-14% of GT digits
(paired staff+TAB duplication) — reported, not hidden:

| layout | oracle pitch (cov) | detected pitch (cov) |
|---|---|---|
| standard | 0.878 (0.102) | 0.781 (0.039) |
| compact | 0.856 (0.121) | 0.548 (0.080) |
| large | 0.891 (0.089) | 0.667 (0.013) |
| bravura | 0.889 (0.308) | 0.500 (0.115) |

Detection is the bottleneck (std 2.6x, large 7x headroom to oracle).
Controls: blank 0/0, shifted collapse, shuffled 0.78->0.16.

## 8. Rhythm graph (G4)

- **Exact event-link supervision BUILT** (`proof-event-link.py`):
  document-order counters verified 99.8% self-consistent (21,317 linked /
  16 unmatched TRAIN; 9,468/390 DEV). Prior "blocked" verdict SUPERSEDED
  by dataset-render.sid_for_event evidence. Link exactness validated by
  pitch agreement (chain pitch rates).
- Primitives (image-only): stems P 0.31/R 0.52 TRAIN, **P 0.46/R 0.56
  DEV** (anchored + chord-share + thin-stem fixes; two global failures
  documented); dots 0.82/0.85; beam pairs emerging (tp 1,541 DEV,
  over-grouping remains); flags abstinent (documented negative).
- **Measure boundaries:** barline detector (system-relative coverage
  >=0.9, TRAIN-selected over kernel/matrix variants): TRAIN median
  bars/measures 1.06, **DEV median exactly 1.0** (dense multi-system
  under-counts; TAB single-measure definitional zeros — reported).
- **Tuplets:** prevalent (12 TRAIN samples / 2,211 events; 5 DEV / 772)
  but numerals have no SVG anchors and digit response is inseparable
  (0.32-0.39) — census only, recognition NOT claimed.
- **Duration reconstruction:** rule-based (beams/flag/dots) with EXACT
  validation restored: TRAIN acc 0.226 (quarter-default dominates;
  confusion: 8ths/16ths -> quarter when beams missed; quarters 0.82).
  Status: partial — components measured, full durations need beam-tip
  association + flags + triplet numerals.

## 10-11. Data gaps / V1 blockers

Unchanged: 21 real-data gaps, technique supervision, paired-event
duplication in mapping coverage, beam-tip association, flag separator,
triplet numerals, large-scale robustness (needs layout-inclusive run
WITHOUT veto-mining feedback — clean negatives or more epochs).

## 12. Commit

This report + code + records (see commit). Tests green (below).

## 13. Exact next step

Clean-negatives capped run (mine with veto DISABLED so large TPs are not
taught as ignore; or 2x epochs at lower LR) for large recovery; then
beam-tip association for durations. Rhythm prep continues on validated
primitives. DO NOT MERGE.
