import { useCallback, useEffect, useRef, useState } from 'react'
import { ANNOTATION_TOOLS, resolveAnnotationStrokeStyle } from './annotationConstants.js'
import { findStrokesToErase, pointsToSvgPath } from '../../utils/annotationGeometry.js'
import {
  clientToNormalized,
  clientToPageLocal,
  findScrollableAncestor,
  isPointInsidePage,
} from '../../utils/annotationPointer.js'
import {
  getPointerPressure,
  scaleWidth,
  smoothPoints,
} from '../../utils/strokeSmoothing.js'
import BrushCursor from './BrushCursor.jsx'

function readPageRect(layerRef) {
  const rect = layerRef.current?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return null
  }
  return rect
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
  const resolvedStrokeStyle = resolveAnnotationStrokeStyle(strokeStyle, activeTool)
  const layerRef = useRef(null)
  const [pageRect, setPageRect] = useState(null)
  const [draftStroke, setDraftStroke] = useState(null)
  const [cursor, setCursor] = useState({ x: 0, y: 0, visible: false })
  const drawingRef = useRef(false)
  const pendingPointsRef = useRef([])
  const rafRef = useRef(null)
  const erasedLiveRef = useRef(new Set())

  const syncPageRect = useCallback(() => {
    const rect = readPageRect(layerRef)
    if (rect) {
      setPageRect(rect)
    }
  }, [])

  useEffect(() => {
    syncPageRect()
    const layer = layerRef.current
    const scrollParent = layer ? findScrollableAncestor(layer) : null
    const scrollTarget = scrollParent ?? window

    window.addEventListener('resize', syncPageRect)
    scrollTarget.addEventListener('scroll', syncPageRect, { passive: true })

    return () => {
      window.removeEventListener('resize', syncPageRect)
      scrollTarget.removeEventListener('scroll', syncPageRect)
    }
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
          const radius = previous.eraserRadius ?? previous.width ?? resolvedStrokeStyle.width
          const ids = findStrokesToErase(strokes, points, radius)
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
  }, [onErase, onStrokeComplete, resolvedStrokeStyle.width, strokes])

  function addPoint(event, rect) {
    const point = clientToNormalized(event.clientX, event.clientY, rect)
    if (!point) {
      return null
    }
    const pressure = getPointerPressure(event)
    point.pressure = pressure
    return { point, pressure }
  }

  function handlePointerDown(event) {
    const rect = readPageRect(layerRef)
    if (!rect || event.button !== 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)

    const added = addPoint(event, rect)
    if (!added) {
      return
    }
    const { point, pressure } = added
    const width =
      activeTool === ANNOTATION_TOOLS.ERASER
        ? resolvedStrokeStyle.width
        : scaleWidth(resolvedStrokeStyle.width, pressure, activeTool)

    drawingRef.current = true
    erasedLiveRef.current = new Set()
    pendingPointsRef.current = []
    setCursor((prev) => ({ ...prev, visible: false }))
    setDraftStroke({
      tool: activeTool,
      points: [point],
      color: resolvedStrokeStyle.color,
      width,
      opacity: resolvedStrokeStyle.opacity,
      eraserRadius: resolvedStrokeStyle.eraserRadius ?? resolvedStrokeStyle.width,
    })
  }

  function handlePointerMove(event) {
    const rect = readPageRect(layerRef)
    if (!rect) {
      return
    }

    const added = addPoint(event, rect)
    if (!added) {
      return
    }
    const { point, pressure } = added

    if (!drawingRef.current) {
      const local = clientToPageLocal(event.clientX, event.clientY, rect)
      setCursor({
        x: local?.x ?? 0,
        y: local?.y ?? 0,
        visible: isPointInsidePage(event.clientX, event.clientY, rect),
      })
      return
    }

    event.preventDefault()
    event.stopPropagation()

    if (activeTool !== ANNOTATION_TOOLS.ERASER) {
      point.width = scaleWidth(resolvedStrokeStyle.width, pressure, activeTool)
    }

    pendingPointsRef.current.push(point)
    scheduleFlush()

    if (activeTool === ANNOTATION_TOOLS.ERASER && draftStroke) {
      const sample = [point]
      applyLiveErase(
        sample,
        resolvedStrokeStyle.eraserRadius ?? resolvedStrokeStyle.width,
      )
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
  const isPointer = activeTool === ANNOTATION_TOOLS.POINTER
  const isEraser = activeTool === ANNOTATION_TOOLS.ERASER
  const brushRadiusPx = pageRect
    ? (resolvedStrokeStyle.eraserRadius ?? resolvedStrokeStyle.width) * pageRect.width
    : 0

  return (
    <div
      ref={layerRef}
      className={`annotation-layer-root${isEraser ? ' annotation-layer-root--eraser' : ''}`}
      style={{
        left: layout.left,
        top: layout.top,
        width: layout.width,
        height: layout.height,
        pointerEvents: isPointer ? 'none' : undefined,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerLeave}
    >
      <svg
        className={`annotation-layer${isEraser ? ' annotation-layer--eraser' : ''}`}
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
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
        visible={!isPointer && cursor.visible && !drawingRef.current}
        x={cursor.x}
        y={cursor.y}
        radiusPx={brushRadiusPx}
        tool={activeTool}
      />
    </div>
  )
}
