import { useCallback, useEffect, useRef, useState } from 'react'
import { setupAudioVisibilityResume } from '../audio/audioLifecycle.js'
import { isMicrophoneSupported } from './micEnvironment.js'
import { MIC_PERMISSION, MIC_SUPPORT } from './micInputConstants.js'

function stopStream(stream) {
  if (!stream) {
    return
  }
  stream.getTracks().forEach((track) => {
    track.stop()
  })
}

export default function useMicrophoneCapture({ active = false } = {}) {
  const streamRef = useRef(null)
  const contextRef = useRef(null)
  const analyserRef = useRef(null)
  const bufferRef = useRef(null)

  const support = isMicrophoneSupported()
    ? MIC_SUPPORT.SUPPORTED
    : MIC_SUPPORT.UNSUPPORTED

  const [permission, setPermission] = useState(
    support === MIC_SUPPORT.SUPPORTED ? MIC_PERMISSION.PROMPT : MIC_PERMISSION.UNSUPPORTED,
  )
  const [errorMessage, setErrorMessage] = useState(null)
  const [isListening, setIsListening] = useState(false)

  const teardown = useCallback(() => {
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
  }, [])

  const requestAccess = useCallback(async () => {
    if (support !== MIC_SUPPORT.SUPPORTED) {
      return false
    }

    setErrorMessage(null)
    teardown()

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })

      const context = new AudioContext()
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.85
      source.connect(analyser)

      streamRef.current = stream
      contextRef.current = context
      analyserRef.current = analyser
      bufferRef.current = new Float32Array(analyser.fftSize)

      if (context.state === 'suspended') {
        await context.resume()
      }

      setPermission(MIC_PERMISSION.GRANTED)
      setIsListening(true)
      return true
    } catch (error) {
      teardown()
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
  }, [support, teardown])

  const disable = useCallback(() => {
    teardown()
    if (support === MIC_SUPPORT.SUPPORTED) {
      setPermission(MIC_PERMISSION.PROMPT)
    }
    setErrorMessage(null)
  }, [support, teardown])

  useEffect(() => {
    if (!active) {
      teardown()
    }
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
    sampleRate: contextRef.current?.sampleRate ?? 44100,
  }
}
