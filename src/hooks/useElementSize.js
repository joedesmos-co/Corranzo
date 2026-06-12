import { useEffect, useState } from 'react'

export default function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const element = ref.current
    if (!element) {
      return undefined
    }

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })

    observer.observe(element)
    setSize({
      width: element.clientWidth,
      height: element.clientHeight,
    })

    return () => observer.disconnect()
  }, [ref])

  return size
}
