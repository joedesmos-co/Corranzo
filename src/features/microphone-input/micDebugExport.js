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
    detectedFrequency: finiteOrNull(frame?.frequency ?? frame?.pitch?.frequency),
    centsOffset: finiteOrNull(frame?.centsOffset),
    rms: finiteOrNull(frame?.rms),
    filteredRms: finiteOrNull(frame?.filteredRms),
    noiseFloor: finiteOrNull(frame?.noiseFloor),
    gateOpen: Boolean(frame?.gateOpen),
    clarity: finiteOrNull(frame?.clarity),
    v2MeanConfidence: finiteOrNull(frame?.v2MeanConfidence),
    signalShape: frame?.signalShape ?? null,
    rejectReason,
    instrumentId: instrumentId ?? null,
    inputSource,
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
