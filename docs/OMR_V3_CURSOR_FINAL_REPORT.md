# OMR V3 Cursor Final Report

Date: 2026-07-17  
Branch: `codex/omr-v3-production-qualification`  
Continuation of the Codex production qualification sprint.

## Answers

### 1. How many independent regressions remain?

**3** detector-independent enforced regressions:

- `piano-articulation-scan`
- `guitar-paired-chords-vector`
- `guitar-techniques-paired-vector`

Started at **6**. Cleared: dense piano duration, grand-staff onset/voice, tuplet duration.

### 2. Which blockers were fixed?

| Phase | Fixture | Status |
| --- | --- | --- |
| 1 | `piano-dense-advanced-vector` | **Fixed** — packed stem-lane duration refine |
| 2 | `piano-grand-voices-vector` | **Fixed** — joint grand-staff beat-column snap |
| 3 | `piano-rhythm-tuplets-vector` | **Fixed** — single-staff subdivision grid + 3:2 tuplet ownership |
| 4 | `piano-articulation-scan` | **Not cleared** — raster beam graph infrastructure only |
| 5 | `guitar-paired-chords-vector` | **Partial** — pair recall ≈0.82–0.90; F1/onset/duration/chord still below V2 |
| 6 | `guitar-techniques-paired-vector` | **Partial** — pair recall 1.0; timing metrics still below V2 |

### 3. What generalized algorithms were added or changed?

1. **Packed approximate duration refine** (`omrV3Voices.js`) — shortens overlong stem/lane families; never lengthens.
2. **Joint grand-staff onset quantization** — snap shared columns when count==beats and gaps regular (±35%).
3. **Uniform subdivision recovery** — factors `{1,2,3,4}` for single-notation; factor 3 owns 3:2 tuplet ratio + `TUPLET` relationships.
4. **Raster `beamStemGraph`** on measures + detector ownership gated at confidence ≥ 0.7 (V3 handoff of weak scan beams withheld).
5. **Guitar notation/TAB pairing** — octave-aware pitch distance; rank fallback only when no pitch-compatible TAB; paired measure-end duration recovery.

### 4. Did any diagnostic fixtures worsen?

No intentional diagnostic threshold changes. Enforced non-target fixtures (beginner, grand, dense, tuplet, tab-sparse, standard-chords) remained non-regressing vs V2 on the axes checked after each phase. Scan V3 metrics were restored to baseline after rejected MAD onset snap and ungated beam handoff trials.

### 5. Did performance or memory regress?

No dedicated memory profiling this sprint. Full dashboard runtime remained on the order of prior qualification runs (~20–25s for the enforced corpus). No production-path V3 enablement.

### 6. Does the production gate pass?

**No.** `omrV3Shadow.productionGate`: `pass: false`, `status: blocked`, `regressionCount: 3`, plus `runtime-candidate-not-implemented` and `rollback-not-verified`.

### 7. Is V3 enabled?

**No.** V2 remains authoritative. Shadow-only; no runtime promotion.

### 8. What rollback protection exists?

Existing rollout switches (`omrV3Shadow` / `omrV3Rollback`) remain. Guarded production rollout was **not** added because the gate does not pass.

### 9. What requires human real-score review?

- Scanned piano beam/stem ink association quality vs false joins.
- Guitar paired scores: whether geometric onset columns can be musically corrected without labeled onset truth.
- Historical/non-musical scan pages and redistribution-safe real PDF truth (unchanged gap from Codex handoff).

### 10. What should be worked on next?

1. **Guitar joint onset timing** — all paired raw noteheads lack exact `onsetDivisions`; geometric positions dominate the remaining F1/onset/duration/chord gap despite high pair recall.
2. **Raster beam ink recovery** — increase high-confidence attachments without lowering the 0.7 floor; only then feed ownership into independent V3.
3. Re-run full gate + stress + browser smoke; if regressions hit 0, implement guarded rollout (flag + immediate V2 rollback) without deleting V2.

## Non-negotiables preserved

No threshold lowering, no fixture-name branches, no truth edits, no converting enforced tests to diagnostics, no V2 weakening, no V3 production enablement.

## Key commits (this campaign)

- `06072ef` — dense piano packed duration refine  
- `a53e2d0` — grand-staff joint onset quantization  
- `96538b4` — tuplet/subdivision duration inference  
- `33c3ed0` — conservative raster beam/stem graph (no scan promotion)  
- `3c06e54` — guitar pairing under unreliable pitch  

## Verdict

**Acceptable fallback outcome:** every safe improvement completed for this session; blockers reduced **6 → 3**; V2 remains authoritative; remaining work documented with focused tests and acceptance criteria.
