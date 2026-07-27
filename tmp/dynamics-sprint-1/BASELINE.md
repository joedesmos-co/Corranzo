# Dynamics Recognition Sprint 1 — Baseline & Defect Taxonomy

## Preconditions (frozen)
- **Interpretation Sprint 1** accepted and frozen (repeats/voltas). Do not retune.
- Guitar Mapping Sprint 1 frozen.
- Semantic evaluator frozen (`2.0.0` / schema `2`).
- Dynamics are listed in `SEMANTIC_EVAL_UNSUPPORTED` — **not separately scored** by the frozen evaluator.
- Do not change Pitch / Rhythm / Sustain / Articulation / Measure Structure / repeats.

## Exact current Dynamics status (corpus)

### Evaluator
- Class store: **future / unsupported** (`docs/OMR_SEMANTIC_DEFECT_TAXONOMY.md`).
- Frozen evaluator explicitly ignores: `dynamics as scored values (p/f continuum)`, `hairpins / wedges`.
- Therefore corpus “Dynamics before/after” must come from an **independent recognition harness**, while the frozen semantic corpus is a **non-regression gate** only.

### Truth MusicXML (enforced fixtures)
- **0 / 10** fixtures contain `<dynamics>`, `<wedge>`, or cresc/dim words.
- No TP/FN possible against frozen truth MusicXML for dynamics.

### PDF text / glyphs (enforced fixtures)
- Almost no dynamic tokens in the text layer.
- `guitar-techniques-paired-vector` has literal `"p"` in the music font (likely technique/fingering context — not trusted as a dynamic without geometry gates).
- No SMuFL U+E520–E54F dynamic glyphs observed in the enforced PDF text stream.

### Current OMR emission (vector-dominant corpus)
- Sampled fixtures emit **zero** `<dynamics>` / `<wedge>` today.
- Dominant failure mode for real dynamic-bearing scores is **markings never detected / never attached on the vector path**.

## Current code path (defective)

| Stage | Current behavior | Defect class |
| --- | --- | --- |
| Vector text/glyph | No per-measure dynamic attachment on vector path | never detected |
| Raster text | `detectDynamicsFromTextItems` returns **first** page-level match | wrong onset / duplicate |
| Raster ink | `detectDynamicNearMeasure` invents `p`/`mf`/`f` from dark-pixel counts under the staff | misclassified / FP |
| Association | Page dynamic applied to **every** raster measure via `systemTextDynamic ?? …` | wrong staff / onset / duplicates |
| Hairpins | **None** | never detected |
| SMuFL dynamics | **None** | never detected |
| MusicXML | Emits `<dynamics><mark/></dynamics>` only when `measure.dynamic` passes confidence; **no wedge** | not emitted / incomplete |
| Playback | `dynamicsMap.js` already maps MusicXML dynamics → velocity if present | secondary |

## Dominant root causes (ordered)
1. **Markings never detected** on vector path (and hairpins/SMuFL never implemented).
2. **Recognized but not positioned** — page-level first-hit text, not measure/onset association.
3. **Misclassified / invented** — conservative ink blob → `p`/`mf`/`f` without glyph/text evidence.
4. **Duplicate emissions** risk if a page-level dynamic is stamped onto every measure.
5. **Hairpin start/stop mismatch** — no wedge detector at all.
6. Staff/voice association not implemented.

## Sprint 1 measurement plan
1. Independent harness + synthetic fixtures with known dynamics/hairpins.
2. Metrics: TP/FP/FN by symbol (`pp,p,mp,mf,f,ff`, cresc/dim text, cresc/dim wedge); staff-association errors; onset-association errors.
3. Frozen semantic corpus: Overall / Pitch / Rhythm / Sustain / Articulation / Measure / Interpretation must not drop >1 pp.

## Scope
Recognize and emit: `pp p mp mf f ff`, `cresc.` / `dim.`, crescendo & diminuendo hairpins.
Recognition + MusicXML first; no artificial playback volume curves.
