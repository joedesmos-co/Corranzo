import { useEffect, useRef, useState } from 'react'

const DEFAULT_TOLERANCE = 8

/**
 * Hysteresis filter for ResizeObserver noise. Library preview uses this so
 * child PDF layout changes do not feed back into fit calculations.
 */
export default function useStableElementSize(
  size,
  { enabled = true, tolerance = DEFAULT_TOLERANCE, resetKey = null } = {},
) {
  const stableRef = useRef({ width: 0, height: 0 })
  const [stable, setStable] = useState({ width: 0, height: 0 })

  useEffect(() => {
    stableRef.current = { width: 0, height: 0 }
    setStable({ width: 0, height: 0 })
  }, [resetKey])

  useEffect(() => {
    if (!enabled) {
      stableRef.current = size
      setStable(size)
      return
    }

    if (size.width <= 0 || size.height <= 0) {
      return
    }

    const previous = stableRef.current
    if (previous.width <= 0 || previous.height <= 0) {
      stableRef.current = size
      setStable(size)
      return
    }

    const widthDelta = Math.abs(size.width - previous.width)
    const heightDelta = Math.abs(size.height - previous.height)
    if (widthDelta >= tolerance || heightDelta >= tolerance) {
      stableRef.current = size
      setStable(size)
    }
  }, [enabled, size.width, size.height, tolerance])

  return enabled ? stable : size
}
