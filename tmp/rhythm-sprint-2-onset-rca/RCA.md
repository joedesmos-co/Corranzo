# Rhythm Sprint 2 — Onset RCA

**Date:** 2026-07-18  
**Baseline:** `tmp/after-rhythm-sprint-1.json` (Rhythm 58.5%, onset-mismatch 145, duration-mismatch 169)  
**Evaluator:** frozen 2.0.0 — not modified  
**Scope:** analysis only

## Verdict

After Sprint 1 (no more `beamStrength≥14→sixteenth`), **onset-mismatch is still dominated by previous-duration / gap-primary cascades (~70%)**. The new smoking gun: **beam evidence only CAPs long gaps; it never FLOORs short gaps**, so position-snapped starts still invent `durationDivisions=1` (sixteenth) on notes with `beams=1` / `beamStrength≥8`.

Observed post-Sprint-1: **19 beamed→sixteenth events on dense**, **15 on tuplets**, **4 on guitar-standard-chords**.

---

## 1. Onset taxonomy (estimated shares)

Across the five focus fixtures (132 of 145 corpus onset-mismatches):

| Class | Share | Count (est.) | Primary fixtures |
|---|---:|---:|---|
| **A** previous-note duration cascade | **~70%** | ~90 | dense, tab, tuplets, standard-chords |
| **C** chord members sequentialized | **~15%** | ~20 | dense (m2–4) |
| **D** rests shifting timeline | **~5%** | ~7 | articulation-scan |
| **E** tuplets | **~5%** | ~5–8 | tuplets m3 (also drives duration there) |
| **B** incorrect voice separation | **~3%** | ~3–5 | dense (bass/treble collapsed; `missing-voice`) |
| **G** measure packing / split | **~5%** | ~5–8 | dense/standard-chords `split-measure` co-located; opening offset |
| **F** incorrect beam grouping | **~2% primary** / **large mechanism under A** | — | beamed notes still assigned 16th gaps |

**Coupling:** Nearly all duration-mismatches on dense/tab/tuplets still sit in measures that also have onset-mismatch (same Sprint-1 RCA coupling pattern). Grand-voices remains onset-clean.

### Trace path (vector)

```
notehead glyphs → enrichNoteheadRhythm (stem/beamStrength/beams/durationType)
  → groupVectorNoteheads / mergeGroupsSharingBeat (chord merge)
  → buildNoteEventsFromGroups
       startDivision ← position snap (dense: 16th grid)
       durationDivisions ← gap to next start (GAP-PRIMARY)
  → refineEventDurationsFromBeamEvidence  ← CAP only, no floor
  → coalesceSameOnsetChordEvents / extend* heuristics / clamp
  → buildOmrMusicXml cursor (forward/backup from startDivision)
  → evaluator onset compare
```

TAB path diverges at `detectTabNotation.buildTabTimingBuckets` / `assignMonotonicSlots` (no stems).

### Representative measure samples

#### piano-dense-advanced m2–4 (59 onsets)

- **Truth:** eighth grid @0,.5,1,… quarters; multi-note chords on many attacks; bass quarters under treble.
- **Gen m2 events:** `@0,@3,@5,@7,@9,@12` — irregular; chord tones often split across adjacent starts.
- **Gen m3/m4:** many `@n d=1 sixteenth` while some noteheads have `beams=1`, `bStr=29`.
- **Classes:** A (gap→16th/uneven) + C (chord sequentialize) + G (split-measure alignment).
- **Sprint-1 effect:** noteDur no longer mass-labeled sixteenth from strength; **event** duration still sixteenth from gaps.

#### guitar-tab-sparse m2/m3/m6 (23 onsets)

- **Truth:** 4 quarters @0,1,2,3.
- **Gen:** `@1:16th + @2/@5/@8: d=3 + @11:d=5` — spurious leading 16th + uneven slots.
- **Class:** **A** via tab approximate packing (`assignMonotonicSlots`), not vector beam path.

#### piano-rhythm-tuplets m2/m3/m7 (33 onsets)

- **m2 truth:** real 16ths; gen starts late (@3) on irregular 16th grid — A + opening/packing.
- **m3 truth:** 3:2 eighth triplets; gen 16ths, no time-modification — **E** (+ A cascade).
- **m7:** beamed eighths still often `d=1` — A with F mechanism.

#### piano-articulation-scan m3/m4/m7 (7 onsets)

- Extra rests + sparse gen attacks `@0,@5,@11` vs truth quarters — **D**.
- Source is scan (no SMuFL text layer); raster/`assembleOmrMeasureRhythm` path.

#### guitar-standard-chords m1–2 (10 onsets)

- Gen invents leading sixteenths (`@0 d=1` with `beams=1`); uneven later grid — **A** (+ G split on m1).

---

## 2. True sixteenth audit

### How sixteenths are supposed to be detected now

| Path | Behavior post-Sprint-1 |
|---|---|
| `inferNoteDuration` | `beams >= 2` → sixteenth; `beams>=1 \|\| beamStrength>=8` → **eighth**; strength alone never → 16th |
| `countBeams` | tip-row strength ≥8 → **always returns 1**; never 2 |
| `measureBeamStrength` | 1-D scan at `stem.tipY` for ≤28px; **cannot see secondary beam** |
| `inferredBeamDurationCap` | beams≥2 → 16th cap; else primary beam → **eighth cap** |
| `refineEventDurationsFromBeamEvidence` | shortens only when `duration > cap`; **leaves duration=1 intact** |
| Gap primary in `buildNoteEventsFromGroups` | position delta of 1 division → **emits sixteenth events** |
| `beamStemReconstructionDiagnostics.beamLevel` | still maps `beamStrength≥14` → level 2 (diagnostics / V3 shadow — not production duration) |

### Secondary beam / double-flag / partial-beam / mixed 8+16

- **No production code** counts secondary beams, partial beams, or double flags.
- **No SMuFL flag/beam/stem glyphs** in dense, tuplets, standard-chords, or tab PDFs (stems/beams are drawn paths). Articulation-scan page-1 text layer empty.
- Rest glyphs exist on tuplets (`U+E4E7` sixteenth rest etc.) via `detectVectorRests.js` — unrelated to note sixteenths.

### Smallest recognition change for REAL secondary-beam / flag evidence

**Do not restore `beamStrength≥14→sixteenth`.**

**Propose:** In `countBeams` (`detectNoteRhythmFeatures.js`), after confirming primary beam (strength≥8 at tip Y):

1. Scan 1–2 parallel tip-offset rows (≈0.35–0.7 staff-space toward notehead / along stem) for a second horizontal ink run ≥8px.
2. If found → `beams = 2` (enables `inferNoteDuration` sixteenth + eighth→16th cap).
3. Optional later: short run only on one side of stem → partial-beam / flag stub; double-flag as two short diagonal runs near tip when no primary beam.

This unlocks true sixteenths only when a **second beam row** exists (e.g. tuplets m2), without treating saturated primary beams as 16ths.

---

## 3. Recommended fixes (ranked, smallest first)

### Fix 1 — Beam duration FLOOR (breaks A cascade) — **highest ROI**

**Files/functions:**
- `src/features/omr/processVectorOmrPage.js`
  - `refineEventDurationsFromBeamEvidence`
  - `inferredBeamDurationCap` (extend to floor helper, e.g. `inferredBeamDurationFloor`)
  - optionally re-snap next same-clef onset after floor so gaps stay consistent

**Change:** When primary-beam evidence (`beams===1` or `beamStrength≥8`) and `beams < 2`, if gap-assigned `durationDivisions < eighth`, raise to eighth (and preferably advance/merge conflicting next starts).

**Why:** Directly attacks post-Sprint-1 residue: 19+15+4 beamed→16th events. Breaks duration→onset cascades on dense / tuplets / standard-chords without touching evaluator or restoring strength→16th.

**Expected:** Large cut in dense+tuplets onset (0.25q) and duration-mismatch; limited tab impact.

### Fix 2a — Secondary-beam row in `countBeams` (true sixteenths)

**Files/functions:**
- `src/features/omr/detectNoteRhythmFeatures.js` — `countBeams` (+ tiny helper `measureSecondaryBeamStrength`)

**Why:** Only path to real `beams>=2` today is impossible; needed for fixtures with actual 16th beams (tuplets m2) once Fix 1 floors primary beams to eighth.

### Fix 2b — Tab leading-slot guard (if prioritizing tab onset)

**Files/functions:**
- `src/features/omr/detectTabNotation.js` — `buildTabTimingBuckets` / `assignMonotonicSlots`

**Change:** When ~beat-count groups look like quarters, force slots onto beat grid; suppress orphan slot-0 16th when first real onset is near beat 1.

**Why:** All 23 tab onsets share the `@1:16th + d=3` pattern.

**Preference:** Fix 1 + Fix 2a for vector corpus ROI; Fix 2b if tab rhythm is the sprint focus.

### Not recommended now
- Restoring strength≥14→sixteenth
- Evaluator / balancing changes
- Full tuplet recognizer (needed for E, larger scope)
- Relying on SMuFL flag glyphs (absent in these PDFs)

---

## Traps

1. **Gap-primary still owns event duration** — notehead `durationType` is evidence for caps/heuristics, not the written duration.
2. **Cap ≠ floor** — Sprint 1 fixed false 16th *labels* on noteheads; gap still emits 16th *events*.
3. **`countBeams` never returns 2** — any `beams>=2` branch is currently dead in production.
4. **Chord sequentialization ≠ duration** — denser x-spread chords create extra onsets; merge thresholds matter (`mergeGroupsByChordProximity` / `vectorChordMergeXPx`).
5. **`split-measure` inflates onset counts** — co-located but not the primary mechanism; don’t “fix” onsets only via measure-grid.
6. **TAB is a separate path** — vector beam floors won’t help `guitar-tab-sparse`.
7. **Diagnostics `SIXTEENTH_BEAM_STRENGTH=14`** in `beamStemReconstructionDiagnostics.js` still equates saturated strength with 16th level — don’t let that leak into production duration.
8. **Tuplet m2 truth is real 16ths** — Fix 1 alone would over-floor those if secondary beams aren’t detected (pair with Fix 2a).
9. **Pitch/missing-note noise** on dense makes pairing messy; beam/gap mechanism is still independently visible on events.
10. **Frozen evaluator 2.0.0** — do not modify.

---

## Artifacts

- `tmp/rhythm-sprint-2-onset-rca/probe-onset-rca.mjs`
- `tmp/rhythm-sprint-2-onset-rca/*.onset-rca.json`
- `tmp/rhythm-sprint-2-onset-rca/*.omr.musicxml`
- `tmp/rhythm-sprint-2-onset-rca/*.fresh-page-diag.json`
- `tmp/rhythm-sprint-2-onset-rca/taxonomy-refined.json`
- `tmp/rhythm-sprint-2-onset-rca/RCA.json` (machine-readable twin)
