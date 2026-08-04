# Phase 1 — Dense Chord / Onset Mismatch Inventory

**Campaign:** OMR dense chord and onset ownership  
**Frozen start commit:** `34529e0` — fix(omr): detect vector path accidentals  
**Evaluator:** 2.0.0 / schema 2 (frozen)  
**Artifacts:** `mismatches.json`, `mismatches.csv`, `cluster-stats.json`, `corpus-baseline.json`, `diagnostics/`

## Frozen baseline (reconfirmed)

| Metric | Value |
|---|---|
| Overall | **62.8%** |
| Pitch | **61.5%** |
| Rhythm | **66.6%** |
| incorrect-chord | **199** |
| incorrect-pitch | 173 |
| missing-note | **163** |
| extra-note | **154** |
| onset-mismatch | **256** |
| duration-mismatch | 244 |

Note: the campaign brief’s missing/extra/onset totals (209/198/193) match the **pre-accidental** corpus at an older fixture generation. Tracking for this campaign uses the reconfirmed `34529e0` totals above.

## Inventory method

1. Re-ran the frozen nine-fixture semantic corpus → `corpus-baseline.json`.
2. Ran `scripts/omr-chord-onset-inventory.mjs` to collect every remaining `incorrect-chord`, `missing-note`, `extra-note`, and `onset-mismatch` from MusicXML event matching + chord-integrity examples.
3. Joined measure-level pipeline summaries where available (`musicalEventReconstruction`, beam/stem ownership). Full per-event geometry (`vectorChordDiagnostics.events`) is stripped from the pipeline return surface; clustering therefore uses MusicXML chord sets + onset deltas + code-path analysis of grouping/coalesce/resnap.

Structured inventory rows: **529** focus mismatches (note-level onset + chord-integrity examples). Evaluator defect histogram counts differ slightly because chord integrity emits one example per mismatched chord bucket while the evaluator may score related missing/extra notes separately.

### Inventory focus counts (structured rows)

| Code | Inventory rows | Evaluator histogram |
|---|---:|---:|
| incorrect-chord | 140 | 199 |
| missing-note | 65 | 163 |
| extra-note | 91 | 154 |
| onset-mismatch | 233 | 256 |

## Per-fixture concentration (evaluator)

| Fixture | incorrect-chord | missing | extra | onset |
|---|---:|---:|---:|---:|
| piano-dense-advanced-vector | 85 | 44 | 44 | 134 |
| piano-articulation-scan | high (extra cascade) | high | high | 21+ |
| piano-grand-voices-vector | present | low | low | 2 |
| guitar-paired / standard / tab | moderate | moderate | moderate | present |
| piano-rhythm-tuplets-vector | low | low | low | 25 |
| piano-beginner-single-vector | 0 | 1 | 1 | 5 |
| guitar-techniques-paired-vector | 0 focus in structured join | — | — | — |

Dense piano textures dominate chord/onset damage. Sparse beginner stays mostly clean.

## Incorrect-chord subtypes (structured examples)

From 140 chord-integrity examples:

| Subtype | Count | Mechanism signal |
|---|---:|---|
| Same count, different pitches | 62 | Often pitch/staff/accidental masquerading as chord error (~36 within ±2 semitones) |
| Inflated generated chord | 40 | Extra tones / merged voices / duplicate midis |
| Dropped chord tones | 38 | Partial chord lost during packing/ownership |
| Exact duplicate MIDI in generated chord | **31** | Strong duplicate-ownership evidence |

Co-occurrence in the same measure (structured):

- missing + extra together: **17** measures
- incorrect-chord + onset-mismatch: **18** measures
- missing + incorrect-chord: **18** measures

These co-occurrences are the hallmark of **event construction / ownership** failures rather than isolated notehead misses.

## Required mechanism clusters

### 1. Same-chord notes split across nearby onsets

**Evidence:** chord examples where expected multi-note sets appear fragmented; dense measures with many onset-mismatch rows on chord members; `coalesceSameOnsetChordEvents` requires **identical** `startDivision` and `\|Δcx\| ≤ OMR_CHORD_MERGE_X (10px)` while earlier grouping uses adaptive merge up to ~28px.

**Fixtures:** piano-dense-advanced, piano-articulation-scan, piano-grand-voices, guitar-paired.

### 2. Nearby independent voices incorrectly merged

**Evidence:** inflated chords (40); articulation-scan / dense extra-note cascades; opposing-stem / multi-voice measures still sharing one event when x is close.

**Fixtures:** piano-articulation-scan, piano-dense-advanced, guitar-paired.

### 3. Note attached to adjacent chord column

**Evidence:** sequential same-x diagnostic intent in `summarizeVectorChordGrouping`; chord examples with partial pitch sets swapped across neighboring onsets; onset deltas concentrated at ≤1/2 and ≤1/4 quarter.

**Fixtures:** piano-dense-advanced (131 onset mismatches), guitar-standard-chords.

### 4. Duplicate ownership of one notehead

**Evidence:** **31** incorrect-chord examples with repeated generated midis (`E4 E4 G4 G4`, `A2 A2 C3`, `C5 C5`). `dedupeNoteheads` only collapses 6px buckets inside a single event — it does **not** enforce exclusive ownership across events.

**Fixtures:** piano-rhythm-tuplets m7, piano-articulation-scan, piano-grand-voices, dense-advanced.

### 5. Note dropped during onset packing

**Evidence:** 38 dropped-tone chord examples (`C4 E4 G4` → `E4 G4`); 65 structured missing-note rows; missing+extra co-occurrence.

**Fixtures:** piano-articulation-scan, piano-dense-advanced, guitar-paired.

### 6. Chord reconstructed geometrically but given wrong onset

**Evidence:** 180 structured onset-mismatch rows on chord-marked notes; dense-advanced alone 131 onsets; resnap/gap stages can move events after membership is known, and `resnapDenseChordOnsets` only touches multi-note events (orphaned split tones left behind).

**Fixtures:** piano-dense-advanced, guitar-standard, articulation-scan.

### 7. Evaluator alignment artifact rather than production OMR error

**Evidence:** 3 structured extras from unmatched-measure alignment on guitar-standard. Small share — not the main driver.

### 8. Remaining pitch/key/accidental issue masquerading as chord error

**Evidence:** 62 same-count pitch-different chords; many grand-voices examples are staff/accidental offsets (`G4 B4 D5` vs `F4 A4 B4`) with intact cardinality. Accidental campaign frozen — do not retune path recognition here unless a confirmed regression is caused by it.

**Fixtures:** piano-grand-voices, piano-dense-advanced (~23 pitch-masquerade flags).

## Onset delta distribution (structured)

| \|Δonset\| quarters | Count |
|---|---:|
| ≤ 0.25 | 65 |
| ≤ 0.5 | 150 |
| ≤ 1.0 | 18 |

Most onset errors are sub-beat grid / packing noise, not whole-measure shifts.

## Pipeline stage map (relevant)

```
groupVectorNoteheads (adaptive merge ≤28px)
  → mergeGroupsSharingBeat
  → position snap / recluster
  → gap packing / lane normalize
  → coalesceSameOnsetChordEvents (fixed 10px, same startDivision only)
  → resnapDenseChordOnsets (multi-note only)
  → reconstructMusicalEvents (may split inner voices)
  → emit
```

**Gap:** no exclusive notehead→event ownership; no durable `chordColumnId` through snap/coalesce/resnap.

## Fields recorded per row (CSV)

`fixture, code, cluster, measure, page, staff, voice, expectedOnset, generatedOnset, onsetDiff, expectedPitch, generatedPitch, expectedChord, generatedChord, fragmentedSameClef, sequentialSameXCount, duplicateOwnershipCount`

Full JSON includes chord MIDI sets, reconstruction reasons, and alignment flags where available.

## Rhythm dip note (preview; full analysis in Phase 2 / final report)

Accidental campaign reported Rhythm **67.1% → 66.6%** when comparing old fixtures at `2f82df8` to regenerated path-accidental fixtures at `34529e0`. Fair A/B on regenerated fixtures attributed the onset histogram jump largely to **fixture redraw**, not accidental binding retuning. This campaign will not auto-revert accidental recognition.
