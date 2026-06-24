import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_PIECE, FIXTURE_FILENAMES, FIXTURE_PATHS } from '../src/dev/fixturePaths.js'
import { validateDemoBundledPayload } from '../src/features/demo/demoBundledAnchors.js'
import { isDemoFixtureFileSet } from '../src/features/demo/demoBundledAnchors.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = join(root, 'public')

function fixturePath(urlPath) {
  return join(publicRoot, urlPath.replace(/^\//, ''))
}

describe('Hungarian Dance demo fixtures', () => {
  it('exposes Hungarian Dance as the built-in demo piece', () => {
    expect(DEMO_PIECE.id).toBe('hungarian-dance-no5')
    expect(DEMO_PIECE.title).toContain('Hungarian Dance')
    expect(DEMO_PIECE.measureCount).toBe(104)
    expect(DEMO_PIECE.pageCount).toBe(4)
  })

  it('ships pdf, mxl, midi, and bundled anchors on disk', () => {
    for (const path of Object.values(FIXTURE_PATHS)) {
      expect(existsSync(fixturePath(path)), path).toBe(true)
    }
  })

  it('recognizes the demo file set by filename', () => {
    expect(
      isDemoFixtureFileSet(FIXTURE_FILENAMES.pdf, FIXTURE_FILENAMES.musicXml),
    ).toBe(true)
  })

  it('validates bundled score-follow anchors', () => {
    const payload = JSON.parse(
      readFileSync(fixturePath(FIXTURE_PATHS.demoAnchors), 'utf8'),
    )
    const result = validateDemoBundledPayload(payload)
    expect(result.ok).toBe(true)
    expect(result.anchors).toHaveLength(104)
  })
})
