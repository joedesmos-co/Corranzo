import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_TOOLS,
  DEFAULT_PEN_COLOR,
  DEFAULT_TOOL_SETTINGS,
  PEN_COLORS,
  normalizePenColor,
  normalizeToolSettings,
  resolveAnnotationStrokeStyle,
} from '../src/components/pdf/annotationConstants.js'

const __dir = dirname(fileURLToPath(import.meta.url))

function isWhiteColor(color) {
  const normalized = String(color).trim().toLowerCase()
  return normalized === '#ffffff' || normalized === '#fff'
}

describe('annotation color picker', () => {
  it('uses a visible purple default pen color instead of white', () => {
    expect(DEFAULT_PEN_COLOR).toBe('#a855f7')
    expect(DEFAULT_TOOL_SETTINGS.pen.color).toBe(DEFAULT_PEN_COLOR)
    expect(isWhiteColor(DEFAULT_TOOL_SETTINGS.pen.color)).toBe(false)
    expect(isWhiteColor(DEFAULT_PEN_COLOR)).toBe(false)
  })

  it('exposes only one white swatch in the pen palette', () => {
    const whiteSwatches = PEN_COLORS.filter(isWhiteColor)
    expect(whiteSwatches).toHaveLength(1)
    expect(PEN_COLORS).not.toContain('#e8eef8')
    expect(new Set(PEN_COLORS).size).toBe(PEN_COLORS.length)
  })

  it('normalizes deprecated near-white saved colors to the visible default', () => {
    expect(normalizePenColor('#e8eef8')).toBe(DEFAULT_PEN_COLOR)
    expect(
      normalizeToolSettings({
        pen: { color: '#e8eef8', opacity: 1, width: 0.004 },
      }).pen.color,
    ).toBe(DEFAULT_PEN_COLOR)
  })

  it('keeps palette selection aligned when updating pen color', () => {
    const next = normalizeToolSettings({
      pen: { color: '#60a5fa', opacity: 1, width: 0.004 },
    })
    expect(next.pen.color).toBe('#60a5fa')
    expect(PEN_COLORS).toContain(next.pen.color)
  })

  it('renders the color palette in a contained layout', () => {
    const css = readFileSync(join(__dir, '..', 'src', 'App.css'), 'utf8')
    expect(css).toMatch(/\.ann-settings__colors[\s\S]*flex-wrap:\s*wrap/)
    expect(css).toMatch(/\.tb-popover__panel--brush-settings[\s\S]*right:\s*0/)
    expect(css).toMatch(/\.ann-settings--compact[\s\S]*flex:\s*none/)
  })

  it('still resolves drawable stroke styles after color changes', () => {
    const style = resolveAnnotationStrokeStyle(
      { color: '#60a5fa', opacity: 1, width: 0.004 },
      ANNOTATION_TOOLS.PEN,
    )
    expect(style.color).toBe('#60a5fa')
    expect(style.width).toBeGreaterThan(0)

    const defaultStyle = resolveAnnotationStrokeStyle(null, ANNOTATION_TOOLS.PEN)
    expect(defaultStyle.color).toBe(DEFAULT_PEN_COLOR)
    expect(defaultStyle.width).toBeGreaterThan(0)
  })
})
