# Phase 1–2 Gate: Inventory + Frozen Baseline

**Frozen base:** `994dca6`  
**Evaluator:** frozen `2.0.0` / schema `2`  
**Production OMR code:** not modified (gate)

## Highest-impact shared root cause

**Vector tie pairing without exclusive note ownership** (`detectVectorTies.applyTieMarks`).

Evidence:
- All **9/9** stored reports show `tieStarts < tieStops` (ratios ~0.5).
- **8/9** reproduce the **identical** start/stop counts at current HEAD.
- 1/9 (Vivaldi) diverges under Node re-OMR (fewer notes, zero ties) — still carries the same imbalance in the packaged summary; live path needs separate investigation.
- Root cause is general: multiple curve endpoints snap to the same start note → one `tieStart`, many `tieStop`s.

Pipeline: PDF vector curves / SMuFL tie glyphs → `applyVectorPageTies` / `applyTieMarks` → recognized score graph → MusicXML `<tie>`/`<tied>` → Visual Practice.

---

## Complete report inventory

| Report ID | Source | Instrument | Page / Measure | User expected | Corranzo produced | Category | Reproduces @ HEAD | Pipeline stage | Shared root cause |
|---|---|---|---|---|---|---|---|---|---|
| `…-2100` | a-cruel-angels-thesis-neon-genesis-evangelion.pdf | piano | n/a / n/a | (empty description) | accepted/high; 125m / 2808n; ties **14/25**; rests 16; accents 447 | **tie** (+ slur, rest, rhythm, chord, articulation, pitch, measure) | **YES** ties 14/25 | vector tie pairing | YES |
| `…-2101` | vivaldi-winter-rousseau-version-original.pdf | piano | n/a / n/a | (empty) | accepted/high; 145m / 2903n; ties **8/14**; rests 120; accents 442 | **tie** (+ slur, rhythm, chord, articulation, pitch, measure) | **PARTIAL** — packaged 8/14; Node HEAD → 89m/1542n/ties 0/0 | vector tie pairing (packaged); live path diverges | YES (packaged) |
| `…-2102` | la-campanella.pdf | piano | n/a / n/a | (empty) | accepted/high; 155m / 4105n; ties **6/12**; staccato 908 | **tie** (+ slur, rhythm, chord, pitch, measure) | **YES** ties 6/12 (154m/4103n) | vector tie pairing | YES |
| `…-2106` | merry-go-round-of-life-howls-moving-castle-piano-tutorial.pdf | piano | n/a / n/a | (empty) | accepted/high; 230m / 2409n; ties **79/134**; **rests 0** | **tie** (+ slur, rest, chord, pitch, measure) | **YES** ties 79/134 | vector tie pairing | YES |
| `…-2112` | Ao no Sumika (Piano).pdf | piano | n/a / n/a | (empty) | accepted/high; 72m / 1123n; ties **91/173** | **tie** (+ slur, rhythm, chord, pitch, measure) | **YES** ties 91/173 | vector tie pairing | YES |
| `…-2113` | jujutsu-kaisen-season-3-opening-1-aizo-king-gnu.pdf | piano | n/a / n/a | (empty) | accepted/high; 63m / 1050n; ties **12/24**; rests 3 | **tie** (+ slur, rest, rhythm, chord, pitch, measure) | **YES** ties 12/24 | vector tie pairing | YES |
| `…-2114` | iris-out-piano-arragement.pdf | piano | n/a / n/a | (empty) | accepted/high; 115m / 2333n; ties **24/47** | **tie** (+ slur, rhythm, chord, pitch, measure) | **YES** ties 24/47 | vector tie pairing | YES |
| `…-2116` | sweden-minecraft.pdf | piano | n/a / n/a | (empty) | accepted/high; 23m / 277n; ties **6/12**; **rests 0** | **tie** (+ rest, chord, measure) | **YES** ties 6/12 | vector tie pairing | YES |
| `…-2116 (1)` | aria-math-c418-from-minecraft.pdf | piano | n/a / n/a | (empty) | accepted/high; 194m / 1669n; ties **51/100** | **tie** (+ slur, pitch, measure) | **YES** ties 51/100 | vector tie pairing | YES |

Notes:
- User category on every package: `other`; description empty; page/measure null.
- Full MusicXML not packaged; inventories use `generated-summary.json` + HEAD re-OMR.
- Secondary signals (accent over-detection, zero rests, dense chords) present but **tie imbalance is the only signal shared by all 9**.

---

## Frozen baseline @ `994dca6`

### Semantic evaluator (full corpus, written mode)

| Metric | Score |
|---|---|
| Overall | **61.8%** |
| Pitch | 58.5% |
| Rhythm | 64.5% |
| Sustain/Tie | **46.7%** |
| Articulation | 84.0% |
| Measure structure | 65.9% |
| Interpretation | 13.3% |

Fixtures: **9/9 ok**. Evaluator frozen **2.0.0 / schema 2**. Truth data untouched.

### Relevant mismatch counts (corpus aggregate)

| Defect | Count | Fixtures |
|---|---|---|
| duration-mismatch | 280 | 9 |
| incorrect-chord | 217 | 7 |
| missing-note | 209 | 8 |
| extra-note | 198 | 9 |
| onset-mismatch | 193 | 8 |
| incorrect-pitch | 179 | 6 |
| missing-accent | 37 | 2 |
| missing-staccato | 37 | 1 |
| incorrect-tie | 7 | 2 |
| missing-tie | 6 | 4 |

### OMR regression fixtures

Enforced semantic corpus (`npm run omr:semantic-corpus`) is the fixture gate used here — **same 9 fixtures**, results above.  
(`npm run omr:evaluate -- --ci` is a single-score CLI and is not the corpus runner.)

### User-report reproductions

| | Count |
|---|---|
| Reports inventoried | 9 |
| Re-OMR completed at HEAD | 9 |
| Reproduce tie start≪stop with identical counts | **8** |
| Partial / path divergence | **1** (Vivaldi) |

Baseline MusicXML + summaries saved under `tmp/user-omr-recognition/baseline/reproductions/`.

Example (Sweden m22–m23): six chord members marked `tieStart+tieStop` on the leave chord and six orphan `tieStop`s on the arrival chord → counted starts 6 / stops 12.

---

## Proposed Phase 3 target (not started)

Smallest general fix in `src/features/omr/detectVectorTies.js` → `applyTieMarks`: exclusive source/destination ownership (mirror raster `usedDestination`), without song-specific hardcoding. Geometry fixtures only — no copyrighted song PDFs.
