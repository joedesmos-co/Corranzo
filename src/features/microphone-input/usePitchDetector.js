import { useEffect, useMemo, useRef } from 'react'
import { createNoteStabilizer, pushStableNote, resetNoteStabilizer } from './noteStabilizer.js'
import { analyzeMicFrame, createMicFrameAnalyzer } from './micFrameAnalysis.js'
import { getMicInstrumentProfile } from './micInstrumentProfiles.js'
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
 * playing, then seeds the noise gate and stabilizer thresholds. The selected
 * instrument nudges the attack-skip and gate defaults (piano vs plucky guitar).
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
  instrumentId = null,
}) {
  const profile = useMemo(() => getMicInstrumentProfile(instrumentId), [instrumentId])
  const profileRef = useRef(profile)
  profileRef.current = profile
  const stabilizerRef = useRef(createNoteStabilizer(profile.stabilizer))
  const analyzerRef = useRef(createMicFrameAnalyzer())
  const calibrationRef = useRef(null)
  const calibrationResultRef = useRef(null)
  const calibrationStartedAtRef = useRef(0)
  const rafRef = useRef(null)
  const uiFrameSkipRef = useRef(0)
  const onFrameRef = useRef(onFrame)
  const onStableMidiRef = useRef(onStableMidi)
  const onCalibrationRef = useRef(onCalibration)

  useEffect(() => {
    onFrameRef.current = onFrame
  }, [onFrame])
  useEffect(() => {
    onStableMidiRef.current = onStableMidi
  }, [onStableMidi])
  useEffect(() => {
    onCalibrationRef.current = onCalibration
  }, [onCalibration])

  const finishCalibration = (calibration) => {
    if (!calibration || calibrationResultRef.current) {
      return
    }
    calibration.done = true
    const result = finalizeMicCalibration(calibration)
    calibrationResultRef.current = result
    analyzerRef.current.noiseFloor.floor = result.noiseFloor
    applyMicCalibrationToStabilizer(stabilizerRef.current, result)
    onCalibrationRef.current?.(result)
  }

  useEffect(() => {
    stabilizerRef.current = createNoteStabilizer(profile.stabilizer)
    analyzerRef.current = createMicFrameAnalyzer()
    calibrationRef.current = createMicCalibration({ frames: CALIBRATION_FRAMES })
    calibrationResultRef.current = null
    calibrationStartedAtRef.current = performance.now()
  }, [enabled, calibrationKey, profile])

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
          gateOptions: profileRef.current.gate,
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
              const calibrationRms = frame.filteredRms ?? frame.rms
              const acceptSample = shouldAcceptCalibrationSample({
                rms: calibrationRms,
                gateOpen: frame.gateOpen,
                hasPitch: frame.midi != null,
              })
              const { done } = pushCalibrationSample(calibration, calibrationRms, { acceptSample })
              if (done) {
                finishCalibration(calibration)
              }
            }
          }

          const calibrationComplete = Boolean(calibrationResultRef.current)
          const stillCalibrating = calibrating && !calibrationComplete

          uiFrameSkipRef.current += 1
          if (onFrameRef.current && uiFrameSkipRef.current >= UI_FRAME_INTERVAL) {
            uiFrameSkipRef.current = 0
            const stabilizer = stabilizerRef.current
            const stabilizerPending =
              stabilizer.candidateMidi != null &&
              stabilizer.stableCount > 0 &&
              stabilizer.stableCount < stabilizer.holdFrames
            onFrameRef.current({
              ...frame,
              stabilizerPending,
              calibrating: stillCalibrating,
              calibrationStatus: stillCalibrating
                ? MIC_CALIBRATION_STATUS.MEASURING
                : calibrationResultRef.current?.status ?? MIC_CALIBRATION_STATUS.READY,
              calibration: calibrationResultRef.current,
            })
          }

          if (onStableMidiRef.current && !stillCalibrating) {
            const stableMidi = pushStableNote(stabilizerRef.current, {
              midi: frame.midi,
              clarity: frame.clarity,
              rms: frame.rms,
            })
            if (stableMidi != null) {
              onStableMidiRef.current(stableMidi, frame)
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
  }, [enabled, analyserRef, getTimeDomainBuffer, sampleRate, centsTolerance, calibrationKey, profile])

  return {
    retryCalibration: () => {
      stabilizerRef.current = createNoteStabilizer(profileRef.current.stabilizer)
      analyzerRef.current = createMicFrameAnalyzer()
      calibrationRef.current = createMicCalibration({ frames: CALIBRATION_FRAMES })
      calibrationResultRef.current = null
      calibrationStartedAtRef.current = performance.now()
    },
  }
}
