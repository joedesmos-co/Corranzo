# OMR Next-Generation Architecture — Design Note

Status: proposal / RFC. No runtime changes proposed here. Diagnostics-and-plumbing
first, runtime output byte-identical until a change is proven on the benchmark.

## TL;DR

Your instinct is right that the heuristic engine has plateaued, and Voice
Reconstruction Graph V2 is the right **data model**. But the highest-leverage
change is not "build the graph" — you have already built most of it three times
over. It is:

1. **Collapse the three overlapping representations you already maintain into one
   canonical Score Graph IR** (single source of truth), and
2. **Replace the feed-forward, order-dependent heuristic pile with a joint,
   per-measure constraint solver over that graph**, promoted to runtime through
   the exact "simulate → guarded promote" gate you already prototyped for
   phantom-column correction — but gated on the **evaluator**, not just on note/
   measure-count invariants.

Every heuristic that works becomes a *weighted soft constraint*. Every heuristic
on your "proven NOT to work" list failed because it was applied **globally and
greedily**; those are precisely the cases a **local joint solver** fixes. And the
real prize is generalization: the current pile is at risk of benchmark-overfit,
whereas a calibrated solver generalizes to unseen dense / anime / classical PDFs.

Voice Reconstruction Graph V2 is not wrong — this is VRG V2 with a better *engine*
(joint inference) and a mandate to *unify*, not add, representations.

## Where you actually are (grounded)

The runtime vector path (`processVectorOmrPage.js`, ~2176 lines) is an ordered
sequence of narrow spatial mutations on an event list: `extendDurationsPerClefVoice`,
`refineUnsupportedUpperChordOverhangs`, `openingBassChordSustainSpan`,
`terminalHarmonicHalfSpan`, `sameClefBeatQuarterFloor`, `refineOpeningBassSubdivisionDurations`,
and ~30 siblings. Each is a beat/geometry patch applied in a fixed order. Ordering
fragility is why the reverted list exists (opening-column broadening, terminal
phantom correction, broad x-gap merges…). This is the plateau.

You already have the makings of the next architecture, but fragmented:

- **A beam/stem graph**: `beamStemReconstructionDiagnostics.buildBeamStemGraph`
  (notehead → stem → beam ownership with confidence) — used both in runtime and in
  diagnostics.
- **An event reconstruction**: `reconstructMusicalEvents` (duration-ladder + inner-
  voice split) — used in runtime.
- **A shadow voice engine**: `beamOwnershipVoiceSimulation.simulateBeamOwnershipVoices`
  + `buildVoiceSerializedOmrMusicXml` — a *complete parallel* event→MusicXML path,
  **not imported by any runtime module** (shadow-only today).
- **The cutover primitive you need already exists**: `runPdfOmrPipeline` computes
  `applyPhantomColumnCorrection(...)` as a simulation and only writes it back to
  `measureRhythms` when `appliedMeasures > 0 && !noteCountChanged && !measureCountChanged`,
  setting `promotedToRuntime = true`. This is a per-measure "simulate, then promote
  only if safe" gate. It is the seed of the whole migration.

So there are effectively three parallel notions of "the events" (the heuristic list,
the reconstructed events, the beam-ownership voices), plus a graph, plus a shadow
serializer. Nothing is the canonical source of truth. That is the structural debt —
more than the absence of a graph.

## Assessment of Voice Reconstruction Graph V2 as specified

Strengths (keep these):
- The ontology `notehead → stem → beam → rhythmic group → voice candidate → event`
  matches the physical logic of engraving. Beams/stems *are* the grouping ground
  truth in dense piano writing. Making ownership + confidence explicit is correct
  and is the right home for today's scattered heuristics.

The one structural weakness (fix this): as literally specified it is a **layered,
feed-forward pipeline**. Real OMR errors are non-local and bidirectional. Your
remaining failures are explicitly coupled — "m61: missing + extra + chord",
"m97: mixed onset/pitch". A feed-forward graph commits each layer before the layer
that could correct it runs: a stem-ownership mistake is locked in before the
rhythmic/measure-budget constraint that would reveal it; a voice guess is committed
before the pitch/register evidence that would refute it. Layering re-creates the
ordering fragility you are trying to escape, one level up.

## Recommended architecture: Score Graph IR + joint per-measure solver

Keep VRG as the **model**. Change the **engine** from "layer commit" to
"constrained joint assignment over the whole measure."

### 1. One canonical IR: `ScoreGraph` (per system / per measure)

Immutable, typed, observation-only. Nodes are primitives with geometry and a
*detection confidence*; edges are typed *candidate* relations, each with a
confidence and a provenance tag (which detector/heuristic proposed it).

```
PrimitiveNode   = { id, kind: notehead|stem|beam|flag|dot|rest|accidental|tie|barline,
                    bbox, clef, staffLine/space, pitchNatural, confidence, source }
CandidateEdge   = { kind: stem_owns_head | beam_links_stems | head_in_chord
                          | note_in_voice | tie_links | dot_augments,
                    from, to, weight, source }
MeasureGraph    = { measureNumber, page, timeSignatureBudget, staffGeometry,
                    nodes[], edges[], onsetColumns[] }
```

Critical: `staffGeometry` / the **measure grid must be a first-class field of the
IR and must pass through byte-identical** — the score-follow cursor maps to it.
The IR is an *observation layer*; building it changes no runtime bytes.

Unify into this: the nodes/edges that `buildBeamStemGraph` already computes, the
onset columns from `innerVoicePhaseCorrection.extractOnsetColumns`, and the
rest/accidental/tie/staccato detectors. One builder, one type, replacing three.

### 2. The engine: joint MAP inference per measure

A measure is a *small* problem: a handful of onset columns × ≤4 voices. Frame it as
maximum-a-posteriori assignment: choose, for each notehead, a `(voice, onset,
duration)` that maximizes total edge weight subject to hard musical constraints and
soft preferences.

Hard constraints (must hold):
- Each voice's durations tile its measure to the time-signature budget (this single
  constraint dissolves most duration heuristics).
- Onsets strictly increase within a voice; chord tones share onset + duration.
- Ties link equal pitches across a barline; a tied note's release is the next onset
  in its own voice.

Soft preferences (weighted, tunable — this is where every heuristic lives):
- Beam/stem grouping (from graph edges), beat-grid snapping, minimal voice count,
  register/voice-continuity, gap-to-next-onset, per-clef extension, harmonic half-
  span, quarter-floor. Each becomes a **feature with a weight**, not an ordered
  mutation.

Algorithm: bounded **beam search / DP over onset columns** left→right within the
measure, carrying the K best partial voice assignments and their running duration
budget. Measure-sized state space makes this cheap and fully in-browser (no ILP/
CP-SAT runtime, no server). Conceptually it is ILP; practically it is a small
beam search.

Why this beats the heuristic pile:
- **Order independence**: the objective is symmetric; no "apply A before B" bugs.
- **Local override**: a globally-bad rule (your reverted "broad beam duration caps")
  is fine as a *soft* weight because stronger local evidence overrides it per
  measure. The "proven NOT to work" list is a list of things that only fail when
  applied globally.
- **Coupled errors resolve jointly**: onset, pitch, and chord decisions for m61/m97
  are made together under one objective instead of in sequence.
- **Generalization**: weights tuned against the benchmark generalize; 40 ordered
  spatial patches are overfit to the two pieces they were tuned on.

### Why not a full neural rewrite (now)

End-to-end neural OMR (oemer/TrOMR-style) is the obvious "even better." For *this*
product it is the wrong first move: it must run locally in-browser with no server
(size/latency), it is a black box that is hard to keep byte-identical and hard to
guarantee against regression, and it needs training data you do not yet have at
scale. Your edge is a clean symbolic pipeline with an excellent evaluator. Keep
symbolic. The correct place for learning is **later and small**: replace the hand-
set soft-constraint weights with a tiny logistic/GBDT edge-scorer trained on your
own labeled benchmark edges. That is a hybrid (symbolic graph + learned weights),
gated behind the IR existing, and is the true long-term ceiling-raiser — not a
rewrite.

## Migration plan (diagnostics-first, byte-identical, revert-on-regress)

Each phase preserves runtime bytes until a metric gate is passed, and generalizes
the `promotedToRuntime` idiom you already ship.

- **Phase 0 — freeze the contract.** Treat current MusicXML output as the golden
  master. Add a byte-diff + evaluator-diff harness over the whole benchmark
  (you already have `omrAccuracyEvaluator` + `omrBenchmarkDashboard`; this mostly
  wires them into a single "runtime vs shadow" report). A test asserts runtime
  bytes are unchanged.

- **Phase 1 — IR as observation (zero runtime change).** Introduce `ScoreGraph`,
  populated from the *same* detections runtime already uses, unifying
  `buildBeamStemGraph` + onset columns + reconstruct inputs. Emit it only into the
  dashboard. Gate: runtime bytes identical (test-enforced). Pure plumbing — this is
  the bulk of the safe work and is where I would start.

- **Phase 2 — solver as shadow emitter.** Implement `emitFromGraph(scoreGraph) →
  MusicXML` (reuse `buildVoiceSerializedOmrMusicXml` as the serializer). Run it on
  the full benchmark in the dashboard. It will not match at first — fine, it is
  shadow. Tune weights until, on the **clean benchmark it is byte-identical** and on
  Dense Cruel Angel its evaluator metrics **≥** current runtime on every axis. No
  runtime switch yet.

- **Phase 3 — guarded per-measure cutover.** Switch runtime to the solver *only per
  measure and only where safe*, reusing your promotion pattern but gated on the
  evaluator: if the solver's measure equals the heuristic measure → use it (no-op);
  if it differs → keep it only if the measure-level confidence + invariant checks
  pass, else fall back to the heuristic output. This keeps byte-identical output on
  everything heuristics already nail (the clean benchmark) and lets the solver act
  only on the coupled dense measures where heuristics were losing.

- **Phase 4 — retire heuristics one at a time.** Delete each `extend*/refine*/…`
  mutation individually, each deletion gated by "benchmark unchanged." The 2176-line
  file collapses toward: detect → build IR → solve → emit.

- **Phase 5 — learned weights (optional).** Once IR + solver are the runtime, train
  edge weights on the accumulated labeled benchmark for the residual low-confidence
  decisions.

## Guardrails (mapped to your hard rules)

- **Byte-identical during plumbing** — Phases 0–2 are observation/shadow; a test
  asserts runtime bytes. Nothing to hardcode; nothing piece-specific.
- **No lowering gates / benchmark-driven / revert-on-regress** — every promotion is
  per-measure and evaluator-gated; a regression on any benchmark axis blocks it.
  This is your existing `promotedToRuntime` discipline, generalized.
- **Preserve score-follow / Wait For You / Practice / onboarding / stability** — the
  work is confined to OMR MusicXML generation. The **measure grid must remain an
  unchanged, first-class output** (the cursor depends on it); make it an explicit IR
  field with a byte-identical assertion.
- **The one addition you need**: your benchmark is two pieces. A solver tuned on two
  pieces overfits exactly like the heuristics did. Before Phase 3, **expand a
  held-out validation corpus** of dense/anime/classical PDFs with ground truth, and
  report metrics on held-out pieces separately. Otherwise you cannot measure the
  generalization that is the entire point — and "no benchmark cheating" becomes
  unenforceable.

## Honest ROI

On the *current* two-piece benchmark the payoff is modest — you are already at
94–100%. The case for doing this is not the next 2%; it is (a) collapsing 2176 lines
of order-fragile heuristics into a tunable ~few-hundred-line core you can reason
about, and (b) **generalizing** beyond the pieces you tuned on, which is the stated
goal ("outperform across dense/anime/classical"). If you are not going to expand the
benchmark corpus, the rewrite is not worth it — you would just be re-encoding an
overfit engine in a nicer shape. If you are, this is the right architecture and the
migration is safe because you already invented its core mechanism.

## Suggested first PR (plumbing only, byte-identical)

1. `scoreGraph.js`: the IR types + one `buildScoreGraph(measure, detections)` that
   unifies `buildBeamStemGraph` + onset columns; no runtime consumer yet.
2. Emit the IR into `omrBenchmarkDashboard` as a new diagnostic panel.
3. A test asserting runtime MusicXML bytes for both benchmark pieces are unchanged.
4. A `runtime-vs-shadow` report scaffold (empty shadow for now).

No runtime behavior changes; the benchmark is untouched; everything is reversible.
