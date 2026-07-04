import { describe, expect, it } from 'vitest'
import {
  decideMicEngineV2Enabled,
  isMicEngineV2Enabled,
  MIC_ENGINE_MODE,
  MIC_ENGINE_V2_FLAG,
  MIC_ENGINE_V2_STORAGE_KEY,
  resolveFlagOverride,
} from '../src/features/microphone-input/micEngineFlag.js'

describe('micEngineFlag', () => {
  it('always enables V2 when no sources are set', () => {
    expect(decideMicEngineV2Enabled({ devDefault: true })).toBe(true)
    expect(decideMicEngineV2Enabled({ devDefault: true, globalValue: null, storageValue: null })).toBe(
      true,
    )
    expect(decideMicEngineV2Enabled({ devDefault: false })).toBe(true)
  })

  it('ignores explicit false legacy opt-outs because V2 is the only live engine', () => {
    expect(
      decideMicEngineV2Enabled({
        devDefault: true,
        storageValue: 'false',
      }),
    ).toBe(true)
    expect(
      decideMicEngineV2Enabled({
        devDefault: true,
        globalValue: false,
      }),
    ).toBe(true)
    expect(
      decideMicEngineV2Enabled({
        override: false,
        globalValue: false,
        storageValue: false,
        devDefault: false,
      }),
    ).toBe(true)
  })

  it('keeps explicit true values harmlessly enabled', () => {
    expect(
      decideMicEngineV2Enabled({
        override: true,
        globalValue: false,
        storageValue: false,
        devDefault: false,
      }),
    ).toBe(true)
    expect(
      decideMicEngineV2Enabled({
        devDefault: false,
        globalValue: true,
        storageValue: false,
      }),
    ).toBe(true)
    expect(
      decideMicEngineV2Enabled({
        devDefault: false,
        globalValue: null,
        storageValue: 'on',
      }),
    ).toBe(true)
  })

  it('parses common truthy/falsy strings', () => {
    expect(resolveFlagOverride('true')).toBe(true)
    expect(resolveFlagOverride('off')).toBe(false)
    expect(resolveFlagOverride('maybe')).toBe(null)
  })

  it('exposes stable flag identifiers for dev QA', () => {
    expect(MIC_ENGINE_V2_FLAG).toBe('micEngineV2')
    expect(MIC_ENGINE_V2_STORAGE_KEY).toBe('scoreflow.flags.micEngineV2')
  })

  it('honors explicit override via isMicEngineV2Enabled', () => {
    expect(isMicEngineV2Enabled(false)).toBe(true)
    expect(isMicEngineV2Enabled(true)).toBe(true)
    expect(MIC_ENGINE_MODE.V2).toBe('v2-score-informed')
    expect(MIC_ENGINE_MODE.V1).toBeUndefined()
  })
})
