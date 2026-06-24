import { useCallback, useState } from 'react'
import {
  ANNOTATION_TOOLS,
  DEFAULT_TOOL_SETTINGS,
} from '../components/pdf/annotationConstants.js'

export default function useAnnotations() {
  const [strokesByPage, setStrokesByPage] = useState({})
  const [activeTool, setActiveTool] = useState(ANNOTATION_TOOLS.POINTER)
  const [toolSettings, setToolSettings] = useState(DEFAULT_TOOL_SETTINGS)

  const getStrokes = useCallback(
    (pageNumber) => strokesByPage[pageNumber] ?? [],
    [strokesByPage],
  )

  const replaceAnnotations = useCallback((nextStrokesByPage, nextToolSettings) => {
    const normalized = {}
    if (nextStrokesByPage) {
      for (const [key, pageStrokes] of Object.entries(nextStrokesByPage)) {
        normalized[Number(key)] = pageStrokes
      }
    }
    setStrokesByPage(normalized)
    if (nextToolSettings) {
      setToolSettings(nextToolSettings)
    }
  }, [])

  const updateToolSettings = useCallback((tool, patch) => {
    setToolSettings((previous) => ({
      ...previous,
      [tool]: {
        ...previous[tool],
        ...patch,
      },
    }))
  }, [])

  const getStrokeStyle = useCallback(
    (tool) => {
      const settings =
        toolSettings[tool] ??
        toolSettings[ANNOTATION_TOOLS.PEN] ??
        DEFAULT_TOOL_SETTINGS[ANNOTATION_TOOLS.PEN]

      if (tool === ANNOTATION_TOOLS.ERASER) {
        const width =
          settings?.width ?? DEFAULT_TOOL_SETTINGS[ANNOTATION_TOOLS.ERASER].width
        return {
          color: 'transparent',
          opacity: 1,
          width,
          eraserRadius: width,
        }
      }

      return {
        color: settings?.color ?? DEFAULT_TOOL_SETTINGS[ANNOTATION_TOOLS.PEN].color,
        opacity: settings?.opacity ?? DEFAULT_TOOL_SETTINGS[ANNOTATION_TOOLS.PEN].opacity,
        width: settings?.width ?? DEFAULT_TOOL_SETTINGS[ANNOTATION_TOOLS.PEN].width,
      }
    },
    [toolSettings],
  )

  const addStroke = useCallback((pageNumber, stroke) => {
    setStrokesByPage((previous) => ({
      ...previous,
      [pageNumber]: [
        ...(previous[pageNumber] ?? []),
        { ...stroke, id: crypto.randomUUID() },
      ],
    }))
  }, [])

  const undo = useCallback((pageNumber) => {
    setStrokesByPage((previous) => {
      const strokes = previous[pageNumber] ?? []
      if (strokes.length === 0) {
        return previous
      }
      return {
        ...previous,
        [pageNumber]: strokes.slice(0, -1),
      }
    })
  }, [])

  const clearPage = useCallback((pageNumber) => {
    setStrokesByPage((previous) => ({
      ...previous,
      [pageNumber]: [],
    }))
  }, [])

  const removeStrokes = useCallback((pageNumber, strokeIds) => {
    if (strokeIds.length === 0) {
      return
    }
    setStrokesByPage((previous) => ({
      ...previous,
      [pageNumber]: (previous[pageNumber] ?? []).filter(
        (stroke) => !strokeIds.includes(stroke.id),
      ),
    }))
  }, [])

  const reset = useCallback(() => {
    setStrokesByPage({})
    setToolSettings(DEFAULT_TOOL_SETTINGS)
    setActiveTool(ANNOTATION_TOOLS.POINTER)
  }, [])

  return {
    activeTool,
    setActiveTool,
    toolSettings,
    strokesByPage,
    updateToolSettings,
    getStrokeStyle,
    getStrokes,
    addStroke,
    undo,
    clearPage,
    removeStrokes,
    replaceAnnotations,
    reset,
  }
}
