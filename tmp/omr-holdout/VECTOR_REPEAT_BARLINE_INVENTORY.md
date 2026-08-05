# Vector Repeat Barline Inventory

**Program HEAD at inventory:** `648651a` (after accepted tuplet milestone)  
**Development witnesses only** (no sealed inspection for tuning)  
**Generated MusicXML probe:** `REPEAT_PROBE_GENERATED.json`  
**Detector probe:** `REPEAT_DETECTOR_PROBE.json`  
**Ink edge probe (Korobeiniki p1):** `REPEAT_INK_EDGE_PROBE_KOROB.json`

---

## Shared failure summary

| Holdout | Visible repeats (truth) | Generated `<repeat>` | Generated endings | Detector `repeatMarking` | First failing stage |
| --- | --- | ---: | ---: | --- | --- |
| `piano-korobeiniki-tetris-tiles` | yes (T4: end repeat near m8) | **0** | 0 | none on any measure | ink double-bar+colon classify |
| `piano-super-mario-bros-theme` | yes (T4: repeatsPresent) | **0** | 0 | none | same family |
| `guitar-guaraldi-pumpkin-waltz` | yes (with voltas) | **0** | **4** | endings via PDF text only | barline/dots for `<repeat>` |

Pipeline already calls `detectMeasureStructureMarkings` on vector measures (same raster ink path as scans). **The call site is wired; classification returns null.**

---

## Root-cause hypothesis (shared mechanism, per-score confirmation pending)

Raster repeat detection expects:

1. Two **separated** vertical ink runs (thin + thick) with clearance **2–10 px**
2. A clean **colon** of two compact blobs in staff spaces beside the pair

On these born-digital vector renders (analysis width 1000):

1. **Thick/thin pairs often merge** into one continuous high-strength run after anti-aliased rasterization (e.g. Korobeiniki m8 right edge: offsets `0` and `4…8` all ≥0.99 — one wide bar, not two runs with clearance).
2. **`findDoubleBarNearEdge` therefore returns null** → no colon search → no `repeatMarking`.
3. Repeat **dots** may additionally be font glyphs / small paths that fail `dotNear` dark-count gates even when a pair is found.
4. Guaraldi proves **volta text path works** independently; missing `<repeat>` is specifically the barline+dots joint evidence, not ending labels.

Do **not** assume identical geometry across the three scores until each inventory row is filled; shared raster-threshold mismatch is the leading family.

---

## 1. `piano-korobeiniki-tetris-tiles`

### Source / truth

- PDF: private intake `korobeiniki-tetris-theme-piano-tiles-version.pdf`
- Truth tier T4 (`truth/passages/piano-korobeiniki-tetris-tiles.json`)
- Facts: `repeatsPresent: true`; passage `repeat-and-meter` → `endRepeatNearM8: true`; meter change near m20; vector; grand staff

### Visible repeat candidates (PDF visual / T4)

| ID | Page | System | Staff | Measure (approx) | Direction | System position | Notes |
| --- | ---: | ---: | --- | --- | --- | --- | --- |
| K1 | 1 | mid | grand | ~8 | backward (end repeat) | internal / system-end-ish | Primary T4 witness |
| K2+ | 1–2 | TBD | grand | TBD | TBD | TBD | Additional repeats likely; confirm during implementation crops |

### Barline geometry (m8 right edge, page 1)

- Measure box uses `xStart/xEnd` / `yTop/yBottom` (normalized by detector).
- Right edge `cx≈812`: strong columns at offset `0` (0.99) and continuous `4…8` (0.99) — **merged thick bar**, not separated thin+thick.
- Weak secondary peaks near `-28/-29` (~0.36) — below reliable paired-run pairing with required clearance.
- `detectMeasureStructureMarkings` → `repeatMarking: null` for all page-1 measures.

### Dot / glyph provenance

- Not yet isolated to a MusicXML glyph id; expected engraved colon left of thick bar for backward repeat.
- Raster `colonInBand` / `dotNear` never reached because double-bar stage fails.

### Expected MusicXML (source-faithful)

- Right barline on the closing measure: `<barline location="right"><repeat direction="backward"/></barline>`
- Matching forward (if present): `<barline location="left"><repeat direction="forward"/></barline>`
- Preserve meter changes / no invented voltas

### Generated MusicXML

- `repeats: 0`, `endings: 0`, `left/right barlines: 0`
- Notes ~609 / measures 45 (full 2-page run)

### First failing pipeline stage

`detectOmrRepeatBarline.findDoubleBarNearEdge` → null on vector-rasterized thick bars  
→ `detectRepeatAtEdge` abstains  
→ no `repeatMarking` on measure records  
→ MusicXML emitter emits nothing

---

## 2. `piano-super-mario-bros-theme`

### Source / truth

- T4: `repeatsPresent: true`, vector grand staff, also tuplets (now fixed at `648651a`)
- Generated after tuplet milestone: `repeats: 0`, `endings: 0`

### Visible repeat candidates

| ID | Page | Direction | Position | Notes |
| --- | ---: | --- | --- | --- |
| M1+ | 1–2 | forward/backward (visual) | system-start / section | Exact measure indices during crop pass |

### Detector

- Page 1–2: **0** `repeatMarking` / **0** raw detector hits (same ink path).
- Likely same merged double-bar / colon failure family; confirm measure-edge profiles before sharing thresholds with Korobeiniki.

### Expected / generated

- Expected: balanced forward/backward `<repeat>` at section boundaries visible in PDF
- Generated: no `<repeat>`, no barline wrappers for repeats

---

## 3. `guitar-guaraldi-pumpkin-waltz`

### Source / truth

- Paired guitar; development; prior notes: endings present without repeats

### Generated

- `repeats: 0`
- `endings: 4` (volta 1/2 start/stop present)
- `leftBarlines: 2`, `rightBarlines: 2` (ending barlines only)

### Detector

- `endingMarking` from PDF text (`1.` / `2.`) succeeds (sample measure 12: ending 2 + stop hook)
- `repeatMarking` remains null — **repeat dots/bars fail while volta text succeeds**

### Expected MusicXML

- Forward/backward repeats jointly with volta endings (standard 1st/2nd ending shape)
- No duplicate endings; no orphan repeat state

### Distinction vs piano witnesses

- Same missing `<repeat>` symptom
- Extra: TAB/notation pairing residual (separate cluster; not this repair’s primary scope)
- Local tuplet recovery correctly disabled (`tm=0`)

---

## Pipeline trace (structure)

```
PDF render → ImageData (1000px)
  → processVectorPageSystems / measure boxes
  → detectMeasureStructureMarkings(imageData, box, …)   // ALREADY CALLED
       → findDoubleBarNearEdge (FAILS on merged vector bars)
       → repeatColonNear (not reached / fails on glyph dots)
       → detectVoltaFromText (WORKS on Guaraldi)
  → finalizeRepeatMarkings / sanitizeOmrRepeatMarkings
  → buildOmrMusicXml shouldEmitRepeat
```

Raster scan path (frozen `piano-articulation-scan`) already recovers repeats/voltas at `f091ee7` — **do not regress that**.

---

## Distinctions to protect in tests

- Forward vs backward
- Ordinary double bar / final bar **without** dots → not a repeat
- Stem / notehead near barline ≠ repeat dots
- Volta with and without repeat
- System-start forward / system-end backward / internal
- Guitar/TAB + frozen scan protections

---

## Implementation direction (next)

1. Vector-aware double-bar: treat wide continuous thick run + nearby thin companion **or** vector path thickness pairs; widen clearance / run-split logic carefully.
2. Colon: staff-space glyph/path dots when ink blobs fail; keep joint evidence (bars + dots).
3. Validate on Korobeiniki + Mario + Guaraldi development only; sealed milestone after accept; preserve scan fixtures.
4. Commit message if accepted: `fix(omr): recognize vector repeat barlines`

---

## Status

- Inventory started and leading mechanism proven on Korobeiniki ink profiles.
- Mario/Guaraldi detailed per-repeat coordinate table still to be completed during crop pass while implementing.
- **Experiment 1 (merged-thick raster fallback) rejected and fully reverted** — see `EXPERIMENT_LOG.md`. Synthetic fixture regressed; Korob/Mario pipeline still 0.
- Production tree remains at tuplet commit `648651a` with `detectOmrRepeatBarline.js` unchanged from that HEAD.
- Next: materially different hypothesis (vector path/glyph evidence), not another threshold tweak on the same raster pair finder.
