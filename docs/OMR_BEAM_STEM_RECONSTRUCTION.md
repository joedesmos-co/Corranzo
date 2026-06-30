# OMR Beam & Stem Reconstruction Design

Status: architecture note plus checkpoint. Phase 1 diagnostics succeeded, but
runtime beam/stem duration edits and beam ownership simulations have not been
promoted.
Scope: local/browser OMR. No servers, no piece-specific rules, no threshold tuning
as a benchmark workaround.

See `../OMR_ENGINE.md` for the current benchmark snapshot and the list of
reverted or simulation-only beam/stem approaches.

## Goal

The current dense OMR path detects nearly the right noteheads and measure count,
but remaining errors are increasingly caused by rhythm and event grouping being
inferred from x-position thresholds. A Beam & Stem Reconstruction layer should
recover explicit visual rhythm structure before rhythm inference:

```
noteheads + PDF/vector primitives + rendered pixels
  -> stem candidates
  -> beam candidates
  -> rhythmic groups
  -> musical events / voices
  -> MusicXML
```

This layer should be evidence-producing first. It should not change durations,
onsets, chord grouping, or voices until a benchmark run proves the graph improves
dense metrics without clean-score regression.

## Current Flow Audit

### Raster/scanned path

Flow:

```
processOmrPageAnalysis
  -> detectNoteheadsInMeasure
  -> refineMeasurePitches
  -> assembleMeasureRhythm
  -> enrichNoteheadRhythm
  -> groupNoteheadsIntoChords
  -> validateAndNormalizeMeasureRhythm
```

Important modules:

| Module | Current responsibility |
|---|---|
| `src/features/omr/detectOmrNoteheads.js` | Finds raster notehead blobs; rejects long horizontal ink as beam/staff/tie fragments. |
| `src/features/omr/detectNoteRhythmFeatures.js` | Per-note pixel probing for hollow heads, one stem, one beam-strength scan, dot, tie-to-next, duration guess. |
| `src/features/omr/assembleOmrMeasureRhythm.js` | Groups nearby noteheads into chords by x-distance, assigns starts/durations, validates measure fill. |

Current retained evidence on a notehead:

```js
{
  hollow,
  stem: { x, tipY, length, direction },
  beams,
  beamStrength,
  dotted,
  tieStart,
  durationType,
  durationDivisions
}
```

Current limitation: stem and beam evidence is local to one notehead. There is no
explicit stem object, beam object, beam group, stem-to-notehead edge, or
beam-to-stem edge. `groupNoteheadsIntoChords` still decides chord membership by
horizontal proximity.

### Vector/digital path

Flow:

```
runPdfOmrPipeline
  -> extractPdfPageText
  -> processVectorPageSystems
  -> textGlyphsToImage
  -> noteheadsForMeasure
  -> enrichNoteheadRhythm
  -> buildVectorEvents
  -> extend/refine duration heuristics
  -> reconstructMusicalEvents
```

Important modules:

| Module | Current responsibility |
|---|---|
| `src/features/score-follow/pdfPageAnalysis.js` | Renders page pixels and extracts text items only. |
| `src/features/omr/processVectorOmrPage.js` | Converts SMuFL text glyphs to noteheads, assigns pitch/accidentals/articulations, then builds events from x/slot grouping. |
| `src/features/omr/vectorRhythmDiagnostics.js` | Reports per-note stem/beam flags and event-level duration/voice diagnostics. |
| `src/features/omr/reconstructMusicalEvents.js` | Post-event local repair for split/merged musical events. |

Current retained evidence:

- SMuFL notehead glyph location and font-derived text item metadata.
- SMuFL accidentals, rests, staccato/accent glyphs, and tie/slur control glyphs.
- Rendered-image rhythm probes attached to noteheads: `stem`, `beams`,
  `beamStrength`, `hollow`, `dotted`, `durationDivisions`.

Current discarded or under-modeled evidence:

- Alternate stem-side/direction candidates when the first local probe fails.
- Stem bounding boxes, stroke width, x-continuity, and confidence.
- Beam bounding boxes, slope, thickness, number of parallel beams, and span.
- Which stems a beam connects.
- Which noteheads share a stem.
- Which noteheads belong to the same beamed rhythmic group.
- PDF path primitives. Current runtime uses `getTextContent()` but does not pass
  `getOperatorList()`/line/rect/curve primitives into OMR analysis.
- Event-level beam serialization. `buildOmrMusicXml` emits beams from
  `event.beams`, while vector events primarily retain beam evidence per note.

## PDF Evidence Audit

The current app receives vector noteheads from text extraction, but stems and
beams are not exposed as semantic text glyphs. On the benchmark PDFs:

| PDF/page | Text noteheads | PDF.js `constructPath` ops | pdfplumber lines | pdfplumber rects | pdfplumber curves |
|---|---:|---:|---:|---:|---:|
| Cruel Angel p1 | 252 | 419 | 480 | 19 | 40 |
| Cruel Angel p2 | 389 | 538 | 603 | 35 | 44 |
| Gymnopedie p1 | 138 | 292 | 479 | 0 | 13 |

Interpretation:

- Vector PDFs expose noteheads through SMuFL text glyphs.
- Stems, beams, staff lines, barlines, and slurs are low-level drawing
  primitives, not semantic OMR objects.
- PDF.js can expose those primitives through `page.getOperatorList()`, but the
  current OMR pipeline does not request or normalize them.
- `pdfplumber` confirms that many primitives are already line/rect/curve-like.
  That is a useful prototype view, but production browser code should normalize
  PDF.js operator-list data directly or use rendered-image fallback.

## Can Rendered Image Analysis Recover Stems/Beams?

Yes, partially. The existing `enrichNoteheadRhythm` already recovers local
stem/beam evidence from rendered pixels. It is conservative but one-note-at-a-
time:

- Stem: scan a single expected stem x from notehead center toward a direction
  chosen from staff midpoint.
- Beam: scan one horizontal run from the detected stem tip.
- Beam count: collapses to 0/1 and a `beamStrength` scalar.

For a reconstruction graph, rendered image analysis should move from local probe
to structure extraction:

- Use staff/measure boxes to suppress staff-line bands.
- Extract vertical stroke components near noteheads as `StemCandidate`s.
- Extract horizontal/slanted thick strokes as `BeamCandidate`s.
- Attach noteheads to stems by side, overlap, and expected stem direction.
- Attach stems to beams by endpoint proximity and beam span.
- Group connected notehead-stem-beam components into rhythmic groups.

This can run fully in-browser from the existing rendered `ImageData`.

## Proposed Intermediate Model

### `NoteheadCandidate`

Existing notehead plus stable identity and visual bounds.

```ts
type NoteheadCandidate = {
  id: string
  page: number
  measureNumber: number
  systemIndex: number
  staffRole: 'upper' | 'lower'
  clef: 'treble' | 'bass'
  cx: number
  cy: number
  xNorm: number
  yNorm: number
  midi: number
  source: 'vector-glyph' | 'vector-glyph-orphan' | 'raster-blob'
  glyph?: { text: string, fontName?: string, width?: number, height?: number }
  visualBounds?: { x0: number, y0: number, x1: number, y1: number }
  rhythmProbe?: {
    hollow?: boolean
    dotted?: boolean
    stem?: unknown
    beams?: number
    beamStrength?: number
  }
}
```

### `StemCandidate`

```ts
type StemCandidate = {
  id: string
  page: number
  measureNumber: number
  source: 'pdf-path' | 'rendered-image'
  x: number
  y0: number
  y1: number
  direction: 'up' | 'down' | 'unknown'
  side: 'left' | 'right' | 'unknown'
  strokeWidth?: number
  confidence: number
  attachedNoteheadIds: string[]
  rejectionReason?: string
}
```

### `BeamCandidate`

```ts
type BeamCandidate = {
  id: string
  page: number
  measureNumber: number
  source: 'pdf-path' | 'rendered-image'
  x0: number
  x1: number
  y0: number
  y1: number
  slope: number
  thickness: number
  level: 1 | 2 | 3
  confidence: number
  attachedStemIds: string[]
}
```

### `RhythmicGroup`

```ts
type RhythmicGroup = {
  id: string
  measureNumber: number
  staffRole: 'upper' | 'lower' | 'cross-staff'
  noteheadIds: string[]
  stemIds: string[]
  beamIds: string[]
  inferredUnit: 'quarter-or-longer' | 'eighth' | 'sixteenth' | 'unknown'
  attackOrder: number
  confidence: number
  evidence: string[]
}
```

### `MusicalEvent`

Existing event shape can be preserved, but should gain optional graph references:

```ts
type MusicalEvent = {
  type: 'note' | 'rest'
  startDivision: number
  durationDivisions: number
  notes: NoteheadCandidate[]
  stemIds?: string[]
  beamGroupId?: string
  voiceId?: string
  reconstructionReasons?: string[]
}
```

### Diagnostics

```ts
type BeamStemDiagnostics = {
  stemCandidates: number
  beamCandidates: number
  attachedStemCount: number
  attachedBeamCount: number
  unresolvedNoteheadCount: number
  rhythmicGroupCount: number
  sourceCounts: Record<'pdf-path' | 'rendered-image', number>
  skippedReasons: Record<string, number>
  samples: Array<{
    measureNumber: number
    noteheadIds: string[]
    stemIds: string[]
    beamIds: string[]
    inferredUnit: string
    confidence: number
  }>
}
```

## Graph Construction

Build a weighted graph per measure or per system:

```
NoteheadCandidate --attached-to--> StemCandidate
StemCandidate     --connected-by--> BeamCandidate
BeamCandidate     --groups-------> RhythmicGroup
RhythmicGroup     --orders-------> MusicalEvent
MusicalEvent      --assigned-to--> Voice
```

Edge scoring should be evidence-based and generic:

| Edge | Positive evidence | Rejection evidence |
|---|---|---|
| notehead -> stem | stem touches expected side, y-overlap near head, direction matches staff-side convention, same staff band | stem crosses staff/measure as barline, too far from head, belongs to another notehead stack |
| stem -> beam | stem tip touches beam bbox, beam spans multiple nearby stems, slope consistent across group | beam is staff line/ledger/slur, span crosses barline without stems |
| notehead -> rhythmic group | connected component through stem/beam, same staff or explicit cross-staff stem | no stem/beam path, conflicting staff role |
| rhythmic group -> event | shared attack x/slot, vertical chord stack, shared stem | separated by beam order/attack order, intervening stem/beam |

This is a graph problem rather than a threshold-only merge problem. Thresholds
still exist, but they should gate candidate edges and confidence, not directly
rewrite durations.

## Pipeline Integration

### New optional evidence extraction

Add an optional extractor beside text extraction:

```
runPdfOmrPipeline
  -> renderPage(...)
  -> extractPageText(...)
  -> extractPagePrimitives?(...)  // optional, vector PDFs only
  -> processOmrPageAnalysis({ pageText, pagePrimitives, imageData })
```

`pagePrimitives` should be a browser-safe normalized representation:

```ts
type PdfPagePrimitive =
  | { type: 'line', x0: number, y0: number, x1: number, y1: number, width?: number }
  | { type: 'rect', x0: number, y0: number, x1: number, y1: number, width?: number }
  | { type: 'curve', x0: number, y0: number, x1: number, y1: number, width?: number }
```

If primitives are absent, use `ImageData` only.

### New layer position

Vector path:

```
noteheadsForMeasure(...)
  -> reconstructBeamStemGraph({ notes, glyphs, imageData, pagePrimitives, measureBox })
  -> buildVectorEvents(notes, ..., { beamStemGraph })
```

Raster path:

```
detectNoteheadsInMeasure(...)
  -> refineMeasurePitches(...)
  -> reconstructBeamStemGraph({ notes, imageData, measureBox })
  -> assembleMeasureRhythm(..., { beamStemGraph })
```

Initial rollout should be diagnostic-only:

```
graph built -> diagnostics saved -> events unchanged
```

Only after diagnostics match expected benchmark categories should `buildVectorEvents`
consume graph facts for specific, measured behaviors.

## Expected Benchmark Impact

| Category | Expected impact | Why |
|---|---|---|
| Duration | High | Beam count and beam grouping can distinguish eighth/sixteenth runs from held notes without relying on gaps. |
| Onset | Medium-high | Beam groups encode attack order inside dense measures; can prevent neighboring attacks from being merged into chords. |
| Chord grouping | Medium | Shared stem separates true chord tones from nearby sequential beamed tones; shared stem also supports real split chords. |
| Voices | Medium-high | Stem direction and beam groups are direct voice evidence, especially same-staff inner voices. |
| Pitch | Indirect | Fewer grouping/onset artifacts should reduce apparent pitch mismatches without touching pitch mapping. |
| Measure count | Low | Barline detection is separate and already close; this layer should not move measure boundaries. |

## Benchmark-Safe First Slice

Recommended first implementation is diagnostic-only:

1. Add optional `pagePrimitives` plumbing to scripts or pipeline fixtures, but do
   not use it to alter events.
2. Build `reconstructBeamStemGraph` for vector measures using existing noteheads
   plus current per-note rhythm probes.
3. Save diagnostics:
   - noteheads with/without attached stems
   - stems with/without attached beams
   - beam groups by measure/staff
   - disagreement between current per-note `beams/beamStrength` and graph groups
4. Run current dense/clean benchmarks and assert generated MusicXML and metrics
   are unchanged.
5. Use diagnostics to pick one measured rule later, for example:
   - cap durations only when a graph beam connects two or more stems in the same
     staff and current event duration exceeds the graph unit;
   - split same-staff nearby noteheads only when graph stem/beam components prove
     separate attacks.

No runtime-changing slice is recommended yet. The current x-gap simulations show
that grouping changes without stronger visual evidence regress chord/onset/pitch.

## Open Questions

- Can PDF.js operator-list normalization be made stable enough across browser and
  Node benchmark runners, or should primitive extraction remain a diagnostic/tool
  path first?
- Are beam rectangles consistently represented as filled rect/path primitives
  across the benchmark corpus, or do some engravers draw them as image glyphs?
- Should beam graph construction operate per measure or per system? Per-system
  is better for cross-measure beams; per-measure is safer for rollout.
- How should event-level MusicXML beam tags be generated for beamed groups without
  changing playback timing?

## Non-Goals

- No song/title/page/measure-specific fixes.
- No broad x-gap widening.
- No pitch/staff remapping.
- No changes to PDF viewer, cursor, score follow, or Wait For You.
- No lower rejection gates to make noisy beam candidates pass.

## Current Checkpoint

The beam/stem graph remains diagnostics-only for runtime output.

- Phase 1 diagnostics proved useful extraction: dense stem attachment `99.96%`,
  beam attachment `32.76%`, average confidence about `0.8617`, clean unchanged.
- Phase 2 beam duration capping was reverted. Broad and tight cap variants both
  regressed dense duration.
- Beam Ownership Phase 2 event splitting simulation was not promoted: dense
  duration regressed `80.96% -> 80.89%`, wrong durations `223 -> 225`.
- Beam Ownership Phase 3 voice serialization simulation was not promoted: dense
  duration again regressed `80.96% -> 80.89%`, wrong durations `223 -> 225`.
- Runtime XML stayed byte-identical to the diagnostics-only baseline in both
  ownership simulation passes.

Do not retry event-level beam caps, same-start event splitting, or voice
serialization duration shortening without a new diagnostic signal that explains
why measures `85` and `96` will not over-shorten again.
