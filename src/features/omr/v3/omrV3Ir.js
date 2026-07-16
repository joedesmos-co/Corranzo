/**
 * Corranzo OMR V3 document IR.
 *
 * Pure data constructors, validation, and deterministic JSON helpers. This
 * module deliberately has no DOM, React, PDF.js, or image-buffer dependency.
 */

export const OMR_V3_SCHEMA_VERSION = 1

export const OMR_V3_STAFF_GROUP_TYPE = Object.freeze({
  PIANO_GRAND_STAFF: 'piano-grand-staff',
  SINGLE_NOTATION: 'single-notation',
  GUITAR_NOTATION_TAB: 'guitar-notation-tab',
  TAB_ONLY: 'tab-only',
  UNKNOWN: 'unknown',
})

export const OMR_V3_NOTATION_TYPE = Object.freeze({
  NOTATION: 'notation',
  TAB: 'tab',
  AMBIGUOUS: 'ambiguous',
  UNKNOWN: 'unknown',
})

export const OMR_V3_RELATIONSHIP_TYPE = Object.freeze({
  TIE: 'tie',
  SLUR: 'slur',
  BEAM: 'beam',
  STEM_GROUP: 'stem-group',
  NOTATION_TAB_MIRROR: 'notation-tab-mirror',
  CROSS_STAFF: 'cross-staff',
  REPEAT_VOLTA: 'repeat-volta',
  TECHNIQUE: 'technique',
})

export const OMR_V3_DIAGNOSTIC_SEVERITY = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
})

const STAFF_GROUP_TYPES = new Set(Object.values(OMR_V3_STAFF_GROUP_TYPE))
const NOTATION_TYPES = new Set(Object.values(OMR_V3_NOTATION_TYPE))
const RELATIONSHIP_TYPES = new Set(Object.values(OMR_V3_RELATIONSHIP_TYPE))
const DIAGNOSTIC_SEVERITIES = new Set(Object.values(OMR_V3_DIAGNOSTIC_SEVERITY))
const BOX_SPACES = new Set(['normalized', 'pixels'])

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function copyRecord(value) {
  return plainObject(value) ? { ...value } : {}
}

function sanitizeIdPart(value) {
  const normalized = String(value ?? 'unknown')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'unknown'
}

/** Deterministic ID from stable semantic parts. No random or time component. */
export function createOmrV3Id(kind, ...parts) {
  return ['omr3', sanitizeIdPart(kind), ...parts.map(sanitizeIdPart)].join(':')
}

export function createOmrV3BoundingBox({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  space = 'normalized',
} = {}) {
  return { x, y, width, height, space }
}

export function createOmrV3LineGeometry({
  xStart = 0,
  xEnd = 0,
  yStart = 0,
  yEnd = yStart,
  thickness = null,
  space = 'normalized',
  confidence = null,
  sourceRefs = [],
} = {}) {
  return {
    xStart,
    xEnd,
    yStart,
    yEnd,
    thickness: finiteOrNull(thickness),
    space,
    confidence: finiteOrNull(confidence),
    sourceRefs: [...asArray(sourceRefs)],
  }
}

/** Confidence is explicitly split by stage and may retain detector evidence. */
export function createOmrV3Confidence(value = {}) {
  if (Number.isFinite(value)) {
    return { overall: clamp01(value), stages: {}, evidence: [] }
  }
  const stages = {}
  for (const [stage, score] of Object.entries(value?.stages ?? {})) {
    if (Number.isFinite(score)) {
      stages[stage] = clamp01(score)
    }
  }
  const finiteOverall = finiteOrNull(value?.overall)
  return {
    overall: finiteOverall == null ? null : clamp01(finiteOverall),
    stages,
    evidence: asArray(value?.evidence).map((entry) => copyRecord(entry)),
  }
}

export function createOmrV3Diagnostic({
  code,
  severity = OMR_V3_DIAGNOSTIC_SEVERITY.INFO,
  message = '',
  stage = null,
  sourceRefs = [],
  data = {},
} = {}) {
  return {
    code: String(code ?? 'unspecified'),
    severity,
    message: String(message ?? ''),
    stage: stage == null ? null : String(stage),
    sourceRefs: [...asArray(sourceRefs)],
    data: copyRecord(data),
  }
}

function commonNodeFields(input = {}) {
  return {
    confidence: createOmrV3Confidence(input.confidence),
    diagnostics: asArray(input.diagnostics).map(createOmrV3Diagnostic),
    sourceRefs: [...asArray(input.sourceRefs)],
  }
}

export function createOmrEventIR(input = {}) {
  return {
    eventId: String(input.eventId ?? createOmrV3Id('event', input.staffId, input.onset, input.index ?? 0)),
    staffId: input.staffId == null ? null : String(input.staffId),
    measureId: input.measureId == null ? null : String(input.measureId),
    voiceId: input.voiceId == null ? null : String(input.voiceId),
    onsetColumnId: input.onsetColumnId == null ? null : String(input.onsetColumnId),
    kind: input.kind ?? 'note',
    onset: finiteOrNull(input.onset),
    duration: plainObject(input.duration)
      ? { ...input.duration }
      : { divisions: finiteOrNull(input.duration), type: null, dots: 0, exact: false },
    pitch: input.pitch == null ? null : copyRecord(input.pitch),
    chordGroupId: input.chordGroupId == null ? null : String(input.chordGroupId),
    stemGroupId: input.stemGroupId == null ? null : String(input.stemGroupId),
    beamGroupId: input.beamGroupId == null ? null : String(input.beamGroupId),
    string: finiteOrNull(input.string),
    fret: finiteOrNull(input.fret),
    technical: copyRecord(input.technical),
    relationships: [...asArray(input.relationships)],
    geometry: input.geometry == null ? null : createOmrV3BoundingBox(input.geometry),
    confidenceBreakdown: copyRecord(input.confidenceBreakdown),
    ...commonNodeFields(input),
  }
}

export function createOmrVoiceIR(input = {}) {
  const voiceId = String(input.voiceId ?? createOmrV3Id('voice', input.staffId, input.index ?? 0))
  return {
    voiceId,
    staffId: input.staffId == null ? null : String(input.staffId),
    candidateRank: Number.isInteger(input.candidateRank) ? input.candidateRank : 0,
    events: asArray(input.events).map((event, index) =>
      createOmrEventIR({
        staffId: input.staffId,
        measureId: input.measureId,
        voiceId,
        index,
        ...event,
      }),
    ),
    onsetColumnIds: [...asArray(input.onsetColumnIds)],
    overlapConstraints: asArray(input.overlapConstraints).map((entry) => copyRecord(entry)),
    ambiguous: Boolean(input.ambiguous),
    ...commonNodeFields(input),
  }
}

export function createOmrOnsetColumnIR(input = {}) {
  const symbolKinds = [
    'noteheads',
    'rests',
    'stems',
    'beams',
    'accidentals',
    'tabDigits',
    'excludedSymbols',
  ]
  const symbols = {}
  for (const kind of symbolKinds) {
    symbols[kind] = [...asArray(input[kind] ?? input.symbols?.[kind])]
  }
  return {
    onsetColumnId: String(
      input.onsetColumnId ?? createOmrV3Id('onset', input.measureId, input.x, input.index ?? 0),
    ),
    measureId: input.measureId == null ? null : String(input.measureId),
    x: finiteOrNull(input.x),
    measureRelativePosition: finiteOrNull(input.measureRelativePosition),
    grace: Boolean(input.grace),
    symbols,
    ...commonNodeFields(input),
  }
}

export function createOmrMeasureColumnIR(input = {}) {
  const measureId = String(
    input.measureId ?? createOmrV3Id('measure', input.systemId, input.measureNumber ?? input.index ?? 0),
  )
  return {
    measureId,
    systemId: input.systemId == null ? null : String(input.systemId),
    xStart: finiteOrNull(input.xStart),
    xEnd: finiteOrNull(input.xEnd),
    boundingBox: input.boundingBox == null ? null : createOmrV3BoundingBox(input.boundingBox),
    barlineEvidence: asArray(input.barlineEvidence).map((entry) => copyRecord(entry)),
    staffSpanningRelationships: [...asArray(input.staffSpanningRelationships)],
    measureNumber: Number.isInteger(input.measureNumber) ? input.measureNumber : null,
    expectedStaffParticipation: [...asArray(input.expectedStaffParticipation)],
    onsetColumns: asArray(input.onsetColumns).map((column, index) =>
      createOmrOnsetColumnIR({ measureId, index, ...column }),
    ),
    voices: asArray(input.voices).map((voice, index) =>
      createOmrVoiceIR({ measureId, candidateRank: index, ...voice }),
    ),
    ...commonNodeFields(input),
  }
}

export function createOmrStaffIR(input = {}) {
  const raw = asArray(input.rawLineGeometry).map(createOmrV3LineGeometry)
  const normalized = asArray(input.normalizedLineGeometry).map(createOmrV3LineGeometry)
  return {
    staffId: String(input.staffId ?? createOmrV3Id('staff', input.systemId, input.verticalOrder ?? 0)),
    systemId: input.systemId == null ? null : String(input.systemId),
    lineCount: Number.isInteger(input.lineCount)
      ? input.lineCount
      : normalized.length || raw.length,
    rawLineGeometry: raw,
    normalizedLineGeometry: normalized,
    boundingBox: input.boundingBox == null ? null : createOmrV3BoundingBox(input.boundingBox),
    clef: input.clef == null ? null : String(input.clef),
    notationType: input.notationType ?? OMR_V3_NOTATION_TYPE.UNKNOWN,
    verticalOrder: Number.isInteger(input.verticalOrder) ? input.verticalOrder : 0,
    symbols: asArray(input.symbols).map((symbol) => copyRecord(symbol)),
    measureMembership: [...asArray(input.measureMembership)],
    barlineEvidence: asArray(input.barlineEvidence).map((entry) => copyRecord(entry)),
    ...commonNodeFields(input),
  }
}

export function createOmrStaffGroupIR(input = {}) {
  const staffGroupId = String(
    input.staffGroupId ?? createOmrV3Id('staff-group', input.systemId, input.index ?? 0),
  )
  return {
    staffGroupId,
    systemId: input.systemId == null ? null : String(input.systemId),
    type: input.type ?? OMR_V3_STAFF_GROUP_TYPE.UNKNOWN,
    staves: asArray(input.staves).map((staff, index) =>
      createOmrStaffIR({ systemId: input.systemId, verticalOrder: index, ...staff }),
    ),
    braces: asArray(input.braces).map((entry) => copyRecord(entry)),
    brackets: asArray(input.brackets).map((entry) => copyRecord(entry)),
    pairingEvidence: asArray(input.pairingEvidence).map((entry) => copyRecord(entry)),
    rejectedPairings: asArray(input.rejectedPairings).map((entry) => copyRecord(entry)),
    ...commonNodeFields(input),
  }
}

export function createOmrSystemIR(input = {}) {
  const systemId = String(input.systemId ?? createOmrV3Id('system', input.pageId, input.readingOrder ?? 0))
  return {
    systemId,
    pageId: input.pageId == null ? null : String(input.pageId),
    boundingBox: createOmrV3BoundingBox(input.boundingBox),
    staffGroups: asArray(input.staffGroups).map((group, index) =>
      createOmrStaffGroupIR({ systemId, index, ...group }),
    ),
    measureColumns: asArray(input.measureColumns).map((measure, index) =>
      createOmrMeasureColumnIR({ systemId, index, ...measure }),
    ),
    systemBarlines: asArray(input.systemBarlines).map((entry) => copyRecord(entry)),
    readingOrder: Number.isInteger(input.readingOrder) ? input.readingOrder : 0,
    ...commonNodeFields(input),
  }
}

export function createOmrPageIR(input = {}) {
  const pageIndex = Number.isInteger(input.pageIndex) ? input.pageIndex : 0
  const pageId = String(input.pageId ?? createOmrV3Id('page', input.documentId, pageIndex))
  return {
    pageId,
    documentId: input.documentId == null ? null : String(input.documentId),
    pageIndex,
    width: finiteOrNull(input.width),
    height: finiteOrNull(input.height),
    systems: asArray(input.systems).map((system, index) =>
      createOmrSystemIR({ pageId, readingOrder: index, ...system }),
    ),
    unassignedSymbols: asArray(input.unassignedSymbols).map((symbol) => copyRecord(symbol)),
    ...commonNodeFields(input),
  }
}

export function createOmrRelationshipIR(input = {}) {
  return {
    relationshipId: String(
      input.relationshipId ?? createOmrV3Id('relationship', input.type, ...asArray(input.members)),
    ),
    type: input.type ?? OMR_V3_RELATIONSHIP_TYPE.TECHNIQUE,
    members: [...asArray(input.members)],
    directed: Boolean(input.directed),
    metadata: copyRecord(input.metadata),
    ...commonNodeFields(input),
  }
}

export function createOmrDocumentIR(input = {}) {
  const documentId = String(input.documentId ?? createOmrV3Id('document', input.sourceId ?? 'unknown'))
  return {
    schemaVersion: OMR_V3_SCHEMA_VERSION,
    documentId,
    metadata: copyRecord(input.metadata),
    pages: asArray(input.pages).map((page, index) =>
      createOmrPageIR({ documentId, pageIndex: page?.pageIndex ?? index, ...page }),
    ),
    relationships: asArray(input.relationships).map(createOmrRelationshipIR),
    ...commonNodeFields(input),
  }
}

function addIssue(target, path, code, message) {
  target.push({ path, code, message })
}

function validateId(value, path, errors) {
  if (typeof value !== 'string' || value.trim() === '') {
    addIssue(errors, path, 'invalid-id', 'Expected a non-empty string ID.')
    return false
  }
  return true
}

function validateBox(box, path, errors) {
  if (!plainObject(box)) {
    addIssue(errors, path, 'invalid-bounding-box', 'Expected a bounding-box object.')
    return
  }
  if (!BOX_SPACES.has(box.space)) {
    addIssue(errors, `${path}.space`, 'invalid-geometry-space', 'Expected normalized or pixels.')
  }
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Number.isFinite(box[key])) {
      addIssue(errors, `${path}.${key}`, 'non-finite-geometry', 'Geometry values must be finite.')
    }
  }
  if (Number.isFinite(box.width) && box.width < 0) {
    addIssue(errors, `${path}.width`, 'negative-geometry-size', 'Width cannot be negative.')
  }
  if (Number.isFinite(box.height) && box.height < 0) {
    addIssue(errors, `${path}.height`, 'negative-geometry-size', 'Height cannot be negative.')
  }
  if (box.space === 'normalized') {
    for (const key of ['x', 'y', 'width', 'height']) {
      if (Number.isFinite(box[key]) && (box[key] < 0 || box[key] > 1)) {
        addIssue(errors, `${path}.${key}`, 'normalized-geometry-out-of-range', 'Expected 0..1.')
      }
    }
    if (Number.isFinite(box.x) && Number.isFinite(box.width) && box.x + box.width > 1.000001) {
      addIssue(errors, path, 'normalized-geometry-overflow', 'x + width exceeds 1.')
    }
    if (Number.isFinite(box.y) && Number.isFinite(box.height) && box.y + box.height > 1.000001) {
      addIssue(errors, path, 'normalized-geometry-overflow', 'y + height exceeds 1.')
    }
  }
}

function validateConfidence(confidence, path, errors) {
  if (!plainObject(confidence)) {
    addIssue(errors, path, 'invalid-confidence', 'Expected confidence object.')
    return
  }
  if (confidence.overall != null && (!Number.isFinite(confidence.overall) || confidence.overall < 0 || confidence.overall > 1)) {
    addIssue(errors, `${path}.overall`, 'invalid-confidence', 'Confidence must be null or 0..1.')
  }
  for (const [stage, score] of Object.entries(confidence.stages ?? {})) {
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      addIssue(errors, `${path}.stages.${stage}`, 'invalid-stage-confidence', 'Stage confidence must be 0..1.')
    }
  }
}

function validateDiagnostics(diagnostics, path, errors) {
  if (!Array.isArray(diagnostics)) {
    addIssue(errors, path, 'invalid-diagnostics', 'Expected diagnostics array.')
    return
  }
  diagnostics.forEach((diagnostic, index) => {
    if (!DIAGNOSTIC_SEVERITIES.has(diagnostic?.severity)) {
      addIssue(errors, `${path}[${index}].severity`, 'invalid-diagnostic-severity', 'Unknown severity.')
    }
  })
}

function registerId(id, path, state) {
  if (!validateId(id, path, state.errors)) {
    return
  }
  if (state.ids.has(id)) {
    addIssue(state.errors, path, 'duplicate-id', `Duplicate ID: ${id}`)
    return
  }
  state.ids.add(id)
}

function validateCommon(node, path, state) {
  validateConfidence(node?.confidence, `${path}.confidence`, state.errors)
  validateDiagnostics(node?.diagnostics, `${path}.diagnostics`, state.errors)
  if (!Array.isArray(node?.sourceRefs)) {
    addIssue(state.errors, `${path}.sourceRefs`, 'invalid-source-refs', 'Expected sourceRefs array.')
  }
}

function validateEvent(event, path, state) {
  registerId(event?.eventId, `${path}.eventId`, state)
  validateCommon(event, path, state)
  if (event?.onset != null && (!Number.isFinite(event.onset) || event.onset < 0)) {
    addIssue(state.errors, `${path}.onset`, 'invalid-onset', 'Onset must be finite and non-negative.')
  }
  const divisions = event?.duration?.divisions
  if (divisions != null && (!Number.isFinite(divisions) || divisions < 0)) {
    addIssue(state.errors, `${path}.duration.divisions`, 'invalid-duration', 'Duration must be finite and non-negative.')
  }
  for (const ref of [event?.staffId, event?.measureId, event?.voiceId, event?.onsetColumnId]) {
    if (ref != null) state.refs.push({ ref, path })
  }
}

function validateVoice(voice, path, state) {
  registerId(voice?.voiceId, `${path}.voiceId`, state)
  validateCommon(voice, path, state)
  if (voice?.staffId != null) state.refs.push({ ref: voice.staffId, path: `${path}.staffId` })
  asArray(voice?.onsetColumnIds).forEach((ref, index) =>
    state.refs.push({ ref, path: `${path}.onsetColumnIds[${index}]` }),
  )
  asArray(voice?.events).forEach((event, index) => validateEvent(event, `${path}.events[${index}]`, state))
}

function validateOnsetColumn(column, path, state) {
  registerId(column?.onsetColumnId, `${path}.onsetColumnId`, state)
  validateCommon(column, path, state)
  if (column?.measureId != null) state.refs.push({ ref: column.measureId, path: `${path}.measureId` })
  if (!Number.isFinite(column?.x)) {
    addIssue(state.errors, `${path}.x`, 'invalid-onset-x', 'Onset x must be finite.')
  }
  if (
    column?.measureRelativePosition != null &&
    (!Number.isFinite(column.measureRelativePosition) ||
      column.measureRelativePosition < 0 ||
      column.measureRelativePosition > 1)
  ) {
    addIssue(state.errors, `${path}.measureRelativePosition`, 'invalid-relative-position', 'Expected 0..1.')
  }
}

function validateMeasure(measure, path, state) {
  registerId(measure?.measureId, `${path}.measureId`, state)
  validateCommon(measure, path, state)
  if (measure?.systemId != null) state.refs.push({ ref: measure.systemId, path: `${path}.systemId` })
  if (!Number.isFinite(measure?.xStart) || !Number.isFinite(measure?.xEnd) || measure.xEnd <= measure.xStart) {
    addIssue(state.errors, path, 'invalid-measure-span', 'Measure requires finite xStart < xEnd.')
  }
  if (measure?.boundingBox != null) validateBox(measure.boundingBox, `${path}.boundingBox`, state.errors)
  asArray(measure?.expectedStaffParticipation).forEach((ref, index) =>
    state.refs.push({ ref, path: `${path}.expectedStaffParticipation[${index}]` }),
  )
  asArray(measure?.onsetColumns).forEach((column, index) =>
    validateOnsetColumn(column, `${path}.onsetColumns[${index}]`, state),
  )
  asArray(measure?.voices).forEach((voice, index) => validateVoice(voice, `${path}.voices[${index}]`, state))
}

function validateStaff(staff, path, state) {
  registerId(staff?.staffId, `${path}.staffId`, state)
  validateCommon(staff, path, state)
  if (staff?.systemId != null) state.refs.push({ ref: staff.systemId, path: `${path}.systemId` })
  if (!Number.isInteger(staff?.lineCount) || staff.lineCount < 1 || staff.lineCount > 24) {
    addIssue(state.errors, `${path}.lineCount`, 'invalid-line-count', 'Expected integer line count 1..24.')
  }
  if (!NOTATION_TYPES.has(staff?.notationType)) {
    addIssue(state.errors, `${path}.notationType`, 'invalid-notation-type', 'Unknown notation type.')
  }
  if (staff?.boundingBox != null) validateBox(staff.boundingBox, `${path}.boundingBox`, state.errors)
  for (const [collection, expectedSpace] of [
    ['rawLineGeometry', null],
    ['normalizedLineGeometry', 'normalized'],
  ]) {
    asArray(staff?.[collection]).forEach((line, index) => {
      if (!BOX_SPACES.has(line?.space) || (expectedSpace && line.space !== expectedSpace)) {
        addIssue(state.errors, `${path}.${collection}[${index}].space`, 'invalid-line-space', 'Invalid line geometry space.')
      }
      for (const key of ['xStart', 'xEnd', 'yStart', 'yEnd']) {
        if (!Number.isFinite(line?.[key])) {
          addIssue(state.errors, `${path}.${collection}[${index}].${key}`, 'non-finite-geometry', 'Line values must be finite.')
        }
      }
    })
  }
  asArray(staff?.measureMembership).forEach((ref, index) =>
    state.refs.push({ ref, path: `${path}.measureMembership[${index}]` }),
  )
}

function validateStaffGroup(group, path, state) {
  registerId(group?.staffGroupId, `${path}.staffGroupId`, state)
  validateCommon(group, path, state)
  if (group?.systemId != null) state.refs.push({ ref: group.systemId, path: `${path}.systemId` })
  if (!STAFF_GROUP_TYPES.has(group?.type)) {
    addIssue(state.errors, `${path}.type`, 'invalid-staff-group-type', 'Unknown staff group type.')
  }
  if (!Array.isArray(group?.staves) || group.staves.length === 0) {
    addIssue(state.errors, `${path}.staves`, 'empty-staff-group', 'A staff group requires at least one staff.')
  }
  asArray(group?.staves).forEach((staff, index) => validateStaff(staff, `${path}.staves[${index}]`, state))
}

function validateSystem(system, path, state) {
  registerId(system?.systemId, `${path}.systemId`, state)
  validateCommon(system, path, state)
  if (system?.pageId != null) state.refs.push({ ref: system.pageId, path: `${path}.pageId` })
  validateBox(system?.boundingBox, `${path}.boundingBox`, state.errors)
  asArray(system?.staffGroups).forEach((group, index) =>
    validateStaffGroup(group, `${path}.staffGroups[${index}]`, state),
  )
  asArray(system?.measureColumns).forEach((measure, index) =>
    validateMeasure(measure, `${path}.measureColumns[${index}]`, state),
  )
}

function validatePage(page, path, state) {
  registerId(page?.pageId, `${path}.pageId`, state)
  validateCommon(page, path, state)
  if (page?.documentId != null) state.refs.push({ ref: page.documentId, path: `${path}.documentId` })
  if (!Number.isInteger(page?.pageIndex) || page.pageIndex < 0) {
    addIssue(state.errors, `${path}.pageIndex`, 'invalid-page-index', 'Expected a zero-based page index.')
  }
  if (!Number.isFinite(page?.width) || page.width <= 0 || !Number.isFinite(page?.height) || page.height <= 0) {
    addIssue(state.errors, path, 'invalid-page-dimensions', 'Page width and height must be positive finite values.')
  }
  asArray(page?.systems).forEach((system, index) => validateSystem(system, `${path}.systems[${index}]`, state))
}

function validateRelationship(relationship, path, state) {
  registerId(relationship?.relationshipId, `${path}.relationshipId`, state)
  validateCommon(relationship, path, state)
  if (!RELATIONSHIP_TYPES.has(relationship?.type)) {
    addIssue(state.errors, `${path}.type`, 'invalid-relationship-type', 'Unknown relationship type.')
  }
  if (!Array.isArray(relationship?.members) || relationship.members.length < 2) {
    addIssue(state.errors, `${path}.members`, 'invalid-relationship-members', 'At least two members are required.')
  }
  asArray(relationship?.members).forEach((ref, index) =>
    state.refs.push({ ref, path: `${path}.members[${index}]` }),
  )
}

export function validateOmrDocumentIR(document, { allowDanglingSourceRefs = true } = {}) {
  const state = { errors: [], warnings: [], ids: new Set(), refs: [] }
  if (!plainObject(document)) {
    return {
      valid: false,
      errors: [{ path: '$', code: 'invalid-document', message: 'Expected an object.' }],
      warnings: [],
    }
  }
  if (document.schemaVersion !== OMR_V3_SCHEMA_VERSION) {
    addIssue(state.errors, '$.schemaVersion', 'unsupported-schema-version', `Expected ${OMR_V3_SCHEMA_VERSION}.`)
  }
  registerId(document.documentId, '$.documentId', state)
  validateCommon(document, '$', state)
  asArray(document.pages).forEach((page, index) => validatePage(page, `$.pages[${index}]`, state))
  asArray(document.relationships).forEach((relationship, index) =>
    validateRelationship(relationship, `$.relationships[${index}]`, state),
  )
  for (const { ref, path } of state.refs) {
    if (typeof ref !== 'string' || ref.trim() === '') {
      addIssue(state.errors, path, 'invalid-reference', 'References must be non-empty strings.')
    } else if (!state.ids.has(ref)) {
      addIssue(state.errors, path, 'dangling-reference', `Unknown IR ID: ${ref}`)
    }
  }
  if (!allowDanglingSourceRefs) {
    // Source references intentionally point outside the IR by default. Callers
    // may enforce their own source registry before export.
    addIssue(state.warnings, '$.sourceRefs', 'source-registry-not-provided', 'No source registry was supplied.')
  }
  return { valid: state.errors.length === 0, errors: state.errors, warnings: state.warnings }
}

export function assertValidOmrDocumentIR(document, options = {}) {
  const result = validateOmrDocumentIR(document, options)
  if (!result.valid) {
    const summary = result.errors
      .slice(0, 8)
      .map((error) => `${error.path}: ${error.message}`)
      .join('; ')
    throw new TypeError(`Invalid OMR V3 IR: ${summary}`)
  }
  return document
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (!plainObject(value)) {
    return value
  }
  const result = {}
  for (const key of Object.keys(value).sort()) {
    result[key] = canonicalize(value[key])
  }
  return result
}

/** Canonical key ordering makes debug JSON byte-stable for equal IR data. */
export function serializeOmrDocumentIR(document, { pretty = false, validate = true } = {}) {
  if (validate) assertValidOmrDocumentIR(document)
  return JSON.stringify(canonicalize(document), null, pretty ? 2 : 0)
}

export function parseOmrDocumentIR(json, options = {}) {
  let parsed
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new TypeError(`Invalid OMR V3 JSON: ${error.message}`, { cause: error })
  }
  return assertValidOmrDocumentIR(parsed, options)
}

export function exportOmrV3DebugJson(document, options = {}) {
  return serializeOmrDocumentIR(document, { pretty: true, ...options })
}

export function deepFreezeOmrIR(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  Object.freeze(value)
  for (const child of Object.values(value)) {
    deepFreezeOmrIR(child)
  }
  return value
}
