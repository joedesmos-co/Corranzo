# SMuFL optical-center fallback campaign report

- Accepted HEAD (unchanged): `f2d3f05`
- Evaluator: frozen 2.0.0 / schema 2
- Production result: **no accepted commit** — optical profiles did not materially raise high-extreme exact chord accuracy
- Working tree production code restored to accepted baseline

## Verdict

Font-aware optical-center correction for glyph-metrics fallback is **technically correct and globally helpful**, but **does not clear the high-extreme acceptance gate**.

High-extreme exact chord accuracy remained **15% (3/20)** after applying the ink-calibrated MuseScore-embedded SMuFL profile. Per campaign rules, production was left unchanged.

## Phase 1 — Fallback inventory

Artifacts:

- `tmp/omr-smufl-anchor/PHASE_1_FALLBACK_INVENTORY.md`
- `tmp/omr-smufl-anchor/fallback_inventory.json`
- `tmp/omr-smufl-anchor/build-fallback-inventory.mjs`

Corpus glyph-metrics fallback population (at `f2d3f05`):

| Group | Result |
|---|---|
| Fallback tones | **413** |
| Truth-aligned | **347** |
| Font family | **100% `musescore-embedded-smufl`** (`g_d*_f*` subset IDs) |
| Glyph class | **100% `notehead-black` (U+E0A4)** |
| Transform | **100% axis-aligned** |
| High-extreme fallback bin | **17** tones |
| Dominant ink rejects | `no-head-sized-component` (188), `ambiguous-components` (155), `component-outside-font-origin-range` (70) |

No bundled SMuFL `glyphnames` / Bravura anchor metadata exists in-repo.

## Phase 2 — Profile derivation

Artifact: `tmp/omr-smufl-anchor/PHASE_2_OPTICAL_PROFILES.md`

Paired ink vs metric offsets on the same fonts/glyphs:

| Anchor | Median origin→center (staff spaces) |
|---|---:|
| Trusted ink | **≈ 0.50–0.51** |
| Generic metric fallback | **≈ 0.23–0.32** |
| Residual bias | **≈ 0.18–0.19** |

The ink component scorer already encodes the same prior (`yOriginOffset ≈ 0.51`).

### Proposed profiles

| ID | Match | Correction | Confidence | Fate |
|---|---|---|---:|---|
| `musescore-embedded-smufl-notehead-black-v1` | `g_d*_f*` / bravura / leland / petaluma + U+E0A4 + heightRatio ∈ [1.2, 2.4] | 0.51 × local staff gap above text origin | 0.72 | **Implemented experimentally; not accepted** |
| `geometry-smufl-notehead-black-metric-box-v1` | unknown font + U+E0A4 + heightRatio ∈ [1.45, 2.2] | same 0.51 × gap | 0.55 | Implemented experimentally; not accepted |
| Universal Y offset | all fonts | — | — | **Rejected** (hard rule) |
| Half/whole profiles | — | — | — | Deferred (no inventory population) |
| Named Bravura JSON anchors | — | — | — | Unavailable (metadata not bundled) |

## Phase 3 — Precedence (experimental, reverted)

Intended precedence:

1. Trusted ink notehead center
2. Explicit notehead anchor metadata *(none in-repo)*
3. Font/glyph optical-center profile
4. Geometry-class optical-center fallback
5. Existing generic metric fallback

Provenance fields on experimental anchors: `source`, `opticalProfile.id`, `fontIdentity`, `glyphClass`, `originToOpticalCenterSpaces`, `opticalOffsetNorm`, `rejectedCandidates`, `finalNormalizedCenter`, `confidence`.

## Phase 4 — Focused tests

Experimental suite `tests/omrSmuflOpticalCenterFallback.test.js` (24 cases) **passed** while the profile was wired, covering notehead-only, stem/flag bands, open vs filled, legacy skip, embedded subset identity, unknown-font generic path, ledger heights, chord independence, transforms, ink outranking profile, safe ambiguous fallback, and middle/bass ink stability.

Suite was removed with the revert (no unaccepted production hooks left behind).

## Phase 5 — Corpus validation (experimental profile)

### Global (frozen 9/9)

| Metric | Baseline `f2d3f05` | After optical profile | Δ |
|---|---:|---:|---|
| Mean Pitch | 72.4% | **72.5%** | +0.1 |
| Mean Rhythm | 80.2% | **81.2%** | +1.0 |
| Incorrect chord | 159 | **152** | −7 |
| Missing notes | 73 | **68** | −5 |
| Extra notes | 106 | **101** | −5 |
| Guitar-standard Pitch | ~86% | **86%** | 0 |
| Guitar-standard Rhythm | ~100% | **100%** | 0 |
| Low-extreme exact | 76.5% | **76.5%** | 0 |
| Low-extreme missing | 6 | **6** | 0 |

Global safety gates would have passed.

### High-extreme (primary gate)

| Metric | Baseline | After optical | Δ |
|---|---:|---:|---|
| Exact chord accuracy | **15%** (3/20) | **15%** (3/20) | **0** |
| Missing tones | 24–25 | 25 | ~0 |
| Extra tones | 21–25 | 25 | ~0 / counting noise |
| Octave errors | 0 | 0 | 0 |
| Optical-profile application | n/a | Nearly all former metric fallbacks | — |

Natural staff MIDI **does** move when swapping 0.32→0.51 space offsets (~one diatonic step on many dense upper tones). Exact chord sets still fail because residual defects are dominated by **accidental-coupled / near-chromatic mismatches** on the same dense stacks, not by a remaining pure metric-center bias once the ink prior is applied.

**Acceptance decision:** reject optical profile commit — high-extreme exact accuracy did not rise materially above 15%.

## Phase 6 — Ledger-vs-staff classifier

Not started in production. Optical profiles were exhausted against the high-extreme exact gate; residual cases still show ink rejects (`no-head-sized-component`, `ambiguous-components`) on dense upper ledger columns.

A safer classifier remains the logical next recognition primitive **if** pursued in a follow-up that:

- does **not** revive broad extreme-ledger non-suppression
- does **not** revive broad stacked-head ownership
- distinguishes short local ledger runs from full five-line staff geometry

Even then, many residual high-extreme mismatches look chromatic/accidental rather than pure staff-step, so ledger recovery alone may be insufficient for exact-set wins.

## Phase 7 — Real-score validation

Skipped — no accepted production change to validate.

## Known limitations

1. No in-repo SMuFL glyph anchor metadata; profiles must be geometry/font-class derived.
2. MuseScore PDF.js subset IDs (`g_d*_f*`) are the only observed corpus music fonts for noteheads.
3. Matching the ink optical prior fixes metric-center bias but does **not** unlock high-extreme exact chords.
4. Dense upper stacks still suppress/reject ink heads; that path remains blocked without a safer ledger classifier.
5. High-extreme residual errors often present as ±1 semitone / accidental-shaped mismatches after optical correction.

## Is raster reconstruction the next blocker?

**Not yet for optical centers.** Metric fallback now has a clear, reusable ink-calibrated correction; the missing piece for high-extreme exact sets is not “draw noteheads from raster.”

Next blockers, in order:

1. **Safer ledger-vs-staff ink recovery** (Phase 6) so trusted ink can win on dense upper columns without global regressions
2. **Accidental / alteration state** on those recovered or optically centered tones
3. Raster reconstruction only if ink geometry remains unrecoverable after (1)

## Suggested follow-up commits (not made)

```
fix(omr): add font-aware optical notehead anchors
```

would be appropriate **only after** a future revision also moves high-extreme exact accuracy materially above 15% (alone or with an accepted ledger classifier).

```
fix(omr): distinguish dense ledgers from staff geometry
```

remains the separate Phase 6 candidate.

## Deliverable paths

- `tmp/omr-smufl-anchor/PHASE_1_FALLBACK_INVENTORY.md`
- `tmp/omr-smufl-anchor/fallback_inventory.json`
- `tmp/omr-smufl-anchor/PHASE_2_OPTICAL_PROFILES.md`
- `tmp/omr-smufl-anchor/corpus-after-optical.txt`
- `tmp/omr-smufl-anchor/SMUFL_OPTICAL_CENTER_REPORT.md` *(this file)*
