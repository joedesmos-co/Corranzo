import * as Tone from 'tone'
import { awaitToneStarted } from '../audio/toneAudioUnlock.js'
import { getTimeline } from '../musicxml/timeline.js'
import {
  buildCombinedPlaybackSchedule,
  buildMetronomeSchedule,
} from './scorePlaybackSchedule.js'
import { alignChordScoreTime } from './pianoVoiceMix.js'

const LOOKAHEAD_SECONDS = 2.5
const SCHEDULE_TICK_MS = 200
// On Play, wait up to this long for the sampled piano before starting, so the
// first note is real piano rather than the synth fallback. Samples preloaded at
// score-load usually make this resolve instantly; on failure/timeout we proceed
// on the synth rather than blocking playback.
const PLAY_READY_TIMEOUT_MS = 5000
const loadPianoInstrumentModule = () => import('./pianoInstrument.js')

function createMetronomeVoice() {
  // Slightly longer attack (3 ms) and shorter decay soften the click while
  // keeping the metronome distinct from the musical notes.
  return new Tone.MembraneSynth({
    pitchDecay: 0.006,
    octaves: 2,
    envelope: { attack: 0.003, decay: 0.06, sustain: 0, release: 0.04 },
    volume: -20,
  })
}

const MIDI_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function midiNumberToName(midi) {
  const octave = Math.floor(midi / 12) - 1
  return `${MIDI_NAMES[((midi % 12) + 12) % 12]}${octave}`
}

// Map a 0–1 MIDI/score velocity to an expressive-but-not-harsh gain. Wider
// dynamic range than a flat value so chords and accents breathe, with a floor
// so soft inner/bass voices stay audible and a ceiling that avoids clipping.
function softenVelocity(velocity) {
  const value = typeof velocity === 'number' ? velocity : 0.82
  const clamped = Math.min(1, Math.max(0, value))
  return Math.min(0.9, Math.max(0.28, clamped ** 1.25 * 0.82 + 0.14))
}

/**
 * Windowed playback engine driven by the performed score timeline.
 */
export class ScorePlaybackEngine {
  constructor({ loadPianoInstrument = loadPianoInstrumentModule } = {}) {
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
    this.scheduledEvents = new Set()
    this.duration = 0
    this.voice = null
    this.metronome = null
    this.output = null
    this.metronomeEnabled = false
    this.metronomeLevel = 0.6
    this.onInstrumentStatus = null
    this.instrumentStatus = null
    this.loadPianoInstrument = loadPianoInstrument
    this.createPianoInstrument = null
    this.voiceLoadPromise = null
  }

  async ensureVoices() {
    if (this.voice) {
      return
    }
    if (!this.voiceLoadPromise) {
      this.voiceLoadPromise = Promise.resolve()
        .then(async () => {
          if (!this.createPianoInstrument) {
            const module = await this.loadPianoInstrument()
            this.createPianoInstrument = module.createPianoInstrument
          }
          if (!this.voice) {
            this.output = new Tone.Gain(1).toDestination()
            // The instrument module and samples are first requested here, after
            // the Play/Test Sound gesture has already unlocked Web Audio.
            this.voice = this.createPianoInstrument({
              tone: Tone,
              onStatus: (status) => this.handleInstrumentStatus(status),
            })
            this.voice.output.connect(this.output)
            this.syncOutputMute()
          }
          if (!this.metronome) {
            this.metronome = createMetronomeVoice()
            this.metronome.toDestination()
            this.metronome.volume.value = Tone.gainToDb(0.15 + this.metronomeLevel * 0.55)
          }
        })
        .finally(() => {
          this.voiceLoadPromise = null
        })
    }
    await this.voiceLoadPromise
  }

  /**
   * Fetch/decode piano samples ahead of Play without wiring the audio graph.
   * Safe before user gesture — suspended contexts still fetch + decode buffers.
   */
  async preload() {
    try {
      const module = await this.loadPianoInstrument()
      if (!this.createPianoInstrument) {
        this.createPianoInstrument = module.createPianoInstrument
      }
      await module.preloadPianoSampleBuffers({ tone: Tone })
    } catch {
      // Non-fatal — playFromUserGesture will retry instrument creation.
    }
  }

  /** Resolve once the sampled piano is ready (or fell back), capped by timeout. */
  whenInstrumentReady(timeoutMs = PLAY_READY_TIMEOUT_MS) {
    const ready = this.voice?.whenReady?.() ?? Promise.resolve(null)
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return ready
    }
    return Promise.race([
      ready,
      new Promise((resolve) => {
        setTimeout(() => resolve('timeout'), timeoutMs)
      }),
    ])
  }

  handleInstrumentStatus(status) {
    this.instrumentStatus = status
    if (this.onInstrumentStatus) {
      this.onInstrumentStatus(status)
    }
  }

  getInstrumentStatus() {
    return this.instrumentStatus
  }

  disposeVoices() {
    if (this.voice) {
      this.voice.dispose()
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
    this.scheduledEvents.clear()

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
    if (!this.voice || !this.metronome) {
      return
    }
    const now = Tone.now()
    this.metronome.volume.value = Tone.gainToDb(0.15 + this.metronomeLevel * 0.55)

    const events = this.metronomeEnabled
      ? [...this.noteEvents, ...this.metronomeEvents]
      : this.noteEvents

    for (const event of events) {
      if (event.scoreTimeSeconds < fromScoreSeconds || event.scoreTimeSeconds >= toScoreSeconds) {
        continue
      }

      // De-dupe by event IDENTITY (not by time) so every note of a chord — and
      // both hands sounding at the same instant — is scheduled. A time+type key
      // collapsed simultaneous notes into one, dropping bass/inner voices.
      if (this.scheduledEvents.has(event)) {
        continue
      }

      // Per-track (hand) muting: don't schedule notes from a muted track. Left
      // un-added so it re-evaluates if the track is later unmuted.
      if (event.type === 'note' && this.isTrackMuted(event.trackId)) {
        continue
      }

      const scoreTime =
        event.type === 'note'
          ? alignChordScoreTime(event.scoreTimeSeconds)
          : event.scoreTimeSeconds
      const wallAt = this.wallTimeForScoreTime(scoreTime)
      const delay = wallAt - now
      if (delay < -0.05) {
        continue
      }

      const at = Math.max(now, wallAt)

      if (event.type === 'metronome') {
        const pitch = event.accent ? 'C5' : 'G4'
        this.metronome.triggerAttackRelease(pitch, 0.04, at)
      } else {
        const name = event.name ?? midiNumberToName(event.midi)
        const velocity = softenVelocity(event.velocity ?? 0.75)
        const duration = (event.baseDurationSeconds ?? 0.03) / this.playbackRate
        this.voice.triggerAttackRelease(name, duration, at, velocity)
      }

      this.scheduledEvents.add(event)
    }

    this.scheduledUntilScore = toScoreSeconds
  }

  rescheduleFrom(scoreSeconds) {
    const wasPlaying = this.playing
    this.releaseAll()
    this.offsetScoreSeconds = Math.max(0, Math.min(scoreSeconds, this.duration || scoreSeconds))
    this.scheduledEvents.clear()
    this.scheduledUntilScore = this.offsetScoreSeconds
    if (wasPlaying) {
      this.playStartedAt = Tone.now()
      this.scheduleWindow(
        this.offsetScoreSeconds,
        this.offsetScoreSeconds + LOOKAHEAD_SECONDS,
      )
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
      this.voice.releaseAll(Tone.now())
    }
  }

  async playFromUserGesture(audioContextStart) {
    if (!this.noteEvents.length && this.duration <= 0) {
      return
    }

    await awaitToneStarted(audioContextStart)

    await this.ensureVoices()
    // Wait briefly for the sampled piano so the first note is real piano, not
    // the synth fallback. Instant when samples were preloaded at score-load;
    // proceeds on the synth only if samples genuinely fail/time out.
    await this.whenInstrumentReady()
    this.releaseAll()
    this.scheduledEvents.clear()
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
    this.scheduledEvents.clear()

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
    this.scheduledEvents.clear()
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
    this.syncOutputMute()
    // Re-schedule so a (un)muted hand takes effect within the current window.
    // Notes already triggered keep ringing briefly; new notes honour the mute.
    if (this.playing) {
      this.rescheduleFrom(this.getCurrentScoreTime())
    }
  }

  isTrackMuted(trackId) {
    if (trackId == null || this.tracks.length === 0) {
      return false
    }
    const track = this.tracks.find((item) => item.id === trackId)
    return Boolean(track?.muted)
  }

  syncOutputMute() {
    if (this.output) {
      const anyUnmuted = this.tracks.some((item) => !item.muted)
      this.output.gain.value = anyUnmuted || this.tracks.length === 0 ? 1 : 0
    }
  }

  async playTestTone(audioContextStart) {
    await awaitToneStarted(audioContextStart)

    // Reuse the real instrument so the test tone also benefits from the sampled
    // piano (and starts loading it). It plays on the synth immediately if the
    // samples have not finished loading yet.
    await this.ensureVoices()
    const now = Tone.now()
    this.voice.triggerAttackRelease('C4', 0.32, now, 0.55)
    this.voice.triggerAttackRelease('E4', 0.32, now + 0.22, 0.5)
    this.voice.triggerAttackRelease('G4', 0.45, now + 0.44, 0.48)
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
