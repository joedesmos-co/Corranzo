# OMR V3 Cursor Final Report

Date: 2026-07-17  
Branch: `codex/omr-v3-production-qualification`  
Continuation of the Codex production qualification sprint.

## Answers

### 1. How many independent regressions remain?

**0** detector-independent enforced regressions.

Started at **6**. Cleared: dense piano duration, grand-staff onset/voice, tuplet duration, paired-guitar chords, paired-guitar techniques, scanned piano articulation.

### 2. Which blockers were fixed?

| Phase | Fixture / area | Status |
| --- | --- | --- |
| 1 | `piano-dense-advanced-vector` | **Fixed** — packed stem-lane duration refine |
| 2 | `piano-grand-voices-vector` | **Fixed** — joint grand-staff beat-column snap |
| 3 | `piano-rhythm-tuplets-vector` | **Fixed** — single-staff subdivision grid + 3:2 tuplet ownership |
| 4 | `piano-articulation-scan` | **Fixed** — detector-local packed rhythm stamp + stem-only handoff + bass gap fill |
| 5 | `guitar-paired-chords-vector` | **Fixed** — pairing + joint notation/TAB onset timing |
| 6 | `guitar-techniques-paired-vector` | **Fixed** — same joint onset path |
| 7 | Rollout tooling | **Fixed** — default-off runtime candidate + verified V2 kill switch |
| 8 | Real-PDF / negative-page | **Fixed (scaffolded)** — decorative-page isolation + Twinkle cover/music crops |

### 3. What generalized algorithms were added or changed?

1. Packed approximate duration refine (`omrV3Voices.js`).
2. Joint grand-staff onset quantization (regular spacing only).
3. Uniform subdivision recovery + 3:2 tuplet ownership.
4. Raster `beamStemGraph` with split stem/beam confidence gates; stem confidence recalibrated for short rendered stems.
5. Guitar notation/TAB pairing + joint onset timing.
6. Detector-local measure-packing onset/duration stamp into independent V3 raw symbols.
7. Grand-staff bass approximate duration lengthen to next lane onset.
8. Default-off `omrV3RuntimeCandidate` with category/`fullV3` promotion resolution, rollback kill switch, and byte-identity verification harness.
9. Conservative `classifyOmrNegativePage` isolation for decorative/non-musical pages.

### 4. Did any diagnostic fixtures worsen?

No threshold changes. Twinkle 2-page import no longer unsafe-accepts cover false notes (now isolates cover, then honestly rejects the music page on low confidence). Enforced fixtures remain non-regressing.

### 5. Did performance or memory regress?

No dedicated memory profiling. Full dashboard ~20–25s. V3 remains default-off.

### 6. Does the production gate pass?

**Yes** on the metric + rollout evidence gate (`tmp/cursor-full/report.json`):

- `productionGate.pass === true`
- `regressionCount: 0`
- `runtimeCandidateImplemented: true`
- `rollbackVerified: true`

Global handoff still asks for independently verified scan MusicXML before enabling any production cohort.

### 7. Is V3 enabled?

**No.** V2 remains authoritative. Promotions resolve only when `omrV3RuntimeCandidate: true` and rollback is off.

### 8. What rollback protection exists?

- `omrV3Rollback` synchronously disables shadow, candidate arming, and promotions.
- Live harness verifies V2 MusicXML byte-identity for shadow, idle candidate, promotions-without-candidate, and rollback paths.
- Invalid independent V3 MusicXML never replaces production output.

### 9. What requires human real-score review?

- Independently verified MusicXML for the Twinkle 1880 music-page crop (or equivalent redistribution-safe scan crop).
- Visual confirmation that broader scan corpora still isolate covers without stripping real music.
- Explicit opt-in before any UI cohort receives `omrV3RuntimeCandidate`.

### 10. What should be worked on next?

1. Independently verified MusicXML for a redistribution-safe scan crop remains **human-blocked** (Theme crop dual transcription disagreed; do not infer truth).
2. Keep V3 default-off until that truth + visual review are green.
3. Dense duration residual is research-bound beyond V2 parity (onset/voice/pitch coupled); Phase 1b stopped bass gap-lengthen from undoing packed shorten.
4. Grand residual pitch (0.625, tied with V2) is accidental/pitch-mapping, not onset/voice; Phase 2b fixed simultaneous chord grouping.

## Non-negotiables preserved

No threshold lowering, no fixture-name branches, no truth edits, no converting enforced tests to diagnostics, no V2 weakening, no default V3 enablement.

## Key commits (this campaign)

- `06072ef` — dense piano packed duration refine  
- `a53e2d0` — grand-staff joint onset quantization  
- `96538b4` — tuplet/subdivision duration inference  
- `33c3ed0` — conservative raster beam/stem graph  
- `3c06e54` — guitar pairing under unreliable pitch  
- `df1cb8b` — guitar joint onset timing  
- `ecf1819` — scanned piano clearance  
- `2a40d2a` — bass gap-lengthen must not undo packed subdivision shorten  
- (pending) — guarded runtime candidate + rollback verification  
- (pending) — negative-page classifier + Twinkle cover/music crops  
- (pending) — grand-staff column chord grouping (ignore singleton stems / stemless wholes)  
