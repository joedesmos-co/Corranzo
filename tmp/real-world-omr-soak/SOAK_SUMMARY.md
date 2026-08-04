# Real-world OMR soak — consolidated 20-score summary (Waves 1–3)

**Recognition baseline (frozen):** `541f607`  
**Provenance diagnostics:** `69338f1`  
**Updated:** 2026-07-28 — Wave 3 complete (final broad soak)  
**Production recognition changes:** **none**

### Hard freezes (unchanged)

- Do **not** reopen Minecraft sparse/open-notehead recognition.
- Do **not** reopen Hungarian dense-rhythm recognition.

### Rating scale

Excellent · Good · Usable with errors · Poor · Failed

---

## Wave 3 selection

| Role | Score | Result |
|---|---|---|
| Second true raster | Guitar Paired Scan (fixture) | **Completed** (UI + pipeline) |
| Real guitar TAB (notation + TAB) | Guitar Techniques Paired Vector | **Completed**; `<string>`/`<fret>` emitted |
| Mixed / unusual export | Iris Out arrangement (multi-font vector) | **Completed** (no embedded images; unusual fonts on all pages) |
| Sparse classical | Bach Chorale BWV 259 (practice-library) | **Failed** — Mutopia low-confidence gate |
| Dense beamed piano | Mozart Turkish March (practice-library) | **Failed** — same gate |
| Sparse counterexample | Brahms Lullaby (same library family) | **Completed** (passes gate) |

LOC Twinkle 1880 remains a Failed hard raster (Wave 2). Guitar-paired-scan is a cleaner fixture scan that **succeeds**.

**No true vector+raster mixed music PDF** was available in local Downloads/fixtures; Iris Out fulfills the “unusual fonts / atypical export” clause. Page sources recorded below.

### UI / transport notes (Wave 3)

- Upload → automatic OMR via visible Library → My Uploads path.
- Loop toggle OK; Piano ↔ Guitar keeps playable events; Library ↔ Practice round-trip OK; reload restores score; no stale-overlay alerts.
- Automated audible probes: `AudioContext` reached `running`, Play clicked; frequency-analyser energy stayed `0` (engine graph not tapped) and `isPlaying` flag unreliable headless. **Do not treat event counts as audio proof.** Manual listen still recommended for guitar-paired-scan, guitar-techniques-tab, and Iris Out.

---

## Overview — all 20

| # | Title | Type | Pages | Visual | Playback | OMR | MC | HU | Severity |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Minecraft Themes | vector | 3 | Usable with errors | Usable with errors | OK | **yes** | no | High |
| 2 | Evangelion | vector | 8 | Usable with errors | Usable with errors | OK | no | no | Medium |
| 3 | Gymnopédie No. 1 | vector | 3 | Usable with errors | Usable with errors | OK | no | no | Medium |
| 4 | Hungarian Dance No. 5 | vector | 4 | Usable with errors | **Poor** | OK | no | **yes** | High |
| 5 | Fantaisie-Impromptu | vector | 5 | Usable with errors | Usable with errors | OK | no | no | Medium |
| 6 | Campanella (étude) | vector | 8 | Good | Usable with errors | OK | no | no | Medium |
| 7 | Carol of the Bells | vector | 2 | Usable with errors | Usable with errors | OK | no | no | Med–low |
| 8 | Moonlight 3 | vector | 12 | Usable with errors | Usable with errors | OK | no | no | Medium |
| 9 | Wet Hands | vector | 2 | Usable with errors | Usable with errors | OK | no | no | Low |
| 10 | Campanella (grandes) | vector | 11 | Good | Usable with errors | OK | no | no | Med–low |
| 11 | Piano Articulation Scan | **raster** | 1 | Usable with errors | Usable with errors | OK | no | no | Medium |
| 12 | Here Comes The Sun (guitar) | vector | 2 | Usable with errors | Usable with errors | OK | no | no | Med–low |
| 13 | Twinkle (easy) | vector | 1 | Usable with errors | Usable with errors | OK | no | no | Med–low |
| 14 | Vivaldi Winter (Rousseau) | vector | 8 | Usable with errors | Usable with errors | OK | no | no | Medium |
| 15 | Spider Dance | vector | 4 | Usable with errors | Usable with errors | OK | no | no | Med–low |
| 16 | **Guitar Paired Scan** | **raster** | 1 | Usable with errors | Usable with errors | OK | no | no | Medium |
| 17 | **Guitar Techniques TAB** | vector | 1 | Usable with errors | Usable with errors | OK | no | no | Med–low |
| 18 | **Iris Out (unusual export)** | vector* | 5 | Usable with errors | Usable with errors | OK | no | no | Medium |
| 19 | **Bach Chorale BWV 259** | vector | 1 | **Failed** | **Failed** | **Failed** | no | no | High |
| 20 | **Turkish March** | vector | 5 | **Failed** | **Failed** | **Failed** | no | no | High |

\*Iris: all pages `vector-unusual-fonts` (no paint-image ops).

**Adjacent evidence (not double-counted in the 20):** Brahms Lullaby passes the same library family; Für Elise / Handel / Minuet / Mazurka / Pathétique / Waltz also hard-reject at the same confidence gate (see cluster JSON).

---

## Wave 3 scorecards (16–20)

### 16. Guitar Paired Scan

| Field | Value |
|---|---|
| Title / source | Guitar Paired Scan — Corranzo `omr-fixtures` synthetic scan |
| Pages | 1 |
| Type | **raster** (page 1: image-only, 0 text chars) |
| Source quality | meanGray 246.5 · std 33.3 · contrast 0.135 · darkFraction 0.036 · skewProxy ≈1.6° · staff ridges 72 → **staff visibility good** · 918×1188 @1.5× |
| Path/glyph density | low–medium (49 pipeline notes; UI 114 events) |
| OMR | Completed (conf usable; not low-confidence reject) |
| Measures / notes / events / duration | ~5–8 measures class · 49 notes · **114 events** · **20s** |
| Visual / playback | Usable with errors / Usable with errors |
| Pitch / rhythm / long / dots / rests | Usable with errors · Usable · Usable · Good · Usable |
| Chords / voices / beams | Usable · Usable · Good (no short-lost) |
| Ties/slurs / accidentals / articulations / tempo | Usable with errors |
| TAB routing | Scan has **no text layer** — frets/strings **0** (expected honest limitation per fixture README) |
| Renderer-only | Scan softness |
| Lag | Good |
| Reproducibility | High |
| Provenance RCA | `no-clear-shared-rca` |
| Matches | MC no · HU no · false-beam no · raster reject **no** · false-TAB **n/a (scan)** |
| Nav | Library round-trip OK · reload OK · no stale overlay |

### 17. Guitar Techniques Paired Vector (notation + TAB)

| Field | Value |
|---|---|
| Title / source | Guitar Techniques Paired — fixture with standard notation + six-line TAB |
| Pages | 1 |
| Type | vector (unusual multi-font) |
| Source quality | Clean vector engraving |
| Density | low (32 notes / 12 measures) |
| OMR | Completed |
| Measures / notes / events / duration | 12 · 32 · **32** · **22s** |
| Visual / playback | Usable with errors / Usable with errors |
| Pitch / rhythm / long / dots / rests | Usable · Usable · Usable · Good · Good |
| Chords / voices / beams | Usable · Usable · Usable (shortLost=11, below HU) |
| TAB routing / pairing | **`<string>`=32, `<fret>`=32** — routing present; `tabFalseRouting=false`. `staff-lines=6` not always emitted as MusicXML staff-details in this capture |
| Matches | MC no · HU no · **false-TAB routing no** |
| Provenance RCA | `no-clear-shared-rca` |
| Nav | OK |

### 18. Iris Out (piano arrangement)

| Field | Value |
|---|---|
| Title / source | Iris Out — third-party arrangement PDF |
| Pages | 5 (sampled 2 for provenance; UI full-ish **2310 events**, ~204s) |
| Type | **vector-unusual-fonts** on pages 1–5 (no raster images) |
| Page sources | All vector text+path; fonts `g_d7_f*` family |
| Density | high |
| OMR | Completed |
| Visual / playback | Usable with errors / Usable with errors |
| Pitch / rhythm / beams | Usable · Usable · Usable (beam-confidence noise 625; packing 80; shortLost 22) |
| Provenance RCA | Tagged `false-beam-correction-sparse` by count heuristic — **not** treated as same chain as Twinkle-easy without shared first-stage proof (Iris is dense + packing-dominated) |
| Matches | MC no · HU no |
| Nav | OK |

### 19. Bach Chorale BWV 259

| Field | Value |
|---|---|
| Title / source | Practice-library Mutopia-style vector |
| Pages | 1 · vector-unusual-fonts |
| OMR | **Failed** |
| Failure | `PDF too difficult… [low-confidence]` |
| Analysis behind reject | **358 notes**, measures≈33, overallConfidence≈**0.641** — extraction ran, gate rejected |
| Visual / playback | **Failed** / **Failed** |
| First failing stage | `runPdfOmrPipelineBody` **difficulty / low-confidence gate** (after note extraction) |
| Matches | MC no · HU no · **Mutopia low-confidence reject yes** |
| Reproducibility | High |

### 20. Mozart Turkish March

| Field | Value |
|---|---|
| Title / source | Practice-library dense beamed piano |
| Pages | 5 · vector |
| OMR | **Failed** (same gate) |
| Analysis behind reject | **2167 notes**, measures≈60, conf≈**0.648** on 2-page sample |
| Visual / playback | **Failed** / **Failed** |
| First failing stage | Same **low-confidence gate after extraction** |
| Matches | MC no · HU no · **Mutopia low-confidence reject yes** |
| Reproducibility | High |

### Sparse counterexample (adjacent)

**Brahms Lullaby** — same practice-library family — **passes** (53 notes, UI 41 events, 20s, no MC/HU). Shows the gate is not “all Mutopia fail,” but many mid-confidence Mutopia exports with *large* note counts still hard-reject.

---

## Root-cause groups (20-score reassessment)

### 1. Minecraft dy + open-glyph collapse — **FROZEN**

| | |
|---|---|
| Unrelated affected | **1** (Minecraft Themes) |
| First stage | Dot dy gate; then dense packing vs open glyphs |
| Severity / confidence | High / High |
| Safe fix / regression | Not yet / High |
| Sprint? | **No** |

### 2. Hungarian beam-short → longer — **FROZEN**

| | |
|---|---|
| Unrelated affected | **1** (Hungarian) |
| First stage | Beam attach/confidence; then gap/coalesce/packing |
| Severity / confidence | High / High |
| Sprint? | **No** |

### 3. False-beam correction on sparse beginner — **watch only**

| | |
|---|---|
| Unrelated affected | Twinkle-easy clearly; Iris count-similar but **different density/packing chain** |
| Require same stage? | **Not proven shared** across unrelated |
| Sprint? | **No** |

### 4. Hard raster low-confidence rejection

| | |
|---|---|
| Unrelated affected | LOC Twinkle 1880 **Failed**; Articulation Scan **OK**; Guitar Paired Scan **OK** |
| Two independent raster **failures** at same stage? | **No** (only one Failed hard scan in soak) |
| Sprint B? | **No** |

### 5. Guitar false-TAB routing

| | |
|---|---|
| Real TAB score | Techniques paired → **string/fret present** |
| Scan paired | No text layer → no frets (expected) |
| Sprint C? | **No** |

### 6. NEW — Mutopia / practice-library **low-confidence hard reject after successful extraction**

| | |
|---|---|
| Unrelated affected | Bach Chorale, Turkish March, Handel Gavotte, Demo Minuet, Brahms Waltz, Chopin Mazurka, Beethoven Pathétique, Für Elise (+ more probes) — **≥2 clearly** |
| Counterexample | Brahms Lullaby passes |
| First failing stage | **`runPdfOmrPipelineBody` difficulty/low-confidence gate** after analysis already reports hundreds–thousands of notes @ conf ≈0.64–0.67 |
| Representative | Turkish (2167 notes rejected); Chorale (358 rejected); Pathétique (2708 rejected) |
| User impact | **High** — usable-looking Mutopia PDFs never enter practice; message says “too difficult” |
| Evidence confidence | **High** (same errorCode/stage, repeated) |
| Safe-fix potential | **Medium–high** for a **narrow gate/policy** change (not rhythm heuristics); must not admit truly bad scans |
| Regression risk | **Medium** (LOC-class rasters must stay rejected) |
| Artifact | `tmp/real-world-omr-soak/wave3/MUTOPIA_LOW_CONFIDENCE_CLUSTER.json` |

### 7. Packing / beam-confidence probe noise

| | |
|---|---|
| Affected | Many dense vectors (Spider, Iris, Fantaisie, …) |
| Confidence as single defect | **Low** |
| Sprint? | **No** |

---

## Final decision (exactly one)

### **A. ONE NARROW RECOGNITION / ACCEPTANCE SPRINT**

**Scope (narrow):** Investigate and fix the **post-extraction low-confidence hard reject** that discards Mutopia/practice-library vector PDFs after the pipeline has already produced large note counts (conf ≈0.64–0.67).

**Why A (not B/C/D):**

- **≥2 unrelated scores** share the **same first failing stage** (confidence/difficulty gate), with provenance/analysis evidence — not merely similar-looking notation.
- This is **not** Minecraft dots/opens and **not** Hungarian beam promotion.
- Raster reliability (**B**) does not qualify: only one Failed hard scan; two fixture scans succeed.
- Guitar/TAB (**C**) does not qualify: real TAB emits string/fret; no general false-TAB routing reproduced.
- **D** does not apply: a shared mechanism **does** exist.

**Explicit non-goals for this sprint:** no Minecraft dy widen; no Hungarian beam caps; no broad rhythm heuristic retunes.

**Suggested acceptance checks if/when implemented later:** Chorale + Turkish (and one more Mutopia reject) become importable without regressing LOC Twinkle 1880 rejection or Evangelion false-dot controls.

---

## Pointers

| Artifact | Path |
|---|---|
| Wave 3 runner | `tmp/real-world-omr-soak/run-wave3-soak.mjs` |
| Wave 3 records | `tmp/real-world-omr-soak/wave3/WAVE3_RECORDS.json` |
| Mutopia gate cluster | `tmp/real-world-omr-soak/wave3/MUTOPIA_LOW_CONFIDENCE_CLUSTER.json` |
| Campaign RCA | `tmp/corranzo-dot-dense-rhythm/CAMPAIGN_REPORT.md` |
| Recognition freeze | `541f607` |
| Provenance | `69338f1` |
