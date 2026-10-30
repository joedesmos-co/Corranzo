import { describe, expect, it } from 'vitest'
import { createPage } from './helpers/syntheticScore.js'
import { detectContentBounds } from '../src/features/score-follow/detectStaffSystems.js'
import { detectStaffLineSystems } from '../src/features/score-follow/detectStaffLines.js'

function drawStaff(img, topY, x0 = 80, x1 = 400) {
  for (let line = 0; line < 5; line += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const index = ((topY + line * 5) * img.width + x) * 4
      img.data[index] = 24
      img.data[index + 1] = 24
      img.data[index + 2] = 24
    }
  }
}

function drawBrace(img, x, y0, y1) {
  for (let y = y0; y <= y1; y += 1) {
    const index = (y * img.width + x) * 4
    img.data[index] = 24
    img.data[index + 1] = 24
    img.data[index + 2] = 24
  }
}

describe('grand-staff connector evidence', () => {
  it('pairs two staves when a full-gap brace column is present', () => {
    const img = createPage(460, 620)
    drawStaff(img, 100)
    drawStaff(img, 170)
    drawBrace(img, 60, 100, 190)
    const content = detectContentBounds(img)
    const detected = detectStaffLineSystems(img, content, { stavesPerSystem: 2, countBarlines: false })
    expect(detected.staves.length).toBe(2)
    expect(detected.systems.length).toBe(1)
    expect(detected.systems[0].staveCount).toBe(2)
  })

  it('keeps sequential single-staff systems separate without a connector', () => {
    const img = createPage(460, 620)
    drawStaff(img, 100)
    drawStaff(img, 170)
    const content = detectContentBounds(img)
    const detected = detectStaffLineSystems(img, content, { stavesPerSystem: 2, countBarlines: false })
    expect(detected.staves.length).toBe(2)
    expect(detected.systems.length).toBe(2)
  })
})
