# OMR benchmark dashboard

Generated: 2026-07-17T03:16:54.524Z
Fixtures: 2
Overall: PASS
Largest remaining error bucket: none

## Status
- pass: 0
- fail: 0
- rejected: 0
- skipped: 2
- error: 0

## Fixtures

### Twinkle, Twinkle Little Stars (1880 Library of Congress scan) (`skipped`)
- PDF: `/Users/ryland/Documents/scoreflow/benchmarks/omr-stress/twinkle-1880-loc/twinkle-1880-loc.pdf`
- License: Public-Domain (real-pd-scan-twinkle-1880)
- Categories: piano-grand-staff, historical-scan, uneven-margins, page-noise, public-domain, real-world-score
- Import observation: recognized
- Regions: 2 page(s) processed, 0 failed, 0 isolated
- Recognition: 421 note(s), 98 measure(s), confidence 62%
- Pipeline timing: 698 ms

### Beginner piano themes workbook (local non-redistributable stress) (`skipped`)
- PDF: `/Users/ryland/Downloads/beginner-minecraft-piano-themes-in-c-minecraft.pdf`
- Categories: beginner-book-or-workbook, piano-grand-staff, sparse-layout, modern-vector-pdf, real-world-score, local-only-non-redistributable
- Import observation: recognized
- Regions: 3 page(s) processed, 0 failed, 0 isolated
- Recognition: 585 note(s), 113 measure(s), confidence 91%
- Pipeline timing: 695 ms

## Tier breakdown
- real-local-beginner-workbook: 1 fixture(s) (skipped=1)
- real-public-domain-piano-scan: 1 fixture(s) (skipped=1)

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
