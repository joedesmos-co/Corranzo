/** Semantic-only overlay on immutable canonical source graphs and targets. */
import { buildRestLabels, buildTupletLabels, canonicalLaneCatalog, parseWrittenNotation } from './assembler.mjs'
import { freezeSourceRestInventory, matchSourceRestsToTruth } from './rest-alignment.mjs'

export function repairContext(xml, scopes) {
  // Source geometry is frozen before parsing the offline truth document.
  const sourceScopes = scopes.map(source => ({
    groupId: source.metadata.groupId, scopeId: source.metadata.scopeId,
    page: source.metadata.page,
    systemIndex: source.modelInput.sourceGraph?.sourceScope?.systemIndex,
    sourceBounds: source.modelInput.geometry.scopeBounds,
    pageTransform: source.modelInput.geometry.pageTransform,
  }))
  const notation = parseWrittenNotation(xml, 'offline-written-notation')
  const byMeasure = new Map()
  for (const note of notation.notes) {
    if (!byMeasure.has(note.measureNumber)) byMeasure.set(note.measureNumber, [])
    byMeasure.get(note.measureNumber).push(note)
  }
  return { sourceScopes, notation, byMeasure, laneCatalog: canonicalLaneCatalog(notation) }
}

export function repairScope(context, frozenSource, frozenTarget) {
  if (frozenSource.metadata.exampleId !== frozenTarget.metadata.exampleId) throw new Error('SOURCE_TARGET_ID_MISMATCH')
  const source = structuredClone(frozenSource)
  const target = structuredClone(frozenTarget)
  const md = source.metadata
  const graph = source.modelInput.sourceGraph
  const groupId = md.groupId
  const independent = graph?.state === 'AVAILABLE_INDEPENDENT_PDF_SOURCE_EVIDENCE'
  const inventory = independent ? freezeSourceRestInventory({
    manifest: { realScores: [{ groupId }] }, sourceScopeMap: { scopes: context.sourceScopes }, groupIds: [groupId],
    loadGraphs: () => ({ graphs: [{ stage: 'pre-event-source-primitives', mode: 'independent-shadow-observation',
      independence: graph.independence, nodes: graph.nodes, scope: graph.sourceScope, geometry: graph.sourceGeometry }] }),
  }) : { records: [] }
  const restObjects = inventory.records.filter(rest => rest.state === 'KNOWN' && rest.scopeId === md.scopeId)
  const originalCount = source.modelInput.physicalObjects.length
  const objectIndexById = new Map(md.sourceObjectIds.map((id, index) => [id, index]))
  for (const [index, rest] of restObjects.entries()) {
    objectIndexById.set(rest.sourceRestId, originalCount + index)
    source.modelInput.physicalObjects.push({ objectIndex: originalCount + index, kind: 'rest', center: rest.center,
      bounds: rest.bounds, geometryConfidence: rest.confidence, geometrySource: rest.provenance.source })
    source.metadata.sourceObjectIds.push(rest.sourceRestId)
    graph.objectGraphNodeIds?.push(rest.provenance.graphNodeId)
  }
  source.modelInput.availabilityMasks.printedRests = restObjects.length > 0
  // Existing notehead object indexes and graph evidence remain unchanged.
  const notes = context.byMeasure.get(md.semanticMeasureNumber) ?? []
  const truth = { notes, rests: notes.filter(n => n.isRest), sounded: notes.filter(n => !n.isRest) }
  const eventRef = new Map()
  for (const label of frozenTarget.families.PITCH_STAFF) {
    if (label.objectIndexes.length !== 1) continue
    for (const id of label.semanticEventIds) eventRef.set(id, {
      objectIndex: label.objectIndexes[0], matchState: label.state, confidence: label.confidence,
    })
  }
  // Verify the old offline event mapping still refers to the same written notes.
  const noteById = new Map(notes.map(n => [n.id, n]))
  for (const label of frozenTarget.families.PITCH_STAFF) {
    for (const id of label.semanticEventIds) {
      const note = noteById.get(id)
      if (!note || note.midi !== label.value.midiTargetMetadata || note.staff !== label.value.staff)
        throw new Error(`FROZEN_WRITTEN_EVENT_IDENTITY_MISMATCH:${id}`)
    }
  }
  const scope = { scopeId: md.scopeId, state: md.eligibleScopeState, confidence: 1 }
  const restMapping = matchSourceRestsToTruth(restObjects, truth.rests)
  target.families.REST = buildRestLabels({ truth, scope, restObjects, restMapping, objectIndexById,
    laneCatalog: context.laneCatalog, eventRef })
  target.families.TUPLET = buildTupletLabels({ truth, eventRef, scope, scopeId: scope.scopeId })
  target.metadata.semanticRepair = { version: 'written-boundaries-source-rests-v2', canonicalObjectsUnchanged: originalCount,
    sourceRestInventory: restObjects.length, knownRestMappings: restMapping.mapping.size, truthReadDuringSourceFreeze: false }
  return { source, target, restObjects }
}
