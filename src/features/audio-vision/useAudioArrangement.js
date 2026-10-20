/**
 * A9 — useAudioArrangement hook. Browser stages injected at call time:
 * decode via Web Audio, prediction via lazily-loaded Basic Pitch (fallback: null → spectral).
 */
import { useCallback, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { runAudioArrangementPipeline } from './audioArrangementPipeline.js'
import { PART_INSTRUMENTS, DIFFICULTIES } from './arrangementModel.js'
import { getAudioFingerprint, loadTempoCorrection, saveTempoCorrection } from './tempoCorrectionStorage.js'

export const AUDIO_ARRANGEMENT_SOURCE = 'audio-arrangement'

async function decodeWithWebAudio(arrayBuffer) {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) throw new Error('decoder-unavailable')
  const ctx = new Ctx()
  try {
    const copy = arrayBuffer.slice(0)
    const audioBuffer = await ctx.decodeAudioData(copy)
    const channels = []
    for (let c = 0; c < audioBuffer.numberOfChannels; c += 1) {
      channels.push(Float32Array.from(audioBuffer.getChannelData(c)))
    }
    return {
      channelData: channels,
      sampleRate: audioBuffer.sampleRate,
      durationSeconds: audioBuffer.duration,
      channelCount: audioBuffer.numberOfChannels,
    }
  } finally {
    try { await ctx.close() } catch { /* noop */ }
  }
}

/**
 * Transcribe with Basic Pitch.
 *
 * The worker path is preferred: it keeps the main thread free, so the progress
 * panel paints and the interface stays interactive while the model runs. If the
 * worker cannot be used, the same model runs inline (same notes, less
 * responsive interface). If the model cannot be used at all, the pipeline
 * falls back to its spectral estimator — the arrangement is never invented
 * from a failed inference.
 */
async function predictWithBasicPitch(samples, onNoteProgress = null) {
  try {
    const { inferNotesInWorker } = await import('./audioVisionPitchClient.js')
    const events = await inferNotesInWorker(samples, { onProgress: onNoteProgress })
    return (events ?? []).map((e) => ({
      midi: e.midi,
      startSeconds: e.startOffsetSeconds,
      endSeconds: e.endOffsetSeconds,
    }))
  } catch {
    // Fall through to the inline path.
  }
  try {
    const [{ loadNeuralRuntime, runNeuralWindow }] = await Promise.all([
      import('../microphone-input/micNeuralTfAdapter.js'),
    ])
    const runtime = await loadNeuralRuntime({ modelJsonUrl: 'neural-model/model.json' })
    const { BasicPitch } = runtime
    void BasicPitch
    const modelModule = await import('@spotify/basic-pitch')
    const events = await runNeuralWindow(runtime, modelModule, samples)
    const rate = 22050
    void rate
    return (events ?? []).map((e) => ({
      midi: e.midi,
      startSeconds: e.startOffsetSeconds,
      endSeconds: e.endOffsetSeconds,
    }))
  } catch {
    return null
  }
}

export function useAudioArrangement({ onReady = null } = {}) {
  const [phase, setPhase] = useState('idle') // idle|validating|analyzing|arranging|review|error|refused
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [probe, setProbe] = useState(null) // { durationSeconds } after decode-on-select
  const cancelledRef = useRef(false)
  const decodedRef = useRef(null) // cached Web Audio decode: { channelData, sampleRate, ... }
  const bufferRef = useRef(null)
  const fingerprintRef = useRef(null)
  const rememberedRef = useRef(null)
  const [rememberedTempo, setRememberedTempo] = useState(null)

  const cancel = useCallback(() => {
    cancelledRef.current = true
    setPhase('idle')
    setProgress(null)
  }, [])

  /** Persist a reviewer-approved tempo for the current recording. */
  const rememberTempoCorrection = useCallback((value) => {
    const fingerprint = fingerprintRef.current
    if (!fingerprint) return
    saveTempoCorrection(fingerprint, value)
    const rounded = Math.round(value)
    rememberedRef.current = rounded
    setRememberedTempo({ bpm: rounded, updatedAt: Date.now() })
  }, [])

  // Phase 7: decode once on file select to learn the true duration (drives
  // the excerpt selector) and reuse the PCM at arrange time (no double decode).
  const probeFile = useCallback(async (file) => {
    cancelledRef.current = false // new user-initiated operation, not a cancel
    setProbe(null)
    decodedRef.current = null
    bufferRef.current = null
    rememberedRef.current = null
    setRememberedTempo(null)
    fingerprintRef.current = getAudioFingerprint(file)
    // PRIORITY 3: recover a previously approved correction for THIS recording.
    const remembered = loadTempoCorrection(fingerprintRef.current)
    if (remembered) {
      rememberedRef.current = remembered.bpm
      setRememberedTempo(remembered)
    }
    if (!file) return null
    try {
      const arrayBuffer = await file.arrayBuffer()
      bufferRef.current = arrayBuffer
      const decoded = await decodeWithWebAudio(arrayBuffer)
      if (cancelledRef.current) return null
      decodedRef.current = decoded
      const durationSeconds = decoded.durationSeconds
        ?? decoded.channelData?.[0]?.length / decoded.sampleRate
      const info = { durationSeconds: Math.round(durationSeconds * 10) / 10 }
      setProbe(info)
      return info
    } catch {
      setProbe({ durationSeconds: null, error: true })
      return null
    }
  }, [])

  const arrange = useCallback(async (file, { targetPart, difficulty, excerpt = null, tempoOverride = null }) => {
    cancelledRef.current = false
    // Flush the first state update synchronously so the progress panel is in the
    // DOM before any heavy work starts. Without this the browser can paint the
    // old frame for hundreds of milliseconds and the button looks dead.
    flushSync(() => {
      setError(null)
      setResult(null)
      setPhase('validating')
      setProgress({ stage: 'validate', fraction: 0 })
    })
    try {
      const arrayBuffer = bufferRef.current ?? await file.arrayBuffer()
      bufferRef.current = arrayBuffer
      const cachedDecode = decodedRef.current
      // PRIORITY 3: fall back to a remembered correction for this recording
      // unless the caller is explicitly overriding it.
      const effectiveTempoOverride = tempoOverride != null
        ? tempoOverride
        : rememberedRef.current
      if (cancelledRef.current) return null
      setPhase('analyzing')
      const outcome = await runAudioArrangementPipeline(
        file,
        arrayBuffer,
        { targetPart, difficulty, title: file?.name?.replace(/\.[^.]+$/, '') ?? 'Audio Arrangement', excerpt, tempoOverride: effectiveTempoOverride },
        {
          decodeAudioDataImpl: cachedDecode ? (async () => cachedDecode) : decodeWithWebAudio,
          predictNotes: predictWithBasicPitch,
          isCancelled: () => cancelledRef.current,
          onProgress: ({ stage, fraction }) => {
            if (!cancelledRef.current) setProgress({ stage, fraction })
          },
        },
      )
      if (cancelledRef.current) return null
      if (!outcome.ok) {
        if (outcome.code === 'cancelled') {
          setPhase('idle')
          setProgress(null)
          return null
        }
        if (outcome.code === 'low-confidence' || outcome.code === 'empty-audio') {
          setPhase('refused')
        } else {
          setPhase('error')
        }
        setError({ code: outcome.code, message: outcome.message })
        setResult(outcome)
        return outcome
      }
      setPhase('review')
      setProgress(null)
      setResult(outcome)
      return outcome
    } catch (err) {
      if (!cancelledRef.current) {
        setPhase('error')
        setError({ code: 'unexpected', message: `Something went wrong while analyzing that recording. ${String(err?.message ?? err)}` })
      }
      return null
    }
  }, [])

  const openInPractice = useCallback(() => {
    if (!result?.ok || !result?.musicXml) return null
    const payload = {
      fileName: `${result.model.targetPart}-arrangement.musicxml`,
      musicXmlString: result.musicXml,
      targetPart: result.model.targetPart,
      difficulty: result.model.difficulty,
      confidence: result.confidence,
      warnings: result.model.parts[0]?.warnings ?? [],
      partial: result.partial,
      excerpt: result.excerpt ?? null,
      uncertainRegions: result.uncertainRegions ?? [],
      transcriptionAgreement: result.transcriptionAgreement ?? null,
    }
    onReady?.(payload)
    return payload
  }, [result, onReady])

  // M3: re-run with a corrected tempo, reusing the already decoded audio (no
  // re-upload). The last successful options are remembered so the reviewer only
  // needs to supply the tempo. An approved correction is persisted per
  // recording fingerprint (PRIORITY 3).
  const lastOptionsRef = useRef(null)
  // Split into a pure lookup + an effect so no ref written inside a callback is
  // later handed to another hook as an argument.
  const lastArrangeOptions = useCallback(() => lastOptionsRef.current, [])
  const arrangeWithTempo = useCallback(async (tempo) => {
    const previous = lastArrangeOptions()
    if (!previous) return null
    const value = Number(tempo)
    if (!Number.isFinite(value) || value <= 0) return null
    rememberTempoCorrection(value)
    return arrange(previous.file, { ...previous.options, tempoOverride: value })
  }, [arrange, lastArrangeOptions, rememberTempoCorrection])

  const arrangeRemembering = useCallback(async (file, options) => {
    lastOptionsRef.current = { file, options }
    return arrange(file, options)
  }, [arrange])

  return {
    phase,
    progress,
    result,
    error,
    probe,
    probeFile,
    rememberedTempo,
    arrange: arrangeRemembering,
    arrangeWithTempo,
    cancel,
    openInPractice,
    reset: () => {
      cancelledRef.current = true
      setPhase('idle')
      setProgress(null)
      setResult(null)
      setError(null)
      setProbe(null)
      setRememberedTempo(null)
      decodedRef.current = null
      bufferRef.current = null
      rememberedRef.current = null
      fingerprintRef.current = null
    },
    targets: [PART_INSTRUMENTS.SOLO_PIANO, PART_INSTRUMENTS.SOLO_GUITAR],
    difficulties: [DIFFICULTIES.EASY, DIFFICULTIES.INTERMEDIATE, DIFFICULTIES.ADVANCED],
  }
}
