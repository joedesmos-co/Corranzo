import * as Tone from 'tone'
import { getTimeline } from '../musicxml/timeline.js'
import {
  applyPlaybackRate,
  buildCombinedPlaybackSchedule,
  buildMetronomeSchedule,
  buildScoreNoteSchedule,
} from './scorePlaybackSchedule.js'

const LOOKAHEAD_SECONDS = 2.5
const SCHEDULE_TICK_MS = 200

function createPianoVoice() {
  const reverb = new Tone.Reverb({ decay: 1.8, wet: 0.14 })
  reverb.generate()

  const chorus = new Tone.Chorus({
    frequency: 0.8,
    delayTime: 2.5,
    depth: 0.18,
    wet: 0.12,
  })
  chorus.start()

  const filter = new Tone.Filter({ type: 'lowpass', frequency: 3200, rolloff: -12 })

  const synth = new Tone.PolySynth({
    voice: Tone.Synth,
    maxPolyphony: 24,
  })

  synth.set({
    volume: -11,
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.018, decay: 0.42, sustain: 0.32, release: 1.35 },
  })

  synth.connect(filter)
  filter.connect(chorus)
  chorus.connect(reverb)

  return { synth, filter, chorus, reverb }
}

function createMetronomeVoice() {
  const synth = new Tone.MembraneSynth({
    pitchDecay: 0.008,
    octaves: 2,
    envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 },
    volume: -18,
  }).toDestination()
  return synth
}

const MIDI_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function midiNumberToName(midi) {
  const octave = Math.floor(midi / 12) - 1
  return `${MIDI_NAMES[((midi % 12) + 12) % 12]}${octave}`
}

function softenVelocity(velocity) {
  const value = typeof velocity === 'number' ? velocity : 0.82
  return Math.min(0.92, Math.max(0.22, value ** 1.15 * 0.78 + 0.14))
}

function eventKey(event) {
  return `${event.type}:${event.scoreTimeSeconds.toFixed(5)}`
}

/**
 * Windowed playback engine driven by the performed score timeline.
 */
export class ScorePlaybackEngine {
  constructor() {
    this.timingMap = null
    this.noteEvents = []
    this.metronomeEvents = []
    this.tracks = []
    this.mappingWarning = null
    this.onTimeUpdate = null
    this.progressFrameId = null
    this.scheduleTimerId = null
    this.loadToken = 0
    this.offsetScoreSeconds = 0
    this.playbackRate = 1
    this.playing = false
    this.playStartedAt = 0
    this.scheduledUntilScore = 0
    this.scheduledKeys = new Set()
    this.duration = 0
    this.voice = null
    this.metronome = null
    this.output = null
    this.metronomeEnabled = false
    this.metronomeLevel = 0.6
  }

  ensureVoices() {
    if (!this.voice) {
      this.output = new Tone.Gain(1).toDestination()
      this.voice = createPianoVoice()
      this.voice.reverb.connect(this.output)
    }
    if (!this.metronome) {
      this.metronome = createMetronomeVoice()
    }
  }

  disposeVoices() {
    if (this.voice) {
      this.voice.synth.dispose()
      this.voice.filter.dispose()
      this.voice.chorus.dispose()
      this.voice.reverb.dispose()
      this.output?.dispose()
      this.voice = null
      this.output = null
    }
    if (this.metronome) {
      this.metronome.dispose()
      this.metronome = null
    }
  }

  async load({ timingMap, midiArrayBuffer = null, alignmentDiagnostics = null }) {
    const loadToken = ++this.loadToken
    this.stopInternal()

    if (!timingMap) {
      this.timingMap = null
      this.noteEvents = []
      this.metronomeEvents = []
      this.duration = 0
      this.tracks = []
      return null
    }

    const schedule = await buildCombinedPlaybackSchedule(timingMap, midiArrayBuffer, {
      rate: this.playbackRate,
      alignmentDiagnostics,
    })
    if (loadToken !== this.loadToken) {
      return null
    }

    this.timingMap = timingMap
    this.noteEvents = schedule.noteEvents ?? schedule.events ?? []
    this.metronomeEvents = schedule.metronomeEvents ?? []
    this.mappingWarning = schedule.mappingWarning ?? null
    this.duration = getTimeline(timingMap).performedDurationSeconds
    this.tracks = schedule.tracks ?? []
    this.offsetScoreSeconds = 0
    this.scheduledUntilScore = 0
    this.scheduledKeys.clear()

    return {
      duration: this.duration,
      tracks: this.tracks,
      eventCount: this.noteEvents.length,
      mappingMethod: schedule.mappingMethod,
      mappingWarning: this.mappingWarning,
    }
  }

  setMetronomeEnabled(enabled) {
    this.metronomeEnabled = Boolean(enabled)
    if (this.playing) {
      this.rescheduleFrom(this.getCurrentScoreTime())
    }
  }

  setMetronomeLevel(level) {
    this.metronomeLevel = Math.max(0, Math.min(1, level))
    if (this.metronome) {
      this.metronome.volume.value = Tone.gainToDb(0.15 + this.metronomeLevel * 0.55)
    }
  }

  setPlaybackRate(rate) {
    const next = Math.max(0.25, Math.min(1.5, rate))
    if (Math.abs(next - this.playbackRate) < 1e-6) {
      return
    }
    const scoreTime = this.getCurrentScoreTime()
    this.playbackRate = next
    if (this.timingMap) {
      this.metronomeEvents = buildMetronomeSchedule(this.timingMap, { rate: this.playbackRate })
    }
    this.rescheduleFrom(scoreTime)
  }

  getPlaybackRate() {
    return this.playbackRate
  }

  getCurrentScoreTime() {
    if (this.playing) {
      const wallElapsed = Math.max(0, Tone.now() - this.playStartedAt)
      return this.offsetScoreSeconds + wallElapsed * this.playbackRate
    }
    return this.offsetScoreSeconds
  }

  wallTimeForScoreTime(scoreTimeSeconds) {
    return this.playStartedAt - this.offsetScoreSeconds / this.playbackRate + scoreTimeSeconds / this.playbackRate
  }

  scheduleWindow(fromScoreSeconds, toScoreSeconds) {
    this.ensureVoices()
    const now = Tone.now()
    this.metronome.volume.value = Tone.gainToDb(0.15 + this.metronomeLevel * 0.55)

    const events = this.metronomeEnabled
      ? [...this.noteEvents, ...this.metronomeEvents]
      : this.noteEvents

    for (const event of events) {
      if (event.scoreTimeSeconds < fromScoreSeconds || event.scoreTimeSeconds >= toScoreSeconds) {
        continue
      }

      const key = eventKey(event)
      if (this.scheduledKeys.has(key)) {
        continue
      }

      const wallAt = this.wallTimeForScoreTime(event.scoreTimeSeconds)
      const delay = wallAt - now
      if (delay < -0.05) {
        continue
      }

      const at = Math.max(now, now + delay)

      if (event.type === 'metronome') {
        const pitch = event.accent ? 'C5' : 'G4'
        this.metronome.triggerAttackRelease(pitch, 0.04, at)
      } else {
        const name = event.name ?? midiNumberToName(event.midi)
        const velocity = softenVelocity(event.velocity ?? 0.75)
        const duration = (event.baseDurationSeconds ?? 0.03) / this.playbackRate
        this.voice.synth.triggerAttackRelease(name, duration, at, velocity)
      }

      this.scheduledKeys.add(key)
    }

    this.scheduledUntilScore = toScoreSeconds
  }

  rescheduleFrom(scoreSeconds) {
    const wasPlaying = this.playing
    this.releaseAll()
    this.scheduledKeys.clear()
    this.scheduledUntilScore = scoreSeconds
    if (wasPlaying) {
      this.playStartedAt = Tone.now()
      this.scheduleWindow(scoreSeconds, scoreSeconds + LOOKAHEAD_SECONDS)
      this.startScheduleLoop()
    }
  }

  startScheduleLoop() {
    this.stopScheduleLoop()
    this.scheduleTimerId = window.setInterval(() => {
      if (!this.playing) {
        return
      }
      const scoreTime = this.getCurrentScoreTime()
      if (scoreTime + LOOKAHEAD_SECONDS > this.scheduledUntilScore) {
        this.scheduleWindow(this.scheduledUntilScore, scoreTime + LOOKAHEAD_SECONDS)
      }
    }, SCHEDULE_TICK_MS)
  }

  stopScheduleLoop() {
    if (this.scheduleTimerId != null) {
      window.clearInterval(this.scheduleTimerId)
      this.scheduleTimerId = null
    }
  }

  releaseAll() {
    if (this.voice) {
      this.voice.synth.releaseAll(Tone.now())
    }
  }

  async playFromUserGesture(audioContextStart) {
    if (!this.noteEvents.length && this.duration <= 0) {
      return
    }

    if (audioContextStart) {
      await audioContextStart
    } else if (Tone.getContext().state !== 'running') {
      await Tone.start()
    }

    this.releaseAll()
    this.scheduledKeys.clear()
    this.playing = true
    this.playStartedAt = Tone.now()
    this.scheduledUntilScore = this.offsetScoreSeconds
    this.scheduleWindow(this.offsetScoreSeconds, this.offsetScoreSeconds + LOOKAHEAD_SECONDS)
    this.startScheduleLoop()
    this.startProgressLoop()
  }

  pause() {
    if (this.playing) {
      this.offsetScoreSeconds = this.getCurrentScoreTime()
    }
    this.stopInternal(false)
    this.emitTimeUpdate(this.offsetScoreSeconds)
  }

  stop() {
    this.stopInternal(true)
    this.emitTimeUpdate(0)
  }

  seek(scoreSeconds) {
    const clamped = Math.max(0, Math.min(scoreSeconds, this.duration))
    const wasPlaying = this.playing
    this.stopInternal(false)
    this.offsetScoreSeconds = clamped
    this.scheduledUntilScore = clamped
    this.scheduledKeys.clear()

    if (wasPlaying) {
      this.playing = true
      this.playStartedAt = Tone.now()
      this.scheduleWindow(clamped, clamped + LOOKAHEAD_SECONDS)
      this.startScheduleLoop()
      this.startProgressLoop()
    }

    this.emitTimeUpdate(this.offsetScoreSeconds)
  }

  stopInternal(resetOffset = false) {
    this.playing = false
    this.stopProgressLoop()
    this.stopScheduleLoop()
    this.releaseAll()
    this.scheduledKeys.clear()
    if (resetOffset) {
      this.offsetScoreSeconds = 0
      this.scheduledUntilScore = 0
    }
  }

  getDuration() {
    return this.duration
  }

  isPlaying() {
    return this.playing
  }

  getTracks() {
    return this.tracks
  }

  getMappingWarning() {
    return this.mappingWarning
  }

  setTrackMuted(trackId, muted) {
    const track = this.tracks.find((item) => item.id === trackId)
    if (track) {
      track.muted = muted
    }
    if (this.output) {
      const anyUnmuted = this.tracks.some((item) => !item.muted)
      this.output.gain.value = anyUnmuted || this.tracks.length === 0 ? 1 : 0
    }
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

  dispose() {
    this.loadToken += 1
    this.stopInternal(true)
    this.disposeVoices()
    this.timingMap = null
    this.noteEvents = []
    this.metronomeEvents = []
    this.tracks = []
    this.duration = 0
  }

  startProgressLoop() {
    this.stopProgressLoop()
    const tick = () => {
      let time = this.getCurrentScoreTime()
      if (this.duration > 0 && time >= this.duration) {
        time = this.duration
        this.offsetScoreSeconds = this.duration
        this.stopInternal(false)
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
