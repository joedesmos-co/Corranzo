import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ICON_NAMES, hasIcon, iconShapes } from '../src/design/iconPaths.js'
import { PRACTICE_MODES, PRACTICE_MODE_OPTIONS, isPracticeMode } from '../src/design/modeOptions.js'

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const tokensCss = readFileSync(path.join(repoRoot, 'src/styles/tokens.css'), 'utf8')

function tokenValue(name) {
  const match = tokensCss.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))
  return match ? match[1].trim() : null
}

function luminance(hex) {
  const rgb = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('phase A design tokens', () => {
  it('preserves every pre-existing --sf-* token (no silent restyle)', () => {
    for (const name of [
      '--sf-bg-app',
      '--sf-bg-panel',
      '--sf-border',
      '--sf-text-primary',
      '--sf-accent',
      '--sf-focus-ring',
      '--sf-sidebar-width',
      '--sf-topbar-height',
      '--sf-ease',
      '--sf-duration-fast',
    ]) {
      expect(tokenValue(name), name).toBeTruthy()
    }
  })

  it('adds the studio-console token families', () => {
    for (const name of [
      '--cz-desk',
      '--cz-paper',
      '--cz-paper-ink',
      '--cz-motif-line',
      '--cz-signal',
      '--cz-signal-strong',
      '--cz-signal-ink',
      '--cz-signal-muted',
      '--cz-ok-text',
      '--cz-ok-bg',
      '--cz-ok-border',
      '--cz-warn-text',
      '--cz-warn-bg',
      '--cz-warn-border',
      '--cz-err-text',
      '--cz-err-bg',
      '--cz-err-border',
      '--cz-font-sans',
      '--cz-font-editorial',
      '--cz-font-mono',
      '--cz-space-3xs',
      '--cz-space-2xs',
      '--cz-chrome-padding',
      '--cz-radius-control',
      '--cz-radius-deck',
      '--cz-shadow-sheet',
      '--cz-shadow-deck',
      '--cz-shadow-pop',
      '--cz-duration-instant',
      '--cz-duration-slow',
      '--cz-control-h-sm',
      '--cz-control-h-md',
      '--cz-control-h-lg',
      '--cz-target-min',
    ]) {
      expect(tokenValue(name), name).toBeTruthy()
    }
  })

  it('separates brand gold from warning orange (different hues, never confused)', () => {
    const brand = tokenValue('--cz-signal')
    const warn = tokenValue('--cz-warn-text')
    expect(brand).toBeTruthy()
    expect(warn).toBeTruthy()
    expect(brand.toLowerCase()).not.toBe(warn.toLowerCase())
  })

  it('keeps status + signal text readable on dark surfaces (AA)', () => {
    expect(contrast(tokenValue('--cz-signal'), '#000000')).toBeGreaterThanOrEqual(7)
    expect(contrast(tokenValue('--cz-ok-text'), '#000000')).toBeGreaterThanOrEqual(7)
    expect(contrast(tokenValue('--cz-warn-text'), '#000000')).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tokenValue('--cz-err-text'), '#000000')).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(tokenValue('--cz-signal-ink'), tokenValue('--cz-signal')),
    ).toBeGreaterThanOrEqual(7)
  })
})

describe('phase A icon registry', () => {
  it('covers transport, practice, annotation, status, and navigation needs', () => {
    for (const name of [
      'home',
      'library',
      'practice',
      'import',
      'settings',
      'play',
      'pause',
      'stop',
      'metronome',
      'loop',
      'tracks',
      'mic',
      'keyboard',
      'pen',
      'highlighter',
      'eraser',
      'undo',
      'follow',
      'check',
      'warn',
      'error',
      'info',
      'close',
      'search',
      'music',
    ]) {
      expect(hasIcon(name), name).toBe(true)
    }
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(24)
  })

  it('every icon has at least one well-formed shape', () => {
    for (const name of ICON_NAMES) {
      const shapes = iconShapes[name]
      expect(Array.isArray(shapes) && shapes.length > 0, name).toBe(true)
      for (const shape of shapes) {
        expect(shape.d ?? shape.c, `${name} shape`).toBeTruthy()
      }
    }
  })
})

describe('phase A three-state mode vocabulary', () => {
  it('defines exactly Preview / Play Along / Wait For You in order', () => {
    expect(PRACTICE_MODE_OPTIONS.map((option) => option.value)).toEqual([
      PRACTICE_MODES.PREVIEW,
      PRACTICE_MODES.PLAY_ALONG,
      PRACTICE_MODES.WAIT_FOR_YOU,
    ])
    expect(PRACTICE_MODE_OPTIONS.map((option) => option.label)).toEqual([
      'Preview',
      'Play Along',
      'Wait For You',
    ])
    for (const option of PRACTICE_MODE_OPTIONS) {
      expect(option.hint.length, option.value).toBeGreaterThan(5)
      expect(isPracticeMode(option.value)).toBe(true)
    }
    expect(isPracticeMode('normal')).toBe(false)
  })
})
