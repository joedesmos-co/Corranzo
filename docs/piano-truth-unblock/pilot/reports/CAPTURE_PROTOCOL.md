# Controlled capture protocol (P9)

Purpose: obtain real-world piano sheet images (print/display → scan/photo) with
truth that remains **independent and exact**, for note-level real-world
acceptance testing. This document defines the protocol; no capture set is built
in the pilot.

## Pipeline

```
symbolic source (CC0/PD or licensed)
  -> deterministic render (pinned Verovio + seed)      [truth: element tables]
  -> print on paper or display on a screen
  -> capture (scanner / phone camera / tablet camera)
  -> registration back to the source truth
  -> accept or reject the sample
```

## Capture matrix (minimum viable set)

| axis | levels |
|---|---|
| device | flatbed scanner 300 dpi; phone camera; tablet camera |
| resolution | staff gap ≥ 8 px (reject below); target ≥ 15 px |
| angle | 0°, ±10° yaw, ±10° pitch, ±5° roll |
| perspective | flat, mild (≤ 10° implied), moderate (≤ 20°, reject beyond) |
| lighting | even; side-shadow; warm/cool white balance |
| paper/background | white bond, cream, grey; dark table |
| blur | none, mild (σ ≈ 1 px at capture scale), moderate (reject beyond) |
| compression | PNG lossless; JPEG q=90, q=70, q=50 |
| crop | full page, 5% margin crop, 10% margin crop (keep all notation) |

Each cell is a parameter vector recorded with the sample; severity ranges are
fixed **before** any model exists and are not tuned against model performance.

## Registration and acceptance

1. Re-render the same source at the capture's aspect ratio.
2. Estimate the transform (homography or smooth warp) by feature/registration
   between the capture and the render.
3. Map the element table through the estimated transform and check:
   - ≥ 99% of notehead centres land within a small radius of detected ink;
   - staff lines are recovered consistently (5 lines per staff, stable gap);
   - no labelled element is cropped out (else reject or re-label as clipped).
4. A human spot-checks a sample of registrations (target ≥ 50 notes across ≥ 10
   pages) before a capture set is frozen.
5. Only registered samples enter the benchmark; failures are recorded as
   quality-gate examples, not silently dropped.

## Truth discipline

- The truth record is always the **pre-capture symbolic identity**; the
  estimated transform is stored with the sample.
- Geometric labels are derived by applying the stored transform; photometric
  changes leave labels invariant.
- The quality-gate labels (accept/reject) come from measurable properties
  (staff-gap px, blur variance, contrast, crop completeness, skew), never from
  model output.

## Scope for this pilot

No captures were produced. The protocol is frozen for the next stage; the
OLiMPiC scanned harness covers system-level real-scan evaluation in the
meantime.
