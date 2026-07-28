# Corranzo OMR Recognition Campaign — Final Report

**Status: Phase 1 + Phase 2 ACCEPTED AND FROZEN** · Phase 3 documented, unchanged  
Date: 2026-07-28  
Control score: A Cruel Angel’s Thesis (Evangelion)  
Freeze: ActiveScore, PDF cache, repeats/written fallback, chunked playback, Piano sampler, note type/dot/beam propagation, ties/slurs, accidentals/keys, articulations, tempo/dynamics, Guitar mapping, Musical Structure Sprint 1, frozen evaluator — preserved.  
No duration limit raise, no final duration clamp, no filename hardcoding, no global chord-tolerance widen, no audio masking, no evaluator changes.

Campaign artifacts: `tmp/corranzo-omr-recognition-campaign/`  
Backlog (do not start yet): `BACKLOG.md` · Smoke: `SMOKE_CHECKLIST.md`

---

## 1. Fantaisie written-duration recognition — ACCEPTED

**Reproduced:** Written clock ~14 min / 193 measures (truth ~138 measures / ~4–5 min performed). Per-measure ql already nominal; excess was extra measures + stuck Largo tempo.

**First failing stage:** `groupStavesIntoSystems` — page 4 had 17 staves (odd); pairing disabled → 17 single-staff systems → 78 measures (truth 29).

**Root cause:** One merged double-height staff band made stave count odd.

**Accepted fix:** Orphan outlier recovery in staff pairing (`detectStaffLines.js`) — leave geometric outlier as solo system; pair remaining even set when gaps are consistent.

**Before → after:** 193→144 measures (truth 138); page 4: 78→29; clock 14.0→10.1 min; notes ~3030 unchanged. Evangelion/Minecraft unchanged.

**Residual:** Largo@50 never superseded by Presto/Allegro return (tempo recognition); metronome beat-unit (quarter vs half).

Details: `PHASE1_FANTAISIE_REPORT.md`

---

## 2. Minecraft sparse/long-value recognition — ACCEPTED

**Reproduced:** Duration OK (~3.8 min). Wholes under-count, quarters over-count; X-gap overrode open noteheads.

**First failing stage:** `buildNoteEventsFromGroups` gap/`durationMeta` on sparse measures.

**Root cause:** U+E0A2/U+E0A3 only marked hollow; gap duration outranked glyph semantics.

**Accepted fix:** `noteheadGlyph` distinction; glyph-authoritative duration on non-dense measures; no re-stretch past glyph cap in `extendDurationsPerClefVoice`.

**Before → after (with curve extractor):** wholes 100→151 (truth 165); quarters 226→105 (truth 129); ties 62 preserved; duration unchanged. Evangelion identical; Fantaisie Phase 1 intact.

**Residual:** dotted-quarter still 0; dotted-half still over-count.

Details: `PHASE2_MINECRAFT_REPORT.md`

---

## 3. Hungarian dense/multi-voice recognition — NO SAFE FIX

**Reproduced:** Duration OK; note count ≈ truth; rhythm types badly wrong (eighth/16th → quarter).

**First failing stage:** Dense beam/rhythm packing on path-heavy engraving — no single mechanical switch like Phases 1–2.

**Decision:** Production unchanged. Do not widen chord tolerances or thin dense events.

Details: `PHASE3_HUNGARIAN_REPORT.md`

---

## Production code changed (campaign)

| Area | File | Phase |
|---|---|---|
| Odd-stave grand-staff pairing | `src/features/score-follow/detectStaffLines.js` | 1 |
| Whole/half glyph duration | `src/features/omr/processVectorOmrPage.js`, `detectNoteRhythmFeatures.js` | 2 |
| Tests | `tests/omrPitchStaffMapping.test.js`, `omrVectorRhythm.test.js`, `detectNoteRhythmFeatures.test.js` | 1–2 |

Phase 3: no production diff.

---

## Regression gates (accepted phases)

Focused unit tests for staff pairing, vector rhythm, duration overflow, Musical Structure Sprint 1, Notation Fidelity 2/5, playback chunking — passed.  
Real-score controls: Evangelion signature unchanged after both accepted phases; Fantaisie Phase 1 intact after Phase 2; Minecraft duration/ties intact after Phase 2.

---

## Honest verdict

**Not all three fixed.** Fantaisie written-measure inflation and Minecraft sparse long-value typing improved with separable general fixes. Hungarian dense accuracy remains open. Do not claim full campaign success.
