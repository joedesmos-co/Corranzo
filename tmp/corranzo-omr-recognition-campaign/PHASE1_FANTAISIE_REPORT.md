# Phase 1 — Fantaisie Written-Duration RCA

**Status: ACCEPTED** (one general staff-pairing fix; residual tempo-map inflation documented)

Date: 2026-07-28  
Control: A Cruel Angel’s Thesis (Evangelion) — unchanged  
Freeze: evaluator, repeats, audio, Musical Structure Sprint 1, etc. preserved

---

## Reproduced behavior

Live OMR of Fantaisie-Impromptu:

| Metric | Before | After | Truth edition |
|---|---|---|---|
| Written measures | **193** | **144** | **138** |
| Written clock | **14.0 min** | **10.1 min** | ~4–5 min performed |
| Notes | 3034 | 3028 | 3082 |
| Page 4 systems | **17** | **9** | 9 |
| Page 4 measures | **78** | **29** | 29 |

Per-measure MusicXML durations were already clamped to nominal 4 ql — **not** overfull note packing. Excess written length was almost entirely **extra measures** from system over-segmentation, plus a stuck Largo tempo (50 BPM) for the second half of the clock.

## Starting metrics / measure-duration audit

Artifacts:

- `phase1-fantaisie/measure-duration-audit-gen.json`
- `phase1-fantaisie/measure-duration-audit-truth.json`
- `phase1-fantaisie/baseline-summary.json`
- `phase1-fantaisie/live-omr-summary.json` (before)
- `phase1-fantaisie/fantaisie-after-summary.json`

Audit findings:

1. **No class 1–6/9–11 per-measure duration bombs** — every generated measure ≈ 4.0 ql vs nominal.
2. **Class 8 / system boundary** — first catastrophic drift at **page 4**: staff detection returned 17 staves (odd). `groupStavesIntoSystems` required `length % 2 === 0`, fell back to **17 single-staff systems**, and barline grids invented ~78 measures (truth ~29).
3. **Impostor stave** — bottom band height ≈3× median with 14 lines (merged grand staff). Other 16 bands pair cleanly into 8 systems; orphan kept as solo system → 9 systems.
4. **Tempo (secondary clock inflation)** — PDF text yields Allegro + quarter=84, Largo, a few `a tempo`; missing Moderato/Presto. After Largo@50 the score stays at 50 BPM for most remaining measures → clock ~10 min even after measure fix. Not fixed this phase (would be a separate tempo-recognition change; not a duration clamp).

Classification of primary drift: **#8 measure carry-over / system boundary** (odd-stave pairing failure), with secondary **wrong/missing tempo recovery**.

## First failing stage

`groupStavesIntoSystems` in `src/features/score-follow/detectStaffLines.js` — odd stave count disabled grand-staff pairing.

## Exact root cause

One merged double-height staff band made stave count odd → pairing skipped → each staff became its own system → measure-grid inflation on that page (~+49 measures).

## Attempted / accepted change

**Accepted:** When `staves.length % stavesPerSystem !== 0`, try leaving clearly geometric outlier band(s) as solo systems and pair the remaining even set if gap structure is consistent. Gated by height/line-count outlier ratios (≥1.75 or ≤0.45) so Hungarian/dense fixtures do not over-collapse.

**Not done:** Tempo map repair, half-note metronome conversion, time-signature 2/2, note-duration retune, clamps/scaling.

## Before / after

- Fantaisie measures 193 → 144 (truth 138); page 4 measures 78 → 29.
- Written clock 14.0 → 10.1 min (residual Largo stickiness).
- Musical ql nearly matches truth (~576 vs 552).
- Evangelion: 125 measures / 2808 notes / 243.1 s — **identical**.
- Minecraft control: 113 measures / 585 notes / 3.77 min — **identical** to soak.

## Regressions run

- `omrPitchStaffMapping`, `detectBarlinesInSystem`, `pdfGeometryDetection`, `hungarianDanceAutoSetup`
- `durationOverflowRepeats`, `timelineExpansion`, `playbackSchedulerChunking`
- Notation Fidelity Sprints 2–5 tests, Musical Structure Sprint 1 tests

All passed.

## Remaining limitations

- Clock still longer than edition performance (~10 vs 4–5 min) because Largo@50 is never superseded by Presto/Allegro return.
- Metronome recognized as quarter=84; truth uses half=84 → 168 quarter BPM.
- Slight residual measure surplus (144 vs 138) on pages 1–3/5.
- Dense RH tuplet/grace accuracy not addressed (out of written-duration scope once measures are bounded).
