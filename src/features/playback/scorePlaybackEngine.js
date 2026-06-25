import * as Tone from 'tone'
import { awaitToneStarted } from '../audio/toneAudioUnlock.js'
import { getTimeline } from '../musicxml/timeline.js'
import { buildCombinedPlaybackSchedule } from './scorePlaybackSchedule.js'
import { buildMetronomeSchedule } from './metronomeSchedule.js'
import {
  buildCountInSchedule,
  getCountInDurationSeconds,
  getMetronomeDisplayState,
} from './metronomeSchedule.js'
import { METRONOME_COUNT_IN, METRONOME_SUBDIVISION } from './metronomeConstants.js'
import { createMetronomeVoice, metronomeLevelToDb } from './metronomeVoice.js'
import { alignChordScoreTime } from './pianoVoiceMix.js'

const LOOKAHEAD_SECONDS = 2.5
const SCHEDULE_TICK_MS = 200
// On Play, wait up to this long for the sampled piano before starting, so the
// first note is real piano rather than the synth fallback. Samples preloaded at
// score-load usually make this resolve instantly; on failure/timeout we proceed
// on the synth rather than blocking playback.
const PLAY_READY_TIMEOUT_MS = 5000
const loadPianoInstrumentModule = () => import('./pianoInstrument.js')

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
    this.metronomeSubdivision = METRONOME_SUBDIVISION.QUARTER
    this.metronomeCountIn = METRONOME_COUNT_IN.OFF
    this.countInActive = false
    this.countInDurationSeconds = 0
    this.countInWallStartedAt = 0
    this.countInTimerId = null
    this.countInEvents = []
    this.onMetronomeDisplay = null
    this.metronomeDisplayState = null
    /** Bumped on seek/pause/stop so stale interval callbacks never reschedule. */
    this.scheduleGeneration = 0
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
            this.metronome = createMetronomeVoice(Tone)
            this.metronome.toDestination()
            this.applyMetronomeLevel()
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
    this.rebuildMetronomeEvents()
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

  applyMetronomeLevel() {
    if (!this.metronome?.volume) {
      return
    }
    const db = metronomeLevelToDb(this.metronomeLevel)
    if (this.metronome.volume.volume) {
      this.metronome.volume.volume.value = db
    } else {
      this.metronome.volume.value = db
    }
  }

  rebuildMetronomeEvents() {
    if (!this.timingMap) {
      this.metronomeEvents = []
      return
    }
    this.metronomeEvents = buildMetronomeSchedule(this.timingMap, {
      subdivision: this.metronomeSubdivision,
    })
  }

  emitMetronomeDisplay() {
    if (!this.onMetronomeDisplay) {
      return
    }
    const virtualTime = this.countInActive
      ? this.getCountInVirtualTime()
      : this.getCurrentScoreTime()
    const measure = this.timingMap?.measures?.[0]
    const beatsPerMeasure = measure?.beats ?? 4
    const next = getMetronomeDisplayState(this.timingMap, virtualTime, {
      countInActive: this.countInActive,
      countInDurationSeconds: this.countInDurationSeconds,
      playbackStartScoreTime: this.offsetScoreSeconds,
      beatsPerMeasure,
    })
    this.metronomeDisplayState = next
    this.onMetronomeDisplay(next)
  }

  getCountInVirtualTime() {
    if (!this.countInActive) {
      return this.getCurrentScoreTime()
    }
    const elapsed = Math.max(0, Tone.now() - this.countInWallStartedAt) * this.playbackRate
    return -this.countInDurationSeconds + elapsed
  }

  cancelCountIn() {
    if (this.countInTimerId != null) {
      window.clearTimeout(this.countInTimerId)
      this.countInTimerId = null
    }
    this.countInActive = false
    this.countInDurationSeconds = 0
    this.countInEvents = []
  }

  scheduleCountInClicks() {
    if (!this.metronome || !this.countInEvents.length) {
      return
    }
    const now = Tone.now()
    const startVirtual = -this.countInDurationSeconds
    for (const event of this.countInEvents) {
      const offset = event.scoreTimeSeconds - startVirtual
      const wallAt = now + offset / this.playbackRate
      if (wallAt >= now - 0.05) {
        this.metronome.triggerClick(event.accent, wallAt)
      }
    }
  }

  beginScorePlayback() {
    this.cancelCountIn()
    this.scheduledEvents.clear()
    this.playing = true
    this.playStartedAt = Tone.now()
    this.scheduledUntilScore = this.offsetScoreSeconds
    this.scheduleWindow(this.offsetScoreSeconds, this.offsetScoreSeconds + LOOKAHEAD_SECONDS)
    this.startScheduleLoop()
    this.startProgressLoop()
    this.emitMetronomeDisplay()
  }

  startCountInThenPlayback() {
    this.countInDurationSeconds = getCountInDurationSeconds(
      this.timingMap,
      this.offsetScoreSeconds,
      this.metronomeCountIn,
    )
    this.countInEvents = buildCountInSchedule(
      this.timingMap,
      this.offsetScoreSeconds,
      this.metronomeCountIn,
      { subdivision: this.metronomeSubdivision },
    )

    if (this.countInDurationSeconds <= 0 || this.countInEvents.length === 0) {
      this.beginScorePlayback()
      return
    }

    this.countInActive = true
    this.countInWallStartedAt = Tone.now()
    this.playing = true
    this.scheduleCountInClicks()
    this.startProgressLoop()
    this.emitMetronomeDisplay()

    const wallDurationMs = (this.countInDurationSeconds / this.playbackRate) * 1000
    const generation = this.scheduleGeneration
    this.countInTimerId = window.setTimeout(() => {
      if (this.scheduleGeneration !== generation || !this.countInActive) {
        return
      }
      this.beginScorePlayback()
    }, wallDurationMs)
  }

  setMetronomeEnabled(enabled) {
    this.metronomeEnabled = Boolean(enabled)
    if (this.playing && !this.countInActive) {
      this.rescheduleFrom(this.getCurrentScoreTime())
    }
  }

  setMetronomeLevel(level) {
    this.metronomeLevel = Math.max(0, Math.min(1, level))
    this.applyMetronomeLevel()
  }

  setMetronomeSubdivision(subdivision) {
    if (this.metronomeSubdivision === subdivision) {
      return
    }
    this.metronomeSubdivision = subdivision
    this.rebuildMetronomeEvents()
    if (this.playing && !this.countInActive) {
      this.rescheduleFrom(this.getCurrentScoreTime())
    }
  }

  setMetronomeCountIn(measureCount) {
    this.metronomeCountIn = measureCount
  }

  getMetronomeSettings() {
    return {
      enabled: this.metronomeEnabled,
      level: this.metronomeLevel,
      subdivision: this.metronomeSubdivision,
      countIn: this.metronomeCountIn,
    }
  }

  setPlaybackRate(rate) {
    const next = Math.max(0.25, Math.min(1.5, rate))
    if (Math.abs(next - this.playbackRate) < 1e-6) {
      return
    }
    const scoreTime = this.getCurrentScoreTime()
    this.playbackRate = next
    this.rebuildMetronomeEvents()
    this.rescheduleFrom(scoreTime)
  }

  getPlaybackRate() {
    return this.playbackRate
  }

  getCurrentScoreTime() {
    if (this.countInActive) {
      return this.offsetScoreSeconds
    }
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
    this.applyMetronomeLevel()

    const events = this.metronomeEnabled && !this.countInActive
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
        this.metronome.triggerClick(event.accent, at)
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
    const generation = this.scheduleGeneration
    this.scheduleTimerId = window.setInterval(() => {
      if (!this.playing || this.scheduleGeneration !== generation) {
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

  /**
   * Stop sounding notes and discard queued future triggerAttackRelease calls.
   * Tone.js cannot cancel already-scheduled absolute-time events; recreating the
   * synth voices is the reliable flush path (samples stay in shared memory).
   */
  flushPendingAudio() {
    this.scheduleGeneration += 1
    const now = Tone.now()

    if (this.metronome) {
      this.metronome.releaseAll?.(now)
      this.metronome.dispose()
      this.metronome = createMetronomeVoice(Tone)
      this.metronome.toDestination()
      this.applyMetronomeLevel()
    }

    if (this.voice) {
      this.voice.releaseAll(now)
      this.rebuildPlaybackVoice()
    }
  }

  rebuildPlaybackVoice() {
    if (!this.voice || !this.createPianoInstrument || !this.output) {
      return
    }
    this.voice.dispose()
    this.voice = this.createPianoInstrument({
      tone: Tone,
      onStatus: (status) => this.handleInstrumentStatus(status),
    })
    this.voice.output.connect(this.output)
    this.syncOutputMute()
  }

  releaseAll() {
    this.flushPendingAudio()
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

    if (
      this.metronomeCountIn > METRONOME_COUNT_IN.OFF
    ) {
      this.startCountInThenPlayback()
      return
    }

    this.beginScorePlayback()
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
    this.cancelCountIn()
    this.stopProgressLoop()
    this.stopScheduleLoop()
    this.releaseAll()
    this.scheduledEvents.clear()
    if (resetOffset) {
      this.offsetScoreSeconds = 0
      this.scheduledUntilScore = 0
    }
    this.emitMetronomeDisplay()
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
    const generation = this.scheduleGeneration
    const tick = () => {
      if (this.scheduleGeneration !== generation) {
        return
      }
      let time = this.getCurrentScoreTime()
      if (this.duration > 0 && time >= this.duration) {
        time = this.duration
        this.offsetScoreSeconds = this.duration
        this.stopInternal(false)
        this.emitTimeUpdate(time)
        this.emitMetronomeDisplay()
        return
      }
      this.emitTimeUpdate(time)
      this.emitMetronomeDisplay()
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
