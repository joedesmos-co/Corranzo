# OMR Perfect Polish Sprint

Generated: 2026-07-01

## Before / After Benchmark

| Fixture | Metric | Before | After | Δ |
| --- | --- | ---: | ---: | ---: |
| **clean** | pitch | 100.00% | 100.00% | 0 |
| clean | duration | 100.00% | 100.00% | 0 |
| clean | onset | 100.00% | 100.00% | 0 |
| clean | chord | 100.00% | 100.00% | 0 |
| clean | F1 | 100.00% | 100.00% | 0 |
| clean | wrongDuration | **1** | **0** | **−1** |
| clean | wrongPitch / onset / chord | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| clean | measureΔ / noteΔ | 0 / 0 | 0 / 0 | 0 |
| **dense** | pitch | 93.67% | 93.67% | 0 |
| dense | duration | 95.59% | 95.59% | 0 |
| dense | onset | 95.55% | 95.55% | 0 |
| dense | chord | 93.09% | 93.09% | 0 |
| dense | F1 | 98.95% | 98.95% | 0 |
| dense | wrongDuration | 93 | 93 | 0 |
| dense | chordMismatch | 201 | 201 | 0 |
| dense | measureΔ / noteΔ | 0 / −3 | 0 / −3 | 0 |

Baseline source: `tmp/omr-benchmark-dashboard/report.md` (pre-fix run 2026-07-01T02:07Z).  
After source: `tmp/omr-benchmark-dashboard/report.md` (post-fix run 2026-07-01T22:10Z).

## Target Selection (rerank)

Post-phantom dense totals: chord 201, pitch 147, duration 93, onset 94, missing 31.

| Rank | Bucket | Count |
| ---: | --- | ---: |
| 1 | wrongPitch @ correct onset | 104 |
| 2 | wrongDuration @ correct onset+pitch | 41 |
| 3 | chordMismatch (raw) | 201 |
| 4 | missingNotes | 31 |

**Pure chord-only hotspots:** m113 (12), m94 (8), m57 (6) — prior diagnosis: opening serialization; no safe narrow runtime rule identified.

**Clean residual:** single `too-long` duration in m34 (B4 @ beat 0: truth 1q, gen 2q).

**Chosen target:** clean m34 opening-treble duration — highest-confidence, zero dense regression risk, completes Gymnopédie error counts.

## Diagnosis

m34 (3/4, post inner-voice + phantom baseline):

- Opening bass B1 + treble B4 same start (div 0).
- Treble rearticulates A4 @ div 4, closes B4 @ div 8.
- `sameStartTrebleDuration` matched opening/closing written step (B) + penultimate closing figure + `closesOnFinalBeat` in 3/4 → assigned **half** (8 div) instead of **quarter** (4 div).
- Mechanism: closing-echo half extension ignored intermediate same-clef rearticulation on a different pitch.

## Fix (kept)

**File:** `src/features/omr/processVectorOmrPage.js`

- Added `sameClefRearticulatesDifferentPitchBeforeClosing()` guard.
- Penultimate closing half extension for same-start opening treble now requires no intervening same-clef attack on a different written step.

**Test:** `tests/omrVectorRhythm.test.js` — `keeps a quarter opening treble when the voice rearticulates before the closing echo`

## Reverted

None.

## Verification

| Check | Result |
| --- | --- |
| `npm run omr:benchmark-dashboard` | PASS (clean wrongDuration 0; dense unchanged) |
| `npm test -- --testTimeout 30000` | PASS — 140 files, 1329 tests, 5 skipped |
| `npm run build` | PASS |

## Report Paths

- Dashboard: `tmp/omr-benchmark-dashboard/report.md`, `report.json`
- Fixtures: `tmp/omr-benchmark-dashboard/fixtures/clean.json`, `dense.json`
- Rerank: `tmp/omr-benchmark-dashboard/post-inner-voice-rerank.md`
- Sprint: `tmp/omr-benchmark-iter/perfect-polish-sprint/summary.md`

## Next Safest Dense Targets (not attempted)

1. **m113 pure chord (12)** — opening voice serialization; needs new simulation, high coupling risk.
2. **m7 missing notes (11/31)** — detection/glyph loss; not rhythm-tunable.
3. **Page-8 pitch cluster (m119–125)** — staff-gap residue; prior staff-gap work shipped; remaining mixed onset/pitch.

Do **not** retry: broad beam caps, beam ownership runtime, global onset snap, phantom solo deletion.
