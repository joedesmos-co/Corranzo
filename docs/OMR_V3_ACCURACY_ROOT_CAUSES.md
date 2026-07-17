# OMR V3 Accuracy Root-Cause Investigation

Date: 2026-07-16

Status: Phase 1 read-only investigation; production and V3 shadow output unchanged.

## Method

Each regressed enforced fixture was rerun through the live PDF pipeline with V3 shadow capture enabled. The resulting document IR was inspected system by system, including staff classification, rejected pairing evidence, measure recovery, symbol ownership, primary events, notation/TAB mirrors, and serializer rejection diagnostics. The investigation compared the observations entering V3 with the data surviving each V3 stage.

The regressions are not caused by the PDF loader, preprocessing policy, production confidence threshold, or worker transport. They occur after the legacy detector has already produced usable page observations.

## Root-cause summary

| Fixture | Exact first-loss subsystem | Evidence |
| --- | --- | --- |
| Grand staff voices | staff classification/grouping | The second source system is represented by 6-line + 5-line notation bands; V3 marks the 6-line band ambiguous, loses their shared source-system identity, and emits 3 systems instead of 2. |
| Articulation scan | staff grouping | Both true pairs score 0.73 but are rejected solely because the calculated vertical-distance score is 0; V3 ignores that each pair came from one detector-owned source system. |
| Sparse TAB | Guitar pitch/timing semantics | All 40 adapted symbols contain detector MIDI and numeric onset/duration. V3 adds an octave to every TAB pitch and replaces detector timing with new spacing inference. |
| Standard Guitar | staff classification/recovery | Two irregular 2-line bands own 17 symbols, including 16 pitched observations, but are classified `unknown`; zero events are built from those bands. |
| Paired Guitar chords | staff grouping, then pitch-aware fusion | V3 pairs TAB system 1 with notation system 2 across source pairs, leaving notation system 0 unknown and TAB system 3 independent. Only 4 mirrors survive. |
| Paired Guitar techniques | measure recovery and pitch-aware fusion | Correct source pairs are grouped, but closed 6-measure grids are expanded to 8 measures per system and every notation/TAB pitch match is rejected by an artificial 12-semitone difference. |

## Detailed traces

### Grand staff voices

The detector supplies two systems of four measures each. V3 receives four staff observations:

```text
source system 0: 5-line notation + 5-line notation -> paired
source system 1: 6-line ambiguous + 5-line notation -> separated
```

The separated 6-line band owns 28 exact pitched/timed symbols but produces no voice events. The final V3 structure therefore contains 3 systems, 12 measures, and 60 events instead of 2 systems, 8 measures, and 88 events.

The first irreversible loss is in `buildOmrV3StaffCandidates`/`groupOmrV3StaffCandidates`: the adapter knows both observations came from legacy system 1, but that identity is not represented as pairing evidence. The current `pairingKind` also requires exactly 5 + 5 lines for Piano even when an upstream detector has already classified an irregular band as notation.

### Articulation scan

The detector again supplies two grand-staff systems. All four bands classify as notation, and both intended pairs have perfect horizontal overlap, left alignment, and barline alignment. Their pair scores are 0.73, above the fixed 0.62 threshold. They are nevertheless rejected as `insufficient-spanning-evidence` because the staff-gap calculation produces a vertical-distance score of 0 and there is no brace observation.

The result is 4 systems / 16 measures. Pair separation narrows the ownership regions, leaving 25 of 122 source symbols unassigned. No preprocessing difference exists: the V2 and V3 branches use the same contrast/background-normalized page.

The missing datum is direct source-system continuity. It should be one evidence signal among the existing multi-signal checks, not a threshold exception.

### Sparse TAB

Every adapted TAB symbol carries:

- valid string and fret;
- detector MIDI;
- numeric onset divisions; and
- numeric duration divisions marked `exact: false`, matching V2's explicit approximate-rhythm warning.

For the first symbol, for example, detector MIDI is 65 while V3 emits written MIDI 77 and sounding MIDI 65. The benchmark evaluator and current playback timeline use detector MIDI 65. This 12-semitone shift repeats across the fixture and explains 0% V3 pitch accuracy.

`tabOnlyEvents` also ignores the available numeric onset/duration and recomputes both from column spacing. The problem is not that approximate timing exists; V2 also calls it approximate. The problem is that V3 replaces an existing approximation with a different one instead of preserving the observation and its uncertainty.

### Standard Guitar

The detector supplies four standard-notation systems and 43 recognized notes. V3 structure contains:

| Source band | Lines | V3 type | Owned symbols | Pitched symbols | Emitted events |
| --- | ---: | --- | ---: | ---: | ---: |
| system 0 | 5 | single notation | 24 | 24 | 24 |
| system 1 | 5 | single notation | 6 | 3 | 3 |
| system 2 | 2 | unknown | 8 | 7 | 0 |
| system 3 | 2 | unknown | 9 | 9 | 0 |

The 16 missing note events, rather than duration clipping, are the first cause of the one gated duration regression. The legacy adapter already labels all four bands as notation roles and supplies treble-8vb clef evidence, but V3's line-count-centric classification does not preserve that explicit detector role when the line detector returns an incomplete band.

The safe recovery is role-plus-symbol based: an incomplete band with explicit notation provenance and pitched noteheads may remain a single-notation staff while retaining a low staff-detection confidence. Line count alone must not manufacture a role, and an unlabeled two-line band must remain ambiguous.

### Paired Guitar chords

The detector reports four source systems with roles equivalent to:

```text
notation 0 <-> TAB 1
notation 2 <-> TAB 3
```

The adapter supplies the TAB systems with the corresponding notation measure grid, but discards the explicit partner identity before generic adjacent grouping. V3 then constructs:

```text
notation 0 -> unknown independent group
TAB 1 + notation 2 -> incorrect cross-pair
TAB 3 -> tab-only group
```

This explains the 3-group structure, 14 measures, and the division of events across unrelated timelines. Within the incorrect paired group, notation/TAB matching also suffers from the same 12-semitone semantics mismatch as the technique fixture. Only 4 mirror relationships are produced, 57 observations are diagnosed unpaired, and 6 overlapping monophonic groups are rejected by serialization.

The first fix belongs in structural evidence: preserve a stable source-pair identity from `systemRoles`. Pitch semantics must then be repaired so correctly co-owned pairs can match.

### Paired Guitar techniques

Unlike the dense paired fixture, structural grouping finds both intended notation/TAB pairs. Two independent losses remain:

1. Each source pair supplies a closed six-measure adapter grid. `recoverMissingBoundaries` treats the intentionally uneven widths as missing barlines and inserts two more boundaries per system, producing 16 measures instead of V2's 12.
2. Each notation symbol's fallback sounding pitch is calculated as detector MIDI minus 12, while each TAB digit is calculated directly from string/fret. The source values already agree, so every pair appears exactly an octave apart and fails the two-semitone fusion limit.

The first invariant is that missing-boundary inference may refine incomplete detector evidence but must not add boundaries to an explicitly closed, adapter-reconciled grid. The second is that explicit written/sounding pitch provenance must outrank fallback transposition assumptions.

## Cross-cutting design defects

### 1. Adapter structure provenance is incomplete

The shadow adapter retains source IDs but not the relationship between source systems. Generic geometry then has to rediscover information already established upstream. This affects Piano system membership, Guitar notation/TAB pairing, and incomplete-line recovery.

Required invariant: carry stable `sourceSystemId`, explicit notation/TAB role, and `sourcePairId` as structural evidence. These are detector observations, not fixture labels or coordinates.

### 2. Explicit musical evidence loses to fallback inference

Guitar builders currently recompute pitch/timing even when the adapted symbol contains an observed value. This causes octave mismatch and alternative approximate timing.

Required invariant: explicit pitch, onset, and duration observations are authoritative. String/fret and geometric spacing are fallbacks. Their uncertainty flags remain intact.

### 3. Recovery cannot distinguish incomplete evidence from a closed grid

Measure recovery treats all barline lists as potentially incomplete. The shadow adapter's lists are derived from complete runtime measure boxes and have different semantics from raw candidate lists.

Required invariant: propagate evidence completeness. Missing-barline recovery must not subdivide a closed grid, while raw/sparse detector evidence retains the existing conservative recovery path.

### 4. Ambiguity currently means silent musical loss

An `unknown` staff group is structurally honest, but the Guitar stage emits nothing from it even when every source note has explicit pitch and timing.

Required invariant: an explicit detector notation role can recover incomplete line geometry as `single-notation`; unlabeled ambiguous bands remain non-emitting.

## Fix boundaries

The investigation authorizes only the following small changes:

1. Preserve and score detector-owned source-system/source-pair evidence during grouping.
2. Preserve explicit detector notation roles on incomplete bands.
3. Preserve explicit Guitar pitch and approximate timing before applying fallbacks.
4. Prevent missing-barline inference on complete adapter grids.

It does not authorize threshold changes, fixture IDs, truth-aware runtime behavior, direct reuse of V2 MusicXML, broad voice rewriting, or production promotion.
