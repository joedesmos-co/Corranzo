import * as Tone from 'tone'
import { getTimeline } from '../musicxml/timeline.js'
import { buildCombinedPlaybackSchedule } from './scorePlaybackSchedule.js'

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

const MIDI_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function midiNumberToName(midi) {
  const octave = Math.floor(midi / 12) - 1
  return `${MIDI_NAMES[((midi % 12) + 12) % 12]}${octave}`
}

function softenVelocity(velocity) {
  const value = typeof velocity === 'number' ? velocity : 0.82
  return Math.min(0.92, Math.max(0.22, value ** 1.15 * 0.78 + 0.14))
}

/**
 * Windowed playback engine driven by the performed score timeline.
 * MIDI events are mapped onto performed time; MusicXML notes are the XML-only source.
 */
export class ScorePlaybackEngine {
  constructor() {
    this.events = []
    this.tracks = []
    this.onTimeUpdate = null
    this.progressFrameId = null
    this.scheduleTimerId = null
    this.loadToken = 0
    this.offsetScoreSeconds = 0
    this.playbackRate = 1
    this.playing = false
    this.playStartedAt = 0
    this.scheduledUntilScore = 0
    this.duration = 0
    this.voice = null
    this.output = null
  }

  ensureVoice() {
    if (this.voice) {
      return
    }
    this.output = new Tone.Gain(1).toDestination()
    this.voice = createPianoVoice()
    this.voice.reverb.connect(this.output)
  }

  disposeVoice() {
    if (!this.voice) {
      return
    }
    this.voice.synth.dispose()
    this.voice.filter.dispose()
    this.voice.chorus.dispose()
    this.voice.reverb.dispose()
    this.output?.dispose()
    this.voice = null
    this.output = null
  }

  async load({ timingMap, midiArrayBuffer = null }) {
    const loadToken = ++this.loadToken
    this.stopInternal()

    if (!timingMap) {
      this.events = []
      this.duration = 0
      this.tracks = []
      return null
    }

    const schedule = await buildCombinedPlaybackSchedule(timingMap, midiArrayBuffer, {
      rate: this.playbackRate,
    })
    if (loadToken !== this.loadToken) {
      return null
    }

    this.events = schedule.events
    this.duration = getTimeline(timingMap).performedDurationSeconds
    this.tracks = schedule.tracks ?? []
    this.offsetScoreSeconds = 0
    this.scheduledUntilScore = 0

    return {
      duration: this.duration,
      tracks: this.tracks,
      eventCount: this.events.length,
    }
  }

  setPlaybackRate(rate) {
    const next = Math.max(0.25, Math.min(1.5, rate))
    if (Math.abs(next - this.playbackRate) < 1e-6) {
      return
    }
    const scoreTime = this.getCurrentScoreTime()
    this.playbackRate = next
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

  scheduleWindow(fromScoreSeconds, toScoreSeconds) {
    this.ensureVoice()
    const now = Tone.now()
    const baseWall = this.playStartedAt - this.offsetScoreSeconds / this.playbackRate

    for (const event of this.events) {
      if (event.scoreTimeSeconds < fromScoreSeconds || event.scoreTimeSeconds >= toScoreSeconds) {
        continue
      }

      const wallAt = baseWall + event.scoreTimeSeconds / this.playbackRate
      const delay = wallAt - now
      if (delay < -0.05) {
        continue
      }

      const name = event.name ?? midiNumberToName(event.midi)
      const velocity = softenVelocity(event.velocity ?? 0.75)
      this.voice.synth.triggerAttackRelease(
        name,
        event.durationSeconds,
        Math.max(now, now + delay),
        velocity,
      )
    }

    this.scheduledUntilScore = toScoreSeconds
  }

  rescheduleFrom(scoreSeconds) {
    const wasPlaying = this.playing
    this.releaseAll()
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
    if (!this.events.length && this.duration <= 0) {
      return
    }

    if (audioContextStart) {
      await audioContextStart
    } else if (Tone.getContext().state !== 'running') {
      await Tone.start()
    }

    this.releaseAll()
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
    this.disposeVoice()
    this.events = []
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
