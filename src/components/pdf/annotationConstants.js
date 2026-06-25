export const ANNOTATION_TOOLS = {
  POINTER: 'pointer',
  PEN: 'pen',
  HIGHLIGHTER: 'highlighter',
  ERASER: 'eraser',
}

export const DEFAULT_PEN_COLOR = '#a855f7'

const DEPRECATED_PEN_COLORS = new Set(['#e8eef8'])

export const DEFAULT_TOOL_SETTINGS = {
  [ANNOTATION_TOOLS.PEN]: {
    color: DEFAULT_PEN_COLOR,
    opacity: 1,
    width: 0.004,
  },
  [ANNOTATION_TOOLS.HIGHLIGHTER]: {
    color: '#facc15',
    opacity: 0.4,
    width: 0.014,
  },
  [ANNOTATION_TOOLS.ERASER]: {
    width: 0.02,
  },
}

/**
 * Normalize stroke style for AnnotationLayer. Warm PDF slots and restored
 * sessions may pass null or partial settings — never crash the layer.
 */
export function resolveAnnotationStrokeStyle(
  strokeStyle,
  activeTool = ANNOTATION_TOOLS.POINTER,
) {
  const tool = activeTool ?? ANNOTATION_TOOLS.POINTER
  const defaults =
    DEFAULT_TOOL_SETTINGS[tool] ??
    DEFAULT_TOOL_SETTINGS[ANNOTATION_TOOLS.PEN]

  if (!strokeStyle || typeof strokeStyle !== 'object') {
    if (tool === ANNOTATION_TOOLS.ERASER) {
      const width = defaults.width ?? DEFAULT_TOOL_SETTINGS[ANNOTATION_TOOLS.ERASER].width
      return { color: 'transparent', opacity: 1, width, eraserRadius: width }
    }
    return {
      color: normalizePenColor(defaults.color),
      opacity: defaults.opacity ?? 1,
      width: defaults.width ?? 0.004,
    }
  }

  const width =
    strokeStyle.width ??
    defaults.width ??
    DEFAULT_TOOL_SETTINGS[ANNOTATION_TOOLS.PEN].width

  if (tool === ANNOTATION_TOOLS.ERASER) {
    return {
      color: 'transparent',
      opacity: 1,
      width,
      eraserRadius: strokeStyle.eraserRadius ?? width,
    }
  }

  return {
    color: normalizePenColor(strokeStyle.color ?? defaults.color),
    opacity: strokeStyle.opacity ?? defaults.opacity ?? 1,
    width,
    eraserRadius: strokeStyle.eraserRadius ?? width,
  }
}

export const PEN_COLORS = [
  DEFAULT_PEN_COLOR,
  '#f87171',
  '#60a5fa',
  '#1e293b',
  '#ffffff',
]

export function normalizePenColor(color) {
  const normalized = String(color ?? '').trim().toLowerCase()
  if (DEPRECATED_PEN_COLORS.has(normalized)) {
    return DEFAULT_PEN_COLOR
  }
  const match = PEN_COLORS.find((entry) => entry.toLowerCase() === normalized)
  return match ?? DEFAULT_PEN_COLOR
}

export function normalizeToolSettings(toolSettings) {
  if (!toolSettings || typeof toolSettings !== 'object') {
    return {
      ...DEFAULT_TOOL_SETTINGS,
      [ANNOTATION_TOOLS.PEN]: { ...DEFAULT_TOOL_SETTINGS[ANNOTATION_TOOLS.PEN] },
      [ANNOTATION_TOOLS.HIGHLIGHTER]: {
        ...DEFAULT_TOOL_SETTINGS[ANNOTATION_TOOLS.HIGHLIGHTER],
      },
      [ANNOTATION_TOOLS.ERASER]: { ...DEFAULT_TOOL_SETTINGS[ANNOTATION_TOOLS.ERASER] },
    }
  }

  return {
    ...DEFAULT_TOOL_SETTINGS,
    ...toolSettings,
    [ANNOTATION_TOOLS.PEN]: {
      ...DEFAULT_TOOL_SETTINGS[ANNOTATION_TOOLS.PEN],
      ...toolSettings[ANNOTATION_TOOLS.PEN],
      color: normalizePenColor(toolSettings[ANNOTATION_TOOLS.PEN]?.color),
    },
    [ANNOTATION_TOOLS.HIGHLIGHTER]: {
      ...DEFAULT_TOOL_SETTINGS[ANNOTATION_TOOLS.HIGHLIGHTER],
      ...toolSettings[ANNOTATION_TOOLS.HIGHLIGHTER],
    },
    [ANNOTATION_TOOLS.ERASER]: {
      ...DEFAULT_TOOL_SETTINGS[ANNOTATION_TOOLS.ERASER],
      ...toolSettings[ANNOTATION_TOOLS.ERASER],
    },
  }
}

export const HIGHLIGHTER_COLORS = [
  '#facc15',
  '#4ade80',
  '#f472b6',
  '#fb923c',
  '#38bdf8',
]

export const BRUSH_SIZE = { min: 0.002, max: 0.035 }
export const ERASER_SIZE = { min: 0.008, max: 0.045 }

export const PEN_OPACITY = { min: 0.5, max: 1 }
export const HIGHLIGHTER_OPACITY = { min: 0.15, max: 0.85 }

export function widthToSlider(width, range) {
  const { min, max } = range
  return Math.round(((width - min) / (max - min)) * 100)
}

export function sliderToWidth(value, range) {
  const { min, max } = range
  const ratio = Number(value) / 100
  return min + ratio * (max - min)
}

export function opacityToSlider(opacity, range) {
  const { min, max } = range
  return Math.round(((opacity - min) / (max - min)) * 100)
}

export function sliderToOpacity(value, range) {
  const { min, max } = range
  const ratio = Number(value) / 100
  return Number((min + ratio * (max - min)).toFixed(2))
}
