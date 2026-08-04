# Phase 2 — Root-Cause Clusters

**Source:** `tmp/omr-semantic-repair/mismatches.json` (810 structured mismatches @ `48757fc`)  
**Official corpus defect totals** (evaluator aggregate): duration 280, incorrect-chord 217, missing-note 209, extra-note 198, onset 193, incorrect-pitch 179, incorrect-tie 7, missing-tie 6.

Structured inventory counts are slightly lower where split/merge measures suppress 1:1 attribute pairing; rankings match the official totals.

---

## Ranking (fixtures × volume × evidence × safety)

| Rank | Cluster | Structured count | Fixtures | Categories produced | Pipeline stage | Confidence | Safest repair | Risk |
|---|---|---|---|---|---|---|---|---|
| 1 | **Duration: gap stretch overwrites filled-head enrich** | 207 | 8 | duration-mismatch (dominant 1↔2, 1↔0.5, 0.5↔0.25) | `extendDurationsPerClefVoice` / gap packing | **High** | Cap unbeamed filled heads at enrich `durationDivisions` | Medium — undoes intentional grand-staff gap sustains |
| 2 | **Chord coalesce / onset resnap** | 120 chords + linked pitch/ME | 7 | incorrect-chord, incorrect-pitch, missing/extra, duration | `coalesceSameOnsetChordEvents`, `resnapDenseChordOnsets` | **High** | Tighten same-onset coalesce / avoid odd-onset re-gap | High on dense fixtures |
| 3 | **Voice/onset assignment** | 143 | 8 | onset-mismatch (0.25 / 0.5 quarters) | onset resnap / voice serialization | Medium | Onset grid only with beam/glyph evidence | High |
| 4 | **Staff position / accidental (±1–2 semitone)** | 83+37 | 6 | incorrect-pitch | staff position / accidental attach | Medium | Accidental ownership / staff Y mapping | Medium |
| 5 | **Missing/extra extraction** | 156 | many | missing-note, extra-note | notehead detect / filter / alignment symptom | Mixed | Separate true misses from alignment symptoms | High |
| 6 | Articulation | 17 | 2 | missing-accent/staccato | articulation glyphs | Medium | Association radius | Low volume |
| 7 | Measure structure | 14 | 3 | split/merge | measure segmentation | Medium | Guitar staff pairing | Medium |
| 8 | Sustain/tie | 9 | few | missing/incorrect-tie | vector ties (already exclusive) | Low remaining | Recall, not ownership | Low |

---

## Cluster 1 — Duration gap overwrite (PRIMARY)

**Evidence**
- Top transitions: `1→2` (42), `1→0.5` (35), `0.5→0.25` (29), `2→1` (26).
- Affects 8/9 fixtures (all except guitar-techniques-paired).
- Open heads already have `glyphAuthoritativeDurationDivisions` caps; **filled heads do not**.
- `extendDurationsPerClefVoice` stretches across foreign-clef gaps and harmonic heuristics past written quarter values.

**Root cause:** Gap-primary duration + asymmetric stretch: enrich on black heads is discarded; only whole/half/dot caps survive.

**Repair:** `filledHeadWrittenDurationCap` — for unbeamed, non-open heads with stem + enrich `durationDivisions`, never stretch above that written value.

---

## Cluster 2 — Chord / onset coupling

**Evidence**
- Among measures with `incorrect-chord`: 26/31 also incorrect-pitch, 28/31 duration-mismatch, 23/31 missing/extra.
- Dense fixture alone: 43 incorrect-chord.

**Root cause:** Failed coalesce / odd-onset snap splits one visual chord into sequential events → cascade of pitch, chord, missing/extra, duration.

**Repair (next):** Improve same-onset coalesce tolerance before `resnapDenseChordOnsets` re-gaps — only after duration cap lands.

---

## Cluster 3–5 — Deferred

Onset resnap, accidental/staff mapping, and pure detection misses need geometry fixtures and intermediate OMR dumps; higher regression risk. Attack after Clusters 1–2.

---

## Representative examples

| Fixture | Measure | Pattern |
|---|---|---|
| piano-grand-voices-vector | many | duration `1→2` with foreign-clef stretch |
| piano-dense-advanced-vector | many | `0.5→0.25` + incorrect-chord cascade |
| piano-articulation-scan | many | extra notes + incorrect-chord + pitch ±1 |
| piano-beginner-single-vector | 7 | dotted `1.5→1` (secondary) |
