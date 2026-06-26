import { describe, expect, it } from 'vitest'
import {
  arePdfPageSizesEqual,
  upsertPdfPageSize,
} from '../src/utils/pdfPageSizeCache.js'
import {
  buildLibraryLayoutCacheKey,
  getCachedLibraryPageLayout,
} from '../src/utils/pdfViewerLayoutCache.js'
import { resolvePdfPageLayout } from '../src/utils/pdfFit.js'

const PAGE_A = { width: 612, height: 792 }
const PAGE_B = { width: 612, height: 792 }
const CONTAINER = { width: 900, height: 700 }
const REFERENCE = { correctedWidth: 792, correctedHeight: 612 }

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
  it('keys cache entries by document reference and page rotation', () => {
    const cache = new Map()
    const shared = {
      fitMode: 'page',
      containerSize: CONTAINER,
      referenceDisplaySize: REFERENCE,
      viewerRotationKey: '1:90|2:90',
      slotPageNumber: 1,
      viewRotation: 90,
    }
    const first = { displayWidth: 500, displayHeight: 650, viewerRotation: 90 }
    const second = { displayWidth: 520, displayHeight: 670, viewerRotation: 90 }

    const key = buildLibraryLayoutCacheKey(shared)
    expect(getCachedLibraryPageLayout(cache, key, first)).toEqual(first)
    expect(getCachedLibraryPageLayout(cache, key, second)).toEqual(first)

    const otherPageKey = buildLibraryLayoutCacheKey({ ...shared, slotPageNumber: 2 })
    expect(otherPageKey).not.toBe(key)
  })

  it('library pages share display scale when document reference matches', () => {
    const pageSizes = { 1: PAGE_A, 2: PAGE_B }
    const getRotation = () => 90
    const layout1 = resolvePdfPageLayout({
      fitMode: 'page',
      pageNumber: 1,
      slotPageNumber: 1,
      pageSize: PAGE_A,
      pageSizesByPage: pageSizes,
      containerSize: CONTAINER,
      getPageViewRotation: getRotation,
      referenceDisplaySize: REFERENCE,
    })
    const layout2 = resolvePdfPageLayout({
      fitMode: 'page',
      pageNumber: 2,
      slotPageNumber: 2,
      pageSize: PAGE_B,
      pageSizesByPage: pageSizes,
      containerSize: CONTAINER,
      getPageViewRotation: getRotation,
      referenceDisplaySize: REFERENCE,
    })

    expect(layout1.displayWidth).toBeCloseTo(layout2.displayWidth, 4)
    expect(layout1.displayHeight).toBeCloseTo(layout2.displayHeight, 4)
  })
})
