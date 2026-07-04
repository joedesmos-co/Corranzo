import { useEffect, useMemo, useRef } from 'react'
import { analyzeMicFrame, createMicFrameAnalyzer } from './micFrameAnalysis.js'
import { getMicInstrumentProfile } from './micInstrumentProfiles.js'
import {
  createMicCalibration,
  finalizeMicCalibration,
  forceMicCalibrationTimeout,
  MIC_CALIBRATION_STATUS,
  MIC_CALIBRATION_TIMEOUT_MS,
  pushCalibrationSample,
  shouldAcceptCalibrationSample,
} from './micCalibration.js'
import {
  createMicEngineV2RuntimeState,
  processMicEngineV2Tick,
  resetMicEngineV2RuntimeState,
} from './v2/micEngineV2Live.js'

const UI_FRAME_INTERVAL = 3
const CALIBRATION_FRAMES = 45

/**
 * Live Mic Engine V2 detector — score-informed note/chord detection.
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
  instrumentId = null,
  analysisKey = '',
}) {
  const profile = useMemo(() => getMicInstrumentProfile(instrumentId), [instrumentId])
  const profileRef = useRef(profile)
  profileRef.current = profile
  const analyzerRef = useRef(createMicFrameAnalyzer())
  const v2StateRef = useRef(createMicEngineV2RuntimeState())
  const calibrationRef = useRef(null)
  const calibrationResultRef = useRef(null)
  const calibrationStartedAtRef = useRef(0)
  const rafRef = useRef(null)
  const uiFrameSkipRef = useRef(0)
  const expectedMidisRef = useRef(expectedMidis)
  const v2ErroredRef = useRef(false)
  const onFrameRef = useRef(onFrame)
  const onStableMidiRef = useRef(onStableMidi)
  const onStableChordRef = useRef(onStableChord)
  const onCalibrationRef = useRef(onCalibration)
  const onV2RuntimeErrorRef = useRef(onV2RuntimeError)

  useEffect(() => {
    onFrameRef.current = onFrame
  }, [onFrame])
  useEffect(() => {
    onStableMidiRef.current = onStableMidi
  }, [onStableMidi])
  useEffect(() => {
    onStableChordRef.current = onStableChord
  }, [onStableChord])
  useEffect(() => {
    onCalibrationRef.current = onCalibration
  }, [onCalibration])
  useEffect(() => {
    onV2RuntimeErrorRef.current = onV2RuntimeError
  }, [onV2RuntimeError])

  const finishCalibration = (calibration) => {
    if (!calibration || calibrationResultRef.current) {
      return
    }
    calibration.done = true
    const result = finalizeMicCalibration(calibration)
    calibrationResultRef.current = result
    analyzerRef.current.noiseFloor.floor = result.noiseFloor
    onCalibrationRef.current?.(result)
  }

  const expectedMidisKey = useMemo(
    () => (expectedMidis ?? []).join(','),
    [expectedMidis],
  )

  useEffect(() => {
    expectedMidisRef.current = expectedMidis ?? []
  }, [expectedMidis, expectedMidisKey])

  useEffect(() => {
    resetMicEngineV2RuntimeState(v2StateRef.current)
  }, [analysisKey, expectedMidisKey, stableFrameThreshold])

  useEffect(() => {
    analyzerRef.current = createMicFrameAnalyzer()
    resetMicEngineV2RuntimeState(v2StateRef.current)
    calibrationRef.current = createMicCalibration({ frames: CALIBRATION_FRAMES })
    calibrationResultRef.current = null
    calibrationStartedAtRef.current = performance.now()
    v2ErroredRef.current = false
  }, [enabled, calibrationKey, profile])

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
            gateOptions: profileRef.current.gate,
          })

          if (calibrating && previewFrame) {
            const timedOut =
              performance.now() - calibrationStartedAtRef.current >= MIC_CALIBRATION_TIMEOUT_MS
            if (timedOut) {
              forceMicCalibrationTimeout(calibration)
              finishCalibration(calibration)
            } else {
              const calibrationRms = previewFrame.filteredRms ?? previewFrame.rms
              const acceptSample = shouldAcceptCalibrationSample({
                rms: calibrationRms,
                gateOpen: previewFrame.gateOpen,
                hasPitch: previewFrame.midi != null,
              })
              const { done } = pushCalibrationSample(calibration, calibrationRms, { acceptSample })
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
              gateOptions: profileRef.current.gate,
              timeMs: performance.now(),
              stableFrameThreshold,
            })

            uiFrameSkipRef.current += 1
            if (onFrameRef.current && uiFrameSkipRef.current >= UI_FRAME_INTERVAL) {
              uiFrameSkipRef.current = 0
              onFrameRef.current({
                ...(tickResult.frame ?? previewFrame),
                stabilizerPending: false,
                calibrating: false,
                calibrationStatus:
                  calibrationResultRef.current?.status ?? MIC_CALIBRATION_STATUS.READY,
                calibration: calibrationResultRef.current,
                micEngineMode: 'v2-score-informed',
              })
            }

            if (onStableChordRef.current && tickResult.stableMidis?.length > 1) {
              onStableChordRef.current(tickResult.stableMidis, tickResult.frame)
            } else if (onStableMidiRef.current) {
              if (tickResult.stableMidi != null) {
                onStableMidiRef.current(tickResult.stableMidi, tickResult.frame ?? previewFrame)
              }
            }
          } else if (previewFrame) {
            uiFrameSkipRef.current += 1
            if (onFrameRef.current && uiFrameSkipRef.current >= UI_FRAME_INTERVAL) {
              uiFrameSkipRef.current = 0
              onFrameRef.current({
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
          onV2RuntimeErrorRef.current?.(error)
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
      resetMicEngineV2RuntimeState(v2StateRef.current)
    }
  }, [
    enabled,
    analyserRef,
    getTimeDomainBuffer,
    sampleRate,
    centsTolerance,
    calibrationKey,
    stableFrameThreshold,
    profile,
    analysisKey,
  ])

  return {
    retryCalibration: () => {
      analyzerRef.current = createMicFrameAnalyzer()
      resetMicEngineV2RuntimeState(v2StateRef.current)
      calibrationRef.current = createMicCalibration({ frames: CALIBRATION_FRAMES })
      calibrationResultRef.current = null
      calibrationStartedAtRef.current = performance.now()
    },
  }
}
