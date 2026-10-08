# Guitar Real-World Evaluation Path (D18) — protocol + tiny sample

**Status:** protocol prepared, tiny vector/raster sample committed. No scan
or phone-photo data collected yet (that stage needs the print/display →
capture → registration rig, specified below, not built yet).

## Provenance ladder (truth stays exact while inputs degrade)

1. **vector** — Verovio SVG from stamped MusicXML (this pilot: every PASS
   score). Sample: none committed (SVGs live in per-score work dirs).
2. **raster-export** — headless-Chromium PNG at 1050/2100px widths.
   Sample: `realworld-sample/spanish-romance-vector-{1050,2100}.png`.
3. **scan** — print/display → flatbed scan or photocopy → deskew →
   registration to the vector page (planned; protocol below).
4. **phone-photo** — handheld capture with perspective/blur/lighting variance
   → page-quad detection → registration (planned).

## Registration protocol (for stages 3–4, when built)

- Detect page quad → perspective-rectify to the vector page box.
- Register by staff-line geometry (never by noteheads: notes are the test).
- Re-run the input-quality gate (blur, contrast, resolution, page-quad
  convexity, crop completeness) BEFORE recognition; unreadable pages are
  rejections, not training inputs.
- Truth (canonical events + joins) is unchanged; only the input pixels and
  the quality metadata change. A stage-4 page whose registration residual
  exceeds tolerance quarantines with `registration-failure`.

## Quality gate reuse

The D8 per-page metadata (contrast, blur variance, ink coverage, dimensions)
is the same schema the capture path will write, so vector/raster/scan/photo
pages compare in one table. Thresholds for scan/photo acceptance are NOT set
in this pilot (no scan/photo data to calibrate against) — setting them from
vector data alone would be fabrication.
