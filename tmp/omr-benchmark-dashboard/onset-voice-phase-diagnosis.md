# OMR Onset Voice-Phase Sprint — diagnosis

**Date:** 2026-07-02  
**Algorithm changes:** None (sixteenth cluster snap re-simulated — zero effect)

## Benchmark baseline (unchanged)

| Fixture | Onset | wrongOnset | Chord | Pitch | missing/extra |
|---------|------:|-----------:|------:|------:|---------------|
| Gymnopédie | 100% | 0 | 0 | 0 | 0/0 |
| Cruel Angel | 96% | **94** | 172 | 147 | 28/28 |
| Twinkle | 93% | **6** (m10) | 0 | 0 | 0/0 |

## Simulation re-run

| Candidate | wrongOnset | Chord | Twinkle | Verdict |
|-----------|----------:|------:|---------|---------|
| Sixteenth grid in dense cluster phase (`buildNoteEventsFromGroups`) | 94 | 172 | 6 | **No change — not promoted** |

Prior candidates still ruled out: position renormalization (94→285), opening-column-for-all-groups (+7 onset, +52 chord).

---

## Where errors are introduced (pipeline stages)

| Stage | m7–m9 finding | m121 finding | Twinkle m10 |
|-------|---------------|--------------|-------------|
| Raw vector glyphs | Noteheads detected; x spacing consistent with sixteenth grid | Same; page-8 coda figure | Eighth-run bass detected |
| Onset columns | `shouldInferRhythmFromPositions=true`; opening 2.5q bass sustain at beat 0 (m9) | Dense sixteenth alternation | Quarter-grid groups; min gap triggers position mode |
| Grouping | `mergeGroupsSharingBeat` + cluster snap; **assigned onset == snap16** (not eighth-cluster bug) | Repeated arpeggio columns | Grand-staff clef split |
| `buildNoteEventsFromGroups` | x→division correct for snap16; errors are **column selection / duration pipeline**, not raw snap | Register pairing dominates | Bass accompaniment shifted +0.5/+0.75q |
| Post-process | Inner-voice phase **not applied** (requires beat≥2, stack≥5) | Same | Not applied |
| MusicXML serialization | Truth voice 5 → gen voice 2 (clef→voice map in `buildOmrMusicXml`) | Same pattern on bass | 4/6 errors are voice-5→voice-2 with same pitch |

**Conclusion:** Remaining onset errors split between (1) **evaluator/matcher coupling** on repeated pitch classes, (2) **serialization voice shift** (same pitch, truth v5 vs gen v2, +0.5/+0.75q), and (3) a **small tail of true unique-pitch slot shifts** (~14) where OMR emits wrong column in repeated figures — not fixable by cluster snap alone.

---

## Per-measure trace (hotspots)

### Cruel Angel m7 (8 wrong onsets)

| truth | gen | Δq | pitch | voice T→G | class |
|-------|-----|---:|------:|-----------|-------|
| A#1@0.5 | A#1@1.25 | +0.75 | ok | 5→2 | serialization-voice-shift |
| F4@0.5 | F4@1.25 | +0.75 | ok | 1→1 | unique-pitch-slot-shift |
| G#4@1.5 | A#4@2.25 | +0.75 | ±2 | 1→1 | cross-voice-matcher |
| D#4@2.75 | D4@2.25 | −0.5 | ±1 | 1→1 | cross-voice-matcher |
| A#2@3 | A#2@3.75 | +0.75 | ok | 5→2 | serialization-voice-shift |
| D2@3.5 | D2@3 | −0.5 | ok | 5→2 | serialization-voice-shift |

Histogram: serialization 4, cross-voice 2, unique 2.

### Cruel Angel m8 (7)

Opening treble @0 emitted @0.75 (+0.75); bass inner voice ±0.5 slips. Coupled with 5 missing / 6 extra (serialization downstream).

### Cruel Angel m9 (18 — largest hotspot)

- 13 independent at correct pitch/duration with +0.5/+0.75 late
- Repeated A#/F/Bass figure: matcher links truth@0.5 → gen@1.25 when **both slots exist** (duplicate-pitch-instance)
- Unique B1/F#2/B2@1.5 → gen@2.25: OMR places note at correct x for 2.25 column, wrong figure iteration
- Opening beat-0 errors coupled with cross-voice matcher (pitchΔ −9 to −22)

### Cruel Angel m121 (9)

Mixed register slips (pitchΔ −17 on A#2) and ±0.5/0.75 phase on coda bass line. No inner-voice or phantom correction applied.

### Twinkle m10 (6 — simple canary)

| truth | gen | Δq | voice T→G | class |
|-------|-----|---:|-----------|-------|
| G3@0.5 | G3@1 | +0.5 | 5→2 | serialization-voice-shift |
| A3@1 | A3@1.5 | +0.5 | 5→2 | serialization-voice-shift |
| A4@1 | A4@1.5 | +0.5 | 1→1 | unique-pitch-slot-shift |
| B3@1.5 | B3@2.25 | +0.75 | 5→2 | serialization-voice-shift |
| C4@2 | C4@2.75 | +0.75 | 5→2 | serialization-voice-shift |
| G4@2 | G4@2.75 | +0.75 | 1→1 | unique-pitch-slot-shift |

100% of deltas are +0.5q or +0.75q. Bass accompaniment (truth voice 5) systematically late by one eighth/two sixteenths in generated voice 2.

---

## Score-wide error-class mix (94 wrong onsets)

| Class | Count | Fixable in OMR engine? |
|-------|------:|------------------------|
| cross-voice-matcher | 43 | No — greedy matcher artifact |
| serialization-voice-shift | 35 | Needs voice-aware rhythm path; risks Twinkle/dense regression |
| unique-pitch-slot-shift | 14 | Partial — repeated-figure column selection; no safe generic rule |
| duplicate-pitch-instance | 2 | No — evaluator instance pairing (gen has correct slot) |

Strict independent (pitch+dur ok): **19 / 94**.

---

## Decision

**No algorithm change.** No single narrow rule applies to ≥3 measures without touching:
- MusicXML voice mapping (clef→voice 2 vs truth voice 5),
- evaluator matching on repeated figures, or
- broad position/duration pipeline (proven regressions).

Sixteenth cluster snap — the most targeted generic hypothesis — was **re-simulated and confirmed zero benchmark effect**.

## Diagnostics added

- `src/features/omr/omrOnsetVoiceTrace.js` — `buildMeasureOnsetTrace`, `summarizeOnsetVoicePhaseDiagnosis`
- `tests/omrDiagnostics.test.js` — pins dense/Twinkle m10 counts
- `tmp/omr-benchmark-dashboard/onset-voice-phase-trace.json` — machine-readable traces

## Recommended next pass (not this sprint)

1. **Voice-aware MusicXML rhythm** for grand-staff accompaniment (truth voice 5 lane) — high risk; requires Twinkle m10 canary + dense m7–m9
2. **Playable-span position denominator** — may fix m5 D2 only; benchmark-gated simulation required
3. **Do not** extend inner-voice phase to beat 0 — pattern guards require beat≥2 and stack≥5 for regression safety
