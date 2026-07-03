import { useEffect, useRef } from 'react'
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
import { createNoteStabilizer, pushStableNote, resetNoteStabilizer } from './noteStabilizer.js'
import {
  createMicEngineV2RuntimeState,
  processMicEngineV2Tick,
  resetMicEngineV2RuntimeState,
} from './v2/micEngineV2Live.js'

const UI_FRAME_INTERVAL = 3
const CALIBRATION_FRAMES = 45

/**
 * Live Mic Engine V2 detector — score-informed polyphony with V1 fallback.
 * API mirrors usePitchDetector for Wait For You integration.
 */
export default function useMicEngineV2Detector({
  enabled,
  expectedMidis = [],
  analyserRef,
  getTimeDomainBuffer,
  sampleRate,
  centsTolerance = 30,
  onFrame,
  onStableMidi,
  onStableChord,
  onCalibration,
  onV2RuntimeError,
  calibrationKey = 0,
  stableFrameThreshold,
}) {
  const stabilizerRef = useRef(createNoteStabilizer())
  const analyzerRef = useRef(createMicFrameAnalyzer())
  const v2StateRef = useRef(createMicEngineV2RuntimeState())
  const calibrationRef = useRef(null)
  const calibrationResultRef = useRef(null)
  const calibrationStartedAtRef = useRef(0)
  const rafRef = useRef(null)
  const uiFrameSkipRef = useRef(0)
  const expectedMidisRef = useRef(expectedMidis)
  const v2ErroredRef = useRef(false)

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
    expectedMidisRef.current = expectedMidis ?? []
  }, [expectedMidis])

  useEffect(() => {
    resetNoteStabilizer(stabilizerRef.current)
    analyzerRef.current = createMicFrameAnalyzer()
    resetMicEngineV2RuntimeState(v2StateRef.current)
    calibrationRef.current = createMicCalibration({ frames: CALIBRATION_FRAMES })
    calibrationResultRef.current = null
    calibrationStartedAtRef.current = performance.now()
    v2ErroredRef.current = false
  }, [enabled, calibrationKey])

  useEffect(() => {
    if (!enabled) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      resetMicEngineV2RuntimeState(v2StateRef.current)
      return undefined
    }

    const tick = () => {
      try {
        const analyser = analyserRef?.current
        const buffer = getTimeDomainBuffer?.()
        if (analyser && buffer?.length) {
          analyser.getFloatTimeDomainData(buffer)

          const calibration = calibrationRef.current
          const calibrating = calibration != null && !calibration.done
          const previewFrame = analyzeMicFrame(buffer, sampleRate, analyzerRef.current.noiseFloor, {
            centsTolerance,
          })

          if (calibrating && previewFrame) {
            const timedOut =
              performance.now() - calibrationStartedAtRef.current >= MIC_CALIBRATION_TIMEOUT_MS
            if (timedOut) {
              forceMicCalibrationTimeout(calibration)
              finishCalibration(calibration)
            } else {
              const acceptSample = shouldAcceptCalibrationSample({
                rms: previewFrame.rms,
                gateOpen: previewFrame.gateOpen,
                hasPitch: previewFrame.midi != null,
              })
              const { done } = pushCalibrationSample(calibration, previewFrame.rms, { acceptSample })
              if (done) {
                finishCalibration(calibration)
              }
            }
          }

          const calibrationComplete = Boolean(calibrationResultRef.current)
          const stillCalibrating = calibrating && !calibrationComplete

          if (!stillCalibrating && previewFrame) {
            const tickResult = processMicEngineV2Tick({
              buffer,
              sampleRate,
              expectedMidis: expectedMidisRef.current,
              noiseFloor: analyzerRef.current.noiseFloor,
              state: v2StateRef.current,
              centsTolerance,
              timeMs: performance.now(),
              stableFrameThreshold,
            })

            uiFrameSkipRef.current += 1
            if (onFrame && uiFrameSkipRef.current >= UI_FRAME_INTERVAL) {
              uiFrameSkipRef.current = 0
              const stabilizer = stabilizerRef.current
              const stabilizerPending =
                stabilizer.candidateMidi != null &&
                stabilizer.stableCount > 0 &&
                stabilizer.stableCount < stabilizer.holdFrames
              onFrame({
                ...(tickResult.frame ?? previewFrame),
                stabilizerPending,
                calibrating: false,
                calibrationStatus:
                  calibrationResultRef.current?.status ?? MIC_CALIBRATION_STATUS.READY,
                calibration: calibrationResultRef.current,
                micEngineMode: 'v2-score-informed',
                usedV1Fallback: tickResult.usedV1Fallback,
              })
            }

            if (onStableChord && tickResult.stableMidis?.length > 1) {
              onStableChord(tickResult.stableMidis, tickResult.frame)
            } else if (onStableMidi) {
              let stableMidi = tickResult.stableMidi
              if (stableMidi == null && expectedMidisRef.current.length <= 1) {
                stableMidi = pushStableNote(stabilizerRef.current, {
                  midi: previewFrame.midi,
                  clarity: previewFrame.clarity,
                  rms: previewFrame.rms,
                })
                if (stableMidi != null) {
                  tickResult.usedV1Fallback = true
                }
              }
              if (stableMidi != null) {
                onStableMidi(stableMidi, tickResult.frame ?? previewFrame)
              }
            }
          } else if (previewFrame) {
            uiFrameSkipRef.current += 1
            if (onFrame && uiFrameSkipRef.current >= UI_FRAME_INTERVAL) {
              uiFrameSkipRef.current = 0
              onFrame({
                ...previewFrame,
                stabilizerPending: false,
                calibrating: stillCalibrating,
                calibrationStatus: stillCalibrating
                  ? MIC_CALIBRATION_STATUS.MEASURING
                  : calibrationResultRef.current?.status ?? MIC_CALIBRATION_STATUS.READY,
                calibration: calibrationResultRef.current,
                micEngineMode: 'v2-score-informed',
              })
            }
          }
        }
      } catch (error) {
        if (!v2ErroredRef.current) {
          v2ErroredRef.current = true
          onV2RuntimeError?.(error)
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
      resetMicEngineV2RuntimeState(v2StateRef.current)
    }
  }, [
    enabled,
    analyserRef,
    getTimeDomainBuffer,
    sampleRate,
    centsTolerance,
    onFrame,
    onStableMidi,
    onStableChord,
    onCalibration,
    onV2RuntimeError,
    stableFrameThreshold,
  ])

  return {
    retryCalibration: () => {
      resetNoteStabilizer(stabilizerRef.current)
      analyzerRef.current = createMicFrameAnalyzer()
      resetMicEngineV2RuntimeState(v2StateRef.current)
      calibrationRef.current = createMicCalibration({ frames: CALIBRATION_FRAMES })
      calibrationResultRef.current = null
      calibrationStartedAtRef.current = performance.now()
    },
  }
}
