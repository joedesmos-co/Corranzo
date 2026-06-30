# OMR error rerank (post staff-gap normalization)

Baseline: live `tmp/omr-benchmark-dashboard/fixtures/dense.json` (post staff-gap fix).

| Metric | Post quarter-floor | Post staff-gap | Δ |
|--------|-------------------:|---------------:|--:|
| Pitch | 92.74% | **93.67%** | +0.93pp |
| wrongPitch | 173 | **147** | **−26** |
| Duration | 95.20% | 95.23% | +0.03pp |
| wrongDuration | 104 | 103 | −1 |
| Onset | 95.77% | 95.55% | −0.22pp |
| wrongOnset | 88 | 94 | +6 |
| Chord | 91.87% | 91.84% | −0.03pp |
| chordMismatch | 238 | 239 | +1 |
| m119–125 wrongPitch | 107 | **81** | **−26** |
| measureΔ | 0 | 0 | 0 |

Clean Gymnopédie unchanged.

---

## Raw rerank (dense)

| Rank | Bucket | Count | vs post-quarter-floor |
|-----:|--------|------:|------------------------|
| 1 | chordMismatch | **239** | +1 |
| 2 | wrongPitch | **147** | −26 |
| 3 | wrongDuration | **103** | −1 |
| 4 | wrongOnset | **94** | +6 |
| 5 | missingNotes | 31 | 0 |
| 6 | extraNotes | 28 | −1 |
| 7 | measureΔ | 0 | 0 |

**Page 8 gap drift is no longer the dominant story.** Staff-gap fix removed exactly 26 trailing pitch errors; remaining errors are spread across early pages, onset coupling, and register/octave confusions.

---

## Target assessment

### 1. Remaining page 8 pitch (81 total, 32 onset-aligned)

| subset | count | character |
|--------|------:|-----------|
| All page 8 wrongPitch | 81 | 55% of total (was 62%) |
| Onset-aligned | 32 | real mapping at matched time |
| ±2 diatonic (onset-ok) | **11** | residual step errors — **not gap-shaped** |
| ±1 accidental (page 8) | 5 | too small to target alone |
| Large "other" deltas (onset-ok) | **21** | register/octave confusions |

**Top onset-ok page 8 pairs** (post gap-fix):

| pair | count | interpretation |
|------|------:|----------------|
| C3→G1 | 4 | ~2-octave bass mis-assignment |
| A#1→C2 | 3 | residual step (not fixed by gap alone) |
| A#2→F1 | 3 | −17 semitone register slip |
| C2→G1 | 3 | register slip |
| C2→D2 | 3 | +1 diatonic step |

Trailing measures are now **evenly distributed** (11–14 per measure); m125 is no longer an outlier (11 vs 26 pre-fix).

**Verdict:** Do **not** extend staff-gap normalization. Remaining page 8 pitch needs **staff-role / register diagnosis** (wrong octave, bass↔treble pairing), not line-spacing tweaks.

---

### 2. Page 8 accidentals (5 total, 0 onset-aligned)

Too small and entangled with onset slips. **Not a viable standalone target.**

---

### 3. Onset-coupled errors — **now the largest independent lever**

| bucket | count |
|--------|------:|
| wrongOnset total | 94 |
| Independent (pitch+duration OK) | **41** |
| Duration onset-coupled | **53** |
| wrongPitch with onset ≠ 0 | 81 |
| Page 8 wrongOnset | 35 |
| Pages 1–2 independent onset | **26** |

**Onset delta histogram (top):** 0.5q slips dominate; 0.75q second.

**Hot measure: m9** — 13 independent onset errors, 18 total. Page 1 accounts for 22/41 independent onset errors.

Examples at m9 beat 0 show treble notes matched to bass-generated notes when onset slips 0.5–0.75q (e.g. truth A#4 → gen C3, pitchΔ −22). Much "pitch" and "duration" mass is **evaluator coupling**, not separate bugs.

**Verdict:** Highest-leverage next work is **early-page onset diagnosis (m9, page 1)**, not trailing pitch.

---

### 4. Chord mismatch (239)

| location | chordGroup mismatches |
|----------|----------------------:|
| Page 8 | **1** |
| Pages 1–6 | 238 |

**Pure-chord hot spots** (pitch≈0, onset≈0):

| m | chordMismatch |
|--:|--------------:|
| 61 | 26 |
| 25 | 24 |
| 33 | 18 |

m61: sixteenth-grid arpeggiation phase (`4+1+4+1` vs `1+4+1+4`) — **onset-quantization coupled**, not an x-gap chord rule.

**Verdict:** Chord raw count is #1 but **not safely fixable** with a narrow chord-grouping tweak. Defer until onset grid is improved on m25/m61.

---

### 5. Duration (103)

| category | count |
|----------|------:|
| **onset-coupled** | **53** |
| too-short | 24 |
| beamed-subdivision | 17 |
| too-long | 9 |

**Independent** (pitch+onset OK): **48**

| pattern | independent count |
|---------|------------------:|
| `1q→0.5q` | 13 |
| `0.5q→1q` | 8 |
| `0.75q→0.25q` | 6 |
| `1q→1.5q` | 6 |

`1q→0.5q` remains the top **narrow rhythm** pattern but is down from 27 post-quarter-floor (13 independent now). Extending quarter-floor needs m17-style pipeline debug — not obvious safe fix without reproduction.

**Verdict:** Duration improvements mostly follow onset. Standalone rhythm target is secondary.

---

## Pitch shape change (important)

At **correct onset**, remaining wrong-pitch histogram **flipped**:

| category | post quarter-floor | post staff-gap |
|----------|-------------------:|---------------:|
| ±2 diatonic | 79 | **25** |
| ±1 accidental | 33 | **7** |
| other (register/octave) | 28 | **34** |

Gap normalization eliminated the ±2 diatonic cluster. What remains is **heterogeneous register noise** (e.g. page 1: C4→D#2 at −21; page 6: C3→D5 at +26) plus onset-coupled apparent pitch errors.

Non-page-8 wrongPitch is now **66** — equal to page 8 (66). Early measures m6 (10), m8 (12), m9 (8) lead non-trailing pitch.

---

## Worst measures (post staff-gap)

| m | page | pitch | duration | onset | chord | notes |
|--:|:----:|------:|---------:|------:|------:|-------|
| 9 | 1 | 8 | 4 | **18** | 23 | onset + matcher coupling |
| 7 | 1 | 4 | 2 | 8 | 20 | missing/extra mass |
| 8 | 1 | 12 | 2 | 7 | 13 | register confusions |
| 61 | — | 0 | 0 | 0 | **26** | pure chord phase |
| 25 | — | 0 | 0 | 2 | **24** | chord + onset |
| 121 | 8 | 14 | 2 | 7 | 0 | trailing residual |
| 123 | 8 | 12 | 3 | 8 | 0 | trailing residual |

m125 dropped from 26 → 11 wrongPitch after staff-gap fix.

---

## Recommendation

### **No code this pass**

No pattern is both high-confidence and narrow enough to ship without fresh diagnosis. Specifically:

- **Do not** extend staff-gap normalization — remaining page 8 pitch is register/role noise, not gap drift.
- **Do not** add blind accidental or pitch-mapping rules — 34 onset-ok "other" deltas are cross-staff/octave, not A#/D# step fixes.
- **Do not** widen chord grouping for m61/m25 — onset phase issue.

### Priority order for next iteration

| Priority | target | why | type |
|:--------:|--------|-----|------|
| **1** | **Early-page onset (m9, page 1)** | 41 independent onset; 53 onset-coupled duration; cleans apparent pitch/chord noise | diagnosis first |
| 2 | Page 8 register/staff-role pitch | 32 onset-ok errors, 21 large-delta register slips | diagnosis only |
| 3 | Residual `1q→0.5q` (13 independent) | known narrow rhythm pattern; needs pipeline repro (m17 lesson) | code only after repro |
| 4 | Chord m61/m25 | 50 pure-chord mass; blocked on onset grid | defer |
| 5 | Page 8 accidentals (5) | too small | skip |

**Estimated upside if onset fixed on m9/page 1:** 40–60 raw errors across onset + duration + apparent pitch/chord (overlapping buckets).

---

## Artifacts

- `tmp/omr-benchmark-dashboard/post-staff-gap-rerank.json`
- Prior: `post-quarter-floor-rerank.md`, `trailing-pitch-diagnosis.md`
