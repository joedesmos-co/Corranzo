import * as Tone from 'tone'
import { awaitToneStarted } from '../audio/toneAudioUnlock.js'
import { parseMidiFile } from './parseMidiFile.js'
import { INSTRUMENT_STATUS } from './pianoInstrumentStatus.js'
import { alignChordScoreTime } from './pianoVoiceMix.js'

const loadPianoInstrumentModule = () => import('./pianoInstrument.js')

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
  const value = typeof velocity === 'number' ? velocity : 0.82
  const shaped = value ** 1.1
  return Math.min(0.9, Math.max(0.28, shaped * 0.8 + 0.16))
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
    this.createPianoInstrument = null
    this.instrumentLoadPromise = null
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
    if (this.trackStates.every((track) => track.instrument)) {
      return
    }
    if (!this.instrumentLoadPromise) {
      this.instrumentLoadPromise = Promise.resolve()
        .then(async () => {
          if (!this.createPianoInstrument) {
            const module = await this.loadPianoInstrument()
            this.createPianoInstrument = module.createPianoInstrument
          }
          for (const track of this.trackStates) {
            if (track.instrument) {
              continue
            }
            const instrument = this.createPianoInstrument({
              tone: Tone,
              onStatus: () => this.recomputeInstrumentStatus(),
            })
            instrument.output.connect(track.output)
            track.instrument = instrument
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
    if (!this.createPianoInstrument) {
      return
    }
    for (const track of this.trackStates) {
      if (!track.instrument) {
        continue
      }
      const muted = track.muted
      track.instrument.dispose()

      // Recreated from the shared, already-decoded sample buffers, so this is a
      // memory-only rebuild (no re-fetch) and stays on the sampled piano.
      const instrument = this.createPianoInstrument({
        tone: Tone,
        onStatus: () => this.recomputeInstrumentStatus(),
      })
      instrument.output.connect(track.output)
      track.instrument = instrument
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

    window.setTimeout(() => {
      instrument.releaseAll()
      instrument.dispose()
    }, 1400)
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
    this.stopPlaybackInternal()
    this.midi = null
    this.playbackDuration = 0
  }

  stopPlaybackInternal() {
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
