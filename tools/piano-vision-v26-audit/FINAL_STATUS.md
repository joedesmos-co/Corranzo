# Piano V2.6 — Source-Truth Investigation: FINAL STATUS

**Campaign closed at pushed commit `5adff2d5ae`.**

# FINAL SCIENTIFIC STATUS

## INDEPENDENT PIANO SOURCE-TRUTH CERTIFICATION: **BLOCKED**

The available Corpus 2.1 / PDF / MusicXML material does not contain enough
independently recoverable correspondence to establish a sufficiently large clean truth
population without human/source-assisted annotation.

## Automated routes tested

1. structural/raster geometry audit
2. canonical staff recovery
3. cross-staff barline correspondence
4. measure-identity mapping
5. structurally complete onset subset
6. general raster onset detection
7. restricted SIMPLE onset detection
8. three-reviewer blind AI consensus V1
9. rhythm-skeleton AI consensus V2
10. higher-fidelity rhythm-skeleton consensus V3
11. automatic pitch-blind structural DP alignment

### Final automatic structural alignment

| quantity | value |
|---|---|
| attempted measures | 20 |
| AUTO_HIGH_CONFIDENCE | 3 |
| matched noteheads N | 12 |
| required N for clean-gate evaluation | >= 50 |
| median structural margin | 0.321 |
| clean gate | **NOT_EVALUATED** |

**No residual/pitch scientific field was used to relax correspondence membership.**

# IMPORTANT NON-CONCLUSIONS

None of the following is claimed. The clean gate was `NOT_EVALUATED` because
correspondence N was insufficient — **not** because it failed.

- the 1,104 mismatches are proven source errors
- Corpus 2.1 labels are wrong
- PDF geometry is the final truth
- MusicXML is the final truth
- Piano capability has been validly measured
- clean gate failed

# WHAT IS ACTUALLY ESTABLISHED

- PDF staff geometry can be recovered accurately
- page-space transform/geometry work is sound
- cross-staff structural information is useful
- many apparent correspondence failures are population-identity problems
- Corpus 2.1 under-covers portions of the rendered source
- independent automatic note identity in dense piano notation is insufficient with
  current inputs
- further automated threshold/packet iterations are not justified
- a trustworthy larger benchmark requires new ground truth or human/source-assisted
  annotation

# 1. ORIGINAL QUESTION

Can an independent, automatically verifiable piano source-truth population be built from
the existing Corpus 2.1 / PDF / MusicXML material — good enough to certify an OMR
pipeline's note correspondence and thereby permit a frozen zero-parameter capability
baseline?

# 2. EXPERIMENTS ATTEMPTED

Eleven routes, listed above. In outline:

**Geometry layer (productive).** Canonical raster staff recovery produced 395 staves and
279 reconstructed systems. Page-space transforms and staff/barline detection proved
accurate and are frozen and reusable. The barline detector config is frozen at
`out/B5_detector_config.json`.

**Mapping layer (partially productive, then blocking).** Cross-staff barline
correspondence and measure-identity mapping work, but only 42 measure intervals were
usable. The clean rate rose from 0.3646 to 0.9000 once a width veto was added — on only
N=20, so that number is not a general claim. A large share of apparent failures turned
out to be population-identity problems rather than geometry errors.

**Onset detection layer (closed).** The general raster onset detector reached precision
about 0.22 and the restricted SIMPLE route failed its required >=0.95 precision/recall
gate. Both are closed routes.

**Consensus layer (closed).** Three rounds of blinded AI review on a frozen 80-item
population:

| round | unanimous SAME_STRUCTURE | pairwise A-exact | consensus noteheads N |
|---|---|---|---|
| V1 | 0.0000 | 0.0375–0.1875 | 0 |
| V2 | 0.2750 | 0.3125–0.3500 | 0 |
| V3 | 0.2500 | 0.0750–0.2375 | 0 |

V2 and V3 raised onset-presence agreement (0.1422 -> 0.3112) but never produced accepted
noteheads. The binding constraint was always reviewer confidence, not rendering.

**Automatic alignment layer (closed).** A global monotonic DP aligner over pitch-blind
structure, with an exact best-versus-second-best margin and perturbation-stability
testing. It achieved N=12 of the required 50. The population ceiling was 122, so the
limit is the method, not the data.

# 3. MAJOR FALSE HYPOTHESES CAUGHT

Recording these matters more than the successes: each was a plausible belief that the
work actively disproved.

- **"A stricter morphology filter gives a better onset detector."** Restricting to a clean
  subset left 14 proposals against 341 source noteheads and made the PDF side useless.
  Permissive proposal plus human filtering beat strict automatic detection.
- **"Chained x-clustering groups onsets."** Comparing each candidate to the *previous*
  member chains transitively, so a dense run collapsed 17 components into 3 groups. Only
  non-chaining clustering is correct.
- **"Cleaner structural mapping will fix the failure rate."** The 0.3646 -> 0.9000 jump
  came from a width veto and then collapsed on fuller data. A high clean rate on N=20 was
  not evidence of a general fix.
- **"AI consensus will produce noteheads if rendering is faithful enough."** V3 fixed the
  real rendering defects (duration-based notehead fill, no stem on whole notes, real
  tuplet numerals) and notehead N stayed at 0. Rendering was never the binding constraint.
- **"Higher agreement implies higher confidence."** V2's 21 unanimous-SAME items were
  blocked almost entirely by confidence, not by agreement. These are different axes.
- **"A wider margin means a more confident alignment."** The second-best search banned
  single pairs one at a time and so could never produce a transposition; an alignment
  genuinely indistinguishable from the best was reported as 5.15 away. This manufactured
  false confidence and was found only because synthetic cases were built to check it.
- **"Detector thresholds are scale-free."** Morphology thresholds were hardcoded to a
  4-pixel staff gap while the real gap was 10.5 px, so almost nothing could ever be
  classified as a note.
- **"A deleted onset will show up as a gap."** Normalising each side by its own data
  extent let a deleted *final* onset stretch to fill the panel and vanish. Both sides must
  share one reference span.
- **"Ambiguity means repeated uniform rhythms."** A uniform run is not ambiguous once x
  is available. Genuine ambiguity is when two source onsets sit inside one PDF onset's
  reach.

# 4. FINAL BLOCKER

The information required to decide note identity is not present in the inputs, and three
independent automated strategies all bottomed out on the same wall:

- **raster geometry** cannot localise noteheads reliably in dense piano notation
  (precision ~0.22), so correspondence cannot be established from the PDF side;
- **blind AI review** reaches structural agreement but will not certify confidence at
  usable rates, so consensus yields zero accepted noteheads;
- **pitch-blind DP alignment** has a median margin of 0.32 on real dense measures versus
  7.4 on structurally determined synthetic cases, meaning a wrong-but-plausible alignment
  is nearly free — the discrimination the acceptance rule depends on is largely absent.

Each failure is a limit of the available information, not of tuning effort. Loosening the
acceptance threshold to admit more measures would be selecting the answer after seeing the
result, which the pre-registration forbids.

# 5. WHAT IS PROVEN

The established findings are listed in full above under WHAT IS ACTUALLY ESTABLISHED. In
summary: PDF staff geometry is recoverable; the page-space geometry layer is sound;
cross-staff structural information is useful; many apparent correspondence failures are
population-identity artifacts; Corpus 2.1 under-covers the rendered source; and
independent automatic note identity in dense piano notation is insufficient with these
inputs.

# 6. WHAT IS NOT PROVEN

- that the 1,104 mismatches are source errors
- that Corpus 2.1 labels are wrong
- that PDF geometry is the final truth
- that MusicXML is the final truth
- that Piano capability has been measured at all
- that the clean gate failed — it was **NOT_EVALUATED**, because N was insufficient
- that any renderer, detector or aligner here is correct on real dense piano measures

# 7. DATA REQUIRED TO RESUME

- substantially more complete PDF<->source labels, **or**
- human/source-assisted structural annotation at useful scale, **or**
- a genuinely stronger OMR/source-correspondence method that changes the information
  available rather than varying a threshold

# 8. RESUME CONDITION

The campaign reopens **only** when one of the three conditions in section 7 becomes
available. It does **not** reopen for another heuristic tweak, threshold variation, or
packet iteration.

# 9. WHY RTX IS NOT JUSTIFIED

RTX and model training remain unjustified, on three independent grounds.

1. **No truth baseline exists to train against.** The prerequisite was a clean-gate-passed
   frozen zero-parameter baseline. Correspondence N reached 12 against a required 50, and
   the gate was never evaluated. Training against an uncertified target would encode the
   very correspondence ambiguity this investigation failed to resolve.
2. **The block is informational, not architectural.** The missing ingredient is ground
   truth about note identity. More compute cannot synthesise ground truth that the inputs
   do not contain; it can only fit whatever labels are present, and those labels are the
   thing in question.
3. **The bottleneck would not move.** Every capability-ceiling analysis in this campaign
   traced back to correspondence and population coverage, not to model capacity. A larger
   model trained on the same under-covering population reproduces the same blind spot at
   greater cost.

# 10. PRESERVED ARTIFACTS

| artifact | path | hash |
|---|---|---|
| Corpus 2.1 | `out/realpdf_21/` | immutable |
| barline detector | `out/B5_detector_config.json` | `fa6256c4…` |
| canonical staves | `out/F_canonical_staves.json` | 395 staves |
| measure map | `out/M7_measure_map.json` | `M7_measure_map.sha256` |
| V1 review packet | `out/h_review/` | `items_neutral.sha256` |
| V2 packet | `out/h_review_ai_v2/` | `3088efb8…` |
| V2 consensus | `out/h_review_ai_v2/ai_blind_consensus_v2_manifest.json` | `8ecca072…` |
| V3 packet | `out/h_review_ai_v3/` | `3dd6b434…` |
| V3 consensus (N=0) | `out/h_review_ai_v3/ai_blind_consensus_v3_manifest.json` | `ffd7783e…` |
| frozen solver | `out/h_auto_struct/solver_frozen.json` | `317ec4ca…` |
| solver code | — | `4c9c4d39…` |
| auto correspondence (N=12) | `out/h_auto_struct/auto_structural_correspondence_manifest.json` | `f193b864…` |
| micro-review population | `out/h_review_human_micro/population.json` | `6abeebd9…` |

Negative-result reports are retained deliberately: `PHASE_A_REPORT.md` through
`PHASE_U_REPORT.md`, `STAGE_*_REPORT.md`, `CAMPAIGN*_REPORT.md`,
`STAGE_AUTO_STRUCT_REPORT.md`, `STAGE_HUMAN_MICRO_REPORT.md`, `STAGE_H3B_REPORT.md`.

Synthetic solver tests: `a_synthetic_tests.py`, 19/19 pass.
