# Corranzo P1 OMR Campaign — Fantaisie Tempo Return + Minecraft Dotted Quarters

**Baseline freeze:** `b818184`  
**Control:** A Cruel Angel’s Thesis (Evangelion)  
**Hungarian:** not touched  
**Evaluator:** untouched  
**Date:** 2026-07-28

Both phases accepted independently. No architecture refactor, no filename/measure hardcoding, no duration clamp, no audio changes.

---

## 1. Fantaisie tempo return — ACCEPTED

### Reproduced behavior
After structure fix at `b818184`, Fantaisie still performed at **~10.1 min** stuck on **Largo (50 BPM)** from ~m45 onward. Truth edition returns to faster tempi after the Largo section.

### PDF evidence (printed → extracted)
| Page | Printed | Pre-fix candidates |
|------|---------|---------------------|
| 1 | Allegro agitato, ♩=84, a tempo | Allegro, metronome, a tempo |
| 2 | Largo, **Moderato cantabile**, a tempo | Largo, a tempo only — **Moderato missing** |
| 4 | **Presto**, a tempo | a tempo only — **Presto missing** |

### First failing stage
`parseOmrTempoMarking.js` tempo-word classification / candidate acceptance:

1. **Presto** on later pages rejected by `pageNumber > 1 && midY < 0.08` (false header filter). Placement is a left system-start direction, not a title.
2. **“Moderato cantabile”** failed exact `TEMPO_WORD_RE`; embedded/leading phrase recovery only ran on **page 1**.

### Root cause
Return markings exist in the PDF and reach text extraction, but classification discarded them before measure association / MusicXML `<direction>` / `<sound>`.

### Attempted / accepted approach
Smallest general fix in `src/features/omr/parseOmrTempoMarking.js`:

- Exact mapped tempo words / `a tempo`: do **not** apply later-page top-band rejection when mapped BPM or a-tempo is recognized.
- Leading/embedded tempo phrases on **all pages**; preserve printed phrase text; BPM only from existing `TEMPO_WORD_BPM` (moderato=108, presto=168).
- No Fantaisie measure/title hardcoding; no invented BPM outside the documented map.
- Tests in `tests/tempoSprint1.test.js` (Presto on later-page top band; Moderato phrase on page 2).

### Before / after
| Metric | Before (`b818184`) | After | Notes |
|--------|--------------------|-------|-------|
| Written minutes | **10.095** | **5.157** | Materially more plausible |
| Measures / notes | 144 / 3028 | 144 / 3028 | Structure intact |
| Tempo map | 84 → 50 (stuck) | **84 → 50 → 108 → 168** | Moderato + Presto returns |
| Directions | Largo then a tempo@50 | Largo@45, Moderato@47, Presto@90, a tempo restores | |

### Evangelion non-regression
125 measures / 2808 notes / ~4.05 min; tempos 76→126 — unchanged.

### PDF → MusicXML → playback
- MusicXML emits `<words>` + `<sound tempo="…">` for Moderato cantabile and Presto.
- Parsed tempo map applies only at/after each marking.
- `a tempo` restores the prior explicit tempo (108, then 168), not a default.
- Cursor sync: same measure grid; no repeat-graph changes.

### Regression gates
- tempoSprint1, durationOverflowRepeats, musicalStructureSprint1, Notation Fidelity 2–5, omrVectorRhythm, playbackSchedulerChunking, pitch mapping: **pass**
- Production build: **pass**
- Targeted lint on touched files: **pass**

### Browser validation
Live `runPdfOmrPipeline` on the Fantaisie PDF produced the MusicXML/tempo-map evidence above. Interactive browser upload/play smoke was **not** completed in this session (local Vite host not responding). Manual check: load Fantaisie PDF, confirm playback leaves Largo after Moderato/Presto and total duration ~5 min class.

### Remaining limitations
- Performed duration still longer than a concert ~4–5 min reading (residual structure / tempo-word BPM approximation).
- BPM for word-only marks comes from the general `TEMPO_WORD_BPM` table, not edition-specific metronomes when none are printed beside the return word.

---

## 2. Minecraft dotted-quarter recognition — ACCEPTED (partial)

### Reproduced behavior
At `b818184`, Minecraft had strong whole/half gains but **0 dotted quarters** (truth **49**). Many black heads with augmentation dots were promoted to **dotted halves** via sparse X-gap when `allowDotted` was true.

Truth type mix (approx): whole 165, half 125, half. 70, quarter 129, quarter. 49, eighth 49.  
Baseline gen: whole 151, half 140, half. 135, quarter 105, quarter. **0**, eighth 49.

### First failing stage
Duration assignment in `buildNoteEventsFromGroups` / `extendDurationsPerClefVoice` — **after** augmentation-dot attachment:

1. Dot attachment often succeeded for hollow/half heads → many `half.`.
2. For filled heads with dots, glyph-authoritative duration returned `null` (black heads).
3. Large whitespace gaps with `allowDotted` snapped via `durationMeta` to half / dotted half (**12**), overwriting enrich’s written **6** (dotted quarter).

### Root cause
Explicit augmentation-dot semantics did not outrank X-gap on sparse filled-head onsets.

### Attempted approaches
| Approach | Result |
|----------|--------|
| Prefer `dottedWrittenDurationDivisions` on sparse measures when glyph auth is null | **Kept** — recovers dotted quarters |
| Cap gap extension by written dotted value for filled-head onsets | **Kept** |
| Chord-column broadcast of one printed augmentation dot | **Kept** |
| Loosen augmentation `dy` gate | **Reverted** — Evangelion false-dot regression |
| Suppress open-glyph auth whenever any black+dot in chord | **Reverted** — hurt wholes too much |

### Accepted changes
- `dottedWrittenDurationDivisions` in `processVectorOmrPage.js`
- Sparse filled-head preference: when no `whole`/`half` `noteheadGlyph` on the onset, prefer written 1.5× over gap
- `extendDurationsPerClefVoice` dotted cap for filled-head onsets
- `assignVectorAugmentationDots` same-onset chord propagation
- Unit tests in `omrVectorRhythm.test.js` + `detectVectorStaccato.test.js`

### Before / after (with curve extractor; ties fair)
| Type | Before | After | Truth |
|------|--------|-------|-------|
| quarter. | **0** | **17** | 49 |
| eighth. | 0 | 3 | — |
| whole | 151 | 144 | 165 |
| half | 140 | 136 | 125 |
| half. | 135 | 134 | 70 |
| quarter | 105 | 97 | 129 |
| eighth | 49 | 49 | 49 |
| ties (start) | 62 | **62** | — |

Evangelion type hist unchanged (incl. quarter. = 15).

### PDF → MusicXML → render/playback
- Emitted `<type>quarter</type><dot/>` with duration 1.5× quarter where recovered.
- No separate playback-only dot path.
- Staccato path unchanged (augmentation vs staccato mutual exclusion retained; Sprint 5 tests pass).
- Ties: 62 starts with curves — no continuation re-attack regression from this change.

### Regression gates
Same suite as Phase 1 + detectVectorStaccato / detectNoteRhythmFeatures: **pass**  
Build: **pass**

### Browser validation
Pipeline MusicXML shows dotted quarters present where previously absent. Interactive browser render/play smoke **not** completed here (Vite host down). Manual check: Minecraft pages 2–3, confirm visible augmentation dots on recovered quarters and no staccato↔dot swap; ties still sustain.

### Remaining limitations
- Only **~35%** of truth dotted quarters recovered (17/49). Many remaining failures are attachment geometry (`dy` just beyond the safe gate) or black heads still carrying an open `noteheadGlyph` misread so written preference is skipped.
- `half.` still over-counted vs truth (~134 vs 70).
- Slight whole regression (−7 vs `b818184`) while remaining far above pre-campaign (~100). Documented; not reversed because Evangelion stayed clean and dotted-quarter gain is real.
- Widening attachment geometry was unsafe for Evangelion — left for a future general, staff-space-calibrated pass.

---

## Independent accept / revert summary

| Phase | Decision | Production files |
|-------|----------|------------------|
| 1 Fantaisie tempo return | **ACCEPT** | `parseOmrTempoMarking.js`, `tests/tempoSprint1.test.js` |
| 2 Minecraft dotted quarters | **ACCEPT** (partial) | `processVectorOmrPage.js`, `detectVectorStaccato.js`, related tests |
| Hungarian | **not started** | — |

Failed experiments (looser augmentation `dy`, aggressive open-head suppression) were reverted and are not in production.

## Known unrelated / backlog
- Hungarian dense eighth/16th→quarter promotion (P2 — do not start from this campaign)
- Residual Fantaisie duration vs concert timing
- Remaining Minecraft dotted-quarter recall + half. overcount
- Manual browser smoke checklist (update prior SMOKE_CHECKLIST for tempo return + dotted quarters)
