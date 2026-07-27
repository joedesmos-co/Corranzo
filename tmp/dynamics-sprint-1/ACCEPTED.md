# Dynamics Recognition Sprint 1 — ACCEPTED / FROZEN

**Accepted 2026-07-26.** Do not retune Dynamics Sprint 1 unless a demonstrated
real-score failure appears. Do not alter frozen evaluator `2.0.0` / schema `2`.

## Accepted behavior
- Vector and raster recognize `pp p mp mf f ff`
- `cresc.` / `dim.` text recognized
- Supported hairpins emit MusicXML wedge start/stop
- Association by measure / onset / staff (not page-level broadcast)
- Invented raster `p`/`mf`/`f` remains disabled
- Fretted-score protections remain (no lone ASCII `p`/`f`; no ink hairpins on TAB)
- Corpus emission false positives remain zero
- No frozen semantic category changed (Overall 61.9%, Interpretation 13.3%, Δ=0)

## Important limitation
The frozen nine-fixture semantic corpus has **no ground-truth dynamics** in
truth MusicXML and essentially no printed dynamics in the PDFs. Do not claim
broad real-world dynamics accuracy from corpus gates alone.

## Independent harness (keep)
- `src/features/omr/omrDynamicsQuality.js`
- `tests/dynamicsSprint1.test.js`
- `tmp/dynamics-sprint-1/`

## Real-world validation set (manual; does not touch evaluator)
See `benchmarks/omr-dynamics-validation/README.md`.

## Deferred (unchanged)
D.C./D.S./Segno/Coda/Fine · guitar measure-split repeats · guitar-standard false ties ·
ink hairpins on fretted pages · expressive volume curves.
