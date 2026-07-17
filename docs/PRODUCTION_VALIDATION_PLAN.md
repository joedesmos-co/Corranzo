# OMR V3 Production Validation Plan

Date: 2026-07-17  
Branch: `codex/omr-v3-production-qualification`  
Status: **V2 authoritative; V3 default-off; comparison / diagnostics ready for real-world evaluation**

This plan covers the Production Validation & Rollout Preparation phase completed after the algorithmic Production Readiness Campaign. It does **not** change recognition algorithms or benchmark floors.

---

## 1. Current rollout audit (verified)

| Control | Behavior | Evidence |
| --- | --- | --- |
| `omrV3RuntimeCandidate` | Default **false**. Promotions resolve only when armed and rollback is off. | `resolveOmrV3RolloutOptions`, `assessOmrV3RuntimeCandidateReadiness` |
| Feature flags / promotions | Keys: `structure`, `measureGeometry`, `pianoGrouping`, `guitarFusion`, `fullV3`. Only `fullV3` may swap MusicXML. | `omrV3Rollout.js` |
| Rollback (`omrV3Rollback`) | Kill switch: disables shadow, candidate, and all promotions synchronously. | Resolver mode `rollback` |
| V2 byte-identical when V3 disabled | Shadow / idle candidate / promotions-without-candidate / rollback preserve production MusicXML. | `verifyOmrV3RollbackByteIdentity`, `tests/omrV3Rollout.test.js` |
| Production gate | `pass: true`, `status: eligible-for-production-rollout`, `regressionCount: 0`, candidate + rollback verified, `promotedToRuntime: false`. | Latest full dashboard JSON |

**Invariant:** default UI / pipeline calls do not pass rollout flags → users always receive V2 MusicXML.

---

## 2. Comparison mode (implemented)

**Pipeline option:** `omrV3Compare: true`

Behavior:

1. Runs independent V3 beside V2 (captures raw detector symbols).
2. Keeps **V2** as `result.musicXml` (user-visible) unless an armed `fullV3` promotion is separately requested.
3. Attaches `result.omrV3Comparison` with:
   - measure differences
   - note differences (missing / extra / F1)
   - rhythm differences (duration + onset)
   - chord differences
   - pitch differences
   - confidence differences
   - compact disagreement samples (no PDF bytes)
4. Attaches `result.omrV3RuntimePromotion.disagreement` — telemetry-safe counts only.
5. Attaches `result.omrV3DeveloperDiagnostics` — side-by-side MusicXML lengths, timings, recognition stats, confidence, stages.

**Dev UI:** localStorage / panel toggles (non-PROD only):

| Flag | Effect |
| --- | --- |
| `scoreflow:omr-v3-compare=1` | Enables comparison mode on upload |
| `scoreflow:omr-v3-prefer=1` | Developer audition: accept V3 MusicXML into the library payload (does **not** arm runtime promotion) |
| `scoreflow:omr-v3-telemetry=1` | Logs compact disagreement telemetry via `omrTrace` |

Modules:

- `src/features/omr/v3/omrV3Comparison.js`
- `src/features/omr/v3/omrV3Diagnostics.js`
- `src/features/omr/omrDiagnosticFlags.js`
- `src/features/omr/omrDevTools.js`
- Wired in `runPdfOmrPipeline.js` and `PdfOmrPlaybackPanel.jsx`

---

## 3. Developer diagnostics (implemented)

Available when shadow or compare runs:

- Toggle V2 vs V3 output (`selectOmrDeveloperMusicXml` / Prefer V3)
- Side-by-side MusicXML (`omrV3DeveloperDiagnostics.musicXml.{v2,v3}`)
- Timing (`timing.phases`, V3 confidence / shadow / independent shadow ms)
- Recognition statistics (note/measure counts, serializer validity, independent event rate)
- Pipeline stage timings (`diagnostics.performance.phases`)
- Confidence summaries (legacy vs V3 hierarchical overall / structural)
- Copy diagnostic JSON includes compact comparison + promotion disagreement (no PDF)

---

## 4. Telemetry audit

| Channel | When emitted | Contents | PDF retained? |
| --- | --- | --- | --- |
| `omrV3RuntimePromotion` | Shadow, compare, candidate, rollback, or any promotion request | decision, category, latency, byte-length Δ, **disagreement** counts | No |
| `omrV3Comparison` | Compare or shadow with independent MusicXML | Structured V2↔V3 report | No |
| `omrTrace('ui:omr-v3-disagreement')` | Dev + compare/telemetry flag | Compact disagreement object | No |
| V3 confidence on diagnostics | Default production (confidence-only) | Calibrated confidence; does not swap notes | No |

**Gap closed for validation:** disagreements can be logged without affecting users when compare/shadow is enabled. Default production still omits promotion telemetry (no flags → no overhead beyond existing confidence reasoning).

---

## 5. Maintainability work completed in this phase

- Documented comparison / candidate / rollback behavior in `OMR_V3_IR_SPEC.md` (removed stale “promotions always false” wording).
- Added focused comparison module + diagnostics builders with explicit naming (`compare`, `disagreement`, `developerDiagnostics`).
- Added `tests/omrV3Comparison.test.js`.
- No recognition algorithm changes; no benchmark truth edits; no threshold weakening.
- Campaign `tmp/` probes remain outside `src/` (no production imports).

---

## 6. How to evaluate real uploaded PDFs

### 6.1 Local developer evaluation

1. Run the app in DEV.
2. Enable **V3 compare** in the PDF OMR panel (or `localStorage.setItem('scoreflow:omr-v3-compare','1')`).
3. Upload a real PDF; wait for practice-ready.
4. Confirm the library accepted MusicXML is still V2 (`outputEngine` / `userVisibleEngine` = `v2`) unless Prefer V3 is on.
5. Copy diagnostic JSON → inspect `omrV3Comparison`, `disagreement`, timings.
6. Optionally enable Prefer V3 to audition candidate MusicXML in the practice UI without promoting globally.

### 6.2 Scripted / offline evaluation

```bash
# Full enforced gate (must stay green)
npm run omr:benchmark-dashboard -- \
  --json tmp/cursor-validation/report.json \
  --md tmp/cursor-validation/report.md

jq '.omrV3Shadow.productionGate' tmp/cursor-validation/report.json

# Production-path profile without shadow overhead
npm run omr:benchmark-dashboard -- --no-v3-shadow \
  --json tmp/cursor-validation/no-shadow.json \
  --md tmp/cursor-validation/no-shadow.md
```

For ad-hoc PDFs, call `runPdfOmrPipeline(pdf, { omrV3Compare: true, … })` and persist only `omrV3Comparison` + disagreement telemetry (never the PDF).

### 6.3 Recommended validation corpus (human review)

| Bucket | Examples | Goal |
| --- | --- | --- |
| Clean vector piano | beginner / grand / dense CC0 fixtures | Confirm V3 ≥ V2 structurally |
| Scanned piano | articulation-scan; licensed real scans | Spot chord / pitch / duration disagreements |
| Guitar paired | chords + techniques | Confirm fusion disagreements are explainable |
| Negative / cover | Twinkle cover crop | Confirm honest reject; zero playable events |
| Dense / orchestral stress | import-only diagnostics | Confirm low-confidence reject, not silent garbage |

Do **not** invent MusicXML truth for ambiguous historical scans (Theme crop remains human-blocked).

---

## 7. How to triage V2 ↔ V3 disagreements

1. **Read `disagreement.categories`** — measures / notes / rhythm / chords / pitch / confidence.
2. **Check serializer validity** — `invalidEventCount`, duplicates, voice overlaps must stay 0 on V3.
3. **Separate evaluator coupling from ownership loss** — different-voice pitch matches are often grouping artifacts, not pitch ownership.
4. **Attribute to owner:**
   - **V3 structure** (onset / voice / duration packing / guitar fusion) → file as V3-owned defect with first-loss proof before any algorithm change.
   - **Shared detector** (pitch / accidentals / staff register) → detector track; do not “fix” in V3 by inventing pitch.
   - **Ambiguous scan / missing GT** → human truth queue; do not change algorithms.
5. **Reproduce** with `omrV3Compare` and the same PDF render settings; store comparison JSON only.
6. **Do not** tune thresholds or special-case fixture IDs during triage.

---

## 8. Evidence required to promote V3 to the default runtime

All must be true before setting `omrV3RuntimeCandidate` + `fullV3` as a **default** (or enabling it for a user cohort in production UI):

1. Enforced independent gate remains `pass` with `regressionCount: 0`.
2. Independently verified MusicXML exists for at least one redistribution-safe real scanned music page (handoff §6 gap closed).
3. Negative-page classifier remains green (covers / decorative pages do not emit playable events; healthy music not stripped).
4. Real-upload comparison cohort: disagreement rates and severity reviewed by humans on a documented sample (size TBD by product; suggest ≥ 20 diverse PDFs).
5. Production-path speed / memory / worker responsiveness do not regress materially vs `--no-v3-shadow` baseline.
6. Rollback kill switch re-verified on the build under test (`verifyOmrV3RollbackByteIdentity`).
7. Product visual QA: Upload PDF → Setting up your music… → Practice ready on representative PDFs.
8. Explicit product decision to arm the candidate for a **named cohort** (not global default on day one).

Until then: **keep V3 default-off**; use comparison mode for evaluation only.

---

## 9. Rollback criteria (immediate kill switch)

Engage `omrV3Rollback: true` (or disable candidate / promotions) if any of:

- Invalid events, duplicates, or voice overlaps appear in promoted V3 output.
- User-visible practice breaks (wrong measure count, empty score, crash) attributable to V3 MusicXML.
- Material latency or memory regression on the production path.
- Unexpected promotion (`promotedToRuntime: true`) outside an armed cohort.
- Integrity failure: V2 MusicXML not byte-identical when V3 is off / rolled back.

Rollback must restore V2 MusicXML synchronously; no partial V3 stages may remain user-visible.

---

## 10. Success metrics

| Metric | Target for continued default-off validation | Target before default runtime |
| --- | --- | --- |
| Enforced gate `regressionCount` | 0 | 0 |
| Independent primary event rate | 1 on recognition fixtures | 1 |
| Invalid / duplicate / overlap events | 0 | 0 |
| Comparison mode: V2 still user-visible | 100% when compare-only | 100% until cohort armed |
| Real-scan verified truth | Scaffolded | Present + reviewed |
| Human-reviewed upload sample | Optional | Required, documented |
| Rollback verification | Green on each release candidate | Green |
| Promotion telemetry completeness | Disagreement logged when compare/shadow on | Same + cohort decision logged |

Absolute accuracy floors in the manifest remain **regression guards**, not product accuracy promises.

---

## 11. Recommended staged rollout sequence

1. **Shadow / compare only** (current) — engineers enable compare; users get V2.
2. **Internal cohort** — arm `omrV3RuntimeCandidate` + `fullV3` for internal builds only; kill switch rehearsed.
3. **Opt-in beta** — small external cohort behind an explicit product flag; disagreement telemetry collected.
4. **Default runtime** — only after §8 evidence checklist is complete.

Category promotions (`structure`, `guitarFusion`, …) arm cohort telemetry only; they do not swap MusicXML. Use them for analytics segmentation, not partial MusicXML grafts.

---

## 12. What this phase intentionally did not do

- No recognition algorithm changes.
- No benchmark truth edits or threshold weakening.
- No enabling of V3 as default for end users.
- No inventing ground truth for ambiguous historical scans.

---

## 13. Key files

| Area | Path |
| --- | --- |
| Rollout control | `src/features/omr/v3/omrV3Rollout.js` |
| Rollback verification | `src/features/omr/v3/omrV3RolloutVerification.js` |
| Comparison report | `src/features/omr/v3/omrV3Comparison.js` |
| Developer diagnostics | `src/features/omr/v3/omrV3Diagnostics.js` |
| Pipeline wiring | `src/features/omr/runPdfOmrPipeline.js` |
| Dev flags | `src/features/omr/omrDiagnosticFlags.js`, `omrDevTools.js` |
| UI toggles | `src/components/library/PdfOmrPlaybackPanel.jsx` |
| Tests | `tests/omrV3Rollout.test.js`, `tests/omrV3Comparison.test.js` |
| Campaign history | `docs/OMR_V3_CURSOR_PROGRESS.md`, final readiness report in chat |

---

## Bottom line

V3 is **engineering-eligible** for staged evaluation behind compare/shadow and a default-off runtime candidate. It is **not** authorized as the default production engine until real-PDF verified truth and human upload review close the remaining pre-production gaps. Use this plan as the operating procedure for that evaluation.
