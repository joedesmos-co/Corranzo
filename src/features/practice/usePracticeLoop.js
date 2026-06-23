import { useCallback, useMemo, useState } from 'react'
import {
  LOOP_SNAP_MODE,
  buildLoopRegionFromState,
} from './practiceLoopRegion.js'

export default function usePracticeLoop(timingMap, currentMeasure, currentBeat, initial = {}) {
  const [snapMode, setSnapMode] = useState(initial.snapMode ?? LOOP_SNAP_MODE.MEASURE)
  const [startMeasureNumber, setStartMeasureNumber] = useState(
    initial.startMeasureNumber ?? null,
  )
  const [endMeasureNumber, setEndMeasureNumber] = useState(initial.endMeasureNumber ?? null)
  const [startBeat, setStartBeat] = useState(initial.startBeat ?? null)
  const [endBeat, setEndBeat] = useState(initial.endBeat ?? null)
  const [enabled, setEnabled] = useState(Boolean(initial.enabled))

  const loopState = useMemo(
    () => ({
      snapMode,
      startMeasureNumber,
      endMeasureNumber,
      startBeat,
      endBeat,
    }),
    [snapMode, startMeasureNumber, endMeasureNumber, startBeat, endBeat],
  )

  const region = useMemo(
    () => buildLoopRegionFromState(timingMap, loopState),
    [timingMap, loopState],
  )

  const hasLoop = Boolean(region?.isValid)
  const canEnable = hasLoop

  const setStartFromCurrent = useCallback(() => {
    if (snapMode === LOOP_SNAP_MODE.BEAT) {
      if (currentBeat) {
        setStartBeat({ ...currentBeat })
        setStartMeasureNumber(null)
      }
      return
    }
    if (currentMeasure) {
      setStartMeasureNumber(currentMeasure.number)
      setStartBeat(null)
    }
  }, [snapMode, currentMeasure, currentBeat])

  const setEndFromCurrent = useCallback(() => {
    if (snapMode === LOOP_SNAP_MODE.BEAT) {
      if (currentBeat) {
        setEndBeat({ ...currentBeat })
        setEndMeasureNumber(null)
      }
      return
    }
    if (currentMeasure) {
      setEndMeasureNumber(currentMeasure.number)
      setEndBeat(null)
    }
  }, [snapMode, currentMeasure, currentBeat])

  const clearLoop = useCallback(() => {
    setStartMeasureNumber(null)
    setEndMeasureNumber(null)
    setStartBeat(null)
    setEndBeat(null)
    setEnabled(false)
  }, [])

  const setLoopEnabled = useCallback(
    (nextEnabled) => {
      if (nextEnabled && !canEnable) {
        return
      }
      setEnabled(nextEnabled)
    },
    [canEnable],
  )

  const setLoopSnapMode = useCallback((mode) => {
    setSnapMode(mode)
    setStartMeasureNumber(null)
    setEndMeasureNumber(null)
    setStartBeat(null)
    setEndBeat(null)
    setEnabled(false)
  }, [])

  return {
    region,
    hasLoop,
    canEnable,
    enabled: enabled && canEnable,
    snapMode,
    setLoopSnapMode,
    setLoopEnabled,
    setStartFromCurrent,
    setEndFromCurrent,
    clearLoop,
    startMeasureNumber,
    endMeasureNumber,
    startBeat,
    endBeat,
  }
}
