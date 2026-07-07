export const MIC_DEBUG_FRAME_LIMIT = 20
export const MIC_TRACE_FRAME_LIMIT = 240

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null
}

function harmonicProfileForNote(note) {
  const magnitudes = Array.isArray(note?.harmonicMagnitudes)
    ? note.harmonicMagnitudes.map((value) => finiteOrNull(value))
    : []
  if (!magnitudes.length) {
    return null
  }

  let strongestIndex = 0
  for (let index = 1; index < magnitudes.length; index += 1) {
    if ((magnitudes[index] ?? 0) > (magnitudes[strongestIndex] ?? 0)) {
      strongestIndex = index
    }
  }

  const h1 = magnitudes[0] ?? 0
  const h2 = magnitudes[1] ?? 0
  const lowEnergy = h1 + h2
  const highEnergy = magnitudes
    .slice(3)
    .reduce((sum, value) => sum + (value ?? 0), 0)

  return {
    midi: note?.midi ?? null,
    detected: Boolean(note?.detected),
    isBass: Boolean(note?.isBass),
    strongestPartial: strongestIndex + 1,
    h2OverH1: h1 > 0 ? finiteOrNull(h2 / h1) : null,
    highLowRatio: lowEnergy > 0 ? finiteOrNull(highEnergy / lowEnergy) : null,
    harmonicSupport: finiteOrNull(note?.harmonicSupport),
    magnitudes,
  }
}

function summarizeHarmonicProfile(notes = []) {
  const profiles = notes
    .map((note) => harmonicProfileForNote(note))
    .filter(Boolean)
  const detected = profiles.filter((profile) => profile.detected)
  const source = detected[0] ?? profiles[0] ?? null
  return {
    profiles,
    detectedCount: detected.length,
    strongestPartial: source?.strongestPartial ?? null,
    h2OverH1: source?.h2OverH1 ?? null,
    highLowRatio: source?.highLowRatio ?? null,
  }
}

function classifyElectricGuitarSignal(frame, harmonicProfile) {
  const shape = frame?.signalShape ?? null
  const highLowRatio = harmonicProfile?.highLowRatio ?? null
  const h2OverH1 = harmonicProfile?.h2OverH1 ?? null
  const strongestPartial = harmonicProfile?.strongestPartial ?? null
  const gateOpen = Boolean(frame?.gateOpen)
  const detectedMidis = Array.isArray(frame?.v2DetectedMidis) ? frame.v2DetectedMidis : []
  const ampColorationLikely =
    gateOpen &&
    detectedMidis.length > 0 &&
    strongestPartial != null &&
    strongestPartial >= 2 &&
    strongestPartial <= 3 &&
    (shape === 'sustained' || shape === 'distorted' || shape === 'percussive')

  return {
    cleanLikely:
      gateOpen &&
      detectedMidis.length > 0 &&
      (shape === 'sustained' || shape === 'percussive') &&
      (h2OverH1 == null || h2OverH1 <= 1.4),
    distortedLikely:
      gateOpen &&
      (shape === 'distorted' || (highLowRatio != null && highLowRatio >= 0.28)),
    ampColorationLikely,
    strongestPartial,
    h2OverH1,
    highLowRatio,
    signalShape: shape,
    gateOpen,
    detectedMidis: [...detectedMidis],
    v2MeanConfidence: finiteOrNull(frame?.v2MeanConfidence),
  }
}

export function createMicDebugFrameRecord({
  frame,
  expectedMidis = [],
  instrumentId = null,
  inputSource = 'microphone',
  captureSettings = null,
  rejectReason = null,
  timestampMs = null,
} = {}) {
  const harmonicProfile = summarizeHarmonicProfile(frame?.v2Notes ?? [])
  const electricGuitarSignal = classifyElectricGuitarSignal(frame, harmonicProfile)

  return {
    timestampMs: finiteOrNull(timestampMs),
    expectedMidis: Array.isArray(expectedMidis) ? [...expectedMidis] : [],
    detectedMidi: frame?.midi ?? null,
    detectedMidis: Array.isArray(frame?.v2DetectedMidis)
      ? [...frame.v2DetectedMidis]
      : frame?.midi != null
        ? [frame.midi]
        : [],
    detectedFrequency: finiteOrNull(frame?.frequency ?? frame?.pitch?.frequency),
    midiFloat: finiteOrNull(frame?.midiFloat),
    centsOffset: finiteOrNull(frame?.centsOffset),
    rms: finiteOrNull(frame?.rms),
    rawRms: finiteOrNull(frame?.rawRms ?? frame?.rms),
    filteredRms: finiteOrNull(frame?.filteredRms),
    level: finiteOrNull(frame?.level),
    noiseFloor: finiteOrNull(frame?.noiseFloor),
    gateThreshold: finiteOrNull(frame?.gateThreshold),
    gateOpen: Boolean(frame?.gateOpen),
    rawGateOpen: Boolean(frame?.rawGateOpen ?? frame?.gateOpen),
    softGateOpen: Boolean(frame?.softGateOpen),
    softGateThreshold: finiteOrNull(frame?.softGateThreshold),
    softGateEvidence: Boolean(frame?.softGateEvidence),
    scoreInformedQuietGateOpen: Boolean(frame?.scoreInformedQuietGateOpen),
    clarity: finiteOrNull(frame?.clarity),
    v2MeanConfidence: finiteOrNull(frame?.v2MeanConfidence),
    v2DetectedMidis: Array.isArray(frame?.v2DetectedMidis) ? [...frame.v2DetectedMidis] : [],
    v2Notes: Array.isArray(frame?.v2Notes)
      ? frame.v2Notes.map((note) => ({
          midi: note.midi ?? null,
          confidence: finiteOrNull(note.confidence),
          ratio: finiteOrNull(note.ratio),
          harmonicSupport: finiteOrNull(note.harmonicSupport),
          harmonicMagnitudes: Array.isArray(note.harmonicMagnitudes)
            ? note.harmonicMagnitudes.map((value) => finiteOrNull(value))
            : [],
          detected: Boolean(note.detected),
        }))
      : [],
    harmonicProfile,
    electricGuitarSignal,
    signalShape: frame?.signalShape ?? null,
    signalQuality: frame?.signalQuality ?? null,
    rejectReason,
    instrumentId: instrumentId ?? null,
    inputSource,
    micEngineMode: frame?.micEngineMode ?? null,
    calibrationStatus: frame?.calibrationStatus ?? null,
    captureSettings: captureSettings ? { ...captureSettings } : null,
  }
}

export function pushMicDebugFrame(buffer, frame, limit = MIC_DEBUG_FRAME_LIMIT) {
  if (!Array.isArray(buffer) || !frame) {
    return []
  }
  buffer.push(frame)
  while (buffer.length > limit) {
    buffer.shift()
  }
  return buffer
}

function summarizeStringFrets(entries = []) {
  return Array.isArray(entries)
    ? entries.map((entry) => ({
        string: entry?.string ?? null,
        fret: entry?.fret ?? null,
        midi: entry?.midi ?? null,
        label: entry?.label ?? null,
      }))
    : []
}

function summarizeTraceNotes(notes = []) {
  return Array.isArray(notes)
    ? notes.map((note) => ({
        midi: note?.midi ?? null,
        detected: Boolean(note?.detected),
        confidence: finiteOrNull(note?.confidence),
        ratio: finiteOrNull(note?.ratio),
        relativeEnergy: finiteOrNull(note?.relativeEnergy),
        peerRelative: finiteOrNull(note?.peerRelative),
        fundamentalEnergy: finiteOrNull(note?.fundamentalEnergy),
        harmonicEnergy: finiteOrNull(note?.harmonicEnergy),
        harmonicSupport: finiteOrNull(note?.harmonicSupport),
      }))
    : []
}

function summarizeChordState({
  expectedMidis = [],
  micChordState = null,
  guitarChordShapeState = null,
  nowMs = null,
} = {}) {
  const sequenceMatched = [...(micChordState?.matchedIndices ?? [])]
  const guitarHeard = [...(guitarChordShapeState?.heardMidis ?? [])]
  const sequenceAge =
    nowMs != null && micChordState?.windowStartMs != null
      ? finiteOrNull(nowMs - micChordState.windowStartMs)
      : null
  const guitarAge =
    nowMs != null && guitarChordShapeState?.windowStartMs != null
      ? finiteOrNull(nowMs - guitarChordShapeState.windowStartMs)
      : null

  return {
    collectedMidis: [
      ...new Set([
        ...sequenceMatched
          .map((index) => expectedMidis[index])
          .filter((midi) => Number.isFinite(midi)),
        ...guitarHeard,
      ]),
    ],
    sequenceMatchedIndices: sequenceMatched,
    sequencePendingIndex: micChordState?.pendingIndex ?? null,
    sequencePendingHits: micChordState?.pendingHits ?? 0,
    sequenceWrongStreak: micChordState?.wrongStreak ?? 0,
    guitarHeardMidis: guitarHeard,
    rollingWindowAgeMs: guitarAge ?? sequenceAge,
  }
}

export function createMicTraceFrameRecord({
  frame,
  checkpoint = null,
  checkpointIndex = null,
  expectedMidis = [],
  micChordState = null,
  guitarChordShapeState = null,
  attackLatch = null,
  attackRearmReason = null,
  matchConfirm = null,
  matchResult = null,
  rejectReason = null,
  advanced = false,
  timestampMs = null,
} = {}) {
  const nowMs = finiteOrNull(timestampMs)
  return {
    timestampMs: nowMs,
    checkpointId: checkpoint?.id ?? null,
    checkpointIndex: Number.isFinite(checkpointIndex) ? checkpointIndex : null,
    checkpointKind: checkpoint?.kind ?? checkpoint?.targetKind ?? null,
    expectedMidis: Array.isArray(expectedMidis) ? [...expectedMidis] : [],
    expectedStringFrets: summarizeStringFrets(checkpoint?.expectedStringFrets ?? []),
    rms: finiteOrNull(frame?.rms),
    rawRms: finiteOrNull(frame?.rawRms ?? frame?.rms),
    filteredRms: finiteOrNull(frame?.filteredRms),
    noiseFloor: finiteOrNull(frame?.noiseFloor),
    rawGateOpen: Boolean(frame?.rawGateOpen ?? frame?.gateOpen),
    softGateOpen: Boolean(frame?.softGateOpen),
    softGateThreshold: finiteOrNull(frame?.softGateThreshold),
    scoreInformedQuietGateOpen: Boolean(frame?.scoreInformedQuietGateOpen),
    gateOpen: Boolean(frame?.gateOpen),
    attackLatch: {
      awaitingRelease: Boolean(attackLatch?.awaitingRelease),
      gateClosedFrames: attackLatch?.gateClosedFrames ?? 0,
      consumedMidis: [...(attackLatch?.consumedMidis ?? [])],
      envelopeRms: finiteOrNull(attackLatch?.envelopeRms),
    },
    attackRearmReason: attackRearmReason ?? null,
    detectedMidis: Array.isArray(frame?.v2DetectedMidis) ? [...frame.v2DetectedMidis] : [],
    v2Notes: summarizeTraceNotes(frame?.v2Notes ?? []),
    dominantPitchMidi: frame?.dominantPitchMidi ?? frame?.midi ?? null,
    dominantPitchMidiFloat: finiteOrNull(frame?.dominantPitchMidiFloat ?? frame?.midiFloat),
    dominantPitchCents: finiteOrNull(
      frame?.dominantPitchMidiFloat != null
        ? frame.dominantPitchMidiFloat * 100
        : frame?.midiFloat != null
          ? frame.midiFloat * 100
          : null,
    ),
    v2MeanConfidence: finiteOrNull(frame?.v2MeanConfidence),
    chord: summarizeChordState({
      expectedMidis,
      micChordState,
      guitarChordShapeState,
      nowMs,
    }),
    matchConfirm: {
      key: matchConfirm?.key ?? '',
      count: matchConfirm?.count ?? 0,
      anchorCents: finiteOrNull(matchConfirm?.anchorCents),
    },
    matchOutcome: matchResult?.outcome ?? null,
    matchedCount: matchResult?.matchedCount ?? matchResult?.matchedIndices?.size ?? 0,
    rejectReason: rejectReason ?? null,
    advanced: Boolean(advanced),
  }
}

export function pushMicTraceFrame(buffer, frame, limit = MIC_TRACE_FRAME_LIMIT) {
  if (!Array.isArray(buffer) || !frame) {
    return []
  }
  buffer.push(frame)
  while (buffer.length > limit) {
    buffer.shift()
  }
  return buffer
}

export function serializeMicDebugFrames(frames = []) {
  return JSON.stringify(
    {
      version: 1,
      generatedAt: new Date().toISOString(),
      frameCount: Array.isArray(frames) ? frames.length : 0,
      frames: Array.isArray(frames) ? frames : [],
    },
    null,
    2,
  )
}

export function serializeMicTraceFrames(frames = []) {
  return JSON.stringify(
    {
      version: 1,
      generatedAt: new Date().toISOString(),
      frameCount: Array.isArray(frames) ? frames.length : 0,
      frames: Array.isArray(frames) ? frames : [],
    },
    null,
    2,
  )
}
