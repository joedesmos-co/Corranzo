# Phase 2 — Local rasterization design (no production code)

Baseline: `beeb5f0`. Optical profile disabled. Vector fragment clustering removed.

## Invocation gate

Raster fallback runs only when **all** hold:

1. Page source is vector PDF (existing vector OMR path)
2. A note/glyph candidate already exists
3. Ordinary ink anchor failed
4. Ledger-masked ink anchor failed
5. `rejectedReason === 'no-head-sized-component'`
6. A bounded crop can be derived from glyph origin + staff spacing (+ chord column)

Precedence remains:

1. Ordinary vector ink  
2. Ledger-masked vector ink  
3. **Local raster notehead** (this design)  
4. Glyph-metric fallback  

Raster must never override a trusted vector anchor.

## Crop geometry (staff spaces)

Centered on optical prior `(glyphX + 0.55·gap, glyphY − 0.51·gap)`:

| Side | Spaces |
|---|---:|
| Left | 0.55 |
| Right | 1.35 |
| Above | 1.25 |
| Below | 0.45 |

From Phase 1 inventory (226 rejects):

- Mean analysis gap ≈ 13–20 px → mean target crop ≈ **57×52 px** at ~**2.1×** local scale
- Target density: **28 px / staff space**
- Hard clamp: crop side ≤ **220 px**
- Empty crops at analysis resolution: **0**; recoverable-likely: **224 / 226**

## Scale and DPI

- Analysis render stays at `CALIBRATION_ANALYSIS_WIDTH` (1000) for vector OMR
- Local raster uses either:
  - **A (preferred):** one supersampled page (or band) render cached per page, crops extracted as views; or
  - **B:** PDF.js viewport crop render at `analysisScale × localScale` for the crop rect only
- Deterministic scale: `max(1, 28 / gapPx)` then clamp by max side
- Approx DPI ≈ analysis DPI × local scale (~150–220 on typical fixtures)

## Cache

| Key | Behavior |
|---|---|
| Page cache key | `pdfHash|page|supersampleScale` |
| Tile/band optional | horizontal bands of ~4 staff spaces when page supersample is too large |
| Hit | crop extract from cached ImageData / ImageBitmap |
| Miss | single supersample render; store; extract |
| Eviction | LRU; max 1–2 pages; dispose bitmaps on page complete / cancel |
| Cap | ≤ **64** raster recoveries per page; skip remainder → metric fallback + `skipReason: candidate-limit` |

Dense fixture budget (Phase 1): `piano-dense-advanced-vector` has **118** no-head candidates on page 1 — **must** apply candidate limit + prioritize high-register / ledger-bearing candidates, or share one page supersample and only segment up to the cap.

## Memory / cost sketch

| Item | Estimate |
|---|---|
| Mean crop RGBA | ~57×52×4 ≈ **12 KB** |
| 64 crops | ~0.75 MB (views; shared page buffer dominates) |
| Supersampled page @ 2.1× of 1000×1294 | ~2100×2717×4 ≈ **23 MB** peak |
| Segmentation | O(crop pixels); budget &lt; 2 ms/crop mean on desktop |
| Worst page | dense advanced: prefer **one** supersample + ≤64 segmentations, not 118 PDF re-renders |

## Worker / UI

- Run supersample + segmentation on existing OMR worker path (no main-thread PDF render loops)
- Honor AbortSignal / pipeline cancellation; release canvas/bitmap on abort
- Provenance timing: `rasterMs`, `segmentMs`, `cacheHit`

## Provenance fields

```
rasterFallback: {
  invoked | skipped,
  skipReason?,
  cropBounds,
  rasterScale,
  cacheHit,
  components[],
  selected?,
  opticalCenter?,
  confidence,
  rejectedCompetitors[],
  processingMs,
  finalAnchorSource
}
```

## Non-goals

- Full-page raster OMR rewrite  
- OCR  
- Optical SMuFL profile  
- Vector fragment clustering revival  
- Inventing notes without glyph/candidate evidence  

## Implementation order (Phase 7)

| Step | Scope | Commit only if |
|---|---|---|
| A | Crop + page cache infrastructure | Required immediately for B that clears HE gates |
| B | Staff/ledger mask in crop | Improves HE without global regression |
| C | Filled-head segmentation | HE exact ↑ or missing ↓ |
| D | Open-head segmentation | Same |
| E | Stacked-chord ownership | Same; no extra-tone spike |

Accept HE target: exact **> 25%** or missing **≪ 23**, extras not up, low-extreme ≥ 76.5%, Guitar ~86/100.

If recognition gain is too small for ~23 MB supersample + segment cost → **revert to beeb5f0**.
