# Corranzo OMR Campaign — Dot Attachment & Dense Rhythm

**Date:** 2026-07-28  
**Frozen baseline commit:** `541f607e230611e37f377f4a106f42ab57822c65`  
**Message:** `fix(omr): recover tempo returns and sparse dotted values`

**Overall verdict:** both phases **REVERTED**. Production remains at the frozen baseline.
No Phase 1 or Phase 2 ship commits. RCA accepted.

**DEV provenance instrumentation:** frozen in a diagnostics-only commit
(`chore(omr): add dev rhythm provenance diagnostics`). Recognition behavior unchanged.

**Do not attempt further Minecraft dot or Hungarian duration recognition fixes** until
≥2 unrelated soak scores share the same provenance mechanism (see `soak/`, `SOAK_SUMMARY.md`).

---

## Fantaisie tempo — fully validated and frozen

Real-browser seek validation (Playwright / Vite `127.0.0.1:5173`):

| Seek | BPM |
|------|-----|
| ~5s | **84** |
| ~130s | **50** |
| ~145s | **108** |
| ~240s | **168** |

Duration ≈ 5.205 min. **Do not modify** Fantaisie tempo-word recovery or this map.
Evidence: `BASELINE.md`, terminal seek run.

Baseline UI smoke also held: Minecraft `quarter.=17` / wholes `144` / ties `62`;
Evangelion 125 measures / `quarter.=15`.

---

## 1. Minecraft — augmentation-dot attachment & open noteheads

**Verdict: REVERTED** (RCA accepted)

### Frozen baseline
`541f607e230611e37f377f4a106f42ab57822c65`

### Verified case-set
`phase1-minecraft/` — glyphs, dyFail RCA, truth-vs-gen.  
Dots, open±stem, filled, chords, ties-near-dots, staccato/repeat/text controls.

### Reproduced failures
- Dotted quarters: **17** vs truth ~**49**
- Wholes: **144** vs glyphs/truth **165**
- Ties: **62** (held at baseline)

### First failing stage
1. **Dots:** gate `dy ≤ max(4, dx·0.35)` rejects Δ≈0.17 near-misses; Evangelion shares the same 0–0.25 Δ bucket → cannot loosen dy.
2. **Open noteheads:** whole codepoints correct at enrich; **dense** gap packing skips glyph-authoritative duration and collapses them.

### Root cause
Dot near-misses are not Minecraft-unique. Whole loss is post-extract duration override, not missing glyphs.

### Attempted / reverted
| Approach | Outcome |
|---|---|
| dy epsilon / global loosen | Evangelion false-dot risk |
| Dense glyph-auth + open beam refuse | wholes +2 only; Evangelion half/`quarter.` regression → **reverted** |

### Before / after
No accepted production delta.

### MusicXML / playback / visual
Baseline only. No UI claim of Phase 1 improvement.

### Regressions
N/A (reverted). Fantaisie tempo untouched.

### Remaining limitations
Need discriminatory dot ownership (not wider dy) and Evangelion-safe open-glyph duration authority.

### Detail
`PHASE1_REPORT.md`

---

## 2. Hungarian — dense eighth/sixteenth promoted to quarter

**Verdict: REVERTED** (RCA accepted)

### Frozen baseline
Same `541f607…`

### Verified case-set
`phase2-hungarian/VERIFIED_CASES.json` (~55 short onsets + quarter controls).

| Metric | Baseline |
|---|---|
| Verified promotions | **30** |
| Verified correct short | **9** |
| Beams truth vs gen (m1–55) | **328** vs **39** |
| Full piece | Q **800** / 8th **431** / 16th **108** |

### First failing stage
1. Beam geometry often never attached.
2. When beams exist, event duration re-promoted via gap / coalesce `Math.max` / dense gate.

### Root cause
Short-note evidence lost between stem/beam ink and final event duration. Broad late beam-caps that fix Hungarian break Minecraft Phase 1.

### Attempted / reverted
| Approach | HU | Controls | Decision |
|---|---|---|---|
| Beam-aware coalesce + dense re-refine + open refuse | verified promo **30→31** (no material gain) | EV OK; MC eighths **49→34** | **Reverted** |
| Broad refine on any beams (prior) | material HU | Breaks MC Phase 1 | Rejected |

### Before / after
No accepted production delta. Hungarian **not** fixed.

### MusicXML / playback
`hungarian-baseline.musicxml` retained for RCA. No UI claim of fix.

### Regressions
Production restored. Fantaisie / Evangelion / Minecraft Phase 1 baseline intact after revert.

### Remaining limitations
Need better beam attachment evidence under the existing confidence gate — not threshold lowering, thinning, or 2/4 force-fit.

### Detail
`PHASE2_REPORT.md`

---

## 3. DEV rhythm provenance (soak enablement)

**No production recognition changes.** Flag `scoreflow:omr-provenance` (default **OFF**).

When enabled, pipeline attaches `diagnostics.rhythmProvenance` with:

- per final note: glyph / stem / beam / dot / gap sources + confidences, chord-coalesce + measure-packing overrides, decision chain (stage/function that replaced prior), final type
- per dot candidate: geometry, possible owners, aug/articulation/repeat scores, rejection, final owner
- per beam candidate: source path id, geometry class, compatible stems, attachment score, group, rejection, later overwrite of beam duration

UI (DEV panel): **Provenance on/off** + **Export provenance JSON** (`buildOmrProvenancePackage` / `downloadOmrProvenancePackage`).

Unit coverage: `tests/omrRhythmProvenance.test.js`.

---

## 4. 10-piece real-world soak

Artifacts: `soak/SOAK_REPORT.md`, `soak/SOAK_RECORDS.json`, `soak/*-provenance.json`,
`soak/run-soak.mjs`.

| Score | MC-like | HU-like | Top failure (weighted) |
|---|---|---|---|
| minecraft | yes | no | open/beam mix (MC RCA holds) |
| evangelion | no | no | beam-confidence-rejected |
| gymnopedie | no | no | dot-dy-near-miss (no open collapse) |
| hungarian | no | yes | beam-short-lost-to-longer |
| fantaisie / campanella×2 / carol / moonlight / wet-hands | no | no | beam-confidence / packing noise |

**Reopen Minecraft? no.** **Reopen Hungarian? no.**  
(Only the original RCA piece matches each mechanism; need ≥2 unrelated.)

Policy: do **not** reopen Minecraft or Hungarian recognition until ≥2 *unrelated* scores show the same provenance mechanism.

---

## Regression gates

No phase accepted → no new ship commit and no full gate suite against a delta.
Focused unit tests run during experiments and after each full revert (pass on restored tree).

Freeze preserved: Fantaisie tempo, ActiveScore/PDF/OMR/repeats/audio, sparse whole/half,
Minecraft dotted preference/ties, articulations/structure/dynamics/Piano/Guitar/evaluator,
Evangelion control.

---

## Commits

| Item | Result |
|---|---|
| Baseline | `541f607` (pre-existing accepted) |
| Phase 1 | **None** — REVERTED |
| Phase 2 | **None** — REVERTED |
| Provenance | DEV-only diagnostics commit (no recognition delta) |
| Soak summary | `SOAK_SUMMARY.md` — **no sprint** (MC/HU each 1 score) |
