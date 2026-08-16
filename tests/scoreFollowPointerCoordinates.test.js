import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readSrc(...parts) {
  return readFileSync(join(root, 'src', ...parts), 'utf8')
}

describe('rotated score-follow pointer coordinates', () => {
  it('treats transformed display-rect percentages as analysis coordinates', () => {
    const overlay = readSrc('components', 'pdf', 'ScoreFollowOverlay.jsx')
    expect(overlay).toContain('getBoundingClientRect()')
    expect(overlay).toContain('clientToNormalized(event.clientX, event.clientY, rect)')

    const scoreFollow = readSrc('features', 'score-follow', 'useScoreFollow.js')
    expect(scoreFollow).toContain('normalizeViewerDisplayPoint')
    expect(scoreFollow.match(/normalizeViewerDisplayPoint\(x, y\)/g)).toHaveLength(2)
    expect(scoreFollow).not.toContain('mapViewerOverlayToAnalysisPoint')
  })
})
