# OMR benchmark dashboard

Generated: 2026-07-17T02:26:26.475Z
Fixtures: 1
Overall: PASS
Largest remaining error bucket: none

## Status
- pass: 0
- fail: 0
- rejected: 0
- skipped: 1
- error: 0

## Fixtures

### Beginner piano themes workbook (local non-redistributable stress) (`skipped`)
- PDF: `/Users/ryland/Downloads/beginner-minecraft-piano-themes-in-c-minecraft.pdf`
- Categories: beginner-book-or-workbook, piano-grand-staff, sparse-layout, modern-vector-pdf, real-world-score, local-only-non-redistributable
- Import observation: recognized
- Regions: 3 page(s) processed, 0 failed, 0 isolated
- Recognition: 585 note(s), 113 measure(s), confidence 91%
- Pipeline timing: 568 ms

## Tier breakdown
- real-local-beginner-workbook: 1 fixture(s) (skipped=1)

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
