# OMR V3 Cursor Final Report

Date: 2026-07-17  
Branch: `codex/omr-v3-production-qualification`  
Continuation of the Codex production qualification sprint.

## Answers

### 1. How many independent regressions remain?

**0** detector-independent enforced regressions.

Started at **6**. Cleared: dense piano duration, grand-staff onset/voice, tuplet duration, paired-guitar chords, paired-guitar techniques, scanned piano articulation.

### 2. Which blockers were fixed?

| Phase | Fixture | Status |
| --- | --- | --- |
| 1 | `piano-dense-advanced-vector` | **Fixed** — packed stem-lane duration refine |
| 2 | `piano-grand-voices-vector` | **Fixed** — joint grand-staff beat-column snap |
| 3 | `piano-rhythm-tuplets-vector` | **Fixed** — single-staff subdivision grid + 3:2 tuplet ownership |
| 4 | `piano-articulation-scan` | **Fixed** — detector-local packed rhythm stamp + stem-only handoff + bass gap fill |
| 5 | `guitar-paired-chords-vector` | **Fixed** — pairing + joint notation/TAB onset timing |
| 6 | `guitar-techniques-paired-vector` | **Fixed** — same joint onset path |

### 3. What generalized algorithms were added or changed?

1. Packed approximate duration refine (`omrV3Voices.js`).
2. Joint grand-staff onset quantization (regular spacing only).
3. Uniform subdivision recovery + 3:2 tuplet ownership.
4. Raster `beamStemGraph` with split stem/beam confidence gates; stem confidence recalibrated for short rendered stems.
5. Guitar notation/TAB pairing + joint onset timing.
6. Detector-local measure-packing onset/duration stamp into independent V3 raw symbols.
7. Grand-staff bass approximate duration lengthen to next lane onset.

### 4. Did any diagnostic fixtures worsen?

No threshold changes. Enforced non-target fixtures remained non-regressing vs V2 on the full gate after the scan phase.

### 5. Did performance or memory regress?

No dedicated memory profiling. Full dashboard ~20–25s. V3 still shadow-only.

### 6. Does the production gate pass?

**Not fully.** `regressionCount: 0`, but still blocked by:

- `runtime-candidate-not-implemented`
- `rollback-not-verified`

### 7. Is V3 enabled?

**No.** V2 remains authoritative.

### 8. What rollback protection exists?

Existing `omrV3Shadow` / `omrV3Rollback` switches. Guarded runtime candidate + verified V2 rollback still required.

### 9. What requires human real-score review?

- Redistribution-safe real PDF truth and decorative/non-musical negative pages (handoff §6).
- Stem/beam ink quality on broader scan corpora beyond the articulation fixture.

### 10. What should be worked on next?

1. Implement default-off runtime candidate + synchronous V2 kill switch; verify byte-identical V2 MusicXML when V3 is off/rolled back.
2. Add real-PDF / negative-page fixtures per handoff §6.
3. Only then clear `runtime-candidate-not-implemented` / `rollback-not-verified`.

## Non-negotiables preserved

No threshold lowering, no fixture-name branches, no truth edits, no converting enforced tests to diagnostics, no V2 weakening, no default V3 enablement.

## Key commits (this campaign)

- `06072ef` — dense piano packed duration refine  
- `a53e2d0` — grand-staff joint onset quantization  
- `96538b4` — tuplet/subdivision duration inference  
- `33c3ed0` — conservative raster beam/stem graph  
- `3c06e54` — guitar pairing under unreliable pitch  
- `df1cb8b` — guitar joint notation/TAB onset timing  
- (this commit) — scan packed-rhythm stamp + stem-only handoff + bass gap fill  

## Verdict

**Recognition gate cleared:** independent enforced regressions **6 → 0**. V2 remains authoritative. Production enablement still blocked until guarded rollout + rollback verification and real-score evidence land.
