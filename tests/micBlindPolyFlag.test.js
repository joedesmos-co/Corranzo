/**
 * Blind-poly prototype flag (Stage 2, S3): default OFF everywhere, explicit
 * opt-in only. The live path never consults it yet.
 */
import { describe, expect, it } from 'vitest'
import {
  decideMicBlindPolyEnabled,
  isMicBlindPolyEnabled,
  MIC_BLIND_POLY_FLAG,
  MIC_BLIND_POLY_STORAGE_KEY,
} from '../src/features/microphone-input/micEngineFlag.js'

describe('micBlindPoly flag', () => {
  it('is off by default in every environment', () => {
    expect(decideMicBlindPolyEnabled({})).toBe(false)
    expect(decideMicBlindPolyEnabled({ defaultEnabled: false })).toBe(false)
    expect(isMicBlindPolyEnabled()).toBe(false)
  })

  it('opts in explicitly via override, global, or storage', () => {
    expect(decideMicBlindPolyEnabled({ override: true })).toBe(true)
    expect(decideMicBlindPolyEnabled({ globalValue: '1' })).toBe(true)
    expect(decideMicBlindPolyEnabled({ storageValue: 'yes' })).toBe(true)
  })

  it('honors explicit false (never turns itself on)', () => {
    expect(decideMicBlindPolyEnabled({ override: false, defaultEnabled: true })).toBe(false)
    expect(decideMicBlindPolyEnabled({ storageValue: '0', defaultEnabled: true })).toBe(false)
  })

  it('exposes stable flag identifiers', () => {
    expect(MIC_BLIND_POLY_FLAG).toBe('micBlindPoly')
    expect(MIC_BLIND_POLY_STORAGE_KEY).toBe('scoreflow.flags.micBlindPoly')
  })
})
