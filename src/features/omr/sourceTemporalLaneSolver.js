const SOLVER_VERSION = 1
const MAX_LANE_NEIGHBORS = 5

export const SOURCE_TEMPORAL_LANE_THRESHOLDS = Object.freeze({
  alignedAttack: 0.69,
  displacedChord: 0.74,
  attackAlternativeFloor: 0.45,
  attackSemanticHigh: 0.9,
  singletonAttack: 0.78,
  physicalOwnership: 0.62,
  beamMembership: 0.72,
  tupletMembership: 0.65,
  laneTransitionHigh: 0.76,
  laneTransitionAmbiguous: 0.62,
  laneTransitionMargin: 0.08,
  durationHigh: 0.78,
  explicitRest: 0.78,
  inferredRest: 0.86,
  sharedHeadRole: 0.86,
  crossStaffContinuity: 0.85,
  capacityToleranceQuarterUnits: 0.01,
})

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

function mean(values) {
  const finite = values.filter(Number.isFinite)
  if (!finite.length) return null
  return finite.reduce((sum, value) => sum + value, 0) / finite.length
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function pairKey(left, right) {
  return left < right ? `${left}|${right}` : `${right}|${left}`
}

function compactEvidence(entry, kind = entry?.type ?? entry?.kind ?? 'unknown') {
  return {
    id: entry?.id ?? null,
    kind,
    score: round(entry?.score ?? entry?.evidenceScore),
    source: entry?.source ?? null,
    reasons: entry?.reasons ?? [],
  }
}

function byType(entries = [], property = 'type') {
  const result = new Map()
  for (const entry of entries) {
    const key = entry?.[property]
    if (!key) continue
    if (!result.has(key)) result.set(key, [])
    result.get(key).push(entry)
  }
  return result
}

function memberPairs(memberIds = []) {
  const pairs = []
  for (let left = 0; left < memberIds.length; left += 1) {
    for (let right = left + 1; right < memberIds.length; right += 1) {
      pairs.push(pairKey(memberIds[left], memberIds[right]))
    }
  }
  return pairs
}

class UnionFind {
  constructor(ids) {
    this.parent = new Map(ids.map((id) => [id, id]))
  }

  find(id) {
    const parent = this.parent.get(id)
    if (parent == null || parent === id) return parent
    const root = this.find(parent)
    this.parent.set(id, root)
    return root
  }

  union(left, right) {
    const leftRoot = this.find(left)
    const rightRoot = this.find(right)
    if (leftRoot == null || rightRoot == null || leftRoot === rightRoot) return
    this.parent.set(rightRoot, leftRoot)
  }

  groups() {
    const groups = new Map()
    for (const id of this.parent.keys()) {
      const root = this.find(id)
      if (!groups.has(root)) groups.set(root, [])
      groups.get(root).push(id)
    }
    return [...groups.values()]
  }
}

function graphIndexes(graph) {
  const nodesById = new Map((graph?.nodes ?? []).map((node) => [node.id, node]))
  const relationsByType = byType(graph?.relations, 'type')
  const laneEvidenceByKind = byType(graph?.laneEvidence, 'kind')
  const ambiguitiesByPair = new Map()
  for (const ambiguity of graph?.ambiguities ?? []) {
    for (const key of memberPairs(ambiguity.memberIds)) {
      if (!ambiguitiesByPair.has(key)) ambiguitiesByPair.set(key, [])
      ambiguitiesByPair.get(key).push(ambiguity)
    }
  }
  const relationsByPair = new Map()
  for (const relation of graph?.relations ?? []) {
    const key = pairKey(relation.from, relation.to)
    if (!relationsByPair.has(key)) relationsByPair.set(key, [])
    relationsByPair.get(key).push(relation)
  }
  const beamIdsByNote = new Map()
  for (const relation of relationsByType.get('beam-membership-candidate') ?? []) {
    if ((relation.score ?? 0) < SOURCE_TEMPORAL_LANE_THRESHOLDS.beamMembership) continue
    if (!beamIdsByNote.has(relation.from)) beamIdsByNote.set(relation.from, new Set())
    beamIdsByNote.get(relation.from).add(relation.to)
  }
  const stemOwnersByNote = new Map()
  for (const relation of relationsByType.get('stem-owner-candidate') ?? []) {
    if (!stemOwnersByNote.has(relation.to)) stemOwnersByNote.set(relation.to, [])
    stemOwnersByNote.get(relation.to).push(relation)
  }
  return {
    nodesById,
    relationsByType,
    laneEvidenceByKind,
    ambiguitiesByPair,
    relationsByPair,
    beamIdsByNote,
    stemOwnersByNote,
  }
}

function relationBetween(indexes, leftIds, rightIds, types) {
  let best = null
  for (const left of leftIds) {
    for (const right of rightIds) {
      for (const relation of indexes.relationsByPair.get(pairKey(left, right)) ?? []) {
        if (!types.includes(relation.type)) continue
        if (!best || (relation.score ?? 0) > (best.score ?? 0)) best = relation
      }
    }
  }
  return best
}

function ambiguitiesBetween(indexes, leftIds, rightIds) {
  const result = []
  const seen = new Set()
  for (const left of leftIds) {
    for (const right of rightIds) {
      for (const ambiguity of indexes.ambiguitiesByPair.get(pairKey(left, right)) ?? []) {
        if (seen.has(ambiguity.id)) continue
        seen.add(ambiguity.id)
        result.push(ambiguity)
      }
    }
  }
  return result
}

function attackMergeCandidate(relation, indexes) {
  const threshold = relation.type === 'same-chord-candidate'
    ? SOURCE_TEMPORAL_LANE_THRESHOLDS.displacedChord
    : SOURCE_TEMPORAL_LANE_THRESHOLDS.alignedAttack
  if ((relation.score ?? 0) < threshold) return null
  if (relation.evidence?.sameStaff !== true) return null
  if (relation.evidence?.opposingStems) return null
  const ambiguity = indexes.ambiguitiesByPair.get(pairKey(relation.from, relation.to)) ?? []
  if (ambiguity.length) return null
  if (relation.type === 'same-chord-candidate' && relation.evidence?.sharedStem !== true) return null
  if (
    relation.type === 'same-attack-candidate' &&
    relation.evidence?.sharedStem !== true &&
    Math.abs(relation.evidence?.dx ?? Infinity) > Math.min(1.5, (relation.evidence?.attackTolerance ?? 3) * 0.5)
  ) return null
  return relation
}

function incidentAttackAlternatives(indexes, memberId) {
  return [
    ...(indexes.relationsByType.get('same-chord-candidate') ?? []),
    ...(indexes.relationsByType.get('same-attack-candidate') ?? []),
  ].filter(
    (relation) =>
      (relation.from === memberId || relation.to === memberId) &&
      (relation.score ?? 0) >= SOURCE_TEMPORAL_LANE_THRESHOLDS.attackAlternativeFloor,
  )
}

function groupAnchor(memberNodes) {
  return {
    x: round(mean(memberNodes.map((node) => node.anchor?.x)), 2),
    y: round(mean(memberNodes.map((node) => node.anchor?.y)), 2),
  }
}

function buildAttackGroups(graph, indexes) {
  const noteNodes = (graph?.nodes ?? [])
    .filter((node) => node.kind === 'notehead')
    .sort((left, right) =>
      (left.anchor?.x ?? 0) - (right.anchor?.x ?? 0) ||
      (left.anchor?.y ?? 0) - (right.anchor?.y ?? 0),
    )
  const union = new UnionFind(noteNodes.map((node) => node.id))
  const acceptedRelations = []
  const mergeRelations = [
    ...(indexes.relationsByType.get('same-chord-candidate') ?? []),
    ...(indexes.relationsByType.get('same-attack-candidate') ?? []),
  ]
    .map((relation) => attackMergeCandidate(relation, indexes))
    .filter(Boolean)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))

  for (const relation of mergeRelations) {
    const leftGroup = union.groups().find((members) => members.includes(relation.from)) ?? []
    const rightGroup = union.groups().find((members) => members.includes(relation.to)) ?? []
    if (ambiguitiesBetween(indexes, leftGroup, rightGroup).length) continue
    union.union(relation.from, relation.to)
    acceptedRelations.push(relation)
  }

  const attacks = union.groups()
    .map((memberIds) => {
      const memberNodes = memberIds.map((id) => indexes.nodesById.get(id)).filter(Boolean)
      const support = acceptedRelations.filter(
        (relation) => memberIds.includes(relation.from) && memberIds.includes(relation.to),
      )
      const conflicts = []
      for (const key of memberPairs(memberIds)) {
        conflicts.push(...(indexes.ambiguitiesByPair.get(key) ?? []))
      }
      for (const memberId of memberIds) {
        for (const ambiguity of graph?.ambiguities ?? []) {
          if (!(ambiguity.memberIds ?? []).includes(memberId)) continue
          if (ambiguity.kind === 'same-attack-versus-independent-lanes') conflicts.push(ambiguity)
        }
      }
      const externalAttackAmbiguities = (graph?.ambiguities ?? []).filter(
        (ambiguity) =>
          ambiguity.kind === 'same-attack-versus-independent-lanes' &&
          (ambiguity.memberIds ?? []).some((id) => memberIds.includes(id)),
      )
      const uniqueConflicts = [...new Map(
        [...conflicts, ...externalAttackAmbiguities].map((entry) => [entry.id, entry]),
      ).values()]

      let confidence
      if (memberIds.length > 1) {
        confidence = Math.min(...support.map((relation) => relation.score ?? 0))
      } else {
        const node = memberNodes[0]
        const owners = indexes.stemOwnersByNote.get(node?.id) ?? []
        const incidentAlternatives = incidentAttackAlternatives(indexes, node?.id)
        const hasOwner = owners.some(
          (relation) => (relation.score ?? 0) >= SOURCE_TEMPORAL_LANE_THRESHOLDS.physicalOwnership,
        )
        const hasRhythmGlyph =
          node?.glyph?.open === true ||
          (node?.primitiveEvidence?.beamCount ?? 0) > 0 ||
          node?.primitiveEvidence?.augmentationDot === true
        confidence = incidentAlternatives.length
          ? 0.6
          : hasOwner
            ? 0.84
            : hasRhythmGlyph
              ? 0.8
              : 0.6
        for (const relation of incidentAlternatives) {
          uniqueConflicts.push({
            id: `unresolved:${relation.id}`,
            kind: 'unresolved-attack-alternative',
            score: relation.score,
            source: relation.source,
            reasons: relation.reasons,
            hypotheses: ['singleton-sequential-attack', 'multi-head-or-multi-lane-attack'],
          })
        }
      }
      const groupThreshold = support.some((entry) => entry.type === 'same-chord-candidate')
        ? SOURCE_TEMPORAL_LANE_THRESHOLDS.displacedChord
        : SOURCE_TEMPORAL_LANE_THRESHOLDS.alignedAttack
      const selfContainedWhole =
        memberIds.length === 1 &&
        String(memberNodes[0]?.glyph?.class ?? '').toLowerCase().includes('whole')
      const status = uniqueConflicts.length
        ? 'ambiguous'
        : memberIds.length > 1 && confidence >= SOURCE_TEMPORAL_LANE_THRESHOLDS.attackSemanticHigh
          ? 'high-confidence'
          : support.length || selfContainedWhole
            ? 'relationship-supported'
          : 'low-evidence'
      return {
        memberIds: [...memberIds].sort(),
        memberNodes,
        anchor: groupAnchor(memberNodes),
        confidence: round(confidence),
        status,
        supportingEvidence: support.map((entry) => compactEvidence(entry)),
        contradictoryEvidence: uniqueConflicts.map((entry) => compactEvidence(entry, entry.kind)),
        alternatives: uniqueConflicts.flatMap((entry) => entry.hypotheses ?? []),
      }
    })
    .sort((left, right) => left.anchor.x - right.anchor.x || left.anchor.y - right.anchor.y)
    .map((attack, index) => ({
      id: `${graph?.scope ? `p${graph.scope.page ?? 0}:s${graph.scope.systemIndex ?? 0}` : 'source'}:shadow-attack:${index + 1}`,
      ...attack,
    }))

  const crossStaffAlternatives = []
  for (const relation of indexes.relationsByType.get('cross-staff-continuation-candidate') ?? []) {
    const dx = Math.abs(relation.evidence?.dx ?? Infinity)
    if (dx > Math.max(2.25, (graph?.geometry?.staffSpacePx ?? 8) * 0.38)) continue
    crossStaffAlternatives.push({
      kind: 'cross-staff-simultaneous-versus-continuation',
      memberIds: [relation.from, relation.to],
      confidence: round(relation.score),
      supportingEvidence: [compactEvidence(relation)],
      contradictoryEvidence: [],
      alternatives: ['cross-staff-simultaneous-attack', 'cross-staff-lane-continuation'],
      resolution: 'preserve-alternatives',
    })
  }

  return { attacks, crossStaffAlternatives }
}

function resolveUniformSingletonSequences(attacks, graph, indexes) {
  const staffSpace = graph?.geometry?.staffSpacePx ?? 8
  const groups = new Map()
  for (const attack of attacks) {
    if (
      attack.memberIds.length !== 1 ||
      attack.status !== 'low-evidence' ||
      attack.contradictoryEvidence.length
    ) continue
    const node = indexes.nodesById.get(attack.memberIds[0])
    const direction = node?.primitiveEvidence?.stemDirection
    if (!node?.staffRole || !direction) continue
    const key = `${node.staffRole}|${direction}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(attack)
  }

  let resolved = 0
  for (const group of groups.values()) {
    group.sort((left, right) => left.anchor.x - right.anchor.x)
    if (group.length < 3) continue
    const gaps = group.slice(1).map((attack, index) => attack.anchor.x - group[index].anchor.x)
    const typicalGap = median(gaps)
    if (!(typicalGap > staffSpace)) continue
    const spacingDeviation = Math.max(...gaps.map((gap) => Math.abs(gap - typicalGap) / typicalGap))
    if (spacingDeviation > 0.18) continue
    const relations = group.slice(1).map((attack, index) => relationBetween(
      indexes,
      group[index].memberIds,
      attack.memberIds,
      ['sequential-attack-candidate'],
    ))
    if (relations.some((relation) => !relation)) continue
    for (const attack of group) {
      attack.status = 'high-confidence'
      attack.confidence = round(Math.max(attack.confidence, 0.8))
      attack.supportingEvidence.push({
        id: null,
        kind: 'complete-uniform-singleton-sequence',
        score: 0.8,
        source: 'bounded source-X sequence, physical stems, and uniform spacing',
        reasons: ['three-or-more unambiguous attacks form one complete staff/direction sequence'],
      })
      resolved += 1
    }
  }
  return resolved
}

function resolveRepeatedOpposingLaneColumns(attacks, graph, indexes) {
  const byMember = new Map()
  for (const attack of attacks) {
    for (const memberId of attack.memberIds) byMember.set(memberId, attack)
  }
  const staffSpace = graph?.geometry?.staffSpacePx ?? 8
  const columns = []
  const seenPairs = new Set()
  for (const ambiguity of graph?.ambiguities ?? []) {
    if (ambiguity.kind !== 'same-attack-versus-independent-lanes') continue
    if ((ambiguity.memberIds ?? []).length !== 2) continue
    const [leftId, rightId] = ambiguity.memberIds
    const key = pairKey(leftId, rightId)
    if (seenPairs.has(key)) continue
    seenPairs.add(key)
    const leftAttack = byMember.get(leftId)
    const rightAttack = byMember.get(rightId)
    if (!leftAttack || !rightAttack || leftAttack === rightAttack) continue
    if (leftAttack.memberIds.length !== 1 || rightAttack.memberIds.length !== 1) continue
    const leftNode = indexes.nodesById.get(leftId)
    const rightNode = indexes.nodesById.get(rightId)
    const leftDirection = leftNode?.primitiveEvidence?.stemDirection
    const rightDirection = rightNode?.primitiveEvidence?.stemDirection
    if (!leftDirection || !rightDirection || leftDirection === rightDirection) continue
    if (leftNode?.staffRole !== rightNode?.staffRole) continue
    columns.push({
      x: mean([leftNode.anchor?.x, rightNode.anchor?.x]),
      staffRole: leftNode.staffRole,
      byDirection: new Map([
        [leftDirection, { attack: leftAttack, node: leftNode }],
        [rightDirection, { attack: rightAttack, node: rightNode }],
      ]),
      ambiguity,
    })
  }

  const uniqueColumns = columns.filter((column) =>
    columns.filter(
      (candidate) =>
        candidate.staffRole === column.staffRole &&
        Math.abs(candidate.x - column.x) <= staffSpace * 0.38,
    ).length === 1,
  )
  const resolvedAttacks = new Set()
  for (let leftIndex = 0; leftIndex < uniqueColumns.length; leftIndex += 1) {
    const left = uniqueColumns[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < uniqueColumns.length; rightIndex += 1) {
      const right = uniqueColumns[rightIndex]
      const dx = right.x - left.x
      if (right.staffRole !== left.staffRole || dx <= staffSpace || dx > staffSpace * 12) continue
      const directions = [...left.byDirection.keys()]
      if (!directions.every((direction) => right.byDirection.has(direction))) continue
      const sequenceRelations = directions.map((direction) => {
        const leftEntry = left.byDirection.get(direction)
        const rightEntry = right.byDirection.get(direction)
        return relationBetween(
          indexes,
          leftEntry.attack.memberIds,
          rightEntry.attack.memberIds,
          ['sequential-attack-candidate'],
        )
      })
      if (sequenceRelations.some((relation) => !relation)) continue
      for (const column of [left, right]) {
        for (const entry of column.byDirection.values()) {
          entry.attack.status = 'relationship-supported'
          entry.attack.confidence = round(Math.max(entry.attack.confidence, 0.82))
          entry.attack.supportingEvidence.push({
            id: column.ambiguity.id,
            kind: 'repeated-opposing-stem-lane-columns',
            score: 0.82,
            source: 'repeated source columns and primitive stem continuity',
            reasons: ['two independent stem-direction paths recur at a later source X'],
          })
          entry.attack.contradictoryEvidence = entry.attack.contradictoryEvidence.filter(
            (evidence) => evidence.id !== column.ambiguity.id,
          )
          entry.attack.alternatives = []
          resolvedAttacks.add(entry.attack.id)
        }
      }
      break
    }
  }
  return resolvedAttacks.size
}

function meterCapacity(graph) {
  const meter = (graph?.nodes ?? []).find(
    (node) => node.kind === 'state-mark' && node.stateType === 'meter',
  )
  const match = /^(\d+)\/(\d+)$/.exec(String(meter?.value ?? ''))
  if (!match) return { beats: null, beatType: null, quarterUnits: null, sourceNodeId: null }
  const beats = Number(match[1])
  const beatType = Number(match[2])
  return {
    beats,
    beatType,
    quarterUnits: round(beats * (4 / beatType)),
    sourceNodeId: meter.id,
  }
}

function restQuarterUnits(glyphClass) {
  const value = String(glyphClass ?? '').toLowerCase()
  if (value.includes('whole')) return 4
  if (value.includes('half')) return 2
  if (value.includes('quarter')) return 1
  if (value.includes('128')) return 1 / 32
  if (value.includes('64')) return 1 / 16
  if (value.includes('32')) return 1 / 8
  if (value.includes('16')) return 1 / 4
  if (value.includes('eighth') || value.includes('8th')) return 1 / 2
  return null
}

function noteDurationEvidence(node, indexes) {
  const beamCount = Math.max(0, Number(node?.primitiveEvidence?.beamCount) || 0)
  const glyphClass = String(node?.glyph?.class ?? '').toLowerCase()
  const hasStem = (indexes.stemOwnersByNote.get(node?.id) ?? []).some(
    (relation) => (relation.score ?? 0) >= SOURCE_TEMPORAL_LANE_THRESHOLDS.physicalOwnership,
  )
  let quarterUnits = null
  let confidence = 0
  let source = null
  let alternatives = []

  const beamMembership = (indexes.relationsByType.get('beam-membership-candidate') ?? [])
    .filter((relation) => relation.from === node?.id)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))[0]

  if (
    beamCount > 0 &&
    (beamMembership?.score ?? 0) >= SOURCE_TEMPORAL_LANE_THRESHOLDS.beamMembership
  ) {
    quarterUnits = 1 / (2 ** beamCount)
    confidence = Math.min(0.9, Math.max(0.82, beamMembership.score))
    source = 'primitive beam level plus physical beam membership'
  } else if (beamCount > 0) {
    alternatives = [1 / (2 ** beamCount), 1]
    confidence = round(beamMembership?.score ?? 0.55)
    source = 'beam-level probe without high-confidence physical beam ownership'
  } else if (glyphClass.includes('whole')) {
    quarterUnits = 4
    confidence = 0.9
    source = 'whole-notehead glyph class'
  } else if (glyphClass.includes('half')) {
    if (hasStem) {
      quarterUnits = 2
      confidence = 0.86
      source = 'open notehead plus physical stem ownership'
    } else {
      alternatives = [2, 4]
      confidence = 0.55
      source = 'open head without resolved stem ownership'
    }
  } else if (node?.glyph?.open === true) {
    if (hasStem) {
      quarterUnits = 2
      confidence = 0.82
      source = 'open notehead plus physical stem ownership'
    } else {
      alternatives = [2, 4]
      confidence = 0.55
      source = 'generic open head without resolved stem ownership'
    }
  } else if (hasStem) {
    quarterUnits = 1
    confidence = 0.82
    source = 'filled notehead plus physical stem ownership without beam'
  }

  if (quarterUnits != null && node?.primitiveEvidence?.augmentationDot === true) {
    quarterUnits *= 1.5
    confidence = Math.min(confidence, 0.9)
    source = `${source} and independently attached augmentation dot`
  }

  const tupletMemberships = (indexes.relationsByType.get('tuplet-membership-candidate') ?? [])
    .filter(
      (relation) =>
        relation.from === node?.id &&
        (relation.score ?? 0) >= SOURCE_TEMPORAL_LANE_THRESHOLDS.tupletMembership,
    )
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
  const ratioHints = [...new Set(tupletMemberships
    .map((relation) => indexes.nodesById.get(relation.to)?.ratioHint)
    .filter((value) => [3, 5, 7].includes(value)))]
  let tupletRatio = null
  if (quarterUnits != null && ratioHints.length === 1) {
    const actual = ratioHints[0]
    const normal = actual === 3 ? 2 : 4
    quarterUnits *= normal / actual
    confidence = Math.min(confidence, 0.82)
    tupletRatio = { actual, normal }
    source = `${source} and raw printed ratio-mark ownership`
  } else if (ratioHints.length > 1) {
    alternatives.push(...ratioHints.map((actual) => ({ actual, normal: actual === 3 ? 2 : 4 })))
    confidence = Math.min(confidence, 0.6)
  }

  return {
    nodeId: node?.id ?? null,
    quarterUnits: round(quarterUnits),
    confidence: round(confidence),
    status: quarterUnits != null && confidence >= SOURCE_TEMPORAL_LANE_THRESHOLDS.durationHigh
      ? 'high-confidence'
      : alternatives.length
        ? 'ambiguous'
        : 'low-evidence',
    source,
    alternatives,
    tupletRatio,
  }
}

function inferAttackDurations(attacks, indexes) {
  for (const attack of attacks) {
    const memberEvidence = attack.memberNodes.map((node) => noteDurationEvidence(node, indexes))
    const known = memberEvidence.filter((entry) => entry.quarterUnits != null)
    const distinct = [...new Set(known.map((entry) => entry.quarterUnits))]
    const sharedStemChord = attack.supportingEvidence.some(
      (entry) => entry.kind === 'same-chord-candidate',
    )
    let proposal
    if (distinct.length === 1 && (known.length === memberEvidence.length || sharedStemChord)) {
      const confidence = Math.min(...known.map((entry) => entry.confidence))
      proposal = {
        quarterUnits: distinct[0],
        confidence: round(confidence),
        status: confidence >= SOURCE_TEMPORAL_LANE_THRESHOLDS.durationHigh
          ? 'high-confidence'
          : 'low-evidence',
        tupletRatio: known.find((entry) => entry.tupletRatio)?.tupletRatio ?? null,
        supportingEvidence: memberEvidence,
        contradictoryEvidence: [],
        alternatives: [],
      }
    } else if (distinct.length > 1) {
      proposal = {
        quarterUnits: null,
        confidence: round(Math.max(...known.map((entry) => entry.confidence))),
        status: 'ambiguous',
        tupletRatio: null,
        supportingEvidence: memberEvidence,
        contradictoryEvidence: [{ kind: 'conflicting-written-duration-evidence', values: distinct }],
        alternatives: distinct,
      }
    } else {
      proposal = {
        quarterUnits: null,
        confidence: round(Math.max(0, ...memberEvidence.map((entry) => entry.confidence))),
        status: memberEvidence.some((entry) => entry.alternatives.length) ? 'ambiguous' : 'low-evidence',
        tupletRatio: null,
        supportingEvidence: memberEvidence,
        contradictoryEvidence: [],
        alternatives: memberEvidence.flatMap((entry) => entry.alternatives),
      }
    }
    attack.duration = proposal
    delete attack.memberNodes
  }
}

function attackFeatures(attack, indexes) {
  const memberNodes = attack.memberIds.map((id) => indexes.nodesById.get(id)).filter(Boolean)
  const directions = [...new Set(memberNodes
    .map((node) => node.primitiveEvidence?.stemDirection)
    .filter(Boolean))]
  const staffRoles = [...new Set(memberNodes.map((node) => node.staffRole).filter(Boolean))]
  const beamIds = new Set(memberNodes.flatMap((node) => [...(indexes.beamIdsByNote.get(node.id) ?? [])]))
  return {
    memberNodes,
    directions,
    staffRoles,
    beamIds,
    pitch: median(memberNodes.map((node) => node.pitch?.midi)),
    x: attack.anchor.x,
    y: attack.anchor.y,
  }
}

function typicalAttackGap(attacks) {
  const gaps = []
  const byStaffDirection = new Map()
  for (const attack of attacks) {
    const key = `${attack.features.staffRoles.join('+')}:${attack.features.directions.join('+')}`
    if (!byStaffDirection.has(key)) byStaffDirection.set(key, [])
    byStaffDirection.get(key).push(attack.features.x)
  }
  for (const xs of byStaffDirection.values()) {
    const ordered = [...new Set(xs.filter(Number.isFinite))].sort((left, right) => left - right)
    for (let index = 1; index < ordered.length; index += 1) {
      const gap = ordered[index] - ordered[index - 1]
      if (gap > 0) gaps.push(gap)
    }
  }
  return median(gaps)
}

function weightedComponent(name, value, weight, source, explanation) {
  return { name, value: round(clamp01(value)), weight, source, explanation }
}

function scoreWeightedComponents(components) {
  const weight = components.reduce((sum, entry) => sum + entry.weight, 0)
  if (!(weight > 0)) return 0
  return components.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / weight
}

function buildLaneTransition(left, right, indexes, typicalGap, staffSpace) {
  const dx = right.features.x - left.features.x
  if (!(dx > Math.max(0.5, staffSpace * 0.08))) return null
  if (dx > staffSpace * 12) return null

  const sameStaff = left.features.staffRoles.some((role) => right.features.staffRoles.includes(role))
  const sameDirection =
    left.features.directions.length === 1 &&
    right.features.directions.length === 1 &&
    left.features.directions[0] === right.features.directions[0]
  const opposingDirections =
    left.features.directions.length === 1 &&
    right.features.directions.length === 1 &&
    left.features.directions[0] !== right.features.directions[0]
  const sharedBeam = [...left.features.beamIds].some((id) => right.features.beamIds.has(id))
  const sequential = relationBetween(
    indexes,
    left.memberIds,
    right.memberIds,
    ['sequential-attack-candidate'],
  )
  const crossStaff = relationBetween(
    indexes,
    left.memberIds,
    right.memberIds,
    ['cross-staff-continuation-candidate'],
  )
  const highCrossStaff = (crossStaff?.score ?? 0) >= SOURCE_TEMPORAL_LANE_THRESHOLDS.crossStaffContinuity
  if (!sameStaff && !highCrossStaff) return null
  if (opposingDirections && !highCrossStaff) return null

  const displacedCollisionZone = dx <= staffSpace * 0.82
  const components = []
  if (sequential) {
    components.push(weightedComponent('ordered-source-attack', sequential.score, 0.22, 'sequential attack relation', 'Bounded source-X order supports a successor attack.'))
  }
  if (sharedBeam) {
    components.push(weightedComponent('shared-beam-component', 1, 0.25, 'physical beam ownership', 'Both attacks are owned by the same bounded beam component.'))
  }
  if (left.features.directions.length && right.features.directions.length) {
    components.push(weightedComponent('stem-direction-continuity', sameDirection ? 1 : 0, 0.18, 'primitive stem direction', 'Matching stem direction supports, but does not define, a lane.'))
  }
  if (sameStaff) {
    components.push(weightedComponent('staff-continuity', 1, 0.1, 'source staff ownership', 'The source staff is continuous across attacks.'))
  }
  if (Number.isFinite(left.features.pitch) && Number.isFinite(right.features.pitch)) {
    components.push(weightedComponent('pitch-contour-continuity', 1 - Math.min(1, Math.abs(left.features.pitch - right.features.pitch) / 24), 0.1, 'pre-event staff-position pitch', 'A bounded pitch step supports a continuous written line.'))
  }
  if (Number.isFinite(typicalGap) && typicalGap > 0) {
    components.push(weightedComponent('source-spacing-continuity', 1 - Math.min(1, Math.abs(dx - typicalGap) / typicalGap), 0.15, 'attack anchor spacing', 'The gap matches the measure-local median attack spacing.'))
  } else {
    components.push(weightedComponent('bounded-source-spacing', 1 - Math.min(1, dx / (staffSpace * 12)), 0.1, 'attack anchor spacing', 'The successor lies inside the bounded local search window.'))
  }
  if (highCrossStaff) {
    components.push(weightedComponent('explicit-cross-staff-relation', crossStaff.score, 0.3, 'source relation graph', 'Independent source anchors and pitch continuity permit a staff transition.'))
  }

  const contradictoryEvidence = []
  if (displacedCollisionZone && !sharedBeam && !highCrossStaff) {
    contradictoryEvidence.push({
      kind: 'near-x-chord-displacement-possibility',
      score: 0.7,
      reason: 'The gap is inside the collision-displacement zone without shared-beam evidence.',
    })
  }
  if (opposingDirections) {
    contradictoryEvidence.push({
      kind: 'opposing-stem-directions',
      score: 0.82,
      reason: 'Opposing stems support different lanes unless cross-staff evidence independently overrides.',
    })
  }
  const sourceAmbiguities = ambiguitiesBetween(indexes, left.memberIds, right.memberIds)
  contradictoryEvidence.push(...sourceAmbiguities.map((entry) => compactEvidence(entry, entry.kind)))
  const confidence = scoreWeightedComponents(components)
  const status = contradictoryEvidence.length
    ? 'ambiguous'
    : confidence >= SOURCE_TEMPORAL_LANE_THRESHOLDS.laneTransitionHigh && components.length >= 3
      ? 'high-confidence'
      : confidence >= SOURCE_TEMPORAL_LANE_THRESHOLDS.laneTransitionAmbiguous
        ? 'ambiguous'
        : 'low-evidence'
  return {
    id: `shadow-transition:${left.id}->${right.id}`,
    from: left.id,
    to: right.id,
    confidence: round(confidence),
    status,
    supportingEvidence: components,
    contradictoryEvidence,
    alternatives: status === 'ambiguous' ? ['same-lane-successor', 'independent-lane-or-attack'] : [],
    evidence: {
      dx: round(dx, 2),
      sameStaff,
      sameDirection,
      sharedBeam,
      crossStaff: highCrossStaff,
    },
  }
}

function generateLaneTransitions(attacks, indexes, graph) {
  const eligible = attacks
    .filter((attack) => ['high-confidence', 'relationship-supported'].includes(attack.status))
    .map((attack) => ({ ...attack, features: attackFeatures(attack, indexes) }))
  const typicalGap = typicalAttackGap(eligible)
  const staffSpace = graph?.geometry?.staffSpacePx ?? 8
  const candidates = []
  for (const left of eligible) {
    const later = eligible
      .filter((right) => right.features.x > left.features.x)
      .sort((a, b) => a.features.x - b.features.x || a.features.y - b.features.y)
      .slice(0, MAX_LANE_NEIGHBORS)
    for (const right of later) {
      const candidate = buildLaneTransition(left, right, indexes, typicalGap, staffSpace)
      if (candidate) candidates.push(candidate)
    }
  }

  const alternatives = []
  const eligibleByLeft = new Map()
  for (const candidate of candidates.filter((entry) => entry.status === 'high-confidence')) {
    if (!eligibleByLeft.has(candidate.from)) eligibleByLeft.set(candidate.from, [])
    eligibleByLeft.get(candidate.from).push(candidate)
  }
  const marginAccepted = []
  for (const [from, outgoing] of eligibleByLeft) {
    outgoing.sort((left, right) => right.confidence - left.confidence)
    const best = outgoing[0]
    const runnerUp = outgoing[1]
    if (runnerUp && best.confidence - runnerUp.confidence < SOURCE_TEMPORAL_LANE_THRESHOLDS.laneTransitionMargin) {
      alternatives.push({
        kind: 'ambiguous-lane-successor',
        memberIds: [from, best.to, runnerUp.to],
        confidence: round(best.confidence),
        supportingEvidence: [compactEvidence(best, 'lane-transition'), compactEvidence(runnerUp, 'lane-transition')],
        contradictoryEvidence: [],
        alternatives: outgoing.map((entry) => entry.to),
        resolution: 'preserve-alternatives',
      })
      continue
    }
    marginAccepted.push(best)
  }

  const selected = []
  const usedPredecessor = new Set()
  const usedSuccessor = new Set()
  for (const candidate of marginAccepted.sort((left, right) => right.confidence - left.confidence)) {
    if (usedSuccessor.has(candidate.from) || usedPredecessor.has(candidate.to)) continue
    selected.push(candidate)
    usedSuccessor.add(candidate.from)
    usedPredecessor.add(candidate.to)
  }
  return {
    eligible,
    candidates,
    selected,
    alternatives,
    typicalGap: round(typicalGap, 2),
  }
}

function lanePaths(attacks, selectedTransitions) {
  const byId = new Map(attacks.map((attack) => [attack.id, attack]))
  const next = new Map(selectedTransitions.map((transition) => [transition.from, transition]))
  const previous = new Set(selectedTransitions.map((transition) => transition.to))
  const paths = []
  const visited = new Set()
  for (const attack of attacks) {
    if (previous.has(attack.id) || visited.has(attack.id)) continue
    const attackIds = []
    const transitions = []
    let current = attack.id
    while (current && !visited.has(current)) {
      visited.add(current)
      attackIds.push(current)
      const transition = next.get(current)
      if (!transition) break
      transitions.push(transition)
      current = transition.to
    }
    paths.push({ attackIds, transitions })
  }
  for (const attack of attacks) {
    if (!visited.has(attack.id)) paths.push({ attackIds: [attack.id], transitions: [] })
  }
  return paths.map((path) => ({
    ...path,
    attacks: path.attackIds.map((id) => byId.get(id)).filter(Boolean),
  }))
}

function hasRelationForMembers(indexes, type, memberIds) {
  return (indexes.relationsByType.get(type) ?? []).some(
    (relation) => memberIds.includes(relation.from) || memberIds.includes(relation.to),
  )
}

function buildLanes(attacks, transitionResult, graph, indexes) {
  const meter = meterCapacity(graph)
  const paths = lanePaths(
    attacks.filter((attack) => ['high-confidence', 'relationship-supported'].includes(attack.status)),
    transitionResult.selected,
  )
  const lanes = paths.map((path, index) => {
    const durationValues = path.attacks.map((attack) => attack.duration?.quarterUnits)
    const completeDuration = durationValues.every(Number.isFinite)
    const totalQuarterUnits = completeDuration
      ? durationValues.reduce((sum, value) => sum + value, 0)
      : null
    const memberIds = path.attacks.flatMap((attack) => attack.memberIds)
    const permitsOverflow = (indexes.relationsByType.get('tie-continuation-candidate') ?? []).some(
      (relation) =>
        (memberIds.includes(relation.from) || memberIds.includes(relation.to)) &&
        (relation.score ?? 0) >= SOURCE_TEMPORAL_LANE_THRESHOLDS.sharedHeadRole,
    )
    const overflow = Number.isFinite(totalQuarterUnits) && Number.isFinite(meter.quarterUnits)
      ? totalQuarterUnits - meter.quarterUnits
      : null
    const impossibleCapacity =
      Number.isFinite(overflow) &&
      overflow > SOURCE_TEMPORAL_LANE_THRESHOLDS.capacityToleranceQuarterUnits &&
      !permitsOverflow
    const transitionConfidence = path.transitions.length
      ? Math.min(...path.transitions.map((entry) => entry.confidence))
      : null
    const attackConfidence = Math.min(...path.attacks.map((entry) => entry.confidence))
    const durationConfidence = completeDuration
      ? Math.min(...path.attacks.map((entry) => entry.duration?.confidence ?? 0))
      : 0
    const confidence = path.attacks.length === 1
      ? Math.min(attackConfidence, durationConfidence)
      : Math.min(attackConfidence, durationConfidence, transitionConfidence ?? 0)
    const status = impossibleCapacity
      ? 'rejected'
      : !completeDuration
        ? 'partial'
        : path.attacks.length === 1 && attacks.length > 1 && durationValues[0] < 2
          ? 'partial'
          : confidence >= SOURCE_TEMPORAL_LANE_THRESHOLDS.laneTransitionHigh
            ? 'high-confidence'
            : 'partial'
    const staffRoles = [...new Set(path.attacks.flatMap((attack) =>
      attack.memberIds.map((id) => indexes.nodesById.get(id)?.staffRole).filter(Boolean),
    ))]
    const crossStaff = staffRoles.length > 1 || path.transitions.some((entry) => entry.evidence.crossStaff)
    const capacity = {
      meter,
      proposedQuarterUnits: round(totalQuarterUnits),
      overflowQuarterUnits: round(Math.max(0, overflow ?? 0)),
      underfillQuarterUnits: round(
        Number.isFinite(totalQuarterUnits) && Number.isFinite(meter.quarterUnits)
          ? Math.max(0, meter.quarterUnits - totalQuarterUnits)
          : null,
      ),
      status: impossibleCapacity
        ? 'impossible-without-independent-exception-evidence'
        : !completeDuration || !Number.isFinite(meter.quarterUnits)
          ? 'unresolved'
          : Math.abs(overflow) <= SOURCE_TEMPORAL_LANE_THRESHOLDS.capacityToleranceQuarterUnits
            ? 'balanced'
            : overflow < 0
              ? 'underfilled-preserve-pickup-or-rest-alternatives'
              : 'overflow-supported-by-independent-evidence',
      permitsOverflow,
    }
    return {
      id: `shadow-lane:${index + 1}`,
      attackIds: path.attackIds,
      memberIds,
      confidence: round(confidence),
      status,
      staffRoles,
      crossStaff,
      transitions: path.transitions,
      capacity,
      supportingEvidence: path.transitions.flatMap((entry) => entry.supportingEvidence),
      contradictoryEvidence: [
        ...(impossibleCapacity
          ? [{ kind: 'impossible-rhythmic-capacity', overflowQuarterUnits: round(overflow) }]
          : []),
      ],
      alternatives: capacity.status === 'underfilled-preserve-pickup-or-rest-alternatives'
        ? ['pickup-or-underfilled-source', 'structural-rest-if-source-gap-supports-it']
        : [],
    }
  })
  return { lanes, meter }
}

function buildRestProposals(graph, lanes) {
  const proposals = []
  const ambiguities = []
  for (const node of (graph?.nodes ?? []).filter((entry) => entry.kind === 'rest')) {
    const quarterUnits = restQuarterUnits(node.glyphClass)
    const confidence = quarterUnits == null ? 0.6 : 0.84
    const compatibleLanes = lanes.filter(
      (lane) => lane.staffRoles.includes(node.staffRole) && lane.status !== 'rejected',
    )
    const laneId = compatibleLanes.length === 1 ? compatibleLanes[0].id : null
    const resolvedEventLanes = compatibleLanes.filter(
      (lane) => lane.eventProposal?.status === 'high-confidence',
    )
    const status =
      confidence >= SOURCE_TEMPORAL_LANE_THRESHOLDS.explicitRest &&
      resolvedEventLanes.length === 1
      ? 'high-confidence'
      : 'ambiguous'
    proposals.push({
      id: `shadow-rest:${proposals.length + 1}`,
      class: 'EXPLICIT_SOURCE_REST',
      sourceNodeId: node.id,
      laneId: status === 'high-confidence' ? resolvedEventLanes[0].id : laneId,
      quarterUnits: round(quarterUnits),
      positionInMeasure: node.anchor?.positionInMeasure ?? null,
      confidence: round(confidence),
      status,
      supportingEvidence: [{ kind: 'physical-rest-glyph', source: node.source, glyphClass: node.glyphClass }],
      contradictoryEvidence: resolvedEventLanes.length !== 1
        ? [{
            kind: 'rest-lane-onset-unresolved',
            laneIds: compatibleLanes.map((lane) => lane.id),
          }]
        : [],
      alternatives: status === 'high-confidence'
        ? []
        : compatibleLanes.length
          ? compatibleLanes.map((lane) => lane.id)
          : ['physical-rest-present-without-resolved-temporal-lane'],
    })
  }

  for (const evidence of (graph?.laneEvidence ?? []).filter(
    (entry) => entry.kind === 'structural-gap-candidate',
  )) {
    const compatibleLanes = lanes.filter((lane) =>
      (evidence.memberIds ?? []).every((id) => lane.memberIds.includes(id)),
    )
    const duration = Number(evidence.evidence?.quarterUnits)
    const high =
      (evidence.score ?? 0) >= SOURCE_TEMPORAL_LANE_THRESHOLDS.inferredRest &&
      compatibleLanes.length === 1 &&
      Number.isFinite(duration) &&
      duration > 0
    const proposal = {
      id: `shadow-rest:${proposals.length + 1}`,
      class: 'STRUCTURAL_INFERRED_REST',
      sourceNodeId: null,
      laneId: high ? compatibleLanes[0].id : null,
      quarterUnits: high ? round(duration) : null,
      positionInMeasure: evidence.evidence?.positionInMeasure ?? null,
      confidence: round(evidence.score),
      status: high ? 'high-confidence' : 'ambiguous',
      supportingEvidence: [compactEvidence(evidence)],
      contradictoryEvidence: high ? [] : [{ kind: 'lane-or-duration-not-independently-resolved' }],
      alternatives: high ? [] : ['preserve-gap', 'possible-structural-rest'],
    }
    proposals.push(proposal)
    if (!high) ambiguities.push({
      kind: 'structural-rest-evidence-incomplete',
      memberIds: evidence.memberIds ?? [],
      confidence: round(evidence.score),
      supportingEvidence: [compactEvidence(evidence)],
      contradictoryEvidence: proposal.contradictoryEvidence,
      alternatives: proposal.alternatives,
      resolution: 'preserve-alternatives',
    })
  }
  return { proposals, ambiguities }
}

function buildSharedHeadRoles(graph, indexes) {
  const roles = []
  const ambiguities = []
  for (const relation of indexes.relationsByType.get('shared-head-role-candidate') ?? []) {
    const samePhysicalHead = relation.from === relation.to
    const node = indexes.nodesById.get(relation.from)
    const strongStemOwners = (indexes.stemOwnersByNote.get(node?.id) ?? []).filter(
      (owner) => (owner.score ?? 0) >= SOURCE_TEMPORAL_LANE_THRESHOLDS.physicalOwnership,
    )
    const ownerDirections = [...new Set(strongStemOwners
      .map((owner) => indexes.nodesById.get(owner.from)?.direction)
      .filter(Boolean))]
    const independentOwnerPaths = new Set(strongStemOwners.map((owner) => owner.from)).size >= 2 &&
      ownerDirections.length >= 2
    const hasAttackEvidence =
      (node?.primitiveEvidence?.beamCount ?? 0) > 0 ||
      (node?.primitiveEvidence?.beamStrength ?? 0) >= 8
    const hasSustainEvidence =
      node?.glyph?.open === true || node?.primitiveEvidence?.augmentationDot === true
    const directIndependentEvidence =
      samePhysicalHead &&
      independentOwnerPaths &&
      hasAttackEvidence &&
      hasSustainEvidence
    const high =
      directIndependentEvidence &&
      (relation.score ?? 0) >= SOURCE_TEMPORAL_LANE_THRESHOLDS.sharedHeadRole
    const role = {
      id: `shadow-shared-role:${roles.length + 1}`,
      physicalHeadId: samePhysicalHead ? relation.from : null,
      semanticRoles: high ? ['attack', 'sustain'] : [],
      confidence: round(relation.score),
      status: high ? 'high-confidence' : 'ambiguous',
      supportingEvidence: [compactEvidence(relation)],
      contradictoryEvidence: directIndependentEvidence
        ? []
        : [{ kind: 'missing-second-independent-physical-ownership-path' }],
      alternatives: high ? [] : ['single-written-role', 'attack-plus-sustain-roles'],
    }
    roles.push(role)
    if (!high) ambiguities.push({
      kind: 'shared-head-role-unresolved',
      memberIds: [relation.from, relation.to],
      confidence: round(relation.score),
      supportingEvidence: role.supportingEvidence,
      contradictoryEvidence: role.contradictoryEvidence,
      alternatives: role.alternatives,
      resolution: 'preserve-alternatives',
    })
  }
  return { roles, ambiguities }
}

function buildCrossStaffContinuities(indexes, lanes) {
  const proposals = []
  const ambiguities = []
  for (const relation of indexes.relationsByType.get('cross-staff-continuation-candidate') ?? []) {
    const lane = lanes.find(
      (entry) => entry.memberIds.includes(relation.from) && entry.memberIds.includes(relation.to),
    )
    const high =
      (relation.score ?? 0) >= SOURCE_TEMPORAL_LANE_THRESHOLDS.crossStaffContinuity &&
      lane?.status === 'high-confidence' &&
      lane.crossStaff
    const proposal = {
      id: `shadow-cross-staff:${proposals.length + 1}`,
      memberIds: [relation.from, relation.to],
      laneId: high ? lane.id : null,
      confidence: round(relation.score),
      status: high ? 'high-confidence' : 'ambiguous',
      supportingEvidence: [compactEvidence(relation)],
      contradictoryEvidence: high ? [] : [{ kind: 'no-high-confidence-cross-staff-lane-path' }],
      alternatives: high ? [] : ['simultaneous-cross-staff-attack', 'lane-continuation', 'independent-staff-events'],
    }
    proposals.push(proposal)
    if (!high && (relation.score ?? 0) >= SOURCE_TEMPORAL_LANE_THRESHOLDS.laneTransitionAmbiguous) {
      ambiguities.push({
        kind: 'cross-staff-role-unresolved',
        memberIds: proposal.memberIds,
        confidence: proposal.confidence,
        supportingEvidence: proposal.supportingEvidence,
        contradictoryEvidence: proposal.contradictoryEvidence,
        alternatives: proposal.alternatives,
        resolution: 'preserve-alternatives',
      })
    }
  }
  return { proposals, ambiguities }
}

function buildSustainRelationships(attacks, lanes, indexes) {
  const byAttack = new Map(attacks.map((attack) => [attack.id, attack]))
  const relationships = []
  const highLanes = lanes.filter((lane) => lane.status === 'high-confidence')
  for (const sustainLane of highLanes) {
    for (const attackId of sustainLane.attackIds) {
      const sustainAttack = byAttack.get(attackId)
      if (!(sustainAttack?.duration?.quarterUnits >= 2)) continue
      for (const movingLane of highLanes) {
        if (movingLane.id === sustainLane.id || movingLane.attackIds.length < 2) continue
        const movingAttacks = movingLane.attackIds.map((id) => byAttack.get(id)).filter(Boolean)
        const laterShortAttacks = movingAttacks.filter(
          (attack) =>
            attack.anchor.x >= sustainAttack.anchor.x &&
            (attack.duration?.quarterUnits ?? Infinity) < sustainAttack.duration.quarterUnits,
        )
        if (laterShortAttacks.length < 2) continue
        const sameStaff = sustainLane.staffRoles.some((role) => movingLane.staffRoles.includes(role))
        const explicitCrossStaff = relationBetween(
          indexes,
          sustainAttack.memberIds,
          laterShortAttacks.flatMap((attack) => attack.memberIds),
          ['cross-staff-continuation-candidate'],
        )
        if (!sameStaff && (explicitCrossStaff?.score ?? 0) < SOURCE_TEMPORAL_LANE_THRESHOLDS.crossStaffContinuity) continue
        relationships.push({
          id: `shadow-sustain-moving:${relationships.length + 1}`,
          sustainAttackId: sustainAttack.id,
          sustainLaneId: sustainLane.id,
          movingLaneId: movingLane.id,
          movingAttackIds: laterShortAttacks.map((attack) => attack.id),
          confidence: round(Math.min(sustainLane.confidence, movingLane.confidence, sustainAttack.duration.confidence)),
          status: 'high-confidence',
          supportingEvidence: [
            { kind: 'independent-long-written-value', quarterUnits: sustainAttack.duration.quarterUnits },
            { kind: 'independent-moving-lane', attackCount: laterShortAttacks.length },
          ],
          contradictoryEvidence: [],
          alternatives: [],
        })
      }
    }
  }
  return relationships
}

function laneFeatureKey(attack, indexes) {
  const features = attackFeatures(attack, indexes)
  return `${features.staffRoles.slice().sort().join('+')}|${features.directions.slice().sort().join('+')}`
}

function proposedEvents(attacks, lanes, indexes, transitionResult, graph) {
  const byAttack = new Map(attacks.map((attack) => [attack.id, attack]))
  const highAttacksByFeature = new Map()
  for (const attack of attacks.filter((entry) => entry.status === 'high-confidence')) {
    const key = laneFeatureKey(attack, indexes)
    if (!highAttacksByFeature.has(key)) highAttacksByFeature.set(key, [])
    highAttacksByFeature.get(key).push(attack)
  }
  const ambiguousTransitionMembers = new Set(
    (transitionResult?.alternatives ?? []).flatMap((entry) => entry.memberIds ?? []),
  )
  const events = []
  for (const lane of lanes) {
    const laneAttacks = lane.attackIds.map((id) => byAttack.get(id)).filter(Boolean)
    const featureKeys = [...new Set(laneAttacks.map((attack) => laneFeatureKey(attack, indexes)))]
    const matchingFeatureAttacks = featureKeys.length === 1
      ? highAttacksByFeature.get(featureKeys[0]) ?? []
      : []
    const laneAttackSet = new Set(lane.attackIds)
    const reasons = []
    if (lane.status !== 'high-confidence') reasons.push('lane-path-not-high-confidence')
    if (!['balanced', 'overflow-supported-by-independent-evidence'].includes(lane.capacity?.status)) {
      reasons.push('measure-capacity-does-not-anchor-onset-zero')
    }
    if (featureKeys.length !== 1) reasons.push('cross-staff-or-mixed-direction-event-origin-unresolved')
    if (matchingFeatureAttacks.some((attack) => !laneAttackSet.has(attack.id))) {
      reasons.push('lane-does-not-cover-complete-source-feature-component')
    }
    if (laneAttacks.some((attack) => attack.duration?.status !== 'high-confidence')) {
      reasons.push('written-duration-unresolved')
    }
    if (laneAttacks.some((attack) => attack.contradictoryEvidence?.length)) {
      reasons.push('attack-interpretation-still-contradictory')
    }
    if (lane.attackIds.some((id) => ambiguousTransitionMembers.has(id))) {
      reasons.push('competing-lane-successor-preserved')
    }
    if (laneAttacks.length > 1 && lane.transitions.length !== laneAttacks.length - 1) {
      reasons.push('lane-path-not-contiguous')
    }
    const sourceNoteheadIds = (graph?.nodes ?? [])
      .filter((node) => node.kind === 'notehead')
      .map((node) => node.id)
    if (sourceNoteheadIds.some((id) => !lane.memberIds.includes(id))) {
      reasons.push('measure-has-additional-physical-noteheads-outside-lane')
    }
    if ((graph?.ambiguities?.length ?? 0) > 0) reasons.push('measure-has-unresolved-source-relation-ambiguity')
    if ((graph?.nodes ?? []).some((node) => node.kind === 'rest')) reasons.push('rest-bearing-lane-origin-unresolved')
    if ((indexes.relationsByType.get('shared-head-role-candidate') ?? []).length) {
      reasons.push('shared-head-role-candidate-preserved')
    }
    if ((indexes.relationsByType.get('cross-staff-continuation-candidate') ?? []).length) {
      reasons.push('cross-staff-origin-preserved')
    }
    lane.eventProposal = {
      status: reasons.length ? 'abstained' : 'high-confidence',
      reasons,
      rationale: reasons.length
        ? 'Relationship evidence is retained, but absolute event onsets are not claimed.'
        : 'A complete single-feature lane balances the independently read meter from source onset zero.',
    }
    if (reasons.length) continue
    let onsetQuarterUnits = 0
    for (const attackId of lane.attackIds) {
      const attack = byAttack.get(attackId)
      events.push({
        id: `shadow-event:${events.length + 1}`,
        attackId,
        laneId: lane.id,
        memberIds: attack.memberIds,
        pitches: attack.memberIds.map((id) => indexes.nodesById.get(id)?.pitch?.midi).filter(Number.isFinite),
        onsetQuarterUnits: round(onsetQuarterUnits),
        durationQuarterUnits: attack.duration.quarterUnits,
        tupletRatio: attack.duration.tupletRatio,
        confidence: round(Math.min(attack.confidence, attack.duration.confidence, lane.confidence)),
        provenance: {
          attack: 'source-relation-graph',
          lane: 'bounded-source-transition-path',
          duration: attack.duration.supportingEvidence.map((entry) => entry.source).filter(Boolean),
        },
      })
      onsetQuarterUnits += attack.duration.quarterUnits
    }
  }
  return events
}

function buildAbstentions(attacks, lanes, restProposals, sharedRoles, crossStaff, transitionResult) {
  const abstentions = []
  for (const attack of attacks.filter((entry) => entry.status !== 'high-confidence')) {
    abstentions.push({
      kind: 'attack-group',
      entityId: attack.id,
      reason: attack.status === 'ambiguous' ? 'conflicting-source-attack-evidence' : 'insufficient-physical-ownership-evidence',
      alternatives: attack.alternatives,
    })
  }
  for (const lane of lanes.filter((entry) => entry.status !== 'high-confidence')) {
    abstentions.push({
      kind: 'temporal-lane',
      entityId: lane.id,
      reason: lane.status === 'rejected' ? 'impossible-rhythmic-capacity' : 'incomplete-or-ambiguous-lane-path',
      alternatives: lane.alternatives,
    })
  }
  for (const lane of lanes.filter(
    (entry) => entry.status === 'high-confidence' && entry.eventProposal?.status !== 'high-confidence',
  )) {
    abstentions.push({
      kind: 'musical-events',
      entityId: lane.id,
      reason: 'absolute-onset-or-complete-lane-origin-unresolved',
      alternatives: lane.eventProposal?.reasons ?? [],
    })
  }
  for (const rest of restProposals.filter((entry) => entry.status !== 'high-confidence')) {
    abstentions.push({ kind: 'rest', entityId: rest.id, reason: 'rest-lane-or-duration-unresolved', alternatives: rest.alternatives })
  }
  for (const role of sharedRoles.filter((entry) => entry.status !== 'high-confidence')) {
    abstentions.push({ kind: 'shared-head-role', entityId: role.id, reason: 'independent-multi-role-evidence-incomplete', alternatives: role.alternatives })
  }
  for (const proposal of crossStaff.filter((entry) => entry.status !== 'high-confidence')) {
    abstentions.push({ kind: 'cross-staff-continuation', entityId: proposal.id, reason: 'cross-staff-lane-path-unresolved', alternatives: proposal.alternatives })
  }
  for (const transition of transitionResult.candidates.filter((entry) => entry.status === 'ambiguous')) {
    abstentions.push({ kind: 'lane-transition', entityId: transition.id, reason: 'competing-lane-transition-evidence', alternatives: transition.alternatives })
  }
  return abstentions
}

export function solveSourceTemporalLanes(graph = null) {
  const started = globalThis.performance?.now?.() ?? Date.now()
  if (!graph || graph.stage !== 'pre-event-source-primitives') {
    return {
      version: SOLVER_VERSION,
      stage: 'pre-event-shadow-constraint-solver',
      mode: 'independent-shadow-proposal',
      sourceGraphVersion: graph?.version ?? null,
      scope: graph?.scope ?? null,
      independence: {
        readsProductionVoiceIds: false,
        readsProductionChordLabels: false,
        readsFinalOnsets: false,
        readsTopologyFamilies: false,
        readsGeneratedMusicXml: false,
        readsTruthOrEvaluator: false,
        usesScopeIdentityInDecisions: false,
      },
      thresholds: SOURCE_TEMPORAL_LANE_THRESHOLDS,
      attacks: [],
      lanes: [],
      sustainRelationships: [],
      rests: [],
      sharedHeadRoles: [],
      crossStaffContinuities: [],
      proposedEvents: [],
      ambiguities: [],
      abstentions: [{ kind: 'graph', entityId: null, reason: 'missing-or-invalid-source-relation-graph', alternatives: [] }],
      diagnostics: {
        attacks: 0,
        highConfidenceAttacks: 0,
        lanes: 0,
        highConfidenceLanes: 0,
        proposedEvents: 0,
        ambiguities: 0,
        abstentions: 1,
        peakHypotheses: 0,
        solverMs: round((globalThis.performance?.now?.() ?? Date.now()) - started, 3),
      },
    }
  }

  const indexes = graphIndexes(graph)
  const attackResult = buildAttackGroups(graph, indexes)
  const opposingColumnResolvedAttacks = resolveRepeatedOpposingLaneColumns(
    attackResult.attacks,
    graph,
    indexes,
  )
  const uniformSequenceResolvedAttacks = resolveUniformSingletonSequences(
    attackResult.attacks,
    graph,
    indexes,
  )
  const contextResolvedAttacks = opposingColumnResolvedAttacks + uniformSequenceResolvedAttacks
  inferAttackDurations(attackResult.attacks, indexes)
  const transitionResult = generateLaneTransitions(attackResult.attacks, indexes, graph)
  const laneResult = buildLanes(attackResult.attacks, transitionResult, graph, indexes)
  const sharedResult = buildSharedHeadRoles(graph, indexes)
  const events = proposedEvents(
    attackResult.attacks,
    laneResult.lanes,
    indexes,
    transitionResult,
    graph,
  )
  const eventAttackIds = new Set(events.map((event) => event.attackId))
  for (const attack of attackResult.attacks) {
    if (!eventAttackIds.has(attack.id)) continue
    attack.status = 'high-confidence'
    attack.confidence = round(Math.max(attack.confidence, SOURCE_TEMPORAL_LANE_THRESHOLDS.attackSemanticHigh))
  }
  const restResult = buildRestProposals(graph, laneResult.lanes)
  const crossStaffResult = buildCrossStaffContinuities(indexes, laneResult.lanes)
  const sustainRelationships = buildSustainRelationships(
    attackResult.attacks,
    laneResult.lanes,
    indexes,
  )
  const ambiguities = [
    ...attackResult.crossStaffAlternatives,
    ...transitionResult.alternatives,
    ...restResult.ambiguities,
    ...sharedResult.ambiguities,
    ...crossStaffResult.ambiguities,
  ].map((entry, index) => ({ id: `shadow-ambiguity:${index + 1}`, ...entry }))
  const abstentions = buildAbstentions(
    attackResult.attacks,
    laneResult.lanes,
    restResult.proposals,
    sharedResult.roles,
    crossStaffResult.proposals,
    transitionResult,
  )
  const elapsed = (globalThis.performance?.now?.() ?? Date.now()) - started
  return {
    version: SOLVER_VERSION,
    stage: 'pre-event-shadow-constraint-solver',
    mode: 'independent-shadow-proposal',
    sourceGraphVersion: graph.version,
    scope: graph.scope,
    independence: {
      readsProductionVoiceIds: false,
      readsProductionChordLabels: false,
      readsFinalOnsets: false,
      readsTopologyFamilies: false,
      readsGeneratedMusicXml: false,
      readsTruthOrEvaluator: false,
      usesScopeIdentityInDecisions: false,
    },
    thresholds: SOURCE_TEMPORAL_LANE_THRESHOLDS,
    meter: laneResult.meter,
    attacks: attackResult.attacks,
    lanes: laneResult.lanes,
    sustainRelationships,
    rests: restResult.proposals,
    sharedHeadRoles: sharedResult.roles,
    crossStaffContinuities: crossStaffResult.proposals,
    proposedEvents: events,
    ambiguities,
    abstentions,
    diagnostics: {
      attacks: attackResult.attacks.length,
      highConfidenceAttacks: attackResult.attacks.filter((entry) => entry.status === 'high-confidence').length,
      relationshipSupportedAttacks: attackResult.attacks.filter(
        (entry) => entry.status === 'relationship-supported',
      ).length,
      ambiguousAttacks: attackResult.attacks.filter((entry) => entry.status === 'ambiguous').length,
      lanes: laneResult.lanes.length,
      highConfidenceLanes: laneResult.lanes.filter((entry) => entry.status === 'high-confidence').length,
      partialLanes: laneResult.lanes.filter((entry) => entry.status === 'partial').length,
      rejectedLanes: laneResult.lanes.filter((entry) => entry.status === 'rejected').length,
      proposedEvents: events.length,
      highConfidenceEventLanes: laneResult.lanes.filter(
        (entry) => entry.eventProposal?.status === 'high-confidence',
      ).length,
      rests: restResult.proposals.length,
      sharedHeadRoles: sharedResult.roles.length,
      crossStaffContinuities: crossStaffResult.proposals.length,
      sustainRelationships: sustainRelationships.length,
      ambiguities: ambiguities.length,
      abstentions: abstentions.length,
      candidateTransitions: transitionResult.candidates.length,
      selectedTransitions: transitionResult.selected.length,
      contextResolvedAttacks,
      typicalAttackGapPx: transitionResult.typicalGap,
      peakHypotheses: attackResult.attacks.length + transitionResult.candidates.length,
      solverMs: round(elapsed, 3),
    },
  }
}

export function summarizeSourceTemporalLaneSolution(solution) {
  return {
    version: solution?.version ?? SOLVER_VERSION,
    measureCount: solution ? 1 : 0,
    attacks: solution?.diagnostics?.attacks ?? 0,
    highConfidenceAttacks: solution?.diagnostics?.highConfidenceAttacks ?? 0,
    relationshipSupportedAttacks: solution?.diagnostics?.relationshipSupportedAttacks ?? 0,
    ambiguousAttacks: solution?.diagnostics?.ambiguousAttacks ?? 0,
    lanes: solution?.diagnostics?.lanes ?? 0,
    highConfidenceLanes: solution?.diagnostics?.highConfidenceLanes ?? 0,
    partialLanes: solution?.diagnostics?.partialLanes ?? 0,
    rejectedLanes: solution?.diagnostics?.rejectedLanes ?? 0,
    proposedEvents: solution?.diagnostics?.proposedEvents ?? 0,
    highConfidenceEventLanes: solution?.diagnostics?.highConfidenceEventLanes ?? 0,
    rests: solution?.diagnostics?.rests ?? 0,
    sharedHeadRoles: solution?.diagnostics?.sharedHeadRoles ?? 0,
    crossStaffContinuities: solution?.diagnostics?.crossStaffContinuities ?? 0,
    sustainRelationships: solution?.diagnostics?.sustainRelationships ?? 0,
    ambiguities: solution?.diagnostics?.ambiguities ?? 0,
    abstentions: solution?.diagnostics?.abstentions ?? 0,
    candidateTransitions: solution?.diagnostics?.candidateTransitions ?? 0,
    selectedTransitions: solution?.diagnostics?.selectedTransitions ?? 0,
    peakHypotheses: solution?.diagnostics?.peakHypotheses ?? 0,
    solverMs: solution?.diagnostics?.solverMs ?? 0,
  }
}

export function aggregateSourceTemporalLaneSolutions(pages = []) {
  const total = {
    version: SOLVER_VERSION,
    measureCount: 0,
    attacks: 0,
    highConfidenceAttacks: 0,
    relationshipSupportedAttacks: 0,
    ambiguousAttacks: 0,
    lanes: 0,
    highConfidenceLanes: 0,
    partialLanes: 0,
    rejectedLanes: 0,
    proposedEvents: 0,
    highConfidenceEventLanes: 0,
    rests: 0,
    sharedHeadRoles: 0,
    crossStaffContinuities: 0,
    sustainRelationships: 0,
    ambiguities: 0,
    abstentions: 0,
    candidateTransitions: 0,
    selectedTransitions: 0,
    peakHypotheses: 0,
    maxMeasureHypotheses: 0,
    maxMeasureSolverMs: 0,
    solverMs: 0,
  }
  const additive = [
    'attacks',
    'highConfidenceAttacks',
    'relationshipSupportedAttacks',
    'ambiguousAttacks',
    'lanes',
    'highConfidenceLanes',
    'partialLanes',
    'rejectedLanes',
    'proposedEvents',
    'highConfidenceEventLanes',
    'rests',
    'sharedHeadRoles',
    'crossStaffContinuities',
    'sustainRelationships',
    'ambiguities',
    'abstentions',
    'candidateTransitions',
    'selectedTransitions',
  ]
  for (const page of pages ?? []) {
    for (const system of page.systems ?? []) {
      for (const measure of system.measures ?? []) {
        if (!measure.sourceTemporalLaneSolution) continue
        const summary = summarizeSourceTemporalLaneSolution(measure.sourceTemporalLaneSolution)
        total.measureCount += 1
        for (const key of additive) total[key] += summary[key]
        total.solverMs += summary.solverMs
        total.peakHypotheses = Math.max(total.peakHypotheses, summary.peakHypotheses)
        total.maxMeasureHypotheses = Math.max(total.maxMeasureHypotheses, summary.peakHypotheses)
        total.maxMeasureSolverMs = Math.max(total.maxMeasureSolverMs, summary.solverMs)
      }
    }
  }
  total.solverMs = round(total.solverMs, 3)
  total.maxMeasureSolverMs = round(total.maxMeasureSolverMs, 3)
  total.highConfidenceAttackRate = total.attacks
    ? round(total.highConfidenceAttacks / total.attacks)
    : 0
  total.highConfidenceLaneRate = total.lanes
    ? round(total.highConfidenceLanes / total.lanes)
    : 0
  total.display = [
    `SHADOW ATTACKS ${total.highConfidenceAttacks}/${total.attacks}`,
    `SHADOW LANES ${total.highConfidenceLanes}/${total.lanes}`,
    `SHADOW EVENTS ${total.proposedEvents}`,
    `ABSTENTIONS ${total.abstentions}`,
  ]
  return total
}
