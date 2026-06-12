import { useCallback, useEffect, useRef, useState } from 'react'
import { ANNOTATION_TOOLS } from './annotationConstants.js'
import { findStrokesToErase, pointsToSvgPath } from '../../utils/annotationGeometry.js'
import {
  getPointerPressure,
  scaleWidth,
  smoothPoints,
} from '../../utils/strokeSmoothing.js'
import BrushCursor from './BrushCursor.jsx'

function clientToNormalized(clientX, clientY, rect) {
  return {
    x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
  }
}

export default function AnnotationLayer({
  layout,
  strokes,
  activeTool,
  strokeStyle,
  onStrokeComplete,
  onErase,
  onLiveErase,
}) {
  const layerRef = useRef(null)
  const [pageRect, setPageRect] = useState(null)
  const [draftStroke, setDraftStroke] = useState(null)
  const [cursor, setCursor] = useState({ x: 0, y: 0, visible: false })
  const drawingRef = useRef(false)
  const pendingPointsRef = useRef([])
  const rafRef = useRef(null)
  const erasedLiveRef = useRef(new Set())

  const syncPageRect = useCallback(() => {
    const rect = layerRef.current?.getBoundingClientRect()
    if (rect?.width > 0 && rect?.height > 0) {
      setPageRect(rect)
    }
  }, [])

  useEffect(() => {
    syncPageRect()
    window.addEventListener('resize', syncPageRect)
    return () => window.removeEventListener('resize', syncPageRect)
  }, [layout, syncPageRect])

  const flushPendingPoints = useCallback(() => {
    if (pendingPointsRef.current.length === 0) {
      return
    }

    const batch = pendingPointsRef.current
    pendingPointsRef.current = []

    setDraftStroke((previous) => {
      if (!previous) {
        return previous
      }
      return {
        ...previous,
        points: [...previous.points, ...batch],
      }
    })
  }, [])

  const scheduleFlush = useCallback(() => {
    if (rafRef.current != null) {
      return
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      flushPendingPoints()
    })
  }, [flushPendingPoints])

  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])

  const applyLiveErase = useCallback(
    (points, radius) => {
      const ids = findStrokesToErase(strokes, points, radius)
      const newIds = ids.filter((id) => !erasedLiveRef.current.has(id))
      if (newIds.length > 0) {
        newIds.forEach((id) => erasedLiveRef.current.add(id))
        onLiveErase(newIds)
      }
    },
    [onLiveErase, strokes],
  )

  const finishStroke = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    const trailingPoints = pendingPointsRef.current
    pendingPointsRef.current = []

    setDraftStroke((previous) => {
      if (!previous) {
        return null
      }

      const points = smoothPoints([...previous.points, ...trailingPoints])
      if (points.length === 0) {
        return null
      }

      if (previous.tool === ANNOTATION_TOOLS.ERASER) {
        if (erasedLiveRef.current.size === 0) {
          const ids = findStrokesToErase(strokes, points, previous.eraserRadius)
          onErase(ids)
        }
      } else {
        onStrokeComplete({
          tool: previous.tool,
          points,
          color: previous.color,
          width: previous.width,
          opacity: previous.opacity,
        })
      }

      erasedLiveRef.current = new Set()
      return null
    })

    drawingRef.current = false
  }, [onErase, onStrokeComplete, strokes])

  function addPoint(event) {
    const point = clientToNormalized(event.clientX, event.clientY, pageRect)
    const pressure = getPointerPressure(event)
    point.pressure = pressure
    return { point, pressure }
  }

  function handlePointerDown(event) {
    if (!pageRect || event.button !== 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)

    const { point, pressure } = addPoint(event)
    const width =
      activeTool === ANNOTATION_TOOLS.ERASER
        ? strokeStyle.width
        : scaleWidth(strokeStyle.width, pressure, activeTool)

    drawingRef.current = true
    erasedLiveRef.current = new Set()
    pendingPointsRef.current = []
    setCursor((prev) => ({ ...prev, visible: false }))
    setDraftStroke({
      tool: activeTool,
      points: [point],
      color: strokeStyle.color,
      width,
      opacity: strokeStyle.opacity,
      eraserRadius: strokeStyle.eraserRadius ?? strokeStyle.width,
    })
  }

  function handlePointerMove(event) {
    if (!pageRect) {
      return
    }

    const { point, pressure } = addPoint(event)

    if (!drawingRef.current) {
      setCursor({
        x: event.clientX,
        y: event.clientY,
        visible: true,
      })
      return
    }

    event.preventDefault()
    event.stopPropagation()

    if (activeTool !== ANNOTATION_TOOLS.ERASER) {
      point.width = scaleWidth(strokeStyle.width, pressure, activeTool)
    }

    pendingPointsRef.current.push(point)
    scheduleFlush()

    if (activeTool === ANNOTATION_TOOLS.ERASER && draftStroke) {
      const sample = [point]
      applyLiveErase(sample, strokeStyle.eraserRadius ?? strokeStyle.width)
    }
  }

  function handlePointerUp(event) {
    if (!drawingRef.current) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    finishStroke()
  }

  function handlePointerCancel(event) {
    if (!drawingRef.current) {
      return
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    pendingPointsRef.current = []
    erasedLiveRef.current = new Set()
    drawingRef.current = false
    setDraftStroke(null)
  }

  function handlePointerLeave() {
    if (!drawingRef.current) {
      setCursor((prev) => ({ ...prev, visible: false }))
    }
  }

  const allStrokes = draftStroke ? [...strokes, draftStroke] : strokes
  const isEraser = activeTool === ANNOTATION_TOOLS.ERASER
  const brushRadiusPx = pageRect
    ? (strokeStyle.eraserRadius ?? strokeStyle.width) * pageRect.width
    : 0

  return (
    <>
      <svg
        ref={layerRef}
        className={`annotation-layer${isEraser ? ' annotation-layer--eraser' : ''}`}
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        style={{
          left: layout.left,
          top: layout.top,
          width: layout.width,
          height: layout.height,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
      >
        {allStrokes.map((stroke, index) => {
          const key = stroke.id ?? `draft-${index}`

          if (stroke.tool === ANNOTATION_TOOLS.ERASER) {
            return (
              <path
                key={key}
                d={pointsToSvgPath(stroke.points)}
                fill="none"
                stroke="rgba(255,255,255,0.35)"
                strokeWidth={stroke.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )
          }

          return (
            <path
              key={key}
              d={pointsToSvgPath(stroke.points)}
              fill="none"
              stroke={stroke.color}
              strokeOpacity={stroke.opacity}
              strokeWidth={stroke.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )
        })}
      </svg>

      <BrushCursor
        visible={cursor.visible && !drawingRef.current}
        x={cursor.x}
        y={cursor.y}
        radiusPx={brushRadiusPx}
        tool={activeTool}
      />
    </>
  )
}
