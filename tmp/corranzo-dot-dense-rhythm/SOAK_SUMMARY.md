# Consolidated 10-score soak summary

**Baseline recognition:** `541f607` (frozen)  
**Diagnostics:** DEV `scoreflow:omr-provenance` (default OFF)  
**Date:** 2026-07-28  
**Scope:** first 2 pages per PDF unless noted; no recognition changes  
**Artifacts:** `soak/SOAK_RECORDS.json`, `soak/SOAK_REPORT.md`, `gate/GATE_REPORT.json`

**Policy:** Do not reopen Minecraft or Hungarian recognition until ≥2 *unrelated*
scores share the same provenance mechanism.

---

## Per-score scorecard

Legend for quality: qualitative soak judgment from OMR output + provenance
(not a full semantic eval per Download PDF). Frequency = how often the
dominant defect appears in the sampled pages. Reproducibility = same
fingerprint on re-run under provenance ON.

### 1. Minecraft (`beginner-piano-arr`, density medium)

| Dimension | Assessment |
|---|---|
| Overall visual | Fair — readable beginner texture; missing dots / collapsed opens |
| Playback | Fair — missing dotted quarters / open sustain |
| Pitch | Low issue on sampled pages |
| Rhythm | **High** — dotted quarters short; wholes collapse under packing |
| Rests | Low |
| Chords/voices | Low–moderate chord timing OK |
| Ties/slurs | Headless fingerprint shows 0 `<tie>` (UI smoke historically ~62; capture-path delta, not this commit) |
| Accidentals | Low |
| Articulations | Low |
| Tempo/repeats | N/A / low |
| Renderer-only | None observed |
| Provenance root cause | **Minecraft RCA:** `dot-dy-near-miss` (22) + `open-glyph-packing-override` (30) |
| Severity | High for this piece |
| Frequency | Persistent across measures with dots/opens |
| Reproducibility | High (MC-like flag true; gate dottedQuarter=17, whole=144) |

### 2. Evangelion (`anime-piano-arr`, density high)

| Dimension | Assessment |
|---|---|
| Overall visual | Fair |
| Playback | Fair |
| Pitch | Moderate risk in dense systems (not MC/HU) |
| Rhythm | Moderate — dy near-miss cluster shared with MC (19) but **no** open-glyph collapse (7) |
| Rests | Low–moderate |
| Chords/voices | Dense chords; packing overrides 96 |
| Ties/slurs | Low in fingerprint |
| Accidentals | Present; not primary soak defect |
| Articulations | Control for false dots — dottedQuarter=15 held |
| Tempo/repeats | OK |
| Renderer-only | None |
| Provenance root cause | Shared **dy** bucket with Minecraft; **not** full MC mechanism |
| Severity | Medium |
| Frequency | Recurring dyFail; packing frequent |
| Reproducibility | High (Evangelion control gate PASS) |

### 3. Gymnopédie (`sparse-classical-piano`, density medium)

| Dimension | Assessment |
|---|---|
| Overall visual | Fair |
| Playback | Fair |
| Pitch | Low |
| Rhythm | dy near-miss (32) + some beam-short loss (38) without open collapse |
| Rests | Sparse texture — rest gaps matter |
| Chords/voices | Sustained voices; not HU |
| Ties/slurs | Low |
| Accidentals | Low |
| Articulations | Low |
| Tempo/repeats | Low |
| Renderer-only | Possible spacing aesthetics only |
| Provenance root cause | Dot dy pressure **without** MC open-glyph pair |
| Severity | Medium |
| Frequency | Recurring |
| Reproducibility | High |

### 4. Hungarian Dance No. 5 (`dense-classical-piano`, density high)

| Dimension | Assessment |
|---|---|
| Overall visual | Fair with known rhythm defects |
| Playback | **Poor** — short notes promoted to quarter |
| Pitch | Secondary |
| Rhythm | **High** — `beam-short-lost-to-longer` 102 |
| Rests | Secondary |
| Chords/voices | Dense; beam confidence rejects 491 |
| Ties/slurs | Low |
| Accidentals | Secondary |
| Articulations | Secondary |
| Tempo/repeats | Structure present |
| Renderer-only | None |
| Provenance root cause | **Hungarian RCA:** beam evidence lost / overwritten to longer |
| Severity | High for this piece |
| Frequency | Persistent on dense beamed runs |
| Reproducibility | High (HU-like true; baseline fingerprint match) |

### 5. Fantaisie-Impromptu (`virtuosic-classical-piano`, density high)

| Dimension | Assessment |
|---|---|
| Overall visual | Fair |
| Playback | Fair (tempo map OK) |
| Pitch | Dense chromatic risk |
| Rhythm | Packing overrides 130; beam-confidence noise high; **not** HU-like |
| Rests | Secondary |
| Chords/voices | Complex |
| Ties/slurs | Secondary |
| Accidentals | Important; not soak focus |
| Articulations | Secondary |
| Tempo/repeats | **Tempo map frozen** 84 / 50 / 108 / 168 — gate PASS |
| Renderer-only | None |
| Provenance root cause | Dense packing / beam-confidence noise — **not** MC/HU RCA |
| Severity | Medium (tempo OK; rhythm imperfect) |
| Frequency | Packing common |
| Reproducibility | High for tempos |

### 6. La Campanella (etude) (`dense-virtuosic-piano`, density high)

| Dimension | Assessment |
|---|---|
| Overall visual | Good–fair |
| Playback | Fair |
| Pitch | Virtuosic leaps — moderate |
| Rhythm | Beam-confidence / packing; short-lost low (7) |
| Rests | Voice rests historically sensitive |
| Chords/voices | Multi-voice |
| Ties/slurs | Secondary |
| Accidentals | Secondary |
| Articulations | Secondary |
| Tempo/repeats | Secondary |
| Renderer-only | Possible tuplet/beam drawing |
| Provenance root cause | Generic dense-beam confidence — **not** HU threshold |
| Severity | Medium |
| Frequency | Common confidence rejects |
| Reproducibility | High |

### 7. Carol of the Bells (`holiday-piano-arr`, density high)

| Dimension | Assessment |
|---|---|
| Overall visual | Fair |
| Playback | Fair |
| Pitch | Moderate |
| Rhythm | Packing 44; open-glyph 17; short-lost 9 — **not** MC/HU flags |
| Rests | Secondary |
| Chords/voices | Bell-pattern chords |
| Ties/slurs | Secondary |
| Accidentals | Secondary |
| Articulations | Secondary |
| Tempo/repeats | Secondary |
| Renderer-only | None |
| Provenance root cause | Mild open-glyph + packing — below MC reopen bar |
| Severity | Medium–low |
| Frequency | Moderate |
| Reproducibility | High |

### 8. Moonlight 3 (`dense-classical-piano`, density high)

| Dimension | Assessment |
|---|---|
| Overall visual | Fair |
| Playback | Fair |
| Pitch | Dense figuration |
| Rhythm | Packing 79; open-glyph 10; short-lost 1 |
| Rests | Secondary |
| Chords/voices | Dense |
| Ties/slurs | Secondary |
| Accidentals | Secondary |
| Articulations | Secondary |
| Tempo/repeats | Secondary |
| Renderer-only | None |
| Provenance root cause | Packing-dominant — **not** MC/HU |
| Severity | Medium |
| Frequency | Packing common |
| Reproducibility | High |

### 9. Wet Hands (`beginner-piano-arr`, density medium)

| Dimension | Assessment |
|---|---|
| Overall visual | Fair |
| Playback | Fair |
| Pitch | Low |
| Rhythm | Quiet — almost no MC/HU signatures |
| Rests | Low |
| Chords/voices | Low |
| Ties/slurs | Low |
| Accidentals | Low |
| Articulations | Low |
| Tempo/repeats | Low |
| Renderer-only | None |
| Provenance root cause | Beam-confidence probe noise only |
| Severity | Low |
| Frequency | Low impact |
| Reproducibility | High |

### 10. La Campanella (grandes) (`dense-virtuosic-piano`, density high)

| Dimension | Assessment |
|---|---|
| Overall visual | Good–fair |
| Playback | Fair |
| Pitch | Virtuosic |
| Rhythm | Packing 52; short-lost 2 |
| Rests | Secondary |
| Chords/voices | Dense |
| Ties/slurs | Secondary |
| Accidentals | Secondary |
| Articulations | Secondary |
| Tempo/repeats | Secondary |
| Renderer-only | Possible |
| Provenance root cause | Generic dense packing / beam confidence |
| Severity | Medium–low |
| Frequency | Moderate |
| Reproducibility | High |

---

## Shared root-cause groups (unrelated scores)

| Mechanism | Scores | Unrelated count | Notes |
|---|---|---|---|
| Minecraft dy + open-glyph collapse | minecraft | **1** | Evangelion shares dy only — **do not reopen** |
| Hungarian beam-short → longer | hungarian | **1** | Minecraft has some short-loss but below HU bar / different primary — **do not reopen** |
| Dot dy near-miss (alone) | minecraft, evangelion, gymnopedie | 3 | Same *gate*, but Evangelion/Gymnopédie lack open-glyph collapse; prior RCA forbids dy loosen |
| Measure-packing duration overrides | evangelion, fantaisie, campanella×2, carol, moonlight, hungarian | **many** | Frequent in provenance; often normal fitting — **low confidence** as a single user-facing defect |
| Beam-confidence rejects (probe) | most dense scores | **many** | Dominated by weak tip / below-gate probes — **noisy**; not equal to HU short-loss |

**Reopen Minecraft?** no  
**Reopen Hungarian?** no  

---

## Ranked next candidates (no implementation)

Scoring axes: (1) unrelated scores (2) user severity (3) root-cause confidence (4) safe general fix likelihood (5) regression risk  

| Rank | Candidate | (1) | (2) | (3) | (4) | (5) | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | Discriminatory **dot ownership** (not dy widen) | 3 feel dy pressure | High on MC | Medium | Medium if ownership-aware | High (Evangelion) | Watch only — needs ≥2 with **full** MC pair |
| 2 | **Beam attachment evidence** under existing gate | HU + dense peers | High on HU | Medium on HU; low elsewhere | Low–medium | High (MC eighths) | Watch only — HU alone |
| 3 | **Open-glyph authority** vs dense packing | MC + mild carol/moonlight | High on MC | Medium | Low–medium | High (Evangelion halves) | Watch only |
| 4 | Packing-stage audit (provenance-guided) | Many | Unclear | **Low** | Unknown | Medium | Research / more soak — not a sprint |
| 5 | Beam-confidence probe noise cleanup (diagnostics) | Many | Low | Low (noise) | High (diag-only) | Low | Optional DEV hygiene |

---

## Sprint recommendation

**No recognition sprint.**

Fewer than two unrelated scores demonstrate the same *underlying* Minecraft or
Hungarian mechanism. Continue real-world soak with DEV provenance enabled
manually; reopen only when the watch table shows ≥2 unrelated IDs for one
mechanism.
