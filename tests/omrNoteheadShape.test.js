import { describe, expect, it } from 'vitest'
import { detectNoteheadsInMeasure } from '../src/features/omr/detectOmrNoteheads.js'

// Notation-pattern regressions for the raster notehead detector. Each builds a
// synthetic measure with one notation feature and asserts that only real
// noteheads survive — beams, stems, ledger lines, barlines, dots and
// articulations must not be counted as notes. These are generic patterns, not
// fixtures of any particular score.

const WIDTH = 260
const HEIGHT = 180
const INK = 24
const TREBLE = [44, 52, 60, 68, 76] // 5 staff lines, 8px gap  => staff space 8px
const BASS = [108, 116, 124, 132, 140]

function blankMeasure() {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255)
  return { data, width: WIDTH, height: HEIGHT }
}
function px(img, x, y, v = INK) {
  const ix = Math.round(x)
  const iy = Math.round(y)
  if (ix < 0 || iy < 0 || ix >= img.width || iy >= img.height) return
  const i = (iy * img.width + ix) * 4
  img.data[i] = img.data[i + 1] = img.data[i + 2] = v
}
function hLine(img, y, x0, x1) {
  for (let x = x0; x <= x1; x += 1) px(img, x, y)
}
function vLine(img, x, y0, y1) {
  for (let y = y0; y <= y1; y += 1) px(img, x, y)
}
function rect(img, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) px(img, x, y)
}
// A filled notehead ~ one staff space across.
function filledHead(img, cx, cy) {
  rect(img, cx - 4, cy - 3, cx + 4, cy + 3)
}
function staff(img) {
  for (const y of [...TREBLE, ...BASS]) hLine(img, y, 24, 236)
}
function measureBox() {
  return {
    measureNumber: 1,
    page: 1,
    x0: 12 / WIDTH,
    x1: 248 / WIDTH,
    playableX0: 34 / WIDTH,
    y0: 34 / HEIGHT,
    y1: 150 / HEIGHT,
    staffLines: {
      treble: TREBLE.map((y) => y / HEIGHT),
      bass: BASS.map((y) => y / HEIGHT),
      splitY: ((TREBLE[4] + BASS[0]) / 2) / HEIGHT,
    },
  }
}
function detect(img) {
  return detectNoteheadsInMeasure(img, measureBox(), 170, {})
}

describe('raster notehead detector rejects non-notehead ink', () => {
  it('detects a single notehead even with stem, beam, ledger line and barline present', () => {
    const img = blankMeasure()
    staff(img)
    const cx = 120
    const cy = 56 // a treble space
    filledHead(img, cx, cy)
    vLine(img, cx + 4, cy - 34, cy) // stem
    rect(img, cx + 4, cy - 36, cx + 26, cy - 33) // beam at the stem tip
    hLine(img, 36, cx - 7, cx + 7) // ledger line above the staff
    vLine(img, 232, 40, 144) // right barline
    const notes = detect(img)
    expect(notes.length).toBe(1)
    expect(Math.abs(notes[0].cx - cx)).toBeLessThanOrEqual(4)
  })

  it('keeps stacked chord tones a third apart as separate notes', () => {
    const img = blankMeasure()
    staff(img)
    const cx = 120
    filledHead(img, cx, 60) // on a line
    filledHead(img, cx, 60 - 8) // a third above (one staff space)
    const notes = detect(img)
    expect(notes.length).toBe(2)
    const ys = notes.map((n) => n.cy).sort((a, b) => a - b)
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(6)
  })

  it('does not turn a staccato dot / augmentation dot into a notehead', () => {
    const img = blankMeasure()
    staff(img)
    rect(img, 120, 58, 123, 61) // a tiny 4x4 dot in a treble space
    expect(detect(img).length).toBe(0)
  })

  it('does not turn a thin horizontal stroke (beam edge / ledger line / tie) into a notehead', () => {
    const img = blankMeasure()
    staff(img)
    rect(img, 104, 36, 144, 37) // a thin horizontal stroke above the staff
    expect(detect(img).length).toBe(0)
  })
})
