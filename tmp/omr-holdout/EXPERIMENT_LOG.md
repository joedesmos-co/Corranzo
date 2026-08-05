# Holdout generalization experiment log

## 2026-08-05 — Program start / Phase 0–4

- Verified HEAD `fc7af58`; working tree clean.
- Confirmed `fc7af58` only adds `tmp/` artifacts; production OMR still `f091ee7`, freeze tests `613fa73`.
- Reproduced frozen corpus 9/9 Overall 88.2%; freeze tests 5/5.
- Provenance audit: **0→3** strict (A) holdouts after Downloads distinctive-token audit; all guitar PDFs.
- Prior autonomous `heldout-final-*` user PDFs classified **C** (already processed).
- Practice library / stress / cache classified **C**.
- Frozen nine = **D**.
- Freeze + split recorded; untouched baseline run **without production edits**.
- Strict 3/3 accepted; no crashes; semantic Overall N/A (no audited truth).
- Leading candidate clusters: notation–TAB pairing residual (Guaraldi/Bach); TAB-only stem rhythm (Pirates); sealed-eval slur/measure suspicions deferred.
- **Phase 6 not started** — insufficient coverage + no PDF-confirmed multi-score defect with event truth.
- Acquisition checklist written.

## Rejected

- Promoting practice-library or prior heldout user PDFs to category A.
- Using frozen nine to fill coverage gaps.
- Starting pairing repairs from diagnostic confidence alone without event truth.
- Tuning against sealed evaluation Bach observations.

## 2026-08-05 — Strict holdout acquisition attempt (blocked)

- Verified HEAD `fc7af58`; `src/features/omr` identical to `f091ee7`; freeze test file only delta under `tests/`.
- Inspected `~/Downloads/corranzo-holdout-intake/` → **does not exist**.
- New category-A scores: **0**. No provenance reclassification of existing pack.
- Manifest / split / untouched baseline for the three guitar A scores **preserved**.
- Production OMR edits: **0**. Repair gate: **not reached**.
- Updated exact checklist: `HOLDOUT_ACQUISITION_CHECKLIST.md`; coverage: `STRICT_COVERAGE_MATRIX.md`; attempt log: `ACQUISITION_ATTEMPT_2026-08-05.md`.
- Next: user creates intake folder and drops ≥8 new unseen piano-heavy scores, then resume acquisition program.

## 2026-08-05 — Acquisition resume (intake still absent)

- User asserted `~/Downloads/corranzo-holdout-intake/` now contains candidates.
- Agent re-check: directory **still does not exist** on the visible filesystem.
- `~/Downloads` mtime remains 2026-07-31; no `*holdout*intake*` directory under home (maxdepth 4 / mdfind).
- Production OMR still `f091ee7` (no `src/features/omr` diff). No production edits.
- Strict pack unchanged (3 guitar A). Repair gate not reached.
- Waiting on user to create/populate the intake path visible to Terminal.

## 2026-08-05 — Vector piano tuplet campaign (accepted)

- Starting HEAD: `fc7af58` (production OMR ≡ `f091ee7`).
- Inventory: `VECTOR_TUPLET_INVENTORY.md`.
- Root cause: `recoverDigitGatedTriplets` full-bar-only + above-only digit band; emitter missing tuplet start/stop.
- Implementation: local 3:2 digit-gated groups; above/below digits; MusicXML `<time-modification>` + balanced `<tuplet>`; `enableLocalTupletGroups: !tabCapable`.
- Accepted commit: `648651a` `fix(omr): recognize vector tuplet groups`.
- Development: Pokémon 15/15 balanced groups; Mario 8/8; Korobeiniki/Guaraldi/TAB `tm=0`.
- Frozen: Overall 88.2%; freeze 5/5; source-supported defects 0.
- Sealed milestone: 4/4 accepted; aggregate notes stable; sealed piano `tm` delta +6 / 2 balanced groups noted without semantic tuning.
- Rejected post-accept tighten attempts (beam-required Pattern B / stricter spacing): hurt Pokémon/Mario recall without clearing sealed FP under no-sealed-tuning policy → reverted to `648651a` tree.
- Next: vector repeat-barline inventory + repair (Korobeiniki, Mario, Guaraldi).

## 2026-08-05 — Vector repeat barline experiment 1 (rejected / reverted)

- Inventory: `VECTOR_REPEAT_BARLINE_INVENTORY.md` (leading mechanism: raster thin+thick separation fails on anti-aliased vector thick bars; Guaraldi endings via text OK).
- Attempt: widen double-bar window; merged-thick fallback; single-staff colon for vector modes; abutting high-strength run merge.
- Result: Guaraldi briefly emitted 1 backward repeat; Korobeiniki/Mario remained 0 in full pipeline; synthetic `pdfOmrMusical` repeat fixture regressed.
- Action: **fully reverted** `detectOmrRepeatBarline.js` to `648651a`. Freeze + musical tests restored.
- Next hypothesis: vector path/glyph colon + explicit thick-bar classification without changing separated-pair scan path; or detect repeats from PDF operator paths before rasterization.
