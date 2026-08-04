# High-extreme notehead component recovery report

- Accepted HEAD preserved: `beeb5f0` — `fix(omr): recover notehead ink within dense ledger runs`
- Campaign: HIGH-EXTREME NOTEHEAD COMPONENT RECOVERY
- Evaluator: frozen **2.0.0 / schema 2**
- Optical MuseScore SMuFL profile: **remains disabled**
- Raster reconstruction: **not started**

## Verdict

**Do not accept / do not commit production fragment recovery.**

Vector fragment clustering can reconstruct synthetic split heads in unit tests, but on the frozen corpus it does **not** clear acceptance gates:

| Gate | Required | Observed with best safe wire |
|---|---|---|
| `no-head-sized-component` on HE tones | material ↓ | 39 → 37 (not material) |
| HE exact chord accuracy | > 25% **or** missing ↓ | **25% unchanged**; missing **23 unchanged** |
| Extra high tones | no material ↑ | **21 unchanged** |
| Low-extreme exact | ≥ 76.5% | **76.5%** |
| Guitar-standard Pitch / Rhythm | ~86% / 100% | **86% / 100%** |

Oval/neighbor ledger-body preservation **regressed** HE exact **25% → 10–20%** and is rejected.

Production `pitchFromStaffPosition.js` was restored to `beeb5f0`. Fragment clustering lives as an **unwired** model + unit tests for the next campaign.

---

## Phase 1 — Component inventory

Artifacts:

- `tmp/omr-head-components/PHASE_1_COMPONENT_INVENTORY.md`
- `tmp/omr-head-components/component_inventory.json`
- `tmp/omr-head-components/build-component-inventory.mjs`

Baseline (`beeb5f0`) scoreboard:

| Metric | Value |
|---|---:|
| Total `no-head-sized-component` rejects | **226** (later rebuild **219** under dirty tree noise) |
| High-extreme subset | **7** |
| Masking destroyed a prior head-sized component | **15** |
| ≥2 likely head fragments after mask | **93** |

Dominant first reject rule: **`width-too-narrow`** (~178).

### Mechanism groups

| Mechanism | Count (approx.) |
|---|---:|
| Transformed components outside expected size | 133 |
| Fragmented filled notehead | 29 |
| Genuinely absent usable ink | 24 |
| Stem/head split, no body reconstruction | 14 |
| Ledger masking over-subtraction | 14 |
| Fragmented open notehead | 12 |

Real HE rejects after mask are usually **thin vertical strips** near the glyph, often with only **one** fragment inside the optical origin band; many others sit at `yOriginOffset ≈ 0.95–1.6` (above the trusted band) or are sub-pixel ledger crumbs (`widthRatio ≈ 0.07`).

---

## Phase 2 — Fragment clustering model

Module (unwired): `src/features/omr/noteheadFragmentCluster.js`

Unit tests: `tests/omrNoteheadFragmentCluster.test.js`

### When it would run (intended precedence)

1. Trusted ordinary ink anchor  
2. Trusted ledger-masked ink anchor  
3. **Trusted fragmented-component anchor** ← campaign target  
4. Existing metric fallback  

### Rules (conservative)

- Local to one glyph / note candidate only
- Candidate fragments: near optical prior, not stem/beam/ledger-like, too narrow alone to be a head
- Grow horizontally adjacent clusters; block vertical stacked-tone merges (`dy` gate + `ySpread ≤ 0.32`)
- Combined bounds must be head-sized; exclusive greedy ownership; ambiguous score gap rejects
- Provenance: fragment IDs considered, accepted/rejected clusters, scores, bounds, center, confidence, rejection reason

### Offline inventory probe (tight→tuned rules)

| Config | Inventory accepts (of ~219) | HE exact when wired |
|---|---:|---|
| Strict | 3 | 25% (almost never fires) |
| Tuned vertical-strip | 32 | 25%; fragmented touches **4**, all on already-incorrect chords |
| Aggressive + oval body preserve | — | **10%** (rejected) |

---

## Phase 3 — Ledger masking safety audit

| Experiment | Result |
|---|---|
| Classic thin-stroke mask (`verticalInkExtent ≤ 2`) | **Keep** — HE 25% |
| Preserve pixels inside optical-prior oval under ledger rows | **Reject** — merges ledger stubs into head → `widthRatio > 1.05` → HE **10%** |
| Preserve thin ledger pixels with non-ledger body neighbors on same column | **Reject** — milder but still HE **20%** |

Diagnostics collected during experiments: before/after component counts and `recoverability: improved|unchanged|destroyed`. Not shipped in production.

**Conclusion:** accepted ledger-vs-staff classifier + thin-stroke mask must stay. Masking over-subtraction (15 inventory cases) is real, but body-preserve heuristics that enlarge components destroy more HE recoverability than they restore.

---

## Phase 4 — Focused tests

Unit coverage for the clustering model:

1. Filled head → two path halves  
2. Open head → two arcs  
3. Stem excluded from body cluster  
4. Stacked chord fragments not merged across tones  
5. Accidental-shaped fragments excluded  
6. Stem / beam / barline / slur rejected  
7. Unrelated glyph origins not merged  
8. Ambiguous competing clusters rejected  

Integration fixtures against `resolveNoteheadAnchor` were exercised during wiring experiments; production wire reverted, so integration assertions are not left depending on fragmented anchors.

---

## Phase 5 — Corpus validation (experiments)

### High-extreme (`build-high-extreme-baseline.mjs`)

| Config | Exact | Missing | Extra | `no-head-sized` HE touches | `fragmented-ink` |
|---|---:|---:|---:|---:|---:|
| `beeb5f0` baseline | **25%** | 23 | 21 | 39 | 0 |
| Oval body preserve + clustering | **10%** | 27 | 26 | 34 | 1 |
| Neighbor preserve + clustering | **20%** | 26 | 24 | 38 | 0 |
| Classic mask + tuned clustering | **25%** | 23 | 21 | 37 | 4 |
| Production restored (`beeb5f0`) | **25%** | 23 | 21 | 39 | 0 |

### Global (9/9 written corpus)

Baseline after ledger recovery (~`beeb5f0`): Pitch **~72.3–72.4%**, Rhythm **~80.5%**, Guitar **86% / 100%**, low-extreme **76.5%**.

Tuned clustering wire: globals stayed within noise of baseline; HE exact did not improve.

Optical profile: **not re-enabled** (prior campaign: HE 25% → 15% with dense-ledger recovery).

---

## Phase 6 — Accidental findings (deferred; recovery exhausted)

From `tmp/omr-dense-ledger/PHASE_4_ACCIDENTAL_TRACE.md` (still valid at `beeb5f0`):

- Remaining incorrect HE chords: **15**
- Alteration-shaped (`possible-accidental`): **~5**
- Staff-step / ownership / mapping: **~10**

No repeated, visually verified accidental-ownership mechanism was re-proven in this campaign. **No accidental production change.**

Prior fixture evidence also shows several frozen Corranzo vector PDFs omit accidental glyphs entirely (`tmp/omr-accidental-path/`), so alteration errors on those fixtures cannot be fixed by ownership alone.

---

## Phase 7 — Accidental tests / validation

**Skipped** — no accepted accidental mechanism.

---

## Accepted vs rejected experiments

| Experiment | Decision |
|---|---|
| Phase 1 inventory | **Accepted** (diagnostic) |
| Fragment clustering model + unit tests | **Accepted as unwired model** |
| Wire fragmented anchors into `resolveNoteheadAnchor` | **Rejected for commit** (gates not met) |
| Oval expected-body ledger preserve | **Rejected** (HE 25→10) |
| Neighbor-body ledger preserve | **Rejected** (HE 25→20) |
| Re-enable optical center profile | **Rejected** (prior: 25→15) |
| Raster component reconstruction | **Not started** (next blocker) |
| Accidental ownership production fix | **Deferred** |

---

## Known limitations

1. After classic ledger masking, many HE noteheads exist only as **sub-head vertical strips** with insufficient in-band fragments to form a unique oval.
2. Some “no-head-sized” cases already have a head-sized blob that fails the **font origin band** (`head-sized-exists-but-caller-rejected`) — clustering cannot help; origin/metric policy is a separate lever.
3. When clustering *did* fire on HE tones, accepted centers landed on **already-incorrect** chords (wrong staff step), so exact accuracy did not rise.
4. Genuine absent ink / path-only stems remain unrecoverable without raster or richer vector merge across transforms.

---

## Is raster component reconstruction the next blocker?

**Yes, for residual `no-head-sized-component` under dense ledgers.**

Vector-local fragment clustering is exhausted as an HE-exact lever under the campaign’s conservatism constraints. Remaining mass is:

- over-fragmented filled heads after stroke masking,
- open outlines split into crumbs,
- transformed path stacks that never yield a head-sized connected component in the optical band.

A **bounded raster reconstructor** (local glyph window only; no invented tones; exclusive ownership) is the next evidence-backed path — still after ordinary + ledger-masked ink, still without the optical profile.

Secondary follow-up (independent commit if proven): focused accidental ownership on the ~5 alteration-shaped HE residuals **only after** visual verification that accidentals exist in the PDF ink/paths.

---

## Suggested commits

**None from this campaign.**

If a future wire clears gates:

```
fix(omr): reconstruct fragmented vector noteheads
```

Accidental (only if independently accepted later):

```
fix(omr): improve extreme-chord accidental ownership
```

Do not commit `tmp/`, inventories, crops, or local scripts.

---

## Working tree note

- `src/features/omr/pitchFromStaffPosition.js` — restored to `beeb5f0`
- `src/features/omr/noteheadFragmentCluster.js` — present, **unwired**
- `tests/omrNoteheadFragmentCluster.test.js` — unit tests for the model
- Optical profile — disabled
