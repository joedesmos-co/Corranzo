export const ANNOTATION_TOOLS = {
  POINTER: 'pointer',
  PEN: 'pen',
  HIGHLIGHTER: 'highlighter',
  ERASER: 'eraser',
}

export const DEFAULT_TOOL_SETTINGS = {
  [ANNOTATION_TOOLS.PEN]: {
    color: '#e8eef8',
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
      color: defaults.color ?? '#e8eef8',
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
    color: strokeStyle.color ?? defaults.color ?? '#e8eef8',
    opacity: strokeStyle.opacity ?? defaults.opacity ?? 1,
    width,
    eraserRadius: strokeStyle.eraserRadius ?? width,
  }
}

export const PEN_COLORS = [
  '#e8eef8',
  '#ffffff',
  '#f87171',
  '#60a5fa',
  '#c084fc',
  '#1e293b',
]

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
