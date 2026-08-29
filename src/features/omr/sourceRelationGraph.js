const GRAPH_VERSION = 1
const DEFAULT_STAFF_SPACE_PX = 8
const MAX_BUCKET_NEIGHBORS = 3
const MAX_ORDERED_NEIGHBORS = 4

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function staffRole(note) {
  return note?.pitchMapping?.staffRole ?? (note?.clef === 'bass' ? 'lower' : 'upper')
}

function stemDirection(note) {
  if (typeof note?.stem === 'string') return note.stem
  return note?.stem?.direction ?? note?.stemDirection ?? null
}

function staffSpacePx(notes, measureBox, imageData) {
  const lineGaps = []
  for (const lines of Object.values(measureBox?.staffLines ?? {})) {
    if (!Array.isArray(lines)) continue
    const ordered = [...lines].filter(Number.isFinite).sort((left, right) => left - right)
    for (let index = 1; index < ordered.length; index += 1) {
      const gap = ordered[index] - ordered[index - 1]
      if (gap > 0) lineGaps.push(gap * (imageData?.height ?? 1))
    }
  }
  const normalizedGap = median(lineGaps)
  if (normalizedGap > 2) return normalizedGap
  const stemGaps = notes
    .map((note) => Number(note?.stem?.length))
    .filter((length) => length > 0)
    .map((length) => length / 4)
  return median(stemGaps) ?? DEFAULT_STAFF_SPACE_PX
}

function sourceRef(note, index) {
  return (
    note?.sourcePathId ??
    note?.glyphId ??
    note?.noteheadAnchor?.candidateId ??
    note?.noteheadAnchor?.sourcePathId ??
    `detected-note-${index + 1}`
  )
}

function noteId(scope, note, index) {
  const x = Math.round(note?.cx ?? 0)
  const y = Math.round(note?.cy ?? 0)
  return `${scope}:notehead:${index + 1}:${x}:${y}`
}

function relationId(scope, type, index) {
  return `${scope}:relation:${type}:${index + 1}`
}

function component(name, value, weight, source, explanation) {
  const normalized = clamp01(value)
  return {
    name,
    value: round(normalized),
    weight: round(weight),
    contribution: round(normalized * weight),
    source,
    explanation,
  }
}

function scoreComponents(components) {
  const weight = components.reduce((sum, entry) => sum + entry.weight, 0)
  if (!(weight > 0)) return 0
  return round(
    components.reduce((sum, entry) => sum + entry.contribution, 0) / weight,
  )
}

function relationStatus(score) {
  if (score >= 0.78) return 'strong-candidate'
  if (score >= 0.42) return 'candidate'
  return 'weak-candidate'
}

function physicalNoteheadNode(scope, note, index) {
  return {
    id: noteId(scope, note, index),
    kind: 'notehead',
    sourceRef: sourceRef(note, index),
    source: note?.source ?? 'unknown',
    anchor: {
      x: round(note?.cx, 2),
      y: round(note?.cy, 2),
      xNorm: round(note?.xNorm),
      yNorm: round(note?.yNorm),
    },
    staffRole: staffRole(note),
    clef: note?.clef ?? null,
    staffPosition: Number.isFinite(note?.pitchMapping?.staffStep)
      ? note.pitchMapping.staffStep
      : Number.isFinite(note?.pitchMapping?.position)
        ? note.pitchMapping.position
        : null,
    pitch: {
      naturalMidi: note?.naturalMidi ?? null,
      midi: note?.midi ?? null,
      alter: note?.alter ?? 0,
      confidence: round(note?.pitchConfidence),
    },
    glyph: {
      class: note?.noteheadGlyph ?? (note?.hollowGlyph ? 'open' : 'filled'),
      open: note?.hollowGlyph === true || note?.hollow === true,
      fontName: note?.noteheadFont?.fontName ?? null,
      glyph: note?.noteheadFont?.glyph ?? null,
    },
    primitiveEvidence: {
      stemDirection: stemDirection(note),
      beamCount: note?.beams ?? 0,
      beamStrength: round(note?.beamStrength ?? 0, 2),
      augmentationDot: note?.dotted === true,
      accidental: note?.accidental?.type ?? null,
    },
  }
}

function stemKey(note, staffSpace) {
  const stem = note?.stem
  if (!stem) return null
  const direction = stemDirection(note) ?? 'unknown'
  const x = Number.isFinite(stem?.x)
    ? stem.x
    : (note?.cx ?? 0) + (direction === 'down' ? -staffSpace * 0.45 : staffSpace * 0.45)
  const tipY = Number.isFinite(stem?.tipY)
    ? stem.tipY
    : (note?.cy ?? 0) + (direction === 'down' ? 4 : -4) * staffSpace
  return {
    direction,
    x,
    tipY,
    key: `${staffRole(note)}:${direction}:${Math.round(x / Math.max(1, staffSpace * 0.3))}:${Math.round(tipY / Math.max(1, staffSpace * 0.6))}`,
  }
}

function buildStemNodes(scope, notes, noteNodes, staffSpace, relations) {
  const byKey = new Map()
  notes.forEach((note, index) => {
    const stem = stemKey(note, staffSpace)
    if (!stem) return
    let node = byKey.get(stem.key)
    if (!node) {
      node = {
        id: `${scope}:stem:${byKey.size + 1}`,
        kind: 'stem',
        source: note?.stem?.source ?? 'notehead-rhythm-probe',
        staffRole: staffRole(note),
        direction: stem.direction,
        anchor: {
          x: round(stem.x, 2),
          y0: round(Math.min(note?.cy ?? stem.tipY, stem.tipY), 2),
          y1: round(Math.max(note?.cy ?? stem.tipY, stem.tipY), 2),
          tipY: round(stem.tipY, 2),
        },
        sourceRefs: [],
      }
      byKey.set(stem.key, node)
    }
    node.sourceRefs.push(sourceRef(note, index))
    const components = [
      component(
        'source-stem-probe',
        note?.stem?.recovered === false ? 0.92 : 0.82,
        0.7,
        'primitive stem geometry',
        'A stem segment was observed adjacent to the printed head.',
      ),
      component(
        'anchor-proximity',
        1 - Math.min(1, Math.abs((note?.cx ?? stem.x) - stem.x) / Math.max(1, staffSpace)),
        0.3,
        'source x/y anchors',
        'Stem x is close to the notehead boundary.',
      ),
    ]
    const score = scoreComponents(components)
    relations.push({
      type: 'stem-owner-candidate',
      from: node.id,
      to: noteNodes[index].id,
      score,
      status: relationStatus(score),
      components,
      evidence: { direction: stem.direction, sharedStemKey: stem.key },
      reasons: ['physical-stem-adjacent-to-notehead'],
    })
  })
  return [...byKey.values()]
}

function buildBeamNodes(scope, notes, noteNodes, stemNodes, relations, staffSpace) {
  const candidates = notes
    .map((note, index) => ({ note, index, head: noteNodes[index] }))
    .filter(({ note }) => (note?.beams ?? 0) > 0 || (note?.beamStrength ?? 0) >= 8)
    .sort((left, right) =>
      String(staffRole(left.note)).localeCompare(String(staffRole(right.note))) ||
      String(stemDirection(left.note)).localeCompare(String(stemDirection(right.note))) ||
      (left.note.cx ?? 0) - (right.note.cx ?? 0),
    )
  const groups = []
  for (const entry of candidates) {
    const previous = groups.at(-1)
    const compatible =
      previous &&
      previous.staffRole === staffRole(entry.note) &&
      previous.direction === stemDirection(entry.note) &&
      (entry.note.cx ?? 0) - previous.lastX <= staffSpace * 9
    if (!compatible) {
      groups.push({
        staffRole: staffRole(entry.note),
        direction: stemDirection(entry.note),
        lastX: entry.note.cx ?? 0,
        entries: [entry],
      })
    } else {
      previous.entries.push(entry)
      previous.lastX = entry.note.cx ?? previous.lastX
    }
  }
  const nodes = []
  for (const group of groups) {
    if (!group.entries.length) continue
    const id = `${scope}:beam:${nodes.length + 1}`
    const node = {
      id,
      kind: 'beam',
      source: 'notehead-rhythm-probe',
      staffRole: group.staffRole,
      direction: group.direction,
      level: Math.max(...group.entries.map(({ note }) => note?.beams ?? 1)),
      anchor: {
        x0: round(group.entries[0].note.cx, 2),
        x1: round(group.entries.at(-1).note.cx, 2),
      },
      sourceRefs: group.entries.map(({ note, index }) => sourceRef(note, index)),
    }
    nodes.push(node)
    for (const { note, head, index } of group.entries) {
      const components = [
        component(
          'beam-count-probe',
          Math.min(1, (note?.beams ?? 0) / 2),
          0.55,
          'primitive beam count',
          'The notehead rhythm probe observed one or more beam levels.',
        ),
        component(
          'beam-ink-strength',
          Math.min(1, (note?.beamStrength ?? 0) / 20),
          0.45,
          'source ink near stem tip',
          'Ink density near the stem tip supports beam membership.',
        ),
      ]
      const score = scoreComponents(components)
      relations.push({
        type: 'beam-membership-candidate',
        from: head.id,
        to: id,
        score,
        status: relationStatus(score),
        components,
        evidence: { beamCount: note?.beams ?? 0, beamStrength: round(note?.beamStrength ?? 0, 2) },
        reasons: ['source-beam-probe'],
      })
      const source = sourceRef(note, index)
      for (const stem of stemNodes.filter((candidate) => candidate.sourceRefs.includes(source))) {
        const stemComponents = [
          component('shared-source-provenance', 1, 0.6, 'primitive source references', 'Beam and stem probes originate at the same printed note.'),
          component('compatible-direction', stem.direction === group.direction ? 1 : 0, 0.4, 'primitive stem direction', 'Beam and stem directions are geometrically compatible.'),
        ]
        const stemScore = scoreComponents(stemComponents)
        relations.push({
          type: 'beam-stem-candidate',
          from: id,
          to: stem.id,
          score: stemScore,
          status: relationStatus(stemScore),
          components: stemComponents,
          evidence: { direction: group.direction, sourceRef: source },
          reasons: ['shared-primitive-source-reference'],
        })
      }
    }
  }
  return nodes
}

function buildSharedHeadRoleCandidates(scope, notes, noteNodes, relations, staffSpace) {
  const ambiguities = []
  notes.forEach((note, index) => {
    const attackEvidence = (note?.beams ?? 0) > 0 || (note?.beamStrength ?? 0) >= 8
    const sustainEvidence = note?.dotted === true || note?.hollowGlyph === true || note?.hollow === true
    if (!sustainEvidence) return
    const localAttackContext = notes.some(
      (candidate, candidateIndex) =>
        candidateIndex !== index &&
        staffRole(candidate) === staffRole(note) &&
        Math.abs((candidate?.cx ?? 0) - (note?.cx ?? 0)) <= staffSpace * 4 &&
        ((candidate?.beams ?? 0) > 0 || (candidate?.beamStrength ?? 0) >= 8),
    )
    if (!attackEvidence && !localAttackContext) return
    const components = [
      component('attack-value-evidence', attackEvidence ? Math.min(1, Math.max(note?.beams ?? 0, (note?.beamStrength ?? 0) / 12)) : 0.62, 0.5, attackEvidence ? 'primitive beam probe' : 'bounded local beam context', attackEvidence ? 'The printed head carries short-value attack evidence.' : 'A nearby same-staff attack run makes a second role plausible for this sustain head.'),
      component('sustain-value-evidence', note?.dotted === true ? 1 : 0.75, 0.5, 'notehead/dot glyph evidence', 'The same physical head carries independent sustain evidence.'),
    ]
    const score = scoreComponents(components)
    relations.push({
      type: 'shared-head-role-candidate',
      from: noteNodes[index].id,
      to: noteNodes[index].id,
      score,
      status: relationStatus(score),
      components,
      evidence: {
        beamCount: note?.beams ?? 0,
        beamStrength: round(note?.beamStrength ?? 0, 2),
        dotted: note?.dotted === true,
        open: note?.hollowGlyph === true || note?.hollow === true,
        localAttackContext,
      },
      reasons: ['same-physical-head-has-attack-and-sustain-evidence'],
    })
    ambiguities.push({
      id: `${scope}:ambiguity:shared-head:${index + 1}`,
      kind: 'shared-head-semantic-overprint',
      memberIds: [noteNodes[index].id],
      evidenceScore: score,
      hypotheses: ['single-written-value', 'attack-plus-sustain-roles'],
      reasons: ['short-value-beam-evidence', 'long-value-head-or-dot-evidence'],
      resolution: 'abstain',
    })
  })
  return ambiguities
}

function buildRawDotCandidates(scope, glyphs, notes, noteNodes, measureBox, imageData, staffSpace, relations) {
  if (!measureBox || !imageData) return { nodes: [], laneEvidence: [], ambiguities: [] }
  const x0 = (measureBox.x0 ?? 0) * imageData.width
  const x1 = (measureBox.x1 ?? 1) * imageData.width
  const y0 = (measureBox.y0 ?? 0) * imageData.height
  const y1 = (measureBox.y1 ?? 1) * imageData.height
  const candidates = glyphs.filter(
    (glyph) =>
      (glyph?.text === '\ue1e7' || glyph?.text === '.') &&
      glyph.x >= x0 && glyph.x <= x1 && glyph.y >= y0 && glyph.y <= y1,
  )
  const nodes = []
  const laneEvidence = []
  const ambiguities = []
  for (const glyph of candidates) {
    const node = {
      id: `${scope}:raw-dot:${nodes.length + 1}`,
      kind: 'dot-mark',
      source: glyph.source ?? 'raw-vector-dot-glyph',
      glyphClass: glyph.text === '\ue1e7' ? 'smufl-augmentation-dot' : 'period-dot',
      anchor: { x: round(glyph.x, 2), y: round(glyph.y, 2) },
      sourceRef: glyph.sourcePathId ?? glyph.glyphId ?? null,
    }
    nodes.push(node)
    const owners = notes
      .map((note, index) => {
        const dx = (glyph.x ?? 0) - (note?.cx ?? 0)
        const dy = Math.abs((glyph.y ?? 0) - (note?.cy ?? 0))
        return { note, index, dx, dy }
      })
      .filter(({ dx, dy }) => dx >= 2 && dx <= Math.max(24, staffSpace * 2.4) && dy <= staffSpace * 0.9)
      .sort((left, right) => left.dx + left.dy * 0.5 - (right.dx + right.dy * 0.5))
      .slice(0, 3)
    for (const owner of owners) {
      const components = [
        component('right-of-head-spacing', 1 - (owner.dx - 2) / Math.max(1, staffSpace * 2.4 - 2), 0.55, 'raw dot and notehead x anchors', 'The dot is printed to the right of a possible owner.'),
        component('staff-space-y-compatibility', 1 - owner.dy / Math.max(1, staffSpace * 0.9), 0.45, 'raw dot and notehead y anchors', 'Vertical offset is compatible with an augmentation-dot placement.'),
      ]
      const score = scoreComponents(components)
      relations.push({
        type: 'dot-owner-candidate',
        from: node.id,
        to: noteNodes[owner.index].id,
        score,
        status: relationStatus(score),
        components,
        evidence: { dx: round(owner.dx, 2), dy: round(owner.dy, 2), rawUnclassifiedDot: true },
        reasons: ['bounded-source-dot-owner-geometry'],
      })
      laneEvidence.push({
        kind: 'dot-sustain-candidate',
        memberIds: [node.id, noteNodes[owner.index].id],
        score,
        source: 'raw dot/head geometry',
        evidence: { dx: round(owner.dx, 2), dy: round(owner.dy, 2) },
        doesNotResolveVoice: true,
      })
    }
    if (owners.length !== 1 || glyph.text === '.') {
      ambiguities.push({
        kind: 'dot-role-or-owner-ambiguous',
        memberIds: [node.id, ...owners.map((owner) => noteNodes[owner.index].id)],
        evidenceScore: owners.length ? 0.5 : 0,
        hypotheses: ['augmentation-dot', 'articulation-dot', 'repeat-or-text-dot'],
        reasons: [owners.length ? 'multiple-source-compatible-roles' : 'no-compatible-note-owner'],
        resolution: 'abstain',
      })
    }
  }
  return { nodes, laneEvidence, ambiguities }
}

function buildSubdivisionGridEvidence(scope, notes, noteNodes, staffSpace) {
  const evidence = []
  const attackTolerance = Math.max(2.25, staffSpace * 0.38)
  for (const role of new Set(notes.map(staffRole))) {
    const ordered = notes
      .map((note, index) => ({ note, index }))
      .filter(({ note }) => staffRole(note) === role)
      .sort((left, right) => (left.note.cx ?? 0) - (right.note.cx ?? 0))
    const columns = []
    for (const entry of ordered) {
      const column = columns.at(-1)
      if (!column || Math.abs((entry.note.cx ?? 0) - column.x) > attackTolerance) {
        columns.push({ x: entry.note.cx ?? 0, entries: [entry] })
      } else {
        column.entries.push(entry)
        column.x = column.entries.reduce((sum, item) => sum + (item.note.cx ?? 0), 0) / column.entries.length
      }
    }
    if (columns.length < 3) continue
    const gaps = columns.slice(1).map((column, index) => column.x - columns[index].x)
    const typicalGap = median(gaps)
    if (!(typicalGap > 0)) continue
    const normalizedDeviation = gaps.reduce((sum, gap) => sum + Math.abs(gap - typicalGap) / typicalGap, 0) / gaps.length
    const uniformity = clamp01(1 - normalizedDeviation)
    const beamedColumns = columns.filter((column) =>
      column.entries.some(({ note }) => (note?.beams ?? 0) > 0 || (note?.beamStrength ?? 0) >= 8),
    ).length
    const ratioCandidates = [3, 5, 7]
      .filter((ratio) => columns.length % ratio === 0 || columns.length === ratio)
      .map((ratio) => ({ actual: ratio, normal: ratio === 3 ? 2 : 4 }))
    if (!ratioCandidates.length || uniformity < 0.55 || beamedColumns < Math.min(2, columns.length)) continue
    evidence.push({
      id: `${scope}:subdivision-grid:${evidence.length + 1}`,
      kind: 'subdivision-ratio-candidate',
      memberIds: columns.flatMap((column) => column.entries.map(({ index }) => noteNodes[index].id)),
      score: round(uniformity * 0.65 + Math.min(1, beamedColumns / columns.length) * 0.35),
      source: 'bounded attack-column spacing and primitive beam probes',
      evidence: {
        staffRole: role,
        columnCount: columns.length,
        typicalGap: round(typicalGap, 2),
        uniformity: round(uniformity),
        beamedColumns,
        ratioCandidates,
      },
      doesNotResolveVoice: true,
      doesNotAssignTuplet: true,
    })
  }
  return evidence
}

function buildGridSharedHeadCandidates(scope, notes, noteNodes, subdivisionEvidence, relations) {
  const ambiguities = []
  const gridMembers = new Set(
    subdivisionEvidence.flatMap((entry) => entry.memberIds ?? []),
  )
  notes.forEach((note, index) => {
    const node = noteNodes[index]
    const sustainEvidence =
      note?.dotted === true || note?.hollowGlyph === true || note?.hollow === true
    if (!sustainEvidence || !gridMembers.has(node.id)) return
    if (
      relations.some(
        (relation) =>
          relation.type === 'shared-head-role-candidate' && relation.from === node.id,
      )
    ) return
    const components = [
      component('subdivision-grid-membership', 0.78, 0.5, 'bounded attack-column grid evidence', 'This physical head belongs to a plausible short-value subdivision grid.'),
      component('sustain-value-evidence', note?.dotted === true ? 1 : 0.75, 0.5, 'notehead/dot glyph evidence', 'The same physical head carries a written sustain value.'),
    ]
    const score = scoreComponents(components)
    relations.push({
      type: 'shared-head-role-candidate',
      from: node.id,
      to: node.id,
      score,
      status: relationStatus(score),
      components,
      evidence: {
        dotted: note?.dotted === true,
        open: note?.hollowGlyph === true || note?.hollow === true,
        subdivisionGridMember: true,
      },
      reasons: ['same-physical-head-has-subdivision-and-sustain-evidence'],
    })
    ambiguities.push({
      kind: 'shared-head-semantic-overprint',
      memberIds: [node.id],
      evidenceScore: score,
      hypotheses: ['single-written-value', 'subdivision-attack-plus-sustain-roles'],
      reasons: ['subdivision-grid-membership', 'long-value-head-or-dot-evidence'],
      resolution: 'abstain',
    })
  })
  return ambiguities
}

function buildTupletMembershipCandidates(scope, tupletMarks, notes, noteNodes, staffSpace, relations) {
  for (const mark of tupletMarks) {
    const nearby = notes
      .map((note, index) => ({ note, index, distance: Math.abs((note?.cx ?? 0) - (mark.anchor.x ?? 0)) }))
      .filter(({ distance }) => distance <= staffSpace * 8)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, Math.max(3, Math.min(7, mark.ratioHint ?? 3)))
    for (const { index, distance } of nearby) {
      const components = [
        component('horizontal-tuplet-span-proximity', 1 - distance / Math.max(1, staffSpace * 8), 0.7, 'raw tuplet-mark and notehead x anchors', 'The notehead lies in the local horizontal neighborhood of the printed ratio mark.'),
        component('short-value-rhythm-probe', (notes[index]?.beams ?? 0) > 0 || (notes[index]?.beamStrength ?? 0) >= 8 ? 1 : 0, 0.3, 'primitive beam probe', 'Short-value evidence is compatible with tuplet membership.'),
      ]
      const score = scoreComponents(components)
      relations.push({
        type: 'tuplet-membership-candidate',
        from: noteNodes[index].id,
        to: mark.id,
        score,
        status: relationStatus(score),
        components,
        evidence: { ratioHint: mark.ratioHint, horizontalDistance: round(distance, 2) },
        reasons: ['raw-ratio-mark-locality'],
      })
    }
  }
}

function ownerAttachmentNodes(scope, notes, noteNodes, relations) {
  const nodes = []
  notes.forEach((note, index) => {
    const attachments = []
    if (note?.accidental) {
      attachments.push({
        kind: 'accidental',
        source: note.accidental.source ?? 'pre-event-local-accidental-assignment',
        glyphClass: note.accidental.type ?? null,
        value: note.accidental.alter ?? null,
        relation: 'accidental-owner-candidate',
        score: note.accidental.confidence ?? 0.9,
      })
    }
    if (note?.dotted === true) {
      attachments.push({
        kind: 'augmentation-dot',
        source: note.augmentationDot?.source ?? 'pre-event-dot-assignment',
        glyphClass: 'augmentation-dot',
        value: null,
        relation: 'dot-owner-candidate',
        score: note.augmentationDot?.confidence ?? 0.9,
      })
    }
    for (const attachment of attachments) {
      const id = `${scope}:${attachment.kind}:${nodes.length + 1}`
      nodes.push({
        id,
        kind: attachment.kind,
        source: attachment.source,
        glyphClass: attachment.glyphClass,
        value: attachment.value,
        anchor: { x: round(note?.cx, 2), y: round(note?.cy, 2) },
        sourceRef: sourceRef(note, index),
      })
      const components = [
        component(
          'pre-event-physical-attachment',
          attachment.score,
          1,
          attachment.source,
          'Primitive extraction attached the source mark to this physical notehead.',
        ),
      ]
      const score = scoreComponents(components)
      relations.push({
        type: attachment.relation,
        from: id,
        to: noteNodes[index].id,
        score,
        status: relationStatus(score),
        components,
        evidence: { sourceRef: sourceRef(note, index) },
        reasons: ['primitive-owner-assignment'],
      })
    }
  })
  return nodes
}

function restNodes(scope, rests) {
  return rests.map((rest, index) => ({
    id: `${scope}:rest:${index + 1}`,
    kind: 'rest',
    source: rest?.source ?? 'unknown',
    glyphClass: rest?.durationType ?? rest?.glyph ?? 'unknown-rest',
    anchor: {
      x: round(rest?.cx, 2),
      y: round(rest?.cy, 2),
      positionInMeasure: round(rest?.positionInMeasure),
    },
    staffRole: rest?.pitchMapping?.staffRole ?? (rest?.clef === 'bass' ? 'lower' : 'upper'),
    clef: rest?.clef ?? null,
  }))
}

function tupletMarkNodes(scope, glyphs, measureBox, imageData) {
  if (!measureBox || !imageData) return []
  const x0 = (measureBox.playableX0 ?? measureBox.x0 ?? 0) * imageData.width
  const x1 = (measureBox.x1 ?? 1) * imageData.width
  const y0 = (measureBox.y0 ?? 0) * imageData.height
  const y1 = (measureBox.y1 ?? 1) * imageData.height
  return glyphs
    .filter(
      (glyph) =>
        /^[357]$/.test(String(glyph?.text ?? '')) &&
        glyph.x >= x0 && glyph.x <= x1 && glyph.y >= y0 && glyph.y <= y1,
    )
    .map((glyph, index) => ({
      id: `${scope}:tuplet-mark:${index + 1}`,
      kind: 'tuplet-mark',
      source: 'vector-source-glyph',
      glyphClass: `digit-${glyph.text}`,
      ratioHint: Number(glyph.text),
      anchor: { x: round(glyph.x, 2), y: round(glyph.y, 2) },
      sourceRef: glyph.sourcePathId ?? glyph.glyphId ?? null,
    }))
}

function stateMarkNodes(scope, measureBox, keySignature, timeSignature) {
  const nodes = []
  for (const event of measureBox?.staffClefs?.events ?? []) {
    nodes.push({
      id: `${scope}:state-mark:${nodes.length + 1}`,
      kind: 'state-mark',
      stateType: 'clef',
      source: event.source ?? 'vector-clef-timeline',
      value: event.clef ?? event.value ?? null,
      staffRole: event.staffRole ?? event.staff ?? null,
      anchor: { xNorm: round(event.xNorm), yNorm: round(event.yNorm) },
    })
  }
  if (keySignature) {
    nodes.push({
      id: `${scope}:state-mark:${nodes.length + 1}`,
      kind: 'state-mark',
      stateType: 'key-signature',
      source: keySignature.source ?? 'pre-event-key-state',
      value: keySignature.fifths ?? keySignature.key ?? null,
    })
  }
  if (timeSignature) {
    nodes.push({
      id: `${scope}:state-mark:${nodes.length + 1}`,
      kind: 'state-mark',
      stateType: 'meter',
      source: timeSignature.source ?? 'pre-event-meter-state',
      value: `${timeSignature.beats ?? 4}/${timeSignature.beatType ?? 4}`,
    })
  }
  return nodes
}

function candidatePairs(notes, staffSpace) {
  const bucketWidth = Math.max(3, staffSpace * 0.7)
  const buckets = new Map()
  notes.forEach((note, index) => {
    const bucket = Math.floor((note?.cx ?? 0) / bucketWidth)
    const key = `${staffRole(note)}:${bucket}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(index)
  })
  const pairs = new Map()
  const add = (left, right, source) => {
    if (left === right) return
    const a = Math.min(left, right)
    const b = Math.max(left, right)
    const key = `${a}:${b}`
    const current = pairs.get(key) ?? { left: a, right: b, sources: [] }
    if (!current.sources.includes(source)) current.sources.push(source)
    pairs.set(key, current)
  }
  notes.forEach((note, index) => {
    const bucket = Math.floor((note?.cx ?? 0) / bucketWidth)
    for (let offset = -1; offset <= 1; offset += 1) {
      const local = buckets.get(`${staffRole(note)}:${bucket + offset}`) ?? []
      for (const other of local.slice(0, MAX_BUCKET_NEIGHBORS + 1)) {
        add(index, other, 'x-bucket')
      }
    }
  })
  for (const role of new Set(notes.map(staffRole))) {
    const ordered = notes
      .map((note, index) => ({ note, index }))
      .filter(({ note }) => staffRole(note) === role)
      .sort((left, right) => (left.note.cx ?? 0) - (right.note.cx ?? 0))
    for (let index = 0; index < ordered.length; index += 1) {
      for (
        let offset = 1;
        offset <= MAX_ORDERED_NEIGHBORS && index + offset < ordered.length;
        offset += 1
      ) {
        const left = ordered[index]
        const right = ordered[index + offset]
        if ((right.note.cx ?? 0) - (left.note.cx ?? 0) > staffSpace * 9) break
        add(left.index, right.index, 'ordered-neighbor')
      }
    }
  }
  const byX = [...notes.keys()].sort((left, right) => (notes[left].cx ?? 0) - (notes[right].cx ?? 0))
  for (let index = 0; index < byX.length; index += 1) {
    for (let offset = 1; offset <= 3 && index + offset < byX.length; offset += 1) {
      const left = byX[index]
      const right = byX[index + offset]
      if ((notes[right].cx ?? 0) - (notes[left].cx ?? 0) > staffSpace * 1.2) break
      if (staffRole(notes[left]) !== staffRole(notes[right])) add(left, right, 'cross-staff-x-neighbor')
    }
  }
  return { pairs: [...pairs.values()], bucketWidth }
}

function pairRelations(scope, notes, noteNodes, staffSpace, relations) {
  const attackCandidates = []
  const laneEvidence = []
  const ambiguities = []
  const { pairs, bucketWidth } = candidatePairs(notes, staffSpace)
  const attackTolerance = Math.max(2.25, staffSpace * 0.38)
  const displacedTolerance = Math.max(4.5, staffSpace * 0.82)

  for (const pair of pairs) {
    const left = notes[pair.left]
    const right = notes[pair.right]
    const leftNode = noteNodes[pair.left]
    const rightNode = noteNodes[pair.right]
    const dx = Math.abs((left?.cx ?? 0) - (right?.cx ?? 0))
    const dy = Math.abs((left?.cy ?? 0) - (right?.cy ?? 0))
    const sameStaff = staffRole(left) === staffRole(right)
    const leftStem = stemDirection(left)
    const rightStem = stemDirection(right)
    const opposingStems = leftStem && rightStem && leftStem !== rightStem
    const samePitch = left?.midi != null && left.midi === right?.midi
    const sharedStem =
      stemKey(left, staffSpace)?.key != null &&
      stemKey(left, staffSpace)?.key === stemKey(right, staffSpace)?.key
    const sameAttackX = dx <= attackTolerance
    const displacedChord =
      sameStaff && dx <= displacedTolerance && dy >= staffSpace * 0.35 && sharedStem

    if (sameAttackX || displacedChord) {
      const components = [
        component(
          'horizontal-alignment',
          1 - dx / Math.max(1, displacedTolerance),
          0.5,
          'source x anchors',
          'Printed noteheads occupy the same or a collision-displaced attack column.',
        ),
        component(
          'shared-stem-geometry',
          sharedStem ? 1 : 0,
          0.3,
          'primitive stem geometry',
          'Both heads have a compatible physical stem candidate.',
        ),
        component(
          'vertical-chord-separation',
          sameStaff && dy >= staffSpace * 0.35 ? Math.min(1, dy / (staffSpace * 2)) : 0,
          0.2,
          'source y anchors',
          'Vertical separation is compatible with a printed chord.',
        ),
      ]
      const score = scoreComponents(components)
      const type = displacedChord ? 'same-chord-candidate' : 'same-attack-candidate'
      relations.push({
        type,
        from: leftNode.id,
        to: rightNode.id,
        score,
        status: relationStatus(score),
        components,
        evidence: { dx: round(dx, 2), dy: round(dy, 2), attackTolerance: round(attackTolerance, 2), displacedTolerance: round(displacedTolerance, 2), sameStaff, sharedStem, opposingStems },
        reasons: [displacedChord ? 'collision-displaced-shared-stem' : 'source-x-alignment'],
      })
      attackCandidates.push({
        id: `${scope}:attack:${attackCandidates.length + 1}`,
        kind: displacedChord ? 'displaced-chord' : 'same-attack',
        memberIds: [leftNode.id, rightNode.id],
        score,
        status: relationStatus(score),
        evidence: { dx: round(dx, 2), sameStaff, sharedStem, opposingStems },
        competingHypotheses: [],
      })
    }

    const sequentialNearby = sameStaff && dx > attackTolerance && dx <= staffSpace * 9
    const closeIndependent = sameStaff && dx <= attackTolerance && opposingStems
    if (sequentialNearby || closeIndependent) {
      const beamCompatible =
        ((left?.beams ?? 0) > 0 || (left?.beamStrength ?? 0) >= 8) &&
        ((right?.beams ?? 0) > 0 || (right?.beamStrength ?? 0) >= 8) &&
        leftStem === rightStem
      const components = [
        component(
          'ordered-x-separation',
          sequentialNearby ? Math.min(1, dx / Math.max(1, staffSpace * 2)) : 0.25,
          0.45,
          'source x anchors',
          'Distinct source x positions support successive attacks.',
        ),
        component(
          'beam-continuity',
          beamCompatible ? 1 : 0,
          0.35,
          'primitive beam/stem probes',
          'Compatible beam and stem evidence supports an ordered rhythmic run.',
        ),
        component(
          'opposing-stem-lanes',
          opposingStems ? 1 : 0,
          0.2,
          'primitive stem direction',
          'Opposing stem directions support independent temporal lanes.',
        ),
      ]
      const score = scoreComponents(components)
      relations.push({
        type: 'sequential-attack-candidate',
        from: (left.cx ?? 0) <= (right.cx ?? 0) ? leftNode.id : rightNode.id,
        to: (left.cx ?? 0) <= (right.cx ?? 0) ? rightNode.id : leftNode.id,
        score,
        status: relationStatus(score),
        components,
        evidence: { dx: round(dx, 2), sameStaff, beamCompatible, opposingStems },
        reasons: [closeIndependent ? 'same-x-independent-lane-possibility' : 'ordered-source-x'],
      })
      attackCandidates.push({
        id: `${scope}:attack:${attackCandidates.length + 1}`,
        kind: closeIndependent ? 'same-x-independent-lanes' : 'sequential',
        memberIds: [leftNode.id, rightNode.id],
        score,
        status: relationStatus(score),
        evidence: { dx: round(dx, 2), beamCompatible, opposingStems },
        competingHypotheses: sameAttackX ? ['same-attack'] : [],
      })
    }

    if (opposingStems && dx <= displacedTolerance) {
      laneEvidence.push({
        id: `${scope}:lane-evidence:${laneEvidence.length + 1}`,
        kind: 'opposing-stem-directions',
        memberIds: [leftNode.id, rightNode.id],
        score: 0.82,
        source: 'primitive stem direction',
        evidence: { left: leftStem, right: rightStem, dx: round(dx, 2) },
        doesNotResolveVoice: true,
      })
    }
    if (!sameStaff && dx <= staffSpace * 1.2) {
      const pitchDistance =
        left?.midi != null && right?.midi != null ? Math.abs(left.midi - right.midi) : null
      const components = [
        component('cross-staff-x-continuity', 1 - dx / Math.max(1, staffSpace * 1.2), 0.65, 'source x anchors', 'Heads on different staves are horizontally continuous.'),
        component('pitch-continuity', pitchDistance == null ? 0 : 1 - Math.min(1, pitchDistance / 24), 0.35, 'pre-event pitch mapping', 'Pitch distance is compatible with a continuing written line.'),
      ]
      const score = scoreComponents(components)
      relations.push({
        type: 'cross-staff-continuation-candidate',
        from: leftNode.id,
        to: rightNode.id,
        score,
        status: relationStatus(score),
        components,
        evidence: { dx: round(dx, 2), pitchDistance },
        reasons: ['adjacent-cross-staff-source-anchors'],
      })
      laneEvidence.push({
        id: `${scope}:lane-evidence:${laneEvidence.length + 1}`,
        kind: 'cross-staff-continuity',
        memberIds: [leftNode.id, rightNode.id],
        score,
        source: 'source anchors and pitch mapping',
        evidence: { dx: round(dx, 2), pitchDistance },
        doesNotResolveVoice: true,
      })
    }
    if (sameAttackX && opposingStems) {
      ambiguities.push({
        id: `${scope}:ambiguity:${ambiguities.length + 1}`,
        kind: 'same-attack-versus-independent-lanes',
        memberIds: [leftNode.id, rightNode.id],
        evidenceScore: 0.5,
        hypotheses: ['same-attack', 'independent-temporal-lanes'],
        reasons: ['same-source-x', 'opposing-stem-directions'],
        resolution: 'abstain',
      })
    }
    if (samePitch && sameAttackX && (opposingStems || sharedStem)) {
      const components = [
        component('coincident-physical-head', 1 - dx / Math.max(1, attackTolerance), 0.5, 'source x/y anchors', 'Coincident pitch and x position can encode more than one semantic role.'),
        component('multiple-rhythmic-ownership', opposingStems || sharedStem ? 1 : 0, 0.5, 'primitive stem geometry', 'Physical ownership evidence admits more than one rhythmic interpretation.'),
      ]
      const score = scoreComponents(components)
      relations.push({
        type: 'shared-head-role-candidate',
        from: leftNode.id,
        to: rightNode.id,
        score,
        status: relationStatus(score),
        components,
        evidence: { samePitch, sameAttackX, opposingStems, sharedStem },
        reasons: ['coincident-source-head-role-evidence'],
      })
    }
  }

  return { attackCandidates, laneEvidence, ambiguities, pairCount: pairs.length, bucketWidth }
}

function singleNodeLaneEvidence(scope, notes, noteNodes, restNodeList, tupletNodes) {
  const evidence = []
  notes.forEach((note, index) => {
    const direction = stemDirection(note)
    if (direction) {
      evidence.push({
        id: `${scope}:lane-evidence:${evidence.length + 1}`,
        kind: 'stem-direction',
        memberIds: [noteNodes[index].id],
        score: note?.stem?.recovered === false ? 0.9 : 0.78,
        source: 'primitive stem geometry',
        evidence: { direction },
        doesNotResolveVoice: true,
      })
    }
    if (note?.hollowGlyph === true || note?.hollow === true || note?.dotted === true) {
      evidence.push({
        id: `${scope}:lane-evidence:${evidence.length + 1}`,
        kind: 'sustain-value',
        memberIds: [noteNodes[index].id],
        score: note?.dotted === true ? 0.9 : 0.75,
        source: 'notehead glyph and augmentation-dot evidence',
        evidence: { open: note?.hollowGlyph === true || note?.hollow === true, dotted: note?.dotted === true },
        doesNotResolveVoice: true,
      })
    }
  })
  for (const rest of restNodeList) {
    evidence.push({
      id: `${scope}:lane-evidence:${evidence.length + 1}`,
      kind: 'structural-rest-anchor',
      memberIds: [rest.id],
      score: 0.8,
      source: 'physical rest glyph',
      evidence: { staffRole: rest.staffRole, positionInMeasure: rest.anchor.positionInMeasure },
      doesNotResolveVoice: true,
    })
  }
  for (const tuplet of tupletNodes) {
    evidence.push({
      id: `${scope}:lane-evidence:${evidence.length + 1}`,
      kind: 'tuplet-ratio-mark',
      memberIds: [tuplet.id],
      score: 0.55,
      source: 'raw digit glyph in playable measure area',
      evidence: { ratioHint: tuplet.ratioHint },
      doesNotResolveVoice: true,
    })
  }
  return evidence
}

function buildStaffOccupancyEvidence(scope, notes, noteNodes, restNodeList, measureBox) {
  const availableRoles = [
    Array.isArray(measureBox?.staffLines?.treble) && measureBox.staffLines.treble.length >= 5
      ? 'upper'
      : null,
    Array.isArray(measureBox?.staffLines?.bass) && measureBox.staffLines.bass.length >= 5
      ? 'lower'
      : null,
  ].filter(Boolean)
  if (availableRoles.length < 2) return []
  const evidence = []
  for (const role of availableRoles) {
    const noteMembers = notes
      .map((note, index) => ({ note, index }))
      .filter(({ note }) => staffRole(note) === role)
    const restMembers = restNodeList.filter((rest) => rest.staffRole === role)
    if (noteMembers.length || restMembers.length) continue
    evidence.push({
      id: `${scope}:staff-occupancy:${evidence.length + 1}`,
      kind: 'silent-staff-gap-candidate',
      memberIds: [],
      score: 0.8,
      source: 'grand-staff geometry plus absence of physical note/rest primitives',
      evidence: {
        silentStaffRole: role,
        populatedStaffRoles: availableRoles.filter((candidate) => candidate !== role),
        physicalNoteheadCount: noteNodes.length,
        physicalRestCount: restNodeList.length,
      },
      doesNotResolveVoice: true,
      doesNotInventRest: true,
    })
  }
  return evidence
}

function explicitZeroEvidence(scope, noteNodes, relations) {
  const involved = new Set(relations.flatMap((relation) => [relation.from, relation.to]))
  const outcomes = noteNodes
    .filter((node) => !involved.has(node.id))
    .map((node, index) => ({
      id: `${scope}:zero-evidence:${index + 1}`,
      memberIds: [node.id],
      score: 0,
      outcome: 'no-supported-relation',
      reason: 'No bounded source-evidence candidate cleared relation generation.',
    }))
  if (!noteNodes.length) {
    outcomes.push({
      id: `${scope}:zero-evidence:graph`,
      memberIds: [],
      score: 0,
      outcome: 'no-notehead-primitives',
      reason: 'No physical notehead primitive was detected in this measure.',
    })
  }
  return outcomes
}

function finalizeRelationIds(scope, relations) {
  return relations.map((relation, index) => ({
    id: relationId(scope, relation.type, index),
    ...relation,
  }))
}

export function buildSourceRelationGraph({
  notes = [],
  rests = [],
  glyphs = [],
  imageData = null,
  measureBox = null,
  keySignature = null,
  timeSignature = null,
} = {}) {
  const started = globalThis.performance?.now?.() ?? Date.now()
  const page = measureBox?.page ?? notes[0]?.page ?? null
  const systemIndex = measureBox?.systemIndex ?? notes[0]?.systemIndex ?? null
  const measureNumber = measureBox?.measureNumber ?? notes[0]?.measureNumber ?? null
  const scope = `p${page ?? 0}:s${systemIndex ?? 0}:m${measureNumber ?? 0}`
  const physicalNotes = [...notes]
  const space = staffSpacePx(physicalNotes, measureBox, imageData)
  const noteNodes = physicalNotes.map((note, index) => physicalNoteheadNode(scope, note, index))
  const relations = []
  const stems = buildStemNodes(scope, physicalNotes, noteNodes, space, relations)
  const beams = buildBeamNodes(scope, physicalNotes, noteNodes, stems, relations, space)
  const attachments = ownerAttachmentNodes(scope, physicalNotes, noteNodes, relations)
  const physicalRests = restNodes(scope, rests)
  const tupletMarks = tupletMarkNodes(scope, glyphs, measureBox, imageData)
  const stateMarks = stateMarkNodes(scope, measureBox, keySignature, timeSignature)
  const sharedHeadAmbiguities = buildSharedHeadRoleCandidates(
    scope,
    physicalNotes,
    noteNodes,
    relations,
    space,
  )
  const rawDots = buildRawDotCandidates(
    scope,
    glyphs,
    physicalNotes,
    noteNodes,
    measureBox,
    imageData,
    space,
    relations,
  )
  buildTupletMembershipCandidates(scope, tupletMarks, physicalNotes, noteNodes, space, relations)
  const pairGraph = pairRelations(scope, physicalNotes, noteNodes, space, relations)
  const subdivisionEvidence = buildSubdivisionGridEvidence(
    scope,
    physicalNotes,
    noteNodes,
    space,
  )
  const gridSharedHeadAmbiguities = buildGridSharedHeadCandidates(
    scope,
    physicalNotes,
    noteNodes,
    subdivisionEvidence,
    relations,
  )
  const laneEvidence = [
    ...singleNodeLaneEvidence(scope, physicalNotes, noteNodes, physicalRests, tupletMarks),
    ...buildStaffOccupancyEvidence(
      scope,
      physicalNotes,
      noteNodes,
      physicalRests,
      measureBox,
    ),
    ...subdivisionEvidence,
    ...rawDots.laneEvidence,
    ...pairGraph.laneEvidence,
  ].map((entry, index) => ({ ...entry, id: `${scope}:lane-evidence:${index + 1}` }))
  const finalRelations = finalizeRelationIds(scope, relations)
  const zeroEvidence = explicitZeroEvidence(scope, noteNodes, finalRelations)
  const elapsed = (globalThis.performance?.now?.() ?? Date.now()) - started
  const nodes = [
    ...noteNodes,
    ...stems,
    ...beams,
    ...physicalRests,
    ...attachments,
    ...rawDots.nodes,
    ...tupletMarks,
    ...stateMarks,
  ]
  const ambiguities = [
    ...sharedHeadAmbiguities,
    ...gridSharedHeadAmbiguities,
    ...rawDots.ambiguities,
    ...pairGraph.ambiguities,
  ].map((entry, index) => ({ ...entry, id: `${scope}:ambiguity:${index + 1}` }))
  for (const outcome of zeroEvidence) {
    ambiguities.push({
      id: `${scope}:ambiguity:${ambiguities.length + 1}`,
      kind: 'incomplete-evidence',
      memberIds: outcome.memberIds,
      evidenceScore: 0,
      hypotheses: [],
      reasons: [outcome.reason],
      resolution: 'abstain',
    })
  }
  return {
    version: GRAPH_VERSION,
    stage: 'pre-event-source-primitives',
    mode: 'independent-shadow-observation',
    scope: { page, systemIndex, measureNumber },
    independence: {
      readsFinalEvents: false,
      readsMusicXml: false,
      readsVoices: false,
      readsReconstructedOnsets: false,
      readsTopologyFamily: false,
      readsTruthOrEvaluator: false,
    },
    geometry: { staffSpacePx: round(space, 2), bucketWidthPx: round(pairGraph.bucketWidth, 2) },
    nodes,
    relations: finalRelations,
    attackCandidates: pairGraph.attackCandidates,
    laneEvidence,
    ambiguities,
    zeroEvidence,
    diagnostics: {
      nodes: nodes.length,
      relations: finalRelations.length,
      attacks: pairGraph.attackCandidates.length,
      laneEvidence: laneEvidence.length,
      ambiguities: ambiguities.length,
      zeroEvidence: zeroEvidence.length,
      candidatePairsConsidered: pairGraph.pairCount,
      theoreticalAllPairs: (physicalNotes.length * (physicalNotes.length - 1)) / 2,
      constructionMs: round(elapsed, 3),
    },
  }
}

export function summarizeSourceRelationGraph(graph) {
  const nodeKinds = {}
  const relationKinds = {}
  for (const node of graph?.nodes ?? []) nodeKinds[node.kind] = (nodeKinds[node.kind] ?? 0) + 1
  for (const relation of graph?.relations ?? []) {
    relationKinds[relation.type] = (relationKinds[relation.type] ?? 0) + 1
  }
  return {
    version: graph?.version ?? GRAPH_VERSION,
    measureCount: graph ? 1 : 0,
    nodes: graph?.nodes?.length ?? 0,
    relations: graph?.relations?.length ?? 0,
    attacks: graph?.attackCandidates?.length ?? 0,
    laneEvidence: graph?.laneEvidence?.length ?? 0,
    ambiguities: graph?.ambiguities?.length ?? 0,
    zeroEvidence: graph?.zeroEvidence?.length ?? 0,
    candidatePairsConsidered: graph?.diagnostics?.candidatePairsConsidered ?? 0,
    theoreticalAllPairs: graph?.diagnostics?.theoreticalAllPairs ?? 0,
    constructionMs: graph?.diagnostics?.constructionMs ?? 0,
    nodeKinds: Object.fromEntries(Object.entries(nodeKinds).sort()),
    relationKinds: Object.fromEntries(Object.entries(relationKinds).sort()),
  }
}

export function aggregateSourceRelationGraphs(pages = []) {
  const total = {
    version: GRAPH_VERSION,
    measureCount: 0,
    nodes: 0,
    relations: 0,
    attacks: 0,
    laneEvidence: 0,
    ambiguities: 0,
    zeroEvidence: 0,
    candidatePairsConsidered: 0,
    theoreticalAllPairs: 0,
    constructionMs: 0,
    maxMeasureConstructionMs: 0,
    maxMeasureNodes: 0,
    maxMeasureRelations: 0,
    nodeKinds: {},
    relationKinds: {},
  }
  for (const page of pages ?? []) {
    for (const system of page.systems ?? []) {
      for (const measure of system.measures ?? []) {
        if (!measure.sourceRelationGraph) continue
        const summary = summarizeSourceRelationGraph(measure.sourceRelationGraph)
        total.measureCount += 1
        for (const key of [
          'nodes',
          'relations',
          'attacks',
          'laneEvidence',
          'ambiguities',
          'zeroEvidence',
          'candidatePairsConsidered',
          'theoreticalAllPairs',
          'constructionMs',
        ]) total[key] += summary[key]
        total.maxMeasureConstructionMs = Math.max(total.maxMeasureConstructionMs, summary.constructionMs)
        total.maxMeasureNodes = Math.max(total.maxMeasureNodes, summary.nodes)
        total.maxMeasureRelations = Math.max(total.maxMeasureRelations, summary.relations)
        for (const [kind, count] of Object.entries(summary.nodeKinds)) total.nodeKinds[kind] = (total.nodeKinds[kind] ?? 0) + count
        for (const [kind, count] of Object.entries(summary.relationKinds)) total.relationKinds[kind] = (total.relationKinds[kind] ?? 0) + count
      }
    }
  }
  total.constructionMs = round(total.constructionMs, 3)
  total.maxMeasureConstructionMs = round(total.maxMeasureConstructionMs, 3)
  total.pairReductionRate = total.theoreticalAllPairs > 0
    ? round(1 - total.candidatePairsConsidered / total.theoreticalAllPairs)
    : 0
  total.nodeKinds = Object.fromEntries(Object.entries(total.nodeKinds).sort())
  total.relationKinds = Object.fromEntries(Object.entries(total.relationKinds).sort())
  total.display = [
    `NODES ${total.nodes}`,
    `RELATIONS ${total.relations}`,
    `ATTACKS ${total.attacks}`,
    `LANE EVIDENCE ${total.laneEvidence}`,
    `AMBIGUITIES ${total.ambiguities}`,
  ]
  return total
}

export function formatSourceRelationGraphDiagnostics(graphOrSummary) {
  const summary = graphOrSummary?.diagnostics
    ? summarizeSourceRelationGraph(graphOrSummary)
    : graphOrSummary ?? summarizeSourceRelationGraph(null)
  return [
    `NODES ${summary.nodes ?? 0}`,
    `RELATIONS ${summary.relations ?? 0}`,
    `ATTACKS ${summary.attacks ?? 0}`,
    `LANE EVIDENCE ${summary.laneEvidence ?? 0}`,
    `AMBIGUITIES ${summary.ambiguities ?? 0}`,
  ].join('\n')
}
