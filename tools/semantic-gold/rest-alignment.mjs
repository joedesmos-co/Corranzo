import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const KNOWN = 'KNOWN'
const AMBIGUOUS = 'AMBIGUOUS'

const round = (value, digits = 6) => {
  const scale = 10 ** digits
  return Number.isFinite(value) ? Math.round(value * scale) / scale : null
}

const stableId = (groupId, page, center, glyphClass) => {
  const identity = `${groupId}|${page}|${round(center.x, 6)}|${round(center.y, 6)}|${glyphClass ?? 'unknown'}`
  return `sfr-${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`
}

const supportSizeInStaffSpaces = (glyphClass) => ({
  whole: { width: 1.4, height: 1.0 },
  half: { width: 1.4, height: 1.0 },
  quarter: { width: 1.5, height: 3.0 },
  eighth: { width: 2.0, height: 3.5 },
  sixteenth: { width: 2.2, height: 4.0 },
  thirtySecond: { width: 2.4, height: 4.5 },
}[glyphClass] ?? { width: 2.4, height: 4.5 })

function sourceSupportBounds({ x, y, staffSpacePx, sourceWidth, sourceHeight, glyphClass }) {
  const size = supportSizeInStaffSpaces(glyphClass)
  const halfWidth = size.width * staffSpacePx / 2
  const halfHeight = size.height * staffSpacePx / 2
  return {
    x0: round((x - halfWidth) / sourceWidth),
    x1: round((x + halfWidth) / sourceWidth),
    y0: round((y - halfHeight) / sourceHeight),
    y1: round((y + halfHeight) / sourceHeight),
    coordinateSpace: 'pdf-source-normalized',
    representation: 'CONSERVATIVE_SUPPORT_WINDOW_FROM_VECTOR_GLYPH_ANCHOR',
  }
}

function sourceGraphIsIndependent(graph) {
  const requiredFalse = [
    'readsFinalEvents',
    'readsMusicXml',
    'readsVoices',
    'readsReconstructedOnsets',
    'readsTopologyFamily',
    'readsTruthOrEvaluator',
  ]
  return graph.stage === 'pre-event-source-primitives' &&
    graph.mode === 'independent-shadow-observation' &&
    requiredFalse.every((key) => graph.independence?.[key] === false)
}

/**
 * Freeze source-visible printed rests without reading MusicXML. Graph nominal
 * measure labels are intentionally ignored: page/system and source coordinates
 * select the already frozen semantic source scope.
 */
export function freezeSourceRestInventory({ manifest, sourceScopeMap, groupIds, loadGraphs = (score) => JSON.parse(gunzipSync(readFileSync(score.graphArtifactPath)).toString('utf8')) }) {
  const wanted = new Set(groupIds)
  const records = []
  const diagnostics = []

  for (const score of manifest.realScores.filter((entry) => wanted.has(entry.groupId))) {
    const bundle = loadGraphs(score)
    const scopes = sourceScopeMap.scopes.filter((scope) => scope.groupId === score.groupId)
    const seen = new Map()
    let sourceNodes = 0
    let independentGraphs = 0
    let duplicateObservations = 0
    let unmapped = 0
    let ambiguous = 0

    for (const graph of bundle.graphs ?? []) {
      const rests = (graph.nodes ?? []).filter((node) => node.kind === 'rest' && node.source === 'vector-glyph')
      if (!rests.length) continue
      if (!sourceGraphIsIndependent(graph)) {
        throw new Error(`Rest source graph is not truth-independent: ${score.groupId} ${JSON.stringify(graph.scope)}`)
      }
      independentGraphs += 1
      for (const rest of rests) {
        sourceNodes += 1
        const page = graph.scope.page
        const transform = scopes.find((scope) => scope.page === page)?.pageTransform
        if (!transform?.sourceWidth || !transform?.sourceHeight) {
          throw new Error(`Missing source page transform for ${score.groupId} page ${page}`)
        }
        const center = {
          x: round(rest.anchor.x / transform.sourceWidth),
          y: round(rest.anchor.y / transform.sourceHeight),
          coordinateSpace: 'pdf-source-normalized',
        }
        const staffGap = graph.geometry?.staffSpacePx ?? null
        const tolerance = Number.isFinite(staffGap) ? staffGap / transform.sourceWidth : 0.002
        const candidates = scopes.filter((scope) =>
          scope.page === page &&
          scope.systemIndex === graph.scope.systemIndex &&
          center.x >= scope.sourceBounds.x0 - tolerance &&
          center.x <= scope.sourceBounds.x1 + tolerance &&
          center.y >= scope.sourceBounds.y0 - (staffGap / transform.sourceHeight) &&
          center.y <= scope.sourceBounds.y1 + (staffGap / transform.sourceHeight),
        )
        const strictCandidates = candidates.filter((scope) =>
          center.x >= scope.sourceBounds.x0 && center.x <= scope.sourceBounds.x1,
        )
        const eligible = strictCandidates.length ? strictCandidates : candidates
        const sourceRestId = stableId(score.groupId, page, center, rest.glyphClass)

        if (seen.has(sourceRestId)) {
          duplicateObservations += 1
          continue
        }
        const state = eligible.length === 1 ? KNOWN : AMBIGUOUS
        if (!eligible.length) unmapped += 1
        if (eligible.length > 1) ambiguous += 1
        const scope = eligible.length === 1 ? eligible[0] : null
        const record = {
          sourceRestId,
          groupId: score.groupId,
          scopeId: scope?.scopeId ?? null,
          semanticMeasureNumber: scope?.semanticMeasureNumber ?? null,
          page,
          systemIndex: graph.scope.systemIndex,
          kind: 'rest',
          center,
          bounds: sourceSupportBounds({
            x: rest.anchor.x,
            y: rest.anchor.y,
            staffSpacePx: staffGap,
            sourceWidth: transform.sourceWidth,
            sourceHeight: transform.sourceHeight,
            glyphClass: rest.glyphClass,
          }),
          staffRole: rest.staffRole ?? null,
          sourceGlyphClass: rest.glyphClass ?? null,
          sourcePositionInGraphRegion: round(rest.anchor.positionInMeasure),
          confidence: state === KNOWN ? 0.98 : 0.25,
          state,
          candidateScopeIds: eligible.map((entry) => entry.scopeId),
          provenance: {
            source: 'truth-independent pre-event vector-glyph graph',
            graphNodeId: rest.id,
            graphNominalMeasureUsedForScopeMatching: false,
            scopeMatch: 'page + system + source-coordinate containment',
            boundsRepresentation: 'conservative support window; center is the frozen physical identity',
          },
        }
        seen.set(sourceRestId, record)
        records.push(record)
      }
    }
    diagnostics.push({
      groupId: score.groupId,
      graphArtifactPath: score.graphArtifactPath,
      sourceNodes,
      uniquePhysicalRests: seen.size,
      knownScopeAssignments: [...seen.values()].filter((entry) => entry.state === KNOWN).length,
      ambiguousScopeAssignments: ambiguous,
      unmappedScopeAssignments: unmapped,
      duplicateObservations,
      independentGraphs,
    })
  }

  return {
    schemaVersion: 1,
    contract: 'phase212v-source-rest-inventory-v1',
    truthReadDuringFreeze: false,
    graphNominalMeasureUsedForScopeMatching: false,
    groupIds: [...wanted],
    records,
    diagnostics,
  }
}

const normalizedRestType = (value) => String(value ?? '').replace(/[-_ ]/g, '').toLowerCase()

/**
 * Attach semantics only after the physical rest inventory has been frozen.
 * Exact/high-confidence labels require an equal-sized, staff/type-compatible,
 * monotonic group. All other cases abstain.
 */
export function matchSourceRestsToTruth(sourceRests, truthRests) {
  const mapping = new Map()
  const unmatchedSourceIds = new Set(sourceRests.map((rest) => rest.sourceRestId))
  const unmatchedTruthIds = new Set(truthRests.map((rest) => rest.id))
  const details = []

  const sourceBuckets = new Map()
  for (const rest of sourceRests.filter((entry) => entry.state === KNOWN)) {
    const key = `${rest.staffRole}|${normalizedRestType(rest.sourceGlyphClass)}`
    if (!sourceBuckets.has(key)) sourceBuckets.set(key, [])
    sourceBuckets.get(key).push(rest)
  }
  const truthBuckets = new Map()
  for (const rest of truthRests) {
    const staffRole = rest.staff === 1 ? 'upper' : rest.staff === 2 ? 'lower' : `staff-${rest.staff}`
    const key = `${staffRole}|${normalizedRestType(rest.noteType)}`
    if (!truthBuckets.has(key)) truthBuckets.set(key, [])
    truthBuckets.get(key).push(rest)
  }

  for (const [key, sources] of sourceBuckets) {
    const truths = truthBuckets.get(key) ?? []
    if (!sources.length || sources.length !== truths.length) {
      details.push({ key, sourceCount: sources.length, truthCount: truths.length, state: AMBIGUOUS })
      continue
    }
    const orderedSources = [...sources].sort((a, b) => a.center.x - b.center.x || a.center.y - b.center.y)
    const orderedTruths = [...truths].sort((a, b) => a.offsetQuarters - b.offsetQuarters || a.id.localeCompare(b.id))
    // Equal counts cannot disambiguate simultaneous voices or overlapping glyphs.
    if (orderedTruths.some((entry, i) => i && entry.offsetQuarters <= orderedTruths[i - 1].offsetQuarters) ||
        orderedSources.some((entry, i) => i && entry.center.x - orderedSources[i - 1].center.x <= 1e-6)) {
      details.push({ key, state: AMBIGUOUS, reason: 'NON_UNIQUE_MONOTONIC_REST_ORDER' })
      continue
    }
    const method = sources.length === 1 ? 'UNIQUE_STAFF_AND_PRINTED_GLYPH_TYPE' : 'MONOTONIC_STAFF_AND_PRINTED_GLYPH_TYPE'
    orderedTruths.forEach((truth, index) => {
      const source = orderedSources[index]
      const confidence = sources.length === 1 ? 0.98 : 0.92
      mapping.set(truth.id, {
        sourceRestId: source.sourceRestId,
        state: KNOWN,
        confidence,
        method,
      })
      unmatchedSourceIds.delete(source.sourceRestId)
      unmatchedTruthIds.delete(truth.id)
    })
    details.push({ key, sourceCount: sources.length, truthCount: truths.length, state: KNOWN, method })
  }

  return {
    mapping,
    unmatchedSourceIds: [...unmatchedSourceIds],
    unmatchedTruthIds: [...unmatchedTruthIds],
    details,
  }
}
