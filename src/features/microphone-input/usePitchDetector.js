import { useEffect, useRef } from 'react'
import { createNoteStabilizer, pushStableNote, resetNoteStabilizer } from './noteStabilizer.js'
import { analyzeMicFrame, createMicFrameAnalyzer } from './micFrameAnalysis.js'
import {
  createMicCalibration,
  finalizeMicCalibration,
  MIC_CALIBRATION_STATUS,
  pushCalibrationSample,
} from './micCalibration.js'

const UI_FRAME_INTERVAL = 3
const CALIBRATION_FRAMES = 45

/**
 * Poll AnalyserNode: quick auto-calibration, then live frame feedback + stable
 * MIDI note-ons. Calibration measures the room while the user is not yet
 * playing, then seeds the noise gate and the stabilizer's minimum level.
 */
export default function usePitchDetector({
  enabled,
  analyserRef,
  getTimeDomainBuffer,
  sampleRate,
  centsTolerance = 30,
  onFrame,
  onStableMidi,
  onCalibration,
}) {
  const stabilizerRef = useRef(createNoteStabilizer())
  const analyzerRef = useRef(createMicFrameAnalyzer())
  const calibrationRef = useRef(null)
  const calibrationResultRef = useRef(null)
  const rafRef = useRef(null)
  const uiFrameSkipRef = useRef(0)

  useEffect(() => {
    resetNoteStabilizer(stabilizerRef.current)
    analyzerRef.current = createMicFrameAnalyzer()
    calibrationRef.current = createMicCalibration({ frames: CALIBRATION_FRAMES })
    calibrationResultRef.current = null
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
        const frame = analyzeMicFrame(buffer, sampleRate, analyzerRef.current.noiseFloor, {
          centsTolerance,
        })
        if (frame) {
          // ── Calibration phase: measure the room, then seed the gate ──────
          const calibration = calibrationRef.current
          const calibrating = calibration != null && !calibration.done
          if (calibrating) {
            const { done } = pushCalibrationSample(calibration, frame.rms)
            if (done) {
              const result = finalizeMicCalibration(calibration)
              calibrationResultRef.current = result
              // Seed the live noise floor + the stabilizer's minimum level so
              // the gate reflects this room immediately (not after slow drift).
              analyzerRef.current.noiseFloor.floor = result.noiseFloor
              stabilizerRef.current.minRms = result.recommendedMinRms
              onCalibration?.(result)
            }
          }

          uiFrameSkipRef.current += 1
          if (onFrame && uiFrameSkipRef.current >= UI_FRAME_INTERVAL) {
            uiFrameSkipRef.current = 0
            onFrame({
              ...frame,
              calibrating,
              calibrationStatus: calibrating
                ? MIC_CALIBRATION_STATUS.MEASURING
                : calibrationResultRef.current?.status ?? MIC_CALIBRATION_STATUS.READY,
              calibration: calibrationResultRef.current,
            })
          }

          // Don't accept note-ons while still calibrating.
          if (onStableMidi && !calibrating) {
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
  }, [enabled, analyserRef, getTimeDomainBuffer, sampleRate, centsTolerance, onFrame, onStableMidi, onCalibration])
}
