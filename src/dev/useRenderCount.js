import { useEffect, useRef } from 'react'

/**
 * Dev-only: logs when a component re-renders more than expected.
 */
export default function useRenderCount(label, enabled = import.meta.env.DEV) {
  const countRef = useRef(0)
  countRef.current += 1

  useEffect(() => {
    if (!enabled) {
      return undefined
    }
    if (countRef.current > 1) {
      // eslint-disable-next-line no-console
      console.debug(`[render] ${label} #${countRef.current}`)
    }
    return undefined
  })
}
