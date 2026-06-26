import { describe, expect, it } from 'vitest'
import {
  arePdfPageSizesEqual,
  upsertPdfPageSize,
} from '../src/utils/pdfPageSizeCache.js'
import { getCachedLibraryPageLayout } from '../src/utils/pdfViewerLayoutCache.js'

describe('pdfPageSizeCache', () => {
  it('treats sub-pixel drift as unchanged', () => {
    const a = { width: 612, height: 792 }
    const b = { width: 612.4, height: 791.8 }
    expect(arePdfPageSizesEqual(a, b)).toBe(true)
  })

  it('upsert skips cache bumps for unchanged dimensions', () => {
    const cache = {}
    expect(upsertPdfPageSize(cache, 1, { width: 612, height: 792 })).toBe(true)
    expect(upsertPdfPageSize(cache, 1, { width: 612.2, height: 792.1 })).toBe(false)
    expect(cache[1]).toEqual({ width: 612, height: 792 })
  })
})

describe('pdfViewerLayoutCache', () => {
  it('locks the first resolved library layout per slot', () => {
    const cache = new Map()
    const first = {
      width: 500,
      height: 700,
      displayWidth: 500,
      displayHeight: 700,
      viewerRotation: 90,
    }
    const second = {
      width: 520,
      height: 720,
      displayWidth: 520,
      displayHeight: 720,
      viewerRotation: 90,
    }

    expect(getCachedLibraryPageLayout(cache, 1, first)).toEqual(first)
    expect(getCachedLibraryPageLayout(cache, 1, second)).toEqual(first)
  })
})
