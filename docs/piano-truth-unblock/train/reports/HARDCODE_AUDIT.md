# M2 hardcoded / implicit assumption audit (inference pipeline)

Method: read the automatic path (auto_page.py, detector.py, clef_detect.py,
auto_locate.py, auto_rest.py, auto_e2e.py) for constants and implicit
assumptions, reproduce each with a scaled/contrast-shifted input on DEV,
measure, fix when justified. All fixes are scale-relative in staff-gap
units (never fixed pixels). TEST untouched.

## FOUND AND FIXED

1. **Page-global leftmost dark column used as the system left edge**
   (`clef_crop`/`x0`). Unsafe: page-border artifacts and per-system indents
   mean the global leftmost dark column is not any system's left edge
   (measured: pages where x0=28 while the systems start at x=59 or 367).
   Effect: clef crops anchored in blank space; bass staves read as treble
   (F->G = +12 steps = octave errors, 117 of 139 pitch errors).
   Fix: frame-local left edge = longest dark run on the frame's own top
   staff line (`clef_detect.frame_left_edge`). Clef accuracy 19/25 -> 23/25;
   detected-note pitch 0.796 -> 0.908 on the DEV 5 pages.
2. **Fixed-pixel clef crop windows** (half = 2 gaps assumed a glyph size).
   Unsafe at non-default DPI and for different clef glyph heights.
   Fix: class-conditional windows in gap units matching the TRAINING crop
   convention (square of half = 0.65 x glyph max dimension), argmax over
   class-template NCC (G: half 4.8 gaps, F/C: half 2.0 gaps, center
   fx0 + 2.2 gaps). Measured 23/25 frames correct (oracle crops: 25/25).
3. **Fixed +4 pixel tolerance in staff grouping** (`group_staves`). At 0.5x
   scale the staff gap is ~10px and jitter exceeds 4px: measured 23 lines
   -> 0 frames. Fix: gap-relative tolerance (d <= spacing * 1.5 + 1).
4. **Fixed binarization threshold (gray < 128)**. Unsafe for anti-aliased
   downscales (a 1px staff line blends above 128) and low-contrast scans
   (the fixture renders are pure black/white; real scans are not).
   Fix: Otsu per page (`auto_locate.binarize`). Cost at 1.0x renders:
   page pitch 0.876 -> 0.868 (noise-level); benefit at 0.5x: 0 TP -> 734 TP.
5. **4-line staff groups unsupported** (staff-line recall < 100% at low
   scale). Fix: interpolate the missing line where the spacing doubles.

## FOUND, DOCUMENTED, NOT YET FIXED

6. **Fixture metadata dependency** (`page_ctx` reads meta.json for page
   width and median_staff_gap_px, and SVG margins). Real PDF/image inputs
   have neither; `auto_page.py` now derives the gap from the detected
   frames ((bottom-top)/4, per frame) and works pixel-native, so the
   metadata is no longer needed for the automatic path.
7. **Assumed music fonts/glyph sizes**: notehead window [0.70, 1.90] gaps,
   rest window [0.30, 2.4] gaps, barline coverage >= 85%, beam kernel
   6 gaps, stem kernel 3 gaps. All gap-relative (scale-safe) but
   font-specific in principle; measured on Verovio-rendered fonts, which
   is a stated limitation, not a hidden assumption.
8. **Assumed page orientation / margins**: frames are found by run-length
   analysis, so margins are irrelevant, but ROTATED pages (>2 degrees)
   break the row-run staff detection (not tested yet; M6).
9. **Assumed one dominant gap per page**: the median frame gap is used for
   all windows; pages mixing staff sizes would need per-frame windows
   (rare; documented).
10. **Assumed black-on-white**: Otsu handles grayscale contrast, but
    inverted or colored scans would need a polarity check (M6).

## Verified invariant behaviour (reports/scale_invariance.json)

Same 5 DEV pages at 0.5x / 1.0x / 2.0x rasterization:
  1.0x: P 0.929 R 0.968 pitch 0.847
  2.0x: P 0.958 R 0.916 pitch 0.897
  0.5x: P 0.846 R 0.814 pitch 0.547  <- degraded (line jitter at half gap);
        previously 0 TP (total failure), so this is still a net fix.
Conclusion: the recipe is DPI-invariant by construction (gap-relative),
with a measured degradation below ~10px staff gap.
