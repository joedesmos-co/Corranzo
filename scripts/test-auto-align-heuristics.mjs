/**
 * Lightweight heuristic checks for auto-align (no PDF required).
 * Run: node scripts/test-auto-align-heuristics.mjs
 */
import {
  detectConservativeStaffSystems,
  detectContentBounds,
  scoreStaffBandQuality,
  computeRowDensityInContent,
} from '../src/features/score-follow/detectStaffSystems.js'
import { validateAutoAlignResult } from '../src/features/score-follow/autoAlignValidation.js'

function createImage(width, height, draw) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255
    data[index + 1] = 255
    data[index + 2] = 255
    data[index + 3] = 255
  }
  draw(data, width, height)
  return { width, height, data }
}

function strokeH(data, width, y, x0, x1, value = 20) {
  for (let x = x0; x <= x1; x += 1) {
    const index = (y * width + x) * 4
    data[index] = value
    data[index + 1] = value
    data[index + 2] = value
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function drawStaffBlock(data, width, baseY, x0, x1) {
  for (let line = 0; line < 5; line += 1) {
    strokeH(data, width, baseY + line * 5, x0, x1)
  }
}

// Title/header band — should NOT pass conservative detection
const withTitle = createImage(400, 600, (data, width, height) => {
  for (let line = 0; line < 8; line += 1) {
    strokeH(data, width, 40 + line * 5, 60, 340)
  }
  drawStaffBlock(data, width, Math.floor(height * 0.35), 80, 320)
})
const titleSystems = detectConservativeStaffSystems(withTitle)
assert(
  titleSystems.length <= 1,
  `title/header ink should not produce multiple staff systems, got ${titleSystems.length}`,
)
if (titleSystems.length > 0) {
  assert(
    titleSystems[0].y0 >= 0.14,
    'remaining system should be below header cutoff',
  )
}

// Real staff
const staffPage = createImage(300, 400, (data, width, height) => {
  drawStaffBlock(data, width, Math.floor(height * 0.35), 40, width - 40)
})
const staffSystems = detectConservativeStaffSystems(staffPage)
assert(staffSystems.length >= 1, 'should detect at least one staff')

const bounds = detectContentBounds(staffPage)
const rowDensity = computeRowDensityInContent(staffPage, bounds)
const quality = scoreStaffBandQuality(staffPage, staffSystems[0], rowDensity)
assert(quality >= 0.6, `staff quality should pass, got ${quality}`)

// Validation rejects dense rows
const fakeAnchors = Array.from({ length: 8 }, (_, index) => ({
  page: 1,
  x: 0.1 + index * 0.08,
  y: 0.5,
  measureNumber: index + 1,
}))
const fakeEntries = [{ page: 1, system: { y0: 0.4, y1: 0.55, center: 0.475 } }]
const rowCheck = validateAutoAlignResult({
  anchors: fakeAnchors,
  systemEntries: fakeEntries,
  measureCount: 32,
})
assert(!rowCheck.ok, 'should reject row of markers on one system')

console.log('All conservative auto-align heuristic checks passed.')
