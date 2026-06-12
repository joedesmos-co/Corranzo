import { useEffect, useRef } from 'react'
import { createNoteStabilizer, pushStableNote, resetNoteStabilizer } from './noteStabilizer.js'
import { analyzeMicFrame, createMicFrameAnalyzer } from './micFrameAnalysis.js'

const UI_FRAME_INTERVAL = 3

/**
 * Poll AnalyserNode: live frame feedback + stable MIDI note-ons.
 */
export default function usePitchDetector({
  enabled,
  analyserRef,
  getTimeDomainBuffer,
  sampleRate,
  onFrame,
  onStableMidi,
}) {
  const stabilizerRef = useRef(createNoteStabilizer())
  const analyzerRef = useRef(createMicFrameAnalyzer())
  const rafRef = useRef(null)
  const uiFrameSkipRef = useRef(0)

  useEffect(() => {
    resetNoteStabilizer(stabilizerRef.current)
    analyzerRef.current = createMicFrameAnalyzer()
  }, [enabled, onStableMidi])

  useEffect(() => {
    if (!enabled) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      return undefined
    }

    const tick = () => {
      const analyser = analyserRef?.current
      const buffer = getTimeDomainBuffer?.()
      if (analyser && buffer?.length) {
        analyser.getFloatTimeDomainData(buffer)
        const frame = analyzeMicFrame(buffer, sampleRate, analyzerRef.current.noiseFloor)
        if (frame) {
          uiFrameSkipRef.current += 1
          if (onFrame && uiFrameSkipRef.current >= UI_FRAME_INTERVAL) {
            uiFrameSkipRef.current = 0
            onFrame(frame)
          }

          if (onStableMidi) {
            const stableMidi = pushStableNote(stabilizerRef.current, {
              midi: frame.midi,
              clarity: frame.clarity,
              rms: frame.rms,
            })
            if (stableMidi != null) {
              onStableMidi(stableMidi, frame)
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      resetNoteStabilizer(stabilizerRef.current)
    }
  }, [enabled, analyserRef, getTimeDomainBuffer, sampleRate, onFrame, onStableMidi])
}
