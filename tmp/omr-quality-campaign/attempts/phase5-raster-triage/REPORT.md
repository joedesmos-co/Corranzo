# Phase 5 — Raster Triage: NO PRODUCTION CHANGE

Date: 2026-07-27
Decision: **No production change shipped.** Rebuilt the raster defect taxonomy
for `piano-articulation-scan` (0 PDF text glyphs → raster path). No candidate
met the safety bar (must preserve sustain/articulation TPs, ties/slurs,
accidentals/key signatures, and note-count safety). Did not reopen on-line
chord separation.

## Raster source identification

Among the 12 campaign sources, only `piano-articulation-scan` is a pure raster
path (PDF text layer empty; no SMuFL notehead/rest glyphs). All Downloads real
scores and the other fixtures carry vector text glyphs.

The campaign brief’s “~59 raster-source defects” does not match the current
evaluator report for this fixture (**219** defects, unchanged from baseline).
The rebuilt taxonomy below replaces that figure.

## Rebuilt taxonomy (219 defects)

| Bucket | Count | Share | Notes |
| --- | --- | --- | --- |
| Articulation misses | 49 | 22% | missing-staccato 37, missing-accent 12 |
| Structure (note invent/miss) | 48 | 22% | extra-note 34, missing-note 11, volta/tempo 3 |
| Rhythm/onset/duration | 43 | 20% | duration 26, onset 17 |
| Pitch/register | 42 | 19% | incorrect-pitch 42 |
| Chord-label (evaluator) | 33 | 15% | incorrect-chord — Phase 2 showed these are pitch/detection, not sequentialization |
| Sustain | 4 | 2% | missing-tie 1, incorrect-tie 3 |

Note inventory: truth **88** sounding notes, generated **111** — net
**over-detection**, not under-detection. Class scores: pitch 29%, rhythm 72%,
articulation 14%, sustain 20%.

Baseline vs Phase 1 candidate: identical 219 / identical articulation and pitch
counts — beam promotion did not touch raster.

## Safe-target review

| Target | Feasible? | Why not shipped |
| --- | --- | --- |
| Notehead center/register | Risky | 42 pitch errors sit next to 34 extra notes; loosening register would likely invent more heads and regress articulation attachment geometry |
| Duration | Risky | 43 rhythm defects intertwined with wrong heads; no isolated duration rule |
| Visible rests | N/A | 0 rest defects on this fixture; 0 rest glyphs |
| Beam grouping | Out of scope | Raster has no vector beam graph; Phase 1 is vector-only |
| Noise rejection | Attractive | Extra-note 34 suggests over-detection, but tightening ink thresholds historically kills staccato/accent TPs on this fixture — not attempted |

## Constraints honored

- Did not reopen broad unsafe on-line chord separation
- Did not modify pitch recognition, articulation, tie/slur, or accidentals
  pipelines
- Left production raster path unchanged

## Verdict

Raster triage ends in documentation only. The dominant problems are notehead
over-detection and pitch/register noise that also drive chord-label and
articulation-miss counts. Any production edit needs a dedicated raster sprint
with articulation/sustain regression gates; it is not a safe drive-by after the
vector phases.

## Artifacts

- `tmp/omr-quality-campaign/phase5-raster-taxonomy.mjs`

## Backlog

1. Raster notehead precision/recall rebalance with articulation TP freeze.
2. Staccato/accent attachment geometry after notehead centers stabilize.
3. Ignore evaluator `incorrect-chord` on raster until pitch inventory is clean
   (Phase 2 finding).
