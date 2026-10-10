/**
 * A9 — useAudioArrangement hook. Browser stages injected at call time:
 * decode via Web Audio, prediction via lazily-loaded Basic Pitch (fallback: null → spectral).
 */
import { useCallback, useRef, useState } from 'react'
import { runAudioArrangementPipeline } from './audioArrangementPipeline.js'
import { PART_INSTRUMENTS, DIFFICULTIES } from './arrangementModel.js'

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

async function predictWithBasicPitch(samples) {
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

  const cancel = useCallback(() => {
    cancelledRef.current = true
    setPhase('idle')
    setProgress(null)
  }, [])

  // Phase 7: decode once on file select to learn the true duration (drives
  // the excerpt selector) and reuse the PCM at arrange time (no double decode).
  const probeFile = useCallback(async (file) => {
    setProbe(null)
    decodedRef.current = null
    bufferRef.current = null
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

  const arrange = useCallback(async (file, { targetPart, difficulty, excerpt = null }) => {
    cancelledRef.current = false
    setError(null)
    setResult(null)
    setPhase('validating')
    setProgress({ stage: 'validate', fraction: 0 })
    try {
      const arrayBuffer = bufferRef.current ?? await file.arrayBuffer()
      bufferRef.current = arrayBuffer
      const cachedDecode = decodedRef.current
      if (cancelledRef.current) return null
      setPhase('analyzing')
      const outcome = await runAudioArrangementPipeline(
        file,
        arrayBuffer,
        { targetPart, difficulty, title: file?.name?.replace(/\.[^.]+$/, '') ?? 'Audio Arrangement', excerpt },
        {
          decodeAudioDataImpl: cachedDecode ? (async () => cachedDecode) : decodeWithWebAudio,
          predictNotes: predictWithBasicPitch,
          onProgress: ({ stage, fraction }) => {
            if (!cancelledRef.current) setProgress({ stage, fraction })
          },
        },
      )
      if (cancelledRef.current) return null
      if (!outcome.ok) {
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
    }
    onReady?.(payload)
    return payload
  }, [result, onReady])

  return {
    phase,
    progress,
    result,
    error,
    probe,
    probeFile,
    arrange,
    cancel,
    openInPractice,
    reset: () => {
      cancelledRef.current = true
      setPhase('idle')
      setProgress(null)
      setResult(null)
      setError(null)
      setProbe(null)
      decodedRef.current = null
      bufferRef.current = null
    },
    targets: [PART_INSTRUMENTS.SOLO_PIANO, PART_INSTRUMENTS.SOLO_GUITAR],
    difficulties: [DIFFICULTIES.EASY, DIFFICULTIES.INTERMEDIATE, DIFFICULTIES.ADVANCED],
  }
}
