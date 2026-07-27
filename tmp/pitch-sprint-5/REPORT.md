# Pitch Sprint 5 — Residual Raster Staff-Position / Register

## Verdict
**No recognition change shipped.** Pitch Sprint 4 staff-emission remains frozen. RCA identified a clear chord-collapse mechanism, but every attempted general fix either failed to recover scanned on-line chord tones or **dropped Sustain TP (1→0)** and/or Articulation TP — violating acceptance.

## Accepted baseline (unchanged)
| Class | Score |
| --- | ---: |
| Overall | 60.3% |
| Pitch | 53.0% |
| Rhythm | 64.4% |
| Sustain/Tie | 57.8% |
| Articulation | 83.9% |
| Measure structure | 62.9% |

piano-articulation-scan Pitch remains **29%** (35/122).

## Raster-only taxonomy (42 paired incorrect)

| Bucket | Count |
| --- | ---: |
| accidental-or-alter | 14 |
| one-diatonic-step | 12 |
| small-interval-other | 8 |
| larger-interval | 7 |
| octave-error | 1 |

### Failure-class split
| Class | Count |
| --- | ---: |
| other-staff-position | 12 |
| missing-accidental | 6 |
| notehead-center-or-chord-collapse | 18 |
| onset-alignment | 6 |

## RCA summary
1. **Staff geometry:** System-level staff lines (not per-measure). Local column drift exists but global local-line remap hurt Pitch.
2. **Notehead center / chord collapse:** Primary residual mechanism. Example m5 onset0: truth B4+D5 → two detected C5s at midpoint between staff lines. Exact truth MIDI never detected nearby (0 wrong-chord-pairing cases).
3. **Why collapse happens:** `isLikelyStaffLine` skips on-line seed rows; merge chaining then averages the space between stacked heads.
4. **Register:** 1 octave error (C2→C3).
5. **Accidentals:** 6 same-letter ±1 errors — need glyph evidence; out of scope.

## Attempted fixes (not shipped)
- Merge cluster diameter cap
- Dense staff-line seed exceptions (run-length / fill / vertical thickness)
- Notehead-body ink centroid for pitch Y
- Local staff lines at note X
- Stem-aware vertical band centers
- Midpoint ghost suppression

Synthetic on-line chords separate cleanly; the **scan** still collapses, and looser seeding flooded FPs and dropped Sustain TP.

## Ceiling estimate (staff-position work only)
- **~6/42** incorrect pairs need accidental detection (~14%).
- **~30/42** look like staff-position / chord-collapse / register (~71%).
- Fixing all staff-position/collapse errors without accidentals would still leave ~6 accidental + residual missing/extra.

## Remaining dominant pitch cluster
1. Scanned **on-line stacked chord collapse** to midpoint pitches
2. Missing accidentals (no reliable glyphs)
3. Residual one-step / small-interval after collapse
4. Deferred guitar larger-interval (vector)

Artifacts: `tmp/pitch-sprint-5/raster-taxonomy.json`
