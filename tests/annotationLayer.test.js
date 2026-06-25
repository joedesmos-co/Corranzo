import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_TOOLS,
  resolveAnnotationStrokeStyle,
} from '../src/components/pdf/annotationConstants.js'

const __dir = dirname(fileURLToPath(import.meta.url))

function brushRadiusPx(strokeStyle, activeTool, pageWidth = 320) {
  const resolved = resolveAnnotationStrokeStyle(strokeStyle, activeTool)
  return (resolved.eraserRadius ?? resolved.width) * pageWidth
}

describe('resolveAnnotationStrokeStyle', () => {
  it('returns pen defaults when strokeStyle is null', () => {
    const style = resolveAnnotationStrokeStyle(null, ANNOTATION_TOOLS.PEN)
    expect(style.width).toBeGreaterThan(0)
    expect(style.color).toBe('#a855f7')
    expect(style.opacity).toBeGreaterThan(0)
  })

  it('returns eraser defaults with eraserRadius when strokeStyle is null', () => {
    const style = resolveAnnotationStrokeStyle(null, ANNOTATION_TOOLS.ERASER)
    expect(style.eraserRadius).toBe(style.width)
    expect(style.width).toBeGreaterThan(0)
  })

  it('fills missing fields on partial strokeStyle objects', () => {
    const style = resolveAnnotationStrokeStyle({ width: 0.01 }, ANNOTATION_TOOLS.HIGHLIGHTER)
    expect(style.width).toBe(0.01)
    expect(style.color).toBeTruthy()
    expect(style.opacity).toBeGreaterThan(0)
  })

  it('supports the AnnotationLayer brush-radius path when strokeStyle is null', () => {
    expect(() => brushRadiusPx(null, ANNOTATION_TOOLS.ERASER)).not.toThrow()
    expect(brushRadiusPx(null, ANNOTATION_TOOLS.ERASER)).toBeGreaterThan(0)
    expect(brushRadiusPx(null, ANNOTATION_TOOLS.PEN)).toBeGreaterThan(0)
  })
})

describe('AnnotationLayer restore / warm-slot guards', () => {
  it('PdfPageWindow warm slots no longer pass strokeStyle: null', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'components', 'pdf', 'PdfPageWindow.jsx'),
      'utf8',
    )
    expect(src).not.toMatch(/strokeStyle:\s*null/)
    expect(src).toMatch(/resolveAnnotationStrokeStyle/)
  })

  it('AnnotationLayer uses resolveAnnotationStrokeStyle before eraserRadius access', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'components', 'pdf', 'AnnotationLayer.jsx'),
      'utf8',
    )
    expect(src).toMatch(/resolveAnnotationStrokeStyle/)
    expect(src).toMatch(/resolvedStrokeStyle\.eraserRadius/)
    expect(src).not.toMatch(/strokeStyle\.eraserRadius/)
  })
})
