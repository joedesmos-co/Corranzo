# OMR benchmark dashboard

Generated: 2026-07-17T02:24:44.164Z
Fixtures: 3
Overall: PASS
Largest remaining error bucket: none

## Status
- pass: 0
- fail: 0
- rejected: 0
- skipped: 3
- error: 0

## Fixtures

### Beethoven Symphony No. 7, movement 1 (Mutopia public-domain stress) (`skipped`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-stress/beethoven-symphony-7-mutopia/beethoven-symphony-7-mutopia.pdf`
- License: Public-Domain (real-pd-orchestra-beethoven-7)
- Categories: orchestral-score, full-score-many-staves, dense-engraving, modern-vector-pdf, public-domain, real-world-score
- Import observation: rejected
- reasons: low-confidence
- error: PDF too difficult for local generation. Try a cleaner digital export or upload MusicXML/MXL.

### Beethoven Pathetique, movement 1 (Mutopia public-domain stress) (`skipped`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-stress/beethoven-pathetique-mutopia/beethoven-pathetique-mutopia.pdf`
- License: Public-Domain (real-pd-piano-pathetique)
- Categories: piano-grand-staff, dense-advanced-score, historical-repertoire, modern-vector-pdf, public-domain, real-world-score
- Import observation: rejected
- reasons: low-confidence; low-confidence
- error: PDF too difficult for local generation. Try a cleaner digital export or upload MusicXML/MXL.

### Twinkle, Twinkle Little Stars (1880 Library of Congress scan) (`skipped`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-stress/twinkle-1880-loc/twinkle-1880-loc.pdf`
- License: Public-Domain (real-pd-scan-twinkle-1880)
- Categories: piano-grand-staff, historical-scan, uneven-margins, page-noise, public-domain, real-world-score
- Import observation: recognized
- Regions: 2 page(s) processed, 0 failed, 0 isolated
- Recognition: 421 note(s), 98 measure(s), confidence 62%
- Pipeline timing: 559 ms

## Tier breakdown
- real-public-domain-orchestral-vector: 1 fixture(s) (skipped=1)
- real-public-domain-piano-scan: 1 fixture(s) (skipped=1)
- real-public-domain-piano-vector: 1 fixture(s) (skipped=1)

## V2 rollout gate
V2 rollout gate (Phase 5):
- Recommended: **voice-aware-serialization** (composite 2.65)
- Parallel prep: onset-grid-refinement
- Target ranking:
  - onset-grid-refinement: composite=4.1, status=eligible-prep
  - written-sounding-duration-solver: composite=3.25, status=blocked-premature
  - tie-sustain-constraint-solver: composite=3.2, status=blocked-premature
  - voice-aware-serialization: composite=2.65, status=recommended
  - measure-level-solver-variant: composite=1.85, status=blocked-exhausted
- Blocked:
  - written-sounding-duration-solver (blocked-premature): 0 onset-coupled duration errors cannot be fixed until onsets/voices are stable.
  - tie-sustain-constraint-solver (blocked-premature): Most sustain deficits are downstream of wrong onsets/voices, not missing tie glyphs.
  - measure-level-solver-variant (blocked-exhausted): Clef-only phase-shift family exhausted: 0 changed, 0 truth-approved on dense.

## Voice serialization qualification (Phase 6B)
**NO — zero truth-approved measures on live enforced fixtures.**
Voice serialization qualification (Phase 6b):
- Verdict: Re-run live dashboard with includeScoreGraph and truth MXL.
- Truth-approved: 0 | Structural: 0
Voice serialization qualification (Phase 6b):
- Verdict: Re-run live dashboard with includeScoreGraph and truth MXL.
- Truth-approved: 0 | Structural: 0
Voice serialization qualification (Phase 6b):
- Verdict: Re-run live dashboard with includeScoreGraph and truth MXL.
- Truth-approved: 0 | Structural: 0
