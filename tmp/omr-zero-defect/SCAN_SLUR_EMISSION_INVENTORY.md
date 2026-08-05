# Scan Slur Emission Inventory

**HEAD:** `36ccb99`  
**Fixture:** `piano-articulation-scan`  
**Page:** 1 (1000×1294 after preprocess/deskew −0.25°)  
**Ink threshold:** ~193  

## Closed (do not force)

MusicXML encodes m3 A4 → m4 A♯4 as a **tie**. PDF shows a **different-pitch slur**. Emitting a tie is benchmark-truth imitation. Source-supported work = emit `<slur>` only. Original-corpus `missing-tie×2` may remain.

## Source-supported printed curves

| ID | Class | Span | Start | Stop | Side | Truth encoding | Generated @36ccb99 | Source-faithful |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | **5. cross-measure slur** + **2. different-pitch** | m1→m2 sys0 | F4 mono d12 cx≈266 cy≈291 | G4 mono d12 cx≈449 cy≈284 | **above** | `<slur>` | absent | emit slur |
| C2 | **5. cross-measure slur** + **2. different-pitch** | m3→m4 sys0 | A4 mono d12 cx≈648 cy≈277 | A♯4 mono d12 cx≈849 cy≈280 | **below** | `<tie>` (mislabeled) | absent | emit slur |

No same-pitch ties are printed on this scan. No cross-system slurs. Chord endpoints are not used for these two curves (both ends monophonic).

### Geometry evidence (ink survey)

- **C1 F4→G4:** dense bowed row ~17px above midline across the full span; second-measure half passes existing tie-band probe on the above side; full span dx≈183px (exceeds tie max 140px).
- **C2 A4→A♯4:** dense bowed row ~17px below midline; dx≈201px; left (m3) half shows below-side arc (matches prior accent-FP “slur below A4”).

### Competing distractors (rejected by refined rules)

| Pair | Why it fires naively | Rejection |
| --- | --- | --- |
| F4→E4 (m1→m2) | Same above slur, wrong stop | Lower score than F4→G4; greedy start exclusivity |
| F♯4→A4 (m3) | Below-arc fragment of C2 | Weak start endpoint support |
| A4→C5 (m7) | Dense below+above staff corridor | Side dominance ≈ 0 (not a single bow) |

## Non-musical / noise curves

Accent wedges, staccato dots, beams, stems, staff/ledger rows: handled by existing articulation and tie gates; slur probe excludes continuous staff rows and requires bowed single-side coverage.

## Production handling @36ccb99

1. `processOmrPage` → `finalizeRasterPageTies` only (same-pitch enrich pairs).
2. Vector `applyVectorPageTies` / `collectInkArcSlurPairs` not wired for scan; same-measure-only; tie ink band too narrow/short for phrasing bows.
3. MusicXML emit path already supports `slurStart`/`slurStop` via `buildOmrMusicXml`.

## Root cause

**No raster slur emitter.** Tie ink-arc probe is intentionally narrow (band ≤ ~1 staff space, max cross-bar 140px, same-pitch only) and correctly refuses these phrase marks.

## Classifier / ownership rules (Phase 2–4 design)

1. Candidate = monophonic, different-pitch, same clef/system, onset-ordered pair; dx ∈ [48, 230]; ≤1 intervening mono.
2. Wider slur probe (band ≈ 0.25–2.2 staff spaces): single-side coverage + mid-span continuity + curvature ≥ 3px; staff-corridor rows excluded.
3. Side dominance: |below−above| coverage ≥ 0.12.
4. Endpoint support: ink pocket beside each head on the chosen side.
5. Cross-bar: at least one measure-half passes on the same side as the full span.
6. Greedy non-overlapping selection by score (coverage + mid + cross-bar bonus + endpoint support + span).
7. Emit `slurStart`/`slurStop` only — never `tie*` for different pitches; playback attack unchanged.

## Same-pitch ties

Unchanged: still only via `finalizeRasterPageTies` same-pitch pairing.
