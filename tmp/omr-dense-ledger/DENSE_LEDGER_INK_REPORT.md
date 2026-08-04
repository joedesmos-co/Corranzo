# Dense ledger ink recovery and high-chord accidental report

- Accepted baseline HEAD: `f2d3f05`
- Accepted ledger recovery commit: `beeb5f0`
- Working change: dense ledger classifier + ledger-stroke masking + nearest-glyph head disambiguation
- Evaluator: frozen 2.0.0 / schema 2

## Verdict

**Accept ledger / ink-recovery change.** High-extreme exact chord accuracy rises **15% → 25%** with low-extreme and Guitar preserved and global metrics near baseline.

**Do not accept accidental production changes yet** — remaining residuals are mixed; only ~5/15 incorrect high-extreme chords look alteration-shaped, without a single visually verified repeated ownership bug ready to fix.

**Do not accept optical profile in the same change.** Re-tested on top of ledger recovery: globals improve (Pitch 72.6%, incorrect-chord 152), but high-extreme exact falls back to **15%**. Keep optical as a separate future candidate.

## Phase 1 — Rejection inventory

Artifacts: `PHASE_1_REJECTION_INVENTORY.md`, `rejection_inventory.json`

High-extreme ink rejections at baseline: **17** (all `piano-dense-advanced-vector`).

| Failure class | Count |
|---|---:|
| several-chord-heads-treated-as-ambiguous-group | 10 |
| notehead-merged-with-ledger-fragments | 6 |
| ledger-fragments-masking-notehead-body | 1 |

Dominant reject reasons: `ambiguous-components` (10), `component-outside-font-origin-range` (6), `no-head-sized-component` (1).

Row-span class: all **one-notehead** local runs (not system staff).

## Phase 2 — Classifier

Module: `src/features/omr/localLedgerStaffClassifier.js`

Joint features (not row-count alone):

- length vs system width
- length vs local window
- staff-band membership
- half-space alignment from staff top/bottom
- notehead / chord-column proximity
- optional system event support

Results: `staff-like` | `local-ledger` | `ambiguous` with confidence + reason provenance.

## Phase 3 — Notehead recovery

In `resolveNoteheadAnchor`:

1. Staff-like rows: full-row suppress (unchanged protection)
2. Local ledger rows: **stroke mask** (drop thin horizontal ink, keep thicker notehead body)
3. Stacked heads: **select clear winner nearest glyph origin** (score margin ≥ 0.12); true ties still reject

Precedence observed:

1. ordinary / ledger-masked ink
2. metric fallback (unchanged; no optical in this commit)

## Phase 4 — Accidental trace

Artifact: `PHASE_4_ACCIDENTAL_TRACE.md`

After ledger recovery, 15 incorrect high-extreme chords remain:

- possible-accidental: **5**
- staff-or-other: **10**

No production accidental change in this campaign.

## Metrics

### High-extreme

| Metric | Baseline | After ledger recovery |
|---|---:|---:|
| Exact chord accuracy | 15% (3/20) | **25% (5/20)** |
| Missing tones | 24 | **23** |
| Extra tones | 21 | **21** |
| Incorrect chords | 17 | **15** |
| Ink successes (inventory tones) | 2 | **3** |
| Ambiguous-component fallbacks | 19 | **1** |
| Low-extreme exact | 76.5% | **76.5%** |
| Low-extreme missing | 6 | **6** |

### Global (9/9)

| Metric | Baseline | After |
|---|---:|---:|
| Mean Pitch | 72.4% | 72.3% |
| Mean Rhythm | 80.2% | 80.5% |
| Incorrect chord | 159 | 160 |
| Missing notes | 73 | 72 |
| Extra notes | 106 | 105 |
| Guitar-standard Pitch | 86% | 86% |
| Guitar-standard Rhythm | 100% | 100% |

### Optical reconsideration (not committed)

| Config | HE exact | Pitch | Rhythm | Incorrect chord |
|---|---:|---:|---:|---:|
| Ledger only | **25%** | 72.3% | 80.5% | 160 |
| Ledger + optical profile | 15% | 72.6% | 81.2% | 152 |

Optical remains a separate optional global fallback; it must not ship bundled with ledger recovery.

## Accepted / rejected experiments

| Experiment | Result |
|---|---|
| Ledger-vs-staff classifier + stroke mask | Keep |
| Nearest-glyph stacked-head selection | Keep (main HE gain) |
| Broad ledger non-suppression | Not revived |
| Broad stacked-head ownership | Not revived |
| Accidental ownership rewrite | Deferred |
| MuseScore optical profile | Deferred (global help, HE regression when combined) |

## Known limitations

1. `no-head-sized-component` remains the largest residual ink reject (~39 on high-extreme chord tones).
2. Exact accuracy 25% is material but far from solved.
3. Accidental-shaped residuals need path/text ownership traces with crops before code changes.
4. Optical profile still lacks high-extreme co-acceptance with ledger recovery.

## Recommended next primitive

1. Stronger ledger-masked recovery for remaining `no-head-sized-component` cases (without widening ownership).
2. Focused accidental ownership on the 5 alteration-shaped high-extreme residuals.
3. Re-test optical profile **only after** ink success is higher, as a separate commit.

## Suggested commit

```
fix(omr): recover notehead ink within dense ledger runs
```
