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
import { isFiniteMidi, sanitizePlaybackDurationSeconds } from './sanitizePlaybackNote.js'
import { mapPlaybackVelocity } from './pianoVelocity.js'
import { createInstrumentVoiceResolver } from './instrumentVoiceResolver.js'
import { DEFAULT_INSTRUMENT_ID } from '../instruments/instruments.js'
import { PLAY_READY_TIMEOUT_MS } from './playbackAudioConfig.js'
import { INSTRUMENT_STATUS } from './instrumentVoiceStatus.js'

const LOOKAHEAD_SECONDS = 2.5
const SCHEDULE_TICK_MS = 200
const loadPianoInstrumentModule = () => import('./pianoInstrument.js')
const DEFAULT_LOADERS = { loadPianoInstrument: loadPianoInstrumentModule }

const MIDI_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function duckOutputGain(gain, now) {
  if (!gain?.cancelScheduledValues || !gain?.setValueAtTime || !gain?.linearRampToValueAtTime) {
    return
  }
  gain.cancelScheduledValues(now)
  gain.setValueAtTime(gain.value, now)
  gain.linearRampToValueAtTime(0, now + 0.035)
}

function restoreOutputGain(gain, now, target) {
  if (!gain?.setValueAtTime || !gain?.linearRampToValueAtTime) {
    return
  }
  const restoreAt = now + 0.04
  gain.setValueAtTime(0, restoreAt)
  gain.linearRampToValueAtTime(target, restoreAt + 0.04)
}

function midiNumberToName(midi) {
  if (!isFiniteMidi(midi)) {
    return null
  }
  const octave = Math.floor(midi / 12) - 1
  return `${MIDI_NAMES[((midi % 12) + 12) % 12]}${octave}`
}

// Map a 0–1 MIDI/score velocity to an expressive-but-not-harsh gain.
function softenVelocity(velocity) {
  return mapPlaybackVelocity(velocity)
}

function metronomeDisplayStatesEqual(previous, next) {
  if (!previous || !next) {
    return false
  }
  return (
    previous.phase === next.phase &&
    previous.beat === next.beat &&
    previous.measureNumber === next.measureNumber &&
    previous.accent === next.accent &&
    previous.countInActive === next.countInActive &&
    previous.countInProgress === next.countInProgress
  )
}

/**
 * Windowed playback engine driven by the performed score timeline.
 */
export class ScorePlaybackEngine {
  constructor({ loadPianoInstrument = DEFAULT_LOADERS.loadPianoInstrument } = {}) {
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
    this.mergedScheduleEvents = []
    this.scheduleEventIndex = 0
    this.mutedTrackIds = new Set()
    this.appliedMetronomeLevel = null
    /** Bumped on seek/pause/stop so stale interval callbacks never reschedule. */
    this.scheduleGeneration = 0
    this.onInstrumentStatus = null
    this.instrumentStatus = null
    this.loadPianoInstrument = loadPianoInstrument
    // Voice factories are resolved per instrument through the shared resolver;
    // the piano slot honours the legacy `loadPianoInstrument` test seam above.
    this.voiceResolver = createInstrumentVoiceResolver({
      legacyPianoModuleLoader: () => this.loadPianoInstrument(),
    })
    /** Instrument the current `this.voice` was created for. */
    this.voiceInstrumentId = null
    this.voiceLoadPromise = null
  }

  /** Instrument for the loaded piece (default piano). */
  get instrumentId() {
    return this.voiceResolver.instrumentId
  }

  /**
   * Legacy test seam: `engine.createPianoInstrument = factory` injects the
   * piano voice factory directly (bypassing module load), exactly as before.
   */
  get createPianoInstrument() {
    return this.voiceResolver.getFactory(DEFAULT_INSTRUMENT_ID)
  }

  set createPianoInstrument(factory) {
    this.voiceResolver.setFactory(DEFAULT_INSTRUMENT_ID, factory)
  }

  /**
   * Switch the playback instrument. Disposes the current voice so the next
   * play creates the right one; transport state is otherwise untouched.
   */
  setInstrumentId(instrumentId) {
    const changed = this.voiceResolver.setInstrumentId(instrumentId)
    if (changed) {
      if (this.voice) {
        this.disposeVoices()
      }
      this.handleInstrumentStatus(INSTRUMENT_STATUS.LOADING)
    }
    return changed
  }

  async ensureVoices() {
    if (
      this.voice &&
      this.voiceInstrumentId != null &&
      this.voiceInstrumentId !== this.voiceResolver.instrumentId
    ) {
      this.disposeVoices()
    }
    if (this.voice) {
      return
    }
    if (!this.voiceLoadPromise) {
      this.voiceLoadPromise = Promise.resolve()
        .then(async () => {
          const instrumentId = this.voiceResolver.instrumentId
          const createVoice = await this.voiceResolver.ensureFactory(instrumentId)
          if (!this.voice && createVoice) {
            this.output = new Tone.Gain(1).toDestination()
            // The instrument module and samples are first requested here, after
            // the Play/Test Sound gesture has already unlocked Web Audio.
            this.voice = createVoice({
              tone: Tone,
              onStatus: (status) => this.handleInstrumentStatus(status),
            })
            this.voiceInstrumentId = instrumentId
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
   * Fetch/decode the current instrument's samples ahead of Play without wiring
   * the audio graph. Safe before user gesture — suspended contexts still fetch
   * and decode buffers.
   */
  async preload() {
    try {
      await this.voiceResolver.preload(Tone)
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
      this.voiceInstrumentId = null
    }
    if (this.metronome) {
      this.metronome.dispose()
      this.metronome = null
    }
  }

  async load({
    timingMap,
    midiArrayBuffer = null,
    alignmentDiagnostics = null,
    instrumentId = null,
  }) {
    const loadToken = ++this.loadToken
    this.stopInternal()
    if (instrumentId != null) {
      this.setInstrumentId(instrumentId)
    }

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
    this.syncMutedTrackCache()
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
      this.rebuildScheduleEvents()
      return
    }
    this.metronomeEvents = buildMetronomeSchedule(this.timingMap, {
      subdivision: this.metronomeSubdivision,
    })
    this.rebuildScheduleEvents()
  }

  rebuildScheduleEvents() {
    if (!this.metronomeEvents.length) {
      this.mergedScheduleEvents = this.noteEvents
    } else {
      this.mergedScheduleEvents = [...this.noteEvents, ...this.metronomeEvents]
      this.mergedScheduleEvents.sort(
        (left, right) => (left.scoreTimeSeconds ?? 0) - (right.scoreTimeSeconds ?? 0),
      )
    }
    this.resetScheduleEventIndex(this.offsetScoreSeconds)
  }

  resetScheduleEventIndex(scoreSeconds) {
    const events = this.mergedScheduleEvents
    let index = 0
    while (index < events.length) {
      const event = events[index]
      const eventStart = event.type === 'note'
        ? alignChordScoreTime(event.scoreTimeSeconds)
        : event.scoreTimeSeconds
      if (eventStart >= scoreSeconds - 1e-6) {
        break
      }
      const eventEnd = event.type === 'note'
        ? eventStart + (event.baseDurationSeconds ?? 0.03)
        : eventStart
      if (eventEnd > scoreSeconds) {
        break
      }
      index += 1
    }
    this.scheduleEventIndex = index
  }

  syncMutedTrackCache() {
    this.mutedTrackIds = new Set(
      this.tracks.filter((track) => track.muted).map((track) => track.id),
    )
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
    if (metronomeDisplayStatesEqual(this.metronomeDisplayState, next)) {
      return
    }
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
    this.resetScheduleEventIndex(this.offsetScoreSeconds)
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
    if (this.appliedMetronomeLevel !== this.metronomeLevel) {
      this.appliedMetronomeLevel = this.metronomeLevel
      this.applyMetronomeLevel()
    }

    const useMetronome = this.metronomeEnabled && !this.countInActive
    const events = useMetronome ? this.mergedScheduleEvents : this.noteEvents

    for (let index = this.scheduleEventIndex; index < events.length; index += 1) {
      const event = events[index]
      if (event.type === 'note') {
        const alignedStart = alignChordScoreTime(event.scoreTimeSeconds)
        const baseDuration = event.baseDurationSeconds ?? 0.03
        const noteEnd = alignedStart + baseDuration
        if (alignedStart >= toScoreSeconds) {
          this.scheduleEventIndex = index
          break
        }
        if (noteEnd <= fromScoreSeconds || alignedStart >= toScoreSeconds) {
          continue
        }

        if (this.scheduledEvents.has(event)) {
          continue
        }

        if (this.isTrackMuted(event.trackId)) {
          continue
        }

        const wallAt = this.wallTimeForScoreTime(alignedStart)
        const delay = wallAt - now
        let at = Math.max(now, wallAt)
        let duration = baseDuration / this.playbackRate

        if (alignedStart < fromScoreSeconds - 1e-6) {
          at = now
          duration = Math.max(0.03, (noteEnd - fromScoreSeconds) / this.playbackRate)
        } else if (delay < -0.05) {
          continue
        }

        const name = event.name ?? midiNumberToName(event.midi)
        if (!name) {
          continue
        }
        const velocity = softenVelocity(event.velocity ?? 0.75)
        duration = sanitizePlaybackDurationSeconds(duration)
        this.voice.triggerAttackRelease(name, duration, at, velocity)
        this.scheduledEvents.add(event)
        continue
      }

      if (event.scoreTimeSeconds < fromScoreSeconds || event.scoreTimeSeconds >= toScoreSeconds) {
        if (event.scoreTimeSeconds >= toScoreSeconds) {
          this.scheduleEventIndex = index
          break
        }
        continue
      }

      if (this.scheduledEvents.has(event)) {
        continue
      }

      const scoreTime = event.scoreTimeSeconds
      const wallAt = this.wallTimeForScoreTime(scoreTime)
      const delay = wallAt - now
      if (delay < -0.05) {
        continue
      }

      const at = Math.max(now, wallAt)

      if (event.type === 'metronome') {
        this.metronome.triggerClick(event.accent, at)
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
    this.resetScheduleEventIndex(this.offsetScoreSeconds)
    if (wasPlaying) {
      this.beginScorePlayback()
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
      if (this.output?.gain) {
        duckOutputGain(this.output.gain, now)
      }
      this.rebuildPlaybackVoice()
      if (this.output?.gain) {
        const target = this.tracks.some((item) => !item.muted) || this.tracks.length === 0 ? 1 : 0
        restoreOutputGain(this.output.gain, now, target)
      }
    }
  }

  rebuildPlaybackVoice() {
    const instrumentId = this.voiceInstrumentId ?? this.voiceResolver.instrumentId
    const createVoice = this.voiceResolver.getFactory(instrumentId)
    if (!this.voice || !createVoice || !this.output) {
      return
    }
    this.voice.dispose()
    this.voice = createVoice({
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

    if (this.duration > 0 && this.offsetScoreSeconds >= this.duration - 1e-3) {
      this.offsetScoreSeconds = 0
      this.scheduledUntilScore = 0
    }

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

    this.cancelCountIn()
    this.stopProgressLoop()
    this.stopScheduleLoop()
    this.flushPendingAudio()
    this.scheduledEvents.clear()

    this.offsetScoreSeconds = clamped
    this.scheduledUntilScore = clamped
    this.resetScheduleEventIndex(clamped)

    if (wasPlaying) {
      this.beginScorePlayback()
    } else {
      this.playing = false
      this.emitMetronomeDisplay()
    }

    this.emitTimeUpdate(this.getCurrentScoreTime())
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
      this.resetScheduleEventIndex(0)
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
    this.syncMutedTrackCache()
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
