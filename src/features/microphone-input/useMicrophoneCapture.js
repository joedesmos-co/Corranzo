import { useCallback, useEffect, useRef, useState } from 'react'
import { setupAudioVisibilityResume } from '../audio/audioLifecycle.js'
import { isMicrophoneSupported } from './micEnvironment.js'
import { MIC_PERMISSION, MIC_SUPPORT } from './micInputConstants.js'

/**
 * Keep enough recent time-domain history for deep-piano-bass scoring. The live
 * detector still derives level, attack, and high/middle pitch features from
 * the latest 2,048 samples, so this does not lengthen every register's window.
 */
export const MIC_CAPTURE_ANALYSER_FFT_SIZE = 8192

function stopStream(stream) {
  if (!stream) {
    return
  }
  stream.getTracks().forEach((track) => {
    track.stop()
  })
}

function createAudioContext() {
  const AudioContextConstructor = globalThis.AudioContext ?? globalThis.webkitAudioContext
  if (!AudioContextConstructor) {
    throw new Error('AudioContext is not available in this browser.')
  }
  return new AudioContextConstructor()
}

/**
 * Observe browser-owned microphone resources for interruption. Returns an
 * idempotent cleanup so restart/disable never accumulates duplicate listeners.
 */
export function attachCaptureRecoveryListeners({
  stream,
  context,
  mediaDevices,
  onInterrupted,
} = {}) {
  const track = stream?.getAudioTracks?.()[0] ?? null
  let disposed = false
  const cleanups = []

  const cleanup = () => {
    if (disposed) return
    disposed = true
    for (const remove of cleanups.splice(0)) {
      remove()
    }
  }

  const interrupt = (reason) => {
    if (disposed) return
    cleanup()
    onInterrupted?.(reason)
  }

  const listen = (target, type, handler) => {
    if (!target?.addEventListener) return
    target.addEventListener(type, handler)
    cleanups.push(() => target.removeEventListener?.(type, handler))
  }

  listen(track, 'ended', () => interrupt('stream-ended'))
  listen(context, 'statechange', () => {
    if (context?.state === 'closed') {
      interrupt('audio-context-closed')
      return
    }
    if (context?.state === 'suspended' || context?.state === 'interrupted') {
      if (globalThis.document?.visibilityState === 'hidden') {
        return
      }
      Promise.resolve(context.resume?.()).catch(() => interrupt('audio-context-resume-failed'))
    }
  })
  listen(mediaDevices, 'devicechange', () => {
    if (!track || track.readyState === 'ended') {
      interrupt('input-device-changed')
    }
  })

  return cleanup
}

/**
 * Instrument input is NOT speech. Chrome's default getUserMedia turns on
 * echoCancellation / noiseSuppression / autoGainControl, all tuned for voice:
 * the noise suppressor treats sustained musical tones as background noise and
 * attenuates them, and AGC pumps steady notes — so a clearly-audible piano or
 * guitar arrives at the AnalyserNode as tiny RMS and the gate reads "too quiet".
 * We ask for raw input like a tuner/DAW would. These are advisory (not `exact`)
 * so a browser that can't honour them simply ignores the hint.
 */
export const INSTRUMENT_AUDIO_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
}

/**
 * Acquire a raw-input instrument stream, falling back to default constraints if
 * (and only if) the browser rejects the raw-input hint. Permission / device
 * errors propagate unchanged so the caller can surface the right message.
 */
export async function acquireInstrumentStream(mediaDevices) {
  try {
    return await mediaDevices.getUserMedia({
      audio: { ...INSTRUMENT_AUDIO_CONSTRAINTS },
      video: false,
    })
  } catch (error) {
    const name = error?.name
    if (
      name === 'NotAllowedError' ||
      name === 'NotFoundError' ||
      name === 'SecurityError' ||
      name === 'NotReadableError'
    ) {
      throw error
    }
    // OverconstrainedError / TypeError from an unsupported constraint shape:
    // retry with plain defaults so the user still gets a working microphone.
    return await mediaDevices.getUserMedia({ audio: true, video: false })
  }
}

/** Read the constraints the browser actually applied (for diagnostics). */
export function readCaptureSettings(stream) {
  const track = stream?.getAudioTracks?.()[0] ?? null
  const settings = track?.getSettings?.() ?? {}
  return {
    echoCancellation: settings.echoCancellation ?? null,
    noiseSuppression: settings.noiseSuppression ?? null,
    autoGainControl: settings.autoGainControl ?? null,
    sampleRate: settings.sampleRate ?? null,
    channelCount: settings.channelCount ?? null,
    deviceId: settings.deviceId ?? null,
  }
}

export default function useMicrophoneCapture({ active = false } = {}) {
  const streamRef = useRef(null)
  const contextRef = useRef(null)
  const analyserRef = useRef(null)
  const bufferRef = useRef(null)
  const activeRef = useRef(active)
  const requestTokenRef = useRef(0)
  const recoveryCleanupRef = useRef(null)
  const recoveryHandlerRef = useRef(null)
  const requestAccessRef = useRef(null)

  const support = isMicrophoneSupported()
    ? MIC_SUPPORT.SUPPORTED
    : MIC_SUPPORT.UNSUPPORTED

  const [permission, setPermission] = useState(
    support === MIC_SUPPORT.SUPPORTED ? MIC_PERMISSION.PROMPT : MIC_PERMISSION.UNSUPPORTED,
  )
  const [errorMessage, setErrorMessage] = useState(null)
  const [isListening, setIsListening] = useState(false)
  const [sampleRate, setSampleRate] = useState(44100)
  const [captureSettings, setCaptureSettings] = useState(null)

  const closeCurrentCapture = useCallback(() => {
    recoveryCleanupRef.current?.()
    recoveryCleanupRef.current = null
    stopStream(streamRef.current)
    streamRef.current = null
    analyserRef.current = null
    bufferRef.current = null

    const context = contextRef.current
    contextRef.current = null
    if (context && context.state !== 'closed') {
      context.close().catch(() => {})
    }

    setIsListening(false)
    setSampleRate(44100)
    setCaptureSettings(null)
  }, [])

  const teardown = useCallback(() => {
    requestTokenRef.current += 1
    closeCurrentCapture()
  }, [closeCurrentCapture])

  const recoverInterruptedCapture = useCallback(
    (reason) => {
      if (!activeRef.current) return
      requestTokenRef.current += 1
      closeCurrentCapture()
      setErrorMessage('Microphone input was interrupted. Reconnecting…')
      queueMicrotask(() => {
        if (activeRef.current) {
          requestAccessRef.current?.({ recoveryReason: reason })
        }
      })
    },
    [closeCurrentCapture],
  )
  useEffect(() => {
    recoveryHandlerRef.current = recoverInterruptedCapture

    return () => {
      if (recoveryHandlerRef.current === recoverInterruptedCapture) {
        recoveryHandlerRef.current = null
      }
    }
  }, [recoverInterruptedCapture])

  const requestAccess = useCallback(async () => {
    if (support !== MIC_SUPPORT.SUPPORTED) {
      return false
    }

    const requestToken = requestTokenRef.current + 1
    requestTokenRef.current = requestToken

    setErrorMessage(null)
    closeCurrentCapture()

    let stream = null
    let context = null

    try {
      stream = await acquireInstrumentStream(navigator.mediaDevices)

      if (requestTokenRef.current !== requestToken || !activeRef.current) {
        stopStream(stream)
        return false
      }

      context = createAudioContext()
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = MIC_CAPTURE_ANALYSER_FFT_SIZE
      analyser.smoothingTimeConstant = 0.85
      source.connect(analyser)

      if (context.state === 'suspended') {
        await context.resume()
      }

      if (requestTokenRef.current !== requestToken || !activeRef.current) {
        stopStream(stream)
        if (context.state !== 'closed') {
          context.close().catch(() => {})
        }
        return false
      }

      streamRef.current = stream
      contextRef.current = context
      analyserRef.current = analyser
      bufferRef.current = new Float32Array(analyser.fftSize)
      recoveryCleanupRef.current = attachCaptureRecoveryListeners({
        stream,
        context,
        mediaDevices: navigator.mediaDevices,
        onInterrupted: (reason) => recoveryHandlerRef.current?.(reason),
      })

      setPermission(MIC_PERMISSION.GRANTED)
      setIsListening(true)
      setSampleRate(context.sampleRate)
      setCaptureSettings(readCaptureSettings(stream))
      return true
    } catch (error) {
      stopStream(stream)
      if (context && context.state !== 'closed') {
        context.close().catch(() => {})
      }
      if (requestTokenRef.current !== requestToken) {
        return false
      }
      const message = error instanceof Error ? error.message : 'Microphone access failed'
      if (error?.name === 'NotAllowedError' || message.toLowerCase().includes('denied')) {
        setPermission(MIC_PERMISSION.DENIED)
      } else if (error?.name === 'NotFoundError') {
        setPermission(MIC_PERMISSION.ERROR)
        setErrorMessage('No microphone found on this device.')
      } else {
        setPermission(MIC_PERMISSION.ERROR)
        setErrorMessage(message)
      }
      return false
    }
  }, [support, closeCurrentCapture])
  useEffect(() => {
    requestAccessRef.current = requestAccess

    return () => {
      if (requestAccessRef.current === requestAccess) {
        requestAccessRef.current = null
      }
    }
  }, [requestAccess])

  const disable = useCallback(() => {
    teardown()
    if (support === MIC_SUPPORT.SUPPORTED) {
      setPermission(MIC_PERMISSION.PROMPT)
    }
    setErrorMessage(null)
  }, [support, teardown])

  useEffect(() => {
    activeRef.current = active
    if (!active) {
      const teardownTimer = globalThis.setTimeout(teardown, 0)
      return () => globalThis.clearTimeout(teardownTimer)
    }
    return undefined
  }, [active, teardown])

  useEffect(() => () => teardown(), [teardown])

  useEffect(() => {
    return setupAudioVisibilityResume(() => {
      const context = contextRef.current
      return context ? [context] : []
    })
  }, [])

  return {
    support,
    permission,
    errorMessage,
    isGranted: permission === MIC_PERMISSION.GRANTED,
    isListening: isListening && active,
    requestAccess,
    disable,
    analyser: analyserRef,
    audioContext: contextRef,
    getTimeDomainBuffer: () => bufferRef.current,
    sampleRate,
    captureSettings,
  }
}
