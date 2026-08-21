/**
 * Mic Engine V3 recognition IR.
 *
 * These objects are immutable, JSON-serializable snapshots. Mutable tracking
 * state belongs to recognition engines; it is exported through this IR only at
 * decision/debug boundaries. This module deliberately has no React, Web Audio,
 * DOM, or practice-session dependency.
 */

export const MIC_RECOGNITION_SCHEMA_VERSION = 3

export const MIC_RECOGNITION_TYPE = Object.freeze({
  FRAME: 'MicFrame',
  ATTACK: 'Attack',
  PITCH_CANDIDATE: 'PitchCandidate',
  CHORD_CANDIDATE: 'ChordCandidate',
  WINDOW: 'RecognitionWindow',
  CHECKPOINT: 'PerformanceCheckpoint',
  DECISION: 'RecognitionDecision',
})

export const ATTACK_PHASE = Object.freeze({
  ATTACK: 'attack',
  HOLD: 'hold',
  RELEASE: 'release',
  RINGING: 'ringing',
})

export const RECOGNITION_OUTCOME = Object.freeze({
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  PROGRESS: 'progress',
  HOLD: 'hold',
  IGNORED: 'ignored',
})

export const RECOGNITION_TIMING = Object.freeze({
  EARLY: 'early',
  TARGET: 'target',
  LATE: 'late',
  OUTSIDE: 'outside',
  UNTIMED: 'untimed',
})

const CONFIDENCE_KEYS = Object.freeze([
  'overall',
  'signal',
  'pitch',
  'harmony',
  'temporal',
  'attack',
  'expectation',
  'instrument',
  'rejection',
])

function assertFinite(value, name, { nullable = false, min = null } = {}) {
  if (nullable && value == null) {
    return null
  }
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`)
  }
  if (min != null && value < min) {
    throw new TypeError(`${name} must be >= ${min}`)
  }
  return value
}

function assertString(value, name, { nullable = false } = {}) {
  if (nullable && value == null) {
    return null
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`)
  }
  return value
}

function assertMidi(value, name = 'midi', { nullable = false } = {}) {
  if (nullable && value == null) {
    return null
  }
  assertFinite(value, name)
  if (value < 0 || value > 127) {
    throw new TypeError(`${name} must be within 0..127`)
  }
  return value
}

function uniqueFiniteMidis(values = []) {
  const seen = new Set()
  const result = []
  for (const value of values ?? []) {
    const midi = Number(value)
    assertMidi(midi)
    if (!seen.has(midi)) {
      seen.add(midi)
      result.push(midi)
    }
  }
  return result
}

function normalizeStringArray(values = [], name = 'values') {
  if (!Array.isArray(values)) {
    throw new TypeError(`${name} must be an array`)
  }
  return values.map((value, index) => assertString(value, `${name}[${index}]`))
}

function isPlainObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function cloneJsonValue(value, path = 'value') {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} contains a non-finite number`)
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => cloneJsonValue(entry, `${path}[${index}]`))
  }
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must contain only JSON-compatible plain data`)
  }
  const clone = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) {
      throw new TypeError(`${path}.${key} must not be undefined`)
    }
    clone[key] = cloneJsonValue(entry, `${path}.${key}`)
  }
  return clone
}

export function deepFreezeRecognitionIr(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  for (const child of Object.values(value)) {
    deepFreezeRecognitionIr(child)
  }
  return Object.freeze(value)
}

function finalizeSnapshot(value) {
  return deepFreezeRecognitionIr(cloneJsonValue(value))
}

function idPart(value) {
  return String(value ?? 'none')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'none'
}

export function createRecognitionId(kind, ...parts) {
  return `mic3:${idPart(kind)}:${parts.map(idPart).join(':')}`
}

export function createConfidenceBreakdown(input = {}) {
  if (!isPlainObject(input)) {
    throw new TypeError('confidence must be a plain object')
  }
  const confidence = {}
  for (const key of CONFIDENCE_KEYS) {
    const value = input[key] ?? (key === 'overall' ? 0 : null)
    if (value == null) {
      confidence[key] = null
      continue
    }
    assertFinite(value, `confidence.${key}`)
    if (value < 0 || value > 1) {
      throw new TypeError(`confidence.${key} must be within 0..1`)
    }
    confidence[key] = value
  }
  confidence.reasons = normalizeStringArray(input.reasons ?? [], 'confidence.reasons')
  return finalizeSnapshot(confidence)
}

function baseSnapshot(type, { id, diagnostics = [], evidenceRefs = [], debug = {} } = {}) {
  return {
    schemaVersion: MIC_RECOGNITION_SCHEMA_VERSION,
    type,
    id: assertString(id, `${type}.id`),
    diagnostics: (diagnostics ?? []).map((entry, index) => {
      const diagnostic = cloneJsonValue(entry, `${type}.diagnostics[${index}]`)
      if (!isPlainObject(diagnostic) || typeof diagnostic.code !== 'string') {
        throw new TypeError(`${type}.diagnostics[${index}] requires a code`)
      }
      return diagnostic
    }),
    evidenceRefs: normalizeStringArray(evidenceRefs ?? [], `${type}.evidenceRefs`),
    debug: cloneJsonValue(debug ?? {}, `${type}.debug`),
  }
}

export function createPitchCandidate({
  id,
  midi,
  midiFloat = null,
  frequencyHz = null,
  centsOffset = null,
  detected = false,
  lifecycle = 'candidate',
  source = 'unknown',
  confidence = {},
  harmonicEvidence = {},
  stringFretEvidence = null,
  diagnostics = [],
  evidenceRefs = [],
  debug = {},
} = {}) {
  const resolvedId = id ?? createRecognitionId('pitch', midi, source)
  return finalizeSnapshot({
    ...baseSnapshot(MIC_RECOGNITION_TYPE.PITCH_CANDIDATE, {
      id: resolvedId,
      diagnostics,
      evidenceRefs,
      debug,
    }),
    midi: assertMidi(Number(midi)),
    midiFloat: assertFinite(midiFloat, 'PitchCandidate.midiFloat', { nullable: true }),
    frequencyHz: assertFinite(frequencyHz, 'PitchCandidate.frequencyHz', {
      nullable: true,
      min: 0,
    }),
    centsOffset: assertFinite(centsOffset, 'PitchCandidate.centsOffset', { nullable: true }),
    detected: Boolean(detected),
    lifecycle: assertString(lifecycle, 'PitchCandidate.lifecycle'),
    source: assertString(source, 'PitchCandidate.source'),
    confidence: createConfidenceBreakdown(confidence),
    harmonicEvidence: cloneJsonValue(harmonicEvidence ?? {}, 'PitchCandidate.harmonicEvidence'),
    stringFretEvidence: stringFretEvidence == null
      ? null
      : cloneJsonValue(stringFretEvidence, 'PitchCandidate.stringFretEvidence'),
  })
}

export function createChordCandidate({
  id,
  midis = [],
  pitchCandidateIds = [],
  matchedMidis = [],
  missingMidis = [],
  unexpectedMidis = [],
  requiredToneCount = null,
  complete = false,
  rolled = false,
  confidence = {},
  progress = {},
  diagnostics = [],
  evidenceRefs = [],
  debug = {},
} = {}) {
  const normalizedMidis = uniqueFiniteMidis(midis)
  const resolvedRequired = requiredToneCount == null
    ? normalizedMidis.length
    : Math.round(assertFinite(Number(requiredToneCount), 'ChordCandidate.requiredToneCount', { min: 0 }))
  if (resolvedRequired > normalizedMidis.length) {
    throw new TypeError('ChordCandidate.requiredToneCount exceeds its tone count')
  }
  const resolvedId = id ?? createRecognitionId('chord', normalizedMidis.join('.'))
  return finalizeSnapshot({
    ...baseSnapshot(MIC_RECOGNITION_TYPE.CHORD_CANDIDATE, {
      id: resolvedId,
      diagnostics,
      evidenceRefs,
      debug,
    }),
    midis: normalizedMidis,
    pitchCandidateIds: normalizeStringArray(pitchCandidateIds, 'ChordCandidate.pitchCandidateIds'),
    matchedMidis: uniqueFiniteMidis(matchedMidis),
    missingMidis: uniqueFiniteMidis(missingMidis),
    unexpectedMidis: uniqueFiniteMidis(unexpectedMidis),
    requiredToneCount: resolvedRequired,
    complete: Boolean(complete),
    rolled: Boolean(rolled),
    confidence: createConfidenceBreakdown(confidence),
    progress: cloneJsonValue(progress ?? {}, 'ChordCandidate.progress'),
  })
}

export function createAttack({
  id,
  timeMs,
  phase = ATTACK_PHASE.ATTACK,
  endTimeMs = null,
  peakRms = null,
  envelopeRms = null,
  energyRiseRatio = null,
  pitchCandidateIds = [],
  isFresh = true,
  confidence = {},
  diagnostics = [],
  evidenceRefs = [],
  debug = {},
} = {}) {
  if (!Object.values(ATTACK_PHASE).includes(phase)) {
    throw new TypeError(`Unsupported Attack.phase: ${phase}`)
  }
  const resolvedTime = assertFinite(timeMs, 'Attack.timeMs', { min: 0 })
  const resolvedId = id ?? createRecognitionId('attack', resolvedTime, phase)
  return finalizeSnapshot({
    ...baseSnapshot(MIC_RECOGNITION_TYPE.ATTACK, {
      id: resolvedId,
      diagnostics,
      evidenceRefs,
      debug,
    }),
    timeMs: resolvedTime,
    endTimeMs: assertFinite(endTimeMs, 'Attack.endTimeMs', { nullable: true, min: 0 }),
    phase,
    peakRms: assertFinite(peakRms, 'Attack.peakRms', { nullable: true, min: 0 }),
    envelopeRms: assertFinite(envelopeRms, 'Attack.envelopeRms', { nullable: true, min: 0 }),
    energyRiseRatio: assertFinite(energyRiseRatio, 'Attack.energyRiseRatio', {
      nullable: true,
      min: 0,
    }),
    pitchCandidateIds: normalizeStringArray(pitchCandidateIds, 'Attack.pitchCandidateIds'),
    isFresh: Boolean(isFresh),
    confidence: createConfidenceBreakdown(confidence),
  })
}

export function createMicFrame({
  id,
  sequence = 0,
  timeMs,
  sampleRate,
  windowMs,
  signal = {},
  spectral = {},
  pitchCandidates = [],
  chordCandidates = [],
  attackIds = [],
  diagnostics = [],
  evidenceRefs = [],
  debug = {},
} = {}) {
  const resolvedSequence = Math.round(assertFinite(Number(sequence), 'MicFrame.sequence', { min: 0 }))
  const resolvedTime = assertFinite(timeMs, 'MicFrame.timeMs', { min: 0 })
  const resolvedId = id ?? createRecognitionId('frame', resolvedSequence, resolvedTime)
  return finalizeSnapshot({
    ...baseSnapshot(MIC_RECOGNITION_TYPE.FRAME, {
      id: resolvedId,
      diagnostics,
      evidenceRefs,
      debug,
    }),
    sequence: resolvedSequence,
    timeMs: resolvedTime,
    sampleRate: assertFinite(sampleRate, 'MicFrame.sampleRate', { min: 1 }),
    windowMs: assertFinite(windowMs, 'MicFrame.windowMs', { min: 0 }),
    signal: cloneJsonValue(signal ?? {}, 'MicFrame.signal'),
    spectral: cloneJsonValue(spectral ?? {}, 'MicFrame.spectral'),
    pitchCandidates: (pitchCandidates ?? []).map((candidate, index) => {
      if (candidate?.type !== MIC_RECOGNITION_TYPE.PITCH_CANDIDATE) {
        throw new TypeError(`MicFrame.pitchCandidates[${index}] is not a PitchCandidate`)
      }
      return candidate
    }),
    chordCandidates: (chordCandidates ?? []).map((candidate, index) => {
      if (candidate?.type !== MIC_RECOGNITION_TYPE.CHORD_CANDIDATE) {
        throw new TypeError(`MicFrame.chordCandidates[${index}] is not a ChordCandidate`)
      }
      return candidate
    }),
    attackIds: normalizeStringArray(attackIds, 'MicFrame.attackIds'),
  })
}

export function createPerformanceCheckpoint({
  id,
  index,
  sourceCheckpointId,
  mode,
  instrument,
  event,
  score,
  timing,
  ties,
  sustain,
  neighbors,
  policy,
  diagnostics = [],
  evidenceRefs = [],
  debug = {},
} = {}) {
  const resolvedIndex = Math.round(assertFinite(Number(index), 'PerformanceCheckpoint.index', { min: 0 }))
  const resolvedSourceId = assertString(sourceCheckpointId, 'PerformanceCheckpoint.sourceCheckpointId')
  const resolvedId = id ?? createRecognitionId('checkpoint', resolvedSourceId, resolvedIndex)
  return finalizeSnapshot({
    ...baseSnapshot(MIC_RECOGNITION_TYPE.CHECKPOINT, {
      id: resolvedId,
      diagnostics,
      evidenceRefs,
      debug,
    }),
    index: resolvedIndex,
    sourceCheckpointId: resolvedSourceId,
    mode: assertString(mode, 'PerformanceCheckpoint.mode'),
    instrument: assertString(instrument, 'PerformanceCheckpoint.instrument'),
    event: cloneJsonValue(event, 'PerformanceCheckpoint.event'),
    score: cloneJsonValue(score, 'PerformanceCheckpoint.score'),
    timing: cloneJsonValue(timing, 'PerformanceCheckpoint.timing'),
    ties: cloneJsonValue(ties, 'PerformanceCheckpoint.ties'),
    sustain: cloneJsonValue(sustain, 'PerformanceCheckpoint.sustain'),
    neighbors: cloneJsonValue(neighbors, 'PerformanceCheckpoint.neighbors'),
    policy: cloneJsonValue(policy, 'PerformanceCheckpoint.policy'),
  })
}

export function createRecognitionWindow({
  id,
  checkpointId,
  startTimeMs,
  endTimeMs = null,
  frames = [],
  attacks = [],
  pitchCandidates = [],
  chordCandidates = [],
  ringingMidis = [],
  chordProgress = {},
  diagnostics = [],
  evidenceRefs = [],
  debug = {},
} = {}) {
  const start = assertFinite(startTimeMs, 'RecognitionWindow.startTimeMs', { min: 0 })
  const end = assertFinite(endTimeMs, 'RecognitionWindow.endTimeMs', { nullable: true, min: 0 })
  if (end != null && end < start) {
    throw new TypeError('RecognitionWindow.endTimeMs must not precede startTimeMs')
  }
  const resolvedCheckpointId = assertString(checkpointId, 'RecognitionWindow.checkpointId')
  const resolvedId = id ?? createRecognitionId('window', resolvedCheckpointId, start)
  const typed = (items, type, name) => (items ?? []).map((item, index) => {
    if (item?.type !== type) {
      throw new TypeError(`${name}[${index}] has the wrong recognition type`)
    }
    return item
  })
  return finalizeSnapshot({
    ...baseSnapshot(MIC_RECOGNITION_TYPE.WINDOW, {
      id: resolvedId,
      diagnostics,
      evidenceRefs,
      debug,
    }),
    checkpointId: resolvedCheckpointId,
    startTimeMs: start,
    endTimeMs: end,
    frames: typed(frames, MIC_RECOGNITION_TYPE.FRAME, 'RecognitionWindow.frames'),
    attacks: typed(attacks, MIC_RECOGNITION_TYPE.ATTACK, 'RecognitionWindow.attacks'),
    pitchCandidates: typed(
      pitchCandidates,
      MIC_RECOGNITION_TYPE.PITCH_CANDIDATE,
      'RecognitionWindow.pitchCandidates',
    ),
    chordCandidates: typed(
      chordCandidates,
      MIC_RECOGNITION_TYPE.CHORD_CANDIDATE,
      'RecognitionWindow.chordCandidates',
    ),
    ringingMidis: uniqueFiniteMidis(ringingMidis),
    chordProgress: cloneJsonValue(chordProgress ?? {}, 'RecognitionWindow.chordProgress'),
  })
}

export function createRecognitionDecision({
  id,
  checkpointId,
  windowId,
  timeMs,
  outcome,
  timing = RECOGNITION_TIMING.UNTIMED,
  reason,
  advance = false,
  matchedMidis = [],
  missingMidis = [],
  unexpectedMidis = [],
  ringingMidis = [],
  attackId = null,
  confidence = {},
  progress = {},
  diagnostics = [],
  evidenceRefs = [],
  debug = {},
} = {}) {
  if (!Object.values(RECOGNITION_OUTCOME).includes(outcome)) {
    throw new TypeError(`Unsupported RecognitionDecision.outcome: ${outcome}`)
  }
  if (!Object.values(RECOGNITION_TIMING).includes(timing)) {
    throw new TypeError(`Unsupported RecognitionDecision.timing: ${timing}`)
  }
  if (advance && outcome !== RECOGNITION_OUTCOME.ACCEPTED) {
    throw new TypeError('Only an accepted RecognitionDecision may advance')
  }
  const resolvedTime = assertFinite(timeMs, 'RecognitionDecision.timeMs', { min: 0 })
  const resolvedCheckpointId = assertString(checkpointId, 'RecognitionDecision.checkpointId')
  const resolvedWindowId = assertString(windowId, 'RecognitionDecision.windowId')
  const resolvedId = id ?? createRecognitionId('decision', resolvedCheckpointId, resolvedTime, outcome)
  return finalizeSnapshot({
    ...baseSnapshot(MIC_RECOGNITION_TYPE.DECISION, {
      id: resolvedId,
      diagnostics,
      evidenceRefs,
      debug,
    }),
    checkpointId: resolvedCheckpointId,
    windowId: resolvedWindowId,
    timeMs: resolvedTime,
    outcome,
    timing,
    reason: assertString(reason, 'RecognitionDecision.reason'),
    advance: Boolean(advance),
    matchedMidis: uniqueFiniteMidis(matchedMidis),
    missingMidis: uniqueFiniteMidis(missingMidis),
    unexpectedMidis: uniqueFiniteMidis(unexpectedMidis),
    ringingMidis: uniqueFiniteMidis(ringingMidis),
    attackId: assertString(attackId, 'RecognitionDecision.attackId', { nullable: true }),
    confidence: createConfidenceBreakdown(confidence),
    progress: cloneJsonValue(progress ?? {}, 'RecognitionDecision.progress'),
  })
}

function collectRecognitionNodes(value, nodes = []) {
  if (value == null || typeof value !== 'object') {
    return nodes
  }
  if (typeof value.type === 'string' && typeof value.id === 'string') {
    nodes.push(value)
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      child.forEach((entry) => collectRecognitionNodes(entry, nodes))
    } else if (child && typeof child === 'object') {
      collectRecognitionNodes(child, nodes)
    }
  }
  return nodes
}

export function validateRecognitionIr(value) {
  const errors = []
  let clone
  try {
    clone = cloneJsonValue(value)
  } catch (error) {
    errors.push(error?.message ?? String(error))
    return { valid: false, errors }
  }
  const nodes = collectRecognitionNodes(clone)
  const ids = new Map()
  for (const node of nodes) {
    if (node.schemaVersion !== MIC_RECOGNITION_SCHEMA_VERSION) {
      errors.push(`${node.id} has unsupported schemaVersion ${node.schemaVersion}`)
    }
    if (!Object.values(MIC_RECOGNITION_TYPE).includes(node.type)) {
      errors.push(`${node.id} has unsupported type ${node.type}`)
    }
    const signature = JSON.stringify(node)
    if (ids.has(node.id) && ids.get(node.id) !== signature) {
      errors.push(`conflicting duplicate recognition id: ${node.id}`)
    }
    ids.set(node.id, signature)
  }
  return { valid: errors.length === 0, errors }
}

export function serializeRecognitionIr(value, { pretty = false } = {}) {
  const validation = validateRecognitionIr(value)
  if (!validation.valid) {
    throw new TypeError(`Invalid Mic V3 recognition IR: ${validation.errors.join('; ')}`)
  }
  return JSON.stringify(value, null, pretty ? 2 : 0)
}

export function parseRecognitionIr(json) {
  const parsed = JSON.parse(json)
  const validation = validateRecognitionIr(parsed)
  if (!validation.valid) {
    throw new TypeError(`Invalid Mic V3 recognition IR: ${validation.errors.join('; ')}`)
  }
  return deepFreezeRecognitionIr(parsed)
}
