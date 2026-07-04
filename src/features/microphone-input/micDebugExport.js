export const MIC_DEBUG_FRAME_LIMIT = 20

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null
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
    filteredRms: finiteOrNull(frame?.filteredRms),
    level: finiteOrNull(frame?.level),
    noiseFloor: finiteOrNull(frame?.noiseFloor),
    gateOpen: Boolean(frame?.gateOpen),
    clarity: finiteOrNull(frame?.clarity),
    v2MeanConfidence: finiteOrNull(frame?.v2MeanConfidence),
    v2DetectedMidis: Array.isArray(frame?.v2DetectedMidis) ? [...frame.v2DetectedMidis] : [],
    v2Notes: Array.isArray(frame?.v2Notes)
      ? frame.v2Notes.map((note) => ({
          midi: note.midi ?? null,
          confidence: finiteOrNull(note.confidence),
          ratio: finiteOrNull(note.ratio),
          detected: Boolean(note.detected),
        }))
      : [],
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
