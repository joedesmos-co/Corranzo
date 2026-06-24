import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  beginPageSwitch,
  clearWarmPages,
  completePageSwitch,
  isPageWarm,
  isPdfPerfEnabled,
  markPageWarm,
  notePageRender,
} from '../src/features/pdf/pdfPagePerf.js'

describe('pdfPagePerf', () => {
  beforeEach(() => {
    clearWarmPages()
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('tracks warm pages', () => {
    markPageWarm(2)
    expect(isPageWarm(2)).toBe(true)
    expect(isPageWarm(3)).toBe(false)
    clearWarmPages()
    expect(isPageWarm(2)).toBe(false)
  })

  it('logs slow rasterization above 50ms in dev', () => {
    expect(isPdfPerfEnabled()).toBe(true)
    notePageRender({ pageNumber: 4, phase: 'raster', durationMs: 72, width: 900 })
    expect(console.warn).toHaveBeenCalled()
    const payload = console.warn.mock.calls[0][1]
    expect(payload.bottleneck).toMatch(/rasterization/)
  })

  it('completes page switch with warm-page metadata', () => {
    beginPageSwitch({ fromPage: 1, toPage: 2, trigger: 'score-follow' })
    markPageWarm(2)
    completePageSwitch({ toPage: 2, wasWarm: true, rasterMs: 0 })
    expect(console.debug).toHaveBeenCalled()
    const payload = console.debug.mock.calls.at(-1)[1]
    expect(payload.wasWarm).toBe(true)
    expect(payload.trigger).toBe('score-follow')
  })
})
