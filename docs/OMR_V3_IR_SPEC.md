# Corranzo OMR V3 Intermediate Representation

Status: implemented foundation and shadow pipeline, schema version 1

Runtime status: disabled by default; no production consumer or promoted stage

## Purpose

OMR V3 is a structure-first document model. It records what the page contains and how evidence is related before committing to note emission, voice numbering, or MusicXML. It is deliberately separate from the existing measure-event pipeline so incomplete V3 stages cannot alter production output.

The core implementation is in `src/features/omr/v3/omrV3Ir.js`. It contains only plain JavaScript data constructors and pure validation/serialization helpers; it has no browser, React, PDF.js, canvas, or worker dependency.

## Design rules

- Every addressable node has a deterministic string ID made from stable semantic parts; no time or randomness is used.
- All data is JSON serializable. `undefined`, class instances, DOM objects, functions, typed arrays, and image buffers are excluded.
- Source pixels are not copied into the IR. Geometry and `sourceRefs` preserve traceability to external detector observations.
- Pixel geometry uses `space: "pixels"`; document-relative geometry uses `space: "normalized"` and is constrained to 0..1.
- Confidence is `{ overall, stages, evidence }`. Stage values are independent observations, not substitutes for missing evidence and not silently inflated into one score.
- Diagnostics live on the narrowest owning node and use `{ code, severity, message, stage, sourceRefs, data }`.
- Constructors return new arrays/objects and do not mutate detector inputs. `deepFreezeOmrIR` is available where immutable handoff is useful.
- Relationships are explicit graph edges. They do not hide inside MusicXML emission order.

## Normalized hierarchy

```text
OmrDocumentIR
  schemaVersion
  documentId
  metadata
  pages[]
    OmrPageIR
      pageId, pageIndex, width, height
      systems[]
        OmrSystemIR
          systemId, boundingBox, readingOrder
          staffGroups[]
            OmrStaffGroupIR
              staffGroupId, type
              staves[]
                OmrStaffIR
                  staffId, lineCount
                  rawLineGeometry[]
                  normalizedLineGeometry[]
                  clef, notationType, verticalOrder
                  symbols[], measureMembership[], barlineEvidence[]
              braces[], brackets[]
              pairingEvidence[], rejectedPairings[]
          measureColumns[]
            OmrMeasureColumnIR
              measureId, measureNumber, xStart, xEnd
              barlineEvidence[]
              expectedStaffParticipation[]
              onsetColumns[]
                OmrOnsetColumnIR
                  onsetColumnId, x, measureRelativePosition
                  noteheads[], rests[], stems[], beams[]
                  accidentals[], tabDigits[], excludedSymbols[]
              voices[]
                OmrVoiceIR
                  voiceId, staffId, candidateRank
                  overlapConstraints[], ambiguous
                  events[]
                    OmrEventIR
                      eventId, onset, duration, pitch
                      chordGroupId, stemGroupId, beamGroupId
                      string, fret, technical
                      sourceRefs, confidenceBreakdown
          systemBarlines[]
      unassignedSymbols[]
  relationships[]
    OmrRelationshipIR
      relationshipId, type, members[], directed, metadata
```

`measureColumns` belong to a whole musical system/staff group, not independently to each staff. `voices` and `onsetColumns` are nested under the shared measure because their timing constraints are measure-local. Relationships remain document-level so ties, slurs, repeats, and cross-staff edges may cross measure or system boundaries.

## Enumerations

Staff group types:

- `piano-grand-staff`
- `single-notation`
- `guitar-notation-tab`
- `tab-only`
- `unknown`

Staff notation types:

- `notation`
- `tab`
- `ambiguous`
- `unknown`

Relationship types:

- `tie`
- `slur`
- `beam`
- `stem-group`
- `notation-tab-mirror`
- `cross-staff`
- `repeat-volta`
- `technique`

The initial schema intentionally does not enumerate every clef, duration type, articulation, or technique. Those values remain extensible strings/metadata until live evidence demonstrates a stable closed set.

## Event duration and pitch

`duration` is an object rather than one overloaded number:

```json
{
  "divisions": 4,
  "type": "quarter",
  "dots": 0,
  "exact": true
}
```

`exact: false` is required for approximate TAB-only spacing or unresolved rhythm. Future sounding-release information can be added without replacing written duration.

`pitch` is nullable and may hold written and sounding fields:

```json
{
  "step": "E",
  "alter": 0,
  "octave": 4,
  "midi": 64,
  "writtenMidi": 64,
  "soundingMidi": 52
}
```

The serializer must never infer finite values from `null`; unresolved events remain diagnostics/candidates rather than invalid notes.

## Stable IDs and provenance

`createOmrV3Id(kind, ...parts)` normalizes semantic parts and produces IDs such as:

```text
omr3:system:omr3-page-score-0:2
omr3:staff:omr3-system-page-2:1
omr3:measure:omr3-system-page-2:17
```

Builders should use page index, reading order, source observation IDs, and local indices that remain stable for the same detector output. Downstream transformations retain the originating `sourceRefs`. An emitted event must be traceable to its onset column and one or more detector source references; synthesized rests or boundaries must name their inference source in diagnostics/provenance.

## Validation invariants

`validateOmrDocumentIR` returns `{ valid, errors, warnings }`; `assertValidOmrDocumentIR` throws a compact `TypeError`. Validation currently enforces:

- supported schema version;
- non-empty, globally unique IR IDs;
- all internal references resolve after the full document is indexed;
- positive finite page dimensions;
- finite, non-negative geometry and bounded normalized boxes;
- staff line counts between 1 and 24 and known notation/staff-group types;
- each staff group has at least one staff;
- finite measure spans with `xStart < xEnd`;
- finite onset x and relative positions in 0..1;
- non-negative finite event onset/duration when present;
- known relationship types with at least two members;
- confidence values in 0..1 and known diagnostic severities.

External detector/source references are intentionally allowed to be outside the IR ID registry. They are provenance links, not dangling IR references.

## Serialization and debug export

- `serializeOmrDocumentIR(document)` validates and writes canonical, sorted object keys.
- `exportOmrV3DebugJson(document)` writes the same canonical form with two-space indentation.
- `parseOmrDocumentIR(json)` parses and validates before returning data.
- Equal IR data therefore produces byte-stable debug JSON while array order continues to represent reading/candidate order.

Serialization tests cover stable IDs, round trips, input immutability, deep freezing, malformed JSON, unsupported versions, non-finite geometry, duplicate IDs, and dangling references.

## Versioning policy

`schemaVersion` changes only for incompatible representation changes. Additive nullable metadata does not require a version bump. A future migrator must be pure and explicit; the validator will not guess how to reinterpret an unsupported version.

## Implemented transformation stages

All stages are pure-data modules under `src/features/omr/v3/`:

| Module | Responsibility | Runtime authority |
| --- | --- | --- |
| `omrV3Structure.js` | raw/canonical line geometry, staff classification, system/staff-group evidence, reading order | shadow only |
| `omrV3Measures.js` | cross-staff barline reconciliation and shared measure columns | shadow only |
| `omrV3Ownership.js` | symbol ownership, exclusions, multi-digit TAB preservation, first-class onset columns | shadow only |
| `omrV3Voices.js` | Piano staff voices, chords/rests, alternate ambiguous candidates, beam/stem/tie/slur relationships | shadow only |
| `omrV3Guitar.js` | notation/TAB fusion, TAB-only approximate rhythm, unpaired diagnostics | shadow only |
| `omrV3MusicXml.js` | deterministic independent MusicXML with validation and diagnostics | shadow only |
| `omrV3Evaluation.js` | truth/current comparisons and conservative promotion gates | benchmark only |
| `omrV3Shadow.js` | adapter/orchestrator from current detector observations to V3 | opt-in development/benchmark only |
| `omrV3Rollout.js` | disabled defaults, rollback, and non-enabling promotion requests | production-safe control plane |

`runPdfOmrPipeline` accepts `omrV3Shadow`, `omrV3Compare`, `omrV3Rollback`, `omrV3RuntimeCandidate`, and `omrV3Promotions`. Shadow and the runtime candidate default to false. Rollback suppresses all V3 work. Promotions resolve only when `omrV3RuntimeCandidate` is armed and rollback is off; `fullV3` is the only key that may swap MusicXML. Comparison mode (`omrV3Compare`) runs independent V3 beside V2, keeps V2 user-visible, and attaches `omrV3Comparison` / disagreement telemetry without promoting. Benchmarks opt into shadow analysis and write a separate `omr-v3-shadow-report`.

The current shadow adapter deliberately reuses legacy measure/event evidence to exercise the full IR lifecycle. Its symbol evidence is therefore not an independent raw-symbol detector benchmark. This provenance is named on adapted barlines and event technical metadata; no fixture IDs or coordinates are embedded in runtime code.

## Intentionally deferred

- A complete symbol taxonomy.
- Neural feature tensors or raster pixels.
- A production storage format separate from debug JSON.
- Automatic mutation/migration of malformed data.
- Full semantic coverage for every MusicXML construct.

These are deferred so the first implementation remains small enough to verify while still carrying the structural identities, geometry, provenance, confidence, and diagnostics required by later V3 stages.
