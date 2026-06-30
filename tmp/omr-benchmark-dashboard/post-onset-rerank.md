# OMR error rerank (post-onset checkpoint)

**Baseline:** `tmp/omr-benchmark-dashboard/fixtures/dense.json`  
**Context:** Onset snapping ruled out (no safe runtime fix); staff-gap shipped; clean unchanged  
**Code changes:** None

| Metric | Value |
|--------|------:|
| Pitch | 93.67% (147 wrong) |
| Duration | 95.23% (103 wrong) |
| Onset | 95.55% (94 wrong) — **deprioritized** |
| Chord | 91.84% (239 mismatch) |
| Missing | 31 |
| Extra | 28 |
| F1 | 98.95% |
| Clean Gymnopédie | **unchanged** (0 wrongPitch, 0 wrongOnset) |

---

## Decoupled rerank (excluding onset tuning)

Errors split by whether onset/pitch are already correct — avoids counting matcher/onset coupling as separate bugs.

| Rank | Bucket | Count | Character |
|-----:|--------|------:|-----------|
| 1 | **wrongPitch @ correct onset** | **104** | true pitch / staff-role / register |
| 2 | **wrongDuration @ correct onset+pitch** | **88** | true duration (mostly too-short) |
| 3 | chordMismatch (per-measure proxy) | 239 raw | mostly pitch/onset coupled |
| 4 | missingNotes | 31 | detection / grouping loss |
| 5 | extraNotes | 28 | dedupe / false chord split |
| 6 | wrongPitch onset-coupled | 43 | do not target separately |
| 7 | wrongOnset independent | 41 | **closed** — no safe fix |
| 8 | wrongDuration onset-coupled | 13 | follows onset |

---

## 1. True pitch (104 @ correct onset)

### Geography

| region | count | share |
|--------|------:|------:|
| Page 8 (m119–125) | 52 | 50% |
| Non–page 8 | 52 | 50% |

Staff-gap fix removed ±2 diatonic trailing cluster; **what remains is heterogeneous register noise**, not line-spacing.

### Page 8 (residual after gap fix)

| Δ bucket | count |
|----------|------:|
| ±1–2 semitone (small) | 16 |
| 3–7 semitone (medium) | 28 |
| ≥12 semitone (register) | 8 |

**Top pairs:** C2→G1 (6), C3→G1 (4), A#1→C2 (3), A#2→F1 (3) — bass register / role confusion, not accidental step errors.

**Verdict:** Do **not** extend staff-gap or pitch-mapping heuristics. Needs **staff-role / octave assignment diagnosis** on page 8 — no narrow safe rule identified.

### Non–page 8 hotspots

| m | page | onset-ok wrongPitch | pattern |
|--:|:----:|--------------------:|---------|
| 8 | 1 | 10 | mixed register + missing mass |
| 6 | 1 | 7 | **treble↔bass swap** (+15 to +26 semitone) |
| 9 | 1 | 3 | mostly matcher coupling |
| 1 | 1 | 2 | **C4→D#2 @ beat 0/2** (voice 5→2, Δ−21) |

**m6 examples:** G2→G#4@0 (+25), C3→D5@3 (+26) — generated treble pitches paired to bass truth at **correct onset**.

**Verdict:** m1/m6 pattern suggests **grand-staff voice / cross-clef pairing** at opening figures — worth diagnosis, but only 9 errors in two measures; not a measured fleet-wide fix yet.

---

## 2. True duration (88 @ correct onset+pitch)

| category | count |
|----------|------:|
| too-short | 55 |
| too-long | 33 |

### Top patterns

| truth→gen | count |
|-----------|------:|
| **1q→0.5q** | **28** |
| 0.75q→0.25q | 13 |
| 0.5q→1q | 12 |
| 1q→1.5q | 6 |

### Hot measures (`1q→0.5q` only)

| m | page | count |
|--:|:----:|------:|
| **70** | 4 | **5** |
| 17 | 1 | 3 |
| 77 | 5 | 3 |
| 29, 35, 63, 89, 99, 123 | — | 2 each |

**Verdict:** `1q→0.5q` remains the dominant **narrow rhythm signature**, but post–quarter-floor work showed fixes need **measure-local pipeline repro** (m17 lesson). Beam runtime caps **excluded** by policy. **Diagnosis-only** — repro **m70** first (5 instances, onset+pitch clean).

---

## 3. Missing / detection (31)

| m | page | missing | truth→gen notes | notes |
|--:|:----:|--------:|------------------:|-------|
| **7** | **1** | **11** | 28→20 | **35% of all missing** |
| 8 | 1 | 5 | — | coupled with extra (6) + pitch (12) |
| 60, 61 | 4 | 3 each | — | m61 also chord hot spot |
| trailing | 8 | 6 spread | 1 each | low per-measure density |

### m7 missing detail (beats 1–2.5 column)

All 11 missing notes sit on **beat 1 – 2.5** — a single harmonic window never emitted:

| label | onset |
|-------|------:|
| F2, A#2, D4, A#4 | 1.0 |
| D2, D3 | 1.5 |
| D#3, D#4, G4 | 2.0 |
| F4 | 2.25 |
| D#2 | 2.5 |

**6 / 31** score-wide missing notes are at beat 1; m7 accounts for 4 of those.

**Verdict:** **Highest-density detection failure** in the corpus — one measure, one page, clear beat-column gap. Likely **glyph loss during grouping/dedupe or measure bounds**, not global F1 (98.95%). **Best next diagnosis target.**

---

## 4. Chord mismatch (239) — visual-evidence candidates

Page 8 chord mass collapsed to **1** after staff-gap fix. Remaining chord errors are pages 1–7.

### Pure-ish measures (pitch=0, onset=0)

| m | page | chord | missing | extra | dur | assessment |
|--:|:----:|------:|--------:|------:|----:|------------|
| 61 | 4 | 26 | 3 | 3 | 0 | detection noise + sixteenth phase |
| **33** | **2** | **18** | 0 | 0 | 0 | **best pure-chord candidate** |
| 113 | 7 | 12 | 0 | 0 | 2 | pure chord + minor dur |
| 94 | 6 | 8 | 0 | 0 | 0 | pure chord |
| 57 | 4 | 6 | 0 | 0 | 0 | pure chord |

**m33:** 30/30 noteheads detected and emitted; **18 chord-only mismatches** — pitches and onsets align, but **voice/chord serialization** differs (prior rerank: sixteenth-grid split pattern, not x-gap).

**m61:** Same phase alternation as before; **3 missing + 3 extra** — not visually clean.

**Verdict:** **m33** is the strongest **chord-with-visual-evidence** target (counts match, zero missing). Still needs chord diagnostic replay before any grouping rule — m61-style phase slips may apply.

---

## 5. Closed / deprioritized

| area | status |
|------|--------|
| Onset snapping | **Closed** — 13 unique-pitch analysis; no safe runtime fix |
| Evaluator matching | **Out of scope** |
| Opening-column broadening | **Regressed** (+7 onset, +52 chord) — do not retry |
| Global snap / cluster snap | **No benchmark effect** |
| Beam runtime caps | **Excluded** |
| Staff-gap extension | **Shipped** — remaining page 8 pitch is register noise |

---

## Recommendation

### **No code this pass**

No candidate is both **narrow** and **benchmark-proven safe** without fresh measure-local diagnosis.

### Priority order for next iteration

| Priority | Target | Why | Type |
|:--------:|--------|-----|------|
| **1** | **m7 missing noteheads (page 1)** | 11/31 missing in one beat column; 28→20 note collapse; clearest detection gap | **diagnosis first** |
| **2** | **m33 chord grouping (page 2)** | 18 pure chord errors; 30/30 detection; note counts match | **diagnosis first** |
| 3 | **m70 duration `1q→0.5q` (×5)** | narrowest true-duration hotspot; onset+pitch clean | repro before code |
| 4 | Page 8 register pitch (52) | residual after gap fix; heterogeneous | diagnosis only |
| 5 | m6 / m1 grand-staff voice pairing | +15…+26 semitone at correct onset | diagnosis only |
| 6 | m61 chord (26) | blocked by missing/extra + phase | defer |
| — | Onset / snap / matcher | closed or out of scope | skip |

### Estimated upside (if #1–2 diagnosed and fixed)

| fix | conservative raw error reduction |
|-----|----------------------------------|
| m7 detection recovery | 11 missing + ~8–20 coupled pitch/onset/chord |
| m33 chord serialization | up to 18 chord |
| m70 duration repro | up to 5 duration |

---

## Artifacts

- `tmp/omr-benchmark-dashboard/post-onset-rerank.json`
- Prior: `unique-pitch-slot-shifts.md`, `onset-diagnosis.md`, `post-staff-gap-rerank.md`
