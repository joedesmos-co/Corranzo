# Phase 2 — Chord/Event Structure: Taxonomy Rebuild (NO PRODUCTION CHANGE)

Date: 2026-07-26
Decision: **No production change shipped.** The evaluator's `incorrect-chord`
bucket does not represent a real, repeated chord-structure defect in the
vector pipeline. The old "dense chord separation: 149" reading is confirmed
misleading.

## Method

Recomputed the evaluator's own chord-integrity buckets per 1:1 aligned measure
(read-only reuse of `matchSemanticEvents` + `summarizeChordIntegrity`, same
0.08-quarter onset buckets) on the accepted Phase 1 candidate outputs for all
12 campaign sources, then reclassified all 188 mismatch examples and inspected
representative measures in full note-event detail
(`phase2-chord-taxonomy.mjs`, `phase2-inspect-measure.mjs`,
`phase2-voice-stats.mjs`).

## Re-taxonomized counts (188 examples total)

| Class | Count | Real nature |
| --- | --- | --- |
| pitch-substitution (equal tone counts, midi subs) | 99 (53%) | Pitch/register recognition, frozen area — not structure |
| structural candidates (sequentialized/merged incl. compounds) | 66 | See breakdown below — none survived inspection |
| pure missing-tone / extra-tone | 12 | Note under/over-detection, not structure |
| voice-ownership | 6 | Voice numbering differences |
| other compounds (missing+extra etc.) | 5 | Detection noise |

### Structural-candidate breakdown (66)

- **29** sit in measures whose generated total span differs from truth
  (e.g. Hungarian Dance m3/m5: 2/4 measures rendered as 4-quarter measures with
  onsets at 0.75/1.5/2.25/3.0 instead of 0/0.5/1.0/1.5). The chords themselves
  are intact — same tones, correctly stacked; only the onset grid moved.
  Root cause: measure-length/time-signature/rhythm errors, not chords.
- **10** are `piano-articulation-scan` — a raster fixture; notehead detection
  noise (Phase 5 scope).
- **17** are `piano-dense-advanced-vector` — catastrophic under-detection
  (m1: 33 truth events → 6 generated) plus measure misalignment (truth m4→gen 3,
  m5→4, m8→6). The few detected chords are correctly stacked.
- **1** is `piano-rhythm-tuplets-vector` m7 — tuplet onset scaling (Phase 4).
- **1** is Hungarian m45 aligned to generated m32 — long-range measure
  misalignment; comparison content is unrelated.
- **8** are Carol of the Bells (m14, m19, m20, m31, m33, m56):
  - m14: chords [77,81]/[74,77] all correctly stacked; a rhythm error shifts
    onsets (G5 at 1.5 instead of 1.0), moving buckets.
  - m19/m20: generated m19 contains m20's downbeat chord [69,74,77] at its end
    — a measure-boundary spill; the chord is intact.
  - m31/m33: bass register/clef misreads (truth D4[62] read as F2[41]; A2/D3/F3
    line read as F4/B4/D5). Pitch recognition, frozen area. Stacks preserved.
  - m56: aligned to generated m52 (4 lost measures upstream) — misalignment.

### Voice-merge check

Truth scores are heavily multi-voice (Gymnopédie 76/148 staff-measures,
La Campanella 107/275, Moonlight-3 65/396, Hungarian 30/208); the generated
output almost always emits one voice per staff (2–25 multi-voice
staff-measures). Hungarian m5 shows the concrete case: truth's two treble
voices (D4 dotted-quarter over B3) merge into a single-voice chord [B3,D4].
However, only **7 of 188** incorrect-chord examples occur in truth-multi-voice
measures — the evaluator's voice canonicalization absorbs most of it. Voice
separation would be a large architectural change (stem-direction voice
assignment) for ≤7 examples; rejected under the smallest-change and
no-refactor constraints. Documented as backlog.

## Verdict

The chord assembly mechanism (stacking simultaneous same-staff tones into
`<chord>` events) worked correctly in **every** inspected case across all 12
sources. Zero cases of:

- chord tones emitted sequentially (as separate onsets)
- sequential notes falsely merged into a chord (the Hungarian m5 "merge" is a
  voice-collapse of genuinely simultaneous attacks, not a sequential merge)
- split 2+1 stacks
- duplicate chord tones from chord logic (duplicates observed trace to
  detection, e.g. articulation-scan raster noise)

The `incorrect-chord` evaluator bucket is dominated by upstream causes:
pitch/register recognition (53%), rhythm/measure-length onset shifts,
under-detection on the dense fixture, raster noise, and measure misalignment.
Fixing any of those through chord-tolerance changes would be wrong; widening
column tolerances is explicitly not needed (no sequentialization exists to
merge).

## Artifacts

- `tmp/omr-quality-campaign/phase2-chord-taxonomy.mjs` — reusable taxonomy tool
- `tmp/omr-quality-campaign/phase2-inspect-measure.mjs` — measure-level
  truth/generated event dumper
- `tmp/omr-quality-campaign/phase2-voice-stats.mjs` — voice usage statistics

## Backlog created

1. Measure-length/time-signature inflation (Hungarian 2/4 → 4-quarter
   measures; pre-existing, dominates that piece's defect counts).
2. Dense-fixture under-detection (`piano-dense-advanced-vector` m1: 27 of 33
   notes lost; measure loss 16→12).
3. Single-voice collapse of multi-voice staves (real but low evaluator impact;
   architectural).
4. Carol m19/m20 measure-boundary spill (one event across barline).
