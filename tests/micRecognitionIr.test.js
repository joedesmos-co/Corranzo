import { describe, expect, it } from 'vitest'
import {
  ATTACK_PHASE,
  MIC_RECOGNITION_TYPE,
  RECOGNITION_OUTCOME,
  RECOGNITION_TIMING,
  createAttack,
  createChordCandidate,
  createMicFrame,
  createPitchCandidate,
  createRecognitionDecision,
  createRecognitionWindow,
  parseRecognitionIr,
  serializeRecognitionIr,
  validateRecognitionIr,
} from '../src/features/microphone-input/v3/micRecognitionIr.js'

function fixtureGraph() {
  const pitch = createPitchCandidate({
    id: 'pitch-c4',
    midi: 60,
    midiFloat: 60.02,
    frequencyHz: 261.9,
    centsOffset: 2,
    detected: true,
    source: 'score-informed-harmonics',
    confidence: {
      overall: 0.88,
      signal: 0.8,
      pitch: 0.9,
      expectation: 0.94,
      reasons: ['expected fundamental and harmonics present'],
    },
    harmonicEvidence: { support: 3.2, ratio: 2.4 },
  })
  const chord = createChordCandidate({
    id: 'chord-c',
    midis: [60],
    pitchCandidateIds: [pitch.id],
    matchedMidis: [60],
    requiredToneCount: 1,
    complete: true,
    confidence: { overall: 0.88, harmony: 0.86 },
  })
  const attack = createAttack({
    id: 'attack-1',
    timeMs: 1000,
    phase: ATTACK_PHASE.ATTACK,
    peakRms: 0.12,
    energyRiseRatio: 1.9,
    pitchCandidateIds: [pitch.id],
    confidence: { overall: 0.91, attack: 0.91 },
  })
  const frame = createMicFrame({
    id: 'frame-1',
    sequence: 1,
    timeMs: 1000,
    sampleRate: 44100,
    windowMs: 46.4,
    signal: { gateOpen: true, musical: true, rms: 0.1 },
    spectral: { dominantMidi: 60.02 },
    pitchCandidates: [pitch],
    chordCandidates: [chord],
    attackIds: [attack.id],
  })
  const window = createRecognitionWindow({
    id: 'window-1',
    checkpointId: 'checkpoint-1',
    startTimeMs: 900,
    endTimeMs: 1050,
    frames: [frame],
    attacks: [attack],
    pitchCandidates: [pitch],
    chordCandidates: [chord],
    chordProgress: { matched: 1, required: 1 },
  })
  const decision = createRecognitionDecision({
    id: 'decision-1',
    checkpointId: 'checkpoint-1',
    windowId: window.id,
    timeMs: 1050,
    outcome: RECOGNITION_OUTCOME.ACCEPTED,
    timing: RECOGNITION_TIMING.TARGET,
    reason: 'complete-fresh-attack',
    advance: true,
    matchedMidis: [60],
    attackId: attack.id,
    confidence: { overall: 0.89, attack: 0.91, expectation: 0.94 },
    evidenceRefs: [frame.id, chord.id],
  })
  return { pitch, chord, attack, frame, window, decision }
}

describe('Mic Engine V3 recognition IR', () => {
  it('builds immutable JSON-serializable snapshots without mutating inputs', () => {
    const confidence = { overall: 0.8, reasons: ['stable'] }
    const candidate = createPitchCandidate({ midi: 64, source: 'test', confidence })
    confidence.overall = 0.1
    confidence.reasons.push('mutated')

    expect(candidate.confidence.overall).toBe(0.8)
    expect(candidate.confidence.reasons).toEqual(['stable'])
    expect(Object.isFrozen(candidate)).toBe(true)
    expect(Object.isFrozen(candidate.confidence)).toBe(true)
    expect(() => JSON.stringify(candidate)).not.toThrow()
  })

  it('represents frames, attacks, candidates, windows, and decisions explicitly', () => {
    const graph = fixtureGraph()
    expect(graph.frame.type).toBe(MIC_RECOGNITION_TYPE.FRAME)
    expect(graph.attack.type).toBe(MIC_RECOGNITION_TYPE.ATTACK)
    expect(graph.window.frames[0].id).toBe(graph.frame.id)
    expect(graph.decision.advance).toBe(true)
    expect(graph.decision.evidenceRefs).toEqual(['frame-1', 'chord-c'])
  })

  it('round-trips canonical recognition snapshots', () => {
    const { window } = fixtureGraph()
    const json = serializeRecognitionIr(window, { pretty: true })
    const parsed = parseRecognitionIr(json)
    expect(parsed).toEqual(window)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(validateRecognitionIr(parsed)).toEqual({ valid: true, errors: [] })
  })

  it('rejects invalid confidence, non-JSON debug data, and unsafe advances', () => {
    expect(() => createPitchCandidate({
      midi: 60,
      source: 'test',
      confidence: { overall: 1.2 },
    })).toThrow(/0\.\.1/)
    expect(() => createPitchCandidate({
      midi: 60,
      source: 'test',
      debug: { fn: () => true },
    })).toThrow(/JSON-compatible/)
    expect(() => createRecognitionDecision({
      checkpointId: 'checkpoint',
      windowId: 'window',
      timeMs: 10,
      outcome: RECOGNITION_OUTCOME.REJECTED,
      reason: 'wrong-tone',
      advance: true,
    })).toThrow(/Only an accepted/)
  })

  it('detects duplicate ids in a recognition graph', () => {
    const pitch = createPitchCandidate({ id: 'duplicate', midi: 60, source: 'test' })
    const frame = createMicFrame({
      id: 'duplicate',
      timeMs: 10,
      sampleRate: 44100,
      windowMs: 46,
      pitchCandidates: [pitch],
    })
    const validation = validateRecognitionIr(frame)
    expect(validation.valid).toBe(false)
    expect(validation.errors.join(' ')).toMatch(/conflicting duplicate recognition id/)
  })
})
