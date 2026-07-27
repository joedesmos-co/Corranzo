# Rhythm Sprint 4 — RCA (dense chords + flags/partial beams)

Evaluator frozen. Analysis before recognition changes.

## Trace path (dense chords)

```
notehead columns (cx / positionInMeasure)
  → groupVectorNoteheads / mergeGroupsSharingBeat (chordMergeX ≈ 10–28)
  → buildNoteEventsFromGroups (position snap → startDivision; gap → duration)
  → refineEventDurationsFromBeamEvidence / resnapFlooredBeamOnsets
  → coalesceSameOnsetChordEvents   ← duration+cxBucket key blocks merges
  → reconstructMusicalEvents (split-chord-tone only if anchor ≥3 notes, gap=1, d≤16th)
  → MusicXML (<chord/> only within one event.notes[])
```

## Dense chord findings

**Truth (dense m2–3):** unbeamed eighth chords on an eighth grid; bass quarters under.

**Gen:** irregular sixteenth packing (`starts` like `[0,3,5,7,9,12]`); many multi-note events already, but:

1. **Same-onset fragments with different durations** (e.g. m2 `@5` two events, same `cx≈244`, d=1 vs d=2) — `coalesceSameOnsetChordEvents` keys on `start:clef:duration:cxBucket`, so they never merge → separate serialization / chord defects / cursor noise.
2. **Adjacent-start chord orphan** (e.g. m3 `@6` chord `cx=400` + `@7` single `cx=400`, gap=1) — `splitChordToneCandidate` requires `anchor.notes.length ≥ 3`, so 2+1 stacks never reattach.
3. **cxBucket=/20** keeps same-onset fragments in neighboring buckets when dx straddles a 20px boundary.
4. Stem-share pairs were rare in probes; failure is mostly **x-aligned / near-x sequentialization**, not missing stems.

**Classification:** simultaneous notes incorrectly advancing as separate attacks (class C), cascading duration→onset.

Not primarily missed stems/beams on dense: truth chords are **unbeamed eighths**.

## Flags / partial beams findings

| Fixture | Visual truth | Probe |
|---|---|---|
| dense m2–4 | unbeamed 8ths | secondary beams sometimes fire; “flag” probe very noisy (notehead/ledger ink, primary≈2) |
| tuplets m2 | **flagged 16ths** (MusicXML `beam` count 0) | some `beams=2` / gap-16ths already; real flag path still missing |
| paired-chords m1 | unbeamed quarters | high false “flagLike” — **cannot ship loose flag heuristic** |

**Partial secondary beams:** Sprint 2 `hasSecondaryBeamRow` (run≥8) already covers full secondary rows. Partial stubs (shorter second row) still under-counted; lowering secondary threshold without gating risks Q→16th.

**Decision:**  
- Ship **chord coalesce + split-tone relax** (RCA-backed, dense ROI).  
- Ship **strict double-flag → beams=2** only when primary beam absent and two tip-adjacent short runs exist (single flag → eighth via beams=1). Keep strength≥14 out of sixteenth path.

## Proposed smallest fixes

1. `coalesceSameOnsetChordEvents` — merge same start+clef when |Δcx| ≤ chord window; ignore duration key; keep max duration.
2. `splitChordToneCandidate` — allow anchor ≥2 notes; gap 1–2; anchor duration ≤ eighth.
3. `countFlags` / wire into `countBeams` path — strict, no darkness-only sixteenths.
