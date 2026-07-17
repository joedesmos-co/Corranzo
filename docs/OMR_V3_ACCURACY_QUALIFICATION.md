# OMR V3 Accuracy Campaign — Shadow Qualification

Date: 2026-07-16  
Qualification command: `npm run omr:benchmark-dashboard` with the complete 20-fixture manifest.

## Verdict

**Accuracy blocker cleared; full production replacement not yet qualified.**

The campaign objective is met: enforced V3 regressions fell from **6 to 0** without changing a confidence threshold, benchmark fixture, rollout flag, or production MusicXML path. The production dashboard remains green at **10 pass, 0 fail, 0 error**, and the stress outcomes remain stable.

OMR V3 should remain shadow-only for now because the unchanged promotion gate still fails two independent conditions:

1. Only one enforced fixture has a genuine improvement; policy requires two.
2. `guitar-paired-scan` rejects honestly before a V3 shadow document is captured, leaving one enforced fixture unavailable to the gate.

The shadow adapter also still begins with legacy detector event evidence. It now preserves that evidence correctly through the V3 IR, but this is not yet an independent raw-symbol recognition qualification. Full V2 replacement would therefore claim broader coverage than the current evidence proves.

## Qualification evidence

| Check | Result |
| --- | --- |
| Dashboard fixtures | 20 |
| Enforced pass | 10/10 |
| Diagnostic skip | 10/10, as policy requires |
| Fail / error | 0 / 0 |
| V3 shadows ready | 15 |
| Enforced V3 regressions | **0** |
| Enforced improved fixtures | 1 (required: 2) |
| Unavailable enforced V3 fixtures | 1 (`guitar-paired-scan`) |
| Policy violations | 0 |
| Invalid / duplicate V3 events | 0 / 0 |
| V3 voice-overlap violations | 0 |
| Promotion status | `shadow-only` |
| Runtime promoted | no |

All candidate promotions remain `not-promoted`: structure, measure geometry, Piano grouping, Guitar fusion, and full V3.

## What is qualified

- V3 can preserve all currently enforced V2 accuracy metrics across every enforced fixture that reaches shadow execution.
- Dense Piano still improves pitch, duration, onset, chord grouping, note F1, and measure-count error.
- Grand-staff grouping recovers incomplete detector bands when their source-system provenance agrees.
- Guitar notation/TAB systems retain detector partner identity, one shared measure timeline, source pitch semantics, and source event boundaries.
- Paired Guitar mirror recall is 89.01% on the dense paired fixture and 100% on the techniques fixture.
- TAB-only timing keeps observed detector onset/duration evidence instead of replacing it with spacing estimates.
- Complete detector measure grids are no longer subdivided by missing-barline recovery.
- Production output and rollout behavior are unchanged.

## What is not qualified

- There is no post-recognition V3 shadow for the paired Guitar scan. This prevents complete enforced coverage even though the rejection itself is correct.
- Raw symbol-stage independence is not established; the adapter intentionally reuses legacy event evidence.
- Structural exact-match scores remain modest on the current engraving-break evaluator (staff-group accuracy is 0.25–0.50 on most enforced emitted fixtures, 0.333 on dense Piano). These values are not hidden by confidence averaging.
- Diagnostic `dense` and `wet-hands-guitar` still contain non-enforced V3-vs-runtime metric gaps. They improved substantially from the campaign baseline, but they are not parity evidence.
- Dense orchestral and Pathétique stress PDFs still reject at low confidence.

## Production recommendation

Do **not** replace V2 in production in this sprint. Keep the current effortless PDF import UI and keep V3 shadow capture enabled only where already allowed.

The next promotion attempt should require all of the following:

1. Capture a structure-only V3 result before honest import rejection so `guitar-paired-scan` and similar real PDFs have enforced shadow coverage.
2. Feed raw detected notation/TAB symbols into the V3 ownership stage, then repeat the same truth evaluation without relying on legacy reconstructed events.
3. Produce a second genuine enforced improvement without regressing any fixture; do not relax the two-improvement gate.
4. Re-run full stress, memory, worker, browser, and import-flow qualification.

At that point a staged component promotion can be considered. Full-V3 production promotion should still follow only after the unchanged gate passes.
