# Chord / Onset Ownership Campaign Report

**Start commit:** `34529e0` — fix(omr): detect vector path accidentals  
**Suggested commit:** `fix(omr): improve chord and onset ownership`  
**Evaluator:** frozen 2.0.0 / schema 2 (unchanged)  
**Verdict:** **NOT ACCEPTED** — infrastructure + geometry fixtures land metric-neutral; primary defect targets did not improve materially.

## Acceptance gate

| Gate | Result |
|---|---|
| incorrect-chord materially decreases | **FAIL** (199 → 200) |
| missing/extra decrease or stable | PASS (163 / 154 unchanged) |
| onset-mismatch decreases | **FAIL** (256 unchanged) |
| no meaningful Pitch regression | PASS (61.5% unchanged) |
| no broad Rhythm regression | PASS (66.6% → 66.6%) |
| geometry fixtures pass | PASS (18 ownership tests) |
| nine semantic fixtures run | PASS |
| evaluator frozen | PASS |
| related unit suite + build | PASS |
| accidental recognition untouched | PASS |

Because incorrect-chord / onset did not improve, **do not merge under the suggested fix commit message**. Working-tree changes are optional scaffolding for a follow-up; leave uncommitted unless you explicitly want the infrastructure.

## Complete mismatch clusters (Phase 1–2)

See `PHASE_1_MISMATCH_INVENTORY.md` and `PHASE_2_ROOT_CAUSE_CLUSTERS.md`.

| Cluster | Evidence mass | Status after intervention |
|---|---|---|
| Same-chord split across onsets | High | Still dominant on dense/articulation |
| Nearby voices incorrectly merged | High | Guarded (opposing-stem / grace) |
| Adjacent chord-column steal | High | Still present (dense onsets) |
| Duplicate ownership of one notehead | 31 exact dup MIDI chords | Exclusive ownership by `candidateId` only |
| Note dropped during packing | 38 dropped-tone chords | Largely unresolved |
| Geometry OK, wrong onset | 180 structured / 256 eval | Unchanged |
| Evaluator alignment artifact | 3 | Negligible |
| Pitch/accidental masquerading as chord | 62 same-count pitch diffs | Out of scope (accidentals frozen) |

## Selected shared root cause

**No exclusive notehead ownership and no durable chord-column identity between geometric grouping and event emission**, plus a coalesce window that is tighter than early adaptive grouping.

Aggressive first attempts (global orphan merges, glyph-key exclusivity, stem-splitting every mixed-stem stack) **collapsed Rhythm** on grand-voices (89% → 39%) by inflating group counts into dense-rhythm mode. Those approaches were rejected and rolled back to a conservative subset.

## Exact production changes (in working tree)

| File | Change |
|---|---|
| `src/features/omr/omrChordOnsetOwnership.js` | **New** — candidate IDs, chord-column stamp, exclusive ownership, owned coalesce, orphan reunite (span-gated), column onset align, ownership summary |
| `src/features/omr/processVectorOmrPage.js` | Wire stamp → coalesce → orphan reunite → dense resnap (+ column align) → exclusive ownership; attach `noteheadOwnershipDiagnostics` |
| `tests/omrChordOnsetOwnership.test.js` | **New** — 18 geometry / provenance fixtures |

### Behavior retained (conservative)

- Exclusive ownership keyed by **`candidateId`** (not glyph geometry) so legitimate two-voice unisons survive.
- Opposing-stem column split only when heads are **horizontally displaced** beyond the chord window (vertical mixed-stem stacks stay one chord — avoids dense-mode blowups).
- Orphan reunite only when: single tone, `|Δstart|=1`, `|Δcx|≤10`, MIDI inside chord span, compatible stems, not grace.
- Distinct columns / opposing stems are not merged solely because x is close.

## Geometry / provenance examples

Fixtures cover: shared-stem triad, displaced seconds, accidental-bearing column, opposing stems, adjacent sixteenths, beamed chords, duplicate candidate rejection, slight-x reunite via column id, grace separation, unison voices, competing columns, full-column resnap, ambiguous contest, orphan in-span reunite, out-of-span reject.

DEV provenance (when `scoreflow:omr-provenance=1`): winner event, rejected competitors, score components, dedupe reason.

## Rejected approaches

| Approach | Why rejected |
|---|---|
| Globally widen `OMR_CHORD_MERGE_X` | Merges independent voices; existing tests forbid |
| Glyph-key exclusive ownership across events | Deletes legitimate unisons / same-x voices |
| Orphan merge without pitch-span / stem gates | Rhythm collapse (−8pp overall, grand-voices rhythm 39%) |
| Split every mixed-stem vertical stack | Inflates group count → dense rhythm path |
| Retune path-accidental recognition | Frozen; not the ownership bug |
| Evaluator changes | Frozen 2.0.0 / schema 2 |

## Corpus before/after (`34529e0` baseline → after4)

| Metric | Baseline | After | Δ |
|---|---:|---:|---:|
| Overall | 62.8% | 62.8% | ~0 |
| Pitch | 61.5% | 61.5% | 0 |
| Rhythm | 66.6% | 66.6% | +0.05pp |
| incorrect-chord | **199** | **200** | **+1** |
| missing-note | 163 | 163 | 0 |
| extra-note | 154 | 154 | 0 |
| onset-mismatch | **256** | **256** | **0** |
| duration-mismatch | 244 | 244 | 0 |
| incorrect-pitch | 173 | 173 | 0 |

### Per-fixture (after; essentially unchanged vs baseline)

| Fixture | Overall | Pitch | Rhythm |
|---|---:|---:|---:|
| piano-beginner-single-vector | 82.6% | 94% | 84% |
| piano-grand-voices-vector | 74.6% | 70% | 89% |
| piano-rhythm-tuplets-vector | 64.3% | 91% | 68% |
| piano-articulation-scan | 42.7% | 27% | 70% |
| piano-dense-advanced-vector | 53.6% | 45% | 41% |
| guitar-tab-sparse-vector | 68.5% | 70% | 17% |
| guitar-standard-chords-vector | 45.6% | 30% | 48% |
| guitar-paired-chords-vector | 69.0% | 48% | 89% |
| guitar-techniques-paired-vector | 64.4% | 78% | 93% |

## Rhythm-dip investigation (`2f82df8` 67.1% → `34529e0` 66.6%)

**Do not blame or revert accidental recognition.**

1. The −0.5pp Rhythm move coincides with **fixture regeneration** (path-drawn accidentals) vs the pre-redraw fixture set.
2. Fair A/B on regenerated fixtures (detection off vs on) in the accidental campaign showed Pitch/chord gains from path detection; onset stayed comparable.
3. Accidental path code does not edit onset snap, gap packing, or chord coalesce.
4. This campaign’s corpus at `34529e0` vs post-ownership remains Rhythm-stable at **66.6%**.

## Real-score validation (page 1 smoke)

| Score | Notes | Measures | Acceptance | Tie balance |
|---|---:|---:|---|---:|
| Evangelion | 252 | 15 | accepted | 0 |
| La Campanella | 364 | 22 | accepted | 0 |
| Ao no Sumika | 229 | 17 | accepted | 0 |
| Sweden/Minecraft | 277 | 23 | accepted | 0 |
| Iris Out / Merry-Go-Round / Jujutsu OP / Aria Math | — | — | missing PDF locally | — |

No song-specific logic. Pipelines accept; no crash. Detailed before/after ownership histograms were not available against a frozen pre-change user dump for all eight titles.

## Remaining unresolved clusters

1. **Dense onset grid / column steal** on `piano-dense-advanced-vector` (134 onset mismatches) — needs onset packing that moves whole columns without dense-mode side effects.
2. **Dropped chord tones** on `piano-articulation-scan` (`C4 E4 G4` → `E4 G4`) — often not a `|Δstart|=1` orphan; may be detection/matching, not coalesce.
3. **Pitch masquerading as chord** on grand-voices / dense (~62 examples) — accidental/staff path; frozen.
4. **Duplicate MIDI chords** where candidates have distinct auto-IDs — need stronger physical-glyph provenance from the detector, not just event-level exclusivity.
5. **Voice merge vs split** on dense multi-voice pages — still the central tension; wider windows help chords and hurt voices.

## Next safest lever (recommended follow-up)

Instrument **per-stage chord diagnostics that survive the pipeline return** (events + `chordColumnId` + pre/post resnap onsets), then target only measures where `fragmentedOnsetCount>0` with a column-locked gap pack — without changing global merge X.

## Artifacts

- `tmp/omr-chord-onset/PHASE_1_MISMATCH_INVENTORY.md`
- `tmp/omr-chord-onset/PHASE_2_ROOT_CAUSE_CLUSTERS.md`
- `tmp/omr-chord-onset/mismatches.json` / `mismatches.csv` / `cluster-stats.json`
- `tmp/omr-chord-onset/corpus-baseline.json` / `corpus-after4.json`
- `tmp/omr-chord-onset/user-reports/`
- `tests/omrChordOnsetOwnership.test.js`
