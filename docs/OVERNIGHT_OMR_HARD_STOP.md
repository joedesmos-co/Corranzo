# Overnight Sprint — OMR Hard Stop

**Date:** 2026-07-16  
**Branch:** `main`

## Decision

**No safe runtime OMR changes in this overnight pass.**

## Evidence

1. **Voice-aware serialization** remains the Phase 5 recommended target but still has **0 truth-approved measures** on live enforced fixtures (hard-constraint / voice-overlap blocker). Duration-coupled and clef-only phase-shift families are exhausted.

2. **guitar-standard-chords-vector** (worst enforced fixture: pitch 0%, F1 35%, measureΔ +8):
   - 4 systems × 4 measures = 16 generated vs 8 truth
   - Systems 2–3 density-thinned from 8–9 → 4 barline spans (`collapsedPairs` total 8)
   - Staff-detection score 0; note recall 24%; **0** correct pitches among 28 matched
   - Root cause sits in **staff/system segmentation + measure allocation**, not a single symbol heuristic
   - Prior sprint already removed Guitar from Piano staff normalizer after dense regressions

3. **piano-dense-advanced-vector** still measureΔ **+11** with unreliable systems and vector note-column rejection already active. Broadening barline rejection previously regressed historical dense (wrongOnset 94→463) and was reverted.

## What would be required next (not done tonight)

- New IR evidence for staff-lane / system fusion on standard guitar notation (without TAB)
- Shadow-only voice serialization with ≥1 truth-approved canary before any runtime promotion
- Fixture-local experiments that prove ≥2 enforced fixtures improve with **zero** enforced regressions

## Policy followed

- Do not revive exhausted single-lane solvers
- Do not lower acceptance thresholds or inflate confidence
- Do not hardcode songs/pages/measures
- Stop changing OMR when no safe cross-fixture improvement exists
