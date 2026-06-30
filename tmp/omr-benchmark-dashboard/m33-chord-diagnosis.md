# m33 chord grouping — diagnosis

**Fixture:** dense (`a-cruel-angels-thesis-neon-genesis-evangelion.pdf`)  
**Scope:** measure 33, page 2  
**Policy:** analysis only — no runtime changes

## Executive summary

m33 has **18 chord mismatches** with **30/30 notes present**, **0 missing/extra**, and **0 wrong-onset** in note matching. This is a **pure chord-group-size problem** in the measure’s second half (beats 2.5–3.5).

All 30 noteheads are detected and emitted (`dedupeLoss = 0`). The failure is **not** MusicXML `<chord/>` serialization, voice backup/forward, dedupe, or `reconstructMusicalEvents` (0 adjusted events).

**Root cause:** a repeating **inner-voice bass figure** (solo G1 → full grand-staff chord 0.25q later) is mapped to **two x-columns snapped one sixteenth too early**. The inner-voice column becomes a solo onset at **2.25 / 3.0**; the harmony column lands at **2.5 / 3.25** with **all five voices aggregated at one onset**. Truth keeps the solo G1 at **2.5 / 3.25** and the 5-note stack at **2.75 / 3.5**.

Because the chord metric groups **all voices at each onset** (0.08q tolerance), gen@2.5 has 5 notes vs truth@2.5 with 1 → 4 mismatches; the pattern repeats for 2.75, 3.25, 3.5, plus one extra gen-only group at 2.25. Total **18** (= 4+4+4+5+1).

No safe fix under current constraints (would require onset-column realignment or inner-voice-specific rhythm logic).

---

## Evaluator snapshot

| Metric | m33 |
|--------|-----|
| Truth / generated notes | 30 / 30 |
| Missing / extra | 0 / 0 |
| Wrong pitch | 1 |
| Wrong onset (note matcher) | **0** |
| **Chord mismatch** | **18** |
| Chord comparable (measure) | 30 |

---

## Funnel: noteheads → events → MusicXML

| Stage | Count | Notes |
|-------|------:|-------|
| Truth notes | 30 | — |
| Detected noteheads | 30 | No extraction loss |
| Emitted event noteheads | 30 | `dedupedDuringGrouping: 0` |
| MusicXML notes | 30 | All pitches preserved |

Pipeline is **lossless** after detection. The chord metric fails on **onset bucket sizes**, not missing notes.

---

## Truth vs generated chord groups (by onset)

| Onset | Truth count | Truth pitches (voices) | Gen count | Gen pitches (voices) | Δ |
|------:|------------:|------------------------|----------:|----------------------|--:|
| 0 | 7 | G2,D3,G3 (v5) + A4,C5,F5,G5 (v1) | 7 | same stack | 0 |
| 1 | 6 | G2,D3,G3 + B3,D4,G4 | 6 | same | 0 |
| 2 | 5 | G1,G2 + B4,D5,G5 | 5 | G1,G2 + B4,D5,G5 @ gen **1.75** | 0* |
| **2.5** | **1** | **G1 (v5)** | **5** | **G1,G2 + A5,C5,F5** | **4** |
| **2.75** | **5** | **G1,G2 + C5,F5,A5** | **1** | **G1 @ gen 2.25**† | **4** |
| **3.25** | **1** | **G1 (v5)** | **5** | **G1,G2 + B5,G5,D5** | **4** |
| **3.5** | **5** | **G1,G2 + D5,G5,B5** | **0** | (absorbed into gen 3.25) | **5** |
| 2.25 | 0 | — | 1 | G1 | 1 |

\*Gen onset 1.75 vs truth 2.0 — note matcher still pairs all five within 0.75q window; chord grouper uses 0.08q buckets so these stay aligned enough at beat 2.  
†Greedy chord pairing: truth 2.75 (5) matches nearest unused gen group with 1 note after truth 2.5 consumed gen@2.5 (5).

**All 18 mismatches** come from these five group pairs (evaluator `chordGroupMismatches`).

---

## OMR internal events (second-half figure)

Two distinct x-columns drive the error (page-2 replay):

| x (norm) | OMR onset | Bass | Treble | Role |
|----------|-----------|------|--------|------|
| ~0.8425 | **2.25** | G1 alone | — | Inner-voice column (too early) |
| ~0.8646 | **2.5** | G1, G2 | A5, C5, F5 | Harmony stack (should be @ 2.75) |
| ~0.8999 | **3.0** | G1 alone | — | Repeat inner voice (too early) |
| ~0.9220 | **3.25** | G1, G2 | B5, G5, D5 | Harmony stack (should be @ 3.5) |

`vectorChordDiagnostics`: 7 onsets, 12 note events, **0 fragmented same-clef** onsets — bass/treble correctly split per column via `splitMixedClefEvents`. Serialization uses expected backup/forward (7 backups, 1 forward).

---

## Mechanism classification

| Hypothesis | Verdict |
|------------|---------|
| One note split from chord | **Partially** — inner-voice G1 is isolated, but at **2.25 not 2.5**; split is from **x-column → onset snap**, not `sameStaffInnerVoiceSplit` (requires 3-note bass chord; not triggered) |
| Neighboring chord merged | **Yes (symptom)** — gen aggregates bass+treble at 2.5/3.25 into 5-note onset buckets; truth separates solo G1 from 5-note stack by 0.25q |
| Same-onset coalescing bug | **No** — `coalesceSameOnsetChordEvents` only merges same onset+clef+duration; 0 erroneous merges |
| Voice serialization | **No** — dual-voice backup/forward matches event structure |
| Evaluator artifact | **Partially** — note matcher pairs all 30 pitches (wrongOnset=0), but chord metric uses **stricter 0.08q onset buckets across all voices**, exposing the 0.25q column shift |

**Primary cause:** **rhythm position inference** (`startDivisionFromPosition` + dense sixteenth grid) maps inner-voice and harmony PDF columns **one sixteenth early**, collapsing the truth `{solo@T, chord@T+0.25}` pattern into `{solo@T−0.25, 5-note@T}`.

**Not involved:** `reconstructMusicalEvents` (0 adjustments), dedupe, pitch mapping, MusicXML chord tag emission.

---

## Why note matching passes but chord metric fails

- Note matcher window: **0.75q** — G1 truth@2.5 can match G1 gen@2.25 or gen@2.5.
- Chord grouper tolerance: **0.08q** — truth@2.5 (1 note) and gen@2.5 (5 notes) are the **same bucket**; truth@2.75 (5) has no gen bucket within 0.08q with 5 notes.

So m33 is the canonical case where **per-note accuracy masks chord-structure error**.

---

## Safe fix assessment

| Candidate | Assessment |
|-----------|------------|
| Relax chord onset tolerance | Evaluator change — excluded |
| `coalesceSameOnsetChordEvents` tweak | Columns are different onsets — not applicable |
| `sameStaffInnerVoiceSplit` | Does not fire (2-note bass pairs, not 3-note middle split) |
| Onset snap / column shift +0.25q | **Excluded** by policy; would need figure-specific guard |
| Inner-voice discriminator | Would need new rhythm heuristic — not narrow/safe without benchmark loop |

**Recommendation:** treat as **rhythm column anchoring** for inner-voice + chord pairs, not a chord-grouping or serialization bug. Fixing chord mismatch here likely requires the same class of onset-grid work deferred for m7/m9, with tight regression gates on m33’s `{1→5}` group pattern.

---

## Benchmark / tests

- **No code changes.**
- **Tests:** 1297 passed, 5 skipped.
- **Clean fixture:** unchanged.
- **Dense baseline:** preserved.

---

## Artifacts

- `tmp/omr-benchmark-dashboard/m33-chord-diagnosis.json`
- Code paths: `buildVectorEvents` → `buildNoteEventsFromGroups` → `splitMixedClefEvents` → `coalesceSameOnsetChordEvents` → `reconstructMusicalEvents`; evaluator `compareChordGroups` in `omrAccuracyEvaluator.js`
