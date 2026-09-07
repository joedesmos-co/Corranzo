import { createHash } from 'node:crypto'
import {
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import JSZip from 'jszip'
import {
  attr,
  childNodes,
  childText,
  findChild,
  findChildren,
  numberOf,
  parseXmlOrdered,
  rootElement,
  textOf,
} from '../../src/features/musicxml/xmlTree.js'
import { matchSourceRestsToTruth } from './rest-alignment.mjs'
import { writtenTupletGroups } from './tuplet-structure.mjs'

export const ASSEMBLER_VERSION = 'phase212v-source-gold-v2'
export const FAMILIES = [
  'PITCH_STAFF',
  'DURATION',
  'ATTACK',
  'CHORD',
  'LANE',
  'LANE_CONTINUATION',
  'REST',
  'TUPLET',
  'TIE_SUSTAIN',
  'CROSS_STAFF',
  'SHARED_HEAD',
]

const STEP_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const KNOWN = 'KNOWN'
const AMBIGUOUS = 'AMBIGUOUS'
const UNAVAILABLE = 'UNAVAILABLE'
const round = (value, digits = 6) => {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}
const unique = (values) => [...new Set(values)]
const median = (values) => {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!ordered.length) return null
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2
}
const groupBy = (values, keyFor) => {
  const result = new Map()
  for (const value of values) {
    const key = keyFor(value)
    if (!result.has(key)) result.set(key, [])
    result.get(key).push(value)
  }
  return result
}
const stableHash = (value) => createHash('sha256').update(
  typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value),
).digest('hex')
const readJson = (filePath) => JSON.parse(readFileSync(filePath, 'utf8'))
const writeJson = (filePath, value) => writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)

export async function readScoreXml(scorePath) {
  const bytes = readFileSync(scorePath)
  if (!scorePath.toLowerCase().endsWith('.mxl')) {
    return { xml: bytes.toString('utf8'), rootPath: path.basename(scorePath) }
  }
  const zip = await JSZip.loadAsync(bytes)
  const container = zip.file('META-INF/container.xml')
  const containerXml = container ? await container.async('string') : ''
  let rootPath = containerXml.match(/full-path="([^"]+)"/)?.[1] ?? null
  if (!rootPath || !zip.file(rootPath)) {
    rootPath = Object.keys(zip.files).find(
      (entry) => /\.(musicxml|xml)$/i.test(entry) && !entry.startsWith('META-INF/'),
    )
  }
  if (!rootPath || !zip.file(rootPath)) throw new Error(`No score root in ${scorePath}`)
  return { xml: await zip.file(rootPath).async('string'), rootPath }
}

function readPitch(pitchNode) {
  if (!pitchNode) return { midi: null, writtenPitch: null }
  const step = String(childText(pitchNode, 'step') ?? '').toUpperCase()
  const octave = numberOf(childText(pitchNode, 'octave'), NaN)
  if (!(step in STEP_TO_SEMITONE) || !Number.isFinite(octave)) {
    return { midi: null, writtenPitch: null }
  }
  const alterNode = findChild(pitchNode, 'alter')
  const alter = alterNode ? numberOf(textOf(alterNode), 0) : null
  const soundingAlter = Number.isFinite(alter) ? alter : 0
  return {
    midi: Math.round((octave + 1) * 12 + STEP_TO_SEMITONE[step] + soundingAlter),
    writtenPitch: { step, alter: Number.isFinite(alter) ? alter : null, octave },
  }
}

function readTieFacts(noteNode) {
  const facts = { tieStart: false, tieStop: false, tiePlacement: null }
  for (const tie of findChildren(noteNode, 'tie')) {
    if (attr(tie, 'type') === 'start') facts.tieStart = true
    if (attr(tie, 'type') === 'stop') facts.tieStop = true
  }
  const notations = findChild(noteNode, 'notations')
  for (const tied of notations ? findChildren(notations, 'tied') : []) {
    if (attr(tied, 'type') === 'start') facts.tieStart = true
    if (attr(tied, 'type') === 'stop') facts.tieStop = true
    facts.tiePlacement ??= attr(tied, 'placement') ?? null
  }
  return facts
}

function readAuxiliaryFacts(noteNode) {
  const notations = findChild(noteNode, 'notations')
  const articulationsNode = notations ? findChild(notations, 'articulations') : null
  const ornamentsNode = notations ? findChild(notations, 'ornaments') : null
  const articulationNames = articulationsNode
    ? childNodes(articulationsNode).map((node) => node.tag).filter(Boolean)
    : []
  const ornamentNames = ornamentsNode
    ? childNodes(ornamentsNode).map((node) => node.tag).filter(Boolean)
    : []
  const tremolo = ornamentsNode ? findChild(ornamentsNode, 'tremolo') : null
  const tupletMarks = notations
    ? findChildren(notations, 'tuplet').map((node) => ({
        type: attr(node, 'type') ?? null,
        number: attr(node, 'number') ?? '1',
        bracket: attr(node, 'bracket') ?? null,
        placement: attr(node, 'placement') ?? null,
        ratio: findChild(node, 'tuplet-actual') && findChild(node, 'tuplet-normal') ? {
          actualNotes: numberOf(childText(findChild(node, 'tuplet-actual'), 'tuplet-number'), null),
          normalNotes: numberOf(childText(findChild(node, 'tuplet-normal'), 'tuplet-number'), null),
        } : null,
      }))
    : []
  return {
    articulations: articulationNames,
    ornaments: ornamentNames,
    tremolo: tremolo ? { type: attr(tremolo, 'type') ?? null, marks: textOf(tremolo) ?? null } : null,
    arpeggiate: Boolean(notations && findChild(notations, 'arpeggiate')),
    tupletMarks,
    slurs: notations
      ? findChildren(notations, 'slur').map((node) => ({
          type: attr(node, 'type') ?? null,
          number: attr(node, 'number') ?? '1',
          placement: attr(node, 'placement') ?? null,
        }))
      : [],
  }
}

function measureNumberOf(measureNode, index) {
  const parsed = Number(String(attr(measureNode, 'number') ?? '').split('.')[0])
  return Number.isFinite(parsed) ? parsed : index + 1
}

/**
 * Parse written notation without playback tie merging. This intentionally
 * avoids parseMusicXml's performed-duration mutation so written duration and
 * tie/sustain remain separate target facts.
 */
export function parseWrittenNotation(xml, fileName = 'score.musicxml') {
  const parsed = parseXmlOrdered(xml)
  const score = rootElement(parsed, 'score-partwise')
  if (!score) throw new Error(`No MusicXML root in ${fileName}`)
  const partList = findChild(score, 'part-list')
  const partNames = new Map()
  for (const scorePart of partList ? findChildren(partList, 'score-part') : []) {
    const id = attr(scorePart, 'id')
    if (id) partNames.set(id, childText(scorePart, 'part-name') ?? id)
  }
  const notes = []
  const measures = []
  const parts = []
  const directions = []
  const partNodes = findChildren(score, 'part')

  partNodes.forEach((partNode, partIndex) => {
    const partId = attr(partNode, 'id') ?? `P${partIndex + 1}`
    let divisions = 1
    let beats = 4
    let beatType = 4
    let absoluteQuarter = 0
    const clefsByStaff = new Map()
    const keysByStaff = new Map()
    let staves = 1
    let serial = 0
    const partMeasures = findChildren(partNode, 'measure')

    partMeasures.forEach((measureNode, measureIndex) => {
      const measureNumber = measureNumberOf(measureNode, measureIndex)
      let cursorDivisions = 0
      let maxCursorDivisions = 0
      let lastNoteStartDivisions = 0
      let measureBeats = beats
      let measureBeatType = beatType
      let measureDivisions = divisions
      const marking = { forwardRepeat: false, backwardRepeat: false, endings: [] }

      for (const child of childNodes(measureNode)) {
        if (child.tag === 'attributes') {
          const nextDivisions = numberOf(childText(child, 'divisions'), NaN)
          if (Number.isFinite(nextDivisions) && nextDivisions > 0) divisions = nextDivisions
          measureDivisions = divisions
          const stavesValue = numberOf(childText(child, 'staves'), NaN)
          if (Number.isFinite(stavesValue) && stavesValue > staves) staves = stavesValue
          const time = findChild(child, 'time')
          if (time) {
            const nextBeats = numberOf(childText(time, 'beats'), NaN)
            const nextBeatType = numberOf(childText(time, 'beat-type'), NaN)
            if (Number.isFinite(nextBeats) && nextBeats > 0) beats = nextBeats
            if (Number.isFinite(nextBeatType) && nextBeatType > 0) beatType = nextBeatType
            measureBeats = beats
            measureBeatType = beatType
          }
          for (const clef of findChildren(child, 'clef')) {
            const staff = Math.max(1, numberOf(attr(clef, 'number'), 1))
            clefsByStaff.set(staff, {
              sign: childText(clef, 'sign') ?? null,
              line: numberOf(childText(clef, 'line'), null),
              octaveChange: numberOf(childText(clef, 'clef-octave-change'), 0),
              measureNumber,
            })
          }
          for (const key of findChildren(child, 'key')) {
            const rawStaff = numberOf(attr(key, 'number'), NaN)
            const staff = Number.isFinite(rawStaff) ? rawStaff : null
            keysByStaff.set(staff, {
              fifths: numberOf(childText(key, 'fifths'), 0),
              mode: childText(key, 'mode') ?? null,
              measureNumber,
            })
          }
          continue
        }
        if (child.tag === 'backup') {
          cursorDivisions = Math.max(0, cursorDivisions - numberOf(childText(child, 'duration'), 0))
          lastNoteStartDivisions = cursorDivisions
          continue
        }
        if (child.tag === 'forward') {
          cursorDivisions += numberOf(childText(child, 'duration'), 0)
          maxCursorDivisions = Math.max(maxCursorDivisions, cursorDivisions)
          lastNoteStartDivisions = cursorDivisions
          continue
        }
        if (child.tag === 'barline') {
          const repeat = findChild(child, 'repeat')
          const ending = findChild(child, 'ending')
          if (attr(repeat, 'direction') === 'forward') marking.forwardRepeat = true
          if (attr(repeat, 'direction') === 'backward') marking.backwardRepeat = true
          if (ending) marking.endings.push({
            type: attr(ending, 'type') ?? null,
            number: attr(ending, 'number') ?? null,
          })
          continue
        }
        if (child.tag === 'direction') {
          const directionTypes = findChildren(child, 'direction-type')
          const words = directionTypes.flatMap((node) => findChildren(node, 'words').map(textOf)).filter(Boolean)
          const dynamics = directionTypes.flatMap((node) => {
            const dynamicsNode = findChild(node, 'dynamics')
            return dynamicsNode ? childNodes(dynamicsNode).map((entry) => entry.tag).filter(Boolean) : []
          })
          const pedals = directionTypes.flatMap((node) => findChildren(node, 'pedal').map((entry) => ({
            type: attr(entry, 'type') ?? null,
            line: attr(entry, 'line') ?? null,
          })))
          const ottavas = directionTypes.flatMap((node) => findChildren(node, 'octave-shift').map((entry) => ({
            type: attr(entry, 'type') ?? null,
            size: numberOf(attr(entry, 'size'), null),
            number: attr(entry, 'number') ?? '1',
          })))
          const metronomes = directionTypes.flatMap((node) => findChildren(node, 'metronome').map((entry) => ({
            beatUnit: childText(entry, 'beat-unit') ?? null,
            perMinute: numberOf(childText(entry, 'per-minute'), null),
          })))
          const sound = findChild(child, 'sound')
          directions.push({
            partId,
            measureNumber,
            offsetQuarters: round(cursorDivisions / divisions),
            staff: numberOf(childText(child, 'staff'), null),
            words,
            dynamics,
            pedals,
            ottavas,
            tempo: numberOf(attr(sound, 'tempo'), null),
            metronomes,
            navigation: sound ? {
              dacapo: attr(sound, 'dacapo') ?? null,
              dalsegno: attr(sound, 'dalsegno') ?? null,
              tocoda: attr(sound, 'tocoda') ?? null,
              fine: attr(sound, 'fine') ?? null,
            } : null,
          })
          continue
        }
        if (child.tag !== 'note') continue

        const isChord = findChild(child, 'chord') != null
        const isGrace = findChild(child, 'grace') != null
        const isRest = findChild(child, 'rest') != null
        const durationDivisions = numberOf(childText(child, 'duration'), 0)
        const startDivisions = isChord ? lastNoteStartDivisions : cursorDivisions
        const staff = Math.max(1, numberOf(childText(child, 'staff'), 1))
        const voice = Math.max(1, numberOf(childText(child, 'voice'), 1))
        const pitch = readPitch(isRest ? null : findChild(child, 'pitch'))
        const accidentalNode = findChild(child, 'accidental')
        const timeModification = findChild(child, 'time-modification')
        const auxiliary = readAuxiliaryFacts(child)
        const stem = String(childText(child, 'stem') ?? '').toLowerCase()
        serial += 1
        notes.push({
          id: `${partId}-m${measureNumber}-n${serial}`,
          partId,
          partIndex,
          measureNumber,
          measureIndex,
          measureStartQuarters: absoluteQuarter,
          offsetQuarters: round(startDivisions / divisions),
          absoluteOrder: measureIndex * 1000 + startDivisions / divisions,
          durationDivisions,
          divisions,
          durationQuarters: round(durationDivisions / divisions),
          noteType: childText(child, 'type') ?? null,
          dots: findChildren(child, 'dot').length,
          isChord,
          isGrace,
          isRest,
          voice,
          staff,
          ...pitch,
          accidental: accidentalNode ? {
            type: String(textOf(accidentalNode) ?? '').trim() || null,
            cautionary: attr(accidentalNode, 'cautionary') === 'yes',
            editorial: attr(accidentalNode, 'editorial') === 'yes',
            parentheses: attr(accidentalNode, 'parentheses') === 'yes',
          } : null,
          keySignature: keysByStaff.get(staff) ?? keysByStaff.get(null) ?? null,
          clefContext: clefsByStaff.get(staff) ?? null,
          timeModification: timeModification ? {
            actualNotes: numberOf(childText(timeModification, 'actual-notes'), null),
            normalNotes: numberOf(childText(timeModification, 'normal-notes'), null),
            normalType: childText(timeModification, 'normal-type') ?? null,
          } : null,
          stemDirection: stem === 'up' || stem === 'down' ? stem : null,
          beams: findChildren(child, 'beam').map((beam) => ({
            number: Math.max(1, numberOf(attr(beam, 'number'), 1)),
            value: String(textOf(beam) ?? '').trim().toLowerCase(),
          })),
          ...readTieFacts(child),
          ...auxiliary,
        })
        if (!isChord) lastNoteStartDivisions = startDivisions
        if (!isChord && !isGrace) {
          cursorDivisions += durationDivisions
          maxCursorDivisions = Math.max(maxCursorDivisions, cursorDivisions)
        }
      }

      const observedLength = maxCursorDivisions / Math.max(1, measureDivisions)
      const nominalLength = measureBeats * (4 / measureBeatType)
      const lengthQuarters = observedLength > 0 ? observedLength : nominalLength
      if (partIndex === 0) {
        measures.push({
          measureNumber,
          measureIndex,
          startQuarters: round(absoluteQuarter),
          lengthQuarters: round(lengthQuarters),
          divisions: measureDivisions,
          beats: measureBeats,
          beatType: measureBeatType,
          marking,
        })
      }
      absoluteQuarter += lengthQuarters
    })
    parts.push({ id: partId, name: partNames.get(partId) ?? partId, staves, measures: partMeasures.length })
  })

  return { fileName, notes, measures, parts, directions }
}

function physicalKey(note) {
  return [note.partId, note.staff, note.midi, round(note.offsetQuarters), note.isGrace ? 'grace' : 'normal'].join('|')
}

export function measureTruth(notation, measureNumber) {
  const notes = notation.notes.filter((note) => note.measureNumber === measureNumber)
  const sounded = notes.filter((note) => !note.isRest && Number.isFinite(note.midi))
  const physicalGroups = [...groupBy(sounded, physicalKey).entries()].map(([key, roles]) => ({
    key,
    representative: roles[0],
    roles,
  }))
  return {
    notes,
    sounded,
    physicalGroups,
    rests: notes.filter((note) => note.isRest),
    measure: notation.measures.find((measure) => measure.measureNumber === measureNumber) ?? null,
  }
}

/** Match only after scope/object identity is frozen. Semantic fields label an
 * existing source object; they never choose a page/system/scope or move it. */
export function matchAnchorsToPhysical(anchors, physicalGroups) {
  const mapping = new Map()
  const unmatchedAnchors = new Set(anchors.map((anchor) => anchor.sourceNoteheadId))
  const unmatchedPhysical = new Set(physicalGroups.map((group) => group.key))
  const anchorById = new Map(anchors.map((anchor) => [anchor.sourceNoteheadId, anchor]))
  const physicalByKey = new Map(physicalGroups.map((group) => [group.key, group]))

  for (const includeStaff of [true, false]) {
    const truthGroups = groupBy(
      [...unmatchedPhysical].map((key) => physicalByKey.get(key)),
      (group) => `${group.representative.midi}|${includeStaff ? group.representative.staff : '*'}`,
    )
    const sourceGroups = groupBy(
      [...unmatchedAnchors].map((id) => anchorById.get(id)),
      (anchor) => `${anchor.midi}|${includeStaff ? Number(anchor.staffIndex) + 1 : '*'}`,
    )
    for (const [key, truthGroup] of truthGroups) {
      const sourceGroup = sourceGroups.get(key) ?? []
      if (!truthGroup.length || sourceGroup.length !== truthGroup.length) continue
      const orderedTruth = [...truthGroup].sort((left, right) =>
        left.representative.offsetQuarters - right.representative.offsetQuarters ||
        left.representative.durationQuarters - right.representative.durationQuarters ||
        left.representative.staff - right.representative.staff,
      )
      const orderedSource = [...sourceGroup].sort((left, right) =>
        left.sourceCenter.x - right.sourceCenter.x || left.sourceCenter.y - right.sourceCenter.y,
      )
      orderedTruth.forEach((physical, index) => {
        const anchor = orderedSource[index]
        const repeated = truthGroup.length > 1
        mapping.set(physical.key, {
          anchorId: anchor.sourceNoteheadId,
          method: includeStaff
            ? (repeated ? 'MONOTONIC_REPEATED_PITCH_STAFF' : 'UNIQUE_PITCH_STAFF')
            : 'PITCH_ONLY_FALLBACK',
          state: includeStaff ? KNOWN : AMBIGUOUS,
          confidence: includeStaff ? (repeated ? 0.9 : 1) : 0.5,
        })
        unmatchedPhysical.delete(physical.key)
        unmatchedAnchors.delete(anchor.sourceNoteheadId)
      })
    }
  }
  return {
    mapping,
    unmatchedAnchorIds: [...unmatchedAnchors],
    unmatchedPhysicalKeys: [...unmatchedPhysical],
    complete: unmatchedAnchors.size === 0 && unmatchedPhysical.size === 0 && anchors.length === physicalGroups.length,
  }
}

export function canonicalLaneCatalog(notation) {
  const sounded = notation.notes.filter((note) => !note.isRest && Number.isFinite(note.midi))
  const lanes = [...groupBy(sounded, (note) => `${note.partId}|${note.voice}`).entries()].map(([key, notes]) => ({
    key,
    partId: notes[0].partId,
    medianStaff: median(notes.map((note) => note.staff)),
    medianMidi: median(notes.map((note) => note.midi)),
    firstOrder: Math.min(...notes.map((note) => note.absoluteOrder)),
  }))
  const byPart = groupBy(lanes, (lane) => lane.partId)
  const result = new Map()
  for (const [partId, partLanes] of byPart) {
    partLanes.sort((left, right) =>
      left.medianStaff - right.medianStaff || right.medianMidi - left.medianMidi || left.firstOrder - right.firstOrder || left.key.localeCompare(right.key),
    )
    partLanes.forEach((lane, index) => result.set(lane.key, `${partId}:lane-${index + 1}`))
  }
  return result
}

function labelRecord({
  family,
  labelId,
  state,
  confidence,
  objectIndexes = [],
  externalObjectRefs = [],
  semanticEventIds = [],
  value = null,
  isPositive = true,
  reason = null,
  sourceEvidence,
  semanticEvidence,
}) {
  return {
    labelId,
    family,
    state,
    confidence: round(confidence),
    objectIndexes: unique(objectIndexes).sort((a, b) => a - b),
    ...(externalObjectRefs.length ? { externalObjectRefs } : {}),
    semanticEventIds: unique(semanticEventIds),
    value,
    isPositive,
    reason,
    provenance: {
      assemblerVersion: ASSEMBLER_VERSION,
      sourceEvidence,
      semanticEvidence,
    },
  }
}

function sourceStaffPosition(anchor, scope) {
  const role = Number(anchor.staffIndex) === 0 ? 'upper' : 'lower'
  const band = scope.staffBounds?.staffBands?.find((candidate) => candidate.staffRole === role)
  if (!band || !Number.isFinite(anchor.staffGap) || anchor.staffGap <= 0) {
    return { state: UNAVAILABLE, reason: 'NO_STABLE_STAFF_BAND_OR_GAP' }
  }
  return {
    state: KNOWN,
    representation: 'SOURCE_GEOMETRIC_STEPS_FROM_LOCAL_BAND_CENTER',
    stepsFromBandCenter: round((((band.y0 + band.y1) / 2) - anchor.sourceCenter.y) / anchor.staffGap, 3),
    sourceY: anchor.sourceCenter.y,
    staffGapNormalized: anchor.staffGap,
  }
}

function sourceRecordFor({ scope, anchors, matches, restObjects = [], manifestRecord, repoRoot }) {
  const anchorById = new Map(anchors.map((anchor) => [anchor.sourceNoteheadId, anchor]))
  const graphBySource = new Map(matches.map((match) => [match.sourceNoteheadId, match]))
  const noteheadObjects = scope.sourceObjectIds.map((sourceObjectId, objectIndex) => {
    const anchor = anchorById.get(sourceObjectId)
    const graph = graphBySource.get(sourceObjectId)
    return {
      objectIndex,
      kind: 'notehead',
      center: anchor?.sourceCenter ?? null,
      bounds: anchor?.sourceBBox ?? null,
      geometryConfidence: anchor?.confidence ?? null,
      geometrySource: anchor?.geometrySource ?? null,
      ...(graph ? {
        frozenGraphObservation: {
          center: graph.graphCenter,
          coordinateError: { dx: graph.dx, dy: graph.dy },
        },
      } : {}),
    }
  })
  const restPhysicalObjects = restObjects.map((rest, index) => ({
    objectIndex: noteheadObjects.length + index,
    kind: 'rest',
    center: rest.center,
    bounds: rest.bounds,
    geometryConfidence: rest.confidence,
    geometrySource: rest.provenance?.source ?? null,
    frozenSourceObservation: {
      staffRole: rest.staffRole,
      sourceRestState: rest.state,
      graphNominalMeasureUsedForScopeMatching: false,
    },
  }))
  const physicalObjects = [...noteheadObjects, ...restPhysicalObjects]
  const sourceObjectIds = [...scope.sourceObjectIds, ...restObjects.map((rest) => rest.sourceRestId)]
  return {
    metadata: {
      exampleId: scope.scopeId,
      scopeId: scope.scopeId,
      groupId: scope.groupId,
      split: manifestRecord.split,
      pairId: scope.pairId,
      page: scope.page,
      semanticMeasureNumber: scope.semanticMeasureNumber,
      renderedPagePath: path.join(
        repoRoot,
        'tmp/campaign/piano-vision-phase211/data/rendered',
        scope.groupId,
        `page-${scope.page}.png`,
      ),
      sourceObjectIds,
      eligibleScopeState: scope.state,
    },
    modelInput: {
      pixels: {
        required: true,
        cropBounds: scope.sourceBounds,
        contextPolicy: 'FULL_SYSTEM_PLUS_NEIGHBOR_SCOPES',
      },
      geometry: {
        coordinateSpace: 'pdf-source-normalized',
        pageTransform: scope.pageTransform,
        scopeBounds: scope.sourceBounds,
        staffBands: scope.staffBounds,
        barlineBoundaries: scope.barlineEvidence.map((entry) => ({
          x0: entry.x0,
          x1: entry.x1,
          confidence: entry.confidence,
          boundaryKind: entry.boundaryKind,
        })),
      },
      physicalObjects,
      sourceGraph: {
        state: UNAVAILABLE,
        nodes: physicalObjects.map((object) => ({
          nodeIndex: object.objectIndex,
          objectIndex: object.objectIndex,
          kind: object.kind,
          center: object.center,
          bounds: object.bounds,
        })),
        edges: [],
        reason: 'SEMANTIC_AND_PRODUCTION_CANDIDATE_EDGES_EXCLUDED_FROM_SOURCE_GOLD_V1',
      },
      availabilityMasks: {
        pixels: true,
        sourceGeometry: true,
        physicalObjects: physicalObjects.length > 0,
        printedRests: restPhysicalObjects.length > 0,
        sourceGraphEdges: false,
      },
    },
  }
}

const FORBIDDEN_MODEL_INPUT_KEYS = new Set([
  'midi',
  'pitch',
  'writtenPitch',
  'accidental',
  'duration',
  'durationQuarters',
  'durationDivisions',
  'onset',
  'offsetQuarters',
  'voice',
  'lane',
  'attack',
  'chord',
  'tie',
  'tuplet',
  'semanticMeasureNumber',
  'graphMeasureNumber',
])

export function findFirewallViolations(value, pathParts = ['modelInput']) {
  const violations = []
  if (Array.isArray(value)) {
    value.forEach((entry, index) => violations.push(...findFirewallViolations(entry, [...pathParts, index])))
    return violations
  }
  if (!value || typeof value !== 'object') return violations
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_MODEL_INPUT_KEYS.has(key)) violations.push([...pathParts, key].join('.'))
    violations.push(...findFirewallViolations(child, [...pathParts, key]))
  }
  return violations
}

function stateForObjects(refs, scopeState) {
  if (scopeState !== KNOWN) return { state: AMBIGUOUS, confidence: 0.25, reason: 'SOURCE_SCOPE_NOT_KNOWN' }
  if (!refs.length || refs.some((ref) => ref == null)) {
    return { state: UNAVAILABLE, confidence: 0, reason: 'NO_FROZEN_SOURCE_OBJECT_MAPPING' }
  }
  if (refs.some((ref) => ref.matchState === AMBIGUOUS)) {
    return { state: AMBIGUOUS, confidence: 0.5, reason: 'PITCH_ONLY_FALLBACK_MAPPING' }
  }
  return {
    state: KNOWN,
    confidence: Math.min(...refs.map((ref) => ref.confidence ?? 1)),
    reason: null,
  }
}

export function buildTupletLabels({ truth, eventRef, scope, scopeId }) {
  return writtenTupletGroups(truth.notes).map((group, index) => {
    const refs = group.roles.map(note => eventRef.get(note.id) ?? null)
    const status = stateForObjects(refs, scope.state)
    const trustworthy = !group.reason
    return labelRecord({
      family: 'TUPLET', labelId: `${scopeId}:tuplet-${index + 1}`,
      state: trustworthy ? status.state : UNAVAILABLE,
      confidence: trustworthy ? status.confidence : 0,
      objectIndexes: refs.filter(Boolean).map(ref => ref.objectIndex),
      semanticEventIds: group.roles.map(note => note.id),
      value: {
        ratio: group.ratio ?? null,
        startOffsetQuarters: group.roles[0]?.offsetQuarters ?? null,
        endOffsetQuarters: group.roles.at(-1)?.offsetQuarters ?? null,
        memberEventCount: new Set(group.roles.map(note => note.offsetQuarters)).size,
        boundaryNumber: group.number ?? null, nestingDepth: group.depth ?? null,
        sourceMark: group.marks.length
          ? { state: trustworthy ? KNOWN : UNAVAILABLE, marks: group.marks }
          : { state: UNAVAILABLE, reason: 'NO_EXPLICIT_MUSICXML_TUPLET_MARK' },
      },
      reason: group.reason ?? status.reason,
      sourceEvidence: 'frozen source notehead/rest mappings inside a source-coordinate scope',
      semanticEvidence: 'MusicXML explicit numbered tuplet start/stop boundaries; ratio alone does not establish a span',
    })
  })
}

export function buildRestLabels({ truth, scope, restObjects, restMapping, objectIndexById, laneCatalog, eventRef = new Map() }) {
  const labels = []
  truth.rests.forEach((note, index) => {
    const match = restMapping?.mapping.get(note.id) ?? null
    const objectIndex = match ? objectIndexById.get(match.sourceRestId) : null
    const sourceMapped = match && Number.isInteger(objectIndex) && scope.state === KNOWN
    if (sourceMapped) eventRef.set(note.id, { objectIndex, matchState: match.state, confidence: match.confidence })
    labels.push(labelRecord({
      family: 'REST',
      labelId: `${scope.scopeId}:rest-${index + 1}`,
      state: sourceMapped ? match.state : UNAVAILABLE,
      confidence: sourceMapped ? match.confidence * scope.confidence : 0,
      objectIndexes: sourceMapped ? [objectIndex] : [],
      semanticEventIds: [note.id],
      value: {
        laneRole: laneCatalog.get(`${note.partId}|${note.voice}`) ?? null,
        durationDivisions: note.durationDivisions,
        divisions: note.divisions,
        divisionsNormalizedQuarters: note.durationQuarters,
        writtenType: note.noteType,
        dots: note.dots,
      },
      reason: sourceMapped
        ? null
        : (restObjects.length
            ? 'NO_HIGH_CONFIDENCE_FROZEN_SOURCE_REST_OBJECT_MATCH'
            : 'NO_FROZEN_SOURCE_REST_OBJECT_ALIGNMENT_IN_PHASE212S'),
      sourceEvidence: sourceMapped
        ? `frozen printed-rest object ${match.sourceRestId} via ${match.method}`
        : 'source-coordinate scope has no unique trusted rest-object attachment',
      semanticEvidence: 'MusicXML explicit rest event',
    }))
  })
  for (const sourceRestId of restMapping?.unmatchedSourceIds ?? []) {
    labels.push(labelRecord({
      family: 'REST',
      labelId: `${scope.scopeId}:unmatched-source-rest-${sourceRestId}`,
      state: UNAVAILABLE,
      confidence: 0,
      objectIndexes: [objectIndexById.get(sourceRestId)].filter(Number.isInteger),
      value: null,
      isPositive: true,
      reason: 'SOURCE_REST_HAS_NO_UNIQUE_MUSICXML_EVENT',
      sourceEvidence: `frozen printed-rest object ${sourceRestId}`,
      semanticEvidence: 'no unique compatible MusicXML rest event',
    }))
  }

  return labels
}

export function targetRecordFor({
  scope,
  truth,
  mapping,
  anchors,
  laneCatalog,
  manifestRecord,
  globalRelations,
  restObjects = [],
  restMapping = null,
}) {
  const anchorById = new Map(anchors.map((anchor) => [anchor.sourceNoteheadId, anchor]))
  const objectIndexById = new Map(scope.sourceObjectIds.map((id, index) => [id, index]))
  restObjects.forEach((rest, index) => objectIndexById.set(rest.sourceRestId, scope.sourceObjectIds.length + index))
  const eventRef = new Map()
  const physicalRef = new Map()
  for (const physical of truth.physicalGroups) {
    const match = mapping.mapping.get(physical.key)
    const objectIndex = match ? objectIndexById.get(match.anchorId) : null
    const ref = match && Number.isInteger(objectIndex) ? {
      objectIndex,
      sourceObjectId: match.anchorId,
      matchState: match.state,
      confidence: match.confidence,
      method: match.method,
    } : null
    physicalRef.set(physical.key, ref)
    physical.roles.forEach((role) => eventRef.set(role.id, ref))
  }

  const families = Object.fromEntries(FAMILIES.map((family) => [family, []]))
  let serial = 0
  for (const physical of truth.physicalGroups) {
    const ref = physicalRef.get(physical.key)
    const status = stateForObjects(ref ? [ref] : [], scope.state)
    const representative = physical.representative
    const anchor = ref ? anchorById.get(ref.sourceObjectId) : null
    const writtenPitches = unique(physical.roles.map((note) => JSON.stringify(note.writtenPitch))).map(JSON.parse)
    const staffValues = unique(physical.roles.map((note) => note.staff))
    const pitchConsistent = writtenPitches.length === 1 && staffValues.length === 1
    serial += 1
    families.PITCH_STAFF.push(labelRecord({
      family: 'PITCH_STAFF',
      labelId: `${scope.scopeId}:pitch-${serial}`,
      state: pitchConsistent ? status.state : AMBIGUOUS,
      confidence: pitchConsistent ? status.confidence * scope.confidence : Math.min(status.confidence, 0.4),
      objectIndexes: ref ? [ref.objectIndex] : [],
      semanticEventIds: physical.roles.map((note) => note.id),
      value: {
        staff: representative.staff,
        staffRole: representative.staff === 1 ? 'upper' : representative.staff === 2 ? 'lower' : `staff-${representative.staff}`,
        staffPosition: anchor ? sourceStaffPosition(anchor, scope) : { state: UNAVAILABLE, reason: 'NO_SOURCE_OBJECT' },
        writtenPitch: representative.writtenPitch,
        midiTargetMetadata: representative.midi,
        accidentalState: {
          printed: representative.accidental,
          writtenAlter: representative.writtenPitch?.alter ?? null,
          keyContext: representative.keySignature,
        },
        clefContext: representative.clefContext
          ? { state: KNOWN, value: representative.clefContext }
          : { state: UNAVAILABLE, reason: 'NO_ACTIVE_MUSICXML_CLEF_DECLARATION' },
      },
      reason: pitchConsistent ? status.reason : 'MULTIPLE_WRITTEN_PITCH_OR_STAFF_VALUES_FOR_ONE_PHYSICAL_HEAD',
      sourceEvidence: ref ? `frozen source object ${ref.sourceObjectId} via ${ref.method}` : 'no frozen source-object mapping',
      semanticEvidence: 'MusicXML written pitch/staff/accidental/key/clef fields',
    }))

    for (const note of physical.roles) {
      const durationKnown = Number.isFinite(note.durationQuarters) && (note.isGrace || note.durationQuarters > 0)
      families.DURATION.push(labelRecord({
        family: 'DURATION',
        labelId: `${scope.scopeId}:duration-${note.id}`,
        state: durationKnown ? status.state : UNAVAILABLE,
        confidence: durationKnown ? status.confidence * scope.confidence : 0,
        objectIndexes: ref ? [ref.objectIndex] : [],
        semanticEventIds: [note.id],
        value: {
          writtenType: note.noteType,
          durationDivisions: note.durationDivisions,
          divisions: note.divisions,
          divisionsNormalizedQuarters: note.durationQuarters,
          dots: note.dots,
          timeModification: note.timeModification,
          grace: note.isGrace,
          tieStart: note.tieStart,
          tieStop: note.tieStop,
        },
        reason: durationKnown ? status.reason : 'MUSICXML_WRITTEN_DURATION_UNAVAILABLE',
        sourceEvidence: ref ? 'frozen source notehead mapping' : 'no frozen source-object mapping',
        semanticEvidence: 'raw MusicXML duration/divisions/type/dot/time-modification/grace/tie fields before playback merging',
      }))
    }
  }

  mapping.unmatchedAnchorIds.forEach((sourceObjectId, index) => {
    families.PITCH_STAFF.push(labelRecord({
      family: 'PITCH_STAFF',
      labelId: `${scope.scopeId}:unmatched-source-${index + 1}`,
      state: AMBIGUOUS,
      confidence: 0.2,
      objectIndexes: [objectIndexById.get(sourceObjectId)].filter(Number.isInteger),
      value: null,
      reason: 'SOURCE_OBJECT_HAS_NO_UNIQUE_MUSICXML_EVENT',
      sourceEvidence: `frozen source object ${sourceObjectId}`,
      semanticEvidence: 'no unique MusicXML event match',
    }))
  })

  const attacks = [...groupBy(truth.physicalGroups, (group) => group.representative.offsetQuarters).values()]
  attacks.forEach((members, index) => {
    const refs = members.map((member) => physicalRef.get(member.key))
    const status = stateForObjects(refs, scope.state)
    families.ATTACK.push(labelRecord({
      family: 'ATTACK',
      labelId: `${scope.scopeId}:attack-${index + 1}`,
      state: status.state,
      confidence: status.confidence * scope.confidence,
      objectIndexes: refs.filter(Boolean).map((ref) => ref.objectIndex),
      semanticEventIds: members.flatMap((member) => member.roles.map((note) => note.id)),
      value: { localAttackOrdinal: index + 1, onsetQuarters: members[0].representative.offsetQuarters, memberHeads: members.length },
      isPositive: members.length > 1,
      reason: status.reason,
      sourceEvidence: 'frozen source noteheads in one source-coordinate scope',
      semanticEvidence: 'MusicXML measure-relative onset equality',
    }))
  })

  const chordGroups = [...groupBy(truth.physicalGroups, (group) => {
    const note = group.representative
    return `${note.partId}|${note.voice}|${note.offsetQuarters}`
  }).values()].filter((members) => members.length > 1 || members.some((member) => member.roles.some((note) => note.isChord)))
  chordGroups.forEach((members, index) => {
    const refs = members.map((member) => physicalRef.get(member.key))
    const status = stateForObjects(refs, scope.state)
    families.CHORD.push(labelRecord({
      family: 'CHORD',
      labelId: `${scope.scopeId}:chord-${index + 1}`,
      state: status.state,
      confidence: status.confidence * scope.confidence,
      objectIndexes: refs.filter(Boolean).map((ref) => ref.objectIndex),
      semanticEventIds: members.flatMap((member) => member.roles.map((note) => note.id)),
      value: { localChordOrdinal: index + 1, memberHeads: members.length },
      isPositive: members.length > 1,
      reason: status.reason,
      sourceEvidence: 'frozen source notehead mappings',
      semanticEvidence: 'MusicXML part/voice/onset chord event identity',
    }))
  })

  truth.physicalGroups.forEach((physical, index) => {
    const ref = physicalRef.get(physical.key)
    const status = stateForObjects(ref ? [ref] : [], scope.state)
    const note = physical.representative
    families.LANE.push(labelRecord({
      family: 'LANE',
      labelId: `${scope.scopeId}:lane-${index + 1}`,
      state: status.state,
      confidence: status.confidence * scope.confidence,
      objectIndexes: ref ? [ref.objectIndex] : [],
      semanticEventIds: physical.roles.map((role) => role.id),
      value: { laneRole: laneCatalog.get(`${note.partId}|${note.voice}`) ?? null },
      reason: status.reason,
      sourceEvidence: 'frozen source notehead mapping',
      semanticEvidence: 'MusicXML voice used offline to derive score-local canonical lane role; raw voice number not emitted',
    }))
  })

  families.REST.push(...buildRestLabels({ truth, scope, restObjects, restMapping, objectIndexById, laneCatalog, eventRef }))

  families.TUPLET.push(...buildTupletLabels({ truth, eventRef, scope, scopeId: scope.scopeId }))

  for (const family of ['LANE_CONTINUATION', 'TIE_SUSTAIN', 'CROSS_STAFF']) {
    for (const relation of globalRelations[family].get(scope.scopeId) ?? []) families[family].push(relation)
  }

  const shared = truth.physicalGroups.filter((physical) => physical.roles.length > 1)
  shared.forEach((physical, index) => {
    const ref = physicalRef.get(physical.key)
    const status = stateForObjects(ref ? [ref] : [], scope.state)
    families.SHARED_HEAD.push(labelRecord({
      family: 'SHARED_HEAD',
      labelId: `${scope.scopeId}:shared-${index + 1}`,
      state: status.state,
      confidence: status.confidence * scope.confidence,
      objectIndexes: ref ? [ref.objectIndex] : [],
      semanticEventIds: physical.roles.map((note) => note.id),
      value: { semanticRoleCount: physical.roles.length, laneRoles: unique(physical.roles.map((note) => laneCatalog.get(`${note.partId}|${note.voice}`))) },
      reason: status.reason,
      sourceEvidence: 'one frozen source head',
      semanticEvidence: 'multiple MusicXML part/voice roles share staff, written pitch, and onset',
    }))
  })

  const auxiliary = {
    stems: [], beams: [], dots: [], accidentals: [], clefs: [], keySignatures: [], timeSignatures: [],
    articulations: [], dynamics: [], pedal: [], ornaments: [], graceNotes: [], tremolos: [], arpeggios: [],
    ottavas: [], repeatsEndingsNavigation: [], tempoMarks: [],
  }
  for (const note of truth.sounded) {
    const ref = eventRef.get(note.id)
    if (!ref) continue
    const base = { objectIndex: ref.objectIndex, semanticEventId: note.id, state: ref.matchState, confidence: ref.confidence }
    if (note.stemDirection) auxiliary.stems.push({ ...base, value: note.stemDirection })
    if (note.beams.length) auxiliary.beams.push({ ...base, value: note.beams })
    if (note.dots) auxiliary.dots.push({ ...base, value: note.dots })
    if (note.accidental) auxiliary.accidentals.push({ ...base, value: note.accidental })
    if (note.articulations.length) auxiliary.articulations.push({ ...base, value: note.articulations })
    if (note.ornaments.length) auxiliary.ornaments.push({ ...base, value: note.ornaments })
    if (note.isGrace) auxiliary.graceNotes.push({ ...base, value: true })
    if (note.tremolo) auxiliary.tremolos.push({ ...base, value: note.tremolo })
    if (note.arpeggiate) auxiliary.arpeggios.push({ ...base, value: true })
  }
  const measure = truth.measure
  if (measure) {
    auxiliary.timeSignatures.push({ state: KNOWN, value: { beats: measure.beats, beatType: measure.beatType } })
    if (measure.marking.forwardRepeat || measure.marking.backwardRepeat || measure.marking.endings.length) {
      auxiliary.repeatsEndingsNavigation.push({ state: KNOWN, value: measure.marking })
    }
  }
  const scopeDirections = globalRelations.directions.filter((direction) => direction.measureNumber === scope.semanticMeasureNumber)
  scopeDirections.forEach((direction) => {
    direction.dynamics.forEach((value) => auxiliary.dynamics.push({ state: KNOWN, value, staff: direction.staff }))
    direction.pedals.forEach((value) => auxiliary.pedal.push({ state: KNOWN, value, staff: direction.staff }))
    direction.ottavas.forEach((value) => auxiliary.ottavas.push({ state: KNOWN, value, staff: direction.staff }))
    if (direction.tempo || direction.metronomes.length || direction.words.length) {
      auxiliary.tempoMarks.push({ state: KNOWN, value: { tempo: direction.tempo, metronomes: direction.metronomes, words: direction.words } })
    }
    if (direction.navigation && Object.values(direction.navigation).some(Boolean)) {
      auxiliary.repeatsEndingsNavigation.push({ state: KNOWN, value: direction.navigation })
    }
  })
  unique(truth.sounded.map((note) => JSON.stringify(note.clefContext)).filter((value) => value !== 'null'))
    .map(JSON.parse).forEach((value) => auxiliary.clefs.push({ state: KNOWN, value }))
  unique(truth.sounded.map((note) => JSON.stringify(note.keySignature)).filter((value) => value !== 'null'))
    .map(JSON.parse).forEach((value) => auxiliary.keySignatures.push({ state: KNOWN, value }))

  return {
    metadata: {
      exampleId: scope.scopeId,
      scopeId: scope.scopeId,
      groupId: scope.groupId,
      split: manifestRecord.split,
      page: scope.page,
      semanticMeasureNumber: scope.semanticMeasureNumber,
      strict52: scope.strict52,
      scopeState: scope.state,
      eligibleForAutomaticGold: scope.state === KNOWN,
      alignment: {
        sourceObjects: scope.sourceObjectIds.length,
        semanticPhysicalHeads: truth.physicalGroups.length,
        mappedPhysicalHeads: mapping.mapping.size,
        unmatchedSourceObjects: mapping.unmatchedAnchorIds,
        unmatchedSemanticPhysicalHeads: mapping.unmatchedPhysicalKeys,
        complete: mapping.complete,
      },
    },
    families,
    auxiliary,
  }
}

function relationRefFor(note, scopeByMeasure, eventRefsByScope) {
  const scope = scopeByMeasure.get(note.measureNumber)
  const ref = scope ? eventRefsByScope.get(scope.scopeId)?.get(note.id) : null
  return scope && ref ? {
    scopeId: scope.scopeId,
    scopeState: scope.state,
    objectIndex: ref.objectIndex,
    ref,
  } : null
}

export function buildGlobalRelations({ notation, scopeByMeasure, eventRefsByScope, laneCatalog }) {
  const result = {
    LANE_CONTINUATION: new Map(),
    TIE_SUSTAIN: new Map(),
    CROSS_STAFF: new Map(),
    directions: notation.directions,
  }
  const add = (family, scopeId, label) => {
    if (!result[family].has(scopeId)) result[family].set(scopeId, [])
    result[family].get(scopeId).push(label)
  }
  const sounded = notation.notes.filter((note) => !note.isRest && Number.isFinite(note.midi))
  const eventGroups = [...groupBy(sounded, (note) => `${note.partId}|${note.voice}|${note.measureIndex}|${note.offsetQuarters}`).values()]
    .sort((left, right) => left[0].absoluteOrder - right[0].absoluteOrder)
  const lanes = groupBy(eventGroups, (event) => `${event[0].partId}|${event[0].voice}`)
  for (const [laneKey, events] of lanes) {
    for (let index = 1; index < events.length; index += 1) {
      const left = events[index - 1]
      const right = events[index]
      const leftRefs = unique(left.map((note) => relationRefFor(note, scopeByMeasure, eventRefsByScope)).filter(Boolean))
      const rightRefs = unique(right.map((note) => relationRefFor(note, scopeByMeasure, eventRefsByScope)).filter(Boolean))
      const originScope = leftRefs[0]?.scopeId
      if (!originScope) continue
      const allRefs = [...leftRefs, ...rightRefs]
      const status = stateForObjects(
        allRefs.map((entry) => entry.ref),
        allRefs.every((entry) => entry.scopeState === KNOWN) ? KNOWN : AMBIGUOUS,
      )
      const externalObjectRefs = rightRefs.map((entry) => ({ scopeId: entry.scopeId, objectIndex: entry.objectIndex }))
      const objectIndexes = leftRefs.filter((entry) => entry.scopeId === originScope).map((entry) => entry.objectIndex)
      const crossStaff = !left.some((leftNote) => right.some((rightNote) => leftNote.staff === rightNote.staff))
      const common = {
        state: status.state,
        confidence: status.confidence,
        objectIndexes,
        externalObjectRefs,
        semanticEventIds: [...left, ...right].map((note) => note.id),
        reason: status.reason,
        sourceEvidence: 'frozen source objects at both relation endpoints',
      }
      add('LANE_CONTINUATION', originScope, labelRecord({
        family: 'LANE_CONTINUATION',
        labelId: `${originScope}:lane-cont-${laneKey}-${index}`,
        value: { laneRole: laneCatalog.get(laneKey), crossScope: unique(allRefs.map((entry) => entry.scopeId)).length > 1 },
        semanticEvidence: 'consecutive MusicXML events in one offline voice-derived canonical lane',
        ...common,
      }))
      if (crossStaff) {
        add('CROSS_STAFF', originScope, labelRecord({
          family: 'CROSS_STAFF',
          labelId: `${originScope}:cross-staff-${laneKey}-${index}`,
          value: { laneRole: laneCatalog.get(laneKey), fromStaffs: unique(left.map((note) => note.staff)), toStaffs: unique(right.map((note) => note.staff)) },
          semanticEvidence: 'consecutive canonical-lane events change MusicXML staff',
          ...common,
        }))
      }
    }
  }

  const tieLanes = groupBy(sounded.filter((note) => note.tieStart || note.tieStop), (note) => `${note.partId}|${note.voice}|${note.staff}|${note.midi}`)
  for (const [key, notes] of tieLanes) {
    const ordered = [...notes].sort((left, right) => left.absoluteOrder - right.absoluteOrder)
    const open = []
    let serial = 0
    for (const note of ordered) {
      if (note.tieStop && open.length) {
        const start = open.shift()
        const left = relationRefFor(start, scopeByMeasure, eventRefsByScope)
        const right = relationRefFor(note, scopeByMeasure, eventRefsByScope)
        if (left) {
          serial += 1
          const status = stateForObjects(
            [left?.ref, right?.ref],
            left?.scopeState === KNOWN && right?.scopeState === KNOWN ? KNOWN : AMBIGUOUS,
          )
          add('TIE_SUSTAIN', left.scopeId, labelRecord({
            family: 'TIE_SUSTAIN',
            labelId: `${left.scopeId}:tie-${key}-${serial}`,
            state: right ? status.state : UNAVAILABLE,
            confidence: right ? status.confidence : 0,
            objectIndexes: [left.objectIndex],
            externalObjectRefs: right ? [{ scopeId: right.scopeId, objectIndex: right.objectIndex }] : [],
            semanticEventIds: [start.id, note.id],
            value: { tieStart: true, tieStop: true, distinguishFromSlur: true },
            reason: right ? status.reason : 'TIE_STOP_HAS_NO_FROZEN_SOURCE_OBJECT',
            sourceEvidence: 'frozen source noteheads at tie endpoints',
            semanticEvidence: 'MusicXML tie/tied elements; slur elements excluded',
          }))
        }
      }
      if (note.tieStart) open.push(note)
    }
    for (const start of open) {
      const left = relationRefFor(start, scopeByMeasure, eventRefsByScope)
      if (!left) continue
      add('TIE_SUSTAIN', left.scopeId, labelRecord({
        family: 'TIE_SUSTAIN',
        labelId: `${left.scopeId}:tie-unclosed-${key}-${start.id}`,
        state: AMBIGUOUS,
        confidence: 0.3,
        objectIndexes: [left.objectIndex],
        semanticEventIds: [start.id],
        value: { tieStart: true, tieStop: false, distinguishFromSlur: true },
        reason: 'NO_MATCHING_MUSICXML_TIE_STOP',
        sourceEvidence: 'frozen source notehead at tie start',
        semanticEvidence: 'MusicXML tie start without resolved stop',
      }))
    }
  }
  return result
}

function auxiliarySummary(targetRecords) {
  const totals = {}
  for (const record of targetRecords) {
    for (const [family, labels] of Object.entries(record.auxiliary)) {
      totals[family] = (totals[family] ?? 0) + labels.length
    }
  }
  return totals
}

function familySummary(targetRecords, family) {
  const entries = targetRecords.flatMap((record) =>
    record.families[family].map((label) => ({ record, label })),
  )
  const states = Object.fromEntries([KNOWN, AMBIGUOUS, UNAVAILABLE].map((state) => [
    state,
    entries.filter((entry) => entry.label.state === state).length,
  ]))
  const knownPositive = entries.filter((entry) => entry.label.state === KNOWN && entry.label.isPositive)
  return {
    family,
    totalCandidateLabels: entries.length,
    ...states,
    knownPositiveExamples: knownPositive.length,
    scoresRepresented: unique(entries.map((entry) => entry.record.metadata.groupId)).length,
    pagesRepresented: unique(entries.map((entry) => `${entry.record.metadata.groupId}|${entry.record.metadata.page}`)).length,
    measuresRepresented: unique(entries.map((entry) => entry.record.metadata.scopeId)).length,
    knownPositiveScores: unique(knownPositive.map((entry) => entry.record.metadata.groupId)).length,
  }
}

function strictCoverage(targetRecords) {
  const strict = targetRecords.filter((record) => record.metadata.strict52)
  const families = {}
  for (const family of FAMILIES) {
    const entries = strict.flatMap((record) => record.families[family].map((label) => ({ record, label })))
    families[family] = {
      totalCandidateLabels: entries.length,
      KNOWN: entries.filter((entry) => entry.label.state === KNOWN).length,
      AMBIGUOUS: entries.filter((entry) => entry.label.state === AMBIGUOUS).length,
      UNAVAILABLE: entries.filter((entry) => entry.label.state === UNAVAILABLE).length,
      clustersWithPositiveExamples: unique(entries.filter((entry) => entry.label.state === KNOWN && entry.label.isPositive).map((entry) => entry.record.metadata.scopeId)).length,
      scoreDistribution: Object.fromEntries([...groupBy(
        entries.filter((entry) => entry.label.state === KNOWN && entry.label.isPositive),
        (entry) => entry.record.metadata.groupId,
      )].map(([score, values]) => [score, values.length])),
    }
  }
  return { schemaVersion: 1, strictScopes: strict.length, families }
}

function splitSufficiency(targetRecords, dedup) {
  const currentAssignment = new Map(targetRecords.map((record) => [record.metadata.groupId, record.metadata.split]))
  const alternativeAssignment = new Map(currentAssignment)
  alternativeAssignment.set('idol', 'train')
  alternativeAssignment.set('etude-opus-no-in-b-minor-heller', 'validation')
  const summarize = (entries, assignment) => {
    const splits = {}
    for (const split of ['train', 'validation', 'test']) {
      const selected = entries.filter((entry) => assignment.get(entry.record.metadata.groupId) === split)
      splits[split] = {
        positiveScores: unique(selected.map((entry) => entry.record.metadata.groupId)).length,
        positiveExamples: selected.length,
        scores: unique(selected.map((entry) => entry.record.metadata.groupId)).sort(),
      }
    }
    return splits
  }
  const families = {}
  const alternativeFamilies = {}
  for (const family of FAMILIES) {
    const entries = targetRecords.flatMap((record) => record.families[family]
      .filter((label) => label.state === KNOWN && label.isPositive)
      .map((label) => ({ record, label })))
    const splits = summarize(entries, currentAssignment)
    const sufficient = Object.values(splits).every((split) => split.positiveScores > 0 && split.positiveExamples > 0) && dedup.crossSplitConflicts.length === 0
    families[family] = {
      ...splits,
      status: sufficient ? 'SUFFICIENT_FOR_PILOT' : 'INSUFFICIENT_FOR_PILOT',
      missingSplits: Object.entries(splits).filter(([, value]) => value.positiveScores === 0).map(([split]) => split),
      minimumAdditionalIndependentPositiveScores: Object.values(splits).filter((split) => split.positiveScores === 0).length,
    }
    const alternativeSplits = summarize(entries, alternativeAssignment)
    const alternativeSufficient = Object.values(alternativeSplits).every((split) => split.positiveScores > 0 && split.positiveExamples > 0) && dedup.crossSplitConflicts.length === 0
    alternativeFamilies[family] = {
      ...alternativeSplits,
      status: alternativeSufficient ? 'SUFFICIENT_FOR_PILOT' : 'INSUFFICIENT_FOR_PILOT',
      missingSplits: Object.entries(alternativeSplits).filter(([, value]) => value.positiveScores === 0).map(([split]) => split),
    }
  }
  const insufficientFamilies = FAMILIES.filter((family) => families[family].status !== 'SUFFICIENT_FOR_PILOT')
  const alternativeInsufficient = FAMILIES.filter((family) => alternativeFamilies[family].status !== 'SUFFICIENT_FOR_PILOT')
  return {
    schemaVersion: 1,
    splitUnit: 'whole score / semantic source',
    noScoreCrossesSplits: true,
    semanticSourceCrossSplitConflicts: dedup.crossSplitConflicts,
    families,
    insufficientFamilies,
    alternativeWholeScoreSplit: {
      purpose: 'Demonstrate corpus-level coverage without allowing any score or semantic source to cross splits.',
      changesFromFrozenManifest: [
        { groupId: 'idol', from: 'validation', to: 'train' },
        { groupId: 'etude-opus-no-in-b-minor-heller', from: 'train', to: 'validation' },
      ],
      families: alternativeFamilies,
      insufficientFamilies: alternativeInsufficient,
      conclusion: alternativeInsufficient.length === 1 && alternativeInsufficient[0] === 'REST'
        ? 'ALL_SOURCE_ALIGNED_FAMILIES_CAN_COVER_ALL_SPLITS; REST_ALIGNMENT_REMAINS_INTRINSICALLY_INSUFFICIENT'
        : 'ALTERNATIVE_SPLIT_STILL_HAS_MULTIPLE_GAPS',
    },
    corpusIntrinsicInsufficientFamilies: alternativeInsufficient,
  }
}

function pdfPageCount(pdfPath) {
  const text = readFileSync(pdfPath).toString('latin1')
  return (text.match(/\/Type\s*\/Page\b/g) ?? []).length
}

async function hashFile(filePath) {
  return stableHash(readFileSync(filePath))
}

function pairDirectories(candidateRoot) {
  return readdirSync(candidateRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = path.join(candidateRoot, entry.name)
      const files = readdirSync(directory).filter((name) => !name.startsWith('.'))
      return {
        directory,
        displayName: entry.name,
        pdfFiles: files.filter((name) => name.toLowerCase().endsWith('.pdf')).map((name) => path.join(directory, name)),
        truthFiles: files.filter((name) => /\.(mxl|musicxml|xml)$/i.test(name)).map((name) => path.join(directory, name)),
      }
    })
}

export function musicalFingerprints(notation) {
  const notes = notation.notes.map((note) => [
    note.measureIndex,
    note.offsetQuarters,
    note.durationQuarters,
    note.isRest ? 'R' : note.midi,
    note.staff,
    note.voice,
    note.isGrace,
  ])
  const firstMidi = notation.notes.find((note) => Number.isFinite(note.midi))?.midi ?? 0
  const transpositionInvariant = notes.map((note) => [
    note[0], note[1], note[2], note[3] === 'R' ? 'R' : note[3] - firstMidi, note[4], note[5], note[6],
  ])
  const rhythm = notes.map((note) => [note[0], note[1], note[2], note[3] === 'R', note[4], note[5], note[6]])
  return {
    exactMusicalSha256: stableHash(notes),
    transpositionInvariantSha256: stableHash(transpositionInvariant),
    rhythmSha256: stableHash(rhythm),
  }
}

async function auditPairs({ candidateRoot, manifest, sourceScopeMap }) {
  const trustedByPdf = new Map(manifest.realScores.map((score) => [path.resolve(score.pdfPath), score]))
  const pairIdByGroup = new Map(sourceScopeMap.scopes.map((scope) => [scope.groupId, scope.pairId]))
  const records = []
  for (const candidate of pairDirectories(candidateRoot)) {
    const pdfPath = candidate.pdfFiles[0] ?? null
    const truthPath = candidate.truthFiles[0] ?? null
    const trusted = pdfPath ? trustedByPdf.get(path.resolve(pdfPath)) : null
    const record = {
      displayName: candidate.displayName,
      directory: candidate.directory,
      pdfPath,
      truthPath,
      pdfCount: candidate.pdfFiles.length,
      truthCount: candidate.truthFiles.length,
      trustedGroupId: trusted?.groupId ?? null,
      classification: 'UNUSABLE',
      reasons: [],
    }
    if (candidate.pdfFiles.length !== 1 || candidate.truthFiles.length !== 1) {
      record.reasons.push('PAIR_REQUIRES_EXACTLY_ONE_PDF_AND_ONE_MXL_OR_MUSICXML')
      records.push(record)
      continue
    }
    try {
      const pdfSha256 = await hashFile(pdfPath)
      const truthSha256 = await hashFile(truthPath)
      const { xml, rootPath } = await readScoreXml(truthPath)
      const notation = parseWrittenNotation(xml, truthPath)
      const fingerprints = musicalFingerprints(notation)
      Object.assign(record, {
        pdfSha256,
        truthSha256,
        mxlRootPath: rootPath,
        pdfPages: pdfPageCount(pdfPath),
        semanticMeasures: unique(notation.measures.map((measure) => measure.measureNumber)).length,
        notes: notation.notes.filter((note) => !note.isRest).length,
        rests: notation.notes.filter((note) => note.isRest).length,
        parts: notation.parts,
        ...fingerprints,
      })
      if (trusted) {
        const frozen = pairIdByGroup.get(trusted.groupId)
        if (frozen?.pdfSha256 !== pdfSha256 || frozen?.truthSha256 !== truthSha256) {
          record.classification = 'MISMATCH'
          record.reasons.push('CONTENT_HASH_DIFFERS_FROM_FROZEN_PHASE212S_PAIR')
        } else {
          record.classification = 'EXACT_OR_HIGH_CONFIDENCE'
          record.reasons.push('CONTENT_HASHES_AND_PHASE212S_SOURCE_COORDINATE_ALIGNMENT_VERIFIED')
        }
      } else {
        record.classification = 'AMBIGUOUS'
        record.reasons.push('PAIR_PARSES_BUT_HAS_NO_FROZEN_SOURCE_COORDINATE_ALIGNMENT')
      }
    } catch (error) {
      record.classification = 'UNUSABLE'
      record.reasons.push(`PARSE_OR_INTEGRITY_FAILURE: ${error.message}`)
    }
    records.push(record)
  }
  const counts = Object.fromEntries(['EXACT_OR_HIGH_CONFIDENCE', 'AMBIGUOUS', 'MISMATCH', 'UNUSABLE'].map((classification) => [
    classification,
    records.filter((record) => record.classification === classification).length,
  ]))
  return { schemaVersion: 1, candidateRoot, pairFolders: records.length, counts, records }
}

export function deduplicatePairs(pairAudit, manifest) {
  const usable = pairAudit.records.filter((record) => record.exactMusicalSha256)
  const groups = [...groupBy(usable, (record) => record.transpositionInvariantSha256).values()].map((records, index) => ({
    semanticSourceId: `semantic-source-${index + 1}-${records[0].transpositionInvariantSha256.slice(0, 12)}`,
    records: records.map((record) => ({
      displayName: record.displayName,
      trustedGroupId: record.trustedGroupId,
      classification: record.classification,
      pdfSha256: record.pdfSha256,
      truthSha256: record.truthSha256,
      exactMusicalSha256: record.exactMusicalSha256,
      rhythmSha256: record.rhythmSha256,
    })),
  }))
  const splitByGroup = new Map(manifest.realScores.map((score) => [score.groupId, score.split]))
  const crossSplitConflicts = groups.flatMap((group) => {
    const trusted = group.records.filter((record) => record.trustedGroupId)
    const splits = unique(trusted.map((record) => splitByGroup.get(record.trustedGroupId)))
    return splits.length > 1 ? [{ semanticSourceId: group.semanticSourceId, splits, records: trusted }] : []
  })
  return {
    schemaVersion: 1,
    methods: ['content hashes', 'exact musical structure', 'transposition-invariant note/rhythm fingerprint', 'source metadata/path'],
    pairsInspected: pairAudit.records.length,
    semanticSourcesAfterDedupe: groups.length,
    duplicateGroups: groups.filter((group) => group.records.length > 1),
    crossSplitConflicts,
    groups,
  }
}

export function verifySourceIdentity(sourceScopeMap, strict52) {
  const strictIds = new Set(strict52.records.map((record) => record.clusterId))
  const key = (record) => `${record.groupId}:m${record.semanticMeasureNumber}`
  const scopes = sourceScopeMap.scopes.filter((scope) => strictIds.has(key(scope)))
  const matches = sourceScopeMap.objectMatches.filter((match) => strictIds.has(key(match)))
  const result = {
    scopes: scopes.length,
    knownScopes: scopes.filter((scope) => scope.state === KNOWN).length,
    sourceVisibleHeads: scopes.reduce((total, scope) => total + scope.sourceAnchorCount, 0),
    coordinateMatchedHeads: matches.length,
    unmatchedHeads: scopes.reduce((total, scope) => total + scope.unmatchedSourceAnchorIds.length, 0),
    nominalMeasureLabelsUsedForMatching: sourceScopeMap.matching.measureLabelsUsedForMatching,
  }
  result.pass = result.scopes === 52 && result.knownScopes === 52 && result.sourceVisibleHeads === 895 &&
    result.coordinateMatchedHeads === 895 && result.unmatchedHeads === 0 && result.nominalMeasureLabelsUsedForMatching === false
  return result
}

/**
 * Stable per-pair factory boundary. The caller must provide a hash-verified,
 * high-confidence pair and an already frozen source-coordinate alignment.
 * This function never derives scope identity from graph measure labels.
 */
export async function assembleVerifiedPair({
  repoRoot,
  verifiedPair,
  sourceScopes,
  objectMatches,
  sourceAnchors = null,
  pipelinePath = null,
  sourceRestObjects = [],
}) {
  if (verifiedPair.classification !== 'EXACT_OR_HIGH_CONFIDENCE') {
    throw new Error(`Pair is not eligible for automatic gold: ${verifiedPair.classification}`)
  }
  const { xml } = await readScoreXml(verifiedPair.truthPath)
  const notation = parseWrittenNotation(xml, verifiedPair.truthPath)
  const laneCatalog = canonicalLaneCatalog(notation)
  const pipelineAnchors = pipelinePath ? readJson(pipelinePath).sourceVisualMap.anchors : null
  const allAnchors = (sourceAnchors ?? pipelineAnchors ?? []).filter((anchor) => anchor.kind === 'notehead')
  if (!allAnchors.length && sourceScopes.some((scope) => scope.sourceObjectIds.length)) {
    throw new Error('No canonical source anchors supplied for pair with physical objects')
  }
  const anchorsById = new Map(allAnchors.map((anchor) => [anchor.sourceNoteheadId, anchor]))
  const scopeByMeasure = new Map(sourceScopes.map((scope) => [scope.semanticMeasureNumber, scope]))
  const matchesByScope = groupBy(objectMatches, (match) => `${match.groupId}|${match.semanticMeasureNumber}`)
  const mappingByScope = new Map()
  const restMappingByScope = new Map()
  const truthByScope = new Map()
  const eventRefsByScope = new Map()

  for (const scope of scopeByMeasure.values()) {
    const anchors = scope.sourceObjectIds.map((id) => anchorsById.get(id)).filter(Boolean)
    const truth = measureTruth(notation, scope.semanticMeasureNumber)
    const mapping = matchAnchorsToPhysical(anchors, truth.physicalGroups)
    const restObjects = sourceRestObjects.filter((rest) => rest.scopeId === scope.scopeId)
    const restMapping = matchSourceRestsToTruth(restObjects, truth.rests)
    const objectIndexById = new Map(scope.sourceObjectIds.map((id, index) => [id, index]))
    const eventRefs = new Map()
    truth.physicalGroups.forEach((physical) => {
      const match = mapping.mapping.get(physical.key)
      const objectIndex = match ? objectIndexById.get(match.anchorId) : null
      const ref = match && Number.isInteger(objectIndex) ? {
        objectIndex,
        matchState: match.state,
        confidence: match.confidence,
        method: match.method,
      } : null
      physical.roles.forEach((role) => eventRefs.set(role.id, ref))
    })
    mappingByScope.set(scope.scopeId, mapping)
    restMappingByScope.set(scope.scopeId, restMapping)
    truthByScope.set(scope.scopeId, truth)
    eventRefsByScope.set(scope.scopeId, eventRefs)
  }

  const globalRelations = buildGlobalRelations({ notation, scopeByMeasure, eventRefsByScope, laneCatalog })
  const sourceRecords = []
  const targetRecords = []
  for (const scope of scopeByMeasure.values()) {
    const anchors = scope.sourceObjectIds.map((id) => anchorsById.get(id)).filter(Boolean)
    const matches = matchesByScope.get(`${scope.groupId}|${scope.semanticMeasureNumber}`) ?? []
    const restObjects = sourceRestObjects.filter((rest) => rest.scopeId === scope.scopeId)
    sourceRecords.push(sourceRecordFor({ scope, anchors, matches, restObjects, manifestRecord: verifiedPair, repoRoot }))
    targetRecords.push(targetRecordFor({
      scope,
      truth: truthByScope.get(scope.scopeId),
      mapping: mappingByScope.get(scope.scopeId),
      anchors,
      laneCatalog,
      manifestRecord: verifiedPair,
      globalRelations,
      restObjects,
      restMapping: restMappingByScope.get(scope.scopeId),
    }))
  }
  return {
    sourceRecords,
    targetRecords,
    diagnostics: {
      groupId: verifiedPair.groupId,
      split: verifiedPair.split,
      scopes: scopeByMeasure.size,
      notes: notation.notes.filter((note) => !note.isRest).length,
      rests: notation.notes.filter((note) => note.isRest).length,
      frozenSourceRests: sourceRestObjects.filter((rest) => rest.state === KNOWN).length,
      knownRestAttachments: [...restMappingByScope.values()].reduce((total, match) => total + match.mapping.size, 0),
      parts: notation.parts,
    },
  }
}

export async function buildSemanticGold({ repoRoot, outputRoot, restInventoryPath = null, splitOverrides = {} }) {
  const phase212s = path.join(repoRoot, 'tmp/campaign/piano-vision-phase212s')
  const frozenManifest = readJson(path.join(repoRoot, 'tmp/campaign/piano-vision-phase211/benchmark-manifest.json'))
  const manifest = {
    ...frozenManifest,
    realScores: frozenManifest.realScores.map((score) => ({
      ...score,
      split: splitOverrides[score.groupId] ?? score.split,
    })),
  }
  const sourceScopeMap = readJson(path.join(phase212s, 'source-scope-map.json'))
  const restInventory = restInventoryPath ? readJson(restInventoryPath) : {
    truthReadDuringFreeze: false,
    graphNominalMeasureUsedForScopeMatching: false,
    records: [],
    diagnostics: [],
  }
  if (restInventory.truthReadDuringFreeze !== false || restInventory.graphNominalMeasureUsedForScopeMatching !== false) {
    throw new Error('Rest inventory violates source-only freeze contract')
  }
  const strict52 = readJson(path.join(phase212s, 'corrected-strict52.json'))
  const identity = verifySourceIdentity(sourceScopeMap, strict52)
  if (!identity.pass) throw new Error(`Source identity gate failed: ${JSON.stringify(identity)}`)

  const pairAudit = await auditPairs({
    candidateRoot: path.join(repoRoot, 'tmp/omr-generalization-candidates'),
    manifest,
    sourceScopeMap,
  })
  const dedup = deduplicatePairs(pairAudit, manifest)
  const scopesByGroup = groupBy(sourceScopeMap.scopes, (scope) => scope.groupId)
  const matchesByGroup = groupBy(sourceScopeMap.objectMatches, (match) => match.groupId)
  const restsByGroup = groupBy(restInventory.records.filter((rest) => rest.state === KNOWN), (rest) => rest.groupId)
  const sourceRecords = []
  const targetRecords = []
  const scoreDiagnostics = []

  for (const manifestRecord of manifest.realScores) {
    const auditedPair = pairAudit.records.find((record) => record.trustedGroupId === manifestRecord.groupId)
    const result = await assembleVerifiedPair({
      repoRoot,
      verifiedPair: {
        ...manifestRecord,
        classification: auditedPair?.classification,
        pdfSha256: auditedPair?.pdfSha256,
        truthSha256: auditedPair?.truthSha256,
      },
      sourceScopes: scopesByGroup.get(manifestRecord.groupId) ?? [],
      objectMatches: matchesByGroup.get(manifestRecord.groupId) ?? [],
      pipelinePath: path.join(
        repoRoot,
        'tmp/campaign/piano-omr-master-v2/runs/architecture-audit-provenance-22463eb/pipeline',
        `${manifestRecord.groupId}.json`,
      ),
      sourceRestObjects: restsByGroup.get(manifestRecord.groupId) ?? [],
    })
    sourceRecords.push(...result.sourceRecords)
    targetRecords.push(...result.targetRecords)
    scoreDiagnostics.push(result.diagnostics)
  }

  const firewallViolations = sourceRecords.flatMap((record) =>
    findFirewallViolations(record.modelInput).map((violation) => ({ exampleId: record.metadata.exampleId, path: violation })),
  )
  const firewall = {
    schemaVersion: 1,
    result: firewallViolations.length ? 'FAIL' : 'PASS',
    sourceRecordsChecked: sourceRecords.length,
    targetRecordsPhysicallySeparate: true,
    sourceFile: 'source-input.jsonl.gz',
    targetFile: 'target-supervision.jsonl.gz',
    forbiddenSemanticFieldsInModelInput: [...FORBIDDEN_MODEL_INPUT_KEYS].sort(),
    violations: firewallViolations,
  }
  if (firewall.result !== 'PASS') throw new Error(`Source/target firewall failed: ${JSON.stringify(firewallViolations.slice(0, 5))}`)

  const goldByFamily = Object.fromEntries(FAMILIES.map((family) => [family, familySummary(targetRecords, family)]))
  const strict = strictCoverage(targetRecords)
  const split = splitSufficiency(targetRecords, dedup)
  const knownScopes = targetRecords.filter((record) => record.metadata.eligibleForAutomaticGold).length
  const goldSummary = {
    schemaVersion: 1,
    assemblerVersion: ASSEMBLER_VERSION,
    sourceIdentityGate: identity,
    trustedPairsUsed: pairAudit.counts.EXACT_OR_HIGH_CONFIDENCE,
    extraPairsInspected: pairAudit.records.filter((record) => !record.trustedGroupId).length,
    semanticSourcesAfterDedupe: dedup.semanticSourcesAfterDedupe,
    sourceRecords: sourceRecords.length,
    targetRecords: targetRecords.length,
    knownScopes,
    ambiguousScopes: targetRecords.length - knownScopes,
    pagesRepresented: unique(targetRecords.map((record) => `${record.metadata.groupId}|${record.metadata.page}`)).length,
    measuresRepresented: targetRecords.length,
    physicalObjects: sourceRecords.reduce((total, record) => total + record.modelInput.physicalObjects.length, 0),
    physicalNoteheads: sourceRecords.reduce((total, record) => total + record.modelInput.physicalObjects.filter((object) => object.kind === 'notehead').length, 0),
    physicalRests: sourceRecords.reduce((total, record) => total + record.modelInput.physicalObjects.filter((object) => object.kind === 'rest').length, 0),
    restSourceFreeze: {
      enabled: Boolean(restInventoryPath),
      truthReadDuringFreeze: restInventory.truthReadDuringFreeze,
      graphNominalMeasureUsedForScopeMatching: restInventory.graphNominalMeasureUsedForScopeMatching,
      diagnostics: restInventory.diagnostics,
    },
    goldByFamily,
    auxiliaryNotationLabels: auxiliarySummary(targetRecords),
    firewallResult: firewall.result,
    nominalMeasureIndependence: identity.nominalMeasureLabelsUsedForMatching === false ? 'PASS' : 'FAIL',
    decision: split.insufficientFamilies.length ? 'MORE_SEMANTIC_GOLD_REQUIRED' : 'READY_FOR_SEMANTIC_PIANO_VISION_TRAINING',
    scoreDiagnostics,
  }

  writeFileSync(path.join(outputRoot, 'source-input.jsonl.gz'), gzipSync(Buffer.from(sourceRecords.map((record) => JSON.stringify(record)).join('\n') + '\n')))
  writeFileSync(path.join(outputRoot, 'target-supervision.jsonl.gz'), gzipSync(Buffer.from(targetRecords.map((record) => JSON.stringify(record)).join('\n') + '\n')))
  writeJson(path.join(outputRoot, 'pair-audit.json'), pairAudit)
  writeJson(path.join(outputRoot, 'semantic-source-dedup.json'), dedup)
  writeJson(path.join(outputRoot, 'gold-summary.json'), goldSummary)
  writeJson(path.join(outputRoot, 'gold-by-family.json'), { schemaVersion: 1, families: goldByFamily })
  writeJson(path.join(outputRoot, 'strict52-gold-coverage.json'), strict)
  writeJson(path.join(outputRoot, 'split-sufficiency.json'), split)
  writeJson(path.join(outputRoot, 'firewall-validation.json'), firewall)
  if (restInventoryPath) writeJson(path.join(outputRoot, 'rest-source-inventory.json'), restInventory)

  return { pairAudit, dedup, goldSummary, strict, split, firewall, sourceRecords, targetRecords }
}
