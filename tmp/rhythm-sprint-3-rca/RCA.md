# Rhythm Sprint 3 — Rests + Tuplets RCA

**Date:** 2026-07-18  
**Baseline:** `tmp/after-rhythm-sprint-2.json` (Rhythm **59.8%**, duration-mismatch **148**, onset-mismatch **132**)  
**Evaluator:** frozen **2.0.0** / schema **2** — not modified  
**Scope:** analysis only (no recognition fixes)

Probes: `tmp/rhythm-sprint-3-rca/probe-rest-tuplet-rca.mjs` → per-fixture `*.rca.json`, `probe-summary.json`.

---

## Verdict

1. **Extra rests are almost entirely invented by raster measure-balancing**, not by rest-glyph recognition. `piano-articulation-scan` is a **zero-text scan** (`totalTextItems: 0`); all sampled rest events are `uncertain: true`, `confidence: 0.5` from `validateAndNormalizeMeasureRhythm` → `buildRestEvent`.
2. **3:2 tuplets fail on the production V2 path** because there is **no tuplet / time-modification pipeline** in `processVectorOmrPage.js` / `buildOmrMusicXml.js`. V3 independent shadow **already recovers** m3 as `uniform-subdivision-grid` + `tuplet 3:2` (12 events), but **`omrV3MusicXml.js` never emits `<time-modification>`**, so even V3 XML scores `tuplet none`.
3. **Missing rests** are secondary (×4 corpus): vector glyph present but skipped (`overlaps-staff-notes`) or applied on the wrong staff/onset with gap-clipped duration.

---

## Corpus taxonomy (rest + tuplet defects)

From aggregate `topDefects` after Sprint 2:

| Code | Count | Share of rest+tuplet (n=30) | Fixtures |
|---|---:|---:|---|
| **extra-rest** | 16 | **53%** | artic 11, guitar-standard 4, tuplets 1 |
| **tuplet-mismatch** | 10 | **33%** | piano-rhythm-tuplets-vector only (m3) |
| **missing-rest** | 4 | **13%** | beginner 1, tuplets 3 |

### Failure-class shares (rest+tuplet, estimated)

| Class | Share | Count (est.) | Primary evidence |
|---|---:|---:|---|
| **Rest insertion from measure balancing** | **~50%** | ~15/30 | artic 11 + guitar-standard ~4; `buildRestEvent` signature |
| **Tuplet none (no time-modification / no 3:2 recognition on V2)** | **~33%** | 10/30 | tuplets m3; V2 XML has zero `time-modification` |
| **Missed rest** | **~10%** | ~3–4/30 | beginner m7 skip; tuplets m4/m5 unmatched truth rests |
| **Wrong duration / onset / staff on true glyph** | **~7%** | ~2/30 | tuplets m4 eighth→16th gap-clip; m5 wrong onset |
| Missed rest (invisible/implicit) | ~0% | 0 | not observed |
| False-positive rest glyph (staccato collision) | ~0% of corpus extras | 0 on artic (no glyphs) | `nearNotehead` already filters vector |

**Onset coupling:** artic’s 7 onset-mismatches co-locate with extra-rest measures (Sprint-2 class **D_rests**). Tuplets m3’s ~onset storm is mostly **duration/tuplet cascade** (sixteenth grid @3..13 vs triplet eighths), not rest insertion.

---

## 1. RESTS RCA

### Trace path

**Scan / raster (articulation-scan):**
```
noteheads → assembleMeasureRhythm
  → detectRestsInMeasure (often unused when chords fill >½ measure)
  → assignStartDivisions (position snap) OR packEventsSequentially
  → validateAndNormalizeMeasureRhythm  ★ invents rests for gaps / tail
       buildRestEvent(start, gap)  // uncertain, confidence 0.5
  → buildOmrMusicXml (rest events → <note><rest/>)
```

**Vector (tuplets / beginner):**
```
SMuFL rest glyph (U+E4E3..E4E7)
  → restsForMeasure (nearNotehead filter)
  → insertMixedMeasureRests / tryApplyStaffRest
       clef ← resolveClefForY
       onset ← positionInMeasure × totalDivisions
       duration ← min(glyphDuration, staffGap)
  → skip reasons: overlaps-staff-notes | no-staff-gap | …
  → MusicXML
```

### piano-articulation-scan (extra-rest ×11)

| Fact | Value |
|---|---|
| Path | **raster** (0 text items, 0 rest glyphs) |
| Truth rests | **0** |
| Generated rests | **11** |
| Detector rests in samples | **0** |

**Sample measures (page analysis events):**

| m | Events (compact) | Rest class |
|---|---|---|
| 2 | `N@0d4? R@4d4? N@8d4? R@12d4?` | balancing (even-quarter holes) |
| 3 | `N@0d4? R@4d2? N@6d4? N@10d4? R@14d2?` | balancing |
| 4 | `N@0d4? R@4d1? N@5d4? R@9d2? N@11d4? R@15d1?` | balancing (1+2+1 pattern) |
| 7 | analysis: 4× quarter notes; pipeline XML still has `quarter:1, eighth:2, quarter:1` | balancing after preprocess pack |

**Classification:** **rest insertion from measure balancing** (~100% of artic extras). Not missed rests, not false-positive glyphs. Duration labels in the evaluator (16th/eighth) match gap sizes from `buildRestEvent`, which also mis-labels `dur=1` as `type=quarter`.

### piano-rhythm-tuplets-vector rests

| m | Truth | Gen | Class |
|---|---|---|---|
| 4 | eighth@0 + 16th (later) | vector 16th@3 bass | **wrong onset + wrong duration** (gap-clipped; staff/clef suspicious) |
| 5 | quarter (end) | vector eighth@11 | **wrong onset / duration** (glyph applied, not matched) |
| 6 | whole | whole@0 vector | **matched** |
| — | — | — | **missing-rest ×3** vs truth when gen rest doesn’t align |

Glyph inventory: `U+E4E6`×3, `U+E4E7`×1, `U+E4E3`×1 — recognition of glyph *identity* works; placement/voice/gap logic fails.

### piano-beginner-single-vector m7 (missing-rest ×1)

| Stage | Result |
|---|---|
| Truth | dotted-quarter E4, eighth G4, **quarter rest**, quarter A4 |
| Detected | eighth rest glyph, `positionInMeasure≈0.53`, clef bass |
| `tryApplyStaffRest` | **skipped `overlaps-staff-notes`** |
| Gen | continuous notes (no rest): Q + Q + half — gap covered by overlong notes |

**Classification:** **missed rest** (glyph seen, rejected because note intervals cover preferred onset). Secondary: wrong pitch/voice on surviving notes.

### guitar-standard-chords-vector (extra-rest ×4)

Truth rests 0 / gen rests 4; same balancing signature expected on under-detected measures (also `generatedMeasureCount` 16 vs truth 8 — split-measure noise). Not re-probed in depth; counted with balancing share.

---

## 2. TUPLETS RCA (piano-rhythm-tuplets-vector m3)

### Truth vs V2 vs V3

| Layer | m3 rhythm |
|---|---|
| **Truth** | 12 × written eighth, `time-modification 3:2`, four triplet groups (EEE / FFF / GGG pattern) |
| **V2 production** | 11 note events `@3..13`, mostly **sixteenth** `d=1`, **no** `time-modification`; starts late (opens at division 3) |
| **V3 independent shadow** | 12 events, `durationRecovery: uniform-subdivision-grid`, `tuplet: {actualNotes:3, normalNotes:2, writtenDivisions:2}`, onsets `0, 1.333, 2.667, …` |
| **V3 serialized MusicXML** | **still no `<time-modification>`** (`omrV3MusicXml.noteXml` omits it) |

### Visual / rhythmic evidence present on the PDF

- **Tuplet digits:** four plain-text `"3"` glyphs at **y≈641**, x≈332 / 354 / 376 / 398 (above the triplet groups). Separate measure-number `"3"` at y≈626.
- **Spacing:** 12 onset columns / 4 beats ⇒ factor **3** (exactly the owned case in `recoverUniformBeatGrid`).
- **Written values:** beamed eighths (truth); V2 gap-primary collapses to 16ths.
- **No bracket glyph required** for this fixture — number + equal spacing suffice.

### Why 3:2 fails (root causes, ordered)

1. **V2 has no tuplet recognition** — `processVectorOmrPage.js` never sets tuplet / time-modification; `buildOmrMusicXml.js` cannot emit it.
2. **Gap-primary durations** on a dense 16th snap grid → sounding lengths and onsets diverge from 3:2 eighths → evaluator `tuplet-mismatch` ×10 + `duration-mismatch` + `onset-mismatch` cascade.
3. **V3 recovers timing but does not ship markup** — `omrV3Voices.recoverUniformBeatGrid` works on this measure’s staff observation; `omrV3MusicXml.js` ignores `technical.tuplet`. Production still exports V2 XML.
4. **Do not “fix” by inventing tuplets in measure balancing** — evidence is spacing + digit glyphs, already available.

---

## 3. Ranked smallest recognition-level fixes

### Fix 1 — Stop inventing rests without detector evidence *(highest leverage on extra-rest)*

| | |
|---|---|
| **Files / functions** | `src/features/omr/validateOmrMeasureRhythm.js` → `validateAndNormalizeMeasureRhythm` / `buildRestEvent`; call site `assembleOmrMeasureRhythm.js` → `assembleMeasureRhythm` |
| **Change** | When filling start gaps or trailing underfill, **do not emit rest events** unless a detector rest (raster blob or vector glyph) justifies that span. Prefer leaving underfull measures, or non-rest cursor gaps only if a later serializer needs them — but **MusicXML must not gain phantom `<rest/>`**. |
| **Why small** | Local policy change; no score-specific rules; aligns with “avoid measure-balancing inventing rests”. |
| **Expected impact** | **−11** artic `extra-rest`; **~−4** guitar-standard; artic **onset** class D (~7) should drop; corpus `extra-rest` 16 → ~1–2. |

### Fix 2 — Digit-gated 3:2 recognition on the vector → MusicXML path *(kills tuplet-mismatch + onset cascade on m3)*

| | |
|---|---|
| **Files / functions** | (a) `processVectorOmrPage.js` — after `groupVectorNoteheads` / `buildNoteEventsFromGroups`, apply equal-column factor-3 recovery (mirror `omrV3Voices.recoverUniformBeatGrid`) **gated by** nearby `"3"` text glyphs; stamp `timeModification: {actualNotes:3,normalNotes:2}` on events. (b) `buildOmrMusicXml.js` → `noteXml` — emit `<time-modification><actual-notes>…</actual-notes><normal-notes>…</normal-notes></time-modification>`. Optional follow-up: same emission in `v3/omrV3MusicXml.js`. |
| **Why small** | Logic already proven in V3 shadow on this fixture; V2 only needs a gated port + XML emit. **Do not** invent tuplets from balancing alone. |
| **Expected impact** | **−10** `tuplet-mismatch`; large cut of tuplets **onset/duration** on m3 (~dozen); Rhythm % on this fixture 52% → likely mid-60s+ on rhythm class alone. |

### Explicit non-fixes / defer

- **Do not** widen `validateAndNormalizeMeasureRhythm` to invent tuplets.
- **Do not** score-specific hardcode for artic/tuplets fixtures.
- Beginner `overlaps-staff-notes` skip in `detectVectorRests.tryApplyStaffRest` — real but **×1**; fix after Fix 1–2 (or as tiny follow-up: prefer gap carve when glyph duration fits a residual hole).
- Enabling `allowUniformBeatGrid` on full grand staff without digit/spacing gates — trap (comment in `omrV3Voices.pianoStaves` already warns).

---

## Traps

1. **Balancing rests look like “recognition”** in MusicXML but carry `uncertain` + `confidence: 0.5` and no `source: 'vector-glyph'`.
2. **`buildRestEvent` mis-types** `dur=1` as `quarter` — evaluator still reports 16th from duration divisions.
3. **V3 shadow can look “fixed” in IR** while production V2 XML and V3 serializer both lack `time-modification`.
4. **Tuplet digit `"3"` vs measure number `"3"`** — gate on y-offset above staff / proximity to note columns (y≈641 vs measure y≈626 on this PDF).
5. **Rest glyph on wrong staff** (bass vs treble) + gap-clipped duration masquerades as “extra” + “missing” in the same measure.
6. **Preprocess changes scan packing** — artic m7 analysis without preprocess ≠ pipeline XML; always compare pipeline MusicXML for defect counts.
7. Frozen evaluator: do not retune tuplet/rest matching to hide markup gaps.

---

## Expected fixture impact (if Fix 1 + Fix 2 land)

| Fixture | Extra-rest | Missing-rest | Tuplet-mismatch | Onset (related) |
|---|---|---|---|---|
| piano-articulation-scan | 11 → **~0** | — | — | 7 → **~0–2** |
| guitar-standard-chords-vector | 4 → **~0** | — | — | minor |
| piano-rhythm-tuplets-vector | 1 → **~0–1** | 3 → **~1–2** (staff/gap remain) | 10 → **~0** | m3 onsets sharply down |
| piano-beginner-single-vector | — | 1 → **0–1** (needs follow-up) | — | m7 partial |

**Corpus:** `extra-rest` 16→~1–2; `tuplet-mismatch` 10→0; Rhythm mean 59.8% — expect **+2–5 pts** from these two fixes alone (onset/duration cascade on tuplets + artic), not a full rhythm win without ongoing duration work from Sprint 2.
