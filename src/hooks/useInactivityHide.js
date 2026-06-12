import { useCallback, useEffect, useRef, useState } from 'react'

export default function useInactivityHide(timeoutMs = 3000, enabled = true) {
  const [visible, setVisible] = useState(true)
  const timerRef = useRef(null)

  const notifyActivity = useCallback(() => {
    if (!enabled) {
      setVisible(true)
      return
    }
    setVisible(true)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = setTimeout(() => {
      setVisible(false)
    }, timeoutMs)
  }, [enabled, timeoutMs])

  useEffect(() => {
    if (!enabled) {
      setVisible(true)
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      return undefined
    }

    notifyActivity()
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [enabled, notifyActivity])

  return { visible, notifyActivity }
}
