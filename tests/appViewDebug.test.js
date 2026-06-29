import { describe, expect, it } from 'vitest'
import { normalizeAppView } from '../src/features/navigation/appViewDebug.js'

describe('appViewDebug', () => {
  it('normalizes unknown views to library', () => {
    expect(normalizeAppView('practice')).toBe('practice')
    expect(normalizeAppView('')).toBe('library')
    expect(normalizeAppView(null)).toBe('library')
    expect(normalizeAppView('not-a-view')).toBe('library')
  })
})
