import * as Tone from 'tone'
import { parseMidiFile } from './parseMidiFile.js'

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

function createPianoVoice() {
  const reverb = new Tone.Reverb({
    decay: 1.8,
    wet: 0.14,
  })
  reverb.generate()

  const chorus = new Tone.Chorus({
    frequency: 0.8,
    delayTime: 2.5,
    depth: 0.18,
    wet: 0.12,
  })
  chorus.start()

  const filter = new Tone.Filter({
    type: 'lowpass',
    frequency: 3200,
    rolloff: -12,
  })

  const synth = new Tone.PolySynth({
    voice: Tone.Synth,
    maxPolyphony: 24,
  })

  synth.set({
    volume: -11,
    oscillator: { type: 'triangle' },
    envelope: {
      attack: 0.018,
      decay: 0.42,
      sustain: 0.32,
      release: 1.35,
    },
  })

  synth.connect(filter)
  filter.connect(chorus)
  chorus.connect(reverb)

  return { synth, filter, chorus, reverb }
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

      const voice = createPianoVoice()
      voice.reverb.connect(output)

      return {
        id: index,
        name: tracks[index].name,
        noteCount: tracks[index].noteCount,
        muted: false,
        notes: normalizeNoteEvents(track.notes),
        ...voice,
        output,
      }
    })

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

        track.synth.triggerAttackRelease(
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
      track.synth.releaseAll(now)
    }
  }

  rebuildTrackSynths() {
    for (const track of this.trackStates) {
      const muted = track.muted
      track.synth.dispose()
      track.filter.dispose()
      track.chorus.dispose()
      track.reverb.dispose()

      const voice = createPianoVoice()
      voice.reverb.connect(track.output)
      Object.assign(track, voice)
      track.output.gain.value = muted ? 0 : 1
    }
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

    const { synth, filter, chorus, reverb } = createPianoVoice()
    reverb.connect(Tone.getDestination())

    const now = Tone.now()
    synth.triggerAttackRelease('C4', 0.32, now, 0.55)
    synth.triggerAttackRelease('E4', 0.32, now + 0.22, 0.5)
    synth.triggerAttackRelease('G4', 0.45, now + 0.44, 0.48)

    window.setTimeout(() => {
      synth.releaseAll()
      synth.dispose()
      filter.dispose()
      chorus.dispose()
      reverb.dispose()
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
      track.synth.dispose()
      track.filter.dispose()
      track.chorus.dispose()
      track.reverb.dispose()
      track.output.dispose()
    })
    this.trackStates = []
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
