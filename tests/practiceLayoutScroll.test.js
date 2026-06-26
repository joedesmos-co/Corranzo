/**
 * Practice layout scroll — sidebar must scroll when controls exceed viewport height.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const practiceCss = readFileSync(join(root, 'src', 'styles', 'practice.css'), 'utf8')
const indexCss = readFileSync(join(root, 'src', 'index.css'), 'utf8')

function blockAfter(selector) {
  const start = practiceCss.indexOf(selector)
  expect(start).toBeGreaterThanOrEqual(0)
  return practiceCss.slice(start, practiceCss.indexOf('}', start) + 1)
}

describe('practice sidebar scroll layout', () => {
  it('practice control panel scrolls vertically', () => {
    const panel = blockAfter('.practice-control-panel {')
    expect(panel).toMatch(/overflow-y:\s*auto/)
    expect(panel).toMatch(/min-height:\s*0/)
  })

  it('flex ancestors constrain height so nested regions can scroll', () => {
    expect(blockAfter('.practice-workspace {')).toMatch(/min-height:\s*0/)
    expect(blockAfter('.practice-workspace {')).toMatch(/max-height:\s*calc\(/)
    expect(blockAfter('.practice-workspace__layout {')).toMatch(/min-height:\s*0/)
    expect(blockAfter('.practice-workspace__score {')).toMatch(/min-height:\s*0/)
    expect(blockAfter('.practice-workspace__score {')).toMatch(/overflow-y:\s*auto/)
  })

  it('panel sections shrink horizontally only so footer setup stays reachable', () => {
    const sections = practiceCss.slice(
      practiceCss.indexOf('.practice-control-panel__primary,'),
      practiceCss.indexOf('.practice-more {') + practiceCss.slice(practiceCss.indexOf('.practice-more {')).indexOf('}') + 1,
    )
    expect(sections).toMatch(/overflow-x:\s*hidden/)
    expect(sections).not.toMatch(/overflow:\s*hidden/)
    expect(sections).toMatch(/flex-shrink:\s*0/)
    expect(practiceCss).toMatch(/\.practice-control-panel > \*\s*\{[^}]*flex-shrink:\s*0/)
  })

  it('does not globally lock body scroll on normal pages', () => {
    expect(indexCss).not.toMatch(/body\s*\{[^}]*overflow:\s*hidden/)
    expect(indexCss).not.toMatch(/html\s*\{[^}]*overflow:\s*hidden/)
    expect(indexCss).not.toMatch(/#root\s*\{[^}]*overflow:\s*hidden/)
  })
})
