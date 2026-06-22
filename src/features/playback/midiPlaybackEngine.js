import * as Tone from 'tone'
import { parseMidiFile } from './parseMidiFile.js'
import { createPianoInstrument, INSTRUMENT_STATUS } from './pianoInstrument.js'

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
  const shaped = value ** 1.15
  return Math.min(0.92, Math.max(0.22, shaped * 0.78 + 0.14))
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
  constructor() {
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
  }

  // Aggregate the per-track instrument statuses into one: sampled if any track
  // has samples, loading while any is still loading, otherwise synth fallback.
  recomputeInstrumentStatus() {
    const statuses = this.trackStates.map((track) => track.instrument?.status)
    let next = null
    if (statuses.length > 0) {
      if (statuses.includes(INSTRUMENT_STATUS.SAMPLED)) {
        next = INSTRUMENT_STATUS.SAMPLED
      } else if (statuses.includes(INSTRUMENT_STATUS.LOADING)) {
        next = INSTRUMENT_STATUS.LOADING
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
    this.clearScheduledPlayback()

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
      output.toDestination()

      // Each track gets its own sampled-piano instrument (with synth fallback),
      // routed through the track's gain so per-track muting is unchanged. The
      // decoded samples are shared across tracks, so they are fetched once.
      const instrument = createPianoInstrument({
        tone: Tone,
        onStatus: () => this.recomputeInstrumentStatus(),
      })
      instrument.output.connect(output)

      return {
        id: index,
        name: tracks[index].name,
        noteCount: tracks[index].noteCount,
        muted: false,
        notes: normalizeNoteEvents(track.notes),
        instrument,
        output,
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

    for (const track of this.trackStates) {
      for (const note of track.notes) {
        const noteEnd = note.time + note.duration
        if (noteEnd <= fromSeconds) {
          continue
        }

        const noteOn = Math.max(note.time, fromSeconds)
        const delay = noteOn - fromSeconds
        const duration = note.duration - (noteOn - note.time)

        if (duration <= 0) {
          continue
        }

        track.instrument.triggerAttackRelease(
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
      track.instrument.releaseAll(now)
    }
  }

  rebuildTrackSynths() {
    for (const track of this.trackStates) {
      const muted = track.muted
      track.instrument.dispose()

      // Recreated from the shared, already-decoded sample buffers, so this is a
      // memory-only rebuild (no re-fetch) and stays on the sampled piano.
      const instrument = createPianoInstrument({
        tone: Tone,
        onStatus: () => this.recomputeInstrumentStatus(),
      })
      instrument.output.connect(track.output)
      track.instrument = instrument
      track.output.gain.value = muted ? 0 : 1
    }
    this.recomputeInstrumentStatus()
  }

  clearScheduledPlayback() {
    this.playing = false
    this.stopProgressLoop()
    this.releaseAllVoices()
    if (this.trackStates.length > 0) {
      this.rebuildTrackSynths()
    }
  }

  async playFromUserGesture(audioContextStart) {
    if (!this.midi) {
      return
    }

    if (audioContextStart) {
      await audioContextStart
    } else if (Tone.getContext().state !== 'running') {
      await Tone.start()
    }

    this.clearScheduledPlayback()

    this.playing = true
    this.playStartedAt = Tone.now()
    this.scheduleNotesFrom(this.offsetSeconds)
    this.startProgressLoop()
  }

  pause() {
    if (this.playing) {
      this.offsetSeconds = this.getCurrentTime()
    }
    this.clearScheduledPlayback()
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

    this.clearScheduledPlayback()
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
    if (audioContextStart) {
      await audioContextStart
    } else if (Tone.getContext().state !== 'running') {
      await Tone.start()
    }

    const instrument = createPianoInstrument({ tone: Tone })
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
    this.clearScheduledPlayback()
    this.disposeTracks()
    this.midi = null
    this.playbackDuration = 0
  }

  stopPlaybackInternal() {
    this.clearScheduledPlayback()
    this.disposeTracks()
  }

  disposeTracks() {
    this.trackStates.forEach((track) => {
      track.instrument.dispose()
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
