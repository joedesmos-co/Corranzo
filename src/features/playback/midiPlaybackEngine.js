import * as Tone from 'tone'
import { awaitToneStarted } from '../audio/toneAudioUnlock.js'
import { parseMidiFile } from './parseMidiFile.js'
import { INSTRUMENT_STATUS } from './pianoInstrumentStatus.js'
import { alignChordScoreTime } from './pianoVoiceMix.js'
import { mapPlaybackVelocity } from './pianoVelocity.js'
import { createInstrumentVoiceResolver } from './instrumentVoiceResolver.js'
import { DEFAULT_INSTRUMENT_ID } from '../instruments/instruments.js'

const loadPianoInstrumentModule = () => import('./pianoInstrument.js')
const PLAY_READY_TIMEOUT_MS = 5000

function resolvePlaybackDuration(midi, parsedDuration) {
  if (parsedDuration > 0) {
    return parsedDuration
  }

  let endTime = 0
  for (const track of midi.tracks) {
    for (const note of track.notes) {
      endTime = Math.max(endTime, note.time + note.duration)
    }
  }
  return endTime
}

function softenVelocity(velocity) {
  return mapPlaybackVelocity(velocity)
}

function normalizeNoteEvents(trackNotes) {
  return trackNotes.map((note) => ({
    time: note.time,
    name: note.name,
    duration: Math.max(note.duration, 0.03),
    velocity: softenVelocity(note.velocity),
  }))
}

export class MidiPlaybackEngine {
  constructor({ loadPianoInstrument = loadPianoInstrumentModule } = {}) {
    this.midi = null
    this.trackStates = []
    this.onTimeUpdate = null
    this.progressFrameId = null
    this.loadToken = 0
    this.offsetSeconds = 0
    this.playing = false
    this.playStartedAt = 0
    this.onInstrumentStatus = null
    this.instrumentStatus = null
    this.loadPianoInstrument = loadPianoInstrument
    // Voice factories are resolved per instrument through the shared resolver;
    // the piano slot honours the legacy `loadPianoInstrument` test seam above.
    this.voiceResolver = createInstrumentVoiceResolver({
      legacyPianoModuleLoader: () => this.loadPianoInstrument(),
    })
    this.instrumentLoadPromise = null
    this.testToneTimerId = null
    this.testToneInstrument = null
  }

  /** Instrument used for all tracks (default piano). */
  get instrumentId() {
    return this.voiceResolver.instrumentId
  }

  /** Legacy test seam — injects the piano voice factory directly. */
  get createPianoInstrument() {
    return this.voiceResolver.getFactory(DEFAULT_INSTRUMENT_ID)
  }

  set createPianoInstrument(factory) {
    this.voiceResolver.setFactory(DEFAULT_INSTRUMENT_ID, factory)
  }

  /** Switch instrument; existing track voices rebuild on next play. */
  setInstrumentId(instrumentId) {
    const changed = this.voiceResolver.setInstrumentId(instrumentId)
    if (changed) {
      for (const track of this.trackStates) {
        track.instrument?.dispose()
        track.instrument = null
      }
      this.recomputeInstrumentStatus()
    }
    return changed
  }

  // Aggregate per-track status without claiming a fallback before playback has
  // actually created an instrument or attempted to load samples.
  recomputeInstrumentStatus() {
    const statuses = this.trackStates
      .map((track) => track.instrument?.status)
      .filter(Boolean)
    let next = null
    if (statuses.length > 0) {
      if (statuses.includes(INSTRUMENT_STATUS.LOADING)) {
        next = INSTRUMENT_STATUS.LOADING
      } else if (statuses.includes(INSTRUMENT_STATUS.SAMPLED)) {
        next = INSTRUMENT_STATUS.SAMPLED
      } else {
        next = INSTRUMENT_STATUS.SYNTH
      }
    }
    if (next !== this.instrumentStatus) {
      this.instrumentStatus = next
      if (this.onInstrumentStatus) {
        this.onInstrumentStatus(next)
      }
    }
  }

  getInstrumentStatus() {
    return this.instrumentStatus
  }

  async load(arrayBuffer) {
    const loadToken = ++this.loadToken
    this.stopPlaybackInternal()

    const { midi, duration: parsedDuration, tracks } = await parseMidiFile(arrayBuffer)
    if (loadToken !== this.loadToken) {
      return null
    }

    const duration = resolvePlaybackDuration(midi, parsedDuration)
    this.midi = midi
    this.playbackDuration = duration
    this.offsetSeconds = 0
    this.playing = false

    this.trackStates = midi.tracks.map((track, index) => {
      const output = new Tone.Gain(1)

      return {
        id: index,
        name: tracks[index].name,
        noteCount: tracks[index].noteCount,
        muted: false,
        notes: normalizeNoteEvents(track.notes),
        instrument: null,
        output,
        outputToDestination: false,
      }
    })
    this.recomputeInstrumentStatus()

    return {
      duration,
      tracks: tracks.map(({ id, name, noteCount, muted }) => ({
        id,
        name,
        noteCount,
        muted,
      })),
    }
  }

  /**
   * Fetch/decode the current instrument's samples ahead of Play without wiring
   * per-track instruments.
   */
  async preload() {
    try {
      await this.voiceResolver.preload(Tone)
    } catch {
      // Non-fatal — playFromUserGesture will retry instrument creation.
    }
  }

  /** Resolve once track instruments are sampled (or fell back), capped by timeout. */
  whenInstrumentReady(timeoutMs = PLAY_READY_TIMEOUT_MS) {
    const readyPromises = this.trackStates
      .map((track) => track.instrument?.whenReady?.())
      .filter(Boolean)
    if (!readyPromises.length) {
      return Promise.resolve(null)
    }
    const ready = Promise.all(readyPromises)
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return ready
    }
    let timeoutId = null
    return Promise.race([
      ready,
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve('timeout'), timeoutMs)
      }),
    ]).finally(() => {
      if (timeoutId != null) {
        clearTimeout(timeoutId)
      }
    })
  }

  scheduleNotesFrom(fromSeconds) {
    const now = Tone.now()
    const scheduled = new Set()

    for (const track of this.trackStates) {
      for (const note of track.notes) {
        const alignedStart = alignChordScoreTime(note.time)
        const noteEnd = alignedStart + note.duration
        if (noteEnd <= fromSeconds) {
          continue
        }

        const noteOn = Math.max(alignedStart, fromSeconds)
        const dedupeKey = `${track.id}::${note.name}::${alignChordScoreTime(noteOn)}`
        if (scheduled.has(dedupeKey)) {
          continue
        }
        scheduled.add(dedupeKey)

        const delay = noteOn - fromSeconds
        const duration = note.duration - (noteOn - alignedStart)

        if (duration <= 0) {
          continue
        }

        track.instrument?.triggerAttackRelease(
          note.name,
          duration,
          now + delay,
          note.velocity,
        )
      }
    }
  }

  releaseAllVoices() {
    const now = Tone.now()
    for (const track of this.trackStates) {
      track.instrument?.releaseAll(now)
    }
  }

  async ensureTrackInstruments() {
    const expectedInstrumentId = this.voiceResolver.instrumentId
    for (const track of this.trackStates) {
      if (track.instrument && track.instrumentVoiceId !== expectedInstrumentId) {
        track.instrument.dispose()
        track.instrument = null
        track.instrumentVoiceId = null
      }
    }
    if (this.trackStates.every((track) => track.instrument)) {
      return
    }
    if (!this.instrumentLoadPromise) {
      this.instrumentLoadPromise = Promise.resolve()
        .then(async () => {
          const createVoice = await this.voiceResolver.ensureFactory()
          if (!createVoice) {
            return
          }
          for (const track of this.trackStates) {
            if (track.instrument) {
              continue
            }
            const instrument = createVoice({
              tone: Tone,
              onStatus: () => this.recomputeInstrumentStatus(),
            })
            instrument.output.connect(track.output)
            track.instrument = instrument
            track.instrumentVoiceId = expectedInstrumentId
          }
          this.recomputeInstrumentStatus()
        })
        .finally(() => {
          this.instrumentLoadPromise = null
        })
    }
    await this.instrumentLoadPromise
  }

  rebuildTrackInstruments() {
    const createVoice = this.voiceResolver.getFactory()
    if (!createVoice) {
      return
    }
    for (const track of this.trackStates) {
      if (!track.instrument) {
        continue
      }
      const muted = track.muted
      track.instrument.dispose()

      // Recreated from the shared, already-decoded sample buffers, so this is a
      // memory-only rebuild (no re-fetch) and stays on the sampled voice.
      const instrument = createVoice({
        tone: Tone,
        onStatus: () => this.recomputeInstrumentStatus(),
      })
      instrument.output.connect(track.output)
      track.instrument = instrument
      track.instrumentVoiceId = this.voiceResolver.instrumentId
      track.output.gain.value = muted ? 0 : 1
    }
    this.recomputeInstrumentStatus()
  }

  clearScheduledPlayback({ rebuildInstruments = false } = {}) {
    this.playing = false
    this.stopProgressLoop()
    this.releaseAllVoices()
    if (rebuildInstruments && this.trackStates.length > 0) {
      this.rebuildTrackInstruments()
    }
  }

  connectTrackOutputsToDestination() {
    for (const track of this.trackStates) {
      if (!track.outputToDestination) {
        track.output.toDestination()
        track.outputToDestination = true
      }
    }
  }

  async playFromUserGesture(audioContextStart) {
    if (!this.midi) {
      return
    }

    await awaitToneStarted(audioContextStart)

    this.connectTrackOutputsToDestination()
    this.clearScheduledPlayback()
    await this.ensureTrackInstruments()
    await this.whenInstrumentReady()

    this.playing = true
    this.playStartedAt = Tone.now()
    this.scheduleNotesFrom(this.offsetSeconds)
    this.startProgressLoop()
  }

  pause() {
    if (this.playing) {
      this.offsetSeconds = this.getCurrentTime()
    }
    this.clearScheduledPlayback({ rebuildInstruments: true })
    this.emitTimeUpdate(this.offsetSeconds)
  }

  stop() {
    this.clearScheduledPlayback()
    this.offsetSeconds = 0
    this.emitTimeUpdate(0)
  }

  seek(seconds) {
    if (!this.midi) {
      return
    }

    const duration = this.getDuration()
    const clamped = Math.max(0, Math.min(seconds, duration))
    const wasPlaying = this.playing

    this.clearScheduledPlayback({ rebuildInstruments: true })
    this.offsetSeconds = clamped

    if (wasPlaying) {
      this.playing = true
      this.playStartedAt = Tone.now()
      this.scheduleNotesFrom(this.offsetSeconds)
      this.startProgressLoop()
    }

    this.emitTimeUpdate(this.offsetSeconds)
  }

  setTrackMuted(trackId, muted) {
    const track = this.trackStates.find((item) => item.id === trackId)
    if (!track) {
      return
    }
    track.muted = muted
    track.output.gain.value = muted ? 0 : 1
  }

  async playTestTone(audioContextStart) {
    await awaitToneStarted(audioContextStart)
    this.disposeTestTone()

    if (!this.createPianoInstrument) {
      const module = await this.loadPianoInstrument()
      this.createPianoInstrument = module.createPianoInstrument
    }
    const instrument = this.createPianoInstrument({ tone: Tone })
    instrument.output.connect(Tone.getDestination())

    const now = Tone.now()
    instrument.triggerAttackRelease('C4', 0.32, now, 0.55)
    instrument.triggerAttackRelease('E4', 0.32, now + 0.22, 0.5)
    instrument.triggerAttackRelease('G4', 0.45, now + 0.44, 0.48)

    this.testToneInstrument = instrument
    this.testToneTimerId = window.setTimeout(() => {
      if (this.testToneInstrument !== instrument) {
        return
      }
      instrument.releaseAll()
      instrument.dispose()
      this.testToneInstrument = null
      this.testToneTimerId = null
    }, 1400)
  }

  disposeTestTone() {
    if (this.testToneTimerId != null) {
      window.clearTimeout(this.testToneTimerId)
      this.testToneTimerId = null
    }
    if (this.testToneInstrument) {
      this.testToneInstrument.releaseAll?.()
      this.testToneInstrument.dispose()
      this.testToneInstrument = null
    }
  }

  getDuration() {
    return this.playbackDuration ?? this.midi?.duration ?? 0
  }

  getCurrentTime() {
    if (this.playing) {
      return this.offsetSeconds + Math.max(0, Tone.now() - this.playStartedAt)
    }
    return this.offsetSeconds
  }

  isPlaying() {
    return this.playing
  }

  getTracks() {
    return this.trackStates.map(({ id, name, noteCount, muted }) => ({
      id,
      name,
      noteCount,
      muted,
    }))
  }

  dispose() {
    this.loadToken += 1
    this.disposeTestTone()
    this.stopPlaybackInternal()
    this.midi = null
    this.playbackDuration = 0
  }

  stopPlaybackInternal() {
    this.disposeTestTone()
    this.clearScheduledPlayback({ rebuildInstruments: false })
    this.disposeTracks()
  }

  disposeTracks() {
    this.trackStates.forEach((track) => {
      track.instrument?.dispose()
      track.output.dispose()
    })
    this.trackStates = []
    this.recomputeInstrumentStatus()
  }

  startProgressLoop() {
    this.stopProgressLoop()

    const tick = () => {
      const duration = this.getDuration()
      let time = this.getCurrentTime()

      if (duration > 0 && time >= duration) {
        time = duration
        this.offsetSeconds = duration
        this.clearScheduledPlayback()
        this.emitTimeUpdate(time)
        return
      }

      this.emitTimeUpdate(time)
      this.progressFrameId = requestAnimationFrame(tick)
    }

    this.progressFrameId = requestAnimationFrame(tick)
  }

  stopProgressLoop() {
    if (this.progressFrameId != null) {
      cancelAnimationFrame(this.progressFrameId)
      this.progressFrameId = null
    }
  }

  emitTimeUpdate(time) {
    if (this.onTimeUpdate) {
      this.onTimeUpdate(time, this.getDuration())
    }
  }
}
