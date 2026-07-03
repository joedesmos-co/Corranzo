# OMR Real-World QA Loop — Iteration 1

**Generated:** 2026-07-03  
**Loop:** 1 of 5 max  
**Status:** Stopped — no safe improvement found

## Dashboard baseline (frozen)

| Fixture | wrongOnset | wrongDuration | chordMismatch | wrongPitch |
|---------|----------:|--------------:|--------------:|-----------:|
| Gymnopédie (clean) | 0 | 0 | 0 | 0 |
| Cruel Angel (dense) | 94 | 77 | 172 | 147 |
| Twinkle (simple) | 6 | 3 | 0 | 0 |

**Largest aggregated error bucket:** `chord` = 8346 (32% of counted errors)

**Dense primary error source:** rhythm-inference (confidence 0.899)

**Dense rhythm attribution (root causes, not symptoms):**

| Bucket | Count |
|--------|------:|
| onset-phase-shift | 94 |
| pitch-grouping-symptom | 90 |
| chord-grouping-symptom | 81 |
| voice-serialization-shift | 35 |
| onset-coupled-duration | 44 |

## What worked

- Benchmark dashboard runs clean; all fixtures **pass** thresholds.
- Gymnopédie remains **100%** on pitch, duration, onset, chord, F1.
- Dense baseline **MATCH** frozen (94/77/172/147).
- Twinkle false-tie guard clean; m10 pinned as serialization canary (6 wrong onsets, all m10).
- Shadow infrastructure + truth gates block all unsafe promotions (0 truth-approved measures).

## What failed (to improve safely)

- **No generic runtime change** improves dense metrics without violating gates.
- Voice serialization shadow (Phase 6/7): **115 structurally rejected** on dense (hard-constraints); **0 truth-approved**.
- Clef-only phase-shift family **exhausted** (0 changed measures).
- Chord bucket (8346) is largely **downstream symptom** of onset/voice serialization — fixing chord grouping alone regresses when tested (Phase 2B evidence).

## Bugs fixed this loop

**None.** No code change made — every candidate path violates loop rules:

- ScoreGraph / shadow promotion → forbidden
- Threshold lowering → forbidden
- Per-fixture hardcoding → forbidden
- Runtime rhythm solver tweak → fails hard-constraints or risks Gymnopédie/Twinkle regression

## Loop decision

**Stop after iteration 1.** Aligns with `docs/OMR_V2_STOP_CONTINUE_DECISION.md`: pause solver iteration until IR supports **paired cross-staff atomic lane moves** (Phase 8+ prerequisite).

Next safe work (outside this loop's scope):

1. **onset-grid-refinement** — complete `onsetColumns[]` observation on MeasureGraph (diagnostic prep, no runtime promotion).
2. **IR/event-model phase** — paired cross-staff atomic lane moves before another solver variant family.
3. **Mic/audio accuracy** — higher ROI per stop/continue decision.

## Verification (unchanged)

- `npm test` — pass
- `npm run build` — pass
- `npm run omr:benchmark-dashboard` — MATCH, largest bucket chord 8346
- Replay harnesses — not applicable to OMR loop
