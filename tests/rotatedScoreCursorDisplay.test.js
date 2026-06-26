import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getScoreFollowCursorSpanAxis,
  measurePdfOverlayLayout,
} from '../src/utils/pdfOverlayLayout.js'
import { getEffectivePageSize } from '../src/utils/pdfPageViewRotation.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

describe('rotated score cursor display geometry', () => {
  it('measures overlay layout from pre-transform page offsets', () => {
    const pageElement = {
      offsetLeft: 0,
      offsetTop: 0,
      offsetWidth: 640,
      offsetHeight: 480,
      getBoundingClientRect: () => ({
        left: 10,
        top: 20,
        width: 480,
        height: 640,
      }),
    }

    expect(measurePdfOverlayLayout(pageElement)).toEqual({
      left: 0,
      top: 0,
      width: 640,
      height: 480,
    })
  })

  it('returns null when the page element has no layout size', () => {
    expect(measurePdfOverlayLayout(null)).toBeNull()
    expect(
      measurePdfOverlayLayout({ offsetLeft: 0, offsetTop: 0, offsetWidth: 0, offsetHeight: 0 }),
    ).toBeNull()
  })

  it('uses swapped effective page dimensions for quarter-turn viewer rotation', () => {
    const raw = { width: 612, height: 792 }
    expect(getEffectivePageSize(raw, 90)).toEqual({ width: 792, height: 612 })
    expect(getEffectivePageSize(raw, 270)).toEqual({ width: 792, height: 612 })
    expect(getEffectivePageSize(raw, 0)).toEqual(raw)
    expect(getEffectivePageSize(raw, 180)).toEqual(raw)
  })

  it('spans the cursor along width for quarter turns and height when upright', () => {
    expect(getScoreFollowCursorSpanAxis(0)).toBe('height')
    expect(getScoreFollowCursorSpanAxis(180)).toBe('height')
    expect(getScoreFollowCursorSpanAxis(90)).toBe('width')
    expect(getScoreFollowCursorSpanAxis(270)).toBe('width')
  })

  it('PdfPageFrame measures overlay layout without bounding-client rects', () => {
    const source = readFileSync(join(root, 'src/components/pdf/PdfPageFrame.jsx'), 'utf8')
    expect(source).toContain('measurePdfOverlayLayout')
    expect(source).not.toContain('getBoundingClientRect')
  })

  it('quarter-turn cursor CSS swaps bar span axis', () => {
    const css = readFileSync(join(root, 'src/App.css'), 'utf8')
    expect(css).toMatch(
      /\.pdf-page-frame--rot-90 \.score-follow-cursor,\s*\n\.pdf-page-frame--rot-270 \.score-follow-cursor\s*\{[^}]*width:\s*9%/,
    )
    expect(css).toMatch(
      /\.pdf-page-frame--rot-90 \.score-follow-cursor__line,\s*\n\.pdf-page-frame--rot-270 \.score-follow-cursor__line\s*\{[^}]*height:\s*2px/,
    )
    const uprightBlock = css.match(/^\.score-follow-cursor\s*\{([^}]*)\}/m)?.[1] ?? ''
    expect(uprightBlock).toMatch(/height:\s*9%/)
    expect(uprightBlock).toMatch(/width:\s*0/)
  })

  it('upright pages keep the default vertical cursor bar', () => {
    const css = readFileSync(join(root, 'src/App.css'), 'utf8')
    const lineBlock = css.match(/^\.score-follow-cursor__line\s*\{([^}]*)\}/m)?.[1] ?? ''
    expect(lineBlock).toMatch(/width:\s*2px/)
    expect(lineBlock).toMatch(/height:\s*100%/)
    expect(css).not.toMatch(/\.pdf-page-frame--rot-180 \.score-follow-cursor/)
  })
})
