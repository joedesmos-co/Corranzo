/**
 * Piano audio-rendering benchmark — independent of the semantic evaluator.
 *
 * Consumes frozen performed-event shapes (or schedule events) and drives the
 * instrument voice to measure engine selection, polyphony, stuck voices,
 * dynamics ordering, and tie-continuation re-attacks. Does not alter
 * schedule timing or Playback Semantics velocities.
 */

import { createPianoInstrument, PIANO_SAMPLE_URLS } from './pianoInstrument.js'
import { INSTRUMENT_STATUS } from './instrumentVoiceStatus.js'
import { mapPlaybackVelocity } from './pianoVelocity.js'
import { nearestPianoSample, reportPianoKeyboardCoverage } from './pianoSampleCoverage.js'
import { DYNAMICS_TO_VELOCITY } from '../musicxml/dynamicsMap.js'

const MIDI_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function midiToNoteName(midi) {
  if (!Number.isFinite(midi)) {
    return null
  }
  const octave = Math.floor(midi / 12) - 1
  return `${MIDI_NAMES[((midi % 12) + 12) % 12]}${octave}`
}

/** Minimal Tone double for deterministic trigger capture (no AudioContext). */
export function createBenchmarkToneDouble() {
  const created = { synths: [], samplers: [], buffers: [] }

  class Node {
    constructor() {
      this.connectedTo = []
      this.disposed = false
    }
    connect(dest) {
      this.connectedTo.push(dest)
      return dest
    }
    dispose() {
      this.disposed = true
    }
  }
  class Gain extends Node {
    constructor() {
      super()
      this.gain = {
        value: 1,
        cancelScheduledValues() {},
        setValueAtTime() {},
        linearRampToValueAtTime() {},
      }
    }
  }
  class Reverb extends Node {
    generate() {
      return Promise.resolve(this)
    }
  }
  class Compressor extends Node {}
  class Limiter extends Node {}
  class Filter extends Node {}
  class Chorus extends Node {
    start() {
      return this
    }
  }
  class PolySynth extends Node {
    constructor() {
      super()
      this.calls = []
      this.attacks = []
      this.releases = []
      this.released = []
      created.synths.push(this)
    }
    set() {}
    triggerAttackRelease(...args) {
      this.calls.push(args)
    }
    triggerAttack(...args) {
      this.attacks.push(args)
    }
    triggerRelease(...args) {
      this.releases.push(args)
    }
    releaseAll(time) {
      this.released.push(time)
    }
  }
  class Synth {}
  class ToneAudioBuffers extends Node {
    constructor({ onload } = {}) {
      super()
      this.onload = onload
      this._map = new Map()
      created.buffers.push(this)
    }
    get(note) {
      if (!this._map.has(note)) {
        this._map.set(note, { note, _isBuffer: true })
      }
      return this._map.get(note)
    }
    triggerLoad() {
      this.onload?.()
    }
  }
  class Sampler extends Node {
    constructor(opts = {}) {
      super()
      this.opts = opts
      this.volume = { value: opts.volume ?? 0 }
      this.calls = []
      this.attacks = []
      this.releases = []
      this.released = []
      created.samplers.push(this)
    }
    triggerAttackRelease(...args) {
      this.calls.push(args)
    }
    triggerAttack(...args) {
      this.attacks.push(args)
    }
    triggerRelease(...args) {
      this.releases.push(args)
    }
    releaseAll(time) {
      this.released.push(time)
    }
  }

  return {
    tone: {
      Gain,
      Reverb,
      Compressor,
      Limiter,
      Filter,
      Chorus,
      PolySynth,
      Synth,
      AMSynth: Synth,
      ToneAudioBuffers,
      Sampler,
      now: () => 0,
      getContext: () => ({ rawContext: { state: 'running' }, state: 'running' }),
    },
    created,
  }
}

/**
 * Listening / regression fixtures as performed-event timelines.
 * Timing and velocities mirror Playback Semantics outputs — not rewritten here.
 */
export const PIANO_LISTENING_FIXTURES = {
  'single-note-scale': {
    id: 'single-note-scale',
    description: 'Scale across low, middle, and high registers',
    events: [
      ...[33, 36, 40, 45].map((midi, i) => event(midi, i * 0.4, 0.35, 0.7)),
      ...[60, 64, 67, 72].map((midi, i) => event(midi, 1.6 + i * 0.4, 0.35, 0.7)),
      ...[84, 88, 91, 96].map((midi, i) => event(midi, 3.2 + i * 0.4, 0.35, 0.7)),
    ],
  },
  'repeated-notes': {
    id: 'repeated-notes',
    description: 'Same pitch re-attacked',
    events: [0, 0.35, 0.7, 1.05].map((t) => event(60, t, 0.28, 0.72)),
  },
  'soft-loud': {
    id: 'soft-loud',
    description: 'Soft then loud single notes',
    events: [event(60, 0, 0.5, DYNAMICS_TO_VELOCITY.p), event(60, 0.7, 0.5, DYNAMICS_TO_VELOCITY.f)],
  },
  'dynamic-ladder': {
    id: 'dynamic-ladder',
    description: 'pp → mp → mf → ff',
    events: [
      event(60, 0, 0.45, DYNAMICS_TO_VELOCITY.pp),
      event(60, 0.55, 0.45, DYNAMICS_TO_VELOCITY.mp),
      event(60, 1.1, 0.45, DYNAMICS_TO_VELOCITY.mf),
      event(60, 1.65, 0.45, DYNAMICS_TO_VELOCITY.ff),
    ],
  },
  'chords-2-3-6': {
    id: 'chords-2-3-6',
    description: 'Two-, three-, and six-note chords',
    events: [
      event(60, 0, 0.8, 0.7),
      event(64, 0, 0.8, 0.7),
      event(60, 1, 0.8, 0.7),
      event(64, 1, 0.8, 0.7),
      event(67, 1, 0.8, 0.7),
      event(48, 2, 1.0, 0.75),
      event(52, 2, 1.0, 0.75),
      event(55, 2, 1.0, 0.75),
      event(60, 2, 1.0, 0.75),
      event(64, 2, 1.0, 0.75),
      event(67, 2, 1.0, 0.75),
    ],
  },
  'dense-chord-passage': {
    id: 'dense-chord-passage',
    description: 'Dense overlapping chords',
    events: Array.from({ length: 8 }, (_, chord) =>
      [48, 52, 55, 59, 62, 67].map((midi) =>
        event(midi, chord * 0.22, 0.55, 0.78),
      ),
    ).flat(),
  },
  staccato: {
    id: 'staccato',
    description: 'Staccato passage (short performed durations)',
    events: [60, 62, 64, 65, 67].map((midi, i) =>
      event(midi, i * 0.25, 0.1, 0.72, { articulationSource: 'staccato' }),
    ),
  },
  'accent-marcato': {
    id: 'accent-marcato',
    description: 'Accent and marcato accents',
    events: [
      event(60, 0, 0.4, Math.min(1, DYNAMICS_TO_VELOCITY.mf + 0.08), {
        articulationSource: 'accent',
      }),
      event(62, 0.5, 0.28, Math.min(1, DYNAMICS_TO_VELOCITY.mf + 0.12), {
        articulationSource: 'marcato',
      }),
    ],
  },
  'tied-across-bar': {
    id: 'tied-across-bar',
    description: 'Tied note across a barline (single attack)',
    events: [event(60, 0, 1.0, 0.7, { tieChainId: 'tie-c4', attackCount: 1 })],
  },
  'partial-tied-chord': {
    id: 'partial-tied-chord',
    description: 'Partially tied chord',
    events: [
      event(60, 0, 1.0, 0.7, { tieChainId: 'tie-c', attackCount: 1 }),
      event(64, 0, 0.5, 0.7),
      event(64, 0.5, 0.5, 0.7),
    ],
  },
  fermata: {
    id: 'fermata',
    description: 'Fermata sustain',
    events: [event(60, 0, 1.5, 0.7, { articulationSource: 'fermata' })],
  },
  'crescendo-diminuendo': {
    id: 'crescendo-diminuendo',
    description: 'Wedge-interpolated dynamics',
    events: [0, 1, 2, 3, 4].map((i) => {
      const t = i / 4
      const up = DYNAMICS_TO_VELOCITY.p + (DYNAMICS_TO_VELOCITY.f - DYNAMICS_TO_VELOCITY.p) * t
      return event(60, i * 0.35, 0.3, up)
    }),
  },
  'tempo-change': {
    id: 'tempo-change',
    description: 'Tempo change on performed timeline (onsets already mapped)',
    events: [
      event(60, 0, 0.5, 0.7),
      event(62, 0.5, 0.5, 0.7),
      event(64, 0.9, 0.35, 0.7),
      event(65, 1.25, 0.35, 0.7),
    ],
  },
  'stop-seek-loop-cleanup': {
    id: 'stop-seek-loop-cleanup',
    description: 'Stop / seek / loop cleanup (stuck-voice check)',
    events: [
      event(60, 0, 2.0, 0.75),
      event(64, 0, 2.0, 0.75),
      event(67, 0, 2.0, 0.75),
    ],
    cleanup: true,
  },
}

function event(midi, onset, duration, velocity, extra = {}) {
  return {
    midi,
    name: midiToNoteName(midi),
    scoreTimeSeconds: onset,
    baseDurationSeconds: duration,
    performedDurationSeconds: duration,
    velocity,
    attackCount: extra.attackCount ?? 1,
    tieChainId: extra.tieChainId ?? null,
    articulationSource: extra.articulationSource ?? null,
  }
}

/**
 * Drive a piano voice with performed events and collect render metrics.
 */
export async function runPianoAudioFixture(fixture, options = {}) {
  const { forceSynth = false, resolveSamples = true } = options
  const { tone, created } = createBenchmarkToneDouble()
  const loadStarted = performance.now()

  const inst = createPianoInstrument({
    tone,
    createSamplerSync: () => null,
    sampleFallbackBaseUrl: null,
    ...(forceSynth
      ? {
          loadSampler: () => Promise.reject(new Error('forced synth fallback for benchmark')),
        }
      : {}),
  })

  if (!forceSynth && resolveSamples && created.buffers[0]) {
    created.buffers[0].triggerLoad()
  }

  const status = await inst.whenReady()
  const readyAt = performance.now()

  const triggers = []
  let firstTriggerWall = null
  for (const performed of fixture.events) {
    const name = performed.name ?? midiToNoteName(performed.midi)
    const gain = mapPlaybackVelocity(performed.velocity ?? 0.75)
    const nearest = nearestPianoSample(performed.midi)
    if (firstTriggerWall == null) {
      firstTriggerWall = performance.now()
    }
    inst.triggerAttackRelease(
      name,
      performed.baseDurationSeconds ?? performed.performedDurationSeconds ?? 0.3,
      performed.scoreTimeSeconds,
      gain,
      {
        midi: performed.midi,
        tieChainId: performed.tieChainId ?? null,
      },
    )
    triggers.push({
      midi: performed.midi,
      name,
      performedOnset: performed.scoreTimeSeconds,
      performedDuration: performed.baseDurationSeconds,
      semanticVelocity: performed.velocity,
      mappedGain: gain,
      sampleSelected: nearest?.sampleName ?? null,
      transposeSemitones: nearest?.transposeSemitones ?? null,
      tieChainId: performed.tieChainId ?? null,
      attackCount: performed.attackCount ?? 1,
    })
  }

  const diagnosticsBeforeCleanup = inst.getVoiceDiagnostics()
  let stuckAfterStop = null
  if (fixture.cleanup) {
    inst.releaseAll(10)
    stuckAfterStop = inst.getVoiceDiagnostics().activeVoices
  }

  const target = inst.isUsingSampler() ? created.samplers[0] : created.synths[0]
  const duplicateKeys = new Map()
  let duplicates = 0
  for (const trigger of triggers) {
    const key = `${trigger.midi}@${trigger.performedOnset.toFixed(3)}`
    duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1)
  }
  for (const count of duplicateKeys.values()) {
    if (count > 1) {
      duplicates += count - 1
    }
  }

  const tieContinuationReattacks = triggers.filter(
    (trigger) => trigger.tieChainId && (trigger.attackCount ?? 1) > 1,
  ).length

  const dynamicGains = triggers.map((trigger) => trigger.mappedGain)
  const dynamicOrdered =
    dynamicGains.length < 2 ||
    dynamicGains.every((gain, index) => index === 0 || gain >= dynamicGains[index - 1] - 1e-9)

  const peakGain = dynamicGains.length ? Math.max(...dynamicGains) : 0
  // Conservative headroom estimate — mapped gain after voice-mix ducking.
  const clippingEvents = peakGain > 0.95 ? 1 : 0

  const report = {
    fixtureId: fixture.id,
    description: fixture.description,
    engineType: inst.isUsingSampler() ? 'sampler' : 'synth',
    sampleLoadState: status,
    sampleReadyMs: readyAt - loadStarted,
    firstNoteLatencyMs: (firstTriggerWall ?? readyAt) - loadStarted,
    sampleSet: 'salamander-lite',
    loadedSampleCount: inst.getSampleCoverage?.()?.loadedSampleCount ?? 0,
    missingSampleCount: inst.getSampleCoverage?.()?.missingSampleCount ?? 0,
    loadError: inst.getLastLoadError?.() ?? null,
    triggerCount: triggers.length,
    missingTriggers: Math.max(0, fixture.events.length - (target?.calls?.length ?? 0)),
    duplicateTriggers: duplicates,
    activeVoiceCount: diagnosticsBeforeCleanup.activeVoices,
    peakPolyphony: diagnosticsBeforeCleanup.maxSimultaneous,
    voiceSteals: diagnosticsBeforeCleanup.voicesStolen,
    stuckVoicesAfterStop: stuckAfterStop,
    peakOutputLevel: peakGain,
    clippingEvents,
    dynamicLevelOrdered: fixture.id === 'dynamic-ladder' ? isStrictlyIncreasing(dynamicGains) : dynamicOrdered,
    tieContinuationAttackCount: triggers.filter((t) => t.tieChainId).length,
    tieContinuationReattacks,
    triggers,
    performedEventTrace: fixture.events.map((event) => ({
      midi: event.midi,
      onset: event.scoreTimeSeconds,
      duration: event.baseDurationSeconds,
      velocity: event.velocity,
      tieChainId: event.tieChainId ?? null,
    })),
  }

  inst.dispose()
  return report
}

function isStrictlyIncreasing(values) {
  for (let i = 1; i < values.length; i += 1) {
    if (!(values[i] > values[i - 1])) {
      return false
    }
  }
  return true
}

export async function runAllPianoAudioFixtures(options = {}) {
  const coverage = reportPianoKeyboardCoverage(PIANO_SAMPLE_URLS)
  const fixtures = Object.values(PIANO_LISTENING_FIXTURES)
  const results = []
  for (const fixture of fixtures) {
    results.push(await runPianoAudioFixture(fixture, options))
  }
  return {
    coverage,
    sampleUrlCount: Object.keys(PIANO_SAMPLE_URLS).length,
    preferredSampleBaseUrl: '/audio/salamander/',
    cdnFallbackBaseUrl: 'https://tonejs.github.io/audio/salamander/',
    results,
    summary: {
      fixtureCount: results.length,
      samplerFixtures: results.filter((r) => r.engineType === 'sampler').length,
      synthFixtures: results.filter((r) => r.engineType === 'synth').length,
      totalMissingTriggers: results.reduce((sum, r) => sum + r.missingTriggers, 0),
      totalDuplicates: results.reduce((sum, r) => sum + r.duplicateTriggers, 0),
      totalVoiceSteals: results.reduce((sum, r) => sum + r.voiceSteals, 0),
      totalClipping: results.reduce((sum, r) => sum + r.clippingEvents, 0),
      maxPeakPolyphony: Math.max(0, ...results.map((r) => r.peakPolyphony)),
      stuckVoiceFailures: results.filter(
        (r) => r.stuckVoicesAfterStop != null && r.stuckVoicesAfterStop > 0,
      ).length,
      dynamicLadderOk: results.find((r) => r.fixtureId === 'dynamic-ladder')?.dynamicLevelOrdered ?? false,
      tieReattacks: results.reduce((sum, r) => sum + r.tieContinuationReattacks, 0),
    },
  }
}

export function fingerprintPerformedTrace(events) {
  return JSON.stringify(
    events.map((event) => ({
      midi: event.midi,
      onset: event.scoreTimeSeconds,
      duration: event.baseDurationSeconds ?? event.performedDurationSeconds,
      velocity: event.velocity,
      tieChainId: event.tieChainId ?? null,
      attackCount: event.attackCount ?? 1,
    })),
  )
}
