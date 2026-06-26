import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  getFitPageWidth,
  getFitWidth,
  getPageDimensions,
  PRACTICE_CANVAS_PADDING,
} from '../src/utils/pdfFit.js'
import { resetPdfCanvasScroll } from '../src/utils/pdfViewerScroll.js'

const PAGE = { width: 612, height: 792 }

describe('pdfFit', () => {
  it('fit page scale is valid and nonzero', () => {
    const width = getFitPageWidth(PAGE.width, PAGE.height, 1000, 800)
    expect(width).toBeGreaterThan(0)
    expect(Number.isFinite(width)).toBe(true)
  })

  it('fit page dimensions fit inside the padded container', () => {
    const container = { width: 400, height: 300 }
    const dims = getPageDimensions('page', PAGE, container)
    expect(dims.width).toBeGreaterThan(0)
    expect(dims.height).toBeGreaterThan(0)
    expect(dims.width).toBeLessThanOrEqual(container.width - 32)
    expect(dims.height).toBeLessThanOrEqual(container.height - 32)
    expect(dims.height / dims.width).toBeCloseTo(PAGE.height / PAGE.width, 4)
  })

  it('fit width still uses full inner container width', () => {
    const container = { width: 900, height: 700 }
    const dims = getPageDimensions('width', PAGE, container)
    expect(dims.width).toBe(getFitWidth(PAGE.width, container.width))
    expect(dims.height).toBeUndefined()
  })

  it('switching from fit width to fit page keeps valid page dimensions', () => {
    const container = { width: 900, height: 700 }
    const widthDims = getPageDimensions('width', PAGE, container)
    const pageDims = getPageDimensions('page', PAGE, container)

    expect(widthDims.width).toBeGreaterThan(pageDims.width)
    expect(pageDims.width).toBeGreaterThan(0)
    expect(pageDims.height).toBeGreaterThan(0)
    expect(pageDims.height).toBeLessThanOrEqual(container.height - 32)
  })

  it('practice mode uses a smaller fit margin for a larger default page', () => {
    const container = { width: 900, height: 700 }
    const libraryDims = getPageDimensions('page', PAGE, container)
    const practiceDims = getPageDimensions('page', PAGE, container, 0, PRACTICE_CANVAS_PADDING)
    expect(practiceDims.height).toBeGreaterThan(libraryDims.height)
    expect(practiceDims.width).toBeGreaterThan(libraryDims.width)
  })

  it('returns empty dimensions when container size is unknown', () => {
    expect(getPageDimensions('page', PAGE, { width: 0, height: 0 })).toEqual({})
  })
})

describe('pdfViewerScroll', () => {
  it('resets scroll position on the canvas container', () => {
    const element = { scrollTop: 480, scrollLeft: 12 }
    resetPdfCanvasScroll(element)
    expect(element.scrollTop).toBe(0)
    expect(element.scrollLeft).toBe(0)
  })

  it('PdfViewer resets scroll when entering fit page', () => {
    const root = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(root, '../src/components/PdfViewer.jsx'), 'utf8')
    expect(source).toContain('resetPdfCanvasScroll')
    expect(source).toMatch(/fitMode === 'page'/)
  })
})
