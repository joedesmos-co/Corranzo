import { useEffect, useRef } from 'react'
import { createNoteStabilizer, pushStableNote, resetNoteStabilizer } from './noteStabilizer.js'
import { analyzeMicFrame, createMicFrameAnalyzer } from './micFrameAnalysis.js'
import {
  applyMicCalibrationToStabilizer,
  createMicCalibration,
  finalizeMicCalibration,
  forceMicCalibrationTimeout,
  MIC_CALIBRATION_STATUS,
  MIC_CALIBRATION_TIMEOUT_MS,
  pushCalibrationSample,
  shouldAcceptCalibrationSample,
} from './micCalibration.js'

const UI_FRAME_INTERVAL = 3
const CALIBRATION_FRAMES = 45

/**
 * Poll AnalyserNode: quick auto-calibration, then live frame feedback + stable
 * MIDI note-ons. Calibration measures the room while the user is not yet
 * playing, then seeds the noise gate and stabilizer thresholds.
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
  calibrationKey = 0,
}) {
  const stabilizerRef = useRef(createNoteStabilizer())
  const analyzerRef = useRef(createMicFrameAnalyzer())
  const calibrationRef = useRef(null)
  const calibrationResultRef = useRef(null)
  const calibrationStartedAtRef = useRef(0)
  const rafRef = useRef(null)
  const uiFrameSkipRef = useRef(0)

  const finishCalibration = (calibration) => {
    if (!calibration || calibrationResultRef.current) {
      return
    }
    calibration.done = true
    const result = finalizeMicCalibration(calibration)
    calibrationResultRef.current = result
    analyzerRef.current.noiseFloor.floor = result.noiseFloor
    applyMicCalibrationToStabilizer(stabilizerRef.current, result)
    onCalibration?.(result)
  }

  useEffect(() => {
    resetNoteStabilizer(stabilizerRef.current)
    analyzerRef.current = createMicFrameAnalyzer()
    calibrationRef.current = createMicCalibration({ frames: CALIBRATION_FRAMES })
    calibrationResultRef.current = null
    calibrationStartedAtRef.current = performance.now()
  }, [enabled, onStableMidi, calibrationKey])

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
          const calibration = calibrationRef.current
          const calibrating = calibration != null && !calibration.done
          if (calibrating) {
            const timedOut =
              performance.now() - calibrationStartedAtRef.current >= MIC_CALIBRATION_TIMEOUT_MS
            if (timedOut) {
              forceMicCalibrationTimeout(calibration)
              finishCalibration(calibration)
            } else {
              const acceptSample = shouldAcceptCalibrationSample({
                rms: frame.rms,
                gateOpen: frame.gateOpen,
                hasPitch: frame.midi != null,
              })
              const { done } = pushCalibrationSample(calibration, frame.rms, { acceptSample })
              if (done) {
                finishCalibration(calibration)
              }
            }
          }

          const calibrationComplete = Boolean(calibrationResultRef.current)
          const stillCalibrating = calibrating && !calibrationComplete

          uiFrameSkipRef.current += 1
          if (onFrame && uiFrameSkipRef.current >= UI_FRAME_INTERVAL) {
            uiFrameSkipRef.current = 0
            onFrame({
              ...frame,
              calibrating: stillCalibrating,
              calibrationStatus: stillCalibrating
                ? MIC_CALIBRATION_STATUS.MEASURING
                : calibrationResultRef.current?.status ?? MIC_CALIBRATION_STATUS.READY,
              calibration: calibrationResultRef.current,
            })
          }

          if (onStableMidi && !stillCalibrating) {
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
  }, [enabled, analyserRef, getTimeDomainBuffer, sampleRate, centsTolerance, onFrame, onStableMidi, onCalibration, calibrationKey])

  return {
    retryCalibration: () => {
      resetNoteStabilizer(stabilizerRef.current)
      analyzerRef.current = createMicFrameAnalyzer()
      calibrationRef.current = createMicCalibration({ frames: CALIBRATION_FRAMES })
      calibrationResultRef.current = null
      calibrationStartedAtRef.current = performance.now()
    },
  }
}
