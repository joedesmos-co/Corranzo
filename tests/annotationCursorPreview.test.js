import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  clientToNormalized,
  clientToPageLocal,
  isPointInsidePage,
} from '../src/utils/annotationPointer.js'

const __dir = dirname(fileURLToPath(import.meta.url))

describe('annotation cursor preview coordinates', () => {
  const centeredPageRect = {
    left: 220,
    top: 140,
    width: 360,
    height: 480,
    right: 580,
    bottom: 620,
  }

  it('maps client coordinates into page-local preview coordinates', () => {
    expect(clientToPageLocal(400, 300, centeredPageRect)).toEqual({
      x: 180,
      y: 160,
    })
  })

  it('keeps preview aligned when the page is centered in a wider viewport', () => {
    const local = clientToPageLocal(360, 260, centeredPageRect)
    const normalized = clientToNormalized(360, 260, centeredPageRect)

    expect(local).toEqual({ x: 140, y: 120 })
    expect(normalized).toEqual({
      x: 140 / centeredPageRect.width,
      y: 120 / centeredPageRect.height,
    })
  })

  it('uses the same page rect for drawing and preview conversion', () => {
    const clientX = 500
    const clientY = 400
    const normalized = clientToNormalized(clientX, clientY, centeredPageRect)
    const local = clientToPageLocal(clientX, clientY, centeredPageRect)

    expect(normalized.x).toBeCloseTo(local.x / centeredPageRect.width, 6)
    expect(normalized.y).toBeCloseTo(local.y / centeredPageRect.height, 6)
  })

  it('hides preview outside the page bounds', () => {
    expect(isPointInsidePage(180, 300, centeredPageRect)).toBe(false)
    expect(isPointInsidePage(400, 300, centeredPageRect)).toBe(true)
  })
})

describe('annotation cursor preview rendering', () => {
  it('positions the brush cursor absolutely within the page layer', () => {
    const css = readFileSync(join(__dir, '..', 'src', 'App.css'), 'utf8')
    const brushBlock = css.match(/\.brush-cursor\s*\{[^}]+\}/)?.[0] ?? ''
    expect(brushBlock).toMatch(/position:\s*absolute/)
    expect(brushBlock).not.toMatch(/position:\s*fixed/)
  })

  it('reads live page rects and page-local cursor coords in AnnotationLayer', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'components', 'pdf', 'AnnotationLayer.jsx'),
      'utf8',
    )
    expect(src).toMatch(/clientToPageLocal/)
    expect(src).toMatch(/readPageRect\(layerRef\)/)
    expect(src).toMatch(/annotation-layer-root/)
    expect(src).not.toMatch(/position:\s*fixed/)
    expect(src).not.toMatch(/x:\s*event\.clientX/)
  })
})
