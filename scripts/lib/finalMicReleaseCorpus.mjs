import { createMicFrameAnalyzer } from '../../src/features/microphone-input/micFrameAnalysis.js'
import {
  createMicEngineV2RuntimeState,
  processMicEngineV2Tick,
  resetMicEngineV2RuntimeState,
} from '../../src/features/microphone-input/v2/micEngineV2Live.js'
import { getMicInstrumentProfile } from '../../src/features/microphone-input/micInstrumentProfiles.js'
import { midiToFrequency } from '../../src/features/microphone-input/micSyntheticClips.js'
import {
  canAcceptMicAttackMatch,
  createMicAttackLatchState,
  getMicAttackRearmReason,
  markMicAttackConsumed,
  rearmMicAttackLatch,
  updateMicAttackRelease,
} from '../../src/features/practice/micAttackLatch.js'
import {
  confirmConfidentMatch,
  createMatchConfirmState,
  frameConfidentForMatch,
  frameCorroboratesSingleNote,
  resetMatchConfirmState,
} from '../../src/features/practice/micMatchConfirm.js'
import { isMusicalMicFrame } from '../../src/features/practice/micMusicalAcceptance.js'
import {
  evaluateMicScoreInformedInput,
  MATCH_OUTCOME,
} from '../../src/features/practice/waitForYouNoteMatch.js'
import { normalizeMatchSettings } from '../../src/features/practice/waitForYouMatchSettings.js'

export const FINAL_MIC_SAMPLE_RATE = 44100
export const FINAL_MIC_FFT_SIZE = 2048
export const FINAL_MIC_HOP_SAMPLES = Math.round(FINAL_MIC_SAMPLE_RATE / 60)
export const FINAL_MIC_HOP_MS = (FINAL_MIC_HOP_SAMPLES / FINAL_MIC_SAMPLE_RATE) * 1000

const DEFAULT_HARMONICS = [1, 0.62, 0.36, 0.2, 0.12, 0.07]
const WEAK_FUNDAMENTAL_HARMONICS = [0.12, 1, 0.46, 0.24, 0.13, 0.08]
const BRIGHT_HARMONICS = [0.55, 1, 0.6, 0.34, 0.2, 0.12]

function seededNoise(seed = 1) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0xffffffff
  }
}

function addPianoEvent(buffer, event, sampleRate) {
  const {
    onsetSec,
    midi,
    amplitude = 0.24,
    decay = 0.75,
    durationSec = buffer.length / sampleRate - onsetSec,
    attackNoise = 0.035,
    harmonics = DEFAULT_HARMONICS,
    phase = 0,
  } = event
  const start = Math.max(0, Math.floor(onsetSec * sampleRate))
  const count = Math.min(buffer.length - start, Math.floor(durationSec * sampleRate))
  const f0 = midiToFrequency(midi)
  const harmonicTotal = harmonics.reduce((sum, value) => sum + Math.abs(value), 0) || 1
  const noise = seededNoise(1009 + Math.round(onsetSec * 1000) + midi * 17)

  for (let index = 0; index < count; index += 1) {
    const t = index / sampleRate
    const attack = 1 - Math.exp(-t * 190)
    const envelope = attack * Math.exp(-decay * t)
    let tonal = 0
    for (let harmonic = 0; harmonic < harmonics.length; harmonic += 1) {
      const multiple = harmonic + 1
      const inharmonic = 1 + 0.00009 * multiple * multiple
      tonal +=
        Math.sin(2 * Math.PI * f0 * multiple * inharmonic * t + phase * multiple) *
        harmonics[harmonic]
    }
    const hammer =
      (noise() * 2 - 1) *
      attackNoise *
      Math.exp(-t * 72) *
      (0.65 + 0.35 * Math.sin(2 * Math.PI * 1350 * t))
    buffer[start + index] += amplitude * ((tonal / harmonicTotal) * envelope + hammer)
  }
}

function applyGainDip(buffer, sampleRate, dip) {
  if (!dip) return
  const start = Math.floor(dip.startSec * sampleRate)
  const end = Math.min(buffer.length, Math.floor(dip.endSec * sampleRate))
  for (let index = start; index < end; index += 1) {
    const progress = (index - start) / Math.max(1, end - start - 1)
    const edge = Math.sin(Math.PI * progress)
    const gain = 1 - edge * (1 - (dip.floorGain ?? 0.3))
    buffer[index] *= gain
  }
}

function applyCompression(buffer, amount = 0) {
  if (!(amount > 0)) return
  const normalizer = Math.tanh(amount)
  for (let index = 0; index < buffer.length; index += 1) {
    buffer[index] = Math.tanh(buffer[index] * amount) / normalizer
  }
}

function addRoomAndHum(buffer, { roomNoise = 0.0025, humAmplitude = 0, seed = 71 } = {}) {
  const noise = seededNoise(seed)
  for (let index = 0; index < buffer.length; index += 1) {
    const t = index / FINAL_MIC_SAMPLE_RATE
    const hum =
      humAmplitude *
      (Math.sin(2 * Math.PI * 60 * t) + 0.32 * Math.sin(2 * Math.PI * 120 * t))
    buffer[index] += (noise() * 2 - 1) * roomNoise + hum
  }
}

function scaleDefinition(definition, variant) {
  const tempoScale = variant.tempoScale ?? 1
  const amplitudeScale = variant.amplitudeScale ?? 1
  return {
    ...definition,
    durationSec: definition.durationSec * tempoScale,
    events: definition.events.map((event) => ({
      ...event,
      onsetSec: event.onsetSec * tempoScale,
      durationSec: event.durationSec == null ? undefined : event.durationSec * tempoScale,
      amplitude: (event.amplitude ?? 0.24) * amplitudeScale,
      attackNoise: (event.attackNoise ?? 0.035) * amplitudeScale,
    })),
    dips: (definition.dips ?? []).map((dip) => ({
      ...dip,
      startSec: dip.startSec * tempoScale,
      endSec: dip.endSec * tempoScale,
    })),
  }
}

export function renderFinalMicFixture(definition, variant) {
  const scaled = scaleDefinition(definition, variant)
  const buffer = new Float32Array(Math.ceil(scaled.durationSec * FINAL_MIC_SAMPLE_RATE))
  for (const event of scaled.events) {
    addPianoEvent(buffer, event, FINAL_MIC_SAMPLE_RATE)
  }
  for (const dip of scaled.dips ?? []) {
    applyGainDip(buffer, FINAL_MIC_SAMPLE_RATE, dip)
  }
  addRoomAndHum(buffer, {
    roomNoise: (scaled.roomNoise ?? 0.0025) * (variant.noiseScale ?? 1),
    humAmplitude: scaled.humAmplitude ?? 0,
    seed: scaled.seed ?? 71,
  })
  applyCompression(buffer, scaled.compression ?? 0)
  return { samples: buffer, scaled }
}

function event(onsetSec, midi, options = {}) {
  return { onsetSec, midi, ...options }
}

export const FINAL_MIC_FIXTURES = [
  {
    id: '01-same-low-clear-release',
    title: 'Same low note twice with a clear release',
    durationSec: 2.15,
    events: [event(0.25, 36, { durationSec: 0.48 }), event(1.18, 36, { durationSec: 0.65 })],
    scoreMidis: [36, 36], expectedAdvanceCount: 2,
  },
  {
    id: '02-same-low-short-dip',
    title: 'Same low note twice with only a short amplitude dip',
    durationSec: 1.9,
    events: [event(0.22, 36, { durationSec: 1.5, decay: 0.62 }), event(0.9, 36, { amplitude: 0.16, durationSec: 0.8 })],
    dips: [{ startSec: 0.81, endSec: 0.89, floorGain: 0.3 }],
    scoreMidis: [36, 36], expectedAdvanceCount: 2,
  },
  {
    id: '03-same-low-over-decay',
    title: 'Same low note twice while the first is still decaying',
    durationSec: 1.9,
    events: [event(0.22, 36, { amplitude: 0.3, decay: 0.52 }), event(0.88, 36, { amplitude: 0.095, attackNoise: 0.09, decay: 0.7 })],
    scoreMidis: [36, 36], expectedAdvanceCount: 2,
  },
  {
    id: '04-neighboring-low-notes',
    title: 'Two neighboring low notes',
    durationSec: 1.9,
    events: [event(0.22, 36, { decay: 0.55 }), event(0.9, 37, { amplitude: 0.19, attackNoise: 0.07 })],
    scoreMidis: [36, 37], expectedAdvanceCount: 2,
  },
  {
    id: '05-low-then-octave',
    title: 'Low note followed by its octave',
    durationSec: 1.9,
    events: [event(0.22, 36, { decay: 0.55 }), event(0.95, 48, { amplitude: 0.2 })],
    scoreMidis: [36, 48], expectedAdvanceCount: 2,
  },
  {
    id: '06-low-then-middle',
    title: 'Low note followed by a middle-register note',
    durationSec: 1.8,
    events: [event(0.2, 36, { decay: 0.65 }), event(0.88, 60, { amplitude: 0.2 })],
    scoreMidis: [36, 60], expectedAdvanceCount: 2,
  },
  {
    id: '07-middle-then-low',
    title: 'Middle-register note followed by a low note',
    durationSec: 1.8,
    events: [event(0.2, 60, { decay: 0.85 }), event(0.88, 36, { amplitude: 0.2 })],
    scoreMidis: [60, 36], expectedAdvanceCount: 2,
  },
  {
    id: '08-staccato-repeated-low',
    title: 'Staccato repeated low notes',
    durationSec: 1.8,
    events: [0.2, 0.68, 1.16].map((onset) => event(onset, 36, { durationSec: 0.2, decay: 2.2 })),
    scoreMidis: [36, 36, 36], expectedAdvanceCount: 3,
  },
  {
    id: '09-slow-repeated-low',
    title: 'Slow repeated low notes',
    durationSec: 2.5,
    events: [event(0.22, 36, { durationSec: 0.75 }), event(1.58, 36, { durationSec: 0.65 })],
    scoreMidis: [36, 36], expectedAdvanceCount: 2,
  },
  {
    id: '10-fast-repeated-low',
    title: 'Faster repeated low notes',
    durationSec: 1.8,
    events: [0.2, 0.55, 0.9, 1.25].map((onset, index) => event(onset, 36, { amplitude: index ? 0.13 : 0.25, decay: 0.5, attackNoise: 0.075 })),
    compression: 2.6,
    scoreMidis: [36, 36, 36, 36], expectedAdvanceCount: 4,
  },
  {
    id: '11-weak-fundamental-strong-h2',
    title: 'Low note with weak fundamental and strong second harmonic',
    durationSec: 1.25,
    events: [event(0.22, 36, { harmonics: WEAK_FUNDAMENTAL_HARMONICS, amplitude: 0.24 })],
    scoreMidis: [36], expectedAdvanceCount: 1,
  },
  {
    id: '12-low-with-hum-noise',
    title: 'Low note with room noise and hum contamination',
    durationSec: 1.35,
    events: [event(0.26, 36, { amplitude: 0.22 })],
    roomNoise: 0.012, humAmplitude: 0.018,
    scoreMidis: [36], expectedAdvanceCount: 1,
  },
  {
    id: '13-quiet-low-note',
    title: 'Quiet low note',
    durationSec: 1.35,
    events: [event(0.24, 36, { amplitude: 0.055, attackNoise: 0.018 })],
    roomNoise: 0.002,
    scoreMidis: [36], expectedAdvanceCount: 1,
  },
  {
    id: '14-loud-low-compressed-clipped',
    title: 'Loud low note with microphone compression or clipping',
    durationSec: 1.35,
    events: [event(0.22, 36, { amplitude: 0.75, harmonics: BRIGHT_HARMONICS })],
    compression: 5.5,
    scoreMidis: [36], expectedAdvanceCount: 1,
  },
  {
    id: '15-single-sustained-low',
    title: 'Single sustained low note triggers exactly once',
    durationSec: 2.4,
    events: [event(0.2, 36, { amplitude: 0.3, decay: 0.12 })],
    scoreMidis: [36, 36, 36], expectedAdvanceCount: 1,
  },
  {
    id: '16-low-trill',
    title: 'Alternating pair of low notes',
    durationSec: 2.0,
    events: [36, 38, 36, 38].map((midi, index) => event(0.2 + index * 0.42, midi, { amplitude: index ? 0.17 : 0.24, decay: 0.65, attackNoise: 0.07 })),
    scoreMidis: [36, 38, 36, 38], expectedAdvanceCount: 4,
  },
  {
    id: '17-low-chord-specific-tone',
    title: 'Low chord while score-follow expects one specific tone',
    durationSec: 1.4,
    events: [event(0.24, 36, { amplitude: 0.22 }), event(0.24, 43, { amplitude: 0.17, phase: 0.4 })],
    scoreMidis: [36], expectedAdvanceCount: 1,
  },
  {
    id: '18-wrong-octave-harmonic',
    title: 'Wrong low note whose fundamental resembles an expected harmonic',
    durationSec: 1.4,
    events: [event(0.24, 48, { amplitude: 0.24, harmonics: BRIGHT_HARMONICS })],
    scoreMidis: [36], expectedAdvanceCount: 0,
  },
  {
    id: '19-silence-between-repeats',
    title: 'Silence between repeated low notes',
    durationSec: 1.8,
    events: [event(0.2, 36, { durationSec: 0.42 }), event(1.04, 36, { durationSec: 0.55 })],
    scoreMidis: [36, 36], expectedAdvanceCount: 2,
  },
  {
    id: '20-no-silence-clear-attack',
    title: 'No silence but a clear new attack transient',
    durationSec: 1.9,
    events: [event(0.2, 36, { amplitude: 0.3, decay: 0.42 }), event(0.86, 36, { amplitude: 0.1, attackNoise: 0.14, decay: 0.7 })],
    compression: 2.2,
    scoreMidis: [36, 36], expectedAdvanceCount: 2,
  },
]

export const FINAL_MIC_VARIANTS = [
  { id: 'nominal', tempoScale: 1, amplitudeScale: 1, noiseScale: 1 },
  { id: 'quiet-fast', tempoScale: 0.86, amplitudeScale: 0.72, noiseScale: 1.15 },
]

function strongestHarmonic(note, expectedMidi) {
  const magnitudes = note?.harmonicMagnitudes ?? []
  let strongestIndex = -1
  for (let index = 0; index < magnitudes.length; index += 1) {
    if (strongestIndex < 0 || magnitudes[index] > magnitudes[strongestIndex]) {
      strongestIndex = index
    }
  }
  if (strongestIndex < 0) return null
  const multiple = strongestIndex + 1
  return {
    multiple,
    frequencyHz: midiToFrequency(expectedMidi) * multiple,
    magnitude: magnitudes[strongestIndex],
  }
}

function round(value, digits = 5) {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function matchLatencies(expectedEvents, matchedEvents, expectedAdvanceCount) {
  const latencies = []
  for (let index = 0; index < Math.min(expectedAdvanceCount, matchedEvents.length); index += 1) {
    const onset = expectedEvents[index]?.onsetMs
    if (Number.isFinite(onset)) {
      latencies.push(round(matchedEvents[index].timeMs - onset, 2))
    }
  }
  return latencies
}

export function replayFinalMicFixture(definition, variant) {
  const { samples, scaled } = renderFinalMicFixture(definition, variant)
  const analyzer = createMicFrameAnalyzer()
  const profile = getMicInstrumentProfile('piano')
  const settings = normalizeMatchSettings({})
  const detectorState = createMicEngineV2RuntimeState()
  const confirmState = createMatchConfirmState()
  const latch = createMicAttackLatchState()
  const frames = []
  const matchedScoreEvents = []
  const releaseRearmEvents = []
  let checkpointIndex = 0

  for (let end = FINAL_MIC_FFT_SIZE; end <= samples.length; end += FINAL_MIC_HOP_SAMPLES) {
    const timeMs = (end / FINAL_MIC_SAMPLE_RATE) * 1000
    const expectedMidi = definition.scoreMidis[Math.min(checkpointIndex, definition.scoreMidis.length - 1)]
    const tick = processMicEngineV2Tick({
      buffer: new Float32Array(samples.subarray(end - FINAL_MIC_FFT_SIZE, end)),
      sampleRate: FINAL_MIC_SAMPLE_RATE,
      expectedMidis: expectedMidi == null ? [] : [expectedMidi],
      noiseFloor: analyzer.noiseFloor,
      state: detectorState,
      centsTolerance: settings.micCentsTolerance,
      gateOptions: profile.gate,
      timeMs,
      stableFrameThreshold: settings.micChordStableHitsRequired,
    })
    const frame = tick.frame
    if (!frame) continue

    const wasAwaitingRelease = latch.awaitingRelease
    updateMicAttackRelease(latch, Boolean(frame.gateOpen), {
      rms: frame.filteredRms ?? frame.rms ?? null,
      spectralEnergy: frame.spectralEnergy ?? null,
    })
    if (wasAwaitingRelease && !latch.awaitingRelease) {
      releaseRearmEvents.push({ timeMs: round(timeMs, 2), type: 'release' })
    }

    let attackRearmReason = null
    let advanced = false
    let rejectReason = null
    let matchOutcome = null

    if (checkpointIndex < definition.scoreMidis.length && definition.expectedAdvanceCount > 0) {
      if (!canAcceptMicAttackMatch(latch)) {
        attackRearmReason = getMicAttackRearmReason(latch, frame, {
          expectedMidis: [expectedMidi],
        })
        if (attackRearmReason) {
          releaseRearmEvents.push({
            timeMs: round(timeMs, 2),
            type: 'attack',
            reason: attackRearmReason,
          })
          rearmMicAttackLatch(latch)
        }
      }

      if (!canAcceptMicAttackMatch(latch)) {
        rejectReason = 'awaiting-release'
        resetMatchConfirmState(confirmState)
      } else if (!frame.gateOpen || !frame.v2DetectedMidis?.length) {
        rejectReason = !frame.gateOpen ? 'gate-closed' : 'no-score-informed-candidate'
        resetMatchConfirmState(confirmState)
      } else {
        const preview = evaluateMicScoreInformedInput(
          { id: `fixture-${definition.id}-cp-${checkpointIndex}`, expectedMidi },
          frame.v2DetectedMidis,
          settings,
        )
        matchOutcome = preview.outcome
        const confident = frameConfidentForMatch(frame) && isMusicalMicFrame(frame)
        const corroborated = frameCorroboratesSingleNote(frame, expectedMidi, {
          centsTolerance: settings.micCentsTolerance,
        })
        if (preview.outcome !== MATCH_OUTCOME.COMPLETE) {
          rejectReason = 'score-mismatch'
          resetMatchConfirmState(confirmState)
        } else if (!confident) {
          rejectReason = 'confidence-or-musical-gate'
          resetMatchConfirmState(confirmState)
        } else if (!corroborated) {
          rejectReason = 'pitch-corroboration'
          resetMatchConfirmState(confirmState)
        } else if (
          confirmConfidentMatch(
            confirmState,
            `fixture-${definition.id}-cp-${checkpointIndex}:v2:${frame.v2DetectedMidis.join(',')}`,
            true,
            { pitchCents: frame.midiFloat != null ? frame.midiFloat * 100 : null },
          )
        ) {
          resetMatchConfirmState(confirmState)
          markMicAttackConsumed(latch, { consumedMidis: [expectedMidi] })
          matchedScoreEvents.push({
            checkpointIndex,
            expectedMidi,
            detectedMidis: [...frame.v2DetectedMidis],
            timeMs: round(timeMs, 2),
          })
          checkpointIndex += 1
          resetMicEngineV2RuntimeState(detectorState)
          advanced = true
        }
      }
    } else if (definition.expectedAdvanceCount === 0 && definition.scoreMidis.length) {
      const preview = frame.v2DetectedMidis?.length
        ? evaluateMicScoreInformedInput(
            { id: `fixture-${definition.id}-negative`, expectedMidi },
            frame.v2DetectedMidis,
            settings,
          )
        : null
      matchOutcome = preview?.outcome ?? null
      const confident = preview?.outcome === MATCH_OUTCOME.COMPLETE &&
        frameConfidentForMatch(frame) &&
        isMusicalMicFrame(frame) &&
        frameCorroboratesSingleNote(frame, expectedMidi, {
          centsTolerance: settings.micCentsTolerance,
        })
      if (
        confirmConfidentMatch(
          confirmState,
          `fixture-${definition.id}-negative:${frame.v2DetectedMidis?.join(',') ?? ''}`,
          Boolean(confident),
          { pitchCents: frame.midiFloat != null ? frame.midiFloat * 100 : null },
        )
      ) {
        matchedScoreEvents.push({
          checkpointIndex: 0,
          expectedMidi,
          detectedMidis: [...(frame.v2DetectedMidis ?? [])],
          timeMs: round(timeMs, 2),
        })
        advanced = true
        resetMatchConfirmState(confirmState)
      }
    }

    const note = frame.v2Notes?.find((entry) => entry.midi === expectedMidi) ?? null
    frames.push({
      timeMs: round(timeMs, 2),
      checkpointIndex,
      expectedMidi,
      detectedPitchCandidates: [...(frame.v2DetectedMidis ?? [])],
      autocorrelationMidi: round(frame.midiFloat, 4),
      detectedFundamentalHz: round(frame.frequency, 3),
      scoreFundamentalMagnitude: round(note?.fundamentalEnergy, 7),
      strongestHarmonic: strongestHarmonic(note, expectedMidi),
      confidence: round(note?.confidence ?? frame.clarity, 5),
      ratio: round(note?.ratio, 5),
      harmonicSupport: round(note?.harmonicSupport, 5),
      rms: round(frame.rms, 6),
      filteredRms: round(frame.filteredRms, 6),
      noiseFloor: round(frame.noiseFloor, 6),
      gateOpen: Boolean(frame.gateOpen),
      spectralEnergy: round(frame.spectralEnergy, 6),
      crestFactor: round(frame.crestFactor, 4),
      signalShape: frame.signalShape,
      attackRearmReason,
      matchOutcome,
      rejectReason,
      advanced,
    })
  }

  const expectedNoteOnEvents = scaled.events.map((played, index) => ({
    index,
    midi: played.midi,
    onsetMs: round(played.onsetSec * 1000, 2),
    amplitude: round(played.amplitude, 4),
  }))
  const falseNegatives = Math.max(0, definition.expectedAdvanceCount - matchedScoreEvents.length)
  const falsePositives = Math.max(0, matchedScoreEvents.length - definition.expectedAdvanceCount)
  const latenciesMs = matchLatencies(
    expectedNoteOnEvents,
    matchedScoreEvents,
    definition.expectedAdvanceCount,
  )

  return {
    id: `${definition.id}--${variant.id}`,
    fixtureId: definition.id,
    variant: { ...variant },
    title: definition.title,
    sampleRate: FINAL_MIC_SAMPLE_RATE,
    frameSize: FINAL_MIC_FFT_SIZE,
    hopSamples: FINAL_MIC_HOP_SAMPLES,
    hopMs: round(FINAL_MIC_HOP_MS, 4),
    scoreExpectedMidis: [...definition.scoreMidis],
    expectedAdvanceCount: definition.expectedAdvanceCount,
    expectedNoteOnEvents,
    matchedScoreEvents,
    releaseRearmEvents,
    falsePositives,
    falseNegatives,
    latenciesMs,
    medianLatencyMs: latenciesMs.length
      ? [...latenciesMs].sort((a, b) => a - b)[Math.floor(latenciesMs.length / 2)]
      : null,
    frames,
  }
}

export function runFinalMicCorpus() {
  const fixtures = []
  for (const definition of FINAL_MIC_FIXTURES) {
    for (const variant of FINAL_MIC_VARIANTS) {
      fixtures.push(replayFinalMicFixture(definition, variant))
    }
  }
  const latencies = fixtures.flatMap((fixture) => fixture.latenciesMs)
  const sortedLatencies = [...latencies].sort((a, b) => a - b)
  return {
    corpusVersion: 1,
    generatedAt: new Date().toISOString(),
    configuration: {
      sampleRate: FINAL_MIC_SAMPLE_RATE,
      frameSize: FINAL_MIC_FFT_SIZE,
      hopSamples: FINAL_MIC_HOP_SAMPLES,
      hopMs: round(FINAL_MIC_HOP_MS, 4),
      fixtureCount: FINAL_MIC_FIXTURES.length,
      variantCount: FINAL_MIC_VARIANTS.length,
      runCount: fixtures.length,
    },
    summary: {
      expectedAdvances: fixtures.reduce((sum, fixture) => sum + fixture.expectedAdvanceCount, 0),
      matchedAdvances: fixtures.reduce((sum, fixture) => sum + fixture.matchedScoreEvents.length, 0),
      falseNegatives: fixtures.reduce((sum, fixture) => sum + fixture.falseNegatives, 0),
      falsePositives: fixtures.reduce((sum, fixture) => sum + fixture.falsePositives, 0),
      medianLatencyMs: sortedLatencies.length
        ? sortedLatencies[Math.floor(sortedLatencies.length / 2)]
        : null,
      maxLatencyMs: sortedLatencies.length ? sortedLatencies.at(-1) : null,
      passingRuns: fixtures.filter(
        (fixture) => fixture.falseNegatives === 0 && fixture.falsePositives === 0,
      ).length,
    },
    fixtures,
  }
}

export function summarizeFinalMicCorpusMarkdown(corpus, { label = 'Baseline' } = {}) {
  const failures = corpus.fixtures.filter(
    (fixture) => fixture.falseNegatives > 0 || fixture.falsePositives > 0,
  )
  const rows = corpus.fixtures.map((fixture) =>
    `| ${fixture.id} | ${fixture.expectedAdvanceCount} | ${fixture.matchedScoreEvents.length} | ${fixture.falseNegatives} | ${fixture.falsePositives} | ${fixture.medianLatencyMs ?? 'n/a'} | ${fixture.releaseRearmEvents.map((entry) => entry.reason ?? entry.type).join(', ') || 'none'} |`,
  )
  return `# Phase 2 — deterministic low-note microphone ${label.toLowerCase()}\n\n` +
    `Corpus version: ${corpus.corpusVersion}. Signal path: production V2 score-informed detector → musical/confidence gates → attack latch → exact score matcher → checkpoint advance. Generated piano-like signals are deterministic and contain no user or copyrighted recordings.\n\n` +
    `## Configuration\n\n` +
    `- Sample rate: ${corpus.configuration.sampleRate} Hz\n` +
    `- Frame/window: ${corpus.configuration.frameSize} samples (${round(corpus.configuration.frameSize / corpus.configuration.sampleRate * 1000, 2)} ms)\n` +
    `- Hop: ${corpus.configuration.hopSamples} samples (${corpus.configuration.hopMs} ms)\n` +
    `- Base fixtures: ${corpus.configuration.fixtureCount}; amplitude/tempo variants: ${corpus.configuration.variantCount}; total runs: ${corpus.configuration.runCount}\n\n` +
    `## ${label} results\n\n` +
    `- Expected score advances: ${corpus.summary.expectedAdvances}\n` +
    `- Matched advances: ${corpus.summary.matchedAdvances}\n` +
    `- False negatives: ${corpus.summary.falseNegatives}\n` +
    `- False positives: ${corpus.summary.falsePositives}\n` +
    `- Passing runs: ${corpus.summary.passingRuns}/${corpus.configuration.runCount}\n` +
    `- Median recognition latency: ${corpus.summary.medianLatencyMs ?? 'n/a'} ms\n` +
    `- Maximum measured latency: ${corpus.summary.maxLatencyMs ?? 'n/a'} ms\n\n` +
    `| Run | Expected | Matched | FN | FP | Median latency ms | Release/re-arm |\n| --- | ---: | ---: | ---: | ---: | ---: | --- |\n` +
    `${rows.join('\n')}\n\n` +
    `## First divergence in failing runs\n\n` +
    (failures.length
      ? failures.map((fixture) => {
          const blocked = fixture.frames.find((frame) => frame.rejectReason === 'awaiting-release')
          const noCandidate = fixture.frames.find((frame) => frame.rejectReason === 'no-score-informed-candidate')
          const corroboration = fixture.frames.find((frame) => frame.rejectReason === 'pitch-corroboration')
          const first = blocked ?? noCandidate ?? corroboration ?? fixture.frames.find((frame) => frame.rejectReason)
          return `- ${fixture.id}: ${first?.rejectReason ?? 'unexpected score match'}, first observed at ${first?.timeMs ?? 'n/a'} ms; detected candidates ${JSON.stringify(first?.detectedPitchCandidates ?? [])}; gate ${first?.gateOpen ?? 'n/a'}; confidence ${first?.confidence ?? 'n/a'}; RMS ${first?.filteredRms ?? 'n/a'}.`
        }).join('\n')
      : '- None.') +
    `\n\nThe JSON artifact contains every expected note-on, per-frame pitch candidates, autocorrelation fundamental, strongest expected-note harmonic, confidence, RMS/gate state, attack/release timestamp, matched score event, false positive/negative count, and recognition latency.\n`
}
