import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPageDimensions, resolvePdfPageLayout } from '../src/utils/pdfFit.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PAGE = { width: 612, height: 792 }
const CONTAINER = { width: 900, height: 700 }

function readSrc(...parts) {
  return readFileSync(join(root, 'src', ...parts), 'utf8')
}

describe('library and practice PDF viewer geometry', () => {
  it('resolvePdfPageLayout exposes viewerRotation from centralized geometry', () => {
    const layout = resolvePdfPageLayout({
      fitMode: 'page',
      pageNumber: 1,
      slotPageNumber: 1,
      pageSize: PAGE,
      pageSizesByPage: { 1: PAGE },
      containerSize: CONTAINER,
      getPageViewRotation: () => 90,
    })

    expect(layout.viewerRotation).toBe(90)
    expect(layout.displayWidth).toBeGreaterThan(0)
    expect(layout.displayHeight).toBeGreaterThan(0)
    expect(layout.displayWidth / layout.displayHeight).toBeCloseTo(PAGE.height / PAGE.width, 4)
  })

  it('PdfPageWindow passes resolved viewerRotation into PdfPageFrame', () => {
    const source = readSrc('components', 'pdf', 'PdfPageWindow.jsx')
    expect(source).toContain('viewerRotation={layout.viewerRotation')
  })

  it('PdfPageFrame applies layout viewerRotation instead of score-follow props only', () => {
    const source = readSrc('components', 'pdf', 'PdfPageFrame.jsx')
    expect(source).toContain('viewerRotation = 0')
    expect(source).toMatch(/const viewRotation = viewerRotation/)
    expect(source).toContain('pdf-page-frame--rot-${viewRotation}')
  })

  it('Library and fullscreen viewers share usePdfViewerGeometry', () => {
    expect(readSrc('components', 'PdfViewer.jsx')).toContain('usePdfViewerGeometry')
    expect(readSrc('components', 'pdf', 'PdfFullscreen.jsx')).toContain('usePdfViewerGeometry')
    const hook = readSrc('hooks', 'usePdfViewerGeometry.js')
    expect(hook).toContain('pageViewRotations')
    expect(hook).toContain('computeDocumentDisplayReference')
    expect(hook).toContain('calibrationDebugSnapshot?.orientation')
    expect(hook).toContain('viewerRotationKey')
  })

  it('Library preview remounts page window only when rotations change', () => {
    const viewer = readSrc('components', 'PdfViewer.jsx')
    expect(viewer).toContain('pageWindowKey')
    expect(viewer).not.toContain('pageSizesVersion}::${viewerRotationKey')
    expect(viewer).toContain('upsertPdfPageSize')
    expect(viewer).toContain('useStableElementSize')
    expect(viewer).toContain('getCachedLibraryPageLayout')
  })

  it('upright pages keep zero viewer rotation', () => {
    const layout = getPageDimensions('page', PAGE, CONTAINER, 0)
    expect(layout.viewerRotation).toBe(0)
    expect(layout.displayWidth / layout.displayHeight).toBeCloseTo(PAGE.width / PAGE.height, 4)
  })
})
