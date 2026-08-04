# Corranzo Final Release-Candidate Audit

**Audited commit:** `994dca68410300ee4758a61a81de42caebdb9406`  
(`994dca6` — `fix(app): isolate instruments and improve heavy-score responsiveness`)

**Audit date:** 2026-07-29  
**Production changes made by this audit:** **none**  
**New commit created:** **none**

---

## Verdict

### DO NOT SHIP

All **app stability / ownership / playback / build** gates are green on
`994dca6` with no production code changes required from this audit.

The **frozen OMR semantic corpus regression gate** fails:

```
ACCEPT: NO
overall +0.121 (0.4974 → 0.6184)
Regressions vs freeze-baseline (15aa1db):
- piano-articulation-scan: rhythm -0.0814; articulation -0.0263
- piano-grand-voices-vector: sustain -1
```

That failure is an **OMR quality / baseline-policy** issue. This audit is
forbidden from tuning OMR recognition or modifying the frozen evaluator, so it
cannot clear the gate with a code fix. Release requires either:

1. An explicit product decision to **re-freeze** the semantic baseline at
   `994dca6` (or a later OMR-qualified commit), **or**
2. A separate OMR sprint that remediates the two fixture class regressions
   and re-runs `--compare`.

Until one of those happens, treat the candidate as **not shippable**.

---

## Manual / clean-session browser scenarios

Script: `scripts/final-release-candidate-audit.mjs`  
Log/artifacts: `tmp/final-release-candidate/browser-audit.*`

| Area | Result | Notes |
|---|---|---|
| Piano OMR → Guitar clears live session | **PASS** | Library opens; no ActiveScore / playback snapshot leak |
| Piano upload remains Piano-only | **PASS** | Not listed under Guitar My Uploads |
| Guitar Library → Piano clears live | **PASS** | No Guitar hash on Piano |
| Rapid Piano↔Guitar after OMR | **PASS** | Stable Library |
| Switch during OMR preparation | **PASS** | UI remains clickable |
| Multi→one / one→multi PDF replace | **PASS** | Identities replace; page UI `1/1` after one-page |
| Replace PDF during OMR | **PASS** | Newest PDF owns playback |
| Built-in Library Piano + Guitar | **PASS** | |
| Reload / no stale into wrong instrument | **PASS** | |
| Practice views (Visual/Score), seek, loop | **PASS** | |
| No stuck playback after instrument switch | **PASS** | |
| Heavy score nav / scroll / resize / Library | **PASS** | No blank page; Library reachable |
| Play button (`/^Play$/`) | **Harness miss** | Accessible name is `Play (Space)` / label `▶Play`. Confirmed Play works via `/Play/i`. **Not a product bug.** |

Screenshots: `01-piano-omr-ready.png`, `02-guitar-after-switch.png`, `03-heavy-library.png`.

---

## Automated commands and results

| Gate | Command | Exit | Result |
|---|---|---:|---|
| Full unit suite | `npm test` | **0** | 272 files / **2716 passed** / 5 skipped |
| Production build | `npm run build` | **0** | Built in ~1s |
| Heavy-score harness | `node scripts/heavy-score-performance-harness.mjs` | **0** | Relative budgets held; cache hits OK |
| Instrument-switch E2E | `node scripts/instrument-switch-isolation-e2e.mjs` | **0** | **11/11** passes |
| Guitar library / ownership | `node scripts/guitar-library-regression.mjs` | **0** | PASS |
| Stale score real-UI A→B | `node scripts/stale-score-real-ui-regression.mjs` | **0** | PASS (clear-on-switch) |
| Page-count replacement | `node scripts/omr-pagecount-replacement-regression.mjs` | **0** | A 4-page → B 1-page only |
| Stale MusicXML A→B | `node scripts/stale-musicxml-ab-regression.mjs` | **0** | Newest PDF owns auth+playback |
| Piano audio benchmark | `node scripts/piano-realism-benchmark.mjs` | **0** | 0 stuck voices, 0 tie reattacks, sampler path |
| Clean-session browser audit | `node scripts/final-release-candidate-audit.mjs` | 1* | 36/37 product asserts; 1 harness selector flake |
| Frozen semantic corpus eval | `npm run omr:semantic-corpus -- --mode written --json …` | **0** | Report generated at `994dca6` |
| Frozen semantic **compare** | `node scripts/omr-semantic-corpus-eval.mjs --compare benchmarks/omr-semantic/baseline.json tmp/final-release-candidate/semantic-corpus.json` | **3** | **ACCEPT: NO** (release blocker) |

\*Exit 1 solely from Playwright `name: /^Play$/` vs actual `Play (Space)`.

Logs live under `tmp/final-release-candidate/` (not for commit).

### Heavy-score harness relative budgets (preserved)

From `heavy-score-harness.log`:

- `hotParseUsesCache`: true  
- `visualWindowSmallerThanFull`: true  
- `denseParseRelativeBudget`: true (`denseParseOverSmall` ≈ 11.6, limit 200)  
- `visualCacheSpeedup`: true (≈ 373×)

---

## Hardcoding search results

Scope: production `src/` (+ `worker/`). Tests/benchmarks/docs/tmp/scripts excluded as non-issues.

| Classification | Count | Action |
|---|---:|---|
| **GENUINE_HARDCODING** (user runtime) | **0** | — |
| **GENUINE_HARDCODING** (tooling-only) | **1** | `repairHungarianDancePage4SupplementalAnchors` — scripts/tests only; not user path |
| **SUSPECT** (pattern-tuned OMR heuristics) | **4** | m33/m94-like / Family-B column corrections in OMR pipeline — **not removed** (OMR freeze; not filename-keyed) |
| **LEGITIMATE** | many | Demo fixtures, diagnostic maps, generic thresholds, instrument labels |

**No production hardcoding removed.** Filename/title/hash-keyed recognition branches were **not found**.

---

## Production changes

**None.** Audit preferred zero production changes; the only failing release gate is the frozen semantic corpus compare, which cannot be remediated here without OMR tuning or evaluator/baseline policy changes.

---

## Remaining known limitations

1. **Frozen semantic corpus ACCEPT: NO** vs `freeze-baseline` (`15aa1db`) — overall improved, but two fixtures regress class scores beyond the 1% gate (notably grand-voices **sustain −1**).
2. Explicit cross-instrument “Use this score with Guitar/Piano” conversion is still not shipped (by design from prior sprint).
3. Heavy Visual mode still builds full lane groups once (then cached/windowed); absolute first-click latency after huge OMR jobs remains machine-dependent.
4. Compact Practice chrome uses accessible name `Play (Space)` — automation should match that (not a user-facing defect).
5. OMR accuracy on dense/articulation fixtures remains imperfect (known; out of scope here).

---

## Final recommendation

**DO NOT SHIP `994dca6` as a release candidate** until the frozen semantic corpus gate is cleared by process (re-baseline) or by a dedicated OMR remediation sprint.

If product leadership explicitly accepts the current corpus as the new freeze at this commit, re-run:

```bash
npm run omr:semantic-baseline
```

then re-audit with `--compare` against that new baseline. App stability, instrument isolation, ownership, page-count replacement, playback, Piano audio, and heavy-score relative budgets are already in good shape on `994dca6` with **no further production changes required from this audit**.
